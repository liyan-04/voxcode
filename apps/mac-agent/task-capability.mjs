import {createTaskRpcClient} from '../server/task-rpc.mjs';
import {rpcMethods,validateRpcPayload} from '../../packages/control-protocol/index.mjs';

export const TASK_METHODS=rpcMethods;
const fail=()=>{const error=Error('task_rpc_denied');error.code='task_rpc_denied';throw error;};

export function createTaskCapability({socketPath,client=createTaskRpcClient({socketPath})}={}) {
 return {capabilities:['task_rpc'],async execute(command){
  if(command.type!=='task_rpc')fail();
  let payload;try{payload=validateRpcPayload(command.payload);}catch{fail();}
  const params=structuredClone(payload.params);
  return client[payload.method](...params);
 }};
}
