import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,realpath,lstat,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCodexCliAdapter,summarizeTask} from './codex-cli-adapter.mjs';

const execute=promisify(execFile),copy=x=>structuredClone(x);
const inside=(parent,path)=>{const part=relative(parent,path);return !part||part!=='..'&&!part.startsWith(`..${sep}`)&&!isAbsolute(part);};
const fail=(message,code='invalid_argument')=>Object.assign(Error(message),{code});
const allowed=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k));
const taskId=value=>{if(typeof value!=='string'||!value||value.length>128)throw fail('Invalid task id');return value;};

// This registry is operator supplied. Whole-repository serialization is a first
// milestone, not per-task worktree or scope isolation.
export async function createProjectService({projects,dataDir,command='/usr/local/bin/codex',adapterFactory=createCodexCliAdapter}={}) {
  if(!Array.isArray(projects)||projects.length<1||projects.length>32||!isAbsolute(dataDir??'')||!isAbsolute(command))throw fail('Invalid project service configuration');
  const registry=new Map(),roots=new Set();
  for(const p of projects){
    if(!allowed(p,['id','name','root','enabled'])||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u.test(p.id??'')||typeof p.name!=='string'||!p.name||p.name.length>100||typeof p.enabled!=='boolean'||!isAbsolute(p.root??''))throw fail('Invalid project registry');
    const root=await realpath(p.root);
    const top=(await execute('git',['-C',root,'rev-parse','--show-toplevel'],{timeout:5000,maxBuffer:4096})).stdout.trim();
    if(await realpath(top)!==root)throw fail('Project must be a Git checkout root');
    if(registry.has(p.id)||roots.has(root))throw fail('Duplicate project id or root');
    roots.add(root);registry.set(p.id,{...p,root});
  }
  const state=resolve(dataDir);
  for(const root of roots)if(inside(root,state)||inside(state,root))throw fail('Task state must be outside projects');
  await mkdir(state,{recursive:true,mode:0o700});
  const stateInfo=await lstat(state),canonicalState=await realpath(state);
  if(stateInfo.isSymbolicLink()||canonicalState!==state||!stateInfo.isDirectory()||stateInfo.uid!==process.getuid?.()||(stateInfo.mode&0o077))throw fail('Task state requires a private owned directory');
  for(let path=resolve(state,'..');;path=resolve(path,'..')){
    const info=await lstat(path),stickyRoot=info.uid===0&&(info.mode&0o1000)!==0;
    if(!info.isDirectory()||![0,process.getuid?.()].includes(info.uid)||((info.mode&0o022)!==0&&!stickyRoot))throw fail('Task state ancestors must be trusted');
    if(path===resolve(path,'..'))break;
  }
  const adapters=new Map();
  for(const [id,p] of registry)adapters.set(id,adapterFactory({command,projectRoot:p.root,dataDir:join(state,id)}));
  const ledgerFile=join(state,'request-ledger.json'),metadataFile=join(state,'task-metadata.json');
  const readRecord=async(file,label)=>{try{const value=JSON.parse(await readFile(file,'utf8'));if(!value||Array.isArray(value)||typeof value!=='object')throw fail(`Invalid ${label}`);return value;}catch(e){if(e.code==='ENOENT')return {};throw e;}};
  let ledger=await readRecord(ledgerFile,'request ledger'),metadata=await readRecord(metadataFile,'task metadata');
  let serial=Promise.resolve();
  const locked=fn=>{const operation=serial.then(fn);serial=operation.catch(()=>{});return operation;};
  const atomic=async(file,value)=>{const temp=join(state,`.record-${randomUUID()}.tmp`);try{await writeFile(temp,JSON.stringify(value),{mode:0o600,flag:'wx'});await rename(temp,file);}finally{await unlink(temp).catch(()=>{});}};
  const replaceLedger=async next=>{await atomic(ledgerFile,next);ledger=next;};
  const replaceMetadata=async next=>{await atomic(metadataFile,next);metadata=next;};
  const refreshMetadata=async()=>{metadata=await readRecord(metadataFile,'task metadata');};
  const extra=id=>metadata[`task:${id}`]??{parentTaskId:null,archived:false,deletedAt:null,metadataRevision:1};
  const decorate=task=>{const {lastMutationFingerprint,...visible}=extra(task.id);return {...task,...visible};};
  const publicProject=p=>p?{id:p.id,name:p.name,enabled:p.enabled,scopes:[{id:'all',name:'全项目'}]}:null;
  const enabled=id=>{const p=registry.get(id);if(!p?.enabled)throw fail('Project unavailable','project_unavailable');return p;};
  const all=async()=>{
    const result=[],ids=new Set();
    for(const [projectId,adapter] of adapters)for(const task of await (adapter.listTaskRecords?.()??adapter.listTasks())){
      if(ids.has(task.id))throw fail('Ambiguous task identity','task_conflict');ids.add(task.id);
      result.push(decorate({...task,projectId}));
    }
    return result;
  };
  const find=async id=>{taskId(id);const t=(await all()).find(t=>t.id===id);if(!t)throw fail('Task unavailable','not_found');enabled(t.projectId);return t;};
  async function mutation(requestId,fingerprint,operation,reconcile,{retryUnapplied=false}={}){
    if(requestId!==undefined&&(typeof requestId!=='string'||!requestId||requestId.length>128))throw fail('Invalid requestId');
    const key=requestId===undefined?null:`id:${requestId}`;
    if(key&&Object.hasOwn(ledger,key)){
      const prior=ledger[key];if(prior.fingerprint!==fingerprint)throw fail('requestId conflict','request_conflict');
      if(prior.state==='done')return copy(prior.result);
      const recovered=await reconcile?.();if(recovered!==undefined){await replaceLedger({...ledger,[key]:{fingerprint,state:'done',result:copy(recovered)}});return recovered;}
      if(!retryUnapplied)throw fail('Mutation outcome unknown; reconcile task status before a new request','outcome_unknown');
    }
    if(key&&!Object.hasOwn(ledger,key)){if(Object.keys(ledger).length>=10000)throw fail('Request ledger requires maintenance','ledger_full');await replaceLedger({...ledger,[key]:{fingerprint,state:'pending'}});}
    const result=await operation();
    if(key)await replaceLedger({...ledger,[key]:{fingerprint,state:'done',result:copy(result)}});
    return result;
  }
  const options=o=>{if(!allowed(o,['revision','requestId']))throw fail('Invalid task arguments');if(o.revision!==undefined&&(!Number.isSafeInteger(o.revision)||o.revision<1))throw fail('Invalid revision');return o;};
  const changeMetadata=(action,id,opts)=>locked(async()=>{
    if(!allowed(opts,action==='archive'?['requestId','metadataRevision','archived']:['requestId','metadataRevision'])||!Number.isSafeInteger(opts.metadataRevision)||opts.metadataRevision<1||action==='archive'&&typeof opts.archived!=='boolean')throw fail('Invalid metadata arguments');
    await refreshMetadata();
    const fingerprint=JSON.stringify([action,id,opts.metadataRevision,opts.archived??null]);
    return mutation(opts.requestId,fingerprint,async()=>{
      const t=await find(id);
      if(t.metadataRevision!==opts.metadataRevision)throw fail('metadataRevision conflict','revision_conflict');
      if(action!=='restore'&&(['queued','running','cancelling','waiting_approval','approval_required'].includes(t.status)||t.quarantined))throw fail('Stop and reconcile the task before changing its visibility','busy');
      if(action==='archive'&&t.deletedAt)throw fail('Restore deleted task before archiving','task_deleted');
      const next={...extra(id),metadataRevision:t.metadataRevision+1,lastMutationFingerprint:fingerprint};
      if(action==='archive')next.archived=opts.archived;
      if(action==='delete')next.deletedAt=t.deletedAt??new Date().toISOString();
      if(action==='restore')next.deletedAt=null;
      await replaceMetadata({...metadata,[`task:${id}`]:next});return find(id);
    },async()=>{
      // A mutation may have reached metadata rename before its ledger receipt.
      // Reconcile only the committed file, never a speculative in-memory value.
      await refreshMetadata();return extra(id).lastMutationFingerprint===fingerprint?find(id):undefined;
    },{retryUnapplied:true});
  });
  return {
    async listProjects(){return [...registry.values()].map(publicProject);},
    async getProject(id){return publicProject(registry.get(id));},
    async listTasks(input){if(!allowed(input,['projectId','includeArchived','includeDeleted'])||['includeArchived','includeDeleted'].some(k=>input[k]!==undefined&&typeof input[k]!=='boolean'))throw fail('Invalid project arguments');enabled(input.projectId);return (await all()).filter(t=>t.projectId===input.projectId&&(input.includeArchived||!t.archived)&&(input.includeDeleted||!t.deletedAt)).map(summarizeTask);},
    async getTask(id){return copy(await find(id));},
    async startTask(input){return locked(async()=>{
      if(!allowed(input,['projectId','prompt','title','requestId','parentTaskId']))throw fail('Invalid start arguments');
      const {projectId,prompt,title,requestId,parentTaskId=null}=input;enabled(projectId);
      if(typeof prompt!=='string'||!prompt.trim()||prompt.length>20000||title!==undefined&&(typeof title!=='string'||title.length>200))throw fail('Invalid task input');
      const fingerprint=JSON.stringify(['start',projectId,prompt,title??null,parentTaskId]);
      const tasks=await all(),prior=tasks.find(t=>requestId&&t.requestId===requestId);
      if(prior&&prior.projectId!==projectId)throw fail('requestId conflict','request_conflict');
      const created=async result=>{const task=result.taskId;if(!Object.hasOwn(metadata,`task:${task}`)){await replaceMetadata({...metadata,[`task:${task}`]:{parentTaskId,initialPrompt:prompt,archived:false,deletedAt:null,metadataRevision:1}});}return {...result,projectId};};
      return mutation(requestId,fingerprint,async()=>{
        if(parentTaskId!==null){const parent=await find(parentTaskId);if(parent.projectId!==projectId||parent.deletedAt)throw fail('Parent task unavailable','invalid_parent');}
        return created(await adapters.get(projectId).startTask({prompt,title,requestId}));
      },async()=>{
        const task=(await all()).find(t=>t.projectId===projectId&&t.requestId===requestId);return task?created({taskId:task.id}):undefined;
      });
    });},
    async continueTask(id,opts={}){return locked(async()=>{
      if(!allowed(opts,['prompt','revision','requestId'])||typeof opts.prompt!=='string'||!opts.prompt.trim()||opts.prompt.length>20000||!Number.isSafeInteger(opts.revision)||opts.revision<1||typeof opts.requestId!=='string'||!opts.requestId||opts.requestId.length>128)throw fail('Invalid continuation arguments');
      const t=await find(id),fingerprint=JSON.stringify(['continue',id,opts.prompt,opts.revision]);
      if(t.archived||t.deletedAt)throw fail('Restore and unarchive task before continuation','task_hidden');
      return mutation(opts.requestId,fingerprint,async()=>decorate({...await adapters.get(t.projectId).continueTask(id,opts),projectId:t.projectId}),async()=>{
        const task=await find(id);return task.turns?.some(turn=>turn.kind==='continuation'&&turn.requestId===opts.requestId)?task:undefined;
      },{retryUnapplied:true});
    });},
    async confirmTask(id,opts={}){return locked(async()=>{
      options(opts);const t=await find(id),fingerprint=JSON.stringify(['confirm',id,opts.revision??null]);
      if(t.archived||t.deletedAt)throw fail('Restore and unarchive task before execution','task_hidden');
      const key=opts.requestId&&`id:${opts.requestId}`,record=key&&ledger[key];
      if(record&&record.fingerprint!==fingerprint)throw fail('requestId conflict','request_conflict');
      const prior=(await all()).find(x=>opts.requestId&&x.confirmRequestId===opts.requestId);
      if(prior&&prior.id!==id)throw fail('requestId conflict','request_conflict');
      // Replays are reconciled before the busy check, without releasing the slot.
      if(!record&&!(opts.requestId&&t.confirmRequestId===opts.requestId)){
        const tasks=await all();if(tasks.some(x=>x.quarantined))throw fail('Task quarantine requires reconciliation','quarantined');
        if(tasks.some(x=>['running','cancelling'].includes(x.status)))throw fail('Codex execution slot busy','busy');
      }
      return mutation(opts.requestId,fingerprint,async()=>decorate({...await adapters.get(t.projectId).confirmTask(id,opts),projectId:t.projectId}),async()=>{
        const task=await find(id);return task.confirmRequestId===opts.requestId?task:undefined;
      });
    });},
    async cancelTask(id,opts={}){return locked(async()=>{
      if(!allowed(opts,['requestId']))throw fail('Invalid cancel arguments');const t=await find(id);
      return mutation(opts.requestId,JSON.stringify(['cancel',id]),async()=>decorate({...await adapters.get(t.projectId).cancelTask(id,opts),projectId:t.projectId}),async()=>{
        const task=await find(id);return ['cancelled','completed','failed'].includes(task.status)?task:undefined;
      });
    });},
    archiveTask(id,opts){return changeMetadata('archive',id,opts);},
    deleteTask(id,opts){return changeMetadata('delete',id,opts);},
    restoreTask(id,opts){return changeMetadata('restore',id,opts);},
    async getLogs(id){const t=await find(id);return adapters.get(t.projectId).getLogs(id);},
    async getDiff(id){const t=await find(id);return adapters.get(t.projectId).getDiff(id);},
    async getChecks(id){const t=await find(id);return adapters.get(t.projectId).getChecks(id);},
    async status(){const statuses=await Promise.all([...adapters.values()].map(a=>a.status()));const tasks=await all();return {available:statuses.every(s=>s.available===true),version:statuses[0]?.version??null,activeTasks:tasks.filter(t=>['running','cancelling'].includes(t.status)).length,quarantined:tasks.some(t=>t.quarantined),projectCount:registry.size};},
  };
}
