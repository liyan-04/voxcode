import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createBundle,sha256} from '../control/package.mjs';
import {createLinuxController} from '../control/linux.mjs';

const checkout=fileURLToPath(new URL('../../',import.meta.url));
const revision=execFileSync('git',['-C',checkout,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
let archive;
async function fixture(t){
 const base=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'control-linux-')));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const privateDir=join(base,'private'),unitDirectory=join(base,'units');await fs.mkdir(privateDir,{mode:0o700});await fs.mkdir(unitDirectory);
 const key=join(privateDir,'key.pem'),cert=join(privateDir,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=Fixture','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
 await fs.chmod(key,0o600);await fs.writeFile(join(privateDir,'login'),'fixture-login-secret',{mode:0o600});
 const control={host:'127.0.0.1',port:9899,publicOrigin:'https://127.0.0.1:9899',revision,deviceId:'mac',userId:'owner',deviceRoot:join(privateDir,'state'),tlsKeyFile:key,tlsCertFile:cert,loginSecretFile:join(privateDir,'login')};
 const controlConfig=join(privateDir,'control.json');await fs.writeFile(controlConfig,JSON.stringify(control),{mode:0o600});
 const tools=join(base,'tools');await fs.mkdir(tools);for(const name of ['node','npm-cli.js'])await fs.writeFile(join(tools,name),'fixture tool',{mode:0o755});
 const config={format:1,root:join(base,'runtime'),serviceUser:'voxcode-control',serviceUid:process.getuid(),serviceGid:process.getgid(),node:join(tools,'node'),npm:join(tools,'npm-cli.js'),controlConfig,caFile:cert};
 const path=join(privateDir,'deployment.json');await fs.writeFile(path,JSON.stringify(config),{mode:0o600});
 const calls=[];let active=false,foreign=false,healthFails=false,stopFails=false,invalidStage=false;
 const run=async(command,args,options={})=>{
  calls.push({command,args,options});
  if(args[0]==='--version')return {stdout:'v22.23.4\n'};
  if(command==='id')return {stdout:String(args[0]==='-u'?config.serviceUid:config.serviceGid)+'\n'};
  if(args.includes('ci')){
   const lock=JSON.parse(await fs.readFile(join(options.cwd,'package-lock.json')));
   for(const [name,entry] of Object.entries(lock.packages))if(name){const directory=join(options.cwd,name);await fs.mkdir(directory,{recursive:true});await fs.writeFile(join(directory,'package.json'),JSON.stringify({version:entry.version}));}
   if(invalidStage)await fs.writeFile(controlConfig,JSON.stringify({...control,unexpected:true}));
  }
  if(command==='systemctl'){
   if(args[0]==='show'){
    const exists=await fs.stat(join(unitDirectory,'voxcode-control.service')).then(()=>true,()=>false);
    return {stdout:`LoadState=${foreign?'loaded':exists?'loaded':'not-found'}\nFragmentPath=${exists?join(unitDirectory,'voxcode-control.service'):''}\nDropInPaths=\nUser=voxcode-control\nMainPID=${active?321:0}\nActiveState=${active?'active':'inactive'}\n`};
   }
   if(args[0]==='start')active=true;
   if(args[0]==='stop'){if(stopFails)throw Error('synthetic stop failure');active=false;}
  }
  if(command==='ss')return {stdout:foreign?'LISTEN 0 10 127.0.0.1:9899 *:* users:(("unrelated",pid=900,fd=3))\n':active?'LISTEN 0 10 127.0.0.1:9899 *:* users:(("node",pid=321,fd=3))\n':''};
  if(command==='runuser'){
   const configPath=args.find(arg=>arg.startsWith('VOXCODE_CONTROL_CONFIG=')).slice('VOXCODE_CONTROL_CONFIG='.length);
   const value=JSON.parse(await fs.readFile(configPath));return {stdout:JSON.stringify({ok:true,executionHost:'mac',revision:value.revision,mcpConfigured:false})};
  }
  if(command==='journalctl')return {stdout:Array.from({length:50},(_,i)=>`line ${i} token=private-value`).join('\n')};
  return {stdout:''};
 };
 archive??=await createBundle({root:checkout,revision});
 const controller=createLinuxController({run,unitDirectory,health:async()=>{if(healthFails)throw Error('fixture health failure');},inspectProcess:async()=>({uid:config.serviceUid,exe:config.node,args:[config.node,join(await fs.realpath(join(config.root,'current')),'apps/server/control-cli.mjs'),'start']})});
 const execute=(command,extra={})=>controller.execute({command,config:path,...extra});
 return {base,config,path,controlConfig,control,calls,execute,controller,bundle:{bytes:archive,sha256:sha256(archive)},setForeign:value=>foreign=value,setHealthFails:value=>healthFails=value,setStopFails:value=>stopFails=value,setInvalidStage:value=>invalidStage=value};
}

