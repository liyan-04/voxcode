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

test('authenticated device MCP tools use frozen target direct submissions and return real task output',async t=>{
 const f=await fixture(t),socketPath=join(f.root,'voice-rpc.sock');let task,providerOptions;
 const calls=[];const adapter={status:async()=>({available:true}),listProjects:async()=>[{id:'p',enabled:true}],getProject:async()=>({id:'p',enabled:true}),getTask:async()=>task,
 startTask:async input=>{calls.push(input);task={id:'spoken',projectId:'p',revision:1,status:'draft',turns:[{requestId:input.requestId}]};return {taskId:'spoken'};},
 confirmTask:async(id,input)=>{calls.push(input);task={...task,revision:2,status:'completed',output:'Fixture execution evidence',sessionId:'fixed-session'};Object.assign(task.turns[0],{revision:2,status:'completed',output:task.output});return task;}};
 const rpc=await createTaskRpcServer({socketPath,adapter});t.after(()=>rpc.close());
 const runtime=await startControlRuntime({config:{...f.config,voice:{synthetic:true},serverTaskSocket:socketPath},createVoiceProvider:options=>{providerOptions=options;return {connect:async()=>({input:{codec:'pcm_s16le',sampleRate:16000,channels:1,frameMs:20},writeReady:true}),start(){},stop(){},abort(){},close(){}};}});t.after(()=>runtime.close());
 const login=await http(runtime,f.ca,'/api/login','POST',{password:f.config.loginSecret},{origin:f.config.publicOrigin});
 const voice=new WebSocket(`wss://127.0.0.1:${runtime.server.address().port}/ws/voice`,{ca:f.ca,headers:{origin:f.config.publicOrigin,cookie:login.headers['set-cookie'][0].split(';')[0]}}),events=[];
 voice.on('error',()=>{});voice.on('message',data=>events.push(JSON.parse(data)));await once(voice,'open');
 const wait=async type=>{for(let i=0;i<300;i++){if(events.some(x=>x.type===type))return;await delay(5);}assert.fail('Missing '+type);};
 voice.send(JSON.stringify({type:'session.start',requestId:'s',context:{executionTarget:'server',projectId:'p',contextVersion:1}}));await wait('session.ready');
 voice.send(JSON.stringify({type:'capture.start',requestId:'c',captureId:'cap',contextVersion:1,format:{codec:'pcm_s16le',sampleRate:16000,channels:1,frameMs:20}}));await wait('capture.ready');
 assert.equal(events.find(x=>x.type==='capture.ready').writeReady,true);
 const tool=providerOptions.tools[0],result=await tool.invoke({prompt:'edit requested file'});await wait('tool.result');
 assert.equal(result.executionTarget,'server');assert.equal(result.taskId,'spoken');assert.equal(result.output,'Fixture execution evidence');assert.equal(calls.length,2);
 assert.equal(events.find(x=>x.type==='tool.result').result.output,result.output);assert(events.some(x=>x.type==='tool.started'));
 await tool.invoke({prompt:'edit requested file'});assert.equal(calls.length,2);
 const closing=once(voice,'close');voice.close();await closing;await assert.rejects(tool.invoke({prompt:'edit requested file'}),{code:'voice_context_invalid'});
 assert.equal((await runtime.dispatch({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'codex_start_task',arguments:{}}})).error.code,-32003);
});

