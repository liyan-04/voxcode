import * as fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const execute=promisify(execFile);
export const TASK_SERVICE='voxcode-task.service';
const PRIVATE_MODE=0o600;
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(message,code='configuration')=>Object.assign(Error(message),{code});
const canonical=path=>{if(typeof path!=='string'||!path.startsWith('/')||resolve(path)!==path||/[\x00-\x1f\x7f]/u.test(path))throw fail('Canonical absolute path required');return path;};
const operatorUid=process.getuid?.()??0,operatorGid=process.getgid?.()??0;
const effectiveUid=uid=>operatorUid===0?uid??0:operatorUid;
const effectiveGid=gid=>operatorUid===0?gid??0:operatorGid;

async function info(fsImpl,path){try{return await fsImpl.lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function regular(fsImpl,path,{owners=[0,process.getuid?.()],mode=0o022,privateFile=false,gid}={}){
  canonical(path);const value=await info(fsImpl,path);
  if(!value||value.isSymbolicLink()||!value.isFile()||value.nlink!==1||!owners.includes(value.uid)||gid!==undefined&&value.gid!==gid||(value.mode&(privateFile?0o077:mode)))throw fail(`Trusted regular file required: ${path}`,'ownership');
  if(await fsImpl.realpath(path)!==path)throw fail('Canonical private file required','ownership');
  return value;
}
async function directory(fsImpl,path,{owners=[0,process.getuid?.()],mode=0o022,create=false,uid,gid,createMode=0o700}={}){
  canonical(path);if(create){await fsImpl.mkdir(path,{recursive:true,mode:createMode});await fsImpl.chmod(path,createMode);if(uid!==undefined||gid!==undefined)await fsImpl.chown(path,effectiveUid(uid),effectiveGid(gid));}
  const value=await info(fsImpl,path);
  if(!value||value.isSymbolicLink()||!value.isDirectory()||!owners.includes(value.uid)||(value.mode&mode)||await fsImpl.realpath(path)!==path)throw fail(`Trusted private directory required: ${path}`,'ownership');
  return value;
}
async function writeAtomic(fsImpl,path,bytes,{mode=PRIVATE_MODE,uid,gid}={}){
  await directory(fsImpl,dirname(path),{create:true});
  const temporary=join(dirname(path),`.server-task-${randomUUID()}`);
  try{await fsImpl.writeFile(temporary,bytes,{mode,flag:'wx'});await fsImpl.chmod(temporary,mode);if(uid!==undefined||gid!==undefined)await fsImpl.chown(temporary,effectiveUid(uid),effectiveGid(gid));await fsImpl.rename(temporary,path);}
  finally{await fsImpl.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function readText(fsImpl,path){return (await fsImpl.readFile(path,'utf8'));}

export function validateServerTaskConfig(config){
  const required=['format','revision','root','service','serviceUser','serviceUid','serviceGroup','serviceGid','toolSource','toolPath','projectsFile','dataDirectory','socketPath','envFile','modelConfigSource','modelConfigPath','stateFile'];
  if(!config||config.format!==1||Object.keys(config).some(key=>!required.includes(key)&&key!=='unitDirectory')||config.service!==TASK_SERVICE||config.serviceUser==='root'||config.serviceUser==='voxcode-control'||!/^voxcode-task$/u.test(config.serviceUser)||config.serviceGroup!=='voxcode-rpc'||!Number.isInteger(config.serviceUid)||config.serviceUid<=0||!Number.isInteger(config.serviceGid)||config.serviceGid<0||!/^[a-f0-9]{40}$/u.test(config.revision??''))throw fail('Dedicated non-root task identity is required');
  for(const key of ['root','toolSource','toolPath','projectsFile','dataDirectory','socketPath','envFile','modelConfigSource','modelConfigPath','stateFile',...(config.unitDirectory?['unitDirectory']:[])])canonical(config[key]);
  if(config.toolPath===config.toolSource||config.toolPath.startsWith(config.toolSource+'/'))throw fail('Tool destination must be separate from source');
  if(config.modelConfigPath===config.modelConfigSource)throw fail('Model configuration destination must be private and separate');
  if(config.modelConfigPath.startsWith('/root/')||config.toolPath.startsWith('/root/'))throw fail('Root-owned runtime paths are not valid task destinations');
  return config;
}

export async function readServerTaskConfig(path,{fsImpl=fs}={}){
  await regular(fsImpl,path,{privateFile:true});
  let config;try{config=JSON.parse(await readText(fsImpl,path));}catch{throw fail('Invalid private server task configuration');}
  return validateServerTaskConfig(config);
}

export function renderTaskEnv(config){
  validateServerTaskConfig(config);
  return [
    `VOXCODE_PROJECTS_FILE=${config.projectsFile}`,
    `VOXCODE_TASK_DATA=${config.dataDirectory}`,
    `VOXCODE_TASK_SOCKET=${config.socketPath}`,
    `VOXCODE_CODEX_COMMAND=${config.toolPath}`,
    `CODEX_HOME=${dirname(config.modelConfigPath)}`,
  ].join('\n')+'\n';
}

export function renderTaskUnit(config){
  validateServerTaskConfig(config);const root=config.root;
  return `[Unit]\nDescription=VoxCode isolated Codex CLI task service\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser=${config.serviceUser}\nGroup=${config.serviceGroup}\nWorkingDirectory=${root}/current\nEnvironment=HOME=${dirname(config.modelConfigPath)}\nEnvironment=PATH=/usr/local/bin:/usr/bin:/bin\nEnvironmentFile=${config.envFile}\nExecStart=/usr/local/bin/node ${root}/current/apps/server/task-cli.mjs start\nRestart=on-failure\nRestartSec=3\nRuntimeDirectory=voxcode-task\nRuntimeDirectoryMode=0750\nTimeoutStopSec=25\nKillMode=control-group\nUMask=0007\nPrivateTmp=yes\nProtectSystem=strict\nProtectHome=yes\nReadWritePaths=${config.dataDirectory} ${dirname(config.modelConfigPath)}\nReadOnlyPaths=${dirname(config.projectsFile)}\nInaccessiblePaths=${root}/shared/config ${root}/shared/state /var/lib/voxcode\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\nNoNewPrivileges=yes\nCapabilityBoundingSet=\n\n[Install]\nWantedBy=multi-user.target\n`;
}

async function verifyAccount(config,run){
  const uid=Number((await run('id',['-u',config.serviceUser])).stdout.trim()),gid=Number((await run('id',['-g',config.serviceGroup])).stdout.trim());
  if(uid!==config.serviceUid||gid!==config.serviceGid||uid===0)throw fail('Dedicated task account or group identity mismatch','ownership');
}
async function copyOwned(fsImpl,source,destination,{privateFile=false,uid,gid,dirMode=0o700}={}){
  const sourceInfo=await regular(fsImpl,source,{privateFile});
  if(!privateFile&&(sourceInfo.mode&0o111)===0)throw fail('Codex source must be executable','ownership');
  await directory(fsImpl,dirname(destination),{create:true,uid,gid,createMode:dirMode,owners:[0,process.getuid?.(),uid].filter(Number.isInteger),mode:0o022});
  const bytes=await fsImpl.readFile(source);const temporary=join(dirname(destination),`.server-task-copy-${randomUUID()}`);
  const canChown=operatorUid===0;
  try{await fsImpl.writeFile(temporary,bytes,{mode:privateFile?PRIVATE_MODE:0o755,flag:'wx'});await fsImpl.chmod(temporary,privateFile?PRIVATE_MODE:0o755);if(canChown&&(uid!==undefined||gid!==undefined))await fsImpl.chown(temporary,effectiveUid(uid),effectiveGid(gid));await fsImpl.rename(temporary,destination);}finally{await fsImpl.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  const result=await regular(fsImpl,destination,{owners:[0,process.getuid?.(),uid,sourceInfo.uid].filter(Number.isInteger),gid:canChown?gid:undefined,privateFile});
  if(sha256(await fsImpl.readFile(destination))!==sha256(bytes))throw fail('Copied private resource checksum changed','ownership');
  return {sha256:sha256(bytes),mode:result.mode&0o777};
}
async function command(run,name,args){return run(name,args,{timeout:30000,maxBuffer:64*1024});}

export function createServerTaskController({run=execute,fsImpl=fs,unitDirectory='/etc/systemd/system',health}={}){
  const executeRun=(name,args,options)=>command(run,name,args,options);
  async function paths(config){validateServerTaskConfig(config);return {unit:join(unitDirectory,TASK_SERVICE),env:config.envFile,state:config.stateFile};}
  async function systemState(config){const {stdout}=await executeRun('systemctl',['show',TASK_SERVICE,'--no-pager','--property=LoadState,FragmentPath,User,Group,MainPID,ActiveState']);const values=Object.fromEntries(stdout.trim().split('\n').filter(Boolean).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));return values;}
  async function listener(config){const result=await executeRun('ss',['-lx']);return result.stdout.trim();}
  const currentActive=state=>state.ActiveState==='active';
  async function healthCheck(config,revision){
    if(health){await health(config,revision);return;}
    for(let attempt=0;attempt<20;attempt++){
      const state=await systemState(config),line=await listener(config);
      if(currentActive(state)&&line)return;
      if(attempt<19)await new Promise(resolveDelay=>setTimeout(resolveDelay,250));
    }
    throw fail('Task service health check failed','health');
  }
  async function inspect(config,{allowUninstalled=true}={}){
    validateServerTaskConfig(config);const p=await paths(config),unitInfo=await info(fsImpl,p.unit),state=await systemState(config),line=await listener(config);
    if(line.includes('foreign')||line.includes('unrelated'))throw fail('Unrelated task listener ownership','ownership');
    if(!currentActive(state)&&line)throw fail('Inactive task service has an existing listener','ownership');
    if(!unitInfo&&!allowUninstalled)throw fail('Owned task service unit is missing','ownership');
    if(unitInfo&&currentActive(state)&&!line.split('\n').some(entry=>entry.includes(config.socketPath)))throw fail('Active task service socket ownership is unconfirmed','ownership');
    if(unitInfo){await regular(fsImpl,p.unit,{owners:[0,process.getuid?.()],mode:0o022});if(state.FragmentPath!==p.unit||state.User!==config.serviceUser||state.Group!==config.serviceGroup)throw fail('Task service registration ownership mismatch','ownership');}
    return {installed:Boolean(unitInfo),active:state.ActiveState==='active',state};
  }
  async function readState(config){const p=await paths(config),value=await info(fsImpl,p.state);if(!value)return null;await regular(fsImpl,p.state,{privateFile:true});try{return JSON.parse(await readText(fsImpl,p.state));}catch{throw fail('Invalid server task lifecycle record');}}
  async function snapshot(config,unit,env,tool,model){return {format:1,revision:config.revision,unit,env,tool:{...tool,source:config.toolSource},model:{...model,source:config.modelConfigSource}};}
  async function install(config,{activate=false,replace=false}={}){
    validateServerTaskConfig(config);await verifyAccount(config,run);const before=await readState(config);const current=await inspect(config);if(current.installed&&!before&&!replace)throw fail('Existing task service requires explicit adoption','ownership');
    const toolInfo=await regular(fsImpl,config.toolSource,{owners:[0,process.getuid?.()],mode:0o022});
    const modelInfo=await info(fsImpl,config.modelConfigSource);if(!modelInfo)throw fail('Designated model configuration is missing; live authentication cannot be verified','model_config_missing');
    await regular(fsImpl,config.modelConfigSource,{owners:[0,process.getuid?.()],privateFile:true});
    await regular(fsImpl,config.projectsFile,{owners:[0,config.serviceUid],gid:config.serviceGid,mode:0o027});
    const unit=renderTaskUnit(config),env=renderTaskEnv(config);
    const existingTool=await info(fsImpl,config.toolPath),existingModel=await info(fsImpl,config.modelConfigPath);
    if(before?.current?.revision===config.revision&&before.current.unit===unit&&before.current.env===env&&existingTool&&existingModel&&before.current.tool?.sha256===sha256(await fsImpl.readFile(config.toolPath))&&before.current.model?.sha256===sha256(await fsImpl.readFile(config.modelConfigPath))){
      return {installed:true,unchanged:true,revision:config.revision,active:current.active};
    }
    const unitPath=join(unitDirectory,TASK_SERVICE),filePaths=[config.toolPath,config.modelConfigPath,config.envFile,unitPath,config.stateFile],snapshots=new Map();
    for(const path of filePaths){const value=await info(fsImpl,path);if(value)snapshots.set(path,await fsImpl.readFile(path));}
    try{
      await directory(fsImpl,config.root,{create:true,createMode:0o755,owners:[0,process.getuid?.()],mode:0o022});
      await directory(fsImpl,config.dataDirectory,{create:true,uid:config.serviceUid,gid:config.serviceGid,createMode:0o700,owners:[config.serviceUid],mode:0o077});
      await copyOwned(fsImpl,config.toolSource,config.toolPath,{uid:0,gid:0,dirMode:0o755});await copyOwned(fsImpl,config.modelConfigSource,config.modelConfigPath,{privateFile:true,uid:config.serviceUid,gid:config.serviceGid,dirMode:0o700});
      await writeAtomic(fsImpl,config.envFile,Buffer.from(env),{mode:0o640,uid:0,gid:config.serviceGid});await writeAtomic(fsImpl,join(unitDirectory,TASK_SERVICE),Buffer.from(unit),{mode:0o644,uid:0,gid:0});
      const state=await snapshot(config,unit,env,{sha256:sha256(await fsImpl.readFile(config.toolPath)),sourceUid:toolInfo.uid},{sha256:sha256(await fsImpl.readFile(config.modelConfigPath)),sourceUid:modelInfo.uid});
      if(before)state.previous=before.current;
      await writeAtomic(fsImpl,config.stateFile,Buffer.from(JSON.stringify({format:1,current:state,previous:before?.current??null})+'\n'));
      await executeRun('systemctl',['daemon-reload']);await executeRun('systemctl',['enable',TASK_SERVICE]);
      if(activate){await executeRun('systemctl',['start',TASK_SERVICE]);await healthCheck(config,state.revision);}
      return {installed:true,unchanged:Boolean(before&&before.current?.revision===config.revision),revision:config.revision,active:activate};
    }catch(error){
      if(activate)await executeRun('systemctl',['stop',TASK_SERVICE]).catch(()=>{});
      for(const path of filePaths){try{if(snapshots.has(path)){const isTool=path===config.toolPath,isUnit=path===unitPath,isEnv=path===config.envFile;await writeAtomic(fsImpl,path,snapshots.get(path),{mode:isUnit?0o644:isEnv?0o640:isTool?0o755:PRIVATE_MODE,uid:isUnit||isEnv||isTool?0:config.serviceUid,gid:isUnit?0:isEnv?config.serviceGid:isTool?0:config.serviceGid});}else await fsImpl.unlink(path);}catch{}}
      await executeRun('systemctl',['daemon-reload']).catch(()=>{});
      if(before&&current.active){await executeRun('systemctl',['start',TASK_SERVICE]).catch(()=>{});}
      if(!before)await executeRun('systemctl',['disable',TASK_SERVICE]).catch(()=>{});
      throw Error(before?'Task activation failed; previous runtime and private configuration recovered':'Task installation failed; owned files were removed');
    }
  }
  async function restore(config,old){
    if(!old)return;await writeAtomic(fsImpl,config.envFile,Buffer.from(old.env),{mode:0o640,uid:0,gid:config.serviceGid});await writeAtomic(fsImpl,join(unitDirectory,TASK_SERVICE),Buffer.from(old.unit),{mode:0o644,uid:0,gid:0});if(old.tool?.source)await copyOwned(fsImpl,old.tool.source,config.toolPath,{uid:0,gid:0,dirMode:0o755});if(old.model?.source)await copyOwned(fsImpl,old.model.source,config.modelConfigPath,{privateFile:true,uid:config.serviceUid,gid:config.serviceGid,dirMode:0o700});await writeAtomic(fsImpl,config.stateFile,Buffer.from(JSON.stringify({format:1,current:old,previous:null})+'\n'));await executeRun('systemctl',['daemon-reload']);
  }
  async function lifecycle(commandName,config){
    validateServerTaskConfig(config);const state=await readState(config);if(commandName==='status')return {...await inspect(config),revision:state?.current?.revision??null};if(commandName==='install')return install(config);if(!state)throw fail('Owned task installation required','ownership');await inspect(config,{allowUninstalled:false});
    if(commandName==='start'){await executeRun('systemctl',['start',TASK_SERVICE]);await healthCheck(config,state.current.revision);return {started:true,revision:state.current.revision};}
    if(commandName==='stop'){await executeRun('systemctl',['stop',TASK_SERVICE]);return {stopped:true};}
    if(commandName==='restart'){await executeRun('systemctl',['restart',TASK_SERVICE]);await healthCheck(config,state.current.revision);return {restarted:true,revision:state.current.revision};}
    if(commandName==='rollback'){if(!state.previous)throw fail('No previous server task release retained');await restore(config,state.previous);return {rolledBack:true,revision:state.previous.revision};}
    if(commandName==='update')return install(config,{activate:true});
    throw fail('Unknown server task lifecycle command');
  }
  return {execute:lifecycle,inspect,install,start:config=>lifecycle('start',config),stop:config=>lifecycle('stop',config),restart:config=>lifecycle('restart',config),rollback:config=>lifecycle('rollback',config)};
}

export function isMain(url){return process.argv[1]&&resolve(process.argv[1])===fileURLToPath(url);}
if(isMain(import.meta.url)){
  try{
    if(process.getuid?.()!==0)throw Error('Server task provisioning requires the host administrator; the task service itself remains non-root');
    const [command,...args]=process.argv.slice(2);let configPath=null,activate=false;
    for(let i=0;i<args.length;i++){if(args[i]==='--config'&&args[i+1]&&!configPath)configPath=args[++i];else if(args[i]==='--activate')activate=true;else throw Error('Usage: server-task.mjs <install|update|start|stop|restart|rollback|status> --config PRIVATE_JSON [--activate]');}
    if(!command||!configPath)throw Error('Usage: server-task.mjs <install|update|start|stop|restart|rollback|status> --config PRIVATE_JSON [--activate]');
    const config=await readServerTaskConfig(configPath),controller=createServerTaskController();
    const result=command==='install'?await controller.install(config,{activate}):await controller.execute(command,config);console.log(JSON.stringify(result));
  }
  catch(error){console.error(error.code==='model_config_missing'?error.message:'Server task lifecycle blocked; inspect dedicated account, tool, model config and service ownership');process.exitCode=1;}
}
