import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskSubmission} from '../task-submission.mjs';
import {createHttpServer} from '../http-server.mjs';
import {once} from 'node:events';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTaskRpcServer,createTaskRpcClient} from '../task-rpc.mjs';

function fixture(){
 const calls=[],receipts=new Map();let task;
 const adapter={
  async startTask(input){calls.push(['start',structuredClone(input)]);if(!task)task={id:'task-1',projectId:input.projectId,status:'draft',revision:1,requestId:input.requestId,turns:[{kind:'initial',prompt:input.prompt}]};return {taskId:task.id};},
  async getTask(){return structuredClone(task);},
  async continueTask(id,input){calls.push(['continue',id,structuredClone(input)]);const key='continue:'+input.requestId;if(receipts.has(key))return structuredClone(receipts.get(key));if(input.revision!==task.revision)throw Object.assign(Error('stale'),{code:'revision_conflict'});task={...task,status:'draft',revision:task.revision+1,turns:[...task.turns,{kind:'continuation',prompt:input.prompt}]};receipts.set(key,structuredClone(task));return structuredClone(task);},
  async confirmTask(id,input){calls.push(['execute',id,structuredClone(input)]);const key='confirm:'+input.requestId;if(receipts.has(key)){assert.equal(receipts.get(key).revision,input.revision);return;}if(input.revision!==task.revision)throw Object.assign(Error('stale'),{code:'revision_conflict'});receipts.set(key,structuredClone(input));task={...task,status:'running',revision:task.revision+1};},
 };
 return {adapter,calls,submission:createTaskSubmission({adapter}),get task(){return task;},set task(value){task=value;}};
}
const input={projectId:'project-1',prompt:'Make the requested change',requestId:'request-1'};

test('invalid submission fields cannot reach the task adapter',async()=>{
 const f=fixture();
 assert.throws(()=>createTaskSubmission(),{code:'configuration'});
 assert.throws(()=>createTaskSubmission({adapter:f.adapter,executionTarget:'bad target'}),{code:'configuration'});
 for(const value of [null,[],{...input,sessionId:'chosen'},{...input,projectId:''},{...input,requestId:''},{...input,prompt:' '},{...input,prompt:'x'.repeat(20001)},{...input,title:42},{...input,title:'x'.repeat(201)},{...input,parentTaskId:'bad parent'}])await assert.rejects(f.submission.start(value),{code:'invalid_argument'});
 for(const [id,value] of [['',{...input,revision:1}],['task-1',{...input,revision:0}],['task-1',{...input,revision:1.5}]])await assert.rejects(f.submission.continue(id,value),{code:'invalid_argument'});
 assert.deepEqual(f.calls,[]);
});
test('missing task identities and changed ownership cannot execute or expose a foreign result',async()=>{
 const missing=fixture();missing.adapter.startTask=async()=>({});await assert.rejects(missing.submission.start(input),{code:'outcome_unknown'});assert.deepEqual(missing.calls,[]);
 const foreign=fixture();foreign.adapter.getTask=async()=>({id:'task-1',projectId:'other'});await assert.rejects(foreign.submission.start(input),{code:'project_unavailable'});assert.equal(foreign.calls.filter(call=>call[0]==='execute').length,0);
 const changed=fixture(),get=changed.adapter.getTask;let reads=0;changed.adapter.getTask=async()=>++reads===2?{id:'task-1',projectId:'other'}:get();await assert.rejects(changed.submission.start(input),{code:'outcome_unknown'});
});

