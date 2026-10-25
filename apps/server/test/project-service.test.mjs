import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm,realpath,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createProjectService} from '../project-service.mjs';

async function fixture(t) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'vox-rpc-project-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const projects=[];
  for (const id of ['alpha','beta']) {
    const path=join(root,id);await mkdir(path);execFileSync('git',['init','-q',path]);
    projects.push({id,name:id.toUpperCase(),root:path,enabled:true});
  }
  const stores=new Map();let seq=0,executions=0;
  const adapterFactory=({projectRoot})=>{
    if (!stores.has(projectRoot)) stores.set(projectRoot,new Map());
    const tasks=stores.get(projectRoot);
    return {
      listTasks:async()=>[...tasks.values()].map(x=>structuredClone(x)),
      getTask:async id=>structuredClone(tasks.get(id)),
      startTask:async({prompt,title,requestId})=>{
        const prior=[...tasks.values()].find(x=>requestId&&x.requestId===requestId);
        if(prior){if(prior.fingerprint!==JSON.stringify([prompt,title??null]))throw Error('requestId conflict');return {taskId:prior.id};}
        const task={id:`task-${++seq}`,status:'draft',revision:1,requestId,fingerprint:JSON.stringify([prompt,title??null])};tasks.set(task.id,task);return {taskId:task.id};
      },
      confirmTask:async(id,{revision,requestId}={})=>{
        const x=tasks.get(id);if(requestId&&x.confirmRequestId===requestId)return structuredClone(x);
        if(x.revision!==revision)throw Error('revision conflict');
        await new Promise(r=>setTimeout(r,5));x.status='running';x.revision++;x.confirmRequestId=requestId;executions++;return structuredClone(x);
      },
      continueTask:async(id,{prompt,revision,requestId})=>{const x=tasks.get(id);if(x.revision!==revision)throw Error('revision conflict');x.status='draft';x.revision++;x.turns??=[];x.turns.push({kind:'continuation',prompt,requestId});return structuredClone(x);},
      cancelTask:async id=>{const x=tasks.get(id);x.status='cancelled';x.revision++;return structuredClone(x);},
      status:async()=>({available:true,version:'fixture-cli',activeTasks:[...tasks.values()].filter(x=>x.status==='running').length}),
      getLogs:async()=>({logs:[]}),getDiff:async()=>({collected:false}),getChecks:async()=>({collected:false}),
    };
  };
  const make=()=>createProjectService({projects,dataDir:join(root,'state'),command:'/fixture/codex',adapterFactory});
  return {root,projects,stores,make,get executions(){return executions;}};
}

test('explicit project routes survive service reconstruction without exposing paths',async t=>{
  const f=await fixture(t),s=await f.make();
  assert.deepEqual((await s.listProjects()).map(x=>Object.keys(x).sort()),Array(2).fill(['enabled','id','name','scopes']));
  const a=await s.startTask({projectId:'alpha',prompt:'one',requestId:'create-a'});
  const b=await s.startTask({projectId:'beta',prompt:'two',requestId:'create-b'});
  const restored=await f.make();
  assert.equal((await restored.getTask(a.taskId)).projectId,'alpha');
  assert.equal((await restored.getTask(b.taskId)).projectId,'beta');
  assert.deepEqual((await restored.listTasks({projectId:'beta'})).map(x=>x.id),[b.taskId]);
  await assert.rejects(()=>restored.startTask({prompt:'missing'}),/project/i);
  await assert.rejects(()=>restored.startTask({projectId:'alpha',prompt:'bad',projectRoot:f.root}),/argument/i);
});

test('project task lists omit full histories and initial metadata prompts while getTask retains them',async t=>{
 const f=await fixture(t),service=await f.make(),{taskId}=await service.startTask({projectId:'alpha',prompt:'p'.repeat(20000),requestId:'large'});
 const stored=f.stores.get(f.projects[0].root).get(taskId);stored.output='o'.repeat(20000);stored.logs=[{output:'log evidence'}];stored.turns=[{prompt:'first request',output:'first result'}];stored.lastConversationAt='2026-10-01T00:00:00.000Z';
 const [summary]=await service.listTasks({projectId:'alpha'});
 assert.ok(Buffer.byteLength(JSON.stringify(summary))<2048);
 for(const key of ['initialPrompt','prompt','output','logs','turns','fingerprint','requestId'])assert.equal(summary[key],undefined);
 assert.equal(summary.projectId,'alpha');assert.equal(summary.metadataRevision,1);assert.equal(summary.archived,false);assert.equal(summary.parentTaskId,null);assert.equal(summary.lastConversationAt,stored.lastConversationAt);
 const full=await service.getTask(taskId);assert.equal(full.initialPrompt.length,20000);assert.deepEqual(full.turns,stored.turns);assert.equal(full.output.length,20000);assert.deepEqual(full.logs,stored.logs);
});