test('Linux staging removes its private temporary configuration when self-validation fails',async t=>{
 const f=await fixture(t);f.setInvalidStage(true);await assert.rejects(f.execute('install',{bundle:f.bundle}),/configuration/u);
 assert.equal((await fs.readdir(dirname(f.controlConfig))).some(name=>name.startsWith('.control-stage-')),false);
 assert.equal(f.calls.some(c=>c.command==='systemctl'&&['start','stop','enable'].includes(c.args[0])),false);
 assert.deepEqual(await fs.readdir(join(f.config.root,'releases')),[]);
});

test('explicit Linux deployment activates and checks a first release within the transaction',async t=>{
 const f=await fixture(t);await f.execute('install',{bundle:f.bundle,activate:true});
 assert.equal((await f.execute('status')).services[0].state,'active');
 const g=await fixture(t);g.setHealthFails(true);await assert.rejects(g.execute('install',{bundle:g.bundle,activate:true}),/recovered/u);
 await assert.rejects(fs.stat(join(g.config.root,'current')),{code:'ENOENT'});await assert.rejects(fs.stat(join(g.config.root,'deployment-state.json')),{code:'ENOENT'});
 assert.equal(g.calls.some(c=>c.command==='systemctl'&&c.args[0]==='start'),true);
 assert.equal(await fs.readFile(join(dirname(g.controlConfig),'login'),'utf8'),'fixture-login-secret');
});

test('Linux dry-run validates without registering or creating runtime directories',async t=>{
 const f=await fixture(t);const result=await f.execute('install',{bundle:f.bundle,dryRun:true});
 assert.equal(result.dryRun,true);await assert.rejects(fs.stat(f.config.root),{code:'ENOENT'});
 assert.equal(f.calls.some(c=>c.command==='systemctl'&&c.args[0]!=='show'),false);
 assert.equal(f.calls.some(c=>c.args.includes('ci')),false);
});

test('Linux refuses unrelated listeners, services and nonprivate configuration before mutation',async t=>{
 const f=await fixture(t);f.setForeign(true);await assert.rejects(f.execute('install',{bundle:f.bundle}),/ownership|listener/u);
 await assert.rejects(fs.stat(f.config.root),{code:'ENOENT'});f.setForeign(false);
 await fs.chmod(f.controlConfig,0o644);await assert.rejects(f.execute('install',{bundle:f.bundle}));
 assert.equal(f.calls.some(c=>c.args.includes('ci')),false);
});

test('Linux install is idempotent, bounded logs redact secrets, uninstall retains private state',async t=>{
 const f=await fixture(t);await f.execute('install',{bundle:f.bundle});
 const npmCalls=f.calls.filter(c=>c.args.includes('ci'));assert.equal(npmCalls.length,2);
 for(const call of npmCalls){const user=call.args.find(v=>v.startsWith('--userconfig=')),global=call.args.find(v=>v.startsWith('--globalconfig='));assert.notEqual(user.split('=')[1],global.split('=')[1]);assert.ok(call.args.includes('--ignore-scripts'));}
 await f.execute('install',{bundle:f.bundle});assert.equal(f.calls.filter(c=>c.args.includes('ci')).length,2);
 await f.execute('start');assert.equal((await f.execute('status')).services[0].state,'active');
 const logs=await f.execute('logs',{lines:7});assert.equal(logs.logs.split('\n').length,7);assert.equal(logs.logs.includes('private-value'),false);
 await fs.mkdir(f.control.deviceRoot);await fs.writeFile(join(f.control.deviceRoot,'pairing'),'retained');
 await f.execute('uninstall');assert.equal(await fs.readFile(join(f.control.deviceRoot,'pairing'),'utf8'),'retained');assert.equal(await fs.readFile(join(dirname(f.controlConfig),'login'),'utf8'),'fixture-login-secret');
 await assert.rejects(fs.stat(join(f.base,'units','voxcode-control.service')),{code:'ENOENT'});
 assert.equal(f.calls.some(c=>c.args.some(v=>v==='voxcode.service'||v==='voxcode-task.service')),false);
});

test('Linux detects modified registration and immutable source before service commands',async t=>{
 const f=await fixture(t);await f.execute('install',{bundle:f.bundle});
 await fs.appendFile(join(f.base,'units','voxcode-control.service'),'# altered\n');
 await assert.rejects(f.execute('start'),/ownership/u);assert.equal(f.calls.some(c=>c.command==='systemctl'&&c.args[0]==='start'),false);
});

test('Linux failed start restores prior release and retained configuration',async t=>{
 const f=await fixture(t);await f.execute('install',{bundle:f.bundle});await f.execute('start');
 // An independently packaged older commit provides a genuine second source revision.
 const older=execFileSync('git',['-C',checkout,'rev-parse','HEAD~1'],{encoding:'utf8'}).trim();
 const bytes=await createBundle({root:checkout,revision:older});f.setHealthFails(true);
 await assert.rejects(f.execute('update',{bundle:{bytes,sha256:sha256(bytes)}}),/recover|health/u);
 assert.equal(await fs.realpath(join(f.config.root,'current')),join(f.config.root,'releases',revision));
 assert.equal(JSON.parse(await fs.readFile(f.controlConfig)).revision,revision);
 assert.equal(await fs.readFile(join(dirname(f.controlConfig),'login'),'utf8'),'fixture-login-secret');
 f.setHealthFails(false);await f.execute('rollback');
 await assert.rejects(fs.stat(join(f.config.root,'pending-activation.json')),{code:'ENOENT'});
});

