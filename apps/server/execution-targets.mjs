import {validId} from '../../packages/control-protocol/index.mjs';

const definitions=Object.freeze([{id:'mac',name:'Mac Codex'},{id:'server',name:'Server Codex'}]);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=code=>Object.assign(Error(code==='target_unavailable'?'Execution target unavailable':'Invalid execution target'),{code});
const known=id=>definitions.some(target=>target.id===id);
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value?value:null;

export function createExecutionTargets(configuration={}){
 if(!object(configuration)||Object.keys(configuration).some(key=>!known(key)))throw fail('configuration');
 const targets=new Map();
 for(const {id} of definitions){
  const input=configuration[id];if(input===undefined)continue;
  if(!object(input)||Object.keys(input).some(key=>!['adapter','projectRegistry','readState','deviceId'].includes(key))||!object(input.adapter)||input.projectRegistry!==undefined&&!object(input.projectRegistry)||input.readState!==undefined&&typeof input.readState!=='function'||input.deviceId!==undefined&&!validId(input.deviceId))throw fail('configuration');
  targets.set(id,{target:Object.freeze({id,adapter:input.adapter,projectRegistry:input.projectRegistry??input.adapter,deviceId:input.deviceId??id}),readState:input.readState});
 }
 const getTarget=id=>{
  if(!known(id))throw fail('invalid_argument');
  const entry=targets.get(id);if(!entry)throw fail('target_unavailable');
  return entry.target;
 };
 return Object.freeze({
  getTarget,
  select(searchParams){
   if(!(searchParams instanceof URLSearchParams))throw fail('invalid_argument');
   const values=searchParams.getAll('executionTarget');if(values.length>1)throw fail('invalid_argument');
   return getTarget(values.length?values[0]:'mac');
  },
  listTargets(){return definitions.map(({id,name})=>{
   const entry=targets.get(id);let state;
   try{state=entry?.readState?.();}catch{}
   // Inventory uses cached synchronous state; it must never wait on an executor.
   if(state&&typeof state.then==='function'){void Promise.resolve(state).catch(()=>{});state=null;}
   const online=Boolean(entry)&&state?.online===true;
   return {id,kind:id,name,configured:Boolean(entry),online,available:online&&state?.available===true,observedAt:timestamp(state?.observedAt)};
  });},
 });
}

export async function resolveExecutionVoiceContext({targets,context,userId}={}){
 if(!validId(userId)||!object(context)||Object.keys(context).some(key=>!['executionTarget','projectId','contextVersion','taskId','parentTaskId'].includes(key))||!validId(context.projectId)||!Number.isSafeInteger(context.contextVersion)||context.contextVersion<1||context.taskId!==undefined&&!validId(context.taskId)||context.parentTaskId!==undefined&&!validId(context.parentTaskId)||context.taskId!==undefined&&context.parentTaskId!==undefined)return null;
 const {executionTarget='mac',projectId,contextVersion,taskId,parentTaskId}=context;
 try{
  const target=targets.getTarget(executionTarget),project=await target.projectRegistry.getProject(projectId);
  if(!project||project.id!==projectId||project.enabled!==true)return null;
  const selected=taskId??parentTaskId;
  if(selected){const task=await target.adapter.getTask(selected);if(!task||task.id!==selected||task.projectId!==projectId||task.deletedAt||task.archived)return null;}
  return Object.freeze({executionTarget:target.id,projectId,contextVersion,...(taskId?{taskId}:{}),...(parentTaskId?{parentTaskId}:{}),userId,deviceId:target.deviceId});
 }catch{return null;}
}