test('cross-project request replay conflicts and parallel confirmation uses one global slot',async t=>{
  const f=await fixture(t),s=await f.make();
  const a=await s.startTask({projectId:'alpha',prompt:'one',requestId:'same'});
  assert.deepEqual(await s.startTask({projectId:'alpha',prompt:'one',requestId:'same'}),a);
  await assert.rejects(()=>s.startTask({projectId:'beta',prompt:'one',requestId:'same'}),/requestId conflict/);
  const b=await s.startTask({projectId:'beta',prompt:'two',requestId:'other'});
  const results=await Promise.allSettled([s.confirmTask(a.taskId,{revision:1,requestId:'confirm-a'}),s.confirmTask(b.taskId,{revision:1,requestId:'confirm-b'})]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.executions,1);
  assert.match(results.find(x=>x.status==='rejected').reason.message,/busy/);
  assert.equal((await s.confirmTask(a.taskId,{revision:1,requestId:'confirm-a'})).status,'running');
  await assert.rejects(()=>s.confirmTask(b.taskId,{revision:1,requestId:'confirm-a'}),/requestId conflict/);
  await s.cancelTask(a.taskId,{requestId:'stop-a'});
  await s.confirmTask(b.taskId,{revision:1,requestId:'confirm-b'});assert.equal(f.executions,2);
});

test('quarantined or cancelling tasks retain global slot across projects and disabled projects',async t=>{
  const f=await fixture(t),s=await f.make();
  const a=await s.startTask({projectId:'alpha',prompt:'one'}),b=await s.startTask({projectId:'beta',prompt:'two'});
  const stored=f.stores.get(f.projects[0].root).get(a.taskId);stored.status='interrupted';stored.quarantined=true;
  await assert.rejects(()=>s.confirmTask(b.taskId,{revision:1}),/quarantin/);
  stored.quarantined=false;stored.status='cancelling';
  await assert.rejects(()=>s.confirmTask(b.taskId,{revision:1}),/busy/);
});

test('operator registry rejects root alias duplicates and state within a project',async t=>{
  const f=await fixture(t);
  await assert.rejects(()=>createProjectService({projects:[f.projects[0],{...f.projects[1],root:f.projects[0].root}],dataDir:join(f.root,'state')}),/duplicate/i);
  await assert.rejects(()=>createProjectService({projects:f.projects,dataDir:join(f.projects[0].root,'state')}),/state/i);
});

test('subtask metadata uses separate CAS, survives restart, and soft delete restores without execution',async t=>{
  const f=await fixture(t),s=await f.make();
  const parent=await s.startTask({projectId:'alpha',prompt:'parent',requestId:'parent'});
  const child=await s.startTask({projectId:'alpha',parentTaskId:parent.taskId,prompt:'child',requestId:'child'});
  assert.equal((await s.getTask(child.taskId)).parentTaskId,parent.taskId);
  await assert.rejects(()=>s.startTask({projectId:'beta',parentTaskId:parent.taskId,prompt:'wrong'}),/Parent/);
  let task=await s.archiveTask(child.taskId,{metadataRevision:1,archived:true,requestId:'archive'});
  assert.equal(task.metadataRevision,2);assert.equal(task.revision,1);
  assert.equal((await s.listTasks({projectId:'alpha'})).length,1);
  assert.equal((await s.listTasks({projectId:'alpha',includeArchived:true})).length,2);
  await assert.rejects(()=>s.confirmTask(child.taskId,{revision:1}),/Restore and unarchive/);
  await assert.rejects(()=>s.archiveTask(child.taskId,{metadataRevision:1,archived:false}),/metadataRevision conflict/);
  task=await s.deleteTask(child.taskId,{metadataRevision:2,requestId:'delete'});assert.equal(typeof task.deletedAt,'string');
  assert.equal((await s.listTasks({projectId:'alpha',includeArchived:true})).length,1);
  assert.equal((await s.listTasks({projectId:'alpha',includeArchived:true,includeDeleted:true})).length,2);
  const restored=await f.make();task=await restored.getTask(child.taskId);assert.equal(task.metadataRevision,3);
  assert.equal(task.initialPrompt,'child');
  assert.ok(task.deletedAt);assert.equal(f.executions,0);
  task=await restored.restoreTask(child.taskId,{metadataRevision:3,requestId:'restore'});assert.equal(task.deletedAt,null);assert.equal(task.metadataRevision,4);assert.equal(f.executions,0);
  assert.equal((await restored.restoreTask(child.taskId,{metadataRevision:3,requestId:'restore'})).metadataRevision,4);
  assert.deepEqual(Object.keys(task).filter(k=>k.includes('Fingerprint')),[]);
});

