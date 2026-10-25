import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,chmod,lstat,rm,symlink,mkdir,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createConnection} from 'node:net';
import {createTaskRpcServer,createTaskRpcClient} from '../task-rpc.mjs';
import {createCodexCliAdapter} from '../codex-cli-adapter.mjs';

async function fixture(t,options={}){
  const dir=await realpath(await mkdtemp(join(tmpdir(),'vxrpc-')));await chmod(dir,0o700);
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const socketPath=join(dir,'task.sock');let calls=0;
  const adapter={status:async()=>({available:true}),listProjects:async()=>[{id:'alpha',name:'Alpha',enabled:true,scopes:[{id:'all',name:'全项目'}]}],
    getProject:async id=>id==='alpha'?{id,name:'Alpha',enabled:true}:null,
    startTask:async args=>{calls++;return {taskId:'one',projectId:args.projectId};},
    getTask:async id=>({id,projectId:'alpha'}),confirmTask:async(id,opts)=>({id,revision:opts.revision+1}),
    cancelTask:async id=>({id,status:'cancelled'}),listTasks:async()=>[],getLogs:async()=>({logs:[]}),getDiff:async()=>({collected:false}),getChecks:async()=>({collected:false}),...options.adapter};
  const {adapter:ignored,...serverOptions}=options;
  const server=await createTaskRpcServer({socketPath,adapter,timeoutMs:250,...serverOptions});t.after(()=>server.close());
  return {dir,socketPath,server,client:createTaskRpcClient({socketPath,timeoutMs:1000}),get calls(){return calls;}};
}
function raw(path,data){return new Promise((resolve,reject)=>{const s=createConnection(path);let out='';s.on('connect',()=>s.write(data));s.on('data',x=>out+=x);s.on('end',()=>{try{resolve(JSON.parse(out));}catch{reject(Error('bad response'));}});s.on('error',reject);});}

test('real Unix socket roundtrip uses bounded allowlisted adapter operations',async t=>{
  const f=await fixture(t);assert.equal((await lstat(f.socketPath)).mode&0o777,0o660);
  assert.equal((await f.client.status()).available,true);
  assert.equal((await f.client.startTask({projectId:'alpha',prompt:'test',requestId:'one'})).taskId,'one');
  assert.equal((await f.client.confirmTask('one',{revision:1,requestId:'confirm'})).revision,2);
  assert.equal((await f.client.cancelTask('one',{requestId:'stop'})).status,'cancelled');
  assert.equal(f.calls,1);assert.equal((await f.client.listProjects())[0].id,'alpha');
});

test('RPC metadata and subtasks forward strict CAS fields and reject arbitrary metadata injection',async t=>{
  const f=await fixture(t,{adapter:{archiveTask:async(id,opts)=>({id,archived:opts.archived,metadataRevision:opts.metadataRevision+1}),deleteTask:async id=>({id,deletedAt:'fixture-time'}),restoreTask:async id=>({id,deletedAt:null})}});
  assert.equal((await f.client.startTask({projectId:'alpha',parentTaskId:'parent',prompt:'child'})).taskId,'one');
  assert.equal((await f.client.archiveTask('one',{metadataRevision:1,archived:true,requestId:'archive'})).metadataRevision,2);
  assert.equal((await f.client.deleteTask('one',{metadataRevision:2})).deletedAt,'fixture-time');
  assert.equal((await f.client.restoreTask('one',{metadataRevision:3})).deletedAt,null);
  await assert.rejects(()=>f.client.deleteTask('one',{revision:1}),e=>e.code==='invalid_argument');
  await assert.rejects(()=>f.client.archiveTask('one',{metadataRevision:1,archived:true,projectRoot:'/tmp'}),e=>e.code==='invalid_argument');
});
test('RPC continuation forwards only a prompt and durable revision/request identity',async t=>{
 let received;const f=await fixture(t,{adapter:{continueTask:async(id,opts)=>{received=[id,opts];return {id,status:'draft',turns:[{prompt:opts.prompt}]};}}});
 const options={prompt:'fix output',revision:3,requestId:'next'};assert.equal((await f.client.continueTask('one',options)).status,'draft');assert.deepEqual(received,['one',options]);
 for(const opts of [{...options,sessionId:'other'},{...options,revision:undefined},{...options,requestId:undefined},{...options,prompt:' '}])await assert.rejects(f.client.continueTask('one',opts),{code:'invalid_argument'});
});

