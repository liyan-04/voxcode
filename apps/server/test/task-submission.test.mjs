import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskSubmission} from '../task-submission.mjs';
import {createHttpServer} from '../http-server.mjs';
import {once} from 'node:events';

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
