import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createBundle,readBundle,sha256} from '../control/package.mjs';
import {createMacController,labels} from '../control/mac.mjs';

const checkout=fileURLToPath(new URL('../../',import.meta.url));
const revision=execFileSync('git',['-C',checkout,'rev-parse','HEAD'],{encoding:'utf8'}).trim();let archive;
const macTest=(name,fn)=>test(name,{skip:process.platform!=='darwin'},fn);
async function fixture(t){
 const base=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'control-mac-')));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const privateDir=join(base,'private'),launchDirectory=join(base,'LaunchAgents'),home=join(base,'home'),tools=join(base,'tools');
 for(const dir of [privateDir,launchDirectory,home,tools])await fs.mkdir(dir,{mode:0o700});
 for(const name of ['node','npm-cli.js','codex'])await fs.writeFile(join(tools,name),'fixture executable',{mode:0o700});
 const key=join(privateDir,'ca.key'),cert=join(privateDir,'ca.pem');execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=FixtureCA'],{stdio:'ignore'});await fs.chmod(key,0o600);
 const projectsFile=join(privateDir,'projects.json'),agentConfig=join(privateDir,'agent.json'),codexHome=join(privateDir,'codex-home');await fs.mkdir(codexHome,{mode:0o700});
 await fs.writeFile(projectsFile,JSON.stringify({projects:[]}),{mode:0o600});
 const agent={endpoint:'wss://127.0.0.1:9899/agent',deviceId:'mac',stateFile:join(privateDir,'agent-state.json'),keychainService:'fixture.voxcode',keychainAccount:'mac'};
 await fs.writeFile(agentConfig,JSON.stringify(agent),{mode:0o600});
 const config={format:1,root:join(base,'runtime'),home,node:join(tools,'node'),npm:join(tools,'npm-cli.js'),agentConfig,projectsFile,taskData:join(privateDir,'tasks'),taskSocket:join(privateDir,'rpc.sock'),codexCommand:join(tools,'codex'),codexHome,caFile:cert};
 const path=join(privateDir,'deployment.json');await fs.writeFile(path,JSON.stringify(config),{mode:0o600});
 const calls=[],loaded=new Map();let failAgent=false,foreign=false,activeTasks=0,transientFailures=0,exitPolls=0;
 const plist=path=>JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-',path],{encoding:'utf8'}));
 const run=async(command,args,options={})=>{
  calls.push({command,args,options});
  if(args[0]==='--version')return {stdout:'v22.23.4\n'};
  if(args.includes('--input-type=module'))return {stdout:'{"ok":true}'};
  if(command==='/usr/bin/plutil')return {stdout:execFileSync(command,args,{encoding:'utf8'})};
  if(command==='/usr/bin/security'){assert.equal(args.includes('-w'),false);return {stdout:'',stderr:''};}
  if(command==='/bin/launchctl'){
   const label=args.at(-1).split('/').at(-1).replace(/\.plist$/u,'');
   if(args[0]==='print'){
    if(foreign&&label===labels[0])return {stdout:`path = /unrelated/task.plist\nprogram = /usr/bin/env\nstate = running\npid = 999\narguments = {\n /usr/bin/env\n}\n`};
    const job=loaded.get(label);if(!job)throw Object.assign(Error('not loaded'),{code:113});
    const parsed=plist(job.path);return {stdout:`path = ${job.path}\ntype = LaunchAgent\nprogram = /usr/bin/env\nstate = running\npid = ${job.pid}\narguments = {\n${parsed.ProgramArguments.map(v=>' '+v).join('\n')}\n}\n`};
   }
   if(args[0]==='bootstrap'){if(transientFailures-->0)throw Object.assign(Error('transient'),{code:5,stderr:'Bootstrap failed: 5: Input/output error\n'});if(failAgent&&label===labels[1])throw Error('fixture bootstrap failure');loaded.set(label,{path:args.at(-1),pid:label===labels[0]?501:502});}
   if(args[0]==='bootout')loaded.delete(label);
  }
  if(args.includes('ci')){
   const lock=JSON.parse(await fs.readFile(join(options.cwd,'package-lock.json')));
   for(const [name,entry] of Object.entries(lock.packages))if(name){const directory=join(options.cwd,name);await fs.mkdir(directory,{recursive:true});await fs.writeFile(join(directory,'package.json'),JSON.stringify({version:entry.version}));}
  }
  return {stdout:''};
 };
 archive??=await createBundle({root:checkout,revision});
 const controller=createMacController({run,launchDirectory,gatewayHealth:async()=>{},taskReady:async()=>({activeTasks,quarantined:false}),inspectProcess:async pid=>{
  const job=[...loaded.values()].find(job=>job.pid===pid);if(!job)throw Error('no process');const args=plist(job.path).ProgramArguments;const index=args.findIndex((value,index)=>index>=2&&value.startsWith('/')&&!value.includes('='));return {uid:process.getuid(),command:args.slice(index).join(' ')};
 },processAlive:async pid=>exitPolls-->0||[...loaded.values()].some(job=>job.pid===pid)});
 return {setExitPolls:value=>exitPolls=value,setActive:value=>activeTasks=value,setTransient:value=>transientFailures=value,base,path,config,agent,calls,loaded,plist,bundle:{bytes:archive,sha256:sha256(archive)},execute:(command,extra={})=>controller.execute({command,config:path,...extra}),failAgent:value=>failAgent=value,foreign:value=>foreign=value};
}

