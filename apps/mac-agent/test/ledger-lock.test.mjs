import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,realpath,rm,writeFile,readFile,lstat,readdir,unlink,symlink,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const moduleUrl=new URL('../ledger-lock.mjs',import.meta.url).href;
async function fixture(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'agent-kernel-lock-'))),children=[];
 t.after(async()=>{for(const child of children)if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}await rm(root,{recursive:true,force:true});});
 const stateFile=join(root,'ledger.json');
 function owner(){
  const code=`import {acquireLedgerLock} from ${JSON.stringify(moduleUrl)};let lease;try{lease=await acquireLedgerLock({stateFile:${JSON.stringify(stateFile)},deviceId:'mac'});}catch{process.stdout.write('BUSY\\n');process.exit(2);}process.stdout.write('READY\\n');process.stdin.on('data',async()=>{await lease.release();process.stdin.pause();process.stdout.write('RELEASED\\n');});`;
  const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['pipe','pipe','pipe']});children.push(child);
  let output='',diagnostic='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>diagnostic+=data);
  const ready=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Owner fixture deadline: '+diagnostic)),4000);
   const check=()=>{if(/READY|BUSY/u.test(output)){clearTimeout(timer);resolve(output.includes('READY')?'READY':'BUSY');}};
   child.stdout.on('data',check);child.once('exit',()=>{check();if(!/READY|BUSY/u.test(output)){clearTimeout(timer);reject(Error('Owner exited before acquisition: '+diagnostic));}});
  });
  return {child,ready,get output(){return output}};
 }
 return {root,stateFile,owner};
}

test('simultaneous processes have one winner; a live or suspended owner is never evicted',{timeout:15000},async t=>{
 const f=await fixture(t),a=f.owner(),b=f.owner(),results=await Promise.all([a.ready,b.ready]);assert.deepEqual([...results].sort(),['BUSY','READY']);
 const owner=results[0]==='READY'?a:b;assert.equal(owner.child.kill('SIGSTOP'),true);await delay(20);
 const competitor=f.owner();assert.equal(await competitor.ready,'BUSY');assert.equal(owner.child.kill('SIGCONT'),true);
 const exited=once(owner.child,'exit');owner.child.stdin.write('close');assert.deepEqual(await exited,[0,null]);assert.match(owner.output,/RELEASED/u);
 await assert.rejects(lstat(f.stateFile+'.lock'),{code:'ENOENT'});assert.equal((await lstat(f.stateFile+'.lock.guard')).mode&0o777,0o600);
 const next=f.owner();assert.equal(await next.ready,'READY');
});

test('SIGKILL releases kernel ownership and restart preserves stale metadata without manual deletion',{timeout:15000},async t=>{
 const f=await fixture(t),owner=f.owner();assert.equal(await owner.ready,'READY');
 const before=JSON.parse(await readFile(f.stateFile+'.lock','utf8')),exited=once(owner.child,'exit');owner.child.kill('SIGKILL');assert.deepEqual(await exited,[null,'SIGKILL']);
 assert.equal((await lstat(f.stateFile+'.lock')).isFile(),true);
 const next=f.owner();assert.equal(await next.ready,'READY');assert.notEqual(JSON.parse(await readFile(f.stateFile+'.lock','utf8')).ownerId,before.ownerId);
 const preserved=(await readdir(f.root)).filter(name=>name.startsWith('ledger.json.lock.previous-'));assert.equal(preserved.length,1);assert.deepEqual(JSON.parse(await readFile(join(f.root,preserved[0]),'utf8')),before);
});

test('observation metadata with a reused live PID does not control modern kernel ownership',async t=>{
 const f=await fixture(t);
 const observation={version:2,lockMode:'kernel-flock-v1',deviceId:'mac',pid:process.pid,ownerId:'old-observation',startedAt:'2000-01-01T00:00:00.000Z'};
 await writeFile(f.stateFile+'.lock',JSON.stringify(observation),{mode:0o600});
 const next=f.owner();assert.equal(await next.ready,'READY');assert.equal(process.kill(process.pid,0),true);
 const preserved=(await readdir(f.root)).find(name=>name.startsWith('ledger.json.lock.previous-'));assert.deepEqual(JSON.parse(await readFile(join(f.root,preserved),'utf8')),observation);
});

test('legacy live owners block migration; positively dead legacy owners are preserved and recover automatically',async t=>{
 const f=await fixture(t),legacy={version:1,deviceId:'mac',pid:process.pid,startedAt:new Date().toISOString()};
 await writeFile(f.stateFile+'.lock',JSON.stringify(legacy),{mode:0o600});const blocked=f.owner();assert.equal(await blocked.ready,'BUSY');assert.deepEqual(JSON.parse(await readFile(f.stateFile+'.lock','utf8')),legacy);
 const dead=spawn(process.execPath,['-e',''],{stdio:'ignore'});await once(dead,'exit');await writeFile(f.stateFile+'.lock',JSON.stringify({...legacy,pid:dead.pid}));
 const next=f.owner();assert.equal(await next.ready,'READY');
});

test('failed short-lived acquisition helper leaves no claimed ownership; guard replacement fails closed',async t=>{
 const {acquireLedgerLock}=await import(moduleUrl),f=await fixture(t);
 await assert.rejects(acquireLedgerLock({stateFile:f.stateFile,deviceId:'mac',spawnLock:(_command,_args,options)=>spawnSync('/bin/sh',['-c','kill -KILL $$'],options)}),/ledger lock/u);
 const lease=await acquireLedgerLock({stateFile:f.stateFile,deviceId:'mac'});await lease.assertHeld();
 await unlink(f.stateFile+'.lock.guard');await writeFile(f.stateFile+'.lock.guard','',{mode:0o600});await assert.rejects(lease.assertHeld(),/ledger lock/u);await lease.release();
});
test('kernel guard symlinks and permissive files are refused without altering their contents',async t=>{
 const {acquireLedgerLock}=await import(moduleUrl),f=await fixture(t),target=join(f.root,'canary');
 await writeFile(target,'UNCHANGED',{mode:0o600});await symlink(target,f.stateFile+'.lock.guard');await assert.rejects(acquireLedgerLock({stateFile:f.stateFile,deviceId:'mac'}),/ledger lock/u);assert.equal(await readFile(target,'utf8'),'UNCHANGED');
 await unlink(f.stateFile+'.lock.guard');await writeFile(f.stateFile+'.lock.guard','retained',{mode:0o644});await chmod(f.stateFile+'.lock.guard',0o644);
 await assert.rejects(acquireLedgerLock({stateFile:f.stateFile,deviceId:'mac'}),/ledger lock/u);assert.equal(await readFile(f.stateFile+'.lock.guard','utf8'),'retained');
});
