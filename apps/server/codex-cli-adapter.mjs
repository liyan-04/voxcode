import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {realpathSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {createTaskStore} from './task-store.mjs';
const exec=promisify(execFile),clone=x=>structuredClone(x);
const sessionId=value=>typeof value==='string'&&/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu.test(value);
const conflict=message=>Object.assign(Error(message),{code:'revision_conflict'});
const summaryStrings={id:128,title:200,status:80,createdAt:80,lastConversationAt:80,sessionId:128,resumeSessionId:128,error:1000,startedAt:80,completedAt:80,projectId:64,parentTaskId:128,deletedAt:80};
export function summarizeTask(task){
  const summary={};
  for(const [key,limit] of Object.entries(summaryStrings)){
    if(typeof task[key]==='string')summary[key]=task[key].slice(0,limit);else if(task[key]===null)summary[key]=null;
  }
  for(const key of ['revision','metadataRevision','exitCode'])if(Number.isSafeInteger(task[key])||task[key]===null)summary[key]=task[key];
  for(const key of ['quarantined','archived'])if(typeof task[key]==='boolean')summary[key]=task[key];
  return summary;
}
function syncTurn(task){
  const turn=task.turns.at(-1);
  for(const key of ['status','revision','output','logs','sessionId','exitCode','error','quarantined','startedAt','completedAt','confirmRequestId','confirmFingerprint']){
    if(task[key]!==undefined)turn[key]=clone(task[key]);else delete turn[key];
  }
}

export function createCodexCliAdapter({command='codex',projectRoot,dataDir,resumeVerified=true,spawnImpl=spawn,storeFactory=createTaskStore,timeoutMs=1800000,killGraceMs=1000,signalGroup=(pid,s)=>process.kill(-pid,s),groupExists=pid=>{try{process.kill(-pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}},probeCli=async()=>{try{const {stdout}=await exec(command,['--version'],{timeout:5000,maxBuffer:4096});return {available:true,version:stdout.trim()};}catch{return {available:false};}}}={}) {
  if(typeof projectRoot!=='string')throw new Error('projectRoot required');
  const root=realpathSync(projectRoot),store=storeFactory(resolve(dataDir??'.voxcode','tasks.json')),running=new Map(),tasks=new Map();let serial=Promise.resolve();
  const save=t=>{syncTurn(t);return store.put(clone(t));};
  const ready=(async()=>{for(const t of await store.list()){
    t.turns??=[{id:randomUUID(),kind:'initial',prompt:t.prompt??null,createdAt:t.createdAt,legacyPromptUnavailable:t.prompt===undefined}];
    t.lastConversationAt??=t.createdAt;t.revision??=1;syncTurn(t);
    if(['running','cancelling'].includes(t.status)){t.status='interrupted';t.quarantined=true;t.error='Previous process ownership unknown; task was not restarted';await save(t);}
    tasks.set(t.id,t);
  }})();
  const locked=fn=>{const operation=serial.then(fn);serial=operation.catch(()=>{});return operation;};
  const get=async id=>{
    await ready;const key=typeof id==='object'?id.taskId:id,entry=running.get(key);
    if(entry?.finishPromise)await entry.finishPromise;
    await store.list();const t=tasks.get(key);if(!t)throw new Error('task not found');return clone(t);
  };
  function requestKey(value){if(value!==undefined&&(typeof value!=='string'||!value||value.length>128))throw new Error('invalid requestId');}
  async function startTask({prompt,title,projectRoot:requested='.',requestId,resumeSessionId}={}){
    await ready;return locked(async()=>{
      requestKey(requestId);if(resumeSessionId!==undefined)throw new Error('Session selection is not a task argument');
      if(typeof prompt!=='string'||!prompt.trim()||prompt.length>20000)throw new Error('prompt required');
      if(realpathSync(resolve(root,requested))!==root)throw new Error('project must equal configured root');
      const fingerprint=JSON.stringify([prompt,title??null,resumeSessionId??null]);
      if(requestId){const prior=[...tasks.values()].find(t=>t.requestId===requestId);if(prior){if(prior.fingerprint!==fingerprint)throw new Error('requestId conflict');return {taskId:prior.id};}}
      const createdAt=new Date().toISOString();
      const task={id:randomUUID(),title:typeof title==='string'?title.slice(0,200):'Codex task',prompt,status:'draft',revision:1,createdAt,lastConversationAt:createdAt,output:'',logs:[],requestId,fingerprint,turns:[{id:randomUUID(),kind:'initial',prompt,createdAt,requestId}]};
      await save(task);tasks.set(task.id,task);return {taskId:task.id};
    });
  }

  async function continueTask(id,options={}){
    await ready;return locked(async()=>{
      if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['prompt','revision','requestId'].includes(key)))throw new Error('Invalid continuation arguments');
      const t=tasks.get(id);if(!t)throw new Error('task not found');
      const {prompt,revision,requestId}=options;requestKey(requestId);
      if(!requestId||!Number.isSafeInteger(revision)||revision<1||typeof prompt!=='string'||!prompt.trim()||prompt.length>20000)throw new Error('Invalid continuation arguments');
      const fingerprint=JSON.stringify(['continue',id,prompt,revision]);
      const prior=[...tasks.values()].flatMap(task=>task.turns).find(turn=>turn.kind==='continuation'&&turn.requestId===requestId);
      if(prior){if(prior.fingerprint!==fingerprint)throw Object.assign(Error('requestId conflict'),{code:'request_conflict'});return clone(t);}
      if([...tasks.values()].some(task=>task.quarantined))throw Object.assign(Error('Task quarantine requires reconciliation'),{code:'quarantined'});
      if(!['completed','failed','cancelled'].includes(t.status)||running.has(id))throw Object.assign(Error('Continuation requires a terminal task'),{code:'busy'});
      if(t.revision!==revision)throw conflict('revision conflict');
      if(!sessionId(t.sessionId))throw new Error('Task has no verified UUID session');
      const next=clone(t),createdAt=new Date().toISOString();
      next.status='draft';next.revision++;next.prompt=prompt;next.output='';next.logs=[];next.resumeSessionId=t.sessionId;next.lastConversationAt=createdAt;
      for(const key of ['confirmRequestId','confirmFingerprint','exitCode','error','startedAt','completedAt'])delete next[key];
      next.turns.push({id:randomUUID(),kind:'continuation',prompt,createdAt,requestId,fingerprint,resumeSessionId:t.sessionId});
      // Keep every retained turn; refuse a new draft before it can exceed the RPC result budget.
      if(Buffer.byteLength(JSON.stringify(next))>600000)throw new Error('Task history capacity reached; create a new task');
      await save(next);tasks.set(id,next);return clone(next);
    });
  }

  // Install the complete starting entry before any persistence await. Cancellation
  // records intent immediately, even when the initial running receipt is blocked.
  function executionEntry(t){
    const entry={task:t,child:null,launchSettled:false,stopping:false,finishing:false,eventDirty:false,eventWriter:null,buffer:''};
    entry.closed=new Promise(resolveClosed=>{entry.resolve=resolveClosed;});
    const persistenceFailure=()=>{t.quarantined=true;t.error='Task persistence failed; execution requires reconciliation';};
    const observe=operation=>{void operation.catch(()=>{t.quarantined=true;t.error='Task lifecycle cleanup failed; execution requires reconciliation';entry.resolve();});};
    function signal(signalName){
      const child=entry.child;if(!child)return;
      try{if(child.pid)signalGroup(child.pid,signalName);else child.kill(signalName);}catch(e){if(e.code!=='ESRCH'){t.quarantined=true;t.error='Unable to signal task process group';}}
    }
    entry.stop=()=>{
      if(entry.finished)return Promise.resolve();
      if(entry.stopPromise)return entry.stopPromise;
      entry.stopping=true;t.status='cancelling';t.revision++;
      // Persistence errors cannot suppress TERM/KILL, and every caller shares
      // the same observed persistence attempt rather than a boolean-only latch.
      entry.stopPromise=Promise.resolve().then(()=>save(t)).catch(persistenceFailure);
      if(entry.child){entry.escalation=setTimeout(()=>signal('SIGKILL'),killGraceMs);signal('SIGTERM');}
      else if(entry.launchSettled)observe(entry.finish(null,false));
      return entry.stopPromise;
    };
    function queueEventSave(){
      entry.eventDirty=true;if(entry.eventWriter||entry.finishing||entry.stopping)return;
      entry.eventWriter=(async()=>{
        while(entry.eventDirty&&!entry.finishing&&!entry.stopping){entry.eventDirty=false;await save(t);}
      })().catch(()=>{persistenceFailure();observe(entry.stop());}).finally(()=>{
        entry.eventWriter=null;
        if(entry.eventDirty&&!entry.finishing&&!entry.stopping)queueEventSave();
      });
    }
    entry.event=line=>{
      if(entry.sessionRejected)return;
      let event;try{event=JSON.parse(line);}catch{return;}
      if(event.type==='thread.started'&&typeof event.thread_id==='string'){
        if(t.resumeSessionId&&event.thread_id!==t.resumeSessionId){entry.sessionRejected=true;t.quarantined=true;t.error='Resumed CLI returned a different session';observe(entry.stop());return;}
        t.sessionId=event.thread_id;
      }
      if(event.type==='item.completed'&&event.item?.type==='agent_message'&&typeof event.item.text==='string'){t.output=event.item.text.slice(-20000);t.lastConversationAt=new Date().toISOString();}
      const log={type:String(event.type??'unknown').slice(0,80),at:new Date().toISOString()},item=event.item;
      if(item&&typeof item==='object'){
        log.itemType=String(item.type??'unknown').slice(0,80);if(typeof item.status==='string')log.status=item.status.slice(0,80);
        if(item.type==='command_execution'){if(typeof item.command==='string')log.command=item.command.slice(0,1000);if(typeof item.aggregated_output==='string')log.output=item.aggregated_output.slice(-2000);if(Number.isInteger(item.exit_code))log.exitCode=item.exit_code;}
        if(item.type==='file_change'&&Array.isArray(item.changes))log.changes=item.changes.slice(0,16).map(change=>({path:String(change.path??'').slice(0,300),kind:String(change.kind??'').slice(0,40)}));
      }
      t.logs.push(log);while(t.logs.length>200||Buffer.byteLength(JSON.stringify(t.logs))>12000)t.logs.shift();
      queueEventSave();
    };
    entry.finish=(code,failed)=>{
      if(entry.finishPromise)return entry.finishPromise;
      entry.finishing=true;clearTimeout(entry.timeout);
      if(entry.buffer){entry.event(entry.buffer);entry.buffer='';}
      entry.eventDirty=false;
      // Publish the shared promise before signalling: fixture children and some
      // launch errors can synchronously report close from a stop callback.
      entry.finishPromise=Promise.resolve().then(async()=>{
        let cleanupConfirmed=true;
        try{
          if(entry.child?.pid&&groupExists(entry.child.pid)){
            // Cleaning up descendants after exit does not imply cancellation.
            signal('SIGTERM');await delay(killGraceMs);signal('SIGKILL');
            for(let n=0;n<100&&groupExists(entry.child.pid);n++)await delay(20);
            if(groupExists(entry.child.pid)){cleanupConfirmed=false;t.quarantined=true;t.error='Process group cleanup unconfirmed';}
          }
        }catch(e){cleanupConfirmed=false;t.quarantined=true;t.error='Process cleanup failed: '+e.code;}
        // At most one event snapshot is in flight. It and the cancelling receipt
        // settle before the terminal receipt so a late write cannot revive it.
        if(entry.eventWriter)await entry.eventWriter;
        if(entry.stopPromise)await entry.stopPromise;
        if(cleanupConfirmed){
          clearTimeout(entry.escalation);
          t.status=entry.stopping?'cancelled':failed||code!==0?'failed':'completed';t.exitCode=code;t.revision++;t.completedAt=new Date().toISOString();delete t.prompt;
        }else t.status='cancelling';
        try{await save(t);}catch{persistenceFailure();}
        if(cleanupConfirmed&&!t.quarantined)running.delete(t.id);
      }).catch(()=>{t.quarantined=true;t.error='Task lifecycle cleanup failed; execution requires reconciliation';}).finally(()=>{entry.finished=true;entry.resolve();});
      return entry.finishPromise;
    };
    entry.failedPersistence=persistenceFailure;entry.observe=observe;
    return entry;
  }

  async function confirmTask(input,options={}){
    await ready;return locked(async()=>{
      const id=typeof input==='object'?input.taskId:input,opts=typeof input==='object'?input:options,t=tasks.get(id);
      if(!t)throw new Error('task not found');requestKey(opts.requestId);
      const fingerprint=JSON.stringify([id,opts.revision??null]);
      const prior=opts.requestId&&t.turns.find(turn=>turn.confirmRequestId===opts.requestId);
      if(prior){if(prior.confirmFingerprint!==fingerprint)throw Object.assign(Error('requestId conflict'),{code:'request_conflict'});return clone(t);}
      if(opts.revision!==undefined&&opts.revision!==t.revision)throw conflict('revision conflict');
      if([...tasks.values()].some(x=>x.quarantined))throw new Error('task is quarantined and requires reconciliation');
      if(t.status!=='draft')throw new Error('task is not a draft');if(running.size)throw new Error('Codex execution slot busy');
      if(t.resumeSessionId&&!resumeVerified)throw new Error('Resume execution is disabled until sandbox verification');
      if(t.resumeSessionId&&(!sessionId(t.resumeSessionId)||t.resumeSessionId!==t.sessionId))throw new Error('Invalid saved session');
      const entry=executionEntry(t);running.set(id,entry);t.status='running';t.revision++;t.confirmRequestId=opts.requestId;t.confirmFingerprint=fingerprint;t.startedAt=new Date().toISOString();
      try{await save(t);}catch(error){
        entry.launchSettled=true;entry.failedPersistence();t.status=entry.stopping?'cancelling':'interrupted';
        if(entry.stopping)await entry.finish(null,false);else try{await save(t);}catch{entry.failedPersistence();}
        throw error;
      }
      entry.launchSettled=true;
      if(entry.stopping){await entry.finish(null,false);return clone(t);}
      const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(VOXCODE_|LINX_|MCP_)/.test(k)));
      const args=t.resumeSessionId?['exec','--sandbox','workspace-write','resume','--json',t.resumeSessionId,'-']:['exec','--json','--sandbox','workspace-write','-'];
      try{entry.child=spawnImpl(command,args,{cwd:root,env,detached:true,stdio:['pipe','pipe','pipe']});}
      catch{t.error='Codex CLI launch failed';await entry.finish(null,true);return clone(t);}
      const child=entry.child;
      child.stdout?.on('data',data=>{
        if(entry.finishing||entry.sessionRejected)return;entry.buffer+=data.toString();
        if(entry.buffer.length>65536){entry.buffer='';entry.observe(entry.stop());return;}
        let index;while((index=entry.buffer.indexOf('\n'))>=0){entry.event(entry.buffer.slice(0,index));entry.buffer=entry.buffer.slice(index+1);}
      });
      child.stderr?.on('data',()=>{if(!entry.sessionRejected)t.error='Codex CLI reported diagnostics';});
      child.once('error',()=>entry.observe(entry.finish(null,true)));
      child.once('close',code=>entry.observe(entry.finish(code,false)));
      child.stdin?.on('error',()=>{});
      entry.timeout=setTimeout(()=>entry.observe(entry.stop()),timeoutMs);
      try{child.stdin?.end(t.prompt);}catch{entry.observe(entry.stop());}
      return clone(t);
    });
  }
  return {
    startTask,continueTask,confirmTask,getTask:get,
    async listTasks(){await ready;return [...tasks.values()].map(summarizeTask);},
    // Local service reconciliation needs request identities and retained turns.
    async listTaskRecords(){await ready;return [...tasks.values()].map(clone);},
    async status(){await ready;return {...await probeCli(),activeTasks:running.size};},
    async cancelTask(id){
      await ready;const t=tasks.get(typeof id==='object'?id.taskId:id);if(!t)throw new Error('task not found');
      const entry=running.get(t.id);
      if(entry){await entry.stop();await entry.closed;}
      else if(t.status==='draft'){t.status='cancelled';t.revision++;t.completedAt=new Date().toISOString();delete t.prompt;await save(t);}
      return clone(t);
    },
    async getLogs(id){return {logs:(await get(id)).logs};},
    async getDiff(id){await get(id);return {collected:false,reason:'Diff evidence has not been collected'};},
    async getChecks(id){await get(id);return {collected:false,reason:'Check evidence has not been collected'};},
  };
}
