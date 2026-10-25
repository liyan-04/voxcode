import * as fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {dirname,join,isAbsolute,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readBundle,sha256} from './package.mjs';

export const commandRunner=promisify(execFile);
export async function exists(path){try{await fs.lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
export function canonical(path){if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||/[\x00-\x1f\x7f]/u.test(path))throw Error('Canonical absolute path required');return path;}
export async function trusted(path,{owners=[0,process.getuid()],privateFile=false,type='file'}={}){
 canonical(path);const info=await fs.lstat(path);
 if(info.isSymbolicLink()||!(type==='directory'?info.isDirectory():info.isFile())||!owners.includes(info.uid)||info.mode&(privateFile?0o077:0o022)||await fs.realpath(path)!==path||type==='file'&&info.nlink!==1)throw Error('Trusted ownership and permissions required');
 for(let part=dirname(path);;part=dirname(part)){
  const parent=await fs.lstat(part),sticky=parent.uid===0&&(parent.mode&0o1000)!==0;
  if(!parent.isDirectory()||parent.isSymbolicLink()||!owners.includes(parent.uid)||(parent.mode&0o022)&&!sticky)throw Error('Trusted canonical ancestors required');
  if(part===dirname(part))break;
 }
 return info;
}
export async function readJson(path,options){await trusted(path,{privateFile:true,...options});const info=await fs.stat(path);if(info.size>4*1024*1024)throw Error('Private JSON is too large');return JSON.parse(await fs.readFile(path,'utf8'));}
export async function writeAtomic(path,bytes,{mode=0o600,uid=process.getuid(),gid=process.getgid()}={}){
 if(await exists(path))await trusted(path,{owners:[0,process.getuid(),uid],privateFile:mode===0o600});
 const temporary=join(dirname(path),`.lifecycle-${randomUUID()}`);
 try{
  await fs.writeFile(temporary,bytes,{mode,flag:'wx'});
  if(uid!==process.getuid()||gid!==process.getgid())await fs.chown(temporary,uid,gid);
  const handle=await fs.open(temporary,'r');try{await handle.sync();}finally{await handle.close();}
  await fs.rename(temporary,path);
 }finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function inventory(root,owner=process.getuid()){
 const files={};
 async function visit(path,prefix){
  const info=await fs.lstat(path);
  if(info.isSymbolicLink()||![0,owner].includes(info.uid)||info.mode&0o022)throw Error('Runtime ownership changed');
  if(info.isDirectory()){for(const name of (await fs.readdir(path)).sort())await visit(join(path,name),prefix?`${prefix}/${name}`:name);}
  else if(info.isFile()&&info.nlink===1)files[prefix]=sha256(await fs.readFile(path));
  else throw Error('Regular immutable runtime files required');
 }
 await visit(root,'');return files;
}
export function runtimePath(ctx,target){
 const standard=join(ctx.root,'releases',target.revision),path=target.runtimeDirectory??standard;
 if(path!==standard&&path!==join(ctx.root,'runtime'))throw Error('Unexpected owned runtime directory');return path;
}
async function normalizeRuntime(path){
 const info=await fs.lstat(path);if(info.isSymbolicLink()||info.uid!==process.getuid())throw Error('Refusing foreign dependency ownership');
 if(info.isDirectory()){await fs.chmod(path,0o755);for(const name of await fs.readdir(path))await normalizeRuntime(join(path,name));}
 else if(info.isFile()&&info.nlink===1)await fs.chmod(path,info.mode&0o111?0o755:0o644);
 else throw Error('Only regular dependency files are accepted');
}
async function mkdirOwned(path,mode){try{await fs.mkdir(path,{mode});await fs.chmod(path,mode);}catch(error){if(error.code!=='EEXIST')throw error;}}
export function redactLogs(text,lines){
 if(!Number.isInteger(lines)||lines<1||lines>500)throw Error('--lines must be between 1 and 500');
 return String(text).slice(-64*1024).trimEnd().split(/\r?\n/u).slice(-lines).map(line=>line.replace(/((?:token|secret|password|authorization|api[_-]?key)\s*[=:]\s*)[^\s,;]+/giu,'$1[redacted]').replace(/(https?:\/\/|wss?:\/\/)([^\s?#]+)[?#][^\s]+/giu,'$1$2?[redacted]')).join('\n');
}
export function runner(run=commandRunner){return async(command,args,options={})=>{
 try{return await run(command,args,{timeout:30000,maxBuffer:256*1024,env:{PATH:'/usr/bin:/bin'},...options});}
 catch{throw Error(`Command failed: ${command.split('/').at(-1)}`);}
};}
async function currentLink(root,target){
 const path=join(root,'current');
 if(!target){if(await exists(path))await fs.unlink(path);return;}
 const temporary=join(root,`.current-${randomUUID()}`);await fs.symlink(runtimePath({root},target),temporary);
 try{await fs.rename(temporary,path);}finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function verifyTarget(ctx,target){
 if(!target||!/^[a-f0-9]{40}$/u.test(target.revision)||!/^[a-f0-9]{64}$/u.test(target.digest))throw Error('Invalid owned runtime state');
 const actual=await inventory(runtimePath(ctx,target));
 if(JSON.stringify(actual)!==JSON.stringify(target.inventory))throw Error('Runtime source ownership or checksum changed');
}
async function writeTarget(ctx,target,driver){
 for(const [path,value] of Object.entries(target.configuration)){
  if(!driver.configurationPaths(ctx).includes(path))throw Error('Unexpected private state path');
  await writeAtomic(path,Buffer.from(value,'base64'),{uid:ctx.serviceUid,gid:ctx.serviceGid});
 }
 for(const [path,text] of Object.entries(target.registrations)){
  if(!driver.registrationPaths(ctx).includes(path))throw Error('Unexpected service registration path');
  await writeAtomic(path,text,{mode:0o644});
 }
 await currentLink(ctx.root,target);
}
async function tools(ctx,run){
 for(const path of [ctx.node,ctx.npm])await trusted(path);
 const version=(await run(ctx.node,['--version'])).stdout.trim();if(!/^v(?:2[2-9]|[3-9][0-9])\./u.test(version))throw Error('Node >=22 required');
}
async function operationLock(ctx,fn,{recoverStale=false}={}){
 const lock=join(ctx.root,'.lifecycle-lock');
 try{await fs.mkdir(lock,{mode:0o700});}
 catch(error){
  if(error.code!=='EEXIST')throw error;
  if(!recoverStale)throw Error('Lifecycle operation lock exists; reconcile the operator before retrying');
  await trusted(lock,{privateFile:true,type:'directory'});
  const owner=await readJson(join(lock,'owner.json'));
  if(!Number.isInteger(owner.pid)||owner.pid<=1)throw Error('Unknown lifecycle lock owner');
  try{process.kill(owner.pid,0);throw Error('Lifecycle operator is still running');}catch(error){if(error.code!=='ESRCH')throw error;}
  await fs.unlink(join(lock,'owner.json'));await fs.rmdir(lock);await fs.mkdir(lock,{mode:0o700});
 }
 await fs.writeFile(join(lock,'owner.json'),JSON.stringify({pid:process.pid}),{mode:0o600,flag:'wx'});
 try{return await fn();}finally{await fs.unlink(join(lock,'owner.json'));await fs.rmdir(lock);}
}

// The platform adapter owns service identity and private validation. This engine
// owns the durable before/after record and never touches application data paths.
export function createLifecycle(driver,{run=commandRunner}={}){
 run=runner(run);
 return {async execute({command,config,bundle,dryRun=false,lines=100,activate=false}){
  if(!['install','adopt','update','rollback','start','stop','restart','status','logs','uninstall'].includes(command))throw Error('Unknown lifecycle command');
  const ctx=await driver.load(config);ctx.root=canonical(ctx.root);
  if(await exists(ctx.root))await trusted(ctx.root,{type:'directory'});else await trusted(dirname(ctx.root),{type:'directory'});
  const statePath=join(ctx.root,'deployment-state.json'),pendingPath=join(ctx.root,'pending-activation.json');
  let record=await exists(statePath)?await readJson(statePath):null;
  const identity=driver.identity?.(ctx)??null;
  const checkRecord=value=>{if(value&&(value.format!==1||value.platform!==driver.platform||value.root!==ctx.root||JSON.stringify(value.identity)!==JSON.stringify(identity)))throw Error('Installation ownership mismatch');};
  checkRecord(record);
  const pending=await exists(pendingPath)?await readJson(pendingPath):null;
  if(pending){
   if(command!=='rollback')throw Error('Incomplete activation requires rollback from pending-activation.json; no services changed');
   if(pending.format!==1||typeof pending.wasActive!=='boolean')throw Error('Invalid pending activation');
   checkRecord(pending.before);checkRecord(pending.after);
   const targets=[pending.before?.current,pending.after?.current].filter(Boolean);
   for(const target of targets)await verifyTarget(ctx,target);
   const actualRegistrations={};
   for(const path of driver.registrationPaths(ctx)){
    if(!await exists(path))continue;await trusted(path);const text=await fs.readFile(path,'utf8');
    if(!targets.some(target=>target.registrations[path]===text))throw Error('Recovery registration ownership mismatch');actualRegistrations[path]=text;
   }
   let selected;
   if(await exists(join(ctx.root,'current'))){const current=await fs.realpath(join(ctx.root,'current'));selected=targets.find(target=>current===runtimePath(ctx,target));if(!selected)throw Error('Recovery runtime ownership mismatch');}
   const inspected=Object.keys(actualRegistrations).length?{...pending.after,current:{...(selected??targets[0]),registrations:actualRegistrations},acceptedRevisions:targets.map(target=>target.revision),acceptedTargets:targets}:null;
   await driver.inspect(ctx,inspected);
   if(dryRun)return {dryRun:true,command,recovery:true};
   return operationLock(ctx,async()=>{
    let temporary;
    try{
     if(pending.before)temporary=await driver.preflightTarget(ctx,pending.before.current);
     await driver.reload(ctx);await driver.stop(ctx);
     if(pending.before){await writeTarget(ctx,pending.before.current,driver);await driver.reload(ctx);if(pending.wasActive){await driver.start(ctx);await driver.health(ctx,pending.before.current.revision);}await writeAtomic(statePath,JSON.stringify(pending.before));}
     else{await driver.unregister(ctx);for(const path of driver.registrationPaths(ctx))if(await exists(path))await fs.unlink(path);await driver.reload(ctx);await currentLink(ctx.root,null);if(await exists(statePath))await fs.unlink(statePath);}
     await fs.unlink(pendingPath);return {recovered:true,revision:pending.before?.current.revision??null};
    }finally{if(temporary)await fs.unlink(temporary);}
   },{recoverStale:true});
  }
  if(record){
   await verifyTarget(ctx,record.current);
   if(!await exists(join(ctx.root,'current'))||await fs.realpath(join(ctx.root,'current'))!==runtimePath(ctx,record.current))throw Error('Current runtime ownership changed');
  }
  if(!record&&command!=='adopt'&&await exists(join(ctx.root,'current')))throw Error('Existing runtime ownership requires explicit adoption');
  let adopted;
  if(command==='adopt'){
   if(record)throw Error('Installation is already owned');if(!bundle)throw Error('Exact source bundle and digest required');
   const source=readBundle(bundle??{});await tools(ctx,run);await driver.validate(ctx,source.manifest.revision,{initial:true});
   if(!driver.adopt)throw Error('This platform has no supported adoption contract');
   adopted=await driver.adopt(ctx,source);
  }
  const status=await driver.inspect(ctx,adopted?{current:adopted}:record);
  if(command==='status')return {platform:driver.platform,revision:record?.current.revision??null,installed:Boolean(record),services:status.services};
  if(command==='logs'){if(!record)throw Error('Owned installation required');redactLogs('',lines);return {logs:redactLogs(await driver.logs(ctx,lines),lines)};}
  if(!record&&!['install','adopt','uninstall'].includes(command))throw Error('Owned installation required');
  let payload;
  if(['install','update'].includes(command)){
   payload=readBundle(bundle??{});await tools(ctx,run);
   await driver.validate(ctx,payload.manifest.revision,{initial:!record});
   if(record&&command==='install'){
    if(record.current.revision!==payload.manifest.revision||record.current.digest!==payload.digest)throw Error('Use update for a different owned release');
    return {installed:true,unchanged:true,revision:record.current.revision,dryRun};
   }
   if(record?.current.revision===payload.manifest.revision){
    if(record.current.digest!==payload.digest)throw Error('Installed release digest changed');
    if(!dryRun&&activate)return operationLock(ctx,async()=>{
     await driver.start(ctx);await driver.health(ctx,record.current.revision);
     return {installed:true,unchanged:true,revision:record.current.revision};
    });
    return {installed:true,unchanged:true,revision:record.current.revision,dryRun};
   }
  }else if(['start','restart','rollback'].includes(command)){await tools(ctx,run);await driver.validate(ctx,record.current.revision,{initial:false});}
  if(command==='rollback'){if(!record.previous)throw Error('No previous release retained');await verifyTarget(ctx,record.previous);}
  if(dryRun)return {dryRun:true,command,revision:payload?.manifest.revision??record?.current.revision??null};
  if(command==='uninstall'&&!record)return {uninstalled:true,unchanged:true,retainedPrivateState:true};
  await mkdirOwned(ctx.root,driver.rootMode??0o700);
  return operationLock(ctx,async()=>{
   let stagedPrivate,stagedRelease,keepRelease=false;
   try{
   if(adopted){await currentLink(ctx.root,adopted);await writeAtomic(statePath,JSON.stringify({format:1,platform:driver.platform,root:ctx.root,identity,current:adopted,previous:null,retained:[]}));return {adopted:true,revision:adopted.revision};}
   if(command==='start'||command==='restart'){
    if(command==='restart')await driver.stop(ctx);
    try{await driver.start(ctx);await driver.health(ctx,record.current.revision);}catch(error){await driver.stop(ctx);throw error;}
    return {started:true,revision:record.current.revision};
   }
   if(command==='stop'){await driver.stop(ctx);return {stopped:true};}
   if(command==='uninstall'){
    const targets=[record.current,record.previous,...record.retained??[]].filter(Boolean);
    for(const target of targets)await verifyTarget(ctx,target);
    await driver.stop(ctx);await driver.unregister(ctx);
    for(const path of driver.registrationPaths(ctx))await fs.unlink(path);
    await driver.reload(ctx);await currentLink(ctx.root,null);
    for(const path of new Set(targets.map(target=>runtimePath(ctx,target))))await fs.rm(path,{recursive:true});
    await fs.unlink(statePath);return {uninstalled:true,retainedPrivateState:true};
   }
   const originalConfiguration=Object.fromEntries(await Promise.all(driver.configurationPaths(ctx).map(async path=>[path,(await fs.readFile(path)).toString('base64')])));
   let target=record?.previous;
   if(payload){
    const revision=payload.manifest.revision,release=join(ctx.root,'releases',revision);
    await mkdirOwned(join(ctx.root,'releases'),driver.rootMode??0o700);
    await trusted(join(ctx.root,'releases'),{type:'directory'});
    if(await exists(release))throw Error('Release directory already exists; refusing to overwrite retained runtime');
    await fs.mkdir(release,{mode:0o755});stagedRelease=release;
    try{
     for(const [name,bytes] of payload.files){await fs.mkdir(dirname(join(release,name)),{recursive:true,mode:0o755});await fs.writeFile(join(release,name),bytes,{mode:0o644,flag:'wx'});}
     const work=join(ctx.root,`.npm-${randomUUID()}`);await fs.mkdir(work,{mode:0o700});
     try{
      const user=join(work,'user.npmrc'),global=join(work,'global.npmrc');for(const path of [user,global])await fs.writeFile(path,'',{mode:0o600,flag:'wx'});
      for(const module of driver.dependencyModules??['apps/server','apps/mac-agent','packages/voice'])await run(ctx.node,[ctx.npm,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org',`--userconfig=${user}`,`--globalconfig=${global}`],{cwd:join(release,module),timeout:180000,env:{PATH:`${dirname(ctx.node)}:/usr/bin:/bin`,HOME:work,npm_config_cache:join(work,'cache'),npm_config_fetch_retries:'1',npm_config_fetch_timeout:'30000'}});
     }finally{await fs.rm(work,{recursive:true,force:true});}
     await normalizeRuntime(release);
     const configuration=await driver.stageConfiguration(ctx,revision);
     stagedPrivate=configuration.temporary;
     await driver.preflight(ctx,release,configuration.preflightPath??null,revision);
     target={revision,digest:payload.digest,inventory:await inventory(release),configuration:configuration.values,registrations:driver.render(ctx,release)};
    }catch(error){await fs.rm(release,{recursive:true,force:true});throw error;}
   }else{
    // Validate rollback configuration with the target revision before stopping.
    stagedPrivate=await driver.preflightTarget(ctx,target);
   }
   for(const [path,value] of Object.entries(originalConfiguration))if((await fs.readFile(path)).toString('base64')!==value)throw Error('Private configuration changed during staging');
   await driver.inspect(ctx,record);
   const previous=record?{...record.current,configuration:originalConfiguration}:null;
   const retained=[...record?.retained??[],record?.previous].filter(value=>value&&value.revision!==target.revision&&value.revision!==previous?.revision);
   const next={format:1,platform:driver.platform,root:ctx.root,identity,current:target,previous,retained};
   const before=record?{...record,current:previous}:null;
   await writeAtomic(pendingPath,JSON.stringify({format:1,before,after:next,wasActive:status.active}));
   try{
    if(record)await driver.stop(ctx);
    await writeTarget(ctx,target,driver);await driver.reload(ctx);
    if(!record)await driver.register(ctx);
    if(status.active||activate){await driver.start(ctx);await driver.health(ctx,target.revision);}
    await writeAtomic(statePath,JSON.stringify(next));await fs.unlink(pendingPath);
   }catch(error){
    let recovered=false;
    try{
     await driver.stop(ctx);
     if(record){await writeTarget(ctx,previous,driver);await driver.reload(ctx);if(status.active){await driver.start(ctx);await driver.health(ctx,previous.revision);}await writeAtomic(statePath,JSON.stringify(before));}
     else{await driver.unregister(ctx);for(const path of driver.registrationPaths(ctx))if(await exists(path))await fs.unlink(path);await driver.reload(ctx);await currentLink(ctx.root,null);}
     await fs.unlink(pendingPath);recovered=true;
    }catch{}
    throw Error(recovered?'Activation failed; previous runtime and private configuration recovered':'Activation failed; recovery unconfirmed, retain pending-activation.json for operator recovery');
   }
   keepRelease=true;return {installed:true,revision:target.revision,previousRevision:previous?.revision??null};
  }finally{
    if(stagedPrivate)await fs.unlink(stagedPrivate).catch(error=>{if(error.code!=='ENOENT')throw error;});
    if(stagedRelease&&!keepRelease&&!await exists(pendingPath)&&await fs.realpath(join(ctx.root,'current')).catch(()=>null)!==stagedRelease)await fs.rm(stagedRelease,{recursive:true,force:true});
   }
  });
 }};
}

export async function runLifecycleCli(controller,{platform,requireRoot=false}={}){
 try{
  if(process.platform!==platform||requireRoot&&process.getuid()!==0||!requireRoot&&process.getuid()===0)throw Error('Unsupported service operator');
  const [command,...args]=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++){
   const name=args[i];if(!['--config','--bundle','--sha256','--lines','--dry-run'].includes(name)||Object.hasOwn(options,name))throw Error('Unknown or duplicate option');
   options[name]=name==='--dry-run'?true:args[++i];if(options[name]===undefined)throw Error('Missing option value');
  }
  if(!options['--config']||Boolean(options['--bundle'])!==Boolean(options['--sha256']))throw Error('Private config and bundle digest required');
  const bundle=options['--bundle']?{bytes:await fs.readFile(options['--bundle']),sha256:options['--sha256']}:undefined;
  const result=await controller.execute({command,config:options['--config'],bundle,dryRun:options['--dry-run']??false,lines:options['--lines']===undefined?100:Number(options['--lines'])});
  console.log(result.logs??JSON.stringify(result));
 }catch(error){console.error(error.message.startsWith('Command failed:')?error.message:'Lifecycle blocked; check canonical private configuration, ownership, TLS, revision and pending activation records');process.exitCode=1;}
}
export function isMain(url){return process.argv[1]&&resolve(process.argv[1])===fileURLToPath(url);}
