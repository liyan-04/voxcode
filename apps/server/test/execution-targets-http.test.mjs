import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {EventEmitter,once} from 'node:events';
import {createHttpServer} from '../http-server.mjs';
import {createExecutionTargets} from '../execution-targets.mjs';
import {createProjectService} from '../project-service.mjs';
import {createCodexCliAdapter} from '../codex-cli-adapter.mjs';
import {createTaskRpcServer,createTaskRpcClient} from '../task-rpc.mjs';

async function fixture(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'target-http-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const services={},entries={},spawns={mac:0,server:0},sessionId='12345678-1234-4234-8234-123456789abc';
 for(const target of ['mac','server']){
  const projectRoot=join(root,target);await mkdir(projectRoot);execFileSync('git',['init','--quiet',projectRoot]);
  const records=new Map([['same-task',{id:'same-task',title:target+' task',status:'completed',revision:3,createdAt:'2026-10-25T00:00:00.000Z',output:target+' result',logs:[],sessionId,turns:[{id:'first',kind:'initial',prompt:target+' request',status:'completed',output:target+' result',logs:[]}]}]]);
  const service=await createProjectService({projects:[{id:'same-project',name:target+' project',root:projectRoot,enabled:true}],dataDir:join(root,target+'-state'),command:'/fixture/codex',adapterFactory:options=>createCodexCliAdapter({...options,probeCli:async()=>({available:true}),storeFactory:()=>({list:async()=>[...records.values()].map(x=>structuredClone(x)),put:async task=>records.set(task.id,structuredClone(task))}),spawnImpl:()=>{
   spawns[target]++;const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>child.emit('close',null);
   child.stdin={on(){},end(prompt){if(prompt==='hold')return;setImmediate(()=>{child.stdout.emit('data',Buffer.from(JSON.stringify({type:'thread.started',thread_id:sessionId})+'\n'+JSON.stringify({type:'item.completed',item:{type:'agent_message',text:target+' executed'}})+'\n'));child.emit('close',0);});}};return child;
  }})});services[target]=service;
  const rpc=await createTaskRpcServer({socketPath:join(root,target+'.sock'),adapter:service});t.after(()=>rpc.close());entries[target]={adapter:createTaskRpcClient({socketPath:rpc.address})};
 }
 const targets=createExecutionTargets(entries),origin='https://vox.example';
 const app=createHttpServer({adapter:entries.mac.adapter,projectRegistry:entries.mac.adapter,executionTargets:targets,directSubmissions:true,publicOrigin:origin,loginSecret:'a-long-login-password'});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.server.close());const base=`http://127.0.0.1:${app.server.address().port}`;
 const login=await fetch(base+'/api/login',{method:'POST',headers:{origin},body:JSON.stringify({password:'a-long-login-password'})});assert.equal(login.status,200);
 const headers={origin,cookie:login.headers.get('set-cookie').split(';')[0]};
 const request=async(path,body)=>{const response=await fetch(base+path,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
 return {request,services,spawns};
}

test('HTTP project lists and equal task IDs stay within the request execution target',async t=>{
 const f=await fixture(t);
 for(const target of ['mac','server']){
  assert.equal((await f.request('/api/projects?executionTarget='+target)).body.projects[0].name,target+' project');
  assert.equal((await f.request('/api/tasks?projectId=same-project&executionTarget='+target)).body.tasks[0].title,target+' task');
  assert.equal((await f.request('/api/tasks/same-task?executionTarget='+target)).body.output,target+' result');
 }
 assert.equal((await f.request('/api/tasks/same-task')).body.output,'mac result');assert.deepEqual(f.spawns,{mac:0,server:0});
 for(const query of ['executionTarget=wrong','executionTarget=server&executionTarget=mac','executionTarget=server&executionTarget=server']){
  assert.equal((await f.request('/api/tasks/same-task?'+query)).status,400);
  assert.equal((await f.request('/api/tasks?'+query,{projectId:'same-project',prompt:'bad',requestId:'bad'})).status,400);
 }
 assert.deepEqual(f.spawns,{mac:0,server:0});
});

test('HTTP directly submits and resumes through each selected private service with isolated replay IDs',async t=>{
 const f=await fixture(t),startIds={};
 const continued=await f.request('/api/tasks/same-task/continue?executionTarget=server',{projectId:'same-project',prompt:'server continuation',revision:3,requestId:'same-business-id'});
 assert.equal(continued.status,200);assert(['running','completed'].includes(continued.body.status));
 assert.equal((await f.services.mac.getTask('same-task')).turns.length,1);assert.equal((await f.services.server.getTask('same-task')).turns.length,2);
 await f.request('/api/tasks/same-task/continue?executionTarget=server',{projectId:'same-project',prompt:'server continuation',revision:3,requestId:'same-business-id'});assert.equal(f.spawns.server,1);
 const macInput={projectId:'same-project',prompt:'mac continuation',revision:3,requestId:'same-business-id'};
 assert.equal((await f.request('/api/tasks/same-task/continue?executionTarget=mac',macInput)).status,200);
 assert.equal((await f.request('/api/tasks/same-task/continue?executionTarget=mac',macInput)).status,200);
 assert.equal((await f.services.mac.getTask('same-task')).turns.length,2);assert.equal(f.spawns.mac,1);
 for(const target of ['mac','server']){
  const input={projectId:'same-project',prompt:target+' change',requestId:'shared-create'};
  const submitted=await f.request('/api/tasks?executionTarget='+target,input);assert.equal(submitted.status,201);assert(['running','completed'].includes(submitted.body.status));startIds[target]=submitted.body.taskId;
  assert.equal((await f.request('/api/tasks?executionTarget='+target,input)).status,201);
 }
 assert.deepEqual(f.spawns,{mac:2,server:2});
 assert.notEqual((await f.services.mac.getTask(startIds.mac)).confirmRequestId,(await f.services.server.getTask(startIds.server)).confirmRequestId);
});

test('HTTP target mutations reject injected execution identities and keep metadata isolated',async t=>{
 const f=await fixture(t);
 for(const extra of [{executionTarget:'mac'},{deviceId:'chosen'},{userId:'chosen'},{socketPath:'/tmp/foreign'},{projectRoot:'/tmp/foreign'}]){
  assert.equal((await f.request('/api/tasks?executionTarget=server',{projectId:'same-project',prompt:'bad',requestId:'bad',...extra})).status,400);
 }
 assert.deepEqual(f.spawns,{mac:0,server:0});
 const archived=await f.request('/api/tasks/same-task/archive?executionTarget=server',{projectId:'same-project',metadataRevision:1,requestId:'visibility',archived:true});
 assert.equal(archived.status,200);assert.equal((await f.services.server.getTask('same-task')).archived,true);assert.equal((await f.services.mac.getTask('same-task')).archived,false);
 const hidden=await f.request('/api/tasks/same-task/continue?executionTarget=server',{projectId:'same-project',prompt:'hidden',revision:3,requestId:'hidden'});assert.equal(hidden.status,409);assert.deepEqual(f.spawns,{mac:0,server:0});
});

test('HTTP cancellation of a running server turn never cancels the equal Mac task',async t=>{
 const f=await fixture(t);
 const running=await f.request('/api/tasks/same-task/continue?executionTarget=server',{projectId:'same-project',prompt:'hold',revision:3,requestId:'run-held'});assert.equal(running.body.status,'running');
 const stopped=await f.request('/api/tasks/same-task/cancel?executionTarget=server',{projectId:'same-project',requestId:'stop-server'});assert.equal(stopped.status,200);assert.equal(stopped.body.status,'cancelled');
 assert.equal((await f.services.mac.getTask('same-task')).status,'completed');assert.deepEqual(f.spawns,{mac:0,server:1});
});
