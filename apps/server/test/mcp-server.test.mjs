import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createMcpServer} from '../mcp-server.mjs';

const rpc=(method,params={},id=1)=>({jsonrpc:'2.0',id,method,params});
const call=(name,args={})=>rpc('tools/call',{name,arguments:args});
async function fixture(t,options={}) {
 const calls=[];
 const projects=[{id:'p1',name:'One',enabled:true,root:'/private/project'},{id:'p2',name:'Disabled',enabled:false}];
 const adapter={
  status:async()=>({available:true}),listProjects:async()=>projects,getProject:async id=>projects.find(p=>p.id===id),
  listTasks:async args=>(calls.push(['list',args]),[{id:'t1',projectId:'p1'},{id:'foreign',projectId:'p2'}]),
  startTask:async args=>(calls.push(['start',args]),{taskId:'t1'}),
  getTask:async id=>(calls.push(['get',id]),{id,projectId:id==='foreign'?'p2':'p1',status:'running'}),
  cancelTask:async(id,args)=>(calls.push(['cancel',id,args]),{id,status:'cancelling'}),
  continueTask:async()=>{throw Error('disabled');},retryTask:async()=>{throw Error('disabled');},...options.adapter,
 };
 const mcp=createMcpServer({adapter,token:'secret',authorizeWrite:options.authorizeWrite});
 const server=createServer(mcp.handleRequest);server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>server.close());return {base:`http://127.0.0.1:${server.address().port}`,calls};
}
async function post(base,body,headers={}) {
 const response=await fetch(base,{method:'POST',headers:{'content-type':'application/json','x-mcp-token':'secret',...headers},body:JSON.stringify(body)});
 return {status:response.status,body:await response.json().catch(()=>null)};
}
test('auth, initialization and actual callable tool schemas',async t=>{
 const f=await fixture(t);assert.equal((await fetch(f.base,{method:'POST',body:'{}'})).status,401);
 assert.equal((await post(f.base,rpc('initialize'))).body.result.serverInfo.name,'VoxCode');
 const tools=(await post(f.base,rpc('tools/list'))).body.result.tools;
 assert.ok(tools.some(x=>x.name==='codex_list_projects'));assert.ok(!tools.some(x=>/continue|retry|confirm/.test(x.name)));
 assert.deepEqual(tools.find(x=>x.name==='codex_start_task').inputSchema.required,['projectId','prompt','requestId']);
 assert.deepEqual(tools.find(x=>x.name==='codex_list_tasks').inputSchema.required,['projectId']);
 assert.equal(tools.find(x=>x.name==='codex_start_task').inputSchema.additionalProperties,false);
 assert.ok(!tools.some(x=>x.name==='codex_task_diff'));
});
test('project discovery returns only safe fields and list filters project ownership',async t=>{
 const f=await fixture(t);const discovery=(await post(f.base,call('codex_list_projects'))).body;
 assert.ok(!JSON.stringify(discovery).includes('/private/project'));
 const projects=JSON.parse(discovery.result.content[0].text).projects;
 assert.deepEqual(projects[0],{id:'p1',name:'One',enabled:true,scopes:[{id:'all',name:'全项目'}]});
 const tasks=JSON.parse((await post(f.base,call('codex_list_tasks',{projectId:'p1'}))).body.result.content[0].text);
 assert.deepEqual(tasks,[{id:'t1',projectId:'p1'}]);assert.ok(f.calls.some(x=>x[0]==='list'&&x[1].projectId==='p1'));
});
test('draft requires explicit project, durable identity and write authorization',async t=>{
 const f=await fixture(t);
 for(const args of [{prompt:'x'},{projectId:'p1',prompt:'x'},{projectId:'p1',prompt:'x',requestId:'r',path:'/tmp'},{projectId:'p1',prompt:'x',requestId:3}])assert.equal((await post(f.base,call('codex_start_task',args))).body.error.code,-32602);
 for(const projectId of ['missing','p2'])assert.equal((await post(f.base,call('codex_start_task',{projectId,prompt:'x',requestId:'r'}))).body.error.code,-32004);
 const args={projectId:'p1',prompt:'x',requestId:'r',title:'Title'};assert.equal((await post(f.base,call('codex_start_task',args))).body.error.code,-32003);assert.deepEqual(f.calls,[]);
 let authorizationCalls=0;const allowed=await fixture(t,{authorizeWrite:async()=>{authorizationCalls++;return true;}});
 assert.equal((await post(allowed.base,call('codex_start_task',args))).body.result.isError,false);assert.equal(authorizationCalls,1);assert.deepEqual(allowed.calls,[['start',args]]);
});
test('cancel is default deny and uses task-owned project for authorization',async t=>{
 const denied=await fixture(t);assert.equal((await post(denied.base,call('codex_cancel_task',{taskId:'t1',requestId:'cancel-1'}))).body.error.code,-32003);assert.ok(!denied.calls.some(x=>x[0]==='cancel'));
 let context;const allowed=await fixture(t,{authorizeWrite:async input=>(context=input.context,true)});
 assert.equal((await post(allowed.base,call('codex_cancel_task',{taskId:'t1',requestId:'cancel-2'}))).body.result.isError,false);assert.deepEqual(context,{taskId:'t1',projectId:'p1'});
 assert.ok(allowed.calls.some(x=>x[0]==='cancel'&&x[1]==='t1'&&x[2].requestId==='cancel-2'));
 assert.equal((await post(allowed.base,call('codex_cancel_task',{taskId:'foreign',requestId:'cancel-3'}))).body.error.code,-32004);
});
test('reads use string task IDs and reject disabled task projects',async t=>{
 const f=await fixture(t);assert.equal((await post(f.base,call('codex_task_status',{taskId:'t1'}))).body.result.isError,false);assert.ok(f.calls.some(x=>x[0]==='get'&&x[1]==='t1'));
 assert.equal((await post(f.base,call('codex_task_status',{taskId:'foreign'}))).body.error.code,-32004);assert.equal((await post(f.base,call('codex_task_status',{}))).body.error.code,-32602);
});
test('unavailable project registry cannot advertise or invoke project task tools',async t=>{
 const f=await fixture(t,{adapter:{listProjects:undefined,getProject:undefined}});const tools=(await post(f.base,rpc('tools/list'))).body.result.tools;
 assert.deepEqual(tools.map(t=>t.name),['codex_status']);assert.equal((await post(f.base,call('codex_start_task',{projectId:'p1',prompt:'x',requestId:'r'}))).body.error.code,-32602);
});
test('notifications accepted, malformed JSON and unknown methods rejected',async t=>{
 const f=await fixture(t);assert.equal((await post(f.base,{jsonrpc:'2.0',method:'notifications/initialized'})).status,202);assert.equal((await fetch(f.base)).status,405);
 const invalid=await fetch(f.base,{method:'POST',headers:{'x-mcp-token':'secret'},body:'{'});assert.equal((await invalid.json()).error.code,-32700);
 assert.equal((await post(f.base,[])).body.error.code,-32600);assert.equal((await post(f.base,rpc('no-such-method'))).body.error.code,-32601);assert.equal((await post(f.base,call('shell'))).body.error.code,-32602);
});
test('errors never expose private diagnostics',async t=>{
 const f=await fixture(t,{authorizeWrite:async()=>{throw Error('PRIVATE_TOKEN');},adapter:{status:async()=>{throw Error('PRIVATE_TOKEN');}}});
 for(const [name,args] of [['codex_cancel_task',{taskId:'t1',requestId:'r'}],['codex_status',{}]]){const response=await post(f.base,call(name,args));assert.equal(response.body.error.code,-32603);assert.ok(!JSON.stringify(response.body).includes('PRIVATE_TOKEN'));}
});
test('request and response sizes are bounded',async t=>{
 const f=await fixture(t,{adapter:{status:async()=> 'x'.repeat(1024*1024+1)}});const out=await post(f.base,call('codex_status'));assert.equal(out.status,500);assert.equal(out.body.error.message,'Response too large');
 assert.equal((await post(f.base,{data:'x'.repeat(1024*1024)})).status,413);
});
test('additional callable evidence tools retain task-owned project validation',async t=>{
 const seen=[];const f=await fixture(t,{adapter:Object.fromEntries(['getLogs','getDiff','getChecks'].map(method=>[method,async id=>(seen.push([method,id]),{collected:false})]))});
 for(const name of ['codex_task_logs','codex_task_diff','codex_task_checks'])assert.equal((await post(f.base,call(name,{taskId:'t1'}))).body.result.isError,false);
 assert.deepEqual(seen,[['getLogs','t1'],['getDiff','t1'],['getChecks','t1']]);
 const status=await post(f.base,call('codex_status'));assert.equal(JSON.parse(status.body.result.content[0].text).available,true);
 assert.equal((await post(f.base,rpc('ping'))).body.result.constructor,Object);
});
