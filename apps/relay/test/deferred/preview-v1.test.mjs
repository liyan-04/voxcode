import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer, request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {once} from 'node:events';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
// Deferred preview contract regressions; excluded from the phone-demo core suite.
import {createRelay} from '../../relay.mjs';
import {createConnector} from '../../connector.mjs';
import {route} from '../../protocol.mjs';

const machineId = 'company-mac';
const machineKey = 'a-secure-machine-key-with-more-than-32-characters';
const phone = 'phone-session-token';
const artifact = '7ab2033b-e9ef-4286-9a72-28b475702e30';
const previewPath = `/preview/${artifact}/`;
const cookie = `voxcode_preview=${'x'.repeat(43)}`;
const setCookie = `${cookie}; Path=${previewPath}; Max-Age=600; Secure; HttpOnly; SameSite=Strict`;
const auth = {authorization:`Bearer ${phone}`};
const json = body => ({method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify(body)});
async function listen(server, secure = false) {
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  return `${secure?'https':'http'}://127.0.0.1:${server.address().port}`;
}
async function fixture(t, {handler, relay:relayOptions = {}, connector:connectorOptions = {}} = {}) {
  const received = [];
  const bridge = createServer(async (req,res) => {
    const body = []; for await (const chunk of req) body.push(chunk);
    received.push({path:req.url,headers:req.headers,body:Buffer.concat(body)});
    handler(req,res);
  });
  const bridgeURL = await listen(bridge);
  const relay = createRelay({machineId,machineKey,...relayOptions});
  const base = await listen(relay.server,Boolean(relayOptions.tls));
  const connector = createConnector({machineId,machineKey,bridgeURL,relayURL:base.replace(/^http/,'ws')+'/connector',reconnect:false,...connectorOptions});
  t.after(async () => { await connector.close(); await relay.close(); bridge.closeAllConnections(); await new Promise(resolve=>bridge.close(resolve)); });
  await connector.start();
  return {base,received};
}
function rawRequest(url, options = {}) {
  return new Promise((resolve,reject) => {
    const {body,...rest} = options;
    const request = (url.startsWith('https:')?httpsRequest:httpRequest)(url,rest,res => {
      const parts=[]; res.on('data',part=>parts.push(part)); res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts)}));
    });
    request.on('error',reject); request.end(body);
  });
}
function openssl(args, cwd) {
  const result=spawnSync('openssl',args,{cwd,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
}
async function certificates(t, ip='127.0.0.1') {
  const dir=await mkdtemp(join(tmpdir(),'voxcode-tls-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  openssl(['req','-x509','-newkey','rsa:2048','-noenc','-keyout','ca.key','-out','ca.pem','-days','2','-subj','/CN=VoxCode Test CA','-addext','basicConstraints=critical,CA:TRUE'],dir);
  openssl(['req','-new','-newkey','rsa:2048','-noenc','-keyout','leaf.key','-out','leaf.csr','-subj','/CN=VoxCode Test Relay','-addext',`subjectAltName=IP:${ip}`],dir);
  openssl(['x509','-req','-in','leaf.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-out','leaf.pem','-days','1','-copy_extensions','copy'],dir);
  return {key:await readFile(join(dir,'leaf.key')),cert:await readFile(join(dir,'leaf.pem')),ca:await readFile(join(dir,'ca.pem'))};
}

test('v1 protocol admits settings, criteria, voice abort and protected preview bootstrap',()=>{
  for (const [method,path] of [['GET','/api/settings'],['POST','/api/settings'],['POST','/api/tasks/task-1/criteria/criterion-1'],['POST','/api/voice/sessions/voice-1/abort'],['POST','/api/tasks/task-1/preview-session']]) {
    assert.equal(route(method,path)?.public,false,`${method} ${path}`);
  }
});

test('preview paths normalize escaped asset names and reject traversal or arbitrary targets',()=>{
  assert.equal(route('GET',previewPath+'assets/%61pp.js')?.path,previewPath+'assets/app.js');
  for (const suffix of ['../secret','%2e%2e/secret','%252e%252e/secret','assets%2fapp.js','assets/%5csecret','assets//app.js','assets/./app.js','app.js?url=http://evil','%00','http:evil','%GG']) {
    const result=route('GET',previewPath+suffix);
    assert(!result || result.error, suffix);
  }
  assert.equal(route('POST',previewPath),null);
});

test('preview bootstrap cookie survives transport and only the scoped cookie reaches assets',async t=>{
  const f=await fixture(t,{handler:(req,res)=>{
    if (req.url.includes('preview-session')) { res.writeHead(200,{'content-type':'application/json','set-cookie':setCookie,'x-secret':'hidden'}); return res.end(JSON.stringify({path:previewPath,expiresAt:new Date(Date.now()+600000).toISOString()})); }
    res.writeHead(req.headers.cookie===cookie?200:401,{'content-type':'text/html; charset=utf-8','set-cookie':'bad=outside; Path=/'}); res.end('<!doctype html><h1>Actual static fixture</h1>');
  }});
  const boot=await fetch(f.base+'/api/tasks/task-1/preview-session',json({version:1}));
  assert.equal(boot.status,200); assert.equal(boot.headers.get('set-cookie'),setCookie); assert.equal(boot.headers.get('x-secret'),null);
  assert.deepEqual((await boot.json()).path,previewPath);
  const response=await fetch(f.base+previewPath,{headers:{cookie:`unrelated=secret; ${cookie}`,authorization:`Bearer ${phone}`,'x-forwarded-host':'evil'}});
  assert.equal(response.status,200); assert.match(await response.text(),/Actual static fixture/);
  assert.equal(response.headers.get('set-cookie'),null); assert.match(response.headers.get('content-security-policy'),/worker-src 'none'/);
  assert.equal(f.received[1].headers.cookie,cookie); assert.equal(f.received[1].headers.authorization,undefined); assert.equal(f.received[1].headers['x-forwarded-host'],undefined);
  assert.equal(f.received[0].headers.cookie,undefined); assert.equal(f.received[0].headers.authorization,`Bearer ${phone}`);
  assert.equal((await fetch(f.base+'/api/tasks',{headers:{cookie}})).status,401);
  assert.equal((await fetch(f.base+previewPath,{headers:auth})).status,401);
  assert.equal((await fetch(f.base+'/api/tasks/task-1/preview-session',{...json({version:1}),headers:{'content-type':'application/json',cookie}})).status,401);
  assert.equal((await fetch(f.base+'/api/tasks/task-1/preview-session',{...json({version:1}),headers:{'content-type':'application/json',authorization:`Bearer ${machineKey}`}})).status,401);
});

test('preview static types are admitted while redirects and unsafe bootstrap cookies fail closed',async t=>{
  let mode='css';
  const f=await fixture(t,{handler:(req,res)=>{
    const types={css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',font:'font/woff2'};
    if(mode==='redirect') { res.writeHead(302,{'content-type':'text/html','location':'http://evil.test'}); return res.end('redirect'); }
    if(mode==='cookie') { res.writeHead(200,{'content-type':'application/json','set-cookie':`${cookie}; Path=/; Secure; HttpOnly; SameSite=Strict`}); return res.end(JSON.stringify({path:previewPath})); }
    res.writeHead(200,{'content-type':types[mode]}); res.end(Buffer.from([0,255,42]));
  }});
  for(mode of ['css','js','font']) { const result=await fetch(f.base+previewPath+`assets/file.${mode}`,{headers:{cookie}}); assert.equal(result.status,200); assert.deepEqual(Buffer.from(await result.arrayBuffer()),Buffer.from([0,255,42])); }
  mode='redirect'; assert.equal((await fetch(f.base+previewPath,{headers:{cookie},redirect:'manual'})).status,502);
  mode='cookie'; const unsafe=await fetch(f.base+'/api/tasks/task-1/preview-session',json({version:1})); assert.equal(unsafe.status,502); assert.equal(unsafe.headers.get('set-cookie'),null);
});

test('saturated preview budget does not block cancellation and rejected paths never hit bridge',{timeout:3000},async t=>{
  let ready; const started=new Promise(resolve=>{ready=resolve;});
  const f=await fixture(t,{relay:{maxPreviewInflight:1,requestTimeoutMs:500},handler:(req,res)=>{
    if(req.url.startsWith('/preview/')) return ready();
    res.writeHead(200,{'content-type':'application/json'});res.end('{}');
  }});
  const pending=fetch(f.base+previewPath,{headers:{cookie}});
  await started;
  assert.equal((await fetch(f.base+previewPath+'asset.js',{headers:{cookie}})).status,429);
  assert.equal((await fetch(f.base+'/api/tasks/task-1/cancel',json({requestId:'cancel-1',version:1}))).status,200);
  for(const suffix of ['%2e%2e/secret','assets%2Fapp.js','%252e%252e/secret']) {
    const result=await rawRequest(f.base,{path:previewPath+suffix,headers:{cookie}}); assert([400,404].includes(result.status));
  }
  assert.equal(f.received.filter(request=>request.path.startsWith('/preview/')).length,1);
  assert.equal((await pending).status,504);
});

test('HTTPS and WSS require matching trusted private CA and IP SAN',async t=>{
  const tls=await certificates(t);
  const f=await fixture(t,{relay:{tls},connector:{ca:tls.ca},handler:(req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}');}});
  const response=await rawRequest(f.base+'/api/health',{ca:tls.ca,rejectUnauthorized:true});
  assert.equal(response.status,200); assert.deepEqual(JSON.parse(response.body),{ok:true});
  await assert.rejects(rawRequest(f.base+'/api/health'),/certificate|issuer|verify/i);
  const wrong=await certificates(t,'127.0.0.2');
  await assert.rejects(rawRequest(f.base+'/api/health',{ca:wrong.ca,rejectUnauthorized:true}),/certificate|issuer|verify/i);
  const other=createRelay({machineId,machineKey,tls:wrong});const otherBase=await listen(other.server,true);t.after(()=>other.close());
  await assert.rejects(rawRequest(otherBase+'/api/health',{ca:wrong.ca,rejectUnauthorized:true}),/IP|altnames|match/i);
  for (const [base,ca] of [[f.base,wrong.ca],[otherBase,wrong.ca]]) {
    const denied=createConnector({machineId,machineKey,relayURL:base.replace('https:','wss:')+'/connector',bridgeURL:'http://127.0.0.1:1',ca,reconnect:false});
    try { await assert.rejects(denied.start(),/Relay connection failed/); } finally { await denied.close(); }
  }
});
