import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createTaskSubmission} from './task-submission.mjs';
import {validId} from '../../packages/control-protocol/index.mjs';

const fail=code=>Object.assign(Error('Voice task operation unavailable'),{code});
const terminal=new Set(['completed','failed','cancelled','interrupted','waiting_approval','quarantined']);
const safeCodes=new Set(['busy','revision_conflict','offline','project_unavailable','task_hidden','task_deleted','invalid_parent','quarantined','capacity','expired','request_conflict','outcome_unknown']);
// These tools exist only inside one authenticated device voice socket. The
// model supplies a prompt, never an owner, target, path, task or request identity.
export function createVoiceTools({adapter,context,voiceSessionId,captureId,authorize,onResult=()=>{},onStart=()=>{},waitMs=60000,pollMs=500}={}){
 if(!adapter||!validId(context?.projectId)||!validId(context?.executionTarget)||!validId(voiceSessionId)||!validId(captureId)||typeof authorize!=='function'||!Number.isSafeInteger(waitMs)||waitMs<1||waitMs>90000||!Number.isSafeInteger(pollMs)||pollMs<1)throw fail('configuration');
 const target=Object.freeze(structuredClone(context));
 const requestId=createHash('sha256').update(JSON.stringify(['voice-v1',voiceSessionId,captureId])).digest('hex');
 let taskId=target.taskId,mutation,uncertain;
 const check=async()=>{if(await authorize()!==true)throw fail('voice_context_invalid');};
 const guarded={...adapter};
 for(const method of ['startTask','continueTask','confirmTask'])guarded[method]=async(...args)=>{await check();return adapter[method](...args);};
 const submission=createTaskSubmission({adapter:guarded,executionTarget:target.executionTarget});
 const emit=result=>{onResult(result);return result;};
 const identity=()=>({executionTarget:target.executionTarget,projectId:target.projectId,...(taskId?{taskId}:{}),requestId});
 async function read(current=false){
  await check();if(!taskId)return {...identity(),status:uncertain?'outcome_unknown':'no_task',...(uncertain??{})};
  const task=await adapter.getTask(taskId);await check();
  if(!task||task.id!==taskId||task.projectId!==target.projectId||task.deletedAt||task.archived)throw fail('voice_context_invalid');
  // A later task snapshot is not proof that this capture's turn completed.
  // In particular a failed continuation must never return the preceding output.
  const turn=mutation&&!current?task.turns?.find(turn=>turn.requestId===requestId):task;
  if(!turn)return {...identity(),...(uncertain??{status:'outcome_unknown'})};
  const result={...identity(),status:turn.status??task.status,revision:turn.revision??task.revision};
  for(const [key,limit] of [['title',200],['output',5000],['error',500],['sessionId',128]])if(typeof turn[key]==='string')result[key]=turn[key].slice(0,limit);
  if(typeof result.output==='string'){
   while(Buffer.byteLength(JSON.stringify(result.output))>16000)result.output=result.output.slice(0,Math.floor(result.output.length*0.8));
   if(result.output.length<turn.output.length)result.outputTruncated=true;
  }
  if(Number.isSafeInteger(turn.exitCode))result.exitCode=turn.exitCode;
  return result;
 }
 async function result(){
  const deadline=Date.now()+waitMs;let value=await read();
  while(taskId&&!terminal.has(value.status)&&!safeCodes.has(value.status)&&Date.now()<deadline){await delay(Math.min(pollMs,deadline-Date.now()));value=await read();}
  return emit(value);
 }
 const execute=async args=>{
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>key!=='prompt')||typeof args.prompt!=='string'||!args.prompt.trim()||args.prompt.length>20000)throw fail('invalid_argument');
  await check();
  if(mutation){if(mutation.prompt!==args.prompt)throw fail('request_conflict');return mutation.promise;}
  // Install the receipt before the first adapter await. Even a lost reply must
  // not cause another mutation or a new continuation revision.
  const receipt={prompt:args.prompt};mutation=receipt;
  receipt.promise=(async()=>{
   try{
    onStart(identity());
    const input={projectId:target.projectId,prompt:args.prompt,requestId};let task;
    if(target.taskId){
     const before=await read(true);await check();
     task=await submission.continue(target.taskId,{...input,revision:before.revision});
    }else{
     await check();task=await submission.start({...input,...(target.parentTaskId?{parentTaskId:target.parentTaskId}:{})});
    }
    taskId=task.taskId??task.id;return await result();
   }catch(error){
    if(error?.code==='voice_context_invalid')throw error;
    if(validId(error?.taskId))taskId=error.taskId;
    uncertain={status:safeCodes.has(error?.code)?error.code:'outcome_unknown',...(validId(error?.operationId)?{operationId:error.operationId}:{})};
    await check();return emit({...identity(),...uncertain});
   }
  })();return receipt.promise;
 };
 return [
  {name:target.taskId?'codex_continue_task':'codex_execute_task',description:target.taskId?'Continue the frozen selected Codex task with the spoken development instruction. Never use for casual conversation.':'Execute the spoken development instruction in the frozen selected project. Never use for casual conversation. The user has authorized ordinary edits and tests.',inputSchema:{type:'object',properties:{prompt:{type:'string',minLength:1,maxLength:20000}},required:['prompt'],additionalProperties:false},invoke:execute},
  {name:'codex_task_result',description:'Query the actual result of the frozen task. If status is running, query again; accepted/running is not completed. Speak only the returned actual result. Never retry a mutation whose outcome is unknown.',inputSchema:{type:'object',properties:{},additionalProperties:false},async invoke(args){if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)throw fail('invalid_argument');await check();onStart(identity());return result();}},
 ];
}
