import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createBundle,readBundle,sha256} from '../control/package.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const revision=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();

test('bundle uses exact committed production sources and complete locked packages',async()=>{
 const bytes=await createBundle({root,revision}),bundle=readBundle({bytes,sha256:sha256(bytes)});
 assert.equal(bundle.manifest.revision,revision);
 for(const name of ['apps/server/control-cli.mjs','apps/server/task-cli.mjs','apps/mac-agent/cli.mjs','packages/control-protocol/index.mjs','packages/voice/src/audio.js','packages/voice/package-lock.json','apps/server/package-lock.json','apps/mac-agent/package-lock.json'])assert.ok(bundle.files.has(name),name);
 assert.match(bundle.files.get('apps/server/control-cli.mjs').toString(),/realpathSync/);
 assert.equal([...bundle.files.keys()].some(name=>/node_modules|\/test\/|\.env/u.test(name)),false);
 await assert.rejects(createBundle({root,revision:revision.slice(0,7)}),/full/u);
 assert.throws(()=>readBundle({bytes,sha256:'0'.repeat(64)}),/digest/u);
 const corrupted=Buffer.from(bytes);corrupted[20]^=1;
 assert.throws(()=>readBundle({bytes:corrupted,sha256:sha256(corrupted)}));
});
