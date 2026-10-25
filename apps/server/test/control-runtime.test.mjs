import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {request} from 'node:https';
import {setTimeout as delay} from 'node:timers/promises';
import {createConnection} from 'node:net';
import {once} from 'node:events';
import {startControlRuntime} from '../control-runtime.mjs';
import WebSocket from 'ws';
import {createTaskRpcServer} from '../task-rpc.mjs';
import {createMacAgent} from '../../mac-agent/agent.mjs';
import {createTaskCapability} from '../../mac-agent/task-capability.mjs';

async function fixture(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'vox-control-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const key=join(root,'key'),cert=join(root,'cert');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=Fixture','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
 return {root,ca:await readFile(cert),config:{host:'127.0.0.1',port:0,publicOrigin:'https://127.0.0.1:9899',revision:'fixture',deviceRoot:join(root,'state'),userId:'owner',deviceId:'mac',loginSecret:'fixture-long-login-secret',tls:{key:await readFile(key),cert:await readFile(cert)}}};
}
function http(runtime,ca,path,method='GET',body,headers={}){
 return new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:runtime.server.address().port,ca,path,method,headers},res=>{let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(data)}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});
}
test('control HTTPS maps authenticated phone to a fixed Mac and public health never dispatches RPC',async t=>{
 const f=await fixture(t),commands=[];let handle,attached=0;
 const runtime=await startControlRuntime({config:f.config,attachTransport:()=>{attached++;return{close:async()=>{}};}});t.after(()=>runtime.close());
 for(let n=0;n<3;n++){const health=await http(runtime,f.ca,'/api/health');assert.equal(health.body.executionHost,'mac');assert.equal(health.body.codexAvailable,false);}
 assert.equal((await http(runtime,f.ca,'/api/devices')).status,401);
 const login=await http(runtime,f.ca,'/api/login','POST',{password:f.config.loginSecret},{origin:f.config.publicOrigin});
 const headers={origin:f.config.publicOrigin,cookie:login.headers['set-cookie'][0].split(';')[0]};
 const pairing=await runtime.gateway.startPairing({userId:'owner'}),paired=await runtime.gateway.completePairing({code:pairing.code,userId:'owner',deviceId:'mac'});
 handle=await runtime.gateway.connect({type:'register',protocolVersion:1,deviceId:'mac',token:paired.token,capabilities:['task_rpc']},{send:frame=>{
  if(frame.type!=='command')return;commands.push(frame.command);
  setImmediate(()=>handle.receive({type:'commandResult',protocolVersion:1,deviceId:'mac',requestId:frame.command.requestId,operationId:frame.command.operationId,status:'succeeded',snapshot:frame.command.payload.method==='listProjects'?[{id:'p',name:'Mac project',enabled:true}]:frame.command.payload.method==='getProject'?{id:'p',enabled:true}:[]}));
 }});
 const devices=await http(runtime,f.ca,'/api/devices','GET',null,headers);assert.equal(devices.body.devices[0].online,true);assert.equal(JSON.stringify(devices.body).includes(paired.token),false);
 assert.equal((await http(runtime,f.ca,'/api/projects','GET',null,headers)).body.projects[0].id,'p');
 const count=commands.length;await http(runtime,f.ca,'/api/health');assert.equal(commands.length,count);assert.equal(attached,1);
 const badOrigin=await http(runtime,f.ca,'/api/pairings','POST',{}, {...headers,origin:'https://evil.invalid'});assert.equal(badOrigin.status,403);
 const list=await runtime.dispatch({jsonrpc:'2.0',id:1,method:'tools/list'});assert(!list.result.tools.some(tool=>tool.name==='codex_start_task'));
 const denied=await runtime.dispatch({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'codex_start_task',arguments:{}}});assert.equal(denied.error.code,-32003);
 await runtime.close();assert.equal(runtime.server.listening,false);await handle.close();
});
test('control shutdown deadline covers proxy and transport cleanup and still closes HTTP',async t=>{
 const f=await fixture(t);
 const runtime=await startControlRuntime({config:f.config,shutdownTimeoutMs:20,attachTransport:()=>({close:()=>new Promise(()=>{})})});
 t.after(()=>{runtime.server.closeAllConnections();runtime.server.close();});
 const result=await Promise.race([runtime.close().then(()=>'closed',()=>'failed'),delay(100).then(()=>'hung')]);
 assert.equal(result,'failed');assert.equal(runtime.server.listening,false);
});
test('shutdown deadline also destroys raw TCP sockets before TLS handshake',async t=>{
 const f=await fixture(t),runtime=await startControlRuntime({config:f.config,shutdownTimeoutMs:20,attachTransport:()=>({close:async()=>{}})});
 const socket=createConnection({host:'127.0.0.1',port:runtime.server.address().port});socket.on('error',()=>{});await once(socket,'connect');
 t.after(()=>{socket.destroy();runtime.server.closeAllConnections();runtime.server.close();});
 await runtime.close().catch(()=>{});await delay(10);
 assert.equal(socket.destroyed,true);
});
test('configured proxy connecting or failed never advertises available and rejection cannot skip listener cleanup',async t=>{
 const f=await fixture(t);let change;
 const runtime=await startControlRuntime({config:{...f.config,mcpEndpoint:'wss://configured.invalid'},attachTransport:()=>({close:async()=>{}}),createBridge:({onStatus})=>{change=onStatus;return {start(){onStatus('connecting');},async close(){throw Error('private-token');}};}});
 t.after(()=>{runtime.server.closeAllConnections();runtime.server.close();});
 assert.equal((await http(runtime,f.ca,'/api/health')).body.mcpAvailable,false);
 change('connection_error');assert.equal((await http(runtime,f.ca,'/api/health')).body.mcpAvailable,false);
 change('connected');assert.equal((await http(runtime,f.ca,'/api/health')).body.mcpAvailable,true);
 await assert.rejects(runtime.close(),error=>!error.message.includes('private-token'));assert.equal(runtime.server.listening,false);
});
test('phone HTTPS and MCP share real WSS Agent and private Mac task RPC without a server executor',async t=>{
 const f=await fixture(t),socketPath=join(f.root,'rpc.sock'),tasks=new Map(),calls=[];
 const project={id:'p',name:'Mac fixture project',enabled:true};
 const service={status:async()=>({available:true,version:'mac-fixture-cli'}),listProjects:async()=>[project],getProject:async id=>id==='p'?project:null,listTasks:async()=>[...tasks.values()],getTask:async id=>tasks.get(id),startTask:async input=>{calls.push(input);tasks.set('task',{id:'task',projectId:input.projectId,prompt:input.prompt,status:'draft',revision:1,metadataRevision:1});return {taskId:'task',projectId:input.projectId};},confirmTask:async(id,input)=>{calls.push(input);const task={...tasks.get(id),status:'running',revision:2};tasks.set(id,task);return task;},cancelTask:async(id,input)=>{calls.push(input);const task={...tasks.get(id),status:'cancelled',revision:3};tasks.set(id,task);return task;}};
 const rpc=await createTaskRpcServer({socketPath,adapter:service});t.after(()=>rpc.close());
 const runtime=await startControlRuntime({config:f.config});t.after(()=>runtime.close());
 const pairing=await runtime.gateway.startPairing({userId:'owner'}),paired=await runtime.gateway.completePairing({code:pairing.code,userId:'owner',deviceId:'mac'});
 class TrustedSocket extends WebSocket{constructor(url,options){super(url,{...options,ca:f.ca});}}
 const capability=createTaskCapability({socketPath}),agent=await createMacAgent({endpoint:`wss://127.0.0.1:${runtime.server.address().port}/agent`,deviceId:'mac',token:paired.token,stateFile:join(f.root,'agent.json'),capabilities:capability.capabilities,onCommand:command=>capability.execute(command),WebSocketImpl:TrustedSocket,heartbeatMs:100,retryMinMs:10,retryMaxMs:10});
 t.after(()=>agent.close());agent.start();
 const deadline=Date.now()+3000;while(!(await runtime.gateway.listDevices({userId:'owner'}))[0].online){assert(Date.now()<deadline);await delay(5);}
 const login=await http(runtime,f.ca,'/api/login','POST',{password:f.config.loginSecret},{origin:f.config.publicOrigin});const headers={origin:f.config.publicOrigin,cookie:login.headers['set-cookie'][0].split(';')[0]};
 assert.equal((await http(runtime,f.ca,'/api/projects','GET',null,headers)).body.projects[0].id,'p');
 const input={projectId:'p',prompt:'synthetic draft',requestId:'phone-business-id'};
 assert.equal((await http(runtime,f.ca,'/api/tasks','POST',input,headers)).body.taskId,'task');assert.deepEqual(calls[0],input);
 await http(runtime,f.ca,'/api/tasks','POST',input,headers);assert.equal(calls.length,1);
 assert.equal((await http(runtime,f.ca,'/api/tasks/task/confirm','POST',{requestId:'confirm-business-id',revision:1},headers)).body.status,'running');
 assert.equal(calls[1].requestId,'confirm-business-id');
 assert.equal((await http(runtime,f.ca,'/api/tasks/task/cancel','POST',{requestId:'cancel-business-id'},headers)).body.status,'cancelled');
 await runtime.refreshState();assert.equal((await http(runtime,f.ca,'/api/health')).body.codexAvailable,true);
 const mcp=await runtime.dispatch({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'codex_status',arguments:{}}});assert.match(mcp.result.content[0].text,/mac-fixture-cli/);
 assert.equal((await http(runtime,f.ca,'/api/tasks?projectId=p','GET',null,headers)).body.tasks[0].status,'cancelled');
 await agent.close();assert.equal((await http(runtime,f.ca,'/api/projects','GET',null,headers)).status,503);
});
