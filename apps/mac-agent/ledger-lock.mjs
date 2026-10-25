import {open,lstat,realpath,rename,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {dirname} from 'node:path';
import {assertPrivateParent,readPrivateJson} from './private-files.mjs';

const failure=()=>Error('ledger lock unavailable or ownership changed');
const privateFile=info=>info.isFile()&&info.nlink===1&&info.uid===process.getuid()&&(info.mode&0o077)===0;
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;

export async function acquireLedgerLock({stateFile,deviceId,spawnLock=spawnSync}={}){
 const metadataPath=stateFile+'.lock',guardPath=metadataPath+'.guard';
 await assertPrivateParent(metadataPath);
 const command=process.platform==='darwin'?'/usr/bin/lockf':process.platform==='linux'?'/usr/bin/flock':null;
 if(!command)throw failure();
 const tool=await lstat(command);
 if(!tool.isFile()||tool.isSymbolicLink()||tool.uid!==0||(tool.mode&0o022)!==0||await realpath(command)!==command)throw failure();
 let guard,metadata,ownedMetadata,released=false,releasePromise;
 const syncParent=async()=>{const directory=await open(dirname(metadataPath),'r');try{await directory.sync();}finally{await directory.close();}};
 async function checkedGuard(){
  const current=await lstat(guardPath),held=await guard.stat();
  if(!privateFile(current)||!privateFile(held)||!same(current,held))throw failure();
 }
 function release(){
  if(releasePromise)return releasePromise;
  released=true;
  releasePromise=(async()=>{
   try{
    if(ownedMetadata){
     try{const current=await lstat(metadataPath);if(same(current,ownedMetadata))await unlink(metadataPath);}catch(error){if(error.code!=='ENOENT')throw error;}
     await syncParent();
    }
   }finally{try{await metadata?.close();}finally{await guard?.close();}}
  })();
  return releasePromise;
 }
 try{
  try{if(!privateFile(await lstat(guardPath)))throw failure();}catch(error){if(error.code!=='ENOENT')throw error;}
  guard=await open(guardPath,constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
  await checkedGuard();
  // BSD lockf and Linux flock lock the inherited open-file description. The
  // helper exits immediately; this process retains ownership through guard.fd.
  const args=process.platform==='darwin'?['-s','-t','0','3']:['--exclusive','--nonblock','3'];
  const result=spawnLock(command,args,{stdio:['ignore','pipe','pipe',guard.fd],env:{},timeout:3000,maxBuffer:4096});
  if(result.error||result.signal||result.status!==0)throw failure();
  await checkedGuard();
  let previous;
  try{
   const info=await lstat(metadataPath);if(!privateFile(info))throw failure();
   previous=await readPrivateJson(metadataPath,{maxBytes:65536});
   if(!same(info,await lstat(metadataPath))||previous.deviceId!==deviceId)throw failure();
   if(previous.version===1){
    if(!Number.isSafeInteger(previous.pid)||previous.pid<=1||!Number.isFinite(Date.parse(previous.startedAt)))throw failure();
    // A legacy process does not hold the kernel guard. Only ESRCH proves its
    // recorded PID is gone; a live/reused PID or EPERM stays conservative.
    try{process.kill(previous.pid,0);throw failure();}catch(error){if(error.code!=='ESRCH')throw error;}
   }else if(previous.version!==2||previous.lockMode!=='kernel-flock-v1')throw failure();
   await rename(metadataPath,metadataPath+'.previous-'+randomUUID());
  }catch(error){if(error.code!=='ENOENT')throw error;}
  // Retain O_EXCL metadata for safe coexistence with old Agent versions. An old
  // process racing migration wins this create or loses it; both cannot own it.
  metadata=await open(metadataPath,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  ownedMetadata=await metadata.stat();
  await metadata.writeFile(JSON.stringify({version:2,lockMode:'kernel-flock-v1',deviceId,pid:process.pid,ownerId:randomUUID(),startedAt:new Date().toISOString()}));
  await metadata.sync();await syncParent();
  async function assertHeld(){
   if(released)throw failure();
   await checkedGuard();const current=await lstat(metadataPath);
   if(!privateFile(current)||!same(current,ownedMetadata))throw failure();
  }
  await assertHeld();
  return {assertHeld,release};
 }catch{await release();throw failure();}
}
