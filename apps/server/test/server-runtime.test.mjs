import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer as createNetServer} from 'node:net';
import {request} from 'node:https';
import {loadServerConfiguration,serverPreflight,checkedServerConfiguration} from '../runtime-config.mjs';
import {startServerRuntime} from '../runtime.mjs';
import * as fs from 'node:fs/promises';
import WebSocket,{WebSocketServer} from 'ws';
import {createServer as createHttpListener} from 'node:http';
import {createTaskRpcServer} from '../task-rpc.mjs';
import {runServerCli} from '../server-cli.mjs';

async function fixture(t){
 const dir=await fs.realpath(await mkdtemp(join(tmpdir(),'vox-runtime-')));t.after(()=>rm(dir,{recursive:true,force:true}));
 await chmod(dir,0o700);const taskDir=join(dir,'task');await mkdir(taskDir,{mode:0o750});const socket=join(taskDir,'rpc.sock'),listener=createNetServer();await new Promise(r=>listener.listen(socket,r));await chmod(socket,0o660);t.after(()=>new Promise(r=>listener.close(r)));
 const key=join(dir,'key.pem'),cert=join(dir,'cert.pem'),secret=join(dir,'login');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=Fixture','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});await chmod(key,0o600);await writeFile(secret,'synthetic-login-long-enough',{mode:0o600});
 const env={VOXCODE_HOST:'127.0.0.1',VOXCODE_PORT:'9899',VOXCODE_PUBLIC_ORIGIN:'https://127.0.0.1:9899',VOXCODE_TASK_SOCKET:socket,VOXCODE_TASK_UID:String(process.getuid()),VOXCODE_TLS_KEY:key,VOXCODE_TLS_CERT:cert,VOXCODE_LOGIN_SECRET_FILE:secret,VOXCODE_REVISION:'84da36b'};
 const taskUid=process.getuid()+1;
 const separatedFs={...fs,async lstat(path){const info=await fs.lstat(path);if([taskDir,socket].includes(path))info.uid=taskUid;return info;}};
 return {dir,env,cert,key,options:{env:{...env,VOXCODE_TASK_UID:String(taskUid)},uid:process.getuid(),nodeVersion:'22.23.4',fs:separatedFs}};
}

test('configuration rejects root, same task identity and missing config without exposing values',async t=>{
 const f=await fixture(t);await assert.rejects(loadServerConfiguration({env:f.env,uid:0}),/non-root/);
 await assert.rejects(loadServerConfiguration({env:f.env,nodeVersion:'22.23.4'}),/separate task/);
 const report=await serverPreflight({env:{VOXCODE_LOGIN_SECRET_FILE:'PRIVATE-secret-path'}});assert.equal(report.ok,false);assert.doesNotMatch(JSON.stringify(report),/PRIVATE-secret-path/);assert.throws(()=>checkedServerConfiguration(report));
});

