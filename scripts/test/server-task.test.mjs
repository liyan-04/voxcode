import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServerTaskController,renderTaskUnit,validateServerTaskConfig} from '../control/server-task.mjs';

const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();

async function fixture(t){
  const base=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'server-task-')));t.after(()=>fs.rm(base,{recursive:true,force:true}));
  const privateDir=join(base,'private'),units=join(base,'units'),runtime=join(base,'runtime');
  await fs.mkdir(privateDir,{mode:0o700});await fs.mkdir(units,{mode:0o755});
  const source=join(privateDir,'codex');await fs.writeFile(source,'#!/bin/sh\nexit 0\n',{mode:0o755});
  const projects=join(privateDir,'projects.json');await fs.writeFile(projects,JSON.stringify({projects:[]})+'\n',{mode:0o640});
  const env=join(privateDir,'task.env'),model=join(privateDir,'model.toml');
  await fs.writeFile(model,'model = "fixture"\n',{mode:0o600});
  const config={format:1,revision,root:runtime,service:'voxcode-task.service',serviceUser:'voxcode-task',serviceUid:process.getuid(),serviceGroup:'voxcode-rpc',serviceGid:process.getgid(),toolSource:source,toolPath:join(runtime,'tools','codex'),projectsFile:projects,dataDirectory:join(runtime,'shared','task-state'),socketPath:'/run/voxcode-task/rpc.sock',envFile:env,modelConfigSource:model,modelConfigPath:join(runtime,'private','codex','config.toml'),stateFile:join(privateDir,'state.json'),unitDirectory:units};
  const calls=[];let active=false;let foreign=false;let healthFails=false;
  const run=async(command,args)=>{calls.push({command,args});if(command==='id')return {stdout:String(args[0]==='-u'?config.serviceUid:config.serviceGid)+'\n'};if(command==='systemctl'&&args[0]==='show'){const installed=await fs.stat(join(units,config.service)).then(()=>true,()=>false);return {stdout:`LoadState=${foreign?'loaded':installed?'loaded':'not-found'}\nFragmentPath=${installed?join(units,config.service):''}\nUser=${config.serviceUser}\nGroup=${config.serviceGroup}\nMainPID=${active?321:0}\nActiveState=${active?'active':'inactive'}\n`};}if(command==='systemctl'&&args[0]==='start')active=true;if(command==='systemctl'&&args[0]==='stop')active=false;if(command==='ss')return {stdout:foreign?'LISTEN 0 1 *:9999 *:* users:(("foreign",pid=9,fd=1))\n':active?'u_str LISTEN 0 1 /run/voxcode-task/rpc.sock 123 * 0\n':''};return {stdout:''};};
  const ctl=createServerTaskController({run,unitDirectory:units,fsImpl:fs,health:async()=>{if(healthFails)throw Error('fixture health failure');}});
  return {base,config,calls,ctl,setForeign:v=>foreign=v,setActive:v=>active=v,setHealthFails:v=>healthFails=v};
}

test('server task config rejects root and symlink Codex sources',async t=>{
  const f=await fixture(t);
  assert.throws(()=>validateServerTaskConfig({...f.config,serviceUser:'root'}),/dedicated|root/u);
  const link=join(f.base,'link');await fs.symlink(f.config.toolSource,link);
  await assert.rejects(f.ctl.execute('install',{...f.config,toolSource:link}),/regular|symlink|tool/u);
});

test('unit has isolated non-root task identity and no web or voice credentials',async t=>{
  const f=await fixture(t),unit=renderTaskUnit(f.config);
  assert.match(unit,/^User=voxcode-task$/mu);assert.match(unit,/^Group=voxcode-rpc$/mu);assert.match(unit,/task-cli\.mjs start/);assert.match(unit,/NoNewPrivileges=yes/);assert.match(unit,/CapabilityBoundingSet=$/mu);assert.match(unit,/InaccessiblePaths=.*shared\/config/);assert.doesNotMatch(unit,/LINX_|MCP_|LOGIN_SECRET/);
});

test('install is atomic, copies owned tool/model state, and is idempotent',async t=>{
  const f=await fixture(t);const first=await f.ctl.execute('install',f.config);
  assert.equal(first.installed,true);assert.equal(await fs.readFile(f.config.toolPath,'utf8'),'#!/bin/sh\nexit 0\n');assert.equal(await fs.readFile(f.config.modelConfigPath,'utf8'),'model = "fixture"\n');
  const second=await f.ctl.execute('install',f.config);assert.equal(second.unchanged,true);assert.equal(f.calls.filter(x=>x.command==='systemctl'&&x.args[0]!=='show').length,2);
  assert.equal((await fs.stat(f.config.envFile)).mode&0o777,0o640);assert.equal((await fs.stat(f.config.modelConfigPath)).mode&0o777,0o600);
  assert.equal((await fs.stat(f.config.modelConfigPath)).uid,f.config.serviceUid);
  assert.equal((await fs.stat(f.config.modelConfigPath)).gid,f.config.serviceGid);
});

test('install refuses foreign listener and start never runs when ownership is uncertain',async t=>{
  const f=await fixture(t);f.setForeign(true);await assert.rejects(f.ctl.execute('install',f.config),/ownership|listener/u);assert.equal(await fs.stat(f.config.root).then(()=>true,()=>false),false);
});

test('activation failure rolls back a prior task unit and keeps private model config',async t=>{
  const f=await fixture(t);await f.ctl.execute('install',f.config);await f.ctl.execute('start',f.config);f.setActive(true);
  const changed={...f.config,toolSource:f.config.toolSource,revision:'a'.repeat(40)};f.setHealthFails(true);
  await assert.rejects(f.ctl.execute('update',changed),/health|recovered|activation/u);
  assert.equal(await fs.readFile(f.config.modelConfigPath,'utf8'),'model = "fixture"\n');
  assert.equal(JSON.parse(await fs.readFile(f.config.stateFile,'utf8')).current.revision,f.config.revision);
});

test('missing designated model authentication is reported precisely without printing content',async t=>{
  const f=await fixture(t);const missing={...f.config,modelConfigSource:join(f.base,'missing.toml')};await assert.rejects(f.ctl.execute('install',missing),/Designated model configuration/u);
});
