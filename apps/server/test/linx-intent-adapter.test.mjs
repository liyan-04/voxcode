import test from 'node:test';
import assert from 'node:assert/strict';
import {createLinxIntentAdapter, mapLinxIntent, intentDefinitions, probeLinxReadiness} from '../linx-intent-adapter.mjs';

const context = {ownerId:'owner-1',deviceId:'mac-1',projectId:'project-1',taskId:'task-1',contextVersion:3};
const instruction = {action:'propose_followup',args:{taskId:'task-1',deltaPrompt:'adjust spacing'}};
const errorCode = code => error => error.code === code;

test('only safe queries, task switching and draft proposals are exposed', () => {
  assert.deepEqual(intentDefinitions.map(x=>x.action),['list_tasks','get_task_snapshot','get_projects','switch_task','propose_task','propose_followup']);
  for(const action of ['execute_task','confirm','cancel_task','delete_task','approve_operation','accept_result']) {
    assert.throws(()=>mapLinxIntent({action,args:{}},context),errorCode('unsupported_intent'));
  }
});

test('safe actions call the injected remote task service with a frozen target', async () => {
  const calls=[];
  const service=Object.fromEntries(['listTasks','getTaskSnapshot','getProjects','switchTask'].map(method=>[method,async (target,args)=>{calls.push({method,target,args});return {ok:true};}]));
  const adapter=createLinxIntentAdapter({remoteTaskService:service});
  for(const [action,args] of [['list_tasks',{}],['get_task_snapshot',{taskId:'task-1'}],['get_projects',{}],['switch_task',{taskId:'task-2'}]]) {
    assert.deepEqual((await adapter.prepare({action,args},context,{requestId:action})).result,{ok:true});
  }
  assert.deepEqual(calls.map(x=>x.method),['listTasks','getTaskSnapshot','getProjects','switchTask']);
  assert.deepEqual(calls[3].target,context);
  assert.deepEqual(calls[3].args,{taskId:'task-2'});
  assert.equal(context.taskId,'task-1');
  assert.ok(Object.isFrozen(calls[0].target));
});

test('owner, device, project, task and context-version spoofing fail before dispatch', async () => {
  let calls=0;
  const adapter=createLinxIntentAdapter({deviceGateway:{listTasks:async()=>calls++}});
  for(const [key,value] of [['ownerId','foreign'],['deviceId','foreign'],['projectId','foreign'],['contextVersion',4]]) {
    await assert.rejects(adapter.prepare({action:'list_tasks',args:{[key]:value}},context,{requestId:key}),errorCode('context_mismatch'));
  }
  assert.throws(()=>mapLinxIntent({action:'get_task_snapshot',args:{taskId:'foreign'}},context),errorCode('context_mismatch'));
  assert.throws(()=>mapLinxIntent(instruction,{...context,taskId:null}),errorCode('context_mismatch'));
  assert.throws(()=>mapLinxIntent({action:'propose_task',args:{prompt:'x',path:'/tmp'}},context),errorCode('invalid_arguments'));
  assert.equal(calls,0);
});

test('development stays a draft and authenticated phone authorization is mandatory', async () => {
  let authorizations=0;
  const denied=createLinxIntentAdapter();
  const draft=await denied.prepare(instruction,context,{requestId:'draft'});
  assert.equal(draft.status,'draft');
  await assert.rejects(denied.confirm({requestId:'draft'},context),errorCode('authorization_required'));
  const adapter=createLinxIntentAdapter({authorizeConfirmation:async ({context:target,draft,authorization})=>{authorizations++;assert.deepEqual(target,context);assert.equal(draft.status,'draft');return authorization?.phoneSession==='authenticated';}});
  await adapter.prepare(instruction,context,{requestId:'draft'});
  await assert.rejects(adapter.confirm({requestId:'draft'},context,{phoneSession:'model-claim'}),errorCode('authorization_required'));
  assert.equal((await adapter.confirm({requestId:'draft'},context,{phoneSession:'authenticated'})).status,'confirmed');
  await assert.rejects(adapter.confirm({requestId:'draft'},context,{phoneSession:'authenticated'}),errorCode('already_confirmed'));
  assert.equal(authorizations,2);
});

test('confirmation cannot change owner, device, task or frozen context version',async()=>{
  const adapter=createLinxIntentAdapter({authorizeConfirmation:async()=>true});
  await adapter.prepare(instruction,context,{requestId:'draft'});
  for(const [key,value] of [['ownerId','other'],['deviceId','other'],['projectId','other'],['taskId','other'],['contextVersion',4]]) {
    await assert.rejects(adapter.confirm({requestId:'draft'},{...context,[key]:value}),errorCode(key==='ownerId'?'not_found':'context_mismatch'));
  }
});