test('a new submission starts the task without a separate user confirmation',async()=>{
 const f=fixture(),result=await f.submission.start(input);
 assert.equal(result.taskId,'task-1');assert.equal(result.status,'running');assert.equal(f.calls.filter(x=>x[0]==='execute').length,1);assert.equal(f.calls.at(-1)[2].revision,1);
 assert.notEqual(f.calls.at(-1)[2].requestId,input.requestId);
});
test('new-task retry keeps its original execution identity and never executes a later turn',async()=>{
 const f=fixture();await f.submission.start(input);const original=f.calls.at(-1)[2];
 f.task={...f.task,status:'draft',revision:5,turns:[...f.task.turns,{kind:'continuation',prompt:'Later turn'}]};
 const result=await f.submission.start(input);assert.equal(result.status,'draft');assert.equal(result.revision,5);assert.deepEqual(f.calls.at(-1)[2],original);
});
test('a follow-up submits and executes precisely the requested next turn',async()=>{
 const f=fixture();await f.submission.start(input);f.task={...f.task,status:'completed',revision:3};
 const request={projectId:'project-1',prompt:'Now refine it',revision:3,requestId:'followup-1'};
 const result=await f.submission.continue('task-1',request);
 assert.equal(result.id,'task-1');assert.equal(result.status,'running');assert.equal(result.turns.length,2);assert.equal(f.calls.at(-1)[2].revision,4);
 const execution=f.calls.at(-1)[2];f.task={...f.task,status:'draft',revision:8};await f.submission.continue('task-1',request);assert.deepEqual(f.calls.at(-1)[2],execution);assert.equal(f.task.revision,8);
});
test('continuation cannot select another project or inject a session identity',async()=>{
 const f=fixture();await f.submission.start(input);const count=f.calls.length;
 await assert.rejects(f.submission.continue('task-1',{projectId:'other',prompt:'No',revision:2,requestId:'wrong'}),{code:'project_unavailable'});
 await assert.rejects(f.submission.continue('task-1',{projectId:'project-1',prompt:'No',revision:2,requestId:'wrong',sessionId:'chosen'}),{code:'invalid_argument'});
 assert.equal(f.calls.length,count);
});
test('a busy execution returns the created identity and exact submission for safe retry',async()=>{
 const f=fixture(),confirm=f.adapter.confirmTask;let busy=true;
 f.adapter.confirmTask=async(...args)=>{if(busy)throw Object.assign(Error('busy'),{code:'busy'});return confirm(...args);};
 await assert.rejects(f.submission.start(input),e=>e.code==='busy'&&e.taskId==='task-1'&&e.submissionRequestId===input.requestId);
 busy=false;assert.equal((await f.submission.start(input)).status,'running');assert.equal(f.task.id,'task-1');
});
test('unavailable result after execution stays an unknown outcome with a reusable identity',async()=>{
 const f=fixture(),get=f.adapter.getTask;let reads=0;
 f.adapter.getTask=async()=>{if(++reads===2)throw Object.assign(Error('unavailable'),{code:'unavailable'});return get();};
 await assert.rejects(f.submission.start(input),e=>e.code==='outcome_unknown'&&e.taskId==='task-1'&&e.submissionRequestId===input.requestId);
 const execution=f.calls.at(-1)[2];await f.submission.start(input);assert.deepEqual(f.calls.at(-1)[2],execution);
});
test('separate execution targets have distinct stable execution request identities',async()=>{
 const left=fixture(),right=fixture();right.submission=createTaskSubmission({adapter:right.adapter,executionTarget:'server'});
 await left.submission.start(input);await right.submission.start(input);assert.notEqual(left.calls.at(-1)[2].requestId,right.calls.at(-1)[2].requestId);
});
test('continuation rejects an overflowing revision before any mutation',async()=>{
 const f=fixture();await f.submission.start(input);const count=f.calls.length;
 await assert.rejects(f.submission.continue('task-1',{...input,revision:Number.MAX_SAFE_INTEGER}),{code:'invalid_argument'});
 assert.equal(f.calls.length,count);
});
test('HTTP execution failure exposes only bounded recovery identities',async t=>{
 const f=fixture(),origin='https://vox.example';
 f.adapter.confirmTask=async()=>{throw Object.assign(Error('private executor details'),{code:'busy'});};
 const app=createHttpServer({adapter:f.adapter,directSubmissions:true,legacyProjectId:'project-1',publicOrigin:origin,loginSecret:'a-long-login-password'});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.server.close());const base=`http://127.0.0.1:${app.server.address().port}`;
 const login=await fetch(base+'/api/login',{method:'POST',headers:{origin},body:JSON.stringify({password:'a-long-login-password'})});
 const response=await fetch(base+'/api/tasks',{method:'POST',headers:{origin,cookie:login.headers.get('set-cookie').split(';')[0]},body:JSON.stringify(input)});
 assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'request failed',code:'busy',taskId:'task-1',submissionRequestId:'request-1'});
});
test('authenticated direct HTTP submissions execute while authentication itself needs no Mac call',async t=>{
 const f=fixture(),origin='https://vox.example',app=createHttpServer({adapter:f.adapter,directSubmissions:true,legacyProjectId:'project-1',publicOrigin:origin,loginSecret:'a-long-login-password'});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.server.close());const base=`http://127.0.0.1:${app.server.address().port}`;
 const login=await fetch(base+'/api/login',{method:'POST',headers:{origin},body:JSON.stringify({password:'a-long-login-password'})});assert.equal(login.status,200);assert.equal(f.calls.length,0);
 const headers={origin,cookie:login.headers.get('set-cookie').split(';')[0]},post=(path,data)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(data)});
 let response=await post('/api/tasks',input);assert.equal(response.status,201);assert.equal((await response.json()).status,'running');
 f.task={...f.task,status:'completed',revision:3};response=await post('/api/tasks/task-1/continue',{projectId:'project-1',prompt:'Follow up',revision:3,requestId:'http-followup'});
 assert.equal(response.status,200);const continued=await response.json();assert.equal(continued.status,'running');assert.equal(continued.turns.length,2);
 const count=f.calls.length;response=await post('/api/tasks/task-1/continue',{projectId:'other',prompt:'No',revision:3,requestId:'cross-project'});assert.equal(response.status,404);assert.equal(f.calls.length,count);
});

