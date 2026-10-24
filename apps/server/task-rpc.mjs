import {createServer,createConnection} from 'node:net';
import {lstat,realpath,chmod,unlink} from 'node:fs/promises';
import {dirname,resolve,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';

const REQUEST_LIMIT=64*1024,RESPONSE_LIMIT=1024*1024;
const methods=['status','listProjects','getProject','listTasks','getTask','startTask','confirmTask','cancelTask','archiveTask','deleteTask','restoreTask','getLogs','getDiff','getChecks'];
const error=(code,message)=>Object.assign(Error(message),{code});
const object=(x,fields)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>fields.includes(k));
const id=x=>typeof x==='string'&&x.length>0&&x.length<=128;
function validArgs(method,args){
  if(!Array.isArray(args))return false;
  if(['status','listProjects'].includes(method))return args.length===0;
  if(['getProject','getTask','getLogs','getDiff','getChecks'].includes(method))return args.length===1&&id(args[0]);
  if(method==='listTasks')return args.length===1&&object(args[0],['projectId','includeArchived','includeDeleted'])&&id(args[0].projectId)&&['includeArchived','includeDeleted'].every(k=>args[0][k]===undefined||typeof args[0][k]==='boolean');
  if(method==='startTask')return args.length===1&&object(args[0],['projectId','prompt','title','requestId','parentTaskId'])&&id(args[0].projectId)&&typeof args[0].prompt==='string'&&args[0].prompt.length>0&&args[0].prompt.length<=20000&&(args[0].title===undefined||typeof args[0].title==='string'&&args[0].title.length<=200)&&(args[0].requestId===undefined||id(args[0].requestId))&&(args[0].parentTaskId===undefined||args[0].parentTaskId===null||id(args[0].parentTaskId));
  if(['confirmTask','cancelTask'].includes(method))return args.length>=1&&args.length<=2&&id(args[0])&&(args[1]===undefined||object(args[1],method==='confirmTask'?['revision','requestId']:['requestId'])&&(args[1].requestId===undefined||id(args[1].requestId))&&(args[1].revision===undefined||Number.isSafeInteger(args[1].revision)&&args[1].revision>0));
  if(['archiveTask','deleteTask','restoreTask'].includes(method))return args.length===2&&id(args[0])&&object(args[1],method==='archiveTask'?['requestId','metadataRevision','archived']:['requestId','metadataRevision'])&&Number.isSafeInteger(args[1].metadataRevision)&&args[1].metadataRevision>0&&(args[1].requestId===undefined||id(args[1].requestId))&&(method!=='archiveTask'||typeof args[1].archived==='boolean');
  return false;
}
async function checkedParent(socketPath){
  if(!isAbsolute(socketPath)||resolve(socketPath)!==socketPath||Buffer.byteLength(socketPath)>100)throw error('configuration','Invalid socket path');
  const parent=dirname(socketPath),info=await lstat(parent);
  if(info.isSymbolicLink()||!info.isDirectory()||await realpath(parent)!==parent||info.uid!==process.getuid?.()||(info.mode&0o007)||(info.mode&0o700)!==0o700)throw error('configuration','Socket parent must be trusted and private');
  for(let path=dirname(parent);;path=dirname(path)){
    const ancestor=await lstat(path),stickyRoot=ancestor.uid===0&&(ancestor.mode&0o1000)!==0;
    if(!ancestor.isDirectory()||![0,process.getuid?.()].includes(ancestor.uid)||((ancestor.mode&0o022)!==0&&!stickyRoot))throw error('configuration','Socket parent ancestors must be trusted');
    if(path===dirname(path))break;
  }
}
function reply(socket,payload){
  let body=JSON.stringify(payload)+'\n';
  if(Buffer.byteLength(body)>RESPONSE_LIMIT)body=JSON.stringify({id:payload.id,ok:false,error:{code:'response_too_large',message:'Task response exceeds limit'}})+'\n';
  if(!socket.destroyed)socket.end(body,()=>socket.destroy());
}
const safeCodes=new Set(['invalid_argument','project_unavailable','task_conflict','not_found','request_conflict','outcome_unknown','ledger_full','quarantined','busy','revision_conflict','task_deleted','task_hidden','invalid_parent']);
export async function createTaskRpcServer({socketPath,adapter,timeoutMs=15000,maxConnections=16}={}){
  if(!adapter||!Number.isSafeInteger(maxConnections)||maxConnections<1||maxConnections>64||!Number.isFinite(timeoutMs)||timeoutMs<10||timeoutMs>30000)throw error('configuration','Invalid task RPC configuration');
  await checkedParent(socketPath);
  try{await lstat(socketPath);throw error('configuration','Socket endpoint already exists; reconcile owner before removing it');}catch(e){if(e.code!=='ENOENT')throw e;}
  const connections=new Set();let closing=false,inflight=0;
  const server=createServer(socket=>{
    connections.add(socket);socket.once('close',()=>connections.delete(socket));socket.on('error',()=>{});
    if(closing||connections.size>maxConnections){socket.setTimeout(timeoutMs,()=>socket.destroy());return reply(socket,{id:null,ok:false,error:{code:'busy',message:'Task service is busy'}});}
    let buffer=Buffer.alloc(0),handled=false;
    const timer=setTimeout(()=>{handled=true;reply(socket,{id:null,ok:false,error:{code:'deadline_exceeded',message:'Task result is unknown; query task status before retrying'}});},timeoutMs);
    socket.once('close',()=>clearTimeout(timer));
    socket.on('data',chunk=>{
      if(handled)return;buffer=Buffer.concat([buffer,chunk]);
      if(buffer.length>REQUEST_LIMIT){handled=true;clearTimeout(timer);return reply(socket,{id:null,ok:false,error:{code:'request_too_large',message:'Task request exceeds limit'}});}
      const newline=buffer.indexOf(10);if(newline<0)return;handled=true;
      let request;
      try{request=JSON.parse(buffer.subarray(0,newline));}catch{clearTimeout(timer);return reply(socket,{id:null,ok:false,error:{code:'invalid_request',message:'Invalid task request'}});}
      if(buffer.length!==newline+1||!object(request,['id','method','args'])||!id(request.id)||!methods.includes(request.method)||!validArgs(request.method,request.args)||typeof adapter[request.method]!=='function'){
        clearTimeout(timer);return reply(socket,{id:typeof request?.id==='string'?request.id:null,ok:false,error:{code:'invalid_request',message:'Invalid task operation'}});
      }
      if(inflight>=maxConnections){clearTimeout(timer);return reply(socket,{id:request.id,ok:false,error:{code:'busy',message:'Task service is busy'}});}
      inflight++;
      void Promise.resolve().then(()=>adapter[request.method](...request.args)).then(result=>{
        if(!socket.writableEnded){clearTimeout(timer);reply(socket,{id:request.id,ok:true,result:result??null});}
      },e=>{if(!socket.writableEnded){clearTimeout(timer);reply(socket,{id:request.id,ok:false,error:{code:safeCodes.has(e?.code)?e.code:'task_failed',message:safeCodes.has(e?.code)?e.message:'Task operation failed'}});}}).finally(()=>inflight--);
    });
  });
  await new Promise((resolveStart,reject)=>{server.once('error',reject);server.listen(socketPath,()=>{server.off('error',reject);resolveStart();});});
  try{await chmod(socketPath,0o660);}catch(e){server.close();throw e;}
  const bound=await lstat(socketPath);
  return {address:socketPath,async close(){if(closing)return;closing=true;for(const socket of connections)socket.destroy();await new Promise((r,j)=>server.close(e=>e?j(e):r()));try{const current=await lstat(socketPath);if(current.ino===bound.ino&&current.dev===bound.dev)await unlink(socketPath);}catch(e){if(e.code!=='ENOENT')throw e;}}};
}

