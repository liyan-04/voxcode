import * as fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {createMacLaunchctl} from './mac-launchctl.mjs';
import {createTaskRpcClient} from '../../apps/server/task-rpc.mjs';
import {acquireLedgerLock} from '../../apps/mac-agent/ledger-lock.mjs';

const labels=['io.voxcode.control-task','io.voxcode.control-agent'],execute=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const failure=(code,extra={})=>Object.assign(Error('Mac restart '+code),{code,...extra});
function idle(status){if(!status?.available||status.activeTasks!==0||status.quarantined)throw failure('task_busy');}

export async function restartOwnedMac(driver){
 const guard=await driver.acquireLock();let mutated=false;
 try{
  await driver.verify();idle(await driver.taskStatus());
  mutated=true;await driver.launch.stop(labels[1]);idle(await driver.taskStatus());await driver.launch.stop(labels[0]);
  await driver.launch.start(labels[0]);await driver.waitTaskReady();await driver.launch.start(labels[1]);await driver.verify();
  return {ok:true,restarted:true};
 }catch(error){
  if(!mutated)throw error;
  let rollbackConfirmed=false;
  try{
   for(const label of labels)await driver.launch.settleStopped(label);
   await driver.launch.start(labels[0]);await driver.waitTaskReady({allowActive:true});await driver.launch.start(labels[1]);await driver.verify();rollbackConfirmed=true;
  }catch{}
  throw failure('restart_failed',{causeCode:typeof error.code==='string'?error.code:'service_start_failed',rollbackConfirmed});
 }finally{await guard.release();}
}

