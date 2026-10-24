import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,chmod,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readTaskConfiguration,startTaskRuntime} from '../task-cli.mjs';

async function fixture(t){
  const root=await realpath(await mkdtemp(join(tmpdir(),'vxtask-cli-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const config=join(root,'projects.json'),command=join(root,'codex');
  await writeFile(config,JSON.stringify({projects:[{id:'one',name:'One',root:join(root,'project'),enabled:true}]}),{mode:0o600});
  await writeFile(command,'#!/bin/sh\nexit 0\n',{mode:0o700});
  const env={VOXCODE_PROJECTS_FILE:config,VOXCODE_TASK_DATA:join(root,'state'),VOXCODE_TASK_SOCKET:join(root,'task.sock'),VOXCODE_CODEX_COMMAND:command};
  return {root,config,command,env};
}
test('task config refuses root, web credential inheritance and loose configuration permissions',async t=>{
  const f=await fixture(t);
  await assert.rejects(()=>readTaskConfiguration({env:f.env,uid:0}),/non-root/);
  await assert.rejects(()=>readTaskConfiguration({env:{...f.env,LINX_TOKEN:'synthetic'}}),/credentials/);
  assert.equal((await readTaskConfiguration({env:f.env})).projects[0].id,'one');
  await chmod(f.config,0o640);assert.equal((await readTaskConfiguration({env:f.env})).projects[0].id,'one');
  await chmod(f.config,0o660);await assert.rejects(()=>readTaskConfiguration({env:f.env}),/Private/);
  await chmod(f.config,0o600);await chmod(f.command,0o777);await assert.rejects(()=>readTaskConfiguration({env:f.env}),/Trusted/);
});
test('task runtime closes RPC then cancels owned active tasks and refuses unconfirmed cleanup',async t=>{
  const f=await fixture(t),events=[];let quarantined=false;
  const service={listProjects:async()=>[{id:'one',enabled:true}],listTasks:async()=>[{id:'task',status:'running'}],cancelTask:async id=>events.push(`cancel:${id}`),status:async()=>({activeTasks:0,quarantined})};
  const runtime=await startTaskRuntime({env:f.env,createService:async()=>service,createRpc:async()=>({close:async()=>events.push('rpc-close')})});
  await runtime.close();assert.deepEqual(events,['rpc-close','cancel:task']);
  quarantined=true;
  const other=await startTaskRuntime({env:f.env,createService:async()=>service,createRpc:async()=>({close:async()=>{}})});
  await assert.rejects(()=>other.close(),/unconfirmed/);
});
