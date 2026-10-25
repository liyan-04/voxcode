import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {createCodexCliAdapter} from '../codex-cli-adapter.mjs';
async function fixture(t,extra={}){const root=await mkdtemp(join(tmpdir(),'vox-cli-'));t.after(()=>rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:20}));let p,calls=0,args,spawnOptions,prompt;const spawnImpl=(_command,argv,options)=>{calls++;args=argv;spawnOptions=options;p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.stdin={on(){},end(value){prompt=value;}};p.kill=s=>p.emit('close',null,s);return p;};const opts={projectRoot:root,dataDir:join(root,'data'),spawnImpl,...extra};return {a:createCodexCliAdapter(opts),opts,get p(){return p},get calls(){return calls},get args(){return args},get spawnOptions(){return spawnOptions},get prompt(){return prompt}};}
test('draft requires confirmation and parses JSON results',async t=>{const f=await fixture(t);const {taskId}=await f.a.startTask({prompt:'hello'});assert.equal(f.calls,0);await f.a.confirmTask(taskId);f.p.stdout.emit('data',Buffer.from('{"type":"thread.started","thread_id":"session-1"}\n{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\n'));f.p.emit('close',0);const task=await f.a.getTask(taskId);assert.equal(task.status,'completed');assert.equal(task.output,'done');assert.equal(task.sessionId,'session-1');assert.equal((await f.a.getDiff(taskId)).collected,false);});
test('rejects invalid prompt and external project',async t=>{const f=await fixture(t);await assert.rejects(f.a.startTask({prompt:''}),/prompt/);await assert.rejects(f.a.startTask({prompt:'x',projectRoot:'/tmp'}),/project/);});
test('restart marks running interrupted without spawning',async t=>{const f=await fixture(t);const {taskId}=await f.a.startTask({prompt:'x'});await f.a.confirmTask(taskId);const b=createCodexCliAdapter(f.opts);assert.equal((await b.getTask(taskId)).status,'interrupted');assert.equal(f.calls,1);f.p.emit('close',0);await f.a.getTask(taskId);});
test('cancellation retains slot until process close',async t=>{const signals=[];const f=await fixture(t,{signalGroup:(pid,s)=>signals.push(s),killGraceMs:5});const {taskId}=await f.a.startTask({prompt:'x'});await f.a.confirmTask(taskId);f.p.pid=123;const cancelled=f.a.cancelTask(taskId);await new Promise(r=>setTimeout(r,15));assert.deepEqual(signals,['SIGTERM','SIGKILL']);assert.equal((await f.a.status()).activeTasks,1);f.p.emit('close',null,'SIGKILL');assert.equal((await cancelled).status,'cancelled');assert.equal((await f.a.status()).activeTasks,0);});
test('requestId persists and revision rejects stale confirmation',async t=>{const f=await fixture(t);const x=await f.a.startTask({prompt:'x',requestId:'r1'});assert.deepEqual(await f.a.startTask({prompt:'x',requestId:'r1'}),x);await assert.rejects(f.a.startTask({prompt:'changed',requestId:'r1'}),/conflict/);await assert.rejects(f.a.confirmTask({taskId:x.taskId,revision:99}),/revision/);await f.a.confirmTask({taskId:x.taskId,revision:1,requestId:'confirm'});f.p.emit('close',0);await f.a.getTask(x.taskId);const b=createCodexCliAdapter(f.opts);assert.deepEqual(await b.startTask({prompt:'x',requestId:'r1'}),x);});
test('status actually probes missing executable',async t=>{const f=await fixture(t,{command:'/no/such/codex'});assert.equal((await f.a.status()).available,false);});
test('real POSIX process group descendants are killed before slot released',{timeout:10000},async t=>{const {spawn}=await import('node:child_process');const f=await fixture(t,{killGraceMs:40,spawnImpl:(_cmd,_args,opts)=>spawn('/bin/sh',['-c',`trap 'exit 0' TERM; /bin/sh -c 'trap "" TERM; while :; do sleep 1; done' >/dev/null 2>&1 & echo '{"type":"thread.started","thread_id":"tree"}'; wait`],opts)});const {taskId}=await f.a.startTask({prompt:'x'});await f.a.confirmTask(taskId);await new Promise(r=>setTimeout(r,100));const result=await f.a.cancelTask(taskId);if(result.error==='Process cleanup failed: EPERM'){assert.equal(result.status,'cancelling');assert.equal((await f.a.status()).activeTasks,1);t.diagnostic('Host refuses negative-PGID liveness probe with EPERM; slot correctly quarantined');return;}assert.equal(result.status,'cancelled',result.error);assert.equal((await f.a.status()).activeTasks,0);});
test('quarantined task cannot be confirmed after restart',async t=>{const f=await fixture(t);const {taskId}=await f.a.startTask({prompt:'x'});await f.a.confirmTask(taskId);const b=createCodexCliAdapter(f.opts);const task=await b.getTask(taskId);assert.equal(task.quarantined,true);await assert.rejects(b.confirmTask(taskId),/quarantined/);const draft=await b.startTask({prompt:'other'});await assert.rejects(b.confirmTask(draft.taskId),/quarantined/);f.p.emit('close',0);await f.a.getTask(taskId);});
test('continuation requires an existing task and a saved UUID session',async t=>{const f=await fixture(t);await assert.rejects(f.a.continueTask('missing',{prompt:'next',revision:1,requestId:'r'}),/not found/);const {taskId}=await f.a.startTask({prompt:'first'});await assert.rejects(f.a.continueTask(taskId,{prompt:'next',revision:1,requestId:'r'}),/terminal/);await f.a.confirmTask(taskId);f.p.emit('close',0);const task=await f.a.getTask(taskId);await assert.rejects(f.a.continueTask(taskId,{prompt:'next',revision:task.revision,requestId:'r'}),/session/);});
test('confirmation persistence failure reserves slot and does not spawn',async t=>{let writes=0;const tasks=new Map();const f=await fixture(t,{storeFactory:()=>({list:async()=>[...tasks.values()],put:async x=>{if(++writes===2)throw new Error('disk full');tasks.set(x.id,structuredClone(x));}})});const {taskId}=await f.a.startTask({prompt:'x'});await assert.rejects(f.a.confirmTask(taskId),/disk full/);assert.equal(f.calls,0);assert.equal((await f.a.status()).activeTasks,1);});
test('concurrent confirmations spawn only once',async t=>{const f=await fixture(t);const a=await f.a.startTask({prompt:'a'}),b=await f.a.startTask({prompt:'b'});const results=await Promise.allSettled([f.a.confirmTask(a.taskId),f.a.confirmTask(b.taskId)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.calls,1);f.p.emit('close',0);await f.a.getTask(a.taskId);});

const waitFor=async(predicate,timeout=1000)=>{const until=Date.now()+timeout;while(!predicate()){if(Date.now()>until)throw Error('fixture condition timed out');await new Promise(r=>setTimeout(r,2));}};
const bounded=async promise=>Promise.race([promise,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('operation remained pending')),1000);timer.unref();})]);
for(const [code,expected]of [[0,'completed'],[7,'failed']]){
  test(`descendant cleanup preserves ${expected} CLI exit`,async t=>{
    const signals=[];
    const f=await fixture(t,{killGraceMs:1,groupExists:()=>!signals.includes('SIGKILL'),signalGroup:(_pid,signal)=>signals.push(signal)});
    const {taskId}=await f.a.startTask({prompt:'x'});await f.a.confirmTask(taskId);f.p.pid=424242;
    f.p.stdout.emit('data',Buffer.from('{"type":"item.completed","item":{"type":"agent_message","text":"result"}}\n'));
    f.p.emit('close',code);
    const result=await bounded(f.a.getTask(taskId));
    assert.ok(signals.includes('SIGTERM')&&signals.includes('SIGKILL'));
    assert.equal(result.status,expected);assert.equal(result.exitCode,code);assert.equal(result.output,'result');
    assert.equal(result.revision,3);assert.equal((await f.a.status()).activeTasks,0);
  });
}
test('explicit cancellation during descendant cleanup remains cancelled',async t=>{
  const signals=[];
  const f=await fixture(t,{killGraceMs:20,groupExists:()=>!signals.includes('SIGKILL'),signalGroup:(_pid,signal)=>signals.push(signal)});
  const {taskId}=await f.a.startTask({prompt:'x'});await f.a.confirmTask(taskId);f.p.pid=424242;f.p.emit('close',0);
  await waitFor(()=>signals.includes('SIGTERM'));
  const result=await bounded(f.a.cancelTask(taskId));
  assert.equal(result.status,'cancelled');assert.equal(result.exitCode,0);
  assert.ok(signals.includes('SIGKILL'));assert.equal((await f.a.status()).activeTasks,0);
});
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

