import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectTools,prepareTools} from '../control/prepare-tools.mjs';

async function fixture(t){
 const base=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'control-tools-')));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const old=join(base,'legacy'),npmRoot=join(old,'npm'),node=join(old,'node');await fs.mkdir(old,{mode:0o775});await fs.chmod(old,0o775);await fs.mkdir(npmRoot,{mode:0o775});await fs.chmod(npmRoot,0o775);await fs.mkdir(join(npmRoot,'bin'));await fs.mkdir(join(npmRoot,'lib'));
 await fs.writeFile(node,'fixture approved Node executable',{mode:0o755});await fs.writeFile(join(npmRoot,'bin/npm-cli.js'),'fixture npm CLI',{mode:0o755});await fs.writeFile(join(npmRoot,'lib/entry.js'),'fixture npm dependency',{mode:0o644});
 return {base,old,node,npmRoot,destination:join(base,'owned-tools')};
}

test('tool preparation copies an explicitly reviewed legacy closure without global permission changes',async t=>{
 const f=await fixture(t),plan=await inspectTools({node:f.node,npmRoot:f.npmRoot}),before=(await fs.stat(f.npmRoot)).mode;
 const result=await prepareTools({plan,destination:f.destination});assert.equal(result.unchanged,false);
 assert.equal(await fs.readFile(join(f.destination,'node'),'utf8'),'fixture approved Node executable');assert.equal(await fs.readFile(join(f.destination,'npm/lib/entry.js'),'utf8'),'fixture npm dependency');
 assert.equal((await fs.stat(f.npmRoot)).mode,before);assert.equal((await fs.stat(join(f.destination,'npm'))).mode&0o022,0);
 assert.equal((await prepareTools({plan,destination:f.destination})).unchanged,true);
});

test('tool preparation dry-run and source digest failures cannot write destination',async t=>{
 const f=await fixture(t),plan=await inspectTools({node:f.node,npmRoot:f.npmRoot});assert.equal((await prepareTools({plan,destination:f.destination,dryRun:true})).dryRun,true);await assert.rejects(fs.stat(f.destination),{code:'ENOENT'});
 await fs.writeFile(join(f.npmRoot,'lib/entry.js'),'changed source');await assert.rejects(prepareTools({plan,destination:f.destination}),/digest/u);await assert.rejects(fs.stat(f.destination),{code:'ENOENT'});
});

test('tool preparation refuses unrelated destinations and linked npm closure entries',async t=>{
 const f=await fixture(t),plan=await inspectTools({node:f.node,npmRoot:f.npmRoot});await fs.mkdir(f.destination);await fs.writeFile(join(f.destination,'unrelated'),'retain');
 await assert.rejects(prepareTools({plan,destination:f.destination}));assert.equal(await fs.readFile(join(f.destination,'unrelated'),'utf8'),'retain');
 await fs.symlink(f.node,join(f.npmRoot,'lib/unsafe'));await assert.rejects(inspectTools({node:f.node,npmRoot:f.npmRoot}),/regular|link/u);
});
