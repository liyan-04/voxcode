import * as fs from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {X509Certificate,randomUUID} from 'node:crypto';
import {request} from 'node:https';
import {setTimeout as delay} from 'node:timers/promises';
import {loadControlConfiguration} from '../../apps/server/control-config.mjs';
import {canonical,createLifecycle,exists,inventory,isMain,readJson,runLifecycleCli,runner,trusted,writeAtomic} from './common.mjs';
import {sha256} from './package.mjs';

export const service='voxcode-control.service';
function legacyPathValue(ctx,value){
 if(!value.startsWith('PATH='))return false;
 const allowed=new Set([dirname(ctx.node),'/usr/sbin','/usr/bin','/sbin','/bin']);
 const entries=value.slice('PATH='.length).split(':');
 return entries.length>0&&entries.every(entry=>allowed.has(entry));
}
async function processIdentity(pid){
 const info=await fs.stat(`/proc/${pid}`);return {uid:info.uid,exe:await fs.realpath(`/proc/${pid}/exe`),args:(await fs.readFile(`/proc/${pid}/cmdline`)).toString().split('\0').filter(Boolean)};
}
export async function trustedHealth(ctx,revision){
 const config=JSON.parse(await fs.readFile(ctx.controlConfig)),ca=await fs.readFile(ctx.caFile);
 let last;
 for(let attempt=0;attempt<20;attempt++){
  try{
   const health=await new Promise((accept,reject)=>{
    const req=request(new URL('/api/health',config.publicOrigin),{ca,rejectUnauthorized:true,timeout:3000},response=>{
     let bytes=0;const parts=[];response.on('data',part=>{bytes+=part.length;if(bytes>65536)req.destroy(Error('Health response too large'));else parts.push(part);});
     response.on('error',reject);response.on('end',()=>{try{if(response.statusCode!==200)throw Error();accept(JSON.parse(Buffer.concat(parts)));}catch{reject(Error('Invalid gateway health'));}});
    });req.on('timeout',()=>req.destroy(Error('Health timeout')));req.on('error',reject);req.end();
   });
   if(health.revision!==revision||health.executionHost!=='mac'||health.simulation!==false)throw Error('Gateway health identity mismatch');return;
  }catch(error){last=error;if(attempt<19)await delay(500);}
 }
 throw Error(`Trusted TLS health failed: ${last?.code??'unavailable'}`);
}

