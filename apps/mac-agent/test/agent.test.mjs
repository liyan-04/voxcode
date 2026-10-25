import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, stat,realpath,writeFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createMacAgent} from '../agent.mjs';
import {createLocalCapabilities} from '../local-capabilities.mjs';
import {createTaskCapability} from '../task-capability.mjs';

class Socket extends EventEmitter {
 static instances=[];
 constructor(){super();this.readyState=0;this.sent=[];Socket.instances.push(this);queueMicrotask(()=>{this.readyState=1;this.emit('open');});}
 send(raw){const value=JSON.parse(raw);this.sent.push(value);if(value.type==='heartbeat')queueMicrotask(()=>this.receive({type:'heartbeat_ack',protocolVersion:1,deviceId:value.deviceId,connectionId:this.connectionId,serverObservedAt:new Date().toISOString()}));}
 receive(frame){if(frame.type==='connected')this.connectionId=frame.connectionId;this.emit('message',JSON.stringify(frame),false);}
 close(){this.readyState=3;this.emit('close');}
 terminate(){this.close();}
}
const command=(overrides={})=>({protocolVersion:1,requestId:'r1',operationId:'o1',deviceId:'mac1',type:'switch_task',projectId:'p1',taskId:'t1',expectedRevision:1,payload:{},issuedAt:new Date(Date.now()-100).toISOString(),expiresAt:new Date(Date.now()+30000).toISOString(),...overrides});
async function fixture(t,extra={}){
 const dir=await realpath(await mkdtemp(join(tmpdir(),'voxcode-agent-')));
 const agent=await createMacAgent({endpoint:'wss://fixture.invalid/agent',deviceId:'mac1',token:'synthetic-token',capabilities:['switch_task'],stateFile:join(dir,'ledger.json'),WebSocketImpl:Socket,heartbeatMs:10,retryMinMs:5,retryMaxMs:5,...extra});
 t.after(()=>agent.close());agent.start();await delay(5);const ws=Socket.instances.at(-1);return {agent,ws,dir,connect(){ws.receive({type:'connected',protocolVersion:1,deviceId:'mac1',connectionId:'conn1'});}};
}
const result=ws=>ws.sent.findLast(x=>x.type==='commandResult');
async function until(check){const deadline=Date.now()+2000;while(!check()){if(Date.now()>deadline)assert.fail('fixture deadline');await delay(2);}}
async function request(ws,c){const count=ws.sent.filter(x=>x.type==='commandResult').length;ws.receive({type:'command',command:c});await until(()=>ws.sent.filter(x=>x.type==='commandResult').length>count);return result(ws);}
test('register uses gateway protocol and commands require connected handshake',async t=>{
 let calls=0;const f=await fixture(t,{onCommand:async()=>{calls++;return {revision:1};}});
 assert.deepEqual(f.ws.sent[0],{type:'register',protocolVersion:1,deviceId:'mac1',token:'synthetic-token',capabilities:['switch_task']});
 f.ws.receive({type:'command',command:command()});await delay(5);assert.equal(calls,0);assert.equal(f.ws.readyState,3);
});
test('serializes execution, persists replay and rejects changed request and stale revision',async t=>{
 let active=0,max=0,calls=0;const f=await fixture(t,{onCommand:async()=>{max=Math.max(max,++active);calls++;await delay(5);active--;return {revision:calls};}});f.connect();
 const c=command();f.ws.receive({type:'command',command:c});f.ws.receive({type:'command',command:c});await until(()=>f.ws.sent.filter(x=>x.type==='commandResult').length===2);
 assert.equal(calls,1);assert.equal(result(f.ws).status,'succeeded');assert.equal(result(f.ws).requestId,'r1');
 assert.equal((await request(f.ws,{...c,payload:{focus:true}})).errorCode,'request_conflict');
 assert.equal((await request(f.ws,command({requestId:'r2',operationId:'o2',expectedRevision:1}))).errorCode,'revision_conflict');
 await request(f.ws,command({requestId:'r3',operationId:'o3',expectedRevision:2}));assert.equal(calls,2);assert.equal(max,1);
 const saved=JSON.parse(await readFile(join(f.dir,'ledger.json'),'utf8'));assert.equal(saved.revision,3);assert.equal((await stat(join(f.dir,'ledger.json'))).mode&0o777,0o600);assert.equal(JSON.stringify(saved).includes('synthetic-token'),false);
});
test('restart keeps completed replay and rejects inflight as unknown',async t=>{
 let release;const c=command();const f=await fixture(t,{onCommand:()=>new Promise(r=>{release=r;})});f.connect();f.ws.receive({type:'command',command:c});await until(()=>release);await f.agent.close();
 const again=await fixture(t,{stateFile:join(f.dir,'ledger.json'),onCommand:async()=>assert.fail('must not reexecute')});again.connect();assert.equal((await request(again.ws,c)).errorCode,'operation_unknown');release({revision:1});
});
test('rejects device, TTL, capability, default handler and operation reuse',async t=>{
 const f=await fixture(t);f.connect();
 for(const [patch,code] of [[{deviceId:'foreign'},'device_mismatch'],[{expiresAt:new Date(Date.now()-1).toISOString()},'command_expired'],[{type:'focus_window'},'capability_denied']])assert.equal((await request(f.ws,command(patch))).errorCode,code);
 assert.equal((await request(f.ws,command())).errorCode,'capability_unavailable');
 assert.equal((await request(f.ws,command({requestId:'r2'}))).errorCode,'operation_conflict');
});
test('task RPC calls only fixed client methods and preserves business request ID',async()=>{
 const calls=[];const adapter=createTaskCapability({client:{status:async()=>({ready:true}),startTask:async args=>{calls.push(args);return {id:'t1'};}}});
 assert.deepEqual(await adapter.execute(command({type:'task_rpc',payload:{method:'status',params:[]}})),{ready:true});
 assert.deepEqual(await adapter.execute(command({type:'task_rpc',payload:{method:'startTask',params:[{projectId:'p1',prompt:'test',requestId:'r1'}]}})),{id:'t1'});assert.equal(calls[0].requestId,'r1');
 await assert.rejects(()=>adapter.execute(command({type:'task_rpc',payload:{method:'exec',params:['rm']}})),/task_rpc_denied/);
 assert.deepEqual(await adapter.execute(command({type:'task_rpc',payload:{method:'startTask',params:[{projectId:'p1',prompt:'test',requestId:'other'}]}})),{id:'t1'});assert.equal(calls[1].requestId,'other');
});
test('reconnect generations ignore messages and close from old socket',async t=>{
 let calls=0;const f=await fixture(t,{onCommand:async()=>{calls++;return {revision:1};}});f.connect();const old=f.ws;old.close();await delay(15);const next=Socket.instances.at(-1);next.receive({type:'connected',protocolVersion:1,deviceId:'mac1',connectionId:'conn2'});old.receive({type:'command',command:command()});old.emit('close');await delay(5);assert.equal(calls,0);assert.equal(next.readyState,1);await delay(10);assert.ok(next.sent.some(x=>x.type==='heartbeat'));
});
test('local capabilities only use registered project/application and fixed arguments',async()=>{
 const calls=[];const local=createLocalCapabilities({projects:[{id:'p1',path:'/tmp/authorized project',applicationId:'com.example.Editor'}],applications:[{id:'com.example.Editor'}],run:async(file,args)=>{calls.push({file,args});return {stdout:''};}});
 await local.execute(command({type:'open_project'}));assert.deepEqual(calls[0],{file:'/usr/bin/open',args:['-b','com.example.Editor','/tmp/authorized project']});
 await assert.rejects(()=>local.execute(command({type:'open_project',projectId:'unknown',payload:{path:'/etc'}})),/project_denied/);
 await assert.rejects(()=>local.execute(command({type:'focus_window',payload:{appId:'other'}})),/application_denied/);
 await assert.rejects(()=>local.execute(command({type:'focus_window',payload:{script:'do shell script'}})),/payload_denied/);
});
test('reconcile replays completed receipt and reports unknown without dispatch',async t=>{
 let calls=0,release;const f=await fixture(t,{onCommand:async c=>{calls++;if(c.requestId==='running')await new Promise(r=>{release=r;});return {done:true};}});f.connect();
 const completed=await request(f.ws,command());
 const reconcile={type:'reconcile',protocolVersion:1,deviceId:'mac1',requestId:'r1',operationId:'o1'};
 const count=f.ws.sent.length;f.ws.receive(reconcile);await until(()=>f.ws.sent.length>count);assert.deepEqual(result(f.ws),completed);
 f.ws.receive({type:'command',command:command({requestId:'running',operationId:'runningop',expectedRevision:2})});await until(()=>release);
 for(const [requestId,operationId] of [['running','runningop'],['missing','missingop'],['r1','foreignop']]){
  const before=f.ws.sent.filter(x=>x.type==='commandResult').length;f.ws.receive({...reconcile,requestId,operationId});await until(()=>f.ws.sent.filter(x=>x.type==='commandResult').length>before);assert.equal(result(f.ws).status,'unknown');assert.equal(result(f.ws).errorCode,'operation_unknown');
 }
 assert.equal(calls,2);release();
});
test('open_project accepts current shared envelope without task or revision',async t=>{
 let calls=0;const f=await fixture(t,{capabilities:['open_project'],onCommand:async()=>{calls++;return {projectId:'p1'};}});f.connect();
 const c=command({type:'open_project'});delete c.taskId;delete c.expectedRevision;
 assert.equal((await request(f.ws,c)).status,'succeeded');assert.equal(calls,1);
});
test('ledger lock rejects concurrent and stale instances, close releases ownership',async t=>{
 const f=await fixture(t);const options={endpoint:'wss://fixture.invalid',deviceId:'mac1',token:'token',stateFile:join(f.dir,'ledger.json'),WebSocketImpl:Socket};
 await assert.rejects(()=>createMacAgent(options),/ledger lock/);
 const child=await promisify(execFile)(process.execPath,['--input-type=module','-e',`import {createMacAgent} from ${JSON.stringify(new URL('../agent.mjs',import.meta.url).href)};try{await createMacAgent(${JSON.stringify({...options,WebSocketImpl:undefined})});process.exit(1);}catch(error){process.exit(/ledger lock/.test(error.message)?0:2);}`]);assert.equal(child.stderr,'');
 await f.agent.close();const next=await createMacAgent(options);await next.close();
 await writeFile(`${options.stateFile}.lock`,JSON.stringify({pid:2147483647}),{mode:0o600});
 await assert.rejects(()=>createMacAgent(options),/ledger lock/);
});
test('replaced kernel guard fails closed before dispatching or writing a command receipt',async t=>{
 let calls=0,stateError=false;const f=await fixture(t,{onCommand:async()=>{calls++;return {};},onStatus:value=>{if(value==='state_error')stateError=true;}});f.connect();
 const guard=join(f.dir,'ledger.json.lock.guard');await unlink(guard);await writeFile(guard,'',{mode:0o600});
 f.ws.receive({type:'command',command:command()});await until(()=>stateError);assert.equal(calls,0);assert.equal(f.ws.readyState,3);assert.deepEqual(JSON.parse(await readFile(join(f.dir,'ledger.json'),'utf8')).entries,{});
});
test('heartbeat acknowledgments require current device and connection identity',async t=>{
 for(const patch of [{deviceId:'other'},{connectionId:'old'},{protocolVersion:2}]){
  const f=await fixture(t);f.connect();f.ws.receive({type:'heartbeat_ack',protocolVersion:1,deviceId:'mac1',connectionId:'conn1',serverObservedAt:new Date().toISOString(),...patch});assert.equal(f.ws.readyState,3);await f.agent.close();
 }
});
function rpcCommand(timestamp,requestId,method='status'){
 return {protocolVersion:1,requestId,operationId:`op_${requestId}`,deviceId:'mac1',type:'task_rpc',payload:{method,params:method==='status'?[]:[{projectId:'p1',prompt:'fixture',requestId}]},issuedAt:new Date(timestamp).toISOString(),expiresAt:new Date(timestamp+200).toISOString()};
}
test('expired readonly receipts free a small ledger using the injected clock',async t=>{
 let timestamp=1000,calls=0;const f=await fixture(t,{maxEntries:1,clock:()=>timestamp,capabilities:['task_rpc'],onCommand:async()=>({calls:++calls})});f.connect();
 const first=rpcCommand(timestamp,'read1');assert.equal((await request(f.ws,first)).status,'succeeded');
 assert.equal((await request(f.ws,rpcCommand(timestamp,'read2'))).errorCode,'ledger_full');
 timestamp=1200;assert.equal((await request(f.ws,rpcCommand(timestamp,'read2'))).status,'succeeded');assert.equal(calls,2);
 const stored=JSON.parse(await readFile(join(f.dir,'ledger.json'),'utf8'));assert.deepEqual(Object.keys(stored.entries),['read2']);assert.equal(stored.entries.read2.readOnly,true);assert.equal(stored.entries.read2.expiresAt,1400);
});
test('real clock expiry removes readonly receipts without evicting mutation receipts',async t=>{
 const f=await fixture(t,{maxEntries:1,capabilities:['task_rpc'],onCommand:async()=>({ok:true})});f.connect();
 const first=rpcCommand(Date.now(),'read1');assert.equal((await request(f.ws,first)).status,'succeeded');await until(()=>Date.now()>=Date.parse(first.expiresAt));
 assert.equal((await request(f.ws,rpcCommand(Date.now(),'write1','startTask'))).status,'succeeded');const write=JSON.parse(await readFile(join(f.dir,'ledger.json'),'utf8')).entries.write1;
 await until(()=>Date.now()>=write.expiresAt);assert.equal((await request(f.ws,rpcCommand(Date.now(),'read2'))).errorCode,'ledger_full');
 const saved=JSON.parse(await readFile(join(f.dir,'ledger.json'),'utf8'));assert.deepEqual(Object.keys(saved.entries),['write1']);assert.equal(saved.entries.write1.readOnly,false);
});
test('expired unknown reads can be pruned after restart but unknown writes stay reserved',async t=>{
 for(const method of ['status','startTask']){
  let timestamp=1000,release;const c=rpcCommand(timestamp,`req_${method}`,method);
  const f=await fixture(t,{maxEntries:1,clock:()=>timestamp,capabilities:['task_rpc'],onCommand:()=>new Promise(resolve=>{release=resolve;})});f.connect();f.ws.receive({type:'command',command:c});await until(()=>release);await f.agent.close();
  timestamp=1200;const next=await fixture(t,{stateFile:join(f.dir,'ledger.json'),maxEntries:1,clock:()=>timestamp,capabilities:['task_rpc'],onCommand:async()=>({ready:true})});next.connect();
  const receipt=await request(next.ws,rpcCommand(timestamp,`next_${method}`));assert.equal(method==='status'?receipt.status:receipt.errorCode,method==='status'?'succeeded':'ledger_full');
  if(method==='startTask'){const saved=JSON.parse(await readFile(join(f.dir,'ledger.json'),'utf8'));assert.equal(saved.entries.req_startTask.state,'unknown');}
  release({ready:true});
 }
});