async function fixture(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'vox-control-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const key=join(root,'key'),cert=join(root,'cert');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=Fixture','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
 return {root,ca:await readFile(cert),config:{host:'127.0.0.1',port:0,publicOrigin:'https://127.0.0.1:9899',revision:'fixture',deviceRoot:join(root,'state'),userId:'owner',deviceId:'mac',loginSecret:'fixture-long-login-secret',tls:{key:await readFile(key),cert:await readFile(cert)}}};
}
function http(runtime,ca,path,method='GET',body,headers={}){
 return new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:runtime.server.address().port,ca,path,method,headers},res=>{let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(data)}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});
}
test('target inventory and login never wait for an absent Mac or server executor',async t=>{
 const f=await fixture(t),runtime=await startControlRuntime({config:{...f.config,serverTaskSocket:join(f.root,'absent.sock')},attachTransport:()=>({close:async()=>{}})});t.after(()=>runtime.close());
 assert.equal((await http(runtime,f.ca,'/api/execution-targets')).status,401);
 const login=await http(runtime,f.ca,'/api/login','POST',{password:f.config.loginSecret},{origin:f.config.publicOrigin});assert.equal(login.status,200);
 const headers={origin:f.config.publicOrigin,cookie:login.headers['set-cookie'][0].split(';')[0]};
 const inventory=await http(runtime,f.ca,'/api/execution-targets','GET',null,headers);
 assert.equal(inventory.status,200);assert.deepEqual(inventory.body.targets.map(({id,configured,online})=>({id,configured,online})),[{id:'mac',configured:true,online:false},{id:'server',configured:true,online:false}]);
 assert.equal(JSON.stringify(inventory.body).includes('absent.sock'),false);
 const unavailable=await http(runtime,f.ca,'/api/projects?executionTarget=server','GET',null,headers);assert.equal(unavailable.status,503);assert.equal(unavailable.body.code,'target_unavailable');
 await runtime.refreshState();assert.equal((await http(runtime,f.ca,'/api/login','POST',{password:f.config.loginSecret},{origin:f.config.publicOrigin})).status,200);
});

test('server private RPC readiness is independent of Mac registration',async t=>{
 const f=await fixture(t),socketPath=join(f.root,'server.sock');
 const rpc=await createTaskRpcServer({socketPath,adapter:{status:async()=>({available:true,version:'server-fixture'}),listProjects:async()=>[{id:'p',name:'Server project',enabled:true}]}});t.after(()=>rpc.close());
 const runtime=await startControlRuntime({config:{...f.config,serverTaskSocket:socketPath},attachTransport:()=>({close:async()=>{}})});t.after(()=>runtime.close());
 await runtime.refreshState();
 const login=await http(runtime,f.ca,'/api/login','POST',{password:f.config.loginSecret},{origin:f.config.publicOrigin}),headers={origin:f.config.publicOrigin,cookie:login.headers['set-cookie'][0].split(';')[0]};
 const {targets}= (await http(runtime,f.ca,'/api/execution-targets','GET',null,headers)).body;
 assert.equal(targets[0].online,false);assert.equal(targets[1].online,true);assert.equal(targets[1].available,true);
 assert.equal((await http(runtime,f.ca,'/api/projects?executionTarget=server','GET',null,headers)).body.projects[0].name,'Server project');
 const pairing=await runtime.gateway.startPairing({userId:'owner'});await runtime.gateway.completePairing({code:pairing.code,userId:'owner',deviceId:'mac'});
 assert.equal((await http(runtime,f.ca,'/api/projects?executionTarget=mac','GET',null,headers)).status,503);
});