macTest('Mac dry-run is nonmutating and refuses an unrelated loaded label',async t=>{
 const f=await fixture(t);assert.equal((await f.execute('install',{bundle:f.bundle,dryRun:true})).dryRun,true);await assert.rejects(fs.stat(f.config.root),{code:'ENOENT'});
 f.foreign(true);await assert.rejects(f.execute('install',{bundle:f.bundle}),/ownership/u);
 assert.equal(f.calls.some(c=>c.args[0]==='bootstrap'),false);
});

macTest('Mac starts task first, stops Agent first, repeats install and retains private data on uninstall',async t=>{
 const f=await fixture(t);await f.execute('install',{bundle:f.bundle});assert.equal(f.loaded.size,0);
 await f.execute('install',{bundle:f.bundle});assert.equal(f.calls.filter(c=>c.args.includes('ci')).length,3);
 await f.execute('start');assert.equal(f.loaded.size,2);
 assert.deepEqual(f.calls.filter(c=>c.args[0]==='bootstrap').map(c=>c.args.at(-1).split('/').at(-1)),labels.map(label=>label+'.plist'));
 await f.execute('restart');assert.deepEqual(f.calls.filter(c=>c.args[0]==='bootout').slice(0,2).map(c=>c.args.at(-1).split('/').at(-1)),[...labels].reverse());
 await fs.mkdir(f.config.taskData,{mode:0o700});await fs.writeFile(join(f.config.taskData,'tasks.json'),'retained');await fs.writeFile(f.agent.stateFile,'{"retained":true}',{mode:0o600});
 await f.execute('uninstall');assert.equal(await fs.readFile(join(f.config.taskData,'tasks.json'),'utf8'),'retained');assert.equal(JSON.parse(await fs.readFile(f.agent.stateFile)).retained,true);
 assert.equal(f.calls.some(c=>c.command==='/usr/bin/security'&&c.args[0].startsWith('delete')),false);
});

macTest('Mac registration uses canonical CLI paths, clean task environment, and bounded private logs',async t=>{
 const f=await fixture(t);await f.execute('install',{bundle:f.bundle});
 const task=f.plist(join(f.base,'LaunchAgents',labels[0]+'.plist')),agent=f.plist(join(f.base,'LaunchAgents',labels[1]+'.plist'));
 assert.ok(task.ProgramArguments.includes(join(f.config.root,'releases',revision,'apps/server/task-cli.mjs')));assert.equal(task.ProgramArguments[1],'-i');
 assert.equal(task.ProgramArguments.some(value=>/^(?:LINX_|MCP_|NODE_EXTRA_CA_CERTS)/u.test(value)),false);assert.ok(agent.ProgramArguments.some(value=>value==='NODE_EXTRA_CA_CERTS='+f.config.caFile));
 await fs.writeFile(join(f.config.root,'logs/task.out.log'),Array.from({length:10000},(_,i)=>`${i} token=private-log-value`).join('\n'),{mode:0o600});
 const result=await f.execute('logs',{lines:4});assert.ok(result.logs.length<64*1024);assert.equal(result.logs.split('\n').length,4);assert.equal(result.logs.includes('private-log-value'),false);
});

