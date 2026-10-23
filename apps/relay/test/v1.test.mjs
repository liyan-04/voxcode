import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {once} from 'node:events';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRelay} from '../relay.mjs';
import {createConnector} from '../connector.mjs';
import {route} from '../protocol.mjs';
import WebSocket,{WebSocketServer} from 'ws';
import {randomUUID} from 'node:crypto';
import {createConnection} from 'node:net';

const machineId='company-mac',machineKey='a-secure-machine-key-with-more-than-32-characters',token='phone-session-token';
const authorization=`Bearer ${token}`;
const post=body=>({method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify(body)});
async function listen(server,secure=false){server.listen(0,'127.0.0.1');await once(server,'listening');return `${secure?'https':'http'}://127.0.0.1:${server.address().port}`;}
async function fixture(t,{handler,tls,timeout=1000}={}){
  const received=[];
  const bridge=createServer(async(req,res)=>{const parts=[];for await(const part of req)parts.push(part);received.push({path:req.url,headers:req.headers,body:Buffer.concat(parts)});if(handler)return handler(req,res);res.writeHead(200,{'content-type':'application/json'});res.end('{}');});
  const bridgeURL=await listen(bridge);
  const relay=createRelay({machineId,machineKey,tls,requestTimeoutMs:timeout});
  const base=await listen(relay.server,Boolean(tls));let connector;
  t.after(async()=>{await connector?.close();await relay.close();bridge.closeAllConnections();await new Promise(resolve=>bridge.close(resolve));});
  return {base,received,relay,async connect(ca=tls?.ca){connector=createConnector({machineId,machineKey,relayURL:base.replace(/^http/,'ws')+'/connector',bridgeURL,ca,reconnect:false});await connector.start();return connector;}};
}
function secureRequest(url,options={}){return new Promise((resolve,reject)=>{const req=httpsRequest(url,{rejectUnauthorized:true,...options},res=>{const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(parts)}));});req.on('error',reject);req.end();});}
function openssl(args,cwd){const result=spawnSync('openssl',args,{cwd,encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
async function certificates(t,{ip='127.0.0.1',days='1'}={}){
  const dir=await mkdtemp(join(tmpdir(),'voxcode-relay-tls-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  openssl(['req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.pem','-days','2','-subj','/CN=VoxCode Fixture CA','-addext','basicConstraints=critical,CA:TRUE'],dir);
  openssl(['req','-new','-newkey','rsa:2048','-nodes','-keyout','leaf.key','-out','leaf.csr','-subj','/CN=VoxCode Fixture Relay','-addext',`subjectAltName=IP:${ip}`],dir);
  openssl(['x509','-req','-in','leaf.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-out','leaf.pem','-days',days,'-copy_extensions','copy'],dir);
  return {key:await readFile(join(dir,'leaf.key')),cert:await readFile(join(dir,'leaf.pem')),ca:await readFile(join(dir,'ca.pem'))};
}
test('v1 exact settings, criteria and voice abort routes require phone bearer',async t=>{
  const f=await fixture(t);await f.connect();
  for(const [method,path] of [['GET','/api/settings'],['POST','/api/settings'],['POST','/api/tasks/task-1/criteria/criterion-1'],['POST','/api/voice/sessions/voice-1/abort']]){
    assert.equal(route(method,path)?.public,false,`${method} ${path}`);
    const request=method==='POST'?post({requestId:'request-1',version:1}):{headers:{authorization}};
    assert.equal((await fetch(f.base+path,{...request,method})).status,200);
    assert.equal((await fetch(f.base+path,{...request,method,headers:{'content-type':'application/json'}})).status,401);
    assert.equal((await fetch(f.base+path,{...request,method,headers:{'content-type':'application/json',authorization:`Bearer ${machineKey}`}})).status,401);
  }
  assert.equal(f.received.length,4);assert(f.received.every(request=>request.headers.authorization===authorization));
  for(const path of ['/api/monitor','/preview/artifact/','/api/tasks/task-1/preview-session','/api/settings/other','/api/tasks/task-1/criteria/c-1/other'])assert.equal(route('GET',path),null);
  assert.equal(route('POST','/api/tasks/task-1/preview-session'),null);
});
test('matching private CA/IP permits HTTPS and WSS while unknown CA is rejected',{timeout:15000},async t=>{
  const tls=await certificates(t),f=await fixture(t,{tls});
  await assert.rejects(secureRequest(f.base+'/api/health'),/certificate|issuer|verify/i);
  const other=await certificates(t);
  await assert.rejects(secureRequest(f.base+'/api/health',{ca:other.ca}),/certificate|issuer|verify/i);
  const denied=createConnector({machineId,machineKey,relayURL:f.base.replace('https:','wss:')+'/connector',bridgeURL:'http://127.0.0.1:1',ca:other.ca,reconnect:false});
  try{await assert.rejects(denied.start(),/Relay connection failed/);}finally{await denied.close();}
  await f.connect();
  const response=await secureRequest(f.base+'/api/health',{ca:tls.ca});assert.equal(response.status,200);
});
test('request body reading is included in the relay total deadline',{timeout:3000},async t=>{
  const f=await fixture(t,{timeout:50});await f.connect();
  const result=await new Promise((resolve,reject)=>{
    const req=httpRequest(f.base+'/api/tasks',{method:'POST',headers:{authorization,'content-type':'application/json','content-length':'100'}},res=>{res.resume();res.once('end',()=>{req.destroy();resolve(res.statusCode);});});
    req.on('error',reject);req.write('{');
  });
  assert.equal(result,504);assert.equal(f.received.length,0);
  assert.equal((await fetch(f.base+'/api/tasks/task-1/cancel',post({requestId:'after-timeout',version:1}))).status,200);
});
test('connector independently bounds media and preserves control capacity',{timeout:4000},async t=>{
  const bridge=createServer((req,res)=>{req.resume();if(req.url.endsWith('/audio'))return;res.writeHead(200,{'content-type':'application/json'});res.end('{}');});
  const bridgeURL=await listen(bridge),server=createServer(),relayURL=await listen(server),wss=new WebSocketServer({server});
  const accepted=once(wss,'connection'),connector=createConnector({machineId,machineKey,relayURL:relayURL.replace('http:','ws:')+'/connector',bridgeURL,reconnect:false,requestTimeoutMs:500});
  t.after(async()=>{await connector.close();for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));bridge.closeAllConnections();await new Promise(resolve=>bridge.close(resolve));});
  await connector.start();const [ws]=await accepted,responses=new Map();let done;
  const completed=new Promise(resolve=>{done=resolve;});
  ws.on('message',data=>{const response=JSON.parse(data);responses.set(response.id,response);if(responses.size===12)done();});
  const send=(path,method='POST',contentType='application/json')=>{const id=randomUUID();ws.send(JSON.stringify({type:'request',id,method,path,authorization,contentType,body:method==='POST'?Buffer.from('{}').toString('base64'):''}));return id;};
  const audio=Array.from({length:9},()=>send('/api/voice/sessions/voice-1/audio','POST','application/octet-stream'));
  const control=[send('/api/tasks/task-1/cancel'),send('/api/tasks/task-1/approvals/approval-1'),send('/api/tasks','GET')];
  await completed;
  assert.equal(responses.get(audio[8]).status,503);assert(audio.slice(0,8).every(id=>responses.get(id).status===504));assert(control.every(id=>responses.get(id).status===200));
});
for(const [reason,options] of [['wrong IP',{ip:'127.0.0.2'}],['expired',{days:'0'}]])test(`${reason} certificate rejects HTTPS and WSS`,{timeout:15000},async t=>{
  const tls=await certificates(t,options),f=await fixture(t,{tls});
  await assert.rejects(secureRequest(f.base+'/api/health',{ca:tls.ca}),reason==='expired'?/expired/i:/IP|altnames|match/i);
  await assert.rejects(f.connect(),/Relay connection failed/);
});
test('audio saturation preserves cancellation, approval and status capacity',{timeout:5000},async t=>{
  let resolveFull;const full=new Promise(resolve=>{resolveFull=resolve;});let audio=0;
  const f=await fixture(t,{timeout:600,handler:(req,res)=>{if(req.url.endsWith('/audio')){if(++audio===8)resolveFull();return;}res.writeHead(200,{'content-type':'application/json'});res.end('{}');}});await f.connect();
  const media=Array.from({length:8},()=>fetch(f.base+'/api/voice/sessions/voice-1/audio',{method:'POST',headers:{authorization,'content-type':'application/octet-stream'},body:Buffer.from([0,255,1,0])}));
  await full;
  assert.equal((await fetch(f.base+'/api/voice/sessions/voice-1/audio',{method:'POST',headers:{authorization,'content-type':'application/octet-stream'},body:Buffer.from([0,1])})).status,429);
  for(const path of ['/api/tasks/task-1/cancel','/api/tasks/task-1/approvals/approval-1'])assert.equal((await fetch(f.base+path,post({requestId:'control-1',version:1}))).status,200);
  assert.equal((await fetch(f.base+'/api/tasks',{headers:{authorization}})).status,200);
  assert((await Promise.all(media)).every(response=>response.status===504));
});
test('core mutation errors preserve status and version conflict body',async t=>{
  const error={error:{code:'stale',message:'Task version changed'}};
  const f=await fixture(t,{handler:(req,res)=>{res.writeHead(409,{'content-type':'application/json','set-cookie':'not-allowed=secret'});res.end(JSON.stringify(error));}});await f.connect();
  const response=await fetch(f.base+'/api/tasks/task-1/criteria/criterion-1',post({requestId:'criterion-stale',version:0,decision:'pass'}));
  assert.equal(response.status,409);assert.deepEqual(await response.json(),error);assert.equal(response.headers.get('set-cookie'),null);
});
test('relay shutdown closes TCP connections that never finish a TLS handshake',{timeout:5000},async t=>{
  const tls=await certificates(t),f=await fixture(t,{tls});
  const socket=createConnection({host:'127.0.0.1',port:Number(new URL(f.base).port)});socket.on('error',()=>{});await once(socket,'connect');
  const closing=f.relay.close();let timer,closed;
  try{closed=await Promise.race([closing.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),500);})]);}
  finally{clearTimeout(timer);socket.destroy();await closing;}
  assert.equal(closed,true,'Relay shutdown must own pre-handshake TCP sockets');
});
