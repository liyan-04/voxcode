import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {runner} from '../control/common.mjs';

test('clean lifecycle commands can locate required system administration tools',async t=>{
 if(!['linux','darwin'].includes(process.platform))return t.skip('Linux and macOS lifecycle platforms only');
 const name=process.platform==='linux'?'runuser':'sysctl';
 const expected=`/usr/sbin/${name}`;
 await access(expected,constants.X_OK);
 // A real child performs PATH lookup; no service or administrative command runs.
 const {stdout}=await runner()('/usr/bin/which',[name]);
 assert.equal(stdout.trim(),expected);
});

test('system tool lookup retains a clean environment without ambient credentials',async()=>{
 const {stdout}=await runner()(process.execPath,['-e',
  'console.log(JSON.stringify({path:process.env.PATH,keys:Object.keys(process.env)}))']);
 const child=JSON.parse(stdout);
 const keys=child.keys.filter(key=>process.platform!=='darwin'||key!=='__CF_USER_TEXT_ENCODING');
 assert.deepEqual(keys,['PATH']);
 assert.deepEqual(child.path.split(':'),['/usr/sbin','/usr/bin','/sbin','/bin']);
});