macTest('Mac failed Agent bootstrap unloads the task and leaves private state untouched',async t=>{
 const f=await fixture(t);await f.execute('install',{bundle:f.bundle});f.failAgent(true);
 await assert.rejects(f.execute('start'));assert.equal(f.loaded.size,0);assert.ok(await fs.stat(f.config.agentConfig));
});

macTest('Mac stale task socket and changed plist are refused without force-removing either',async t=>{
 const f=await fixture(t);await f.execute('install',{bundle:f.bundle});await fs.writeFile(f.config.taskSocket,'unrelated endpoint',{mode:0o600});
 await assert.rejects(f.execute('start'),/socket/u);assert.equal(await fs.readFile(f.config.taskSocket,'utf8'),'unrelated endpoint');
 await fs.unlink(f.config.taskSocket);await fs.appendFile(join(f.base,'LaunchAgents',labels[0]+'.plist'),'<!-- changed -->');await assert.rejects(f.execute('stop'),/ownership/u);
});

macTest('Mac update and rollback retain pairing and use the same ordered labels',async t=>{
 const f=await fixture(t);await f.execute('install',{bundle:f.bundle});await f.execute('start');
 const older=execFileSync('git',['-C',checkout,'rev-parse','HEAD~1'],{encoding:'utf8'}).trim(),bytes=await createBundle({root:checkout,revision:older});
 await f.execute('update',{bundle:{bytes,sha256:sha256(bytes)}});assert.equal((await f.execute('status')).revision,older);
 await f.execute('rollback');assert.equal((await f.execute('status')).revision,revision);assert.equal(f.loaded.size,2);assert.ok(await fs.stat(f.config.agentConfig));
});

async function legacyFixture(t){
 const f=await fixture(t);await f.execute('install',{bundle:f.bundle});await f.execute('start');
 const release=join(f.config.root,'releases',revision),legacy=join(f.config.root,'runtime');await fs.rename(release,legacy);await fs.unlink(join(f.config.root,'current'));await fs.unlink(join(f.config.root,'deployment-state.json'));
 for(const label of labels){const path=join(f.base,'LaunchAgents',label+'.plist');await fs.writeFile(path,(await fs.readFile(path,'utf8')).replaceAll(release,legacy));}
 await fs.mkdir(join(f.config.root,'private'),{mode:0o700});
 const source=readBundle(f.bundle),runtime=[...source.files].map(([path,bytes])=>({path,sha256:sha256(bytes)}));
 const manifest=JSON.stringify({revision,runtime,labels,plistPaths:labels.map(label=>join(f.base,'LaunchAgents',label+'.plist'))});
 await fs.writeFile(join(f.config.root,'private/install-manifest.json'),manifest,{mode:0o600});
 return {...f,legacy,manifest};
}
macTest('Mac explicitly adopts an audited legacy runtime only with a reviewed manifest hash',async t=>{
 const f=await legacyFixture(t);await assert.rejects(f.execute('adopt',{bundle:f.bundle}),/reviewed/u);
 f.config.legacyManifestSha256=sha256(f.manifest);await fs.writeFile(f.path,JSON.stringify(f.config));
 const before=f.calls.filter(c=>c.args[0]==='bootstrap').length;await f.execute('adopt',{bundle:f.bundle});
 assert.equal(f.calls.filter(c=>c.args[0]==='bootstrap').length,before);assert.equal((await f.execute('status')).installed,true);assert.equal(await fs.realpath(join(f.config.root,'current')),f.legacy);
});

