import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runEntry} from '../control/entry.mjs';
const revision='a'.repeat(40);
function fixture(){
 const calls=[];
 const controller={execute:async options=>{calls.push(options);return {installed:true,revision};}};
 const deps={platform:'darwin',uid:501,env:{VOXCODE_DEPLOY_CONFIG:'/private/config with spaces.json'},root:'/checkout',controller,
  run:async(command,args)=>{calls.push({command,args});return {stdout:args.includes('fetch')?'':revision+'\n'};},
  bundle:async options=>{calls.push({bundle:options});return Buffer.from('bundle');}};
 return {calls,deps};
}
test('entry preserves configuration and forwards start without packaging or fetching',async()=>{
 const {calls,deps}=fixture();await runEntry(['start','--dry-run'],deps);
 assert.deepEqual(calls,[{command:'start',config:'/private/config with spaces.json',dryRun:true}]);
});
test('deploy fetches exact latest master then packages and updates with transactional activation',async()=>{
 const {calls,deps}=fixture();await runEntry(['deploy'],deps);
 assert.deepEqual(calls[0].args,['-C','/checkout','fetch','--no-tags','origin','master']);
 assert.deepEqual(calls[1].args,['-C','/checkout','rev-parse','--verify','FETCH_HEAD^{commit}']);
 assert.deepEqual(calls[2],{bundle:{root:'/checkout',revision}});
 assert.equal(calls[3].command,'update');assert.equal(calls[3].activate,true);
 assert.ok(Buffer.isBuffer(calls[3].bundle.bytes));
});
test('install packages committed local HEAD without fetching and remains stopped',async()=>{
 const {calls,deps}=fixture();await runEntry(['install','--config','/private/explicit.json'],deps);
 assert.deepEqual(calls[0].args,['-C','/checkout','rev-parse','--verify','HEAD^{commit}']);
 assert.equal(calls.at(-1).command,'install');assert.equal(calls.at(-1).activate,false);
 assert.equal(calls.at(-1).config,'/private/explicit.json');
});
test('fetch failure never packages or changes services',async()=>{
 const {calls,deps}=fixture();deps.run=async()=>{throw Error('fetch failed');};
 await assert.rejects(runEntry(['deploy'],deps),/fetch/);assert.deepEqual(calls,[]);
});
test('entry rejects unsupported platform/operator and unknown arguments before work',async()=>{
 for(const override of [{platform:'win32'},{platform:'linux',uid:501},{uid:0}]){
  const {calls,deps}=fixture();await assert.rejects(runEntry(['start'],{...deps,...override}));assert.deepEqual(calls,[]);
 }
 for(const args of [['start','--wat'],['deploy','--config'],['install','--config','a','--config','b'],['unknown']]){
  const {calls,deps}=fixture();await assert.rejects(runEntry(args,deps));assert.deepEqual(calls,[]);
 }
});
test('all shell entry points work from arbitrary cwd and support help without service access',()=>{
 for(const command of ['install','start','stop','restart','deploy']){
  const path=fileURLToPath(new URL(`../../${command}.sh`,import.meta.url));
  assert.match(execFileSync('/bin/sh',[path,'--help'],{cwd:'/private/tmp',encoding:'utf8'}),/VOXCODE_DEPLOY_CONFIG/);
 }
});