for(const stage of ['startTask','continueTask','confirmTask'])test(`HTTP preserves submission identity when ${stage} commits before the real RPC response deadline`,async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'submission-lost-')));t.after(()=>rm(root,{recursive:true,force:true}));
 let task=stage==='continueTask'?{id:'task',projectId:'project-1',status:'completed',revision:3}:null,release,delayed=false;
 const counts={startTask:0,continueTask:0,confirmTask:0},commits={startTask:0,continueTask:0,confirmTask:0},receipts=new Map();
 const result=async(method,key,apply)=>{
  counts[method]++;if(receipts.has(key))return structuredClone(receipts.get(key));
  const value=apply();commits[method]++;receipts.set(key,structuredClone(value));
  if(method===stage&&!delayed){delayed=true;await new Promise(resolve=>release=resolve);}
  return structuredClone(value);
 };
 const service={
  getTask:async()=>structuredClone(task),
  startTask:async request=>result('startTask',request.requestId,()=>{task={id:'task',projectId:request.projectId,status:'draft',revision:1};return {taskId:'task'};}),
  continueTask:async(id,request)=>result('continueTask',request.requestId,()=>{assert.equal(task.revision,request.revision);task={...task,status:'draft',revision:request.revision+1};return task;}),
  confirmTask:async(id,request)=>result('confirmTask',request.requestId,()=>{assert.equal(task.revision,request.revision);task={...task,status:'running',revision:request.revision+1};return task;}),
 };
 const rpc=await createTaskRpcServer({socketPath:join(root,'task.sock'),adapter:service,timeoutMs:100});t.after(()=>rpc.close());
 const adapter=createTaskRpcClient({socketPath:rpc.address,timeoutMs:1000}),origin='https://vox.example';
 const app=createHttpServer({adapter,directSubmissions:true,legacyProjectId:'project-1',publicOrigin:origin,loginSecret:'a-long-login-password'});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.server.close());t.after(()=>release?.());
 const base=`http://127.0.0.1:${app.server.address().port}`,login=await fetch(base+'/api/login',{method:'POST',headers:{origin},body:JSON.stringify({password:'a-long-login-password'})});
 const headers={origin,cookie:login.headers.get('set-cookie').split(';')[0]},path=stage==='continueTask'?'/api/tasks/task/continue':'/api/tasks',payload=stage==='continueTask'?{...input,revision:3}:input;
 const post=()=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(payload)});
 const response=await post(),unknown=await response.json();
 assert.equal(response.status,409);assert.equal(unknown.code,'outcome_unknown');assert.equal(unknown.submissionRequestId,'request-1');
 assert.equal(unknown.taskId,stage==='startTask'?undefined:'task');assert.equal(commits[stage],1);assert.equal(counts[stage],1);
 assert.equal(commits.confirmTask,stage==='confirmTask'?1:0);
 release();
 const retry=await post();assert.equal(retry.status,stage==='continueTask'?200:201);assert.equal((await retry.json()).status,'running');
 assert.equal(commits[stage],1);assert.equal(commits.confirmTask,1);assert.equal(task.id,'task');
});

test('ambiguous confirmation transport failures retain the original submission without automatic replay',async()=>{
 for(const code of ['deadline_exceeded','response_too_large','invalid_response','unavailable','task_failed','unrecognized_transport_failure']){
  const f=fixture(),confirm=f.adapter.confirmTask;
  f.adapter.confirmTask=async(...args)=>{await confirm(...args);throw Object.assign(Error('lost response after admission'),{code});};
  await assert.rejects(f.submission.start(input),error=>error.code==='outcome_unknown'&&error.taskId==='task-1'&&error.submissionRequestId==='request-1');
  assert.equal(f.task.status,'running');assert.equal(f.calls.filter(call=>call[0]==='execute').length,1);
 }
});