macTest('Mac legacy reconnect patch needs its reviewed hash and is labelled as a snapshot',async t=>{
 const f=await legacyFixture(t),file=join(f.legacy,'apps/mac-agent/agent.mjs'),before=await fs.readFile(file),after=Buffer.concat([before,Buffer.from('\n// fixture reviewed patch\n')]);
 await fs.writeFile(file,after);f.config.legacyManifestSha256=sha256(f.manifest);await fs.writeFile(f.path,JSON.stringify(f.config));
 await assert.rejects(f.execute('adopt',{bundle:f.bundle}),/checksum/u);
 const patch=JSON.stringify({scope:'agent-reconnect-only',previousSha256:sha256(before),sha256:sha256(after),revision});
 await fs.writeFile(join(f.config.root,'private/agent-reconnect-install-fixture.json'),patch,{mode:0o600});f.config.legacyAgentPatchSha256=sha256(patch);await fs.writeFile(f.path,JSON.stringify(f.config));
 await f.execute('adopt',{bundle:f.bundle});const status=await f.execute('status');assert.equal(status.services[0].source,'audited-legacy-snapshot');assert.deepEqual(status.services[0].patchRevisions,[revision]);
});

macTest('Mac adoption refuses source files omitted from the approved manifest',async t=>{
 const f=await legacyFixture(t),manifest=JSON.parse(f.manifest);manifest.runtime=manifest.runtime.filter(entry=>entry.path!=='apps/server/task-rpc.mjs');
 const bytes=JSON.stringify(manifest);await fs.writeFile(join(f.config.root,'private/install-manifest.json'),bytes);f.config.legacyManifestSha256=sha256(bytes);await fs.writeFile(f.path,JSON.stringify(f.config));
 await assert.rejects(f.execute('adopt',{bundle:f.bundle}),/unrecorded|manifest/u);await assert.rejects(fs.stat(join(f.config.root,'deployment-state.json')),{code:'ENOENT'});
});

macTest('Mac adoption diagnoses a legacy Node alias and migrates updates to the frozen toolchain',async t=>{
 const f=await legacyFixture(t),directory=join(f.base,'legacy-bin');await fs.mkdir(directory,{mode:0o775});await fs.chmod(directory,0o775);
 const alias=join(directory,'node');await fs.symlink(f.config.node,alias);
 for(const label of labels){const path=join(f.base,'LaunchAgents',label+'.plist');await fs.writeFile(path,(await fs.readFile(path,'utf8')).replaceAll(f.config.node,alias));}
 f.config.legacyManifestSha256=sha256(f.manifest);await fs.writeFile(f.path,JSON.stringify(f.config));
 await f.execute('adopt',{bundle:f.bundle});await f.execute('stop');
 await assert.rejects(f.execute('start'),/legacy|update/u);assert.equal(f.loaded.size,0);
 const older=execFileSync('git',['-C',checkout,'rev-parse','HEAD~1'],{encoding:'utf8'}).trim(),bytes=await createBundle({root:checkout,revision:older});
 await f.execute('update',{bundle:{bytes,sha256:sha256(bytes)}});await f.execute('start');
 await f.execute('rollback');assert.equal(f.loaded.size,2);
 for(const label of labels)assert.ok(f.plist(join(f.base,'LaunchAgents',label+'.plist')).ProgramArguments.includes(f.config.node));
});

macTest('Mac refuses active tasks before unloading either job',async t=>{
 const f=await fixture(t);await f.execute('install',{bundle:f.bundle});await f.execute('start');f.setActive(1);
 const before=f.calls.filter(c=>c.args[0]==='bootout').length;
 await assert.rejects(f.execute('restart'),/active|reconcil/u);
 assert.equal(f.calls.filter(c=>c.args[0]==='bootout').length,before);assert.equal(f.loaded.size,2);
});
macTest('Mac retries only transient bootstrap failures and still starts task before Agent',async t=>{
 const f=await fixture(t);await f.execute('install',{bundle:f.bundle});f.setTransient(2);await f.execute('start');
 assert.equal(f.loaded.size,2);assert.equal(f.calls.filter(c=>c.args[0]==='bootstrap').length,4);
});

macTest('Mac waits for original process exit before bootstrap and bounds transient retries',async t=>{
 const f=await fixture(t);await f.execute('install',{bundle:f.bundle});await f.execute('start');
 f.setExitPolls(2);await f.execute('restart');assert.equal(f.loaded.size,2);
 await f.execute('stop');f.setTransient(20);
 const count=f.calls.filter(c=>c.args[0]==='bootstrap').length;
 await assert.rejects(f.execute('start'),/bootstrap/);
 assert.equal(f.calls.filter(c=>c.args[0]==='bootstrap').length-count,4);assert.equal(f.loaded.size,0);
});