const SESSION='12345678-1234-4234-8234-123456789abc';
async function completedTurn(f,taskId,text='first result'){
 await f.a.confirmTask(taskId);f.p.stdout.emit('data',Buffer.from(JSON.stringify({type:'thread.started',thread_id:SESSION})+'\n'+JSON.stringify({type:'item.completed',item:{type:'agent_message',text}})+'\n'));f.p.emit('close',0);return f.a.getTask(taskId);
}
test('same-task follow-up stays draft, preserves immutable history and resumes only its saved session',async t=>{
 const f=await fixture(t,{resumeVerified:true}),{taskId}=await f.a.startTask({prompt:'first prompt',requestId:'first'});
 const completed=await completedTurn(f,taskId),previous=structuredClone(completed.turns[0]);
 assert.equal(completed.turns[0].prompt,'first prompt');assert.equal(completed.turns[0].output,'first result');
 const options={prompt:'fix the result',revision:completed.revision,requestId:'follow-up'};
 const draft=await f.a.continueTask(taskId,options);assert.equal(draft.id,taskId);assert.equal(draft.status,'draft');assert.equal(draft.turns.length,2);assert.equal(f.calls,1);assert.equal(draft.turns[1].prompt,options.prompt);assert.deepEqual(draft.turns[0],previous);
 assert.deepEqual(await f.a.continueTask(taskId,options),draft);
 await assert.rejects(f.a.continueTask(taskId,{...options,prompt:'changed'}),/conflict/);
 await assert.rejects(f.a.continueTask(taskId,{...options,requestId:'other',sessionId:'model-chosen'}),/argument/);
 const restart=createCodexCliAdapter(f.opts);assert.equal((await restart.getTask(taskId)).status,'draft');assert.deepEqual(await restart.continueTask(taskId,options),draft);
 await restart.confirmTask(taskId,{revision:draft.revision,requestId:'confirm-follow-up'});
 assert.deepEqual(f.args,['exec','--sandbox','workspace-write','resume','--json',SESSION,'-']);assert.equal(f.spawnOptions.cwd,await (await import('node:fs/promises')).realpath(f.opts.projectRoot));assert.equal(f.prompt,'fix the result');
 f.p.stdout.emit('data',Buffer.from(JSON.stringify({type:'thread.started',thread_id:SESSION})+'\n'+JSON.stringify({type:'item.completed',item:{type:'command_execution',command:'npm test',aggregated_output:'1 passed',exit_code:0,status:'completed'}})+'\n'+JSON.stringify({type:'item.completed',item:{type:'file_change',status:'completed',changes:[{path:'src/main.js',kind:'update'}]}})+'\n'+JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'fixed'}})+'\n'));f.p.emit('close',0);
 const final=await restart.getTask(taskId);assert.deepEqual(final.turns[0],previous);assert.equal(final.turns[1].output,'fixed');assert.equal(final.turns[1].status,'completed');assert.ok(final.logs.some(event=>event.itemType==='command_execution'&&event.command==='npm test'&&event.exitCode===0&&event.output==='1 passed'));assert.ok(final.logs.some(event=>event.changes?.[0].path==='src/main.js'));assert.equal(final.turns[1].sessionId,SESSION);assert.ok(final.lastConversationAt>=draft.lastConversationAt);assert.ok(final.turns.every(turn=>turn.createdAt&&turn.completedAt));
});
test('continuation rejects stale revision, running task and quarantine without altering history',async t=>{
 const f=await fixture(t,{resumeVerified:true}),{taskId}=await f.a.startTask({prompt:'first'});const task=await completedTurn(f,taskId);
 await assert.rejects(f.a.continueTask(taskId,{prompt:'next',revision:1,requestId:'stale'}),/revision/);
 const draft=await f.a.continueTask(taskId,{prompt:'next',revision:task.revision,requestId:'next'});
 await f.a.confirmTask(taskId,{revision:draft.revision});await assert.rejects(f.a.continueTask(taskId,{prompt:'again',revision:draft.revision+1,requestId:'running'}),/terminal/);
 const restarted=createCodexCliAdapter(f.opts);await assert.rejects(restarted.continueTask(taskId,{prompt:'again',revision:draft.revision+1,requestId:'restart'}),/quarantin/);f.p.emit('close',0);await f.a.getTask(taskId);
});
test('failed continuation persistence does not publish a RAM-only draft or discard previous evidence',async t=>{
 const tasks=new Map();let refuse=false;const f=await fixture(t,{resumeVerified:true,storeFactory:()=>({list:async()=>[...tasks.values()].map(value=>structuredClone(value)),put:async value=>{if(refuse&&value.turns.length===2)throw Error('disk full');tasks.set(value.id,structuredClone(value));}})});
 const {taskId}=await f.a.startTask({prompt:'first'}),task=await completedTurn(f,taskId);refuse=true;
 await assert.rejects(f.a.continueTask(taskId,{prompt:'next',revision:task.revision,requestId:'next'}),/disk full/);assert.deepEqual(await f.a.getTask(taskId),task);
 refuse=false;assert.equal((await f.a.continueTask(taskId,{prompt:'next',revision:task.revision,requestId:'next'})).turns.length,2);
});
test('confirm replay from a previous turn cannot launch a newly drafted continuation',async t=>{
 const f=await fixture(t,{resumeVerified:true}),{taskId}=await f.a.startTask({prompt:'first'});await f.a.confirmTask(taskId,{revision:1,requestId:'confirm-first'});f.p.stdout.emit('data',Buffer.from(JSON.stringify({type:'thread.started',thread_id:SESSION})+'\n'));f.p.emit('close',0);const task=await f.a.getTask(taskId);
 const draft=await f.a.continueTask(taskId,{prompt:'next',revision:task.revision,requestId:'next'});await f.a.confirmTask(taskId,{revision:1,requestId:'confirm-first'});assert.equal(f.calls,1);assert.equal((await f.a.getTask(taskId)).status,'draft');await assert.rejects(f.a.confirmTask(taskId,{revision:draft.revision,requestId:'confirm-first'}),/conflict/);
});
test('continuation cancellation keeps the previous turn immutable and a mismatched resumed session quarantines',async t=>{
 const f=await fixture(t),{taskId}=await f.a.startTask({prompt:'first'}),first=await completedTurn(f,taskId),history=structuredClone(first.turns[0]);
 const draft=await f.a.continueTask(taskId,{prompt:'fix',revision:first.revision,requestId:'follow'});
 const [a,b]=await Promise.all([f.a.confirmTask(taskId,{revision:draft.revision,requestId:'confirm'}),f.a.confirmTask(taskId,{revision:draft.revision,requestId:'confirm'})]);assert.equal(a.id,b.id);assert.equal(f.calls,2);
 const cancelled=await f.a.cancelTask(taskId);assert.equal(cancelled.turns[1].status,'cancelled');assert.deepEqual(cancelled.turns[0],history);
 const next=await f.a.continueTask(taskId,{prompt:'retry fix',revision:cancelled.revision,requestId:'retry'});await f.a.confirmTask(taskId,{revision:next.revision});
 f.p.stdout.emit('data',Buffer.from(JSON.stringify({type:'thread.started',thread_id:'87654321-4321-4321-8321-cba987654321'})+'\n'));
 const final=await f.a.getTask(taskId);assert.equal(final.sessionId,SESSION);assert.equal(final.quarantined,true);assert.deepEqual(final.turns[0],history);await assert.rejects(f.a.continueTask(taskId,{prompt:'again',revision:final.revision,requestId:'blocked'}),/quarantin/);
});
test('conversation recency changes on messages, while reads and command feedback do not change it',async t=>{
 const f=await fixture(t),{taskId}=await f.a.startTask({prompt:'first'}),initial=await f.a.getTask(taskId);await new Promise(r=>setTimeout(r,5));
 await f.a.confirmTask(taskId);const running=await f.a.getTask(taskId);assert.equal(running.lastConversationAt,initial.lastConversationAt);
 f.p.stdout.emit('data',Buffer.from(JSON.stringify({type:'item.completed',item:{type:'command_execution',command:'test',aggregated_output:'x'.repeat(3000),exit_code:0,status:'completed'}})+'\n'));
 assert.equal((await f.a.getTask(taskId)).lastConversationAt,initial.lastConversationAt);
 f.p.stdout.emit('data',Buffer.from(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'final result'}})+'\n'));f.p.emit('close',0);
 const completed=await f.a.getTask(taskId);assert.ok(completed.lastConversationAt>initial.lastConversationAt);await f.a.listTasks();await f.a.getLogs(taskId);assert.equal((await f.a.getTask(taskId)).lastConversationAt,completed.lastConversationAt);
});
test('resumed session mismatch rejects same-chunk and later content until asynchronous child close',async t=>{
 const f=await fixture(t),{taskId}=await f.a.startTask({prompt:'first'}),first=await completedTurn(f,taskId),history=structuredClone(first.turns[0]);
 const draft=await f.a.continueTask(taskId,{prompt:'fix',revision:first.revision,requestId:'follow'});
 await f.a.confirmTask(taskId,{revision:draft.revision});
 const signals=[];f.p.kill=signal=>{signals.push(signal);return true;};
 const line=event=>JSON.stringify(event)+'\n';
 const message=text=>({type:'item.completed',item:{type:'agent_message',text}});
 await new Promise(r=>setTimeout(r,5));
 f.p.stdout.emit('data',Buffer.from(line({type:'thread.started',thread_id:'87654321-4321-4321-8321-cba987654321'})+line(message('wrong same-chunk result'))));
 f.p.stdout.emit('data',Buffer.from(line({type:'thread.started',thread_id:SESSION})+line(message('wrong later result'))+line({type:'item.completed',item:{type:'command_execution',command:'wrong command',aggregated_output:'wrong output',exit_code:0}})));
 f.p.stderr.emit('data',Buffer.from('wrong-session diagnostic'));
 assert.deepEqual(signals,['SIGTERM']);
 f.p.emit('close',null);
 const final=await f.a.getTask(taskId);
 assert.equal(final.quarantined,true);assert.match(final.error,/different session/);assert.equal(final.status,'cancelled');
 assert.equal(final.sessionId,SESSION);assert.equal(final.resumeSessionId,SESSION);assert.equal(final.output,'');assert.deepEqual(final.logs,[]);
 assert.equal(final.lastConversationAt,draft.lastConversationAt);assert.deepEqual(final.turns[0],history);
 assert.equal(final.turns[1].prompt,'fix');assert.equal(final.turns[1].output,'');assert.deepEqual(final.turns[1].logs,[]);assert.equal(final.turns[1].sessionId,SESSION);assert.match(final.turns[1].error,/different session/);
});
test('execution feedback has a byte budget and does not mutate earlier turns',async t=>{
 const f=await fixture(t),{taskId}=await f.a.startTask({prompt:'first'});await f.a.confirmTask(taskId);
 for(let n=0;n<200;n++)f.p.stdout.emit('data',Buffer.from(JSON.stringify({type:'item.completed',item:{type:'command_execution',command:'test '+n,aggregated_output:'x'.repeat(4000),exit_code:n,status:'completed'}})+'\n'));
 f.p.emit('close',0);const result=await f.a.getTask(taskId);assert.ok(Buffer.byteLength(JSON.stringify(result.logs))<=12000);assert.ok(result.logs.length<200);assert.equal(result.logs.at(-1).exitCode,199);assert.equal(result.logs.at(-1).output.length,2000);assert.deepEqual(result.turns[0].logs,result.logs);
});
