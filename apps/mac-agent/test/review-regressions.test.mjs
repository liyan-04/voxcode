import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createMacAgent} from '../agent.mjs';
import {createTaskCapability} from '../task-capability.mjs';
import {startAgent} from '../cli.mjs';
import {createTaskRpcClient,createTaskRpcServer} from '../../server/task-rpc.mjs';

class Socket extends EventEmitter{
 static instances=[];
 constructor(){super();this.readyState=0;this.frames=[];Socket.instances.push(this);queueMicrotask(()=>{this.readyState=1;this.emit('open');});}
 send(raw){const frame=JSON.parse(raw);this.frames.push(frame);if(frame.type==='heartbeat')queueMicrotask(()=>this.receive({type:'heartbeat_ack',protocolVersion:1,deviceId:'mac1',connectionId:'conn1',serverObservedAt:new Date().toISOString()}));}
 receive(frame){this.emit('message',JSON.stringify(frame),false);}
 close(){if(this.readyState===3)return;this.readyState=3;this.emit('close');}
}
const until=async predicate=>{const end=Date.now()+3000;while(!await predicate()){if(Date.now()>end)assert.fail('regression deadline');await delay(2);}};
const receipt=socket=>socket.frames.findLast(frame=>frame.type==='commandResult');
const envelope=(params)=>({protocolVersion:1,deviceId:'mac1',requestId:'outer_transport_hash',operationId:'operation1',type:'task_rpc',payload:{method:'startTask',params:[params]},issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30000).toISOString()});
const business={projectId:'project1',prompt:'fixture draft',title:'Title',requestId:'inner_business_id',parentTaskId:null};
async function agentFixture(t,onCommand){
 const dir=await fs.realpath(await fs.mkdtemp('/private/tmp/vx-agent-review-'));
 const stateFile=join(dir,'ledger.json');const agent=await createMacAgent({endpoint:'wss://fixture.invalid',deviceId:'mac1',token:'synthetic',stateFile,capabilities:['task_rpc'],WebSocketImpl:Socket,heartbeatMs:1000,onCommand});t.after(()=>agent.close());agent.start();await until(()=>Socket.instances.at(-1)?.frames.length);const socket=Socket.instances.at(-1);socket.receive({type:'connected',protocolVersion:1,deviceId:'mac1',connectionId:'conn1'});return {dir,stateFile,agent,socket};
}
async function request(socket,frame){const previous=socket.frames.filter(value=>value.type==='commandResult').length;socket.receive(frame);await until(()=>socket.frames.filter(value=>value.type==='commandResult').length>previous);return receipt(socket);}