test('real CLI task histories remain individually retrievable while Unix RPC lists bounded summaries',async t=>{
 const root=await mkdtemp(join(tmpdir(),'vxrpc-history-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const sessionId='12345678-1234-4234-8234-123456789abc',createdAt='2026-10-01T00:00:00.000Z',records=new Map();
 for(const id of ['history-a','history-b'])records.set(id,{id,title:id,status:'completed',revision:3,createdAt,sessionId,output:'x'.repeat(20000),logs:[],turns:Array.from({length:17},(_,n)=>({id:`${id}-${n}`,kind:n?'continuation':'initial',prompt:'p'.repeat(12000),output:'x'.repeat(20000),logs:[],status:'completed',sessionId,createdAt}))});
 const adapter=createCodexCliAdapter({projectRoot:root,storeFactory:()=>({list:async()=>[...records.values()].map(task=>structuredClone(task)),put:async task=>records.set(task.id,structuredClone(task))})});
 const drafts=[];
 for(const id of records.keys()){
  const draft=await adapter.continueTask(id,{prompt:'next',revision:3,requestId:`continue-${id}`});drafts.push(draft);
  assert.ok(Buffer.byteLength(JSON.stringify(draft))>500000);assert.ok(Buffer.byteLength(JSON.stringify(draft))<600000);
 }
 const f=await fixture(t,{adapter});
 const listed=await f.client.listTasks({projectId:'alpha'});
 assert.deepEqual(listed.map(task=>task.id),['history-a','history-b']);assert.ok(Buffer.byteLength(JSON.stringify(listed))<4096);
 for(let n=0;n<drafts.length;n++){
  const task=await f.client.getTask(drafts[n].id);assert.deepEqual(task,drafts[n]);assert.equal(task.turns.length,18);
  assert.equal(task.turns[0].prompt.length,12000);assert.equal(task.turns[0].output.length,20000);
  for(const key of ['turns','prompt','output','logs','fingerprint'])assert.equal(listed[n][key],undefined);
  assert.equal(listed[n].sessionId,sessionId);assert.equal(listed[n].revision,4);
 }
 const privateMethod=await raw(f.socketPath,JSON.stringify({id:'private',method:'listTaskRecords',args:[]})+'\n');assert.equal(privateMethod.ok,false);
});

test('RPC rejects arbitrary methods, arbitrary paths, malformed and oversize requests before mutation',async t=>{
  const f=await fixture(t);
  for(const data of [JSON.stringify({id:'x',method:'exec',args:['rm']}),JSON.stringify({id:'x',method:'startTask',args:[{projectId:'alpha',prompt:'test',command:'/bin/sh'}]}),'not-json']) {
    const response=await raw(f.socketPath,data+'\n');assert.equal(response.ok,false);
  }
  const response=await raw(f.socketPath,'x'.repeat(65537));assert.equal(response.error.code,'request_too_large');assert.equal(f.calls,0);
});

test('slow RPC has explicit unknown-result timeout and never retries a mutation',async t=>{
  let calls=0;
  const f=await fixture(t,{adapter:{startTask:async()=>{calls++;await new Promise(r=>setTimeout(r,100));return {taskId:'late'};}},timeoutMs:30});
  await assert.rejects(()=>f.client.startTask({projectId:'alpha',prompt:'test'}),e=>e.code==='deadline_exceeded');
  await new Promise(r=>setTimeout(r,120));assert.equal(calls,1);
});

test('timed-out in-flight operations retain capacity until completion',async t=>{
  let release;
  const f=await fixture(t,{maxConnections:1,timeoutMs:30,adapter:{startTask:()=>new Promise(r=>{release=r;})}});
  await assert.rejects(()=>f.client.startTask({projectId:'alpha',prompt:'slow'}),e=>e.code==='deadline_exceeded');
  await assert.rejects(()=>f.client.status(),e=>e.code==='busy');
  release({taskId:'done'});await new Promise(r=>setTimeout(r,10));
  assert.equal((await f.client.status()).available,true);
});

test('oversize response is redacted and connection count is bounded',async t=>{
  const f=await fixture(t,{maxConnections:1,adapter:{getLogs:async()=>({logs:['secret'.repeat(200000)]})}});
  await assert.rejects(()=>f.client.getLogs('one'),e=>e.code==='response_too_large');
  const first=createConnection(f.socketPath);await new Promise(r=>first.once('connect',r));
  t.after(()=>first.destroy());
  const response=await raw(f.socketPath,JSON.stringify({id:'two',method:'status',args:[]})+'\n');assert.equal(response.error.code,'busy');
});

test('socket startup refuses existing endpoints, world-accessible or symlink parents',async t=>{
  const f=await fixture(t);
  await assert.rejects(()=>createTaskRpcServer({socketPath:f.socketPath,adapter:{status(){}}}),/socket/i);
  const world=join(f.dir,'world');await mkdir(world,{mode:0o777});await chmod(world,0o777);
  await assert.rejects(()=>createTaskRpcServer({socketPath:join(world,'task.sock'),adapter:{}}),/parent/i);
  const link=join(f.dir,'link');await symlink(f.dir,link);
  await assert.rejects(()=>createTaskRpcServer({socketPath:join(link,'other.sock'),adapter:{}}),/parent/i);
});
