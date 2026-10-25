import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createExecutionTargets,resolveExecutionVoiceContext} from '../execution-targets.mjs';
import {createTaskRpcServer,createTaskRpcClient} from '../task-rpc.mjs';

test('fixed targets route identical project and task IDs to separate private services',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'target-routing-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const clients={};
 for(const id of ['mac','server']){
  const records=new Map([['same-task',{id:'same-task',projectId:'same-project',output:id,status:'completed',revision:3}]]);
  const rpc=await createTaskRpcServer({socketPath:join(root,id+'.sock'),adapter:{
   getProject:async projectId=>projectId==='same-project'?{id:projectId,name:id,enabled:true}:null,
   getTask:async taskId=>records.get(taskId),
   continueTask:async(taskId,opts)=>{const current=records.get(taskId);const next={...current,prompt:opts.prompt,status:'draft',revision:4};records.set(taskId,next);return next;},
  }});t.after(()=>rpc.close());clients[id]={adapter:createTaskRpcClient({socketPath:rpc.address}),deviceId:id+'-executor'};
 }
 const targets=createExecutionTargets(clients);
 const selected=targets.select(new URLSearchParams('executionTarget=server'));
 assert.equal((await selected.projectRegistry.getProject('same-project')).name,'server');
 assert.equal((await selected.adapter.getTask('same-task')).output,'server');
 await selected.adapter.continueTask('same-task',{prompt:'server only',revision:3,requestId:'shared-request'});
 assert.equal((await targets.select(new URLSearchParams()).adapter.getTask('same-task')).status,'completed');
 assert.equal((await targets.getTarget('server').adapter.getTask('same-task')).prompt,'server only');
});

test('target inventory is immediate, safe and independent of RPC readiness',()=>{
 const adapter={getProject(){throw Error('RPC must not run');},getTask(){throw Error('RPC must not run');}};
 const targets=createExecutionTargets({mac:{adapter,readState:()=>({online:true,available:true,observedAt:'2026-10-25T00:00:00.000Z',token:'private',socketPath:'/private/socket'})}});
 assert.deepEqual(targets.listTargets(),[
  {id:'mac',kind:'mac',name:'Mac Codex',configured:true,online:true,available:true,observedAt:'2026-10-25T00:00:00.000Z'},
  {id:'server',kind:'server',name:'Server Codex',configured:false,online:false,available:false,observedAt:null},
 ]);
 assert.throws(()=>targets.select(new URLSearchParams('executionTarget=server')),{code:'target_unavailable'});
 assert.equal(targets.select(new URLSearchParams()).id,'mac');
});

test('unknown, duplicate and malformed selectors reject before target effects',()=>{
 const targets=createExecutionTargets({mac:{adapter:{}} ,server:{adapter:{}}});
 for(const query of ['executionTarget=other','executionTarget=','executionTarget=mac&executionTarget=server','executionTarget=mac&executionTarget=mac','executionTarget=%2Ftmp%2Fsocket','executionTarget=constructor'])assert.throws(()=>targets.select(new URLSearchParams(query)),{code:'invalid_argument'});
 for(const id of [null,'',{},'__proto__','mac/socket'])assert.throws(()=>targets.getTarget(id),{code:'invalid_argument'});
 assert.throws(()=>targets.select({getAll:()=>['mac']}),{code:'invalid_argument'});
 assert.throws(()=>createExecutionTargets({untrusted:{adapter:{}}}),{code:'configuration'});
});

test('readiness failures and untrusted metadata cannot disable another configured target',()=>{
 const targets=createExecutionTargets({mac:{adapter:{},readState:()=>{throw Error('private');}},server:{adapter:{},readState:()=>({online:false,available:true,observedAt:'private-token'})}});
 assert.deepEqual(targets.listTargets().map(({online,available,observedAt})=>({online,available,observedAt})),[{online:false,available:false,observedAt:null},{online:false,available:false,observedAt:null}]);
 assert.equal(targets.select(new URLSearchParams('executionTarget=server')).id,'server');
 const asyncTargets=createExecutionTargets({server:{adapter:{},readState:async()=>({online:true,available:true})}});
 assert.equal(asyncTargets.listTargets()[1].online,false);
});

test('voice membership uses the frozen target and fixed identity with equal IDs across targets',async()=>{
 const project={id:'p',enabled:true};let macReads=0;
 const targets=createExecutionTargets({mac:{deviceId:'paired-mac',adapter:{getProject:async()=>{macReads++;return project;},getTask:async()=>({id:'t',projectId:'p'})}},server:{deviceId:'server-executor',adapter:{getProject:async()=>project,getTask:async()=>({id:'t',projectId:'p'})}}});
 const context={executionTarget:'server',projectId:'p',taskId:'t',contextVersion:7};
 const frozen=await resolveExecutionVoiceContext({targets,context,userId:'owner'});
 assert.deepEqual(frozen,{executionTarget:'server',projectId:'p',contextVersion:7,taskId:'t',userId:'owner',deviceId:'server-executor'});
 context.executionTarget='mac';context.taskId='other';assert.equal(frozen.executionTarget,'server');assert.equal(frozen.taskId,'t');assert.equal(macReads,0);
 assert.equal((await resolveExecutionVoiceContext({targets,context:{projectId:'p',contextVersion:1},userId:'owner'})).executionTarget,'mac');
});

test('voice rejects foreign, hidden, unavailable and injected targets before effects',async()=>{
 let reads=0;
 const targets=createExecutionTargets({mac:{adapter:{getProject:async id=>{reads++;return {id,enabled:true};},getTask:async id=>({id,projectId:id==='foreign'?'other':'p',archived:id==='archived',deletedAt:id==='deleted'?'now':null})}}});
 for(const change of [{executionTarget:'other'},{executionTarget:'server'},{deviceId:'chosen'},{userId:'chosen'},{socketPath:'/tmp/socket'},{taskId:'t',parentTaskId:'other'},{contextVersion:0}])assert.equal(await resolveExecutionVoiceContext({targets,context:{projectId:'p',contextVersion:1,...change},userId:'owner'}),null);
 assert.equal(reads,0);
 for(const taskId of ['foreign','archived','deleted'])assert.equal(await resolveExecutionVoiceContext({targets,context:{projectId:'p',contextVersion:1,taskId},userId:'owner'}),null);
 const down=createExecutionTargets({server:{adapter:{getProject:async()=>{throw Error('private socket');}}}});
 assert.equal(await resolveExecutionVoiceContext({targets:down,context:{executionTarget:'server',projectId:'p',contextVersion:1},userId:'owner'}),null);
});