export async function inspectInstalledMac({root=join(homedir(),'Library/Application Support/VoxCodeControl'),onEvent=()=>{}}={}){
 if(process.platform!=='darwin'||!Number.isInteger(process.getuid?.())||process.getuid()===0)throw failure('mac_user_required');
 const uid=process.getuid(),home=homedir();
 if(resolve(root)!==root||await fs.realpath(root)!==root)throw failure('configuration');
 const run=(command,args,options={})=>execute(command,args,{timeout:Math.min(10000,options.timeout??10000),maxBuffer:256*1024,env:{PATH:'/usr/bin:/bin',HOME:home}});
 async function trusted(path,{privateFile=false,directory=false}={}){
  const info=await fs.lstat(path);
  if(info.isSymbolicLink()||(directory?!info.isDirectory():!info.isFile())||![0,uid].includes(info.uid)||(info.mode&(privateFile?0o077:0o022))||!directory&&info.nlink!==1||await fs.realpath(path)!==path)throw failure('ownership');
  for(let part=dirname(path);;part=dirname(part)){
   const parent=await fs.lstat(part),sticky=parent.uid===0&&(parent.mode&0o1000);
   if(!parent.isDirectory()||parent.isSymbolicLink()||![0,uid].includes(parent.uid)||(parent.mode&0o022)&&!sticky)throw failure('ownership');
   if(part===dirname(part))break;
  }
  return info;
 }
 await trusted(root,{privateFile:true,directory:true});await trusted(root+'/private',{privateFile:true,directory:true});
 const manifestPath=root+'/private/install-manifest.json';await trusted(manifestPath,{privateFile:true});const manifestBytes=await fs.readFile(manifestPath),manifest=JSON.parse(manifestBytes);
 if(!/^[a-f0-9]{40}$/u.test(manifest.revision??'')||!Array.isArray(manifest.runtime)||manifest.sourceClass!=='exact-merged-master')throw failure('exact_installation_required');
 const snapshots=new Map([[manifestPath,hash(manifestBytes)]]),jobs=[],interpreters=[];let taskEnv;
 const interpreter=await fs.realpath(process.execPath),interpreterHash=hash(await fs.readFile(interpreter));
 async function checkInterpreter(argument){
  const canonical=await fs.realpath(argument),info=await fs.lstat(canonical);
  // The existing installation uses a Homebrew alias. Pin it to this already
  // executing interpreter; do not change global Homebrew directory permissions.
  if(canonical!==interpreter||!info.isFile()||info.isSymbolicLink()||info.nlink!==1||![0,uid].includes(info.uid)||(info.mode&0o022)||(info.mode&0o111)===0||hash(await fs.readFile(canonical))!==interpreterHash)throw failure('interpreter_changed');
 }
 for(let index=0;index<labels.length;index++){
  const label=labels[index],plistPath=join(home,'Library/LaunchAgents',label+'.plist');await trusted(plistPath);
  const bytes=await fs.readFile(plistPath),plist=JSON.parse((await run('/usr/bin/plutil',['-convert','json','-o','-',plistPath])).stdout),args=plist.ProgramArguments;
  if(plist.Label!==label||plist.WorkingDirectory!==root||!Array.isArray(args)||args[0]!=='/usr/bin/env'||args[1]!=='-i')throw failure('ownership');
  const nodeIndex=args.findIndex((value,i)=>i>=2&&typeof value==='string'&&value.startsWith('/')&&!value.includes('='));if(nodeIndex<2)throw failure('ownership');
  await checkInterpreter(args[nodeIndex]);interpreters.push(args[nodeIndex]);
  const env=Object.fromEntries(args.slice(2,nodeIndex).map(value=>{const split=value.indexOf('=');if(split<1)throw failure('configuration');return [value.slice(0,split),value.slice(split+1)];}));
  const tail=index===0?[root+'/runtime/apps/server/task-cli.mjs','start']:[root+'/runtime/apps/mac-agent/cli.mjs','--config',root+'/private/agent.json','--task-socket',root+'/private/rpc.sock'];
  if(JSON.stringify(args.slice(nodeIndex+1))!==JSON.stringify(tail))throw failure('ownership');
  if(index===0){
   if(Object.keys(env).some(k=>!/^(HOME|CODEX_HOME|PATH|LANG|VOXCODE_PROJECTS_FILE|VOXCODE_TASK_DATA|VOXCODE_TASK_SOCKET|VOXCODE_CODEX_COMMAND)$/u.test(k))||env.VOXCODE_TASK_SOCKET!==root+'/private/rpc.sock'||env.VOXCODE_PROJECTS_FILE!==root+'/private/projects.json'||!env.CODEX_HOME||!env.VOXCODE_TASK_DATA)throw failure('configuration');taskEnv=env;
  }else if(Object.keys(env).some(k=>!['HOME','LANG','PATH','NODE_EXTRA_CA_CERTS'].includes(k)))throw failure('configuration');
  snapshots.set(plistPath,hash(bytes));jobs.push({label,plistPath,args});
 }
 for(const item of manifest.runtime){
  if(typeof item.path!=='string'||!item.path||item.path.startsWith('/')||item.path.split('/').some(x=>!x||x==='.'||x==='..')||!/^[a-f0-9]{64}$/u.test(item.sha256??''))throw failure('configuration');
  const path=join(root,'runtime',item.path);await trusted(path);if(hash(await fs.readFile(path))!==item.sha256)throw failure('source_changed');snapshots.set(path,item.sha256);
 }
 for(const path of [root+'/private/agent.json',taskEnv.VOXCODE_PROJECTS_FILE]){await trusted(path,{privateFile:true});snapshots.set(path,hash(await fs.readFile(path)));}
 await trusted(taskEnv.CODEX_HOME,{privateFile:true,directory:true});await trusted(taskEnv.VOXCODE_TASK_DATA,{privateFile:true,directory:true});
 const rpc=createTaskRpcClient({socketPath:taskEnv.VOXCODE_TASK_SOCKET,timeoutMs:2000});
 async function unchanged(){for(const argument of interpreters)await checkInterpreter(argument);for(const [path,digest] of snapshots){await trusted(path,{privateFile:path.startsWith(root+'/private/')});if(hash(await fs.readFile(path))!==digest)throw failure('installation_changed');}}
 const launch=createMacLaunchctl({jobs,uid,run,onEvent,verifyRegistration:unchanged,inspectProcess:async pid=>{
  try{
   const {stdout}=await run('/bin/ps',['-ww','-p',String(pid),'-o','uid=','-o','lstart=','-o','command=']);
   const match=/^\s*(\d+)\s+(\w{3} \w{3}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+(.+)$/u.exec(stdout.trim());if(!match)throw failure('process_inspection');return {uid:Number(match[1]),birth:match[2],command:match[3]};
  }catch(error){if(Number(error.code)===1)return null;throw failure('process_inspection');}
 }});
 const driver={launch,revision:manifest.revision,acquireLock:()=>acquireLedgerLock({stateFile:root+'/private/restart-operation.json',deviceId:'owned-mac-restart'}),taskStatus:()=>rpc.status(),
  async waitTaskReady({allowActive=false}={}){const end=performance.now()+15000;for(;;){try{const status=await rpc.status();if(allowActive&&status.available&&!status.quarantined)return;idle(status);return;}catch(error){if(error.code==='task_busy')throw error;if(performance.now()>=end)throw failure('rpc_timeout');await delay(250);}}},
  async verify(){await unchanged();for(const label of labels){const job=await launch.inspect(label);if(!job?.pid||job.state!=='running')throw failure('service_not_running');}},
 };
 return driver;
}

export async function main(args=process.argv.slice(2)){
 const [action,...options]=args;if(!['status','restart'].includes(action)||options.length&&!(options.length===2&&options[0]==='--root'))throw failure('usage');
 const driver=await inspectInstalledMac({...(options.length?{root:options[1]}:{}),onEvent:event=>console.log(JSON.stringify(event))});
 if(action==='restart')return {...await restartOwnedMac(driver),revision:driver.revision};
 await driver.verify();const status=await driver.taskStatus();return {ok:true,revision:driver.revision,activeTasks:status.activeTasks,quarantined:status.quarantined===true,available:status.available===true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(result=>console.log(JSON.stringify(result)),error=>{console.error(JSON.stringify({ok:false,code:error.code??'restart_unavailable',...(error.rollbackConfirmed!==undefined?{rollbackConfirmed:error.rollbackConfirmed}:{})}));process.exitCode=1;});