test('running and quarantined tasks cannot be archived or deleted; deleting parent preserves child',async t=>{
  const f=await fixture(t),s=await f.make();
  const parent=await s.startTask({projectId:'alpha',prompt:'parent'}),child=await s.startTask({projectId:'alpha',parentTaskId:parent.taskId,prompt:'child'});
  await s.confirmTask(parent.taskId,{revision:1});
  await assert.rejects(()=>s.deleteTask(parent.taskId,{metadataRevision:1}),/Stop and reconcile/);
  await assert.rejects(()=>s.archiveTask(parent.taskId,{metadataRevision:1,archived:true}),/Stop and reconcile/);
  await s.cancelTask(parent.taskId);const task=await s.deleteTask(parent.taskId,{metadataRevision:1});assert.ok(task.deletedAt);
  assert.equal((await s.getTask(child.taskId)).deletedAt,null);
  await assert.rejects(()=>s.startTask({projectId:'alpha',parentTaskId:parent.taskId,prompt:'new'}),/Parent/);
});

test('actual CLI store and metadata retain task ownership and dedup across service restart without launching CLI',async t=>{
  const f=await fixture(t),opts={projects:f.projects,dataDir:join(f.root,'actual-state'),command:'/usr/bin/false'};
  const s=await createProjectService(opts),a=await s.startTask({projectId:'alpha',prompt:'persistent draft',requestId:'actual-a'});
  await s.deleteTask(a.taskId,{metadataRevision:1,requestId:'actual-delete'});
  const restart=await createProjectService(opts),task=await restart.getTask(a.taskId);
  assert.equal(task.projectId,'alpha');assert.equal(task.status,'draft');assert.ok(task.deletedAt);assert.equal(task.initialPrompt,'persistent draft');
  assert.equal(task.turns[0].prompt,'persistent draft');
  assert.deepEqual(await restart.startTask({projectId:'alpha',prompt:'persistent draft',requestId:'actual-a'}),a);
  await assert.rejects(()=>restart.startTask({projectId:'beta',prompt:'persistent draft',requestId:'actual-a'}),/requestId conflict/);
  await restart.restoreTask(a.taskId,{metadataRevision:2,requestId:'actual-restore'});
  assert.equal((await restart.cancelTask(a.taskId,{requestId:'actual-cancel'})).status,'cancelled');
});

test('failed metadata rename never becomes a successful RAM-only deletion on retry or restart',async t=>{
  const f=await fixture(t),s=await f.make(),{taskId}=await s.startTask({projectId:'alpha',prompt:'keep history',requestId:'create'});
  const file=join(f.root,'state','task-metadata.json'),original=await readFile(file,'utf8');
  await rm(file);await mkdir(file);
  await assert.rejects(()=>s.deleteTask(taskId,{metadataRevision:1,requestId:'delete'}));
  assert.equal((await s.getTask(taskId)).deletedAt,null);
  await rm(file,{recursive:true});await writeFile(file,original,{mode:0o600});
  const retry=await s.deleteTask(taskId,{metadataRevision:1,requestId:'delete'});
  const restarted=await f.make(),after=await restarted.getTask(taskId),replay=await restarted.deleteTask(taskId,{metadataRevision:1,requestId:'delete'});
  assert.ok(retry.deletedAt);assert.equal(after.deletedAt,retry.deletedAt);assert.equal(replay.deletedAt,retry.deletedAt);assert.equal(after.metadataRevision,2);
});

