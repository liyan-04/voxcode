import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startAgent,parseArguments} from '../cli.mjs';

test('CLI accepts task socket and gets secret only through fixed Keychain command',async()=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'voxcode-agent-cli-')));const config=join(dir,'agent.json');await writeFile(config,JSON.stringify({endpoint:'wss://example.invalid/agent',deviceId:'mac1',stateFile:join(dir,'ledger.json'),keychainService:'voxcode.mac-agent',keychainAccount:'mac1'}),{mode:0o600});
 let passed,query,started=false;
 const agent=await startAgent({args:['--config',config,'--task-socket',join(dir,'task.sock')],env:{},run:async(file,args)=>{query={file,args};return {stdout:'fixture-secret\n'};},WebSocketImpl:class{},createAgent:async options=>{passed=options;return {start(){started=true;},close(){}};}});
 assert.deepEqual(query,{file:'/usr/bin/security',args:['find-generic-password','-s','voxcode.mac-agent','-a','mac1','-w']});assert.equal(started,true);assert.equal(passed.token,'fixture-secret');assert.deepEqual(passed.capabilities,['task_rpc']);assert.equal(typeof passed.onCommand,'function');await agent.close();
});
test('CLI rejects unsafe TLS setting, non-WSS target and unknown arguments before Keychain',async()=>{
 assert.throws(()=>parseArguments(['--token','secret']),/Unknown/);
 await assert.rejects(()=>startAgent({args:[],env:{NODE_TLS_REJECT_UNAUTHORIZED:'0'}}),/TLS/);
 const dir=await realpath(await mkdtemp(join(tmpdir(),'voxcode-agent-cli-')));const config=join(dir,'config.json');await writeFile(config,JSON.stringify({endpoint:'ws://remote.invalid',deviceId:'mac1',stateFile:join(dir,'ledger'),keychainService:'s',keychainAccount:'a'}),{mode:0o600});
 await assert.rejects(()=>startAgent({args:['--config',config,'--task-socket',join(dir,'sock')],env:{},run:()=>assert.fail('must not read Keychain')}),/WSS/);
});
