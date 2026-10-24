import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Removing validation would allow a caller to turn this fixed acceptance test
// into a prompt/path injection; removing replay handling would start it twice.
const module = await import('../linx-voice-probe.mjs').catch(() => ({}));

test('probe provides a fixed tool contract and ignores notification IDs', async () => {
  assert.equal(typeof module.createAcceptanceProbe, 'function', 'acceptance probe not implemented');
  const p = module.createAcceptanceProbe({root:'/unused', run:async()=>({exitCode:0}), version:()=> 'codex fixture'});
  assert.equal(await p.handle({jsonrpc:'2.0',method:'notifications/initialized'}),null);
  const tools=(await p.handle({jsonrpc:'2.0',id:1,method:'tools/list'})).result.tools;
  assert.deepEqual(tools.map(t=>t.name),['codex_status','codex_voice_acceptance','codex_voice_acceptance_result']);
  assert.equal(tools[1].inputSchema.additionalProperties,false);
});

test('invalid arguments never start a subprocess',async()=>{
  assert.equal(typeof module.createAcceptanceProbe,'function','acceptance probe not implemented');
  let calls=0;
  const p=module.createAcceptanceProbe({root:'/unused',run:async()=>{calls++;return {exitCode:0}},version:()=> 'fixture'});
  for(const args of [{verification_code:'../../root'},{verification_code:'1234',prompt:'arbitrary'},{verification_code:1234},[]]){
    const r=await p.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'codex_voice_acceptance',arguments:args}});
    assert(r.error || r.result?.isError);
  }
  assert.equal(calls,0);
});

test('duplicate calls execute once and success requires a real matching file',async t=>{
  assert.equal(typeof module.createAcceptanceProbe,'function','acceptance probe not implemented');
  const root=await mkdtemp(join(tmpdir(),'voice-probe-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  let calls=0,release;
  const gate=new Promise(r=>{release=r});
  const p=module.createAcceptanceProbe({root,version:()=> 'fixture',run:async({cwd,expected})=>{
    calls++;await gate;await writeFile(join(cwd,'voice-acceptance.txt'),expected);return {exitCode:0};
  }});
  const call=code=>p.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'codex_voice_acceptance',arguments:{verification_code:code}}});
  const a=await call('1234');await call('1234');
  assert.equal(JSON.parse(a.result.content[0].text).status,'running');
  const other=await call('5678');assert.equal(other.result.isError,true);
  release();await p.wait();
  assert.equal(calls,1);
  const r=await p.handle({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'codex_voice_acceptance_result',arguments:{}}});
  const status=JSON.parse(r.result.content[0].text);
  assert.equal(status.status,'passed');assert.equal(status.fileContent,'VOXCODE_VOICE_1234\n');
  await call('1234');assert.equal(calls,1);
});

test('zero exit without matching file is a failure',async t=>{
  assert.equal(typeof module.createAcceptanceProbe,'function','acceptance probe not implemented');
  const root=await mkdtemp(join(tmpdir(),'voice-probe-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=module.createAcceptanceProbe({root,version:()=> 'fixture',run:async()=>({exitCode:0})});
  await p.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'codex_voice_acceptance',arguments:{verification_code:'4321'}}});await p.wait();
  const r=await p.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'codex_voice_acceptance_result',arguments:{}}});
  assert.equal(JSON.parse(r.result.content[0].text).status,'failed');
});
