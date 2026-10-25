import test from 'node:test';
import assert from 'node:assert/strict';

const label='io.voxcode.control-task',agent='io.voxcode.control-agent';
async function fixture(options={}){
 const module=await import('../control/mac-launchctl.mjs').catch(()=>null);
 assert.equal(typeof module?.createMacLaunchctl,'function','the owned launchctl helper is available');
 let time=0,job=true,pid=true,attempts=0,stopAt=null;
 const calls=[],events=[],identity={uid:501,command:'/node /task start',birth:'original'};
 const descriptor={label,plistPath:'/Users/test/Library/LaunchAgents/'+label+'.plist',args:['/usr/bin/env','-i','/node','/task','start']};
 const missing=()=>Object.assign(Error('hidden inherited environment'),{code:113,stderr:'Could not find service'});
 const helper=module.createMacLaunchctl({jobs:[descriptor],uid:501,now:()=>time,delay:async ms=>{time+=ms;},timeoutMs:100,pollMs:10,onEvent:event=>events.push(event),inspectProcess:async()=>pid?identity:null,verifyRegistration:async()=>{if(options.registrationChanged)throw Object.assign(Error('private configuration'),{code:'ownership'});},run:async(command,args)=>{
  calls.push(args[0]);
  if(stopAt!==null){if(time-stopAt>=(options.unloadMs??20))job=false;if(time-stopAt>=(options.exitMs??40))pid=false;}
  if(args[0]==='print'){
   if(!job)throw missing();
   return {stdout:`path = ${descriptor.plistPath}\ntype = LaunchAgent\nprogram = /usr/bin/env\nstate = running\npid = 77\narguments = {\n${descriptor.args.join('\n')}\n}\n`};
  }
  if(args[0]==='bootout'){stopAt=time;return {stdout:''};}
  if(args[0]==='bootstrap'){
   attempts++;
   if(options.failure||attempts<=(options.transientFailures??0))throw Object.assign(Error('secret diagnostics'),{code:options.failure??5,stderr:options.failure||options.otherStderr?'unrelated failure':'Bootstrap failed: 5: Input/output error\nTry re-running the command as root for richer errors.'});
   job=true;pid=true;stopAt=null;return {stdout:''};
  }
 }});
 return {helper,calls,events,descriptor,get time(){return time;},get attempts(){return attempts;}};
}

test('bootout waits for both job unload and original PID exit before bootstrap',async()=>{
 const f=await fixture();await f.helper.stop(label);assert.equal(f.time,40);assert.equal(f.attempts,0);await f.helper.start(label);assert.equal(f.attempts,1);assert.ok(f.events.some(x=>x.phase==='stopped'&&x.elapsedMs===40));
});
test('bootstrap error 5 is retried only after an owned completed stop',async()=>{
 const f=await fixture({transientFailures:2});await f.helper.stop(label);await f.helper.start(label);assert.equal(f.attempts,3);assert.ok(f.events.filter(x=>x.phase==='bootstrap_retry').length===2);
});
test('a repeated transient error reaches its bounded deadline with sanitized evidence',async()=>{
 const f=await fixture({transientFailures:100});await f.helper.stop(label);await assert.rejects(f.helper.start(label),e=>e.code==='bootstrap_timeout'&&!e.message.includes('secret'));assert.ok(f.attempts<=11);
});
test('nontransient bootstrap failures are not retried',async()=>{
 const f=await fixture({failure:78});await f.helper.stop(label);await assert.rejects(f.helper.start(label),{code:'bootstrap_failed'});assert.equal(f.attempts,1);
 const other=await fixture({transientFailures:3,otherStderr:true});await other.helper.stop(label);await assert.rejects(other.helper.start(label),{code:'bootstrap_failed'});assert.equal(other.attempts,1);
});
test('a live original PID blocks startup even after the job is absent',async()=>{
 const f=await fixture({exitMs:1000});await assert.rejects(f.helper.stop(label),{code:'stop_timeout'});assert.equal(f.attempts,0);
});
test('duplicate start does not bootstrap an already owned running job',async()=>{
 const f=await fixture();await f.helper.start(label);await f.helper.start(label);assert.equal(f.attempts,0);
});
test('unknown labels and changed registrations fail before mutations',async()=>{
 const f=await fixture();await assert.rejects(f.helper.stop('unrelated'),{code:'ownership'});assert.deepEqual(f.calls,[]);
 const changed=await fixture({registrationChanged:true});await assert.rejects(changed.helper.stop(label),{code:'ownership'});assert.deepEqual(changed.calls,[]);
});

