import * as fs from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {X509Certificate} from 'node:crypto';
import {request} from 'node:https';
import {setTimeout as delay} from 'node:timers/promises';
import {readTaskConfiguration} from '../../apps/server/task-cli.mjs';
import {readPrivateJson} from '../../apps/mac-agent/private-files.mjs';
import {createTaskRpcClient} from '../../apps/server/task-rpc.mjs';
import {validId} from '../../packages/control-protocol/index.mjs';
import {canonical,commandRunner,createLifecycle,exists,inventory,isMain,readJson,runLifecycleCli,runner,runtimePath,trusted} from './common.mjs';
import {sha256} from './package.mjs';

export const labels=Object.freeze(['io.voxcode.control-task','io.voxcode.control-agent']);
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
function plistXml(value){
 const serialize=item=>typeof item==='string'?`<string>${escape(item)}</string>`:typeof item==='boolean'?`<${item?'true':'false'}/>`:typeof item==='number'?`<integer>${item}</integer>`:Array.isArray(item)?`<array>${item.map(serialize).join('')}</array>`:`<dict>${Object.entries(item).map(([key,entry])=>`<key>${escape(key)}</key>${serialize(entry)}`).join('')}</dict>`;
 return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${serialize(value)}</plist>\n`;
}
function environment(ctx,agent=false){
 const common={HOME:ctx.home,PATH:`${dirname(ctx.node)}:/usr/bin:/bin:/usr/sbin:/sbin`,LANG:'en_US.UTF-8'};
 return agent?{...common,NODE_EXTRA_CA_CERTS:ctx.caFile}:{...common,VOXCODE_PROJECTS_FILE:ctx.projectsFile,VOXCODE_TASK_DATA:ctx.taskData,VOXCODE_TASK_SOCKET:ctx.taskSocket,VOXCODE_CODEX_COMMAND:ctx.codexCommand,CODEX_HOME:ctx.codexHome};
}
async function boundedTail(path){
 if(!await exists(path))return '';await trusted(path,{privateFile:true});const handle=await fs.open(path,'r');
 try{const {size}=await handle.stat(),bytes=Buffer.alloc(Math.min(size,65536));await handle.read(bytes,0,bytes.length,Math.max(0,size-bytes.length));return bytes.toString();}finally{await handle.close();}
}
async function taskAvailable(ctx){return createTaskRpcClient({socketPath:ctx.taskSocket,timeoutMs:2000}).status();}
export function createMacController({run=commandRunner,launchDirectory=join(homedir(),'Library/LaunchAgents'),gatewayHealth,taskReady=taskAvailable,inspectProcess,processAlive}={}){
 const execute=runner(run),domain=`gui/${process.getuid()}`;
 gatewayHealth??=async ctx=>{
  const agent=await readPrivateJson(ctx.agentConfig),url=new URL(agent.endpoint);url.protocol='https:';url.pathname='/api/health';const ca=await fs.readFile(ctx.caFile);
  await new Promise((accept,reject)=>{
   const req=request(url,{ca,rejectUnauthorized:true,timeout:5000},response=>{
    const parts=[];let size=0;response.on('data',part=>{size+=part.length;if(size>65536)req.destroy(Error('Gateway response too large'));else parts.push(part);});response.on('error',reject);
    response.on('end',()=>{try{const health=JSON.parse(Buffer.concat(parts));if(response.statusCode!==200||health.executionHost!=='mac'||health.simulation!==false)throw Error();accept();}catch{reject(Error('Verified gateway health identity unavailable'));}});
   });req.on('timeout',()=>req.destroy(Error('Gateway TLS timeout')));req.on('error',reject);req.end();
  });
 };
 inspectProcess??=async pid=>{
  const result=await execute('/bin/ps',['-ww','-p',String(pid),'-o','uid=','-o','command=']),match=/^\s*(\d+)\s+(.+)$/u.exec(result.stdout.trim());
  if(!match)throw Error('Process identity unavailable');return {uid:Number(match[1]),command:match[2]};
 };
 processAlive??=async pid=>{
  try{await run('/bin/ps',['-p',String(pid),'-o','pid='],{timeout:5000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin'}});return true;}catch(error){if(error.code===1)return false;throw Error('Process exit could not be verified');}
 };
 const plistPaths=()=>labels.map(label=>join(launchDirectory,label+'.plist'));
 async function parsedPlist(path){return JSON.parse((await execute('/usr/bin/plutil',['-convert','json','-o','-',path])).stdout);}
 function nodePosition(args,ctx){const exact=args?.indexOf(ctx.node);return exact>=2?exact:args?.findIndex((value,index)=>index>=2&&value.startsWith('/')&&!value.includes('='));}
 async function legacyNodeIdentity(ctx,argument){
  canonical(argument);const actual=await fs.realpath(argument),info=await fs.lstat(actual),alias=await fs.lstat(argument);
  if(!info.isFile()||info.nlink!==1||![0,process.getuid()].includes(info.uid)||![0,process.getuid()].includes(alias.uid)||info.mode&0o022||info.size>512*1024*1024)throw Error('Untrusted legacy Node alias');
  const digest=sha256(await fs.readFile(actual));if(digest!==sha256(await fs.readFile(ctx.node)))throw Error('Legacy Node must match the frozen toolchain bytes');
  return {argument,canonical:actual,sha256:digest};
 }
 async function job(label){
  let output;
  try{output=(await run('/bin/launchctl',['print',`${domain}/${label}`],{timeout:10000,maxBuffer:256*1024,env:{PATH:'/usr/bin:/bin'}})).stdout;}
  catch(error){if(error.code===113)return null;throw Error('Launchd ownership query failed');}
  const field=name=>{const value=new RegExp(`^\\s*${name} = (.+)$`,'mu').exec(output)?.[1]?.trim();return value?.startsWith('"')?JSON.parse(value):value;};
  const block=/^\s*arguments = \{\r?\n([\s\S]*?)^\s*\}/mu.exec(output),args=block?.[1].split(/\r?\n/u).map(line=>line.trim().replace(/^\d+ = /u,'')).filter(Boolean);
  if(!field('path')||field('type')!=='LaunchAgent'||field('program')!=='/usr/bin/env'||!args)throw Error('Unsupported launchd ownership output');
  return {path:field('path'),state:field('state'),pid:Number(field('pid')??0),args};
 }
 async function verifyJob(ctx,label,value,parsed){
  if(!value)return;
  if(value.path!==join(launchDirectory,label+'.plist')||JSON.stringify(value.args)!==JSON.stringify(parsed.ProgramArguments))throw Error('Loaded launchd job ownership mismatch');
  if(value.pid){
   const identity=await inspectProcess(value.pid),index=nodePosition(parsed.ProgramArguments,ctx);
   if(parsed.ProgramArguments[index]!==ctx.node){
    if(!ctx.legacyNode||parsed.ProgramArguments[index]!==ctx.legacyNode.argument||JSON.stringify(await legacyNodeIdentity(ctx,ctx.legacyNode.argument))!==JSON.stringify(ctx.legacyNode))throw Error('Legacy Node process ownership mismatch');
   }
   if(index<2||identity.uid!==process.getuid()||identity.command!==parsed.ProgramArguments.slice(index).join(' '))throw Error('Launchd process ownership mismatch');
  }
 }
 async function waitFor(check,message){
  for(let attempt=0;attempt<40;attempt++){if(await check())return;if(attempt<39)await delay(250);}throw Error(message);
 }
 const driver={
  platform:'darwin',rootMode:0o700,
  async load(path){
   const ctx=await readJson(path),fields=['format','root','home','node','npm','agentConfig','projectsFile','taskData','taskSocket','codexCommand','codexHome','caFile','legacyManifestSha256','legacyAgentPatchSha256'];
   if(!ctx||ctx.format!==1||Object.keys(ctx).some(key=>!fields.includes(key)))throw Error('Invalid Mac lifecycle configuration');
   for(const name of fields.filter(name=>!['format','legacyManifestSha256','legacyAgentPatchSha256'].includes(name)))canonical(ctx[name]);
   for(const name of ['legacyManifestSha256','legacyAgentPatchSha256'])if(ctx[name]!==undefined&&!/^[a-f0-9]{64}$/u.test(ctx[name]))throw Error('Reviewed legacy manifest digest required');
   for(const directory of [launchDirectory,ctx.home])if((await trusted(directory,{type:'directory'})).uid!==process.getuid())throw Error('Current Mac account must own launch and home directories');
   if(await exists(ctx.root))if((await trusted(ctx.root,{privateFile:true,type:'directory'})).uid!==process.getuid())throw Error('Current Mac account must own runtime root');
   ctx.serviceUid=process.getuid();ctx.serviceGid=process.getgid();return ctx;
  },
  identity:ctx=>Object.fromEntries(['root','home','node','npm','agentConfig','projectsFile','taskData','taskSocket','codexCommand','codexHome','caFile','legacyManifestSha256','legacyAgentPatchSha256'].filter(key=>ctx[key]!==undefined).map(key=>[key,ctx[key]])),
  registrationPaths:plistPaths,configurationPaths:()=>[],
  async validate(ctx){
   await readTaskConfiguration({env:environment(ctx),uid:process.getuid()});
   await trusted(ctx.codexHome,{privateFile:true,type:'directory'});await trusted(dirname(ctx.taskSocket),{privateFile:true,type:'directory'});
   if(Buffer.byteLength(ctx.taskSocket)>100)throw Error('Task socket path exceeds the native Unix socket limit');
   if(await exists(ctx.taskData))await trusted(ctx.taskData,{privateFile:true,type:'directory'});else await trusted(dirname(ctx.taskData),{privateFile:true,type:'directory'});
   const agent=await readPrivateJson(ctx.agentConfig),url=new URL(agent.endpoint);
   if(Object.keys(agent).some(key=>!['endpoint','deviceId','stateFile','keychainService','keychainAccount'].includes(key))||url.protocol!=='wss:'||url.pathname!=='/agent'||url.search||url.hash||url.username||url.password||!validId(agent.deviceId)||![agent.keychainService,agent.keychainAccount].every(value=>/^[A-Za-z0-9._-]{1,128}$/u.test(value??'')))throw Error('Private paired Agent WSS configuration required');
   canonical(agent.stateFile);await trusted(dirname(agent.stateFile),{privateFile:true,type:'directory'});if(await exists(agent.stateFile))await readPrivateJson(agent.stateFile);
   for(const path of [ctx.agentConfig,ctx.projectsFile,ctx.taskData,ctx.taskSocket,ctx.codexHome,ctx.caFile,agent.stateFile])if(path.startsWith(join(ctx.root,'releases')+'/')||path.startsWith(join(ctx.root,'runtime')+'/')||path.startsWith(join(ctx.root,'current')+'/'))throw Error('Private Mac state must remain outside runtime directories');
   await trusted(ctx.caFile);const ca=new X509Certificate(await fs.readFile(ctx.caFile));if(!ca.ca||Date.now()<Date.parse(ca.validFrom)||Date.now()>=Date.parse(ca.validTo))throw Error('Valid reviewed gateway issuer CA required');
   await execute('/usr/bin/security',['find-generic-password','-s',agent.keychainService,'-a',agent.keychainAccount],{timeout:10000,maxBuffer:16384,env:{HOME:ctx.home,PATH:'/usr/bin:/bin'}});
   await gatewayHealth(ctx);
  },
  async inspect(ctx,record){
   ctx.legacyNode=record?.current.legacyNode??record?.acceptedTargets?.find(target=>target.legacyNode)?.legacyNode;
   const services=[];
   for(const [index,label] of labels.entries()){
    const path=plistPaths()[index],value=await job(label),registered=await exists(path);
    if(!record){if(value||registered)throw Error('Unrelated launchd label or plist ownership');services.push({name:label,state:'not-installed'});continue;}
    await trusted(path);if(!record.current.registrations[path]||sha256(await fs.readFile(path))!==sha256(record.current.registrations[path]))throw Error('LaunchAgent registration ownership mismatch');
    const parsed=await parsedPlist(path);await verifyJob(ctx,label,value,parsed);
    services.push({name:label,state:value?(value.pid?'running':'loaded'):'stopped',source:record.current.sourceClass??'committed',baseRevision:record.current.revision,patchRevisions:record.current.legacyPatches?.map(value=>value.revision)??[]});
   }
   if(!services.some(value=>value.name===labels[0]&&value.state==='running')&&await exists(ctx.taskSocket))throw Error('Task socket ownership is unconfirmed; reconcile without removing it');
   return {active:services.some(value=>value.state==='running'||value.state==='loaded'),services};
  },
  render(ctx,release){
   return Object.fromEntries(labels.map((label,index)=>{
    const args=index===0?[join(release,'apps/server/task-cli.mjs'),'start']:[join(release,'apps/mac-agent/cli.mjs'),'--config',ctx.agentConfig,'--task-socket',ctx.taskSocket];
    const env=environment(ctx,index===1),stem=index===0?'task':'agent';
    return [plistPaths()[index],plistXml({Label:label,ProgramArguments:['/usr/bin/env','-i',...Object.entries(env).map(([key,value])=>`${key}=${value}`),ctx.node,...args],WorkingDirectory:ctx.root,RunAtLoad:true,KeepAlive:true,ThrottleInterval:30,ProcessType:'Background',Umask:63,StandardOutPath:join(ctx.root,'logs',stem+'.out.log'),StandardErrorPath:join(ctx.root,'logs',stem+'.err.log')})];
   }));
  },
  async stageConfiguration(ctx){const logs=join(ctx.root,'logs');if(!await exists(logs))await fs.mkdir(logs,{mode:0o700});await trusted(logs,{privateFile:true,type:'directory'});return {values:{}};},
  async preflight(ctx,release){
   const taskCode='const {readTaskConfiguration}=await import(process.argv[1]);await readTaskConfiguration();process.stdout.write(JSON.stringify({ok:true}));';
   const agentCode='await import(process.argv[1]);process.stdout.write(JSON.stringify({ok:true}));';
   for(const [code,path,env] of [[taskCode,'apps/server/task-cli.mjs',environment(ctx)],[agentCode,'apps/mac-agent/cli.mjs',environment(ctx,true)]]){
    const result=await execute(ctx.node,['--input-type=module','-e',code,pathToFileURL(join(release,path)).href],{env});let parsed;try{parsed=JSON.parse(result.stdout);}catch{throw Error('Mac release preflight did not execute');}if(parsed.ok!==true)throw Error('Mac release preflight failed');
   }
  },
  async preflightTarget(ctx,target){await driver.preflight(ctx,runtimePath(ctx,target));if(target.legacyNode){target.registrations=driver.render(ctx,runtimePath(ctx,target));delete target.legacyNode;}},
  async reload(ctx){for(const path of plistPaths())if(await exists(path))await execute('/usr/bin/plutil',['-lint',path]);},
  async register(){},async unregister(){},
  async start(ctx){
   if(!await job(labels[0])&&await exists(ctx.taskSocket))throw Error('Task socket already exists; reconcile its owner before startup');
   for(const [index,label] of labels.entries()){
    const path=plistPaths()[index],parsed=await parsedPlist(path);let value=await job(label);await verifyJob(ctx,label,value,parsed);
    if(!value){
     if(!parsed.ProgramArguments.includes(ctx.node))throw Error('Stopped legacy Node alias requires an update to the frozen toolchain');
     for(let attempt=0;;attempt++){
      try{await run('/bin/launchctl',['bootstrap',domain,path],{timeout:10000,maxBuffer:16384,env:{PATH:'/usr/bin:/bin'}});break;}
      catch(error){
       if(Number(error.code)!==5||!/^Bootstrap failed: 5: Input\/output error(?:\r?\n|$)/u.test(error.stderr??'')||attempt>=3)throw Error('Launchd bootstrap failed');
       value=await job(label);await verifyJob(ctx,label,value,parsed);if(value)break;
       await delay(250);
      }
     }
     value=await job(label);await verifyJob(ctx,label,value,parsed);
    }
    if(index===0)await waitFor(async()=>{try{await taskReady(ctx);return true;}catch{return false;}},'Task RPC did not become ready');
   }
  },
  async stop(ctx){
   // Refuse before unloading the Agent: shutdown must not silently cancel Codex.
   if(await job(labels[0])){
    const status=await taskReady(ctx);
    if(!status||!Number.isInteger(status.activeTasks)||status.activeTasks!==0||status.quarantined!==false)throw Error('Active tasks or unknown task state require reconciliation before stopping');
   }
   for(const label of [...labels].reverse()){
    const value=await job(label);if(!value)continue;const parsed=await parsedPlist(join(launchDirectory,label+'.plist'));await verifyJob(ctx,label,value,parsed);
    await execute('/bin/launchctl',['bootout',`${domain}/${label}`]);
    await waitFor(async()=>!await job(label)&&(!value.pid||!await processAlive(value.pid)),'Launchd process shutdown is unconfirmed');
   }
   if(await exists(ctx.taskSocket))throw Error('Task socket remains after shutdown; ownership reconciliation required');
  },
  async health(ctx){
   await taskReady(ctx);for(const label of labels){const value=await job(label);if(!value?.pid)throw Error('Mac service did not start');await verifyJob(ctx,label,value,await parsedPlist(join(launchDirectory,label+'.plist')));}
  },
  async logs(ctx){const text=[];for(const name of ['task.out.log','task.err.log','agent.out.log','agent.err.log']){const tail=await boundedTail(join(ctx.root,'logs',name));if(tail)text.push(tail);}return text.join('\n');},
  async adopt(ctx,source){
   const path=join(ctx.root,'private/install-manifest.json');await trusted(path,{privateFile:true});const bytes=await fs.readFile(path);
   if(!ctx.legacyManifestSha256||sha256(bytes)!==ctx.legacyManifestSha256)throw Error('Explicit reviewed legacy manifest digest required');
   const manifest=JSON.parse(bytes),release=join(ctx.root,'runtime');
   if(!/^[a-f0-9]{40}$/u.test(manifest.revision??'')||!Array.isArray(manifest.runtime)||JSON.stringify(manifest.labels)!==JSON.stringify(labels)||JSON.stringify(manifest.plistPaths)!==JSON.stringify(plistPaths()))throw Error('Audited legacy Mac installation identity required');
   const baseline=new Map(manifest.runtime.map(entry=>[entry.path,entry.sha256])),patches=[];
   if(baseline.size!==manifest.runtime.length)throw Error('Duplicate legacy source manifest entries');
   for(const [name,expected] of baseline){
    if(typeof name!=='string'||!['apps/server/','apps/mac-agent/','packages/control-protocol/','packages/voice/'].some(prefix=>name.startsWith(prefix))||name.split('/').some(part=>!part||part==='.'||part==='..')||!/^[a-f0-9]{64}$/u.test(expected))throw Error('Invalid audited legacy source path');
    const file=join(release,name);await trusted(file);const actual=sha256(await fs.readFile(file));if(actual===expected)continue;
    if(name!=='apps/mac-agent/agent.mjs'||!ctx.legacyAgentPatchSha256)throw Error('Legacy source checksum mismatch');
    const candidates=(await fs.readdir(join(ctx.root,'private'))).filter(name=>/^agent-reconnect-install-[A-Za-z0-9-]+\.json$/u.test(name));let matched;
    for(const candidate of candidates){const reportPath=join(ctx.root,'private',candidate);await trusted(reportPath,{privateFile:true});const reportBytes=await fs.readFile(reportPath);if(sha256(reportBytes)!==ctx.legacyAgentPatchSha256)continue;const report=JSON.parse(reportBytes);if(report.scope==='agent-reconnect-only'&&report.previousSha256===expected&&report.sha256===actual&&/^[a-f0-9]{40}$/u.test(report.revision??''))matched=report;}
    if(!matched)throw Error('Reviewed legacy Agent patch record required');patches.push({revision:matched.revision,sha256:actual});
   }
   for(const name of ['apps/server/task-cli.mjs','apps/mac-agent/cli.mjs','apps/mac-agent/agent.mjs','apps/mac-agent/package-lock.json','packages/control-protocol/index.mjs'])if(!baseline.has(name))throw Error('Incomplete legacy execution source manifest');
   const frozen=await inventory(release);
   for(const name of Object.keys(frozen))if(!name.split('/').includes('node_modules')&&!baseline.has(name))throw Error('Unrecorded legacy source is outside the reviewed manifest');
   const lock=JSON.parse(await fs.readFile(join(release,'apps/mac-agent/package-lock.json')));
   for(const [name,entry] of Object.entries(lock.packages))if(name){const path=join(release,'apps/mac-agent',name,'package.json');await trusted(path);if(JSON.parse(await fs.readFile(path)).version!==entry.version)throw Error('Legacy Agent dependency closure differs from its lock');}
   const registrations={};let legacyNode;
   for(const [index,label] of labels.entries()){
    const file=plistPaths()[index];await trusted(file);const parsed=await parsedPlist(file);
    const args=parsed.ProgramArguments,indexNode=nodePosition(args,ctx),entry=index===0?'apps/server/task-cli.mjs':'apps/mac-agent/cli.mjs';
    if(indexNode>=2&&args[indexNode]!==ctx.node){const identity=await legacyNodeIdentity(ctx,args[indexNode]);if(legacyNode&&JSON.stringify(legacyNode)!==JSON.stringify(identity))throw Error('Legacy Node aliases differ across services');legacyNode=identity;}
    if(parsed.Label!==label||args?.[0]!=='/usr/bin/env'||args[1]!=='-i'||indexNode<2||args[indexNode+1]!==join(release,entry)||parsed.WorkingDirectory!==ctx.root||parsed.StandardOutPath!==join(ctx.root,'logs',index===0?'task.out.log':'agent.out.log')||parsed.StandardErrorPath!==join(ctx.root,'logs',index===0?'task.err.log':'agent.err.log')||Object.keys(parsed).some(key=>!['Label','ProgramArguments','WorkingDirectory','RunAtLoad','KeepAlive','ThrottleInterval','ProcessType','Umask','StandardOutPath','StandardErrorPath'].includes(key)))throw Error('Legacy plist identity mismatch');
    const expectedArgs=index===0?[join(release,entry),'start']:[join(release,entry),'--config',ctx.agentConfig,'--task-socket',ctx.taskSocket];
    if(JSON.stringify(args.slice(indexNode+1))!==JSON.stringify(expectedArgs))throw Error('Legacy service arguments mismatch');
    const expectedEnvironment=environment(ctx,index===1),actualEnvironment=Object.fromEntries(args.slice(2,indexNode).map(value=>{const at=value.indexOf('=');return [value.slice(0,at),value.slice(at+1)];}));
    if(Object.keys(actualEnvironment).some(key=>!Object.hasOwn(expectedEnvironment,key))||Object.entries(expectedEnvironment).some(([key,value])=>key!=='PATH'&&actualEnvironment[key]!==value)||!/^[A-Za-z0-9_./:-]+$/u.test(actualEnvironment.PATH??''))throw Error('Legacy service environment mismatch');
    registrations[file]=await fs.readFile(file,'utf8');
   }
   await driver.preflight(ctx,release);
   return {revision:manifest.revision,digest:sha256(Buffer.concat([bytes,Buffer.from(ctx.legacyAgentPatchSha256??'')])),runtimeDirectory:release,sourceClass:'audited-legacy-snapshot',legacyPatches:patches,...legacyNode?{legacyNode}:{},inventory:frozen,configuration:{},registrations,validatedUpdateBundle:source.manifest.revision};
  },
 };
 return createLifecycle(driver,{run});
}
if(isMain(import.meta.url))await runLifecycleCli(createMacController(),{platform:'darwin'});
