import test from 'node:test';
import assert from 'node:assert/strict';
import {createRemoteTaskAdapter} from '../remote-task-adapter.mjs';

test('remote adapter preserves Mac task arguments, business identity and raw results', async () => {
  const sent=[];
  const gateway={async submitCommand(command){sent.push(command);return {status:'accepted',operationId:'op'};},async getOperation(){return {status:'succeeded',snapshot:{id:'t',status:'draft',projectId:'p'}};}};
  const adapter=createRemoteTaskAdapter({gateway,userId:'owner',deviceId:'mac',pollMs:1,timeoutMs:100});
  const result=await adapter.startTask({projectId:'p',prompt:'hello',requestId:'business-1'});
  assert.equal(result.id,'t');
  assert.equal(sent[0].type,'task_rpc');
  assert.deepEqual(sent[0].payload,{method:'startTask',params:[{projectId:'p',prompt:'hello',requestId:'business-1'}]});
  await adapter.startTask({projectId:'p',prompt:'hello',requestId:'business-1'});
  assert.equal(sent[1].requestId,sent[0].requestId);
  assert.equal(sent[0].deviceId,'mac');
  assert.equal(sent[0].userId,'owner');
  assert.equal(Object.hasOwn(sent[0],'taskId'),false);
});
test('offline, failed and unknown outcomes retain safe errors and never resubmit', async () => {
  let sent=0;
  const gateway={async submitCommand(){sent++;return {status:'accepted',operationId:'op'};},async getOperation(){return {status:'unknown',errorCode:'connection_lost'};}};
  const adapter=createRemoteTaskAdapter({gateway,userId:'owner',deviceId:'mac',pollMs:1,timeoutMs:10});
  await assert.rejects(adapter.listProjects(),{code:'task_service_unavailable'});assert.equal(sent,1);
  gateway.getOperation=async()=>({status:'failed',errorCode:'revision_conflict'});
  await assert.rejects(adapter.confirmTask('t',{revision:1,requestId:'r'}),{code:'revision_conflict'});
  gateway.submitCommand=async()=>{throw Object.assign(Error('private state'),{code:'offline'});};
  await assert.rejects(adapter.status(),error=>error.code==='offline'&&!error.message.includes('private state'));
});
test('network facade rejects invalid methods and missing write identities before dispatch',async()=>{
  let sent=0;const adapter=createRemoteTaskAdapter({gateway:{submitCommand(){sent++;}},userId:'owner',deviceId:'mac'});
  assert.equal(adapter.exec,undefined);
  await assert.rejects(adapter.confirmTask('t'),{code:'invalid_argument'});
  await assert.rejects(adapter.startTask({projectId:'p',prompt:'x'}),{code:'invalid_argument'});
  assert.equal(sent,0);
});
test('remote continuation uses a stable business identity and preserves turn history',async()=>{
 const sent=[],turns=[{prompt:'first',output:'result'},{prompt:'fix',status:'draft'}],gateway={async submitCommand(command){sent.push(command);return {status:'succeeded',snapshot:{id:'t',status:'draft',turns}};}};
 const adapter=createRemoteTaskAdapter({gateway,userId:'owner',deviceId:'mac'}),opts={prompt:'fix',revision:3,requestId:'followup'};
 assert.deepEqual((await adapter.continueTask('t',opts)).turns,turns);await adapter.continueTask('t',opts);assert.equal(sent[0].requestId,sent[1].requestId);assert.deepEqual(sent[0].payload,{method:'continueTask',params:['t',opts]});
 await assert.rejects(adapter.continueTask('t',{...opts,resumeSessionId:'other'}),{code:'invalid_argument'});assert.equal(sent.length,2);
});
test('poll failures after acceptance stay unknown and all awaits share one deadline',async()=>{
 const gateway={async submitCommand(){return {status:'accepted',operationId:'op'};},async getOperation(){throw Object.assign(Error('private'),{code:'capacity'});}};
 const adapter=createRemoteTaskAdapter({gateway,userId:'owner',deviceId:'mac',timeoutMs:15,pollMs:1});
 await assert.rejects(adapter.startTask({projectId:'p',prompt:'hello',requestId:'accepted-write'}),error=>error.code==='outcome_unknown'&&error.operationId==='op'&&typeof error.requestId==='string');
 await assert.rejects(adapter.listProjects(),error=>error.code==='task_service_unavailable'&&error.operationId===undefined);
 gateway.submitCommand=async()=>{throw Object.assign(Error('private disk error'),{code:'EIO'});};
 await assert.rejects(adapter.startTask({projectId:'p',prompt:'hello',requestId:'disk-unknown'}),{code:'outcome_unknown'});
 gateway.submitCommand=()=>new Promise(()=>{});
 const before=performance.now();await assert.rejects(adapter.listProjects(),{code:'task_service_unavailable'});assert(performance.now()-before<250);
 gateway.submitCommand=async()=>({status:'accepted',operationId:'op'});gateway.getOperation=()=>new Promise(()=>{});
 await assert.rejects(adapter.listProjects(),{code:'task_service_unavailable'});
 const longPoll=createRemoteTaskAdapter({gateway,userId:'owner',deviceId:'mac',timeoutMs:10,pollMs:10000});
 const start=performance.now();await assert.rejects(longPoll.listProjects(),{code:'task_service_unavailable'});assert(performance.now()-start<250);
});