export function createLinuxController({run,unitDirectory='/etc/systemd/system',health=trustedHealth,inspectProcess=processIdentity}={}){
 const execute=runner(run),unit=join(canonical(unitDirectory),service);
 const show=async()=>{
  const {stdout}=await execute('systemctl',['show',service,'--no-pager','--property=LoadState,FragmentPath,DropInPaths,User,MainPID,ActiveState']);
  return Object.fromEntries(stdout.trim().split('\n').map(line=>{const index=line.indexOf('=');return [line.slice(0,index),line.slice(index+1)];}));
 };
 const listeners=async ctx=>(await execute('ss',['-H','-ltnp',`sport = :${ctx.port}`])).stdout.trim();
 async function idle(ctx){const state=await show();if(!['inactive','failed'].includes(state.ActiveState)||state.MainPID!=='0'||await listeners(ctx))throw Error('Owned service has not stopped or listener ownership changed');}
 const driver={
  platform:'linux',rootMode:0o755,dependencyModules:['apps/server','packages/voice'],
  async load(path){
   const ctx=await readJson(path),fields=['format','root','serviceUser','serviceUid','serviceGid','node','npm','controlConfig','caFile'];
   if(!ctx||ctx.format!==1||Object.keys(ctx).some(key=>!fields.includes(key))||!/^voxcode-control$/u.test(ctx.serviceUser??'')||!Number.isInteger(ctx.serviceUid)||ctx.serviceUid<=0||!Number.isInteger(ctx.serviceGid)||ctx.serviceGid<0)throw Error('Dedicated control service identity required');
   for(const name of ['root','node','npm','controlConfig','caFile'])canonical(ctx[name]);
   for(const name of ['root','node','controlConfig'])if(!/^\/[A-Za-z0-9_./-]+$/u.test(ctx[name]))throw Error('Systemd paths must use plain absolute path components');
   if(Number((await execute('id',['-u',ctx.serviceUser])).stdout.trim())!==ctx.serviceUid||Number((await execute('id',['-g',ctx.serviceUser])).stdout.trim())!==ctx.serviceGid)throw Error('Dedicated service account identity mismatch');
   await trusted(unitDirectory,{type:'directory'});
   const config=await readJson(ctx.controlConfig,{owners:[0,process.getuid(),ctx.serviceUid]});
   if(!Number.isInteger(config.port)||config.port<1024||config.port>65535)throw Error('Invalid configured listener port');ctx.port=config.port;ctx.stateDirectory=canonical(config.deviceRoot);
   return ctx;
  },
  identity:ctx=>Object.fromEntries(['root','serviceUser','serviceUid','serviceGid','node','npm','controlConfig','caFile'].map(key=>[key,ctx[key]])),
  registrationPaths:()=>[unit],configurationPaths:ctx=>[ctx.controlConfig],
  async validate(ctx,revision,{initial}){
   const config=await loadControlConfiguration({path:ctx.controlConfig,uid:ctx.serviceUid});
   if(initial&&config.revision!==revision)throw Error('Private configuration and exact source revision disagree');
   for(const path of [ctx.controlConfig,ctx.caFile,config.deviceRoot])if(path===ctx.root||path.startsWith(join(ctx.root,'releases')+'/')||path.startsWith(join(ctx.root,'current')+'/'))throw Error('Private state must be outside runtime releases');
   await trusted(ctx.caFile,{owners:[0,process.getuid(),ctx.serviceUid]});
   const ca=new X509Certificate(await fs.readFile(ctx.caFile)),leaf=new X509Certificate(config.tls.cert);
   if(Date.now()<Date.parse(ca.validFrom)||Date.now()>=Date.parse(ca.validTo)||!leaf.verify(ca.publicKey))throw Error('Strict TLS issuer CA validation failed');
   if(await exists(config.deviceRoot))await trusted(config.deviceRoot,{owners:[0,ctx.serviceUid],privateFile:true,type:'directory'});
   if(!/^\/[A-Za-z0-9_./-]+$/u.test(config.deviceRoot))throw Error('Systemd state directory must use plain absolute path components');
  },
  async inspect(ctx,record){
   const state=await show(),listening=await listeners(ctx),registered=await exists(unit);
   if(!record){if(registered||state.LoadState!=='not-found'||listening)throw Error('Unrelated service or listener ownership; explicit inspected adoption required');}
   else{
    await trusted(unit);const expected=record.current.registrations[unit];
    if(!expected||sha256(await fs.readFile(unit))!==sha256(expected)||state.LoadState!=='loaded'||state.FragmentPath!==unit||state.DropInPaths||state.User!==ctx.serviceUser||!['active','inactive','failed'].includes(state.ActiveState))throw Error('Service registration ownership mismatch');
    const pid=Number(state.MainPID);
    if(state.ActiveState==='active'){
     if(!Number.isSafeInteger(pid)||pid<=1)throw Error('Service process ownership unavailable');
     const identity=await inspectProcess(pid),entries=[...record.acceptedRevisions??[record.current.revision]].map(revision=>join(ctx.root,'releases',revision,'apps/server/control-cli.mjs'));entries.push(join(ctx.root,'current/apps/server/control-cli.mjs'));
     if(identity.uid!==ctx.serviceUid||identity.exe!==ctx.node||identity.args.length!==3||identity.args[0]!==ctx.node||!entries.includes(identity.args[1])||identity.args[2]!=='start')throw Error('Service process ownership mismatch');
     for(const line of listening.split('\n').filter(Boolean)){
      const pids=[...line.matchAll(/pid=(\d+)/gu)].map(match=>Number(match[1]));if(!pids.length||pids.some(value=>value!==pid))throw Error('Listener ownership mismatch');
     }
    }else if(pid!==0||listening)throw Error('Inactive service has an unrelated listener');
   }
   return {active:state.ActiveState==='active',services:[{name:service,state:record?state.ActiveState:'not-installed'}]};
  },
  async adopt(ctx,source){
   const manifest=await readJson(join(ctx.root,'deployment.json'));
   if(manifest.format!=='voxcode-control-bootstrap-v1'||manifest.state!=='started'||manifest.service!==service||manifest.serviceUser!==ctx.serviceUser||manifest.revision!==source.manifest.revision)throw Error('Audited bootstrap ownership manifest required for adoption');
   const release=join(ctx.root,'releases',manifest.revision);
   if(await fs.realpath(join(ctx.root,'current'))!==release)throw Error('Adoption source identity mismatch');
   for(const [name,bytes] of source.files){if(name.startsWith('apps/mac-agent/'))continue;await trusted(join(release,name));if(sha256(await fs.readFile(join(release,name)))!==sha256(bytes))throw Error('Adoption source checksum mismatch');}
   await trusted(unit);const text=await fs.readFile(unit,'utf8');
   const allowed={Unit:['Description','After','Wants'],Service:['Type','User','Group','WorkingDirectory','Environment','ExecStart','Restart','RestartSec','TimeoutStopSec','KillMode','UMask','NoNewPrivileges','PrivateTmp','ProtectSystem','ProtectHome','ReadWritePaths','ReadOnlyPaths','RestrictAddressFamilies','CapabilityBoundingSet'],Install:['WantedBy']};
   let section;const values={};
   for(const raw of text.split('\n')){
    const line=raw.trim();if(!line||line.startsWith('#'))continue;
    if(/^\[[A-Za-z]+\]$/u.test(line)){section=line.slice(1,-1);if(!allowed[section])throw Error('Unexpected adoption unit section');continue;}
    const index=line.indexOf('='),key=line.slice(0,index),value=line.slice(index+1);
    if(index<1||!allowed[section]?.includes(key)||/[\\%$]/u.test(value)||values[key]&&key!=='Environment')throw Error('Unreviewed service directive blocks adoption');
    (values[key]??=[]).push(value);
   }
   const one=key=>values[key]?.length===1?values[key][0]:null;
   const environments=values.Environment??[];
   const identityValid=one('User')===ctx.serviceUser&&[ctx.serviceUser,String(ctx.serviceGid)].includes(one('Group'))&&one('WorkingDirectory')===join(ctx.root,'current')&&[`${ctx.node} ${release}/apps/server/control-cli.mjs start`,`${ctx.node} ${ctx.root}/current/apps/server/control-cli.mjs start`].includes(one('ExecStart'));
   const environmentValid=environments.includes(`VOXCODE_CONTROL_CONFIG=${ctx.controlConfig}`)&&environments.every(value=>[`VOXCODE_CONTROL_CONFIG=${ctx.controlConfig}`,'HOME=/var/lib/voxcode-control'].includes(value)||legacyPathValue(ctx,value));
   const capabilityValid=values.CapabilityBoundingSet===undefined||one('CapabilityBoundingSet')==='';
   if(!identityValid||!environmentValid||!capabilityValid)throw Error('Adoption service identity mismatch');
   for(const value of [...values.ReadWritePaths??[],...values.ReadOnlyPaths??[]])for(const part of value.match(/"[^"]+"|\S+/gu)??[]){const path=part.replace(/^"|"$/gu,'');if(![ctx.stateDirectory,dirname(ctx.controlConfig),'/var/lib/voxcode-control'].includes(path))throw Error('Unreviewed writable/readable unit path blocks adoption');}
   for(const module of driver.dependencyModules){
    const lock=JSON.parse(await fs.readFile(join(release,module,'package-lock.json')));
    for(const [name,entry] of Object.entries(lock.packages))if(name){
     const directory=join(release,module,name);await trusted(directory,{type:'directory'});await trusted(join(directory,'package.json'));
     if(JSON.parse(await fs.readFile(join(directory,'package.json'))).version!==entry.version)throw Error('Installed dependency closure differs from lock');
    }
   }
   const configuration={[ctx.controlConfig]:(await fs.readFile(ctx.controlConfig)).toString('base64')};
   return {revision:manifest.revision,digest:source.digest,inventory:await inventory(release),configuration,registrations:{[unit]:text}};
  },
  render(ctx){return {[unit]:`[Unit]\nDescription=VoxCode phone and Linx gateway for Mac Codex\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser=${ctx.serviceUser}\nGroup=${ctx.serviceGid}\nWorkingDirectory=${ctx.root}/current\nEnvironment=VOXCODE_CONTROL_CONFIG=${ctx.controlConfig}\nExecStart=${ctx.node} ${ctx.root}/current/apps/server/control-cli.mjs start\nRestart=on-failure\nRestartSec=3\nTimeoutStopSec=20\nKillMode=control-group\nUMask=0077\nNoNewPrivileges=yes\nPrivateTmp=yes\nProtectSystem=strict\nProtectHome=yes\nReadWritePaths=${JSON.stringify(ctx.stateDirectory)}\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\n\n[Install]\nWantedBy=multi-user.target\n`};},
  async stageConfiguration(ctx,revision){
   const config=JSON.parse(await fs.readFile(ctx.controlConfig));config.revision=revision;ctx.stateDirectory=config.deviceRoot;
   const bytes=Buffer.from(JSON.stringify(config)+'\n'),temporary=join(dirname(ctx.controlConfig),`.control-stage-${randomUUID()}.json`);
   await writeAtomic(temporary,bytes,{uid:ctx.serviceUid,gid:ctx.serviceGid});
   try{await loadControlConfiguration({path:temporary,uid:ctx.serviceUid});}catch(error){await fs.unlink(temporary);throw error;}
   return {values:{[ctx.controlConfig]:bytes.toString('base64')},temporary,preflightPath:temporary};
  },
  async preflight(ctx,release,configPath,revision){
   const symlink=join(ctx.root,`.entry-check-${randomUUID()}`);await fs.symlink(release,symlink);
   try{
    const result=await execute('runuser',['-u',ctx.serviceUser,'--','env','-i',`PATH=${dirname(ctx.node)}:/usr/bin:/bin`,`VOXCODE_CONTROL_CONFIG=${configPath}`,ctx.node,join(symlink,'apps/server/control-cli.mjs'),'preflight']);
    let parsed;try{parsed=JSON.parse(result.stdout);}catch{throw Error('Release preflight did not execute');}
    if(parsed.ok!==true||parsed.executionHost!=='mac'||parsed.revision!==revision)throw Error('Release preflight identity mismatch');
   }finally{await fs.unlink(symlink);}
  },
  async preflightTarget(ctx,target){
   const bytes=Buffer.from(target.configuration[ctx.controlConfig]??'','base64'),temporary=join(dirname(ctx.controlConfig),`.control-rollback-${randomUUID()}.json`);
   await writeAtomic(temporary,bytes,{uid:ctx.serviceUid,gid:ctx.serviceGid});
   try{await loadControlConfiguration({path:temporary,uid:ctx.serviceUid});await driver.preflight(ctx,join(ctx.root,'releases',target.revision),temporary,target.revision);return temporary;}
   catch(error){await fs.unlink(temporary);throw error;}
  },
  async reload(){await execute('systemctl',['daemon-reload']);},
  async register(){await execute('systemctl',['enable',service]);},
  async unregister(){await execute('systemctl',['disable',service]);},
  async start(){await execute('systemctl',['start',service]);},
  async stop(ctx){const state=await show();if(state.LoadState==='not-found'&&!await exists(unit)){if(await listeners(ctx))throw Error('Unrelated listener ownership');return;}await execute('systemctl',['stop',service]);await idle(ctx);},
  async logs(ctx,lines){return (await execute('journalctl',['--unit',service,'--lines',String(lines),'--no-pager','--output=cat'])).stdout;},
  health,
 };
 return createLifecycle(driver,{run});
}
if(isMain(import.meta.url))await runLifecycleCli(createLinuxController(),{platform:'linux',requireRoot:true});