test('continuation routes to the original project, persists replay identity and rejects hidden tasks',async t=>{
 const f=await fixture(t),service=await f.make(),{taskId}=await service.startTask({projectId:'alpha',prompt:'first',requestId:'create'});
 const stored=f.stores.get(f.projects[0].root).get(taskId);stored.status='completed';stored.revision=3;stored.sessionId='12345678-1234-4234-8234-123456789abc';
 const opts={prompt:'fix result',revision:3,requestId:'continue'},draft=await service.continueTask(taskId,opts);
 assert.equal(draft.projectId,'alpha');assert.equal(draft.status,'draft');assert.equal(draft.turns.at(-1).prompt,'fix result');assert.equal(f.executions,0);
 assert.deepEqual(await service.continueTask(taskId,opts),draft);const restarted=await f.make();assert.deepEqual(await restarted.continueTask(taskId,opts),draft);
 await assert.rejects(service.continueTask(taskId,{...opts,prompt:'changed'}),/requestId conflict/);
 await assert.rejects(service.continueTask(taskId,{...opts,requestId:'other',sessionId:'input'}),/argument/);
 await service.archiveTask(taskId,{metadataRevision:1,archived:true});await assert.rejects(service.continueTask(taskId,{prompt:'next',revision:4,requestId:'hidden'}),/Restore and unarchive/);
 await service.archiveTask(taskId,{metadataRevision:2,archived:false});await service.deleteTask(taskId,{metadataRevision:3});await assert.rejects(service.continueTask(taskId,{prompt:'next',revision:4,requestId:'deleted'}),/Restore and unarchive/);
});

test('continuation pending ledger recovers a persisted turn after the final ledger receipt fails',async t=>{
 const f=await fixture(t),service=await f.make(),{taskId}=await service.startTask({projectId:'alpha',prompt:'first',requestId:'create'});
 const stored=f.stores.get(f.projects[0].root).get(taskId);stored.status='completed';stored.revision=3;
 const ledger=join(f.root,'state','request-ledger.json'),opts={prompt:'next',revision:3,requestId:'continuation'};
 // Seed the on-disk state at the exact crash boundary: turn persisted, ledger pending.
 stored.status='draft';stored.revision=4;stored.turns=[{kind:'continuation',requestId:opts.requestId,prompt:opts.prompt}];
 const rows=JSON.parse(await readFile(ledger,'utf8'));rows['id:'+opts.requestId]={fingerprint:JSON.stringify(['continue',taskId,opts.prompt,opts.revision]),state:'pending'};await writeFile(ledger,JSON.stringify(rows));
 const restart=await f.make(),task=await restart.continueTask(taskId,opts);assert.equal(task.revision,4);assert.equal(task.turns.length,1);assert.equal(f.executions,0);
});

test('persisted metadata reconciles a failed ledger completion after restart',async t=>{
  const f=await fixture(t),s=await f.make(),{taskId}=await s.startTask({projectId:'alpha',prompt:'one',requestId:'create'});
  const state=join(f.root,'state'),ledgerFile=join(state,'request-ledger.json'),saved=await readFile(ledgerFile,'utf8');
  // A metadata operation without a request identity creates the persisted target.
  const result=await s.deleteTask(taskId,{metadataRevision:1});
  const ledger=JSON.parse(saved);ledger['id:delete']={fingerprint:JSON.stringify(['delete',taskId,1,null]),state:'pending'};
  await writeFile(ledgerFile,JSON.stringify(ledger),{mode:0o600});
  const restarted=await f.make();assert.equal((await restarted.deleteTask(taskId,{metadataRevision:1,requestId:'delete'})).deletedAt,result.deletedAt);
  assert.equal((await (await f.make()).getTask(taskId)).deletedAt,result.deletedAt);
});

test('queued and approval-waiting tasks cannot be hidden or deleted',async t=>{
  const f=await fixture(t),s=await f.make(),{taskId}=await s.startTask({projectId:'alpha',prompt:'one'});
  const stored=f.stores.get(f.projects[0].root).get(taskId);
  for(const status of ['queued','waiting_approval','approval_required']){
    stored.status=status;
    await assert.rejects(()=>s.archiveTask(taskId,{metadataRevision:1,archived:true}),/Stop and reconcile/);
    await assert.rejects(()=>s.deleteTask(taskId,{metadataRevision:1}),/Stop and reconcile/);
  }
});

test('failed pending-ledger write prevents mutation and the same identity can retry after repair',async t=>{
  const f=await fixture(t),s=await f.make(),{taskId}=await s.startTask({projectId:'alpha',prompt:'one',requestId:'create'});
  const file=join(f.root,'state','request-ledger.json'),original=await readFile(file,'utf8');
  await rm(file);await mkdir(file);
  await assert.rejects(()=>s.deleteTask(taskId,{metadataRevision:1,requestId:'delete'}));
  assert.equal((await s.getTask(taskId)).deletedAt,null);
  await rm(file,{recursive:true});await writeFile(file,original,{mode:0o600});
  const result=await s.deleteTask(taskId,{metadataRevision:1,requestId:'delete'});
  assert.equal((await (await f.make()).getTask(taskId)).deletedAt,result.deletedAt);
});