test('configuration enforces strict HTTPS, cert identity and private secret permissions',async t=>{
 const f=await fixture(t),testUid=process.getuid()+1; // web UID differs; files remain owned by the synthetic task UID, so reject before use.
 await assert.rejects(loadServerConfiguration({env:{...f.env,VOXCODE_PUBLIC_ORIGIN:'http://127.0.0.1:9899'},uid:testUid}),/HTTPS/);
 await assert.rejects(loadServerConfiguration({env:{...f.env,VOXCODE_PUBLIC_ORIGIN:'https://wrong.invalid:9899'},uid:testUid}));
 await chmod(f.env.VOXCODE_LOGIN_SECRET_FILE,0o644);await assert.rejects(loadServerConfiguration({env:f.env,uid:testUid}));
});
test('valid configuration remains private behind a nonforgeable redacted preflight report',async t=>{
 const f=await fixture(t),config=await loadServerConfiguration(f.options);assert.equal(config.taskUid,process.getuid()+1);assert.equal(config.loginSecret,'synthetic-login-long-enough');assert.equal(config.publicOrigin,'https://127.0.0.1:9899');
 const report=await serverPreflight(f.options);assert.equal(report.ok,true);assert.doesNotMatch(JSON.stringify(report),/synthetic-login|PRIVATE KEY|rpc.sock|key.pem/);assert.equal(checkedServerConfiguration(report).loginSecret,config.loginSecret);assert.throws(()=>checkedServerConfiguration({...report}));
 const endpoint=join(f.dir,'endpoint');await writeFile(endpoint,'wss://xrobo.qiniu.com/v1/mcpproxy/connect?token=synthetic-secret-token',{mode:0o600});const withMcp=await serverPreflight({...f.options,env:{...f.options.env,VOXCODE_MCP_ENDPOINT_FILE:endpoint}});assert.equal(withMcp.ok,true);assert.doesNotMatch(JSON.stringify(withMcp),/synthetic-secret-token|xrobo.qiniu.com/);
});
test('configuration rejects weak socket credentials symlinks mismatched keys and wrong certificate hosts',async t=>{
 const f=await fixture(t);await chmod(f.env.VOXCODE_TASK_SOCKET,0o666);await assert.rejects(loadServerConfiguration(f.options),/socket/);await chmod(f.env.VOXCODE_TASK_SOCKET,0o660);
 await chmod(f.env.VOXCODE_LOGIN_SECRET_FILE,0o644);await assert.rejects(loadServerConfiguration(f.options),/Private/);await chmod(f.env.VOXCODE_LOGIN_SECRET_FILE,0o600);
 const symlink=join(f.dir,'key-link');await fs.symlink(f.key,symlink);await assert.rejects(loadServerConfiguration({...f.options,env:{...f.options.env,VOXCODE_TLS_KEY:symlink}}),/Trusted/);
 await assert.rejects(loadServerConfiguration({...f.options,env:{...f.options.env,VOXCODE_PUBLIC_ORIGIN:'https://wrong.invalid:9899'}}),/SAN/);
 await assert.rejects(loadServerConfiguration({...f.options,now:()=>Date.now()+3*86400000}),/validity/);
 const otherKey=join(f.dir,'other-key');execFileSync('openssl',['genrsa','-out',otherKey,'2048'],{stdio:'ignore'});await chmod(otherKey,0o600);await assert.rejects(loadServerConfiguration({...f.options,env:{...f.options.env,VOXCODE_TLS_KEY:otherKey}}),/key matching/);
 const endpoint=join(f.dir,'endpoint');await writeFile(endpoint,'ws://xrobo.qiniu.com/v1/mcpproxy/connect?token=private-token',{mode:0o600});await assert.rejects(loadServerConfiguration({...f.options,env:{...f.options.env,VOXCODE_MCP_ENDPOINT_FILE:endpoint}}),/WSS/);
});