test('Linux adopts only an inspected bootstrap installation with the exact committed sources',async t=>{
 const f=await fixture(t);await f.execute('install',{bundle:f.bundle});await f.execute('start');
 await fs.unlink(join(f.config.root,'deployment-state.json'));
 await fs.writeFile(join(f.config.root,'deployment.json'),JSON.stringify({format:'voxcode-control-bootstrap-v1',revision,service:'voxcode-control.service',serviceUser:'voxcode-control',state:'started'}),{mode:0o600});
 await assert.rejects(f.execute('install',{bundle:f.bundle}),/ownership/u);
 const result=await f.execute('adopt',{bundle:f.bundle,dryRun:true});assert.equal(result.dryRun,true);
 await assert.rejects(fs.stat(join(f.config.root,'deployment-state.json')),{code:'ENOENT'});
 await f.execute('adopt',{bundle:f.bundle});assert.equal((await f.execute('status')).installed,true);
});

test('Linux adoption accepts the legacy unit safety directives used by the vm6 bootstrap',async t=>{
 const f=await fixture(t);await f.execute('install',{bundle:f.bundle});await f.execute('start');
 await fs.unlink(join(f.config.root,'deployment-state.json'));
 await fs.writeFile(join(f.config.root,'deployment.json'),JSON.stringify({format:'voxcode-control-bootstrap-v1',revision,service:'voxcode-control.service',serviceUser:'voxcode-control',state:'started'}),{mode:0o600});
 const unit=join(f.base,'units','voxcode-control.service');
 const text=await fs.readFile(unit,'utf8');
 await fs.writeFile(unit,text.replace('Environment=VOXCODE_CONTROL_CONFIG=',`Environment=PATH=${dirname(f.config.node)}:/usr/sbin:/usr/bin:/sbin:/bin\nEnvironment=VOXCODE_CONTROL_CONFIG=`).replace('RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\nCapabilityBoundingSet='));
 await f.execute('adopt',{bundle:f.bundle});
 assert.equal((await f.execute('status')).installed,true);
});

test('Linux stop remains available when TLS configuration needs repair',async t=>{
 const f=await fixture(t);await f.execute('install',{bundle:f.bundle});await f.execute('start');
 await fs.writeFile(f.controlConfig,JSON.stringify({...f.control,publicOrigin:'http://127.0.0.1:9899'}));
 await f.execute('stop');assert.equal((await f.execute('status')).services[0].state,'inactive');
});

test('Linux successful update and explicit rollback switch source and config together',async t=>{
 const f=await fixture(t);await f.execute('install',{bundle:f.bundle});await f.execute('start');
 const older=execFileSync('git',['-C',checkout,'rev-parse','HEAD~1'],{encoding:'utf8'}).trim();const bytes=await createBundle({root:checkout,revision:older});
 await f.execute('update',{bundle:{bytes,sha256:sha256(bytes)}});assert.equal(JSON.parse(await fs.readFile(f.controlConfig)).revision,older);
 await f.execute('rollback');assert.equal(JSON.parse(await fs.readFile(f.controlConfig)).revision,revision);
 const stop=f.calls.findIndex(c=>c.command==='systemctl'&&c.args[0]==='stop');
 const checks=f.calls.map((c,i)=>c.command==='runuser'?i:-1).filter(i=>i>=0);assert.ok(checks.some(i=>i<stop));
});

test('deploying installed revision starts and checks it without reinstalling dependencies',async t=>{
 const f=await fixture(t);await f.execute('install',{bundle:f.bundle});
 const installs=f.calls.filter(c=>c.args.includes('ci')).length;
 const result=await f.execute('update',{bundle:f.bundle,activate:true});
 assert.equal(result.unchanged,true);assert.equal((await f.execute('status')).services[0].state,'active');
 assert.equal(f.calls.filter(c=>c.args.includes('ci')).length,installs);
});

test('pending recovery retains exact private configuration edited since install',async t=>{
 const f=await fixture(t);await f.execute('install',{bundle:f.bundle});await f.execute('start');
 const edited={...f.control,deviceId:'mac-edited'};await fs.writeFile(f.controlConfig,JSON.stringify(edited));
 const older=execFileSync('git',['-C',checkout,'rev-parse','HEAD~1'],{encoding:'utf8'}).trim();const bytes=await createBundle({root:checkout,revision:older});
 f.setHealthFails(true);await assert.rejects(f.execute('update',{bundle:{bytes,sha256:sha256(bytes)}}),/recovery unconfirmed/u);
 const journal=JSON.parse(await fs.readFile(join(f.config.root,'pending-activation.json')));
 assert.equal(JSON.parse(Buffer.from(journal.before.current.configuration[f.controlConfig],'base64')).deviceId,'mac-edited');
 f.setHealthFails(false);await f.execute('rollback');assert.equal(JSON.parse(await fs.readFile(f.controlConfig)).deviceId,'mac-edited');
});
