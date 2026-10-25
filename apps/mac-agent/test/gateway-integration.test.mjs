import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {existsSync} from 'node:fs';
import {mkdtemp,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createMacAgent} from '../agent.mjs';
import {createTaskCapability} from '../task-capability.mjs';
import {createTaskRpcServer} from '../../server/task-rpc.mjs';

const root=process.env.VOXCODE_GATEWAY_FIXTURE_ROOT??fileURLToPath(new URL('../../../',import.meta.url));
const gatewayFile=join(root,'apps/server/device-gateway.mjs');
async function until(check){const deadline=Date.now()+3000;while(!await check()){if(Date.now()>deadline)assert.fail('gateway fixture deadline');await delay(2);}}
test('actual device gateway accepts client heartbeats and command receipts',{skip:!existsSync(gatewayFile)},async t=>{
 const {createDeviceStore}=await import(pathToFileURL(join(root,'apps/server/device-store.mjs')));
 const {createDeviceGateway}=await import(pathToFileURL(gatewayFile));
 const dir=await realpath(await mkdtemp('/private/tmp/vx-agent-gateway-'));
 const store=await createDeviceStore({root:join(dir,'gateway')});const pairing=await store.startPairing({userId:'user1'});const credential=await store.completePairing({code:pairing.code,userId:'user1',deviceId:'mac1'});const gateway=createDeviceGateway({deviceStore:store});
 const forwarded=[];const socketPath=join(dir,'task.sock');const rpc=await createTaskRpcServer({socketPath,adapter:{startTask:args=>{forwarded.push(args);return {draft:'fixture',businessId:args.requestId};}}});t.after(()=>rpc.close());const taskCapability=createTaskCapability({socketPath});
 const failures=[],received=[],discardedReceipts=new Set();let connections=0,release;
 class GatewaySocket extends EventEmitter{
  constructor(){super();this.readyState=0;connections++;queueMicrotask(()=>{this.readyState=1;this.emit('open');});}
  send(raw){const frame=JSON.parse(raw);received.push(frame);if(frame.type==='register')this.handle=gateway.connect(frame,{send:message=>{if(message.type==='command'&&message.command.requestId==='missing')return;this.emit('message',JSON.stringify(message),false);}});else{if(frame.type==='commandResult'&&frame.requestId==='lost_receipt'&&!discardedReceipts.has(frame.requestId)){discardedReceipts.add(frame.requestId);return;}this.handle.then(handle=>handle.receive(frame)).catch(error=>{failures.push(error.code);this.close();});}}
  close(){if(this.readyState===3)return;this.readyState=3;this.emit('close');this.handle?.then(handle=>handle.close());}
 }
 let calls=0;const agent=await createMacAgent({endpoint:'wss://fixture.invalid',deviceId:'mac1',token:credential.token,stateFile:join(dir,'agent','ledger.json'),capabilities:['task_rpc'],WebSocketImpl:GatewaySocket,heartbeatMs:100,retryMinMs:5,retryMaxMs:5,onCommand:async command=>{calls++;if(command.payload.method==='startTask')return taskCapability.execute(command);if(command.requestId==='running')await new Promise(resolve=>{release=resolve;});return [{id:'p1'}];}});t.after(()=>{release?.();return agent.close();});agent.start();await until(()=>received.filter(x=>x.type==='heartbeat').length>=3);
 assert.deepEqual(failures,[]);assert.equal(connections,1);
 const input={userId:'user1',deviceId:'mac1',requestId:'req1',type:'task_rpc',payload:{method:'listProjects',params:[]}};
 const accepted=await gateway.submitCommand(input);
 await until(async()=>{assert.deepEqual(failures,[]);assert.equal(connections,1,'connection replaced while awaiting command receipt');return(await gateway.getOperation(accepted.operationId,{userId:'user1',deviceId:'mac1'})).status==='succeeded';});
 const outcome=await gateway.getOperation(accepted.operationId,{userId:'user1',deviceId:'mac1'});assert.equal(outcome.status,'succeeded');assert.deepEqual(outcome.snapshot,[{id:'p1'}]);assert.equal(calls,1);
 const businessArgs={projectId:'p1',prompt:'fixture draft',title:'Task title',requestId:'inner_business_id',parentTaskId:null};
 const write=await gateway.submitCommand({...input,requestId:'outer_transport_hash',payload:{method:'startTask',params:[businessArgs]}});await until(async()=>(await gateway.getOperation(write.operationId,{userId:'user1',deviceId:'mac1'})).status==='succeeded');assert.deepEqual(forwarded,[businessArgs]);assert.equal((await gateway.getOperation(write.operationId,{userId:'user1',deviceId:'mac1'})).snapshot.businessId,'inner_business_id');
 const lost=await gateway.submitCommand({...input,requestId:'lost_receipt'});await until(()=>discardedReceipts.has('lost_receipt'));
 await gateway.reconcile({userId:'user1',deviceId:'mac1',operationId:lost.operationId});await until(async()=>(await gateway.getOperation(lost.operationId,{userId:'user1',deviceId:'mac1'})).status==='succeeded');assert.equal(calls,3);
 const running=await gateway.submitCommand({...input,requestId:'running'});await until(()=>release);
 const missing=await gateway.submitCommand({...input,requestId:'missing'});
 for(const operation of [running,missing]){
  await gateway.reconcile({userId:'user1',deviceId:'mac1',operationId:operation.operationId});await until(async()=>(await gateway.getOperation(operation.operationId,{userId:'user1',deviceId:'mac1'})).status==='unknown');
 }
 assert.equal(calls,4);assert.deepEqual(failures,[]);assert.equal(connections,1);release();
});