const http=(port,ca,path,method='GET',body,headers={})=>new Promise((resolve,reject)=>{
 const req=request({hostname:'127.0.0.1',port,path,method,ca,headers:{...headers,...(body?{'content-type':'application/json'}:{})}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,data:JSON.parse(data)}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
});
test('standalone HTTPS runtime shares project task adapter and closes owned listener',async t=>{
 const f=await fixture(t),projects=[{id:'p',name:'Project',enabled:true}],tasks=new Map();let confirmed=0;
 const adapter={status:async()=>({available:true,version:'fixture-cli'}),listProjects:async()=>projects,getProject:async id=>projects.find(p=>p.id===id),listTasks:async()=>[...tasks.values()],getTask:async id=>tasks.get(id),startTask:async args=>{tasks.set('t',{id:'t',projectId:args.projectId,prompt:args.prompt,status:'draft',revision:1});return {taskId:'t'};},confirmTask:async id=>{confirmed++;return {...tasks.get(id),status:'running'};},cancelTask:async id=>({...tasks.get(id),status:'cancelled'})};
 const config={host:'127.0.0.1',port:0,publicOrigin:'https://127.0.0.1:9899',revision:'84da36b',loginSecret:'synthetic-login-long-enough',tls:{key:await readFile(f.key),cert:await readFile(f.cert)},taskSocket:f.env.VOXCODE_TASK_SOCKET};
 const runtime=await startServerRuntime({config,adapter});t.after(()=>runtime.close());const port=runtime.server.address().port,ca=await readFile(f.cert);
 const health=await http(port,ca,'/api/health');assert.equal(health.data.codexAvailable,true);assert.equal(health.data.revision,'84da36b');assert.equal(health.data.voiceAvailable,false);
 assert.equal((await http(port,ca,'/api/projects')).status,401);
 const auth=await http(port,ca,'/api/login','POST',{password:config.loginSecret},{origin:config.publicOrigin});const headers={origin:config.publicOrigin,cookie:auth.headers['set-cookie'][0].split(';')[0]};
 assert.equal((await http(port,ca,'/api/projects','GET',null,headers)).data.projects[0].id,'p');
 assert.equal((await http(port,ca,'/api/tasks','POST',{projectId:'p',prompt:'do work',requestId:'r'},headers)).data.taskId,'t');
 assert.equal((await http(port,ca,'/api/tasks/t/confirm','POST',{revision:1,requestId:'c'},headers)).status,200);assert.equal(confirmed,1);
 for(const name of ['codex_start_task','codex_cancel_task']){const out=await runtime.dispatch({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{projectId:'p',prompt:'x',requestId:'voice-r'}}},{transport:'proxy'});assert.equal(out.error.code,-32003);}
 assert.equal(tasks.size,1);await runtime.close();assert.equal(runtime.server.listening,false);
});
test('HTTPS runtime talks to the actual bounded Unix RPC and outbound WebSocket proxy fixture',async t=>{
 const f=await fixture(t),socket=join(f.dir,'real.sock'),projects=[{id:'p',name:'Project',enabled:true}];let draftCalls=0;
 const service={status:async()=>({available:true,version:'fixture-cli'}),listProjects:async()=>projects,getProject:async()=>projects[0],listTasks:async()=>[],startTask:async()=>{draftCalls++;return{taskId:'forbidden'}}};
 const rpc=await createTaskRpcServer({socketPath:socket,adapter:service});t.after(()=>rpc.close());
 const proxyHttp=createHttpListener(),proxy=new WebSocketServer({server:proxyHttp});proxyHttp.listen(0,'127.0.0.1');await new Promise(r=>proxyHttp.once('listening',r));t.after(async()=>{for(const client of proxy.clients)client.terminate();await new Promise(r=>proxy.close(r));await new Promise(r=>proxyHttp.close(r));});
 const received=new Map();let peer;const connected=new Promise(resolve=>proxy.once('connection',ws=>{peer=ws;ws.on('message',data=>{const message=JSON.parse(data);received.set(message.id,message);});resolve();}));
 const config={host:'127.0.0.1',port:0,publicOrigin:'https://127.0.0.1:9899',revision:'84da36b',loginSecret:'synthetic-login-long-enough',tls:{key:await readFile(f.key),cert:await readFile(f.cert)},taskSocket:socket,mcpEndpoint:`ws://127.0.0.1:${proxyHttp.address().port}`};
 const runtime=await startServerRuntime({config});t.after(()=>runtime.close());await connected;
 for(const [id,method,params] of [[1,'initialize',{}],[2,'tools/list',{}],[3,'tools/call',{name:'codex_status',arguments:{}}],[4,'tools/call',{name:'codex_start_task',arguments:{projectId:'p',prompt:'not run',requestId:'voice'}}]])peer.send(JSON.stringify({jsonrpc:'2.0',id,method,params}));
 for(let n=0;n<100&&received.size<4;n++)await new Promise(r=>setTimeout(r,5));assert.equal(received.size,4);assert(!received.get(2).result.tools.some(tool=>['codex_start_task','codex_cancel_task'].includes(tool.name)));assert.match(received.get(3).result.content[0].text,/fixture-cli/);assert.equal(received.get(4).error.code,-32003);assert.equal(draftCalls,0);
 const port=runtime.server.address().port,ca=await readFile(f.cert),health=await http(port,ca,'/api/health');assert.equal(health.data.mcpProxyState,'connected');assert.equal(health.data.codexAvailable,true);assert.equal(health.data.voiceAvailable,false);
 const ws=new WebSocket(`wss://127.0.0.1:${port}/ws/voice`,{ca});ws.on('error',()=>{});const response=await new Promise(resolve=>ws.once('unexpected-response',(_req,res)=>resolve(res)));assert.equal(response.statusCode,503);response.resume();ws.terminate();
 await runtime.close();assert.equal((await fs.lstat(socket)).isSocket(),true);assert.equal((await service.status()).available,true);
});
test('CLI failures stay redacted and unsupported arguments never run preflight',async()=>{
 const output=[];let called=0;let result=await runServerCli({args:['start','private-token'],preflight:async()=>{called++;},error:value=>output.push(value)});assert.equal(result.exitCode,2);assert.equal(called,0);assert(!output.join().includes('private-token'));
 result=await runServerCli({args:['start'],env:{PRIVATE:'private'},preflight:async()=>({ok:false,checks:[]}),error:value=>output.push(value)});assert.equal(result.exitCode,1);assert(!output.join().includes('private-token'));
 result=await runServerCli({args:['preflight'],preflight:async()=>({ok:false,checks:[{name:'identity',status:'blocked'}]}),log:value=>output.push(value)});assert.equal(result.exitCode,1);
});
test('runtime bind failures close only its own resources and never cancel task execution',async t=>{
 const f=await fixture(t),listener=createHttpListener();listener.listen(0,'127.0.0.1');await new Promise(r=>listener.once('listening',r));t.after(()=>new Promise(r=>listener.close(r)));let cancelled=0,bridges=0;const adapter={status:async()=>({available:true}),listProjects:async()=>[],getProject:async()=>null,cancelTask:async()=>{cancelled++;}};
 const config={host:'127.0.0.1',port:listener.address().port,publicOrigin:'https://127.0.0.1:9899',revision:'84da36b',loginSecret:'synthetic-login-long-enough',tls:{key:await readFile(f.key),cert:await readFile(f.cert)},taskSocket:f.env.VOXCODE_TASK_SOCKET,mcpEndpoint:'wss://xrobo.qiniu.com/v1/mcpproxy/connect?token=private-fixture'};
 await assert.rejects(startServerRuntime({config,adapter,createBridge:()=>{bridges++;throw Error('private endpoint');}}),/listener or proxy startup failed/);assert.equal(cancelled,0);assert.equal(bridges,0);assert.equal(listener.listening,true);
});
test('configuration rejects root-owned shared task sockets unsupported Node and untrusted proxy hosts',async t=>{
 const f=await fixture(t);for(const change of [{nodeVersion:'26.0.0'},{env:{...f.options.env,VOXCODE_TASK_UID:'0'}},{groups:[]}])await assert.rejects(loadServerConfiguration({...f.options,...change}));
 const endpoint=join(f.dir,'wrong-endpoint');await writeFile(endpoint,'wss://evil.invalid/v1/mcpproxy/connect?token=synthetic-secret-token',{mode:0o600});await assert.rejects(loadServerConfiguration({...f.options,env:{...f.options.env,VOXCODE_MCP_ENDPOINT_FILE:endpoint}}),/fixed WSS/);
 const taskOwned={...f.options.fs,async lstat(path){const info=await f.options.fs.lstat(path);if(path===f.env.VOXCODE_TLS_KEY)info.uid=Number(f.options.env.VOXCODE_TASK_UID);return info;}};await assert.rejects(loadServerConfiguration({...f.options,fs:taskOwned}),/Trusted/);
});
test('CLI start consumes only the exact successful preflight report and reports a sanitized failure',async t=>{
 const f=await fixture(t),report=await serverPreflight(f.options),output=[];let passed;
 const result=await runServerCli({args:['start'],preflight:async()=>report,start:async({config})=>{passed=config;return {close:async()=>{}};},log:value=>output.push(value)});assert.equal(result.exitCode,0);assert.equal(passed.revision,'84da36b');assert(!output.join().includes('synthetic-login'));
 const failure=await runServerCli({args:['start'],preflight:async()=>report,start:async()=>{throw Error('private-token');},error:value=>output.push(value)});assert.equal(failure.exitCode,1);assert(!output.join().includes('private-token'));
});
