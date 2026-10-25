import {performance} from 'node:perf_hooks';
import {setTimeout as sleep} from 'node:timers/promises';

const failure=(code,label)=>Object.assign(Error(`Mac service ${code}${label?': '+label:''}`),{code,label});
const sameProcess=(a,b)=>a&&b&&a.uid===b.uid&&a.command===b.command&&a.birth===b.birth;
const transient=error=>Number(error.code??error.status)===5&&/^Bootstrap failed: 5: Input\/output error(?:\r?\n|$)/u.test(error.stderr??'');

export function createMacLaunchctl({jobs,uid,run,inspectProcess,verifyRegistration,now=()=>performance.now(),delay=sleep,timeoutMs=15000,pollMs=250,onEvent=()=>{}}={}){
 if(!Array.isArray(jobs)||jobs.length<1||!Number.isInteger(uid)||uid<=0||typeof run!=='function'||typeof inspectProcess!=='function'||typeof verifyRegistration!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<1||!Number.isFinite(pollMs)||pollMs<1)throw failure('configuration');
 const registry=new Map(jobs.map(job=>[job.label,job])),receipts=new Map(),domain=`gui/${uid}`;
 if(registry.size!==jobs.length)throw failure('configuration');
 const descriptor=label=>{const value=registry.get(label);if(!value)throw failure('ownership',label);return value;};
 const emit=(phase,label,start,extra={})=>{try{onEvent({phase,label,elapsedMs:Math.max(0,Math.round(now()-start)),...extra});}catch{}};
 async function job(label,end=now()+timeoutMs){
  const expected=descriptor(label);await verifyRegistration(expected);
  let stdout;
  try{({stdout}=await run('/bin/launchctl',['print',`${domain}/${label}`],{timeout:Math.max(1,Math.ceil(end-now()))}));}
  catch(error){if(Number(error.code??error.status)===113)return null;throw failure('inspect_failed',label);}
  const field=name=>new RegExp(`^\\s*${name} = (.+)$`,'mu').exec(stdout)?.[1]?.trim();
  const block=/^\s*arguments = \{\r?\n([\s\S]*?)^\s*\}/mu.exec(stdout),args=block?.[1].split(/\r?\n/u).map(x=>x.trim()).filter(Boolean);
  const pid=Number(field('pid')??0);
  if(field('path')!==expected.plistPath||field('type')!=='LaunchAgent'||field('program')!=='/usr/bin/env'||JSON.stringify(args)!==JSON.stringify(expected.args)||!Number.isSafeInteger(pid)||pid<0)throw failure('ownership',label);
  const identity=pid?await inspectProcess(pid):null,index=expected.args.findIndex((value,i)=>i>=2&&value.startsWith('/')&&!value.includes('='));
  if(pid&&(!identity||identity.uid!==uid||index<2||identity.command!==expected.args.slice(index).join(' ')))throw failure('ownership',label);
  return {pid,identity,state:field('state')};
 }
 async function settleStopped(label){
  descriptor(label);const receipt=receipts.get(label);if(!receipt)return;
  const start=now(),end=start+timeoutMs;
  for(;;){
   const current=await job(label,end),original=receipt.pid?await inspectProcess(receipt.pid):null;
   if(!current&&!sameProcess(original,receipt.identity)){receipt.complete=true;emit('stopped',label,receipt.startedAt,{pid:receipt.pid,jobUnloaded:true,originalPidExited:true});return;}
   if(now()>=end)throw failure('stop_timeout',label);
   await delay(Math.min(pollMs,end-now()));
  }
 }
 return {
  inspect:job,settleStopped,
  async stop(label){
   const current=await job(label);if(!current)throw failure('ownership',label);
   const receipt={...current,startedAt:now(),complete:false};receipts.set(label,receipt);
   try{await run('/bin/launchctl',['bootout',`${domain}/${label}`]);}catch{receipts.delete(label);throw failure('bootout_failed',label);}
   await settleStopped(label);
  },
  async start(label){
   const expected=descriptor(label),start=now(),end=start+timeoutMs;let submitted=false,attempt=0;
   for(;;){
    const current=await job(label,end);
    if(current?.pid&&current.state==='running'){receipts.delete(label);emit('started',label,start,{pid:current.pid,attempts:attempt});return current;}
    if(!current&&!submitted){
     const receipt=receipts.get(label);if(!receipt?.complete)throw failure('ownership',label);
     attempt++;
     try{await run('/bin/launchctl',['bootstrap',domain,expected.plistPath],{timeout:Math.max(1,Math.ceil(end-now()))});submitted=true;}
     catch(error){
      if(!transient(error))throw failure('bootstrap_failed',label);
      emit('bootstrap_retry',label,start,{attempt});
     }
    }
    if(now()>=end)throw failure('bootstrap_timeout',label);
    await delay(Math.min(pollMs,end-now()));
   }
  },
 };
}