test('server voice capture freezes server membership without requiring the Mac adapter',async t=>{
 const f=await fixture(t),socketPath=join(f.root,'voice-server.sock'),contexts=[];
 const rpc=await createTaskRpcServer({socketPath,adapter:{getProject:async id=>({id,enabled:true}),getTask:async id=>({id,projectId:'p'})}});t.after(()=>rpc.close());
 const runtime=await startControlRuntime({config:{...f.config,serverTaskSocket:socketPath,voice:{synthetic:true}},createVoiceProvider:options=>{contexts.push(options.context);return {async connect(){return {input:{codec:'pcm_s16le',sampleRate:16000,channels:1,frameMs:20}};},start(){},close(){}};}});t.after(()=>runtime.close());
 const login=await http(runtime,f.ca,'/api/login','POST',{password:f.config.loginSecret},{origin:f.config.publicOrigin}),cookie=login.headers['set-cookie'][0].split(';')[0];
 const ws=new WebSocket(`wss://127.0.0.1:${runtime.server.address().port}/ws/voice`,{ca:f.ca,headers:{origin:f.config.publicOrigin,cookie}});ws.on('error',()=>{});t.after(()=>ws.terminate());
 const messages=[];ws.on('message',data=>messages.push(JSON.parse(data)));await once(ws,'open');
 const wait=async type=>{for(let n=0;n<200;n++){if(messages.some(message=>message.type===type))return;await delay(5);}assert.fail('missing voice event '+type);};
 ws.send(JSON.stringify({type:'session.start',requestId:'session',context:{executionTarget:'server',projectId:'p',taskId:'t',contextVersion:1}}));await wait('session.ready');
 ws.send(JSON.stringify({type:'capture.start',requestId:'capture',captureId:'cap',contextVersion:1,format:{codec:'pcm_s16le',sampleRate:16000,channels:1,frameMs:20}}));await wait('capture.ready');
 assert.deepEqual(contexts,[{executionTarget:'server',projectId:'p',contextVersion:1,taskId:'t',userId:'owner',deviceId:'server'}]);
 const closed=once(ws,'close');ws.close();await closed;
});

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
 assert.equal((await http(runtime,f.ca,'/api/projects?executionTarget=server','GET',null,headers)).status,503);
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
test('formal voice shares the Agent listener, validates real phone session and fixed Mac context without mutations',async t=>{
 const f=await fixture(t),providers=[],calls=[];let handle;
 const runtime=await startControlRuntime({config:{...f.config,voice:{synthetic:true}},createVoiceProvider:({onEvent,...context})=>{const provider={context,connect:async()=>({input:{codec:'pcm_s16le',sampleRate:16000,channels:1,frameMs:20},output:{codec:'pcm_s16le',sampleRate:16000,channels:1}}),start(){},sendAudio(){onEvent({type:'stt.final',text:'synthetic recognized text'});},stop(){},abort(){},close(){this.closed=true;}};providers.push(provider);return provider;}});
 t.after(()=>runtime.close());
 const pairing=await runtime.gateway.startPairing({userId:'owner'}),paired=await runtime.gateway.completePairing({code:pairing.code,userId:'owner',deviceId:'mac'});
 handle=await runtime.gateway.connect({type:'register',protocolVersion:1,deviceId:'mac',token:paired.token,capabilities:['task_rpc']},{send:frame=>{
  if(frame.type!=='command')return;const {method,params}=frame.command.payload;calls.push(method);
  setImmediate(()=>handle.receive({type:'commandResult',protocolVersion:1,deviceId:'mac',requestId:frame.command.requestId,operationId:frame.command.operationId,status:'succeeded',snapshot:method==='getProject'?{id:params[0],enabled:params[0]==='p'}:method==='getTask'?{id:params[0],projectId:params[0]==='foreign'?'other':'p',deletedAt:params[0]==='deleted'?'now':null}:[]}));
 }});t.after(()=>handle.close().catch(()=>{}));
 const health=(await http(runtime,f.ca,'/api/health')).body;assert.equal(health.voiceAvailable,true);assert.equal(health.voiceState,'configured');assert.equal(health.mcpMutationsEnabled,false);assert.equal(runtime.server.listenerCount('upgrade'),1);
 const login=await http(runtime,f.ca,'/api/login','POST',{password:f.config.loginSecret},{origin:f.config.publicOrigin}),cookie=login.headers['set-cookie'][0].split(';')[0];
 const connect=async(path='/ws/voice',headers={origin:f.config.publicOrigin,cookie})=>{const ws=new WebSocket(`wss://127.0.0.1:${runtime.server.address().port}${path}`,{ca:f.ca,headers});ws.on('error',()=>{});const messages=[];ws.on('message',(data,binary)=>{if(!binary)messages.push(JSON.parse(data));});await once(ws,'open');return {ws,messages,send:message=>ws.send(JSON.stringify(message))};};
 for(const [path,headers,status] of [['/ws/voice',{},403],['/ws/voice',{origin:'https://evil.invalid',cookie},403],['/ws/voice?x=1',{origin:f.config.publicOrigin,cookie},404],['/unknown',{origin:f.config.publicOrigin,cookie},404]]){
  const ws=new WebSocket(`wss://127.0.0.1:${runtime.server.address().port}${path}`,{ca:f.ca,headers});ws.on('error',()=>{});const [,response]=await once(ws,'unexpected-response');assert.equal(response.statusCode,status);response.resume();ws.terminate();
 }
 const until=async check=>{for(let i=0;i<300;i++){if(check())return;await delay(5);}assert.fail('voice event timeout');};
 for(const context of [{projectId:'off',contextVersion:1},{projectId:'p',taskId:'foreign',contextVersion:1},{projectId:'p',parentTaskId:'deleted',contextVersion:1},{projectId:'p',contextVersion:1,deviceId:'other'}]){
  const client=await connect(),closed=once(client.ws,'close');client.send({type:'session.start',requestId:'bad',context});await closed;
 }
 assert.equal(providers.length,0);
 const client=await connect();client.send({type:'session.start',requestId:'session',context:{projectId:'p',taskId:'task',contextVersion:7}});await until(()=>client.messages.some(event=>event.type==='session.ready'));
 const secondLogin=await http(runtime,f.ca,'/api/login','POST',{password:f.config.loginSecret},{origin:f.config.publicOrigin}),secondCookie=secondLogin.headers['set-cookie'][0].split(';')[0];assert.notEqual(secondCookie,cookie);
 const competing=new WebSocket(`wss://127.0.0.1:${runtime.server.address().port}/ws/voice`,{ca:f.ca,headers:{origin:f.config.publicOrigin,cookie:secondCookie}});competing.on('error',()=>{});const [,rejected]=await once(competing,'unexpected-response');assert([403,503].includes(rejected.statusCode));rejected.resume();competing.terminate();
 client.send({type:'capture.start',requestId:'capture',captureId:'cap',contextVersion:7,format:{codec:'pcm_s16le',sampleRate:16000,channels:1,frameMs:20}});await until(()=>client.messages.some(event=>event.type==='capture.ready'));
 assert.equal(providers[0].context.ownerId,'owner');assert.equal(providers.length,1);assert.equal(providers[0].context.context.deviceId,'mac');assert.equal(providers[0].context.context.userId,'owner');assert.equal(providers[0].context.context.taskId,'task');
 client.ws.send(Buffer.alloc(640));await until(()=>client.messages.some(event=>event.type==='stt.final'));
 assert(calls.every(method=>['getProject','getTask'].includes(method)));assert.equal((await runtime.dispatch({jsonrpc:'2.0',id:9,method:'tools/call',params:{name:'codex_start_task',arguments:{}}})).error.code,-32003);
 const closed=once(client.ws,'close');client.ws.close();await closed;
 await handle.close();
});
test('phone HTTPS and MCP share real WSS Agent and private Mac task RPC without a server executor',async t=>{
 const f=await fixture(t),socketPath=join(f.root,'rpc.sock'),tasks=new Map(),calls=[];
 const project={id:'p',name:'Mac fixture project',enabled:true};
 const service={status:async()=>({available:true,version:'mac-fixture-cli'}),listProjects:async()=>[project],getProject:async id=>id==='p'?project:null,listTasks:async()=>[...tasks.values()],getTask:async id=>tasks.get(id),startTask:async input=>{calls.push(input);tasks.set('task',{id:'task',projectId:input.projectId,prompt:input.prompt,status:'draft',revision:1,metadataRevision:1});return {taskId:'task',projectId:input.projectId};},confirmTask:async(id,input)=>{calls.push(input);const task={...tasks.get(id),status:'running',revision:2};tasks.set(id,task);return task;},cancelTask:async(id,input)=>{calls.push(input);const task={...tasks.get(id),status:'cancelled',revision:3};tasks.set(id,task);return task;}};
 const rpc=await createTaskRpcServer({socketPath,adapter:service});t.after(()=>rpc.close());
 const runtime=await startControlRuntime({config:{...f.config,voice:{synthetic:true}},createVoiceProvider:({onEvent})=>({async connect(){return {input:{codec:'pcm_s16le',sampleRate:16000,channels:1,frameMs:20}};},start(){},sendAudio(){onEvent({type:'stt.final',text:'same listener fixture'});},stop(){},close(){}})});t.after(()=>runtime.close());
 const pairing=await runtime.gateway.startPairing({userId:'owner'}),paired=await runtime.gateway.completePairing({code:pairing.code,userId:'owner',deviceId:'mac'});
 class TrustedSocket extends WebSocket{constructor(url,options){super(url,{...options,ca:f.ca});}}
 const capability=createTaskCapability({socketPath}),agent=await createMacAgent({endpoint:`wss://127.0.0.1:${runtime.server.address().port}/agent`,deviceId:'mac',token:paired.token,stateFile:join(f.root,'agent.json'),capabilities:capability.capabilities,onCommand:command=>capability.execute(command),WebSocketImpl:TrustedSocket,heartbeatMs:100,retryMinMs:10,retryMaxMs:10});
 t.after(()=>agent.close());agent.start();
 const deadline=Date.now()+3000;while(!(await runtime.gateway.listDevices({userId:'owner'}))[0].online){assert(Date.now()<deadline);await delay(5);}
 const login=await http(runtime,f.ca,'/api/login','POST',{password:f.config.loginSecret},{origin:f.config.publicOrigin});const headers={origin:f.config.publicOrigin,cookie:login.headers['set-cookie'][0].split(';')[0]};
 const voice=new TrustedSocket(`wss://127.0.0.1:${runtime.server.address().port}/ws/voice`,{headers}),voiceEvents=[];voice.on('error',()=>{});voice.on('message',data=>voiceEvents.push(JSON.parse(data)));await once(voice,'open');
 const waitVoice=async type=>{for(let i=0;i<300;i++){if(voiceEvents.some(event=>event.type===type))return;await delay(5);}assert.fail('voice fixture timed out: '+type);};
 voice.send(JSON.stringify({type:'session.start',requestId:'s',context:{projectId:'p',contextVersion:1}}));await waitVoice('session.ready');
 voice.send(JSON.stringify({type:'capture.start',requestId:'c',captureId:'cap',contextVersion:1,format:{codec:'pcm_s16le',sampleRate:16000,channels:1,frameMs:20}}));await waitVoice('capture.ready');
 voice.send(Buffer.alloc(640));await waitVoice('stt.final');assert.equal(calls.length,0);assert.equal(runtime.server.listenerCount('upgrade'),1);
 const voiceClosed=once(voice,'close');voice.close();await voiceClosed;assert.equal((await runtime.gateway.listDevices({userId:'owner'}))[0].online,true);
 assert.equal((await http(runtime,f.ca,'/api/projects','GET',null,headers)).body.projects[0].id,'p');
 const input={projectId:'p',prompt:'synthetic direct instruction',requestId:'phone-business-id'};
 const submitted=await http(runtime,f.ca,'/api/tasks','POST',input,headers);
 assert.equal(submitted.body.taskId,'task');assert.equal(submitted.body.status,'running');assert.deepEqual(calls[0],input);
 assert.equal(calls[1].revision,1);assert.match(calls[1].requestId,/^[a-f0-9]{64}$/);assert.notEqual(calls[1].requestId,input.requestId);
 await http(runtime,f.ca,'/api/tasks','POST',input,headers);assert.equal(calls.length,2);
 assert.equal((await http(runtime,f.ca,'/api/tasks/task/cancel','POST',{requestId:'cancel-business-id'},headers)).body.status,'cancelled');
 await runtime.refreshState();assert.equal((await http(runtime,f.ca,'/api/health')).body.codexAvailable,true);
 const mcp=await runtime.dispatch({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'codex_status',arguments:{}}});assert.match(mcp.result.content[0].text,/mac-fixture-cli/);
 assert.equal((await http(runtime,f.ca,'/api/tasks?projectId=p','GET',null,headers)).body.tasks[0].status,'cancelled');
 await agent.close();assert.equal((await http(runtime,f.ca,'/api/projects','GET',null,headers)).status,503);
});