export function createTaskRpcClient({socketPath,timeoutMs=16000}={}){
  if(!isAbsolute(socketPath??'')||!Number.isFinite(timeoutMs)||timeoutMs<10||timeoutMs>31000)throw error('configuration','Invalid task RPC client configuration');
  const call=(method,args)=>new Promise((resolveCall,reject)=>{
    if(!validArgs(method,args))return reject(error('invalid_argument','Invalid task arguments'));
    const requestId=randomUUID(),body=JSON.stringify({id:requestId,method,args})+'\n';
    if(Buffer.byteLength(body)>REQUEST_LIMIT)return reject(error('request_too_large','Task request exceeds limit'));
    const socket=createConnection(socketPath);let buffer=Buffer.alloc(0),done=false;
    const finish=(failure,result)=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();failure?reject(failure):resolveCall(result);};
    const timer=setTimeout(()=>finish(error('deadline_exceeded','Task result is unknown; query task status before retrying')),timeoutMs);
    socket.once('connect',()=>socket.write(body));socket.once('error',()=>finish(error('unavailable','Task service unavailable')));
    socket.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);if(buffer.length>RESPONSE_LIMIT)return finish(error('response_too_large','Task response exceeds limit'));
      const newline=buffer.indexOf(10);if(newline<0)return;
      let response;try{response=JSON.parse(buffer.subarray(0,newline));}catch{return finish(error('invalid_response','Invalid task response'));}
      if(buffer.length!==newline+1||response.id!==requestId&&response.id!==null||typeof response.ok!=='boolean')return finish(error('invalid_response','Invalid task response'));
      if(!response.ok)return finish(error(typeof response.error?.code==='string'?response.error.code:'task_failed',typeof response.error?.message==='string'?response.error.message:'Task operation failed'));
      finish(null,response.result);
    });
    socket.once('end',()=>{if(!done)finish(error('unavailable','Task service closed before returning a result'));});
  });
  return Object.fromEntries(methods.map(method=>[method,(...args)=>call(method,args)]));
}