test('request replay is owner scoped, concurrent calls deduplicate and payload changes conflict',async()=>{
  let calls=0;
  const adapter=createLinxIntentAdapter({remoteTaskService:{listTasks:async()=>({calls:++calls})}});
  const [first,replay]=await Promise.all([adapter.prepare({action:'list_tasks'},context,{requestId:'same'}),adapter.prepare({action:'list_tasks'},context,{requestId:'same'})]);
  assert.deepEqual(first,replay);assert.equal(calls,1);
  await assert.rejects(adapter.prepare({action:'get_projects'},context,{requestId:'same'}),errorCode('request_conflict'));
  await adapter.prepare({action:'list_tasks'},{...context,ownerId:'owner-2'},{requestId:'same'});
  assert.equal(calls,2);
});

test('TTL cache is bounded, expires drafts and does not evict pending requests',async()=>{
  let now=1000;
  const adapter=createLinxIntentAdapter({now:()=>now,ttlMs:100,maxEntries:1,authorizeConfirmation:async()=>true});
  await adapter.prepare(instruction,context,{requestId:'one'});
  await assert.rejects(adapter.prepare(instruction,context,{requestId:'two'}),errorCode('cache_full'));
  now=1100;
  await assert.rejects(adapter.confirm({requestId:'one'},context),errorCode('not_found'));
  assert.equal((await adapter.prepare(instruction,context,{requestId:'two'})).status,'draft');
  let release;
  const pendingAdapter=createLinxIntentAdapter({now:()=>now,ttlMs:100,maxEntries:1,deviceGateway:{listTasks:()=>new Promise(resolve=>release=resolve)}});
  const pending=pendingAdapter.prepare({action:'list_tasks'},context,{requestId:'pending'});
  await new Promise(resolve=>setImmediate(resolve));now=1500;
  await assert.rejects(pendingAdapter.prepare(instruction,context,{requestId:'second'}),errorCode('cache_full'));
  release([]);await pending;
});

test('service and authorization errors are sanitized and failed requests are not repeated',async()=>{
  let calls=0;
  const adapter=createLinxIntentAdapter({remoteTaskService:{listTasks:async()=>{calls++;throw Error('PRIVATE_TOKEN');}},authorizeConfirmation:async()=>{throw Error('PRIVATE_TOKEN');}});
  for(let i=0;i<2;i++) await assert.rejects(adapter.prepare({action:'list_tasks'},context,{requestId:'fail'}),error=>error.code==='provider_error'&&!error.message.includes('PRIVATE_TOKEN'));
  assert.equal(calls,1);
  await adapter.prepare(instruction,context,{requestId:'draft'});
  await assert.rejects(adapter.confirm({requestId:'draft'},context),error=>error.code==='authorization_unavailable'&&!error.message.includes('PRIVATE_TOKEN'));
});

test('readiness never implies live success and requires an explicitly injected probe',async()=>{
  assert.deepEqual(await probeLinxReadiness(),{configured:false,readiness:'unavailable',live:false});
  assert.deepEqual(await probeLinxReadiness({configured:true}),{configured:true,readiness:'unverified',live:false});
  assert.deepEqual(await probeLinxReadiness({configured:true,probe:async()=>({ready:true,secret:'PRIVATE'})}),{configured:true,readiness:'ready',live:false});
  assert.deepEqual(await probeLinxReadiness({configured:true,probe:async()=>{throw Error('PRIVATE');}}),{configured:true,readiness:'provider_error',live:false});
});

test('concurrent confirmation authorizes once and cannot outlive the draft TTL',async()=>{
  let now=1000, release;
  const adapter=createLinxIntentAdapter({now:()=>now,ttlMs:100,authorizeConfirmation:()=>new Promise(resolve=>release=resolve)});
  await adapter.prepare(instruction,context,{requestId:'one'});
  const confirming=adapter.confirm({requestId:'one'},context);
  await assert.rejects(adapter.confirm({requestId:'one'},context),errorCode('already_confirmed'));
  now=1100;release(true);
  await assert.rejects(confirming,errorCode('not_found'));
});

test('drafts remain unchanged when callers mutate their input and returned result',async()=>{
  const target={...context}, input={action:'propose_task',args:{prompt:'original',title:'Title'}};
  const adapter=createLinxIntentAdapter({authorizeConfirmation:async()=>true});
  const draft=await adapter.prepare(input,target,{requestId:'one'});
  target.deviceId='other';input.args.prompt='changed';draft.args.prompt='changed';
  const replay=await adapter.prepare({action:'propose_task',args:{title:'Title',prompt:'original'}},context,{requestId:'one'});
  assert.equal(replay.args.prompt,'original');
  assert.equal(replay.context.deviceId,'mac-1');
  assert.equal((await adapter.confirm({requestId:'one'},context)).args.prompt,'original');
});

test('invalid cache configuration and oversized provider responses fail closed',async()=>{
  for(const config of [{ttlMs:0},{ttlMs:3600001},{maxEntries:0},{maxEntries:1025}]) assert.throws(()=>createLinxIntentAdapter(config),errorCode('configuration'));
  const adapter=createLinxIntentAdapter({deviceGateway:{getProjects:async()=> 'x'.repeat(65537)}});
  await assert.rejects(adapter.prepare({action:'get_projects'},context,{requestId:'large'}),errorCode('provider_error'));
});
