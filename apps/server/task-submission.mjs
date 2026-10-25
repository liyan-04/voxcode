import {createHash} from 'node:crypto';
import {validId,stableJson} from '../../packages/control-protocol/index.mjs';

const plain=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const fail=code=>Object.assign(Error('Task submission unavailable; retry the same submission identity'),{code});
const prompt=value=>typeof value==='string'&&value.trim().length>0&&value.length<=20000;
const rejections=new Set(['busy','revision_conflict','project_unavailable','invalid_argument','request_conflict','not_found','task_hidden','task_deleted','quarantined','invalid_parent','ledger_full','capacity','expired','offline','task_conflict']);

export function createTaskSubmission({adapter,executionTarget='mac'}={}){
 if(!adapter||!validId(executionTarget))throw fail('configuration');
 const executionId=(kind,id,requestId)=>createHash('sha256').update(stableJson(['execute-submission-v1',executionTarget,kind,id,requestId])).digest('hex');
 const check=input=>{if(!validId(input?.projectId)||!validId(input?.requestId)||!prompt(input?.prompt))throw fail('invalid_argument');};
 async function mutation(operation,input,id){
  try{return await operation();}
  catch(error){
   const failure=error instanceof Error?error:fail('outcome_unknown');
   // A missing or malformed reply cannot prove the mutation was rejected.
   if(!rejections.has(failure.code))failure.code='outcome_unknown';
   if(id!==undefined)failure.taskId=id;
   failure.submissionRequestId=input.requestId;throw failure;
  }
 }
 async function execute(kind,id,input,revision){
  let admitted=false;
  try{
   const before=await adapter.getTask(id);
   if(!before||before.projectId!==input.projectId)throw fail('project_unavailable');
   // Bind execution to this submission's turn, never the task's latest revision.
   await mutation(()=>adapter.confirmTask(id,{revision,requestId:executionId(kind,id,input.requestId)}),input,id);admitted=true;
   const task=await adapter.getTask(id);
   if(!task||task.projectId!==input.projectId)throw fail('project_unavailable');
   return {...task,taskId:id};
  }catch(error){
   const failure=error instanceof Error?error:fail('outcome_unknown');
   // Start or continuation already committed before execute's first read.
   if(admitted||!rejections.has(failure.code))failure.code='outcome_unknown';
   failure.taskId=id;failure.submissionRequestId=input.requestId;throw failure;
  }
 }
 return {
  async start(input){
   if(!plain(input,['projectId','prompt','title','requestId','parentTaskId']))throw fail('invalid_argument');check(input);
   if(input.title!==undefined&&(typeof input.title!=='string'||input.title.length>200)||input.parentTaskId!==undefined&&input.parentTaskId!==null&&!validId(input.parentTaskId))throw fail('invalid_argument');
   const id=await mutation(async()=>{const created=await adapter.startTask(input),id=created?.taskId??created?.id;if(!validId(id))throw fail('outcome_unknown');return id;},input);
   return execute('start',id,input,1);
  },
  async continue(id,input){
   if(!validId(id)||!plain(input,['projectId','prompt','revision','requestId']))throw fail('invalid_argument');check(input);
   if(!Number.isSafeInteger(input.revision)||input.revision<1||input.revision===Number.MAX_SAFE_INTEGER)throw fail('invalid_argument');
   const task=await adapter.getTask(id);if(!task||task.projectId!==input.projectId)throw fail('project_unavailable');
   await mutation(()=>adapter.continueTask(id,{prompt:input.prompt,revision:input.revision,requestId:input.requestId}),input,id);
   return execute('continue',id,input,input.revision+1);
  },
 };
}
