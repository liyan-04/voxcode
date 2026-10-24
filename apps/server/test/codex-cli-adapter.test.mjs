import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {createCodexCliAdapter} from '../codex-cli-adapter.mjs';
async function fixture(t,extra={}){const root=await mkdtemp(join(tmpdir(),'vox-cli-'));t.after(()=>rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:20}));let p,calls=0;const spawnImpl=()=>{calls++;p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.stdin={on(){},end(){}};p.kill=s=>p.emit('close',null,s);return p;};const opts={projectRoot:root,dataDir:join(root,'data'),spawnImpl,...extra};return {a:createCodexCliAdapter(opts),opts,get p(){return p},get calls(){return calls}};}
test('draft requires confirmation and parses JSON results',async t=>{const f=await fixture(t);const {taskId}=await f.a.startTask({prompt:'hello'});assert.equal(f.calls,0);await f.a.confirmTask(taskId);f.p.stdout.emit('data',Buffer.from('{"type":"thread.started","thread_id":"session-1"}\n{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\n'));f.p.emit('close',0);const task=await f.a.getTask(taskId);assert.equal(task.status,'completed');assert.equal(task.output,'done');assert.equal(task.sessionId,'session-1');assert.equal((await f.a.getDiff(taskId)).collected,false);});
test('rejects invalid prompt and external project',async t=>{const f=await fixture(t);await assert.rejects(f.a.startTask({prompt:''}),/prompt/);await assert.rejects(f.a.startTask({prompt:'x',projectRoot:'/tmp'}),/project/);});
test('restart marks running interrupted without spawning',async t=>{const f=await fixture(t);const {taskId}=await f.a.startTask({prompt:'x'});await f.a.confirmTask(taskId);const b=createCodexCliAdapter(f.opts);assert.equal((await b.getTask(taskId)).status,'interrupted');assert.equal(f.calls,1);f.p.emit('close',0);await f.a.getTask(taskId);});
test('cancellation retains slot until process close',async t=>{const signals=[];const f=await fixture(t,{signalGroup:(pid,s)=>signals.push(s),killGraceMs:5});const {taskId}=await f.a.startTask({prompt:'x'});await f.a.confirmTask(taskId);f.p.pid=123;const cancelled=f.a.cancelTask(taskId);await new Promise(r=>setTimeout(r,15));assert.deepEqual(signals,['SIGTERM','SIGKILL']);assert.equal((await f.a.status()).activeTasks,1);f.p.emit('close',null,'SIGKILL');assert.equal((await cancelled).status,'cancelled');assert.equal((await f.a.status()).activeTasks,0);});
test('requestId persists, revision rejects stale confirmation and continuation stays draft',async t=>{const f=await fixture(t);const x=await f.a.startTask({prompt:'x',requestId:'r1'});assert.deepEqual(await f.a.startTask({prompt:'x',requestId:'r1'}),x);await assert.rejects(f.a.startTask({prompt:'changed',requestId:'r1'}),/conflict/);await assert.rejects(f.a.confirmTask({taskId:x.taskId,revision:99}),/revision/);await f.a.confirmTask({taskId:x.taskId,revision:1,requestId:'confirm'});f.p.stdout.emit('data',Buffer.from('{"type":"thread.started","thread_id":"s1"}\n'));assert.equal((await f.a.getTask(x.taskId)).sessionId,'s1');f.p.emit('close',0);await new Promise(r=>setTimeout(r,10));await assert.rejects(f.a.continueTask(x.taskId,{prompt:'continue',requestId:'r2'}),/disabled/);assert.equal(f.calls,1);const b=createCodexCliAdapter(f.opts);assert.deepEqual(await b.startTask({prompt:'x',requestId:'r1'}),x);});
test('status actually probes missing executable',async t=>{const f=await fixture(t,{command:'/no/such/codex'});assert.equal((await f.a.status()).available,false);});
test('real POSIX process group descendants are killed before slot released',{timeout:10000},async t=>{const {spawn}=await import('node:child_process');const f=await fixture(t,{killGraceMs:40,spawnImpl:(_cmd,_args,opts)=>spawn('/bin/sh',['-c',`trap 'exit 0' TERM; /bin/sh -c 'trap "" TERM; while :; do sleep 1; done' >/dev/null 2>&1 & echo '{"type":"thread.started","thread_id":"tree"}'; wait`],opts)});const {taskId}=await f.a.startTask({prompt:'x'});await f.a.confirmTask(taskId);await new Promise(r=>setTimeout(r,100));const result=await f.a.cancelTask(taskId);if(result.error==='Process cleanup failed: EPERM'){assert.equal(result.status,'cancelling');assert.equal((await f.a.status()).activeTasks,1);t.diagnostic('Host refuses negative-PGID liveness probe with EPERM; slot correctly quarantined');return;}assert.equal(result.status,'cancelled',result.error);assert.equal((await f.a.status()).activeTasks,0);});
test('quarantined task cannot be confirmed after restart',async t=>{const f=await fixture(t);const {taskId}=await f.a.startTask({prompt:'x'});await f.a.confirmTask(taskId);const b=createCodexCliAdapter(f.opts);const task=await b.getTask(taskId);assert.equal(task.quarantined,true);await assert.rejects(b.confirmTask(taskId),/quarantined/);const draft=await b.startTask({prompt:'other'});await assert.rejects(b.confirmTask(draft.taskId),/quarantined/);f.p.emit('close',0);await f.a.getTask(taskId);});
test('continuation is disabled until resume sandbox is verified',async t=>{const f=await fixture(t);await assert.rejects(f.a.continueTask('missing'),/disabled/);});
test('confirmation persistence failure reserves slot and does not spawn',async t=>{let writes=0;const tasks=new Map();const f=await fixture(t,{storeFactory:()=>({list:async()=>[...tasks.values()],put:async x=>{if(++writes===2)throw new Error('disk full');tasks.set(x.id,structuredClone(x));}})});const {taskId}=await f.a.startTask({prompt:'x'});await assert.rejects(f.a.confirmTask(taskId),/disk full/);assert.equal(f.calls,0);assert.equal((await f.a.status()).activeTasks,1);});
test('concurrent confirmations spawn only once',async t=>{const f=await fixture(t);const a=await f.a.startTask({prompt:'a'}),b=await f.a.startTask({prompt:'b'});const results=await Promise.allSettled([f.a.confirmTask(a.taskId),f.a.confirmTask(b.taskId)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.calls,1);f.p.emit('close',0);await f.a.getTask(a.taskId);});

const waitFor=async(predicate,timeout=1000)=>{const until=Date.now()+timeout;while(!predicate()){if(Date.now()>until)throw Error('fixture condition timed out');await new Promise(r=>setTimeout(r,2));}};
const bounded=async promise=>Promise.race([promise,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('operation remained pending')),1000);timer.unref();})]);
test('cancel accepted during confirmation persistence prevents launch',async t=>{
  const tasks=new Map();let release,entered=false;
  const f=await fixture(t,{storeFactory:()=>({list:async()=>[...tasks.values()],put:async task=>{const snapshot=structuredClone(task);if(snapshot.status==='running'&&!entered){entered=true;await new Promise(r=>release=r);}tasks.set(snapshot.id,snapshot);}})});
  const {taskId}=await f.a.startTask({prompt:'x'}),confirm=f.a.confirmTask(taskId);
  await waitFor(()=>entered);const cancel=f.a.cancelTask(taskId);await new Promise(r=>setTimeout(r,5));release();
  const outcome=await Promise.all([confirm,bounded(cancel)]);assert.equal(f.calls,0);assert.equal(outcome[1].status,'cancelled');
});
test('confirmation persistence failure leaves a complete cancellable entry without launching',async t=>{
  const tasks=new Map();let failed=false;
  const f=await fixture(t,{storeFactory:()=>({list:async()=>[...tasks.values()],put:async task=>{if(task.status==='running'&&!failed){failed=true;throw Error('fixture disk full');}tasks.set(task.id,structuredClone(task));}})});
  const {taskId}=await f.a.startTask({prompt:'x'});await assert.rejects(f.a.confirmTask(taskId),/fixture disk full/);
  const result=await bounded(f.a.cancelTask(taskId));assert.equal(f.calls,0);assert.equal(result.quarantined,true);
});
test('cancel persists failure conservatively but sends TERM and KILL and retry completes',async t=>{
  const tasks=new Map(),signals=[];let failed=false;
  const f=await fixture(t,{killGraceMs:5,groupExists:()=>false,signalGroup:(_pid,s)=>{signals.push(s);if(s==='SIGKILL')f.p.emit('close',null);},storeFactory:()=>({list:async()=>[...tasks.values()],put:async task=>{if(task.status==='cancelling'&&!failed){failed=true;throw Error('fixture disk full');}tasks.set(task.id,structuredClone(task));}})});
  const {taskId}=await f.a.startTask({prompt:'x'});await f.a.confirmTask(taskId);f.p.pid=123;
  const first=f.a.cancelTask(taskId);await new Promise(r=>setTimeout(r,2));const second=f.a.cancelTask(taskId);
  const result=await bounded(Promise.all([first,second]));assert.deepEqual(signals,['SIGTERM','SIGKILL']);assert.equal(result[0].quarantined,true);assert.equal(result[1].status,'cancelled');
});
test('timeout stopping observes persistence rejection and still terminates the process',async t=>{
  const tasks=new Map(),signals=[];let failed=false;
  const f=await fixture(t,{timeoutMs:5,killGraceMs:5,groupExists:()=>false,signalGroup:(_pid,s)=>{signals.push(s);if(s==='SIGKILL')f.p.emit('close',null);},storeFactory:()=>({list:async()=>[...tasks.values()],put:async task=>{if(task.status==='cancelling'&&!failed){failed=true;throw Error('fixture disk full');}tasks.set(task.id,structuredClone(task));}})});
  const {taskId}=await f.a.startTask({prompt:'x'});await f.a.confirmTask(taskId);f.p.pid=123;
  await waitFor(()=>signals.includes('SIGKILL'));assert.equal((await bounded(f.a.cancelTask(taskId))).quarantined,true);
});
test('slow event persistence coalesces snapshots and terminal state is explicitly awaited',async t=>{
  const tasks=new Map();let release,blocked=false,writes=0;
  const f=await fixture(t,{storeFactory:()=>({list:async()=>[...tasks.values()],put:async task=>{writes++;if(task.logs.length&&!blocked){blocked=true;await new Promise(r=>release=r);}tasks.set(task.id,structuredClone(task));}})});
  const {taskId}=await f.a.startTask({prompt:'x'});await f.a.confirmTask(taskId);
  f.p.stdout.emit('data',Buffer.from('{"type":"first"}\n'));await waitFor(()=>blocked);
  for(let i=0;i<2000;i++)f.p.stdout.emit('data',Buffer.from('{"type":"item.completed","item":{"type":"agent_message","text":"latest"}}\n'));
  assert.ok(writes<=3);f.p.emit('close',0);release();await waitFor(()=>tasks.get(taskId)?.status==='completed');
  assert.ok(writes<=5,`writes=${writes}`);assert.equal(tasks.get(taskId).output,'latest');
});
test('event persistence rejection triggers observed cleanup and keeps a quarantined slot',async t=>{
  const tasks=new Map();let failed=false;
  const f=await fixture(t,{killGraceMs:5,storeFactory:()=>({list:async()=>[...tasks.values()],put:async task=>{if(task.logs.length&&!failed){failed=true;throw Error('event disk failure');}tasks.set(task.id,structuredClone(task));}})});
  const {taskId}=await f.a.startTask({prompt:'x'});await f.a.confirmTask(taskId);
  f.p.stdout.emit('data',Buffer.from('{"type":"event"}\n'));await waitFor(()=>failed);
  const result=await bounded(f.a.cancelTask(taskId));assert.equal(result.status,'cancelled');assert.equal(result.quarantined,true);assert.equal((await f.a.status()).activeTasks,1);
});
test('terminal receipt failure keeps execution slot quarantined even after process cleanup',async t=>{
  const tasks=new Map(),signals=[];let failed=false;
  const f=await fixture(t,{groupExists:()=>false,signalGroup:(_pid,s)=>signals.push(s),storeFactory:()=>({list:async()=>[...tasks.values()],put:async task=>{if(task.status==='completed'&&!failed){failed=true;throw Error('terminal disk failure');}tasks.set(task.id,structuredClone(task));}})});
  const {taskId}=await f.a.startTask({prompt:'x'});await f.a.confirmTask(taskId);f.p.emit('close',0);
  const result=await f.a.getTask(taskId);assert.equal(result.quarantined,true);assert.equal((await f.a.status()).activeTasks,1);
  f.p.pid=123;assert.equal((await bounded(f.a.cancelTask(taskId))).quarantined,true);assert.deepEqual(signals,[]);
});