test('ambiguous create and continuation failures retain identities even without a create task ID',async()=>{
 const start=fixture();start.adapter.startTask=async()=>{throw 'lost create response';};
 await assert.rejects(start.submission.start(input),error=>error.code==='outcome_unknown'&&error.submissionRequestId==='request-1'&&error.taskId===undefined);
 const missing=fixture();missing.adapter.startTask=async()=>({});
 await assert.rejects(missing.submission.start(input),error=>error.code==='outcome_unknown'&&error.submissionRequestId==='request-1');
 const continuation=fixture();continuation.task={id:'task-1',projectId:'project-1',status:'completed',revision:3};
 continuation.adapter.continueTask=async()=>{throw Object.assign(Error('closed after mutation'),{code:'unavailable'});};
 await assert.rejects(continuation.submission.continue('task-1',{...input,revision:3}),error=>error.code==='outcome_unknown'&&error.taskId==='task-1'&&error.submissionRequestId==='request-1');
 assert.equal(continuation.calls.length,0);
});

test('explicit business rejections retain their classifications at every mutation boundary',async()=>{
 for(const method of ['startTask','continueTask','confirmTask'])for(const code of ['busy','revision_conflict','project_unavailable','invalid_argument','request_conflict','not_found','task_hidden','task_deleted','quarantined','invalid_parent','ledger_full','capacity','expired','offline','task_conflict']){
  const f=fixture();if(method==='continueTask')f.task={id:'task-1',projectId:'project-1',status:'completed',revision:3};
  f.adapter[method]=async()=>{throw Object.assign(Error('explicit rejection'),{code});};
  const operation=method==='continueTask'?f.submission.continue('task-1',{...input,revision:3}):f.submission.start(input);
  await assert.rejects(operation,error=>error.code===code&&error.submissionRequestId==='request-1');
 }
});

for(const kind of ['start','continue'])for(const code of ['deadline_exceeded',undefined])test(`HTTP retains the ${kind} identity after its committed mutation and a ${code??'raw'} detail-read failure`,async t=>{
 const tasks=new Map(),receipts=new Map();let failRead=false,failed=false,confirmations=0;
 if(kind==='continue')tasks.set('task-1',{id:'task-1',projectId:'project-1',status:'completed',revision:3,turns:[{prompt:'Previous turn'}]});
 const adapter={
  async startTask(request){
   if(receipts.has(request.requestId))return receipts.get(request.requestId);
   const id=`task-${tasks.size+1}`;tasks.set(id,{id,projectId:request.projectId,status:'draft',revision:1,turns:[{prompt:request.prompt}]});
   const result={taskId:id};receipts.set(request.requestId,result);failRead=true;return result;
  },
  async continueTask(id,request){
   if(receipts.has(request.requestId))return receipts.get(request.requestId);
   const task=tasks.get(id);assert.equal(request.revision,task.revision);
   const result={...task,status:'draft',revision:request.revision+1,turns:[...task.turns,{prompt:request.prompt}]};
   tasks.set(id,result);receipts.set(request.requestId,result);failRead=true;return result;
  },
  async getTask(id){if(failRead&&!failed){failed=true;throw Object.assign(Error('detail read failed'),code?{code}:{});}return structuredClone(tasks.get(id));},
  async confirmTask(id,request){const task=tasks.get(id);assert.equal(request.revision,task.revision);confirmations++;tasks.set(id,{...task,status:'running',revision:task.revision+1});},
 };
 const origin='https://vox.example',app=createHttpServer({adapter,directSubmissions:true,legacyProjectId:'project-1',publicOrigin:origin,loginSecret:'a-long-login-password'});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.server.close());
 const base=`http://127.0.0.1:${app.server.address().port}`,login=await fetch(base+'/api/login',{method:'POST',headers:{origin},body:JSON.stringify({password:'a-long-login-password'})});
 const headers={origin,cookie:login.headers.get('set-cookie').split(';')[0]},path=kind==='start'?'/api/tasks':'/api/tasks/task-1/continue',payload=kind==='start'?input:{...input,revision:3};
 const post=request=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(request)});
 const response=await post(payload),unknown=await response.json();
 assert.equal(response.status,409);assert.deepEqual(unknown,{error:'request failed',code:'outcome_unknown',taskId:'task-1',submissionRequestId:'request-1'});
 assert.equal(tasks.size,1);assert.equal(tasks.get('task-1').turns.length,kind==='start'?1:2);assert.equal(confirmations,0);
 const retry=await post({...payload,requestId:unknown.submissionRequestId});assert.equal(retry.status,kind==='start'?201:200);assert.equal((await retry.json()).status,'running');
 assert.equal(tasks.size,1);assert.equal(tasks.get('task-1').turns.length,kind==='start'?1:2);assert.equal(confirmations,1);
});

test('a read failure before continuation preserves its classification without mutation effects',async()=>{
 const continuation=fixture();continuation.adapter.getTask=async()=>{throw Object.assign(Error('read unavailable'),{code:'unavailable'});};
 await assert.rejects(continuation.submission.continue('task-1',{...input,revision:3}),{code:'unavailable'});assert.equal(continuation.calls.length,0);
});