test('review: original business parameters survive Agent and real private RPC unchanged',async t=>{
 const dir=await fs.realpath(await fs.mkdtemp('/private/tmp/vx-agent-business-')),socketPath=join(dir,'task.sock');const received=[];
 const rpc=await createTaskRpcServer({socketPath,adapter:{startTask:args=>{received.push(args);return {business:args.requestId};}}});t.after(()=>rpc.close());const capability=createTaskCapability({socketPath});const f=await agentFixture(t,command=>capability.execute(command));const command=envelope(business);
 const result=await request(f.socket,{type:'command',command});assert.equal(result.status,'succeeded');assert.deepEqual(received,[business]);assert.deepEqual(command.payload.params,[business]);assert.equal(result.requestId,'outer_transport_hash');assert.equal(result.snapshot.business,'inner_business_id');
 await request(f.socket,{type:'command',command});assert.equal(received.length,1);
});
test('review: ambiguous RPC error codes remain unknown, reserved and non-reexecuting',async t=>{
 for(const code of ['outcome_unknown','deadline_exceeded','unavailable','response_too_large','invalid_response']){
  let calls=0;const f=await agentFixture(t,async()=>{calls++;throw Object.assign(Error('PRIVATE_DIAGNOSTIC'),{code});});const command=envelope(business);
  const first=await request(f.socket,{type:'command',command});assert.equal(first.status,'unknown');assert.equal(first.errorCode,code);assert.equal(JSON.stringify(first).includes('PRIVATE_DIAGNOSTIC'),false);
  assert.equal((await request(f.socket,{type:'command',command})).status,'unknown');assert.equal((await request(f.socket,{type:'reconcile',protocolVersion:1,deviceId:'mac1',requestId:command.requestId,operationId:command.operationId})).status,'unknown');assert.equal(calls,1);
  assert.equal(JSON.parse(await fs.readFile(f.stateFile,'utf8')).entries[command.requestId].state,'unknown');await f.agent.close();
 }
});
test('review: real TaskService timeout may commit after Agent reports unknown',async t=>{
 const dir=await fs.realpath(await fs.mkdtemp('/private/tmp/vx-agent-late-')),socketPath=join(dir,'task.sock');let committed=0;
 const rpc=await createTaskRpcServer({socketPath,timeoutMs:10,adapter:{startTask:async()=>{await delay(50);committed++;return {id:'committed'};}}});t.after(()=>rpc.close());const capability=createTaskCapability({client:createTaskRpcClient({socketPath,timeoutMs:100})});const f=await agentFixture(t,command=>capability.execute(command));const command=envelope(business);
 assert.equal((await request(f.socket,{type:'command',command})).status,'unknown');await until(()=>committed===1);await request(f.socket,{type:'command',command});assert.equal(committed,1);
});
test('review: successful but oversized or unencodable results remain unknown',async t=>{
 for(const value of ['x'.repeat(1024*1024+1),{value:1n}]){
  let calls=0;const f=await agentFixture(t,async()=>{calls++;return value;});const command=envelope(business);assert.equal((await request(f.socket,{type:'command',command})).status,'unknown');await request(f.socket,{type:'command',command});assert.equal(calls,1);await f.agent.close();
 }
});
test('review: TaskService may commit before its oversized reply is rejected',async t=>{
 const dir=await fs.realpath(await fs.mkdtemp('/private/tmp/vx-agent-large-')),socketPath=join(dir,'task.sock');let committed=0;
 const rpc=await createTaskRpcServer({socketPath,adapter:{startTask:()=>{committed++;return {padding:'x'.repeat(1024*1024)};}}});t.after(()=>rpc.close());const capability=createTaskCapability({socketPath});const f=await agentFixture(t,command=>capability.execute(command));const command=envelope(business);
 const result=await request(f.socket,{type:'command',command});assert.equal(result.status,'unknown');assert.equal(result.errorCode,'response_too_large');await request(f.socket,{type:'command',command});assert.equal(committed,1);
});
test('review: private config and ledger reject a writable ancestor before reading Keychain',async()=>{
 const dir=await fs.realpath(await fs.mkdtemp('/private/tmp/vx-agent-trust-')),untrusted=join(dir,'untrusted'),privateDir=join(untrusted,'private');await fs.mkdir(privateDir,{recursive:true,mode:0o700});await fs.chmod(untrusted,0o777);const configPath=join(privateDir,'agent.json');await fs.writeFile(configPath,JSON.stringify({endpoint:'wss://fixture.invalid',deviceId:'mac1',stateFile:join(privateDir,'ledger.json'),keychainService:'fixture',keychainAccount:'fixture'}),{mode:0o600});let reads=0;
 await assert.rejects(()=>startAgent({args:['--config',configPath,'--task-socket',join(privateDir,'task.sock')],env:{},run:async()=>{reads++;return {stdout:'synthetic'};},WebSocketImpl:Socket,createAgent:async()=>({start(){},close(){}})}),/trusted|private|ancestor/i);assert.equal(reads,0);
 await assert.rejects(async()=>{const agent=await createMacAgent({endpoint:'wss://fixture.invalid',deviceId:'mac1',token:'synthetic',stateFile:join(privateDir,'ledger.json'),WebSocketImpl:Socket});await agent.close();},/trusted|private|ancestor/i);
});
test('review: config replacement after fstat cannot change the checked descriptor content',async()=>{
 const dir=await fs.realpath(await fs.mkdtemp('/private/tmp/vx-agent-fd-')),configPath=join(dir,'agent.json');const original={endpoint:'wss://original.invalid',deviceId:'mac1',stateFile:join(dir,'ledger.json'),keychainService:'original',keychainAccount:'account'};await fs.writeFile(configPath,JSON.stringify(original),{mode:0o600});let fdReads=0,passed;
 const fileSystem={...fs,async open(path,flags){assert.ok(flags&constants.O_NOFOLLOW);const file=await fs.open(path,flags);return {async stat(){const info=await file.stat();await fs.rename(configPath,`${configPath}.previous`);await fs.writeFile(configPath,JSON.stringify({...original,endpoint:'wss://replacement.invalid',keychainService:'replacement'}),{mode:0o600});return info;},async readFile(...args){fdReads++;return file.readFile(...args);},close(){return file.close();}};},readFile(){assert.fail('must not reopen path');}};
 await startAgent({args:['--config',configPath,'--task-socket',join(dir,'task.sock')],env:{},fileSystem,run:async(_file,args)=>{assert.equal(args[2],'original');return {stdout:'synthetic'};},WebSocketImpl:Socket,createAgent:async options=>{passed=options;return {start(){},close(){}};}});assert.equal(fdReads,1);assert.equal(passed.endpoint,'wss://original.invalid/');
});