async function restartFixture(options={}){
 const module=await import('../control/restart-mac.mjs').catch(()=>null);assert.equal(typeof module?.restartOwnedMac,'function');
 const calls=[];let held=false,starts=0,active=options.active??0;
 const driver={acquireLock:async()=>{if(held)throw Object.assign(Error(),{code:'restart_busy'});held=true;return {release:async()=>{held=false;}};},verify:async()=>{calls.push('verify');},taskStatus:async()=>({available:true,activeTasks:active,quarantined:false}),waitTaskReady:async()=>{calls.push('ready');},launch:{stop:async name=>{calls.push('stop:'+name);if(options.pause)await options.pause();},start:async name=>{calls.push('start:'+name);if(name===agent&&options.failAgent&&starts++===0)throw Error('agent failed');},settleStopped:async()=>{calls.push('settle');}}};
 return {driver,calls,restart:()=>module.restartOwnedMac(driver),setActive:value=>{active=value;}};
}
test('restart refuses active tasks before stopping any service',async()=>{
 const f=await restartFixture({active:1});await assert.rejects(f.restart(),{code:'task_busy'});assert.ok(!f.calls.some(x=>x.startsWith('stop:')));
});
test('restart stops Agent before task and starts task/RPC before Agent',async()=>{
 const f=await restartFixture();await f.restart();assert.deepEqual(f.calls.filter(x=>x!=='verify'),['stop:'+agent,'stop:'+label,'start:'+label,'ready','start:'+agent]);
});
test('failed startup restores the prior owned running services and verifies rollback',async()=>{
 const f=await restartFixture({failAgent:true});await assert.rejects(f.restart(),e=>e.code==='restart_failed'&&e.rollbackConfirmed===true);assert.deepEqual(f.calls.slice(-5),['settle','start:'+label,'ready','start:'+agent,'verify']);
});
test('a duplicate concurrent restart cannot reach service mutations',async()=>{
 let release;const pause=new Promise(resolve=>{release=resolve;});const f=await restartFixture({pause:()=>pause});const first=f.restart();await new Promise(resolve=>setImmediate(resolve));await assert.rejects(f.restart(),{code:'restart_busy'});release();await first;assert.equal(f.calls.filter(x=>x==='stop:'+agent).length,1);
});
test('configured voice idle is independent of task restart readiness',async()=>{
 const f=await restartFixture();f.driver.taskStatus=async()=>({available:true,activeTasks:0,quarantined:false,voiceProviderState:'idle'});await f.restart();
});
test('a task admitted after Agent stop is preserved while Agent access is restored',async()=>{
 const f=await restartFixture();let stops=0;
 f.driver.launch.stop=async name=>{f.calls.push('stop:'+name);stops++;f.setActive(1);};
 f.driver.waitTaskReady=async options=>{assert.equal(options?.allowActive,true);f.calls.push('ready');};
 await assert.rejects(f.restart(),error=>error.rollbackConfirmed===true);assert.equal(stops,1);assert.ok(!f.calls.includes('stop:'+label));
});
test('rollback failure stays explicit and releases the restart guard',async()=>{
 const f=await restartFixture({failAgent:true});f.driver.launch.settleStopped=async()=>{throw Error('still stopping');};
 await assert.rejects(f.restart(),error=>error.rollbackConfirmed===false);await f.restart();
});
test('the CLI rejects unsupported operations before inspecting an installation',async()=>{
 const {main}=await import('../control/restart-mac.mjs');await assert.rejects(main(['delete']),{code:'usage'});await assert.rejects(main(['restart','--label','unrelated']),{code:'usage'});
});

test('real owned fixture records delayed process shutdown without touching installed services',{skip:process.platform!=='darwin'||process.env.VOXCODE_TEST_LAUNCHD!=='1',timeout:30000},async t=>{
 const fs=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{promisify}=await import('node:util'),{execFile}=await import('node:child_process'),{setTimeout:pause}=await import('node:timers/promises');
 const execute=promisify(execFile),root=await fs.realpath(await fs.mkdtemp(tmpdir()+'/voxcode-launchctl-')),fixtureLabel='io.voxcode.restart-fixture.'+process.pid,plistPath=root+'/fixture.plist',script=root+'/fixture.mjs',uid=process.getuid(),events=[];
 const args=['/usr/bin/env','-i',process.execPath,script];
 await fs.writeFile(script,`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(root+'/ready')},String(process.pid));process.once('SIGTERM',()=>setTimeout(()=>process.exit(0),1200));setInterval(()=>{},1000);`,{mode:0o600});
 await fs.writeFile(plistPath,JSON.stringify({Label:fixtureLabel,ProgramArguments:args,RunAtLoad:true,KeepAlive:false,WorkingDirectory:root,StandardOutPath:root+'/out',StandardErrorPath:root+'/err'}),{mode:0o600});
 const run=async(command,argv,options={})=>{
  const result=await execute(command,argv,{timeout:Math.min(5000,options.timeout??5000),env:{PATH:'/usr/bin:/bin'}});
  if(argv[0]==='bootout'){const original=Number(await fs.readFile(root+'/ready','utf8'));let alive=false;try{process.kill(original,0);alive=true;}catch{}events.push({phase:'bootout_returned',originalPidAlive:alive});}
  return result;
 };
 const {createMacLaunchctl}=await import('../control/mac-launchctl.mjs');
 const helper=createMacLaunchctl({jobs:[{label:fixtureLabel,plistPath,args}],uid,run,onEvent:event=>events.push(event),timeoutMs:8000,pollMs:50,verifyRegistration:async()=>{},inspectProcess:async pid=>{
  try{await execute('/bin/ps',['-p',String(pid),'-o','pid=']);return {uid,command:args.slice(2).join(' '),birth:String(pid)};}catch(error){if(error.code===1)return null;throw error;}
 }});
 try{
  await run('/usr/bin/plutil',['-convert','xml1',plistPath]);await run('/bin/launchctl',['bootstrap',`gui/${uid}`,plistPath]);
  for(let n=0;;n++){try{await fs.access(root+'/ready');break;}catch{if(n>100)throw Error('fixture_start_timeout');await pause(50);}}
  await helper.stop(fixtureLabel);await fs.unlink(root+'/ready');await helper.start(fixtureLabel);
  for(let n=0;;n++){try{await fs.access(root+'/ready');break;}catch{if(n>100)throw Error('fixture_restart_timeout');await pause(50);}}
  await helper.stop(fixtureLabel);
  assert.ok(events.filter(event=>event.phase==='stopped').length===2);t.diagnostic(JSON.stringify({evidence:'local-launchd-fixture',events}));
 }finally{
  try{await run('/bin/launchctl',['bootout',`gui/${uid}/${fixtureLabel}`]);}catch{}
  await fs.rm(root,{recursive:true,force:true});
 }
});
