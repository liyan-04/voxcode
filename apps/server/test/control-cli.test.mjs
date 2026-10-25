import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,realpath,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runControlCli} from '../control-cli.mjs';
test('control CLI preflight/start consume private checked config and redact failures',async()=>{
 const output=[],config={revision:'fixture',mcpEndpoint:'private-token'},options={log:value=>output.push(value),error:value=>output.push(value)};
 let loaded=0,received;
 const load=async()=>{loaded++;return config;};
 assert.equal((await runControlCli({...options,args:['start','private-token'],load})).exitCode,2);assert.equal(loaded,0);
 assert.equal((await runControlCli({...options,args:['preflight'],load})).exitCode,0);
 assert.equal((await runControlCli({...options,args:['start'],load,start:async({config})=>{received=config;return{close:async()=>{}};}})).exitCode,0);assert.equal(received,config);
 assert.equal((await runControlCli({...options,args:['start'],load:()=>{throw Error('private-token');}})).exitCode,1);
 assert.equal(output.join().includes('private-token'),false);
});

test('direct and symlink CLI entries run preflight and redact private configuration errors',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'control-cli-entry-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const direct=fileURLToPath(new URL('../control-cli.mjs',import.meta.url)),server=fileURLToPath(new URL('../',import.meta.url));
 const current=join(root,'current'),file=join(root,'control-cli.mjs');
 await symlink(server,current,'dir');await symlink(direct,file,'file');
 const privateConfig=join(root,'missing-private-control-config-111.json');
 for(const entry of [direct,join(current,'control-cli.mjs'),file]){
  const result=spawnSync(process.execPath,[entry,'preflight'],{env:{...process.env,VOXCODE_CONTROL_CONFIG:privateConfig},encoding:'utf8',timeout:10000,maxBuffer:65536});
  assert.ifError(result.error);assert.equal(result.signal,null);
  assert.equal(result.status,1,`preflight must execute through ${entry}`);
  assert.equal(result.stdout,'');assert.equal(result.stderr,'Control startup blocked; verify private configuration, TLS and owned listener\n');
  assert.equal((result.stdout+result.stderr).includes(privateConfig),false);
 }
});

test('importing the control CLI does not start preflight or the runtime',()=>{
 const moduleUrl=new URL('../control-cli.mjs',import.meta.url).href;
 const result=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(moduleUrl)})`],{env:{...process.env,VOXCODE_CONTROL_CONFIG:'/missing-private-control-config-111.json'},encoding:'utf8',timeout:10000,maxBuffer:65536});
 assert.ifError(result.error);assert.equal(result.signal,null);assert.equal(result.status,0);
 assert.equal(result.stdout,'');assert.equal(result.stderr,'');
});
