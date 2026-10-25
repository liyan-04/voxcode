import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {rpcMethods,readMethods,validId,validateRpcPayload} from '../../packages/control-protocol/index.mjs';

const fail=code=>Object.assign(Error('Mac task operation unavailable; reconcile its result before retrying'),{code});
const safeCodes=new Set(['offline','revision_conflict','request_conflict','not_found','project_unavailable','busy','quarantined','invalid_argument','task_hidden','task_deleted','invalid_parent','ledger_full','capacity','expired']);
export function createRemoteTaskAdapter({gateway,userId,deviceId,pollMs=25,timeoutMs=20000}={}){
  if(!gateway?.submitCommand||!validId(userId)||!validId(deviceId)||!Number.isSafeInteger(pollMs)||pollMs<1||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw fail('configuration');
  const call=async(method,params)=>{
    const payload=validateRpcPayload({method,params});
    const businessId=method==='startTask'?params[0].requestId:params[1]?.requestId;
    const requestId=readMethods.includes(method)?randomUUID():createHash('sha256').update(JSON.stringify([deviceId,method,businessId])).digest('hex');
    const deadline=performance.now()+timeoutMs;
    let accepted=false,terminal=false,operationId;
    const bounded=async operation=>{
      let timer;const remaining=deadline-performance.now();
      if(remaining<=0)throw fail('outcome_unknown');
      try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('outcome_unknown')),remaining);})]);}
      finally{clearTimeout(timer);}
    };
    try{
      let result=await bounded(()=>gateway.submitCommand({userId,deviceId,requestId,type:'task_rpc',payload}));
      accepted=true;
      operationId=result.operationId;
      let reconciled=false;
      while(true){
        if(result.status==='succeeded')return result.snapshot;
        if(['failed','rejected','expired'].includes(result.status)){terminal=true;throw fail(safeCodes.has(result.errorCode)?result.errorCode:'task_failed');}
        if(result.status==='unknown'){
          if(!reconciled&&typeof gateway.reconcile==='function'){
            reconciled=true;
            try{await bounded(()=>gateway.reconcile({operationId,userId,deviceId}));}catch{throw fail('outcome_unknown');}
          }else if(!reconciled)throw fail('outcome_unknown');
        }
        if(performance.now()>=deadline)throw fail('outcome_unknown');
        await delay(Math.min(pollMs,Math.max(1,deadline-performance.now())));
        result=await bounded(()=>gateway.getOperation(operationId,{userId,deviceId}));
      }
    }catch(error){let code=terminal?error.code:!accepted&&safeCodes.has(error?.code)?error.code:'outcome_unknown';if(code==='outcome_unknown'&&readMethods.includes(method))code='task_service_unavailable';const failure=fail(code);if(failure.code==='outcome_unknown'){failure.requestId=requestId;if(validId(operationId))failure.operationId=operationId;}throw failure;}
  };
  return Object.fromEntries(rpcMethods.map(method=>[method,(...params)=>call(method,params)]));
}
