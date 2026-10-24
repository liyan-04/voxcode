import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, chmod, readdir, rename, rm, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { preflight, checkedRuntimePaths } from '../preflight.mjs';

import { fixture } from './fixtures/environment.mjs';

test('preflight reports tools and existing HEAD without creating state or leaking configuration', async t => {
  const { env, project, privateDir } = await fixture(t);
  const before = await readdir(privateDir);
  const result = await preflight({ env });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result).sort(), ['checks', 'ok']);
  assert.equal(Object.isFrozen(checkedRuntimePaths(result)), true);
  assert.throws(() => checkedRuntimePaths({ ...result }));
  assert.match(result.checks.find(c => c.name === 'git').detail, /\d+\.\d+/);
  assert.match(result.checks.find(c => c.name === 'codex').detail, /0\.162\.1/);
  assert.match(result.checks.find(c => c.name === 'project').detail, /[a-f0-9]{40}/);
  assert.match(result.checks.find(c => c.name === 'linx').detail, /disabled/);
  assert.deepEqual(await readdir(privateDir), before);
  const printed = JSON.stringify(result);
  for (const secret of [env.VOXCODE_MACHINE_KEY, env.VOXCODE_MACHINE_ID, project, env.VOXCODE_RELAY_URL, env.VOXCODE_TLS_CA]) assert.equal(printed.includes(secret), false);
});

test('old Node and root are blocked without executing tools', async t => {
  const { env } = await fixture(t);
  for (const overrides of [{ nodeVersion: '20.19.0' }, { uid: 0 }]) {
    const result = await preflight({ env, ...overrides });
    assert.equal(result.ok, false);
    assert.throws(() => checkedRuntimePaths(result));
    assert.equal(result.checks.find(c => c.name === (overrides.uid === 0 ? 'user' : 'node')).status, 'blocked');
  }
});

test('missing tools and hostile version output are bounded and secret safe', async t => {
  const { env, bin } = await fixture(t);
  assert.equal((await preflight({ env: { ...env, PATH: '/missing-tools' } })).ok, false);
  for (const source of ['#!/bin/sh\nexit 1\n', '#!/bin/sh\nprintf "SECRET\\n"\n', '#!/bin/sh\nexec sleep 10\n']) {
    await writeFile(join(bin, 'codex'), source);
    const result = await preflight({ env, toolTimeoutMs: 40 });
    assert.equal(result.ok, false);
    assert.equal(result.checks.find(c => c.name === 'codex').status, 'blocked');
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }
});

test('requires an existing authorized repository HEAD and private writable data parent', async t => {
  const { env, dir, project, privateDir } = await fixture(t);
  const empty = join(dir, 'empty'); await mkdir(empty);
  execFileSync('git', ['init', '-q', empty]);
  for (const value of [undefined, 'relative', dir, empty]) {
    const result = await preflight({ env: { ...env, VOXCODE_PROJECT: value } });
    assert.equal(result.checks.find(c => c.name === 'project').status, 'blocked');
  }
  for (const value of [undefined, 'relative', join(dir, 'missing', 'state'), project]) {
    const result = await preflight({ env: { ...env, VOXCODE_DATA: value } });
    assert.equal(result.checks.find(c => c.name === 'data').status, 'blocked');
  }
  await chmod(privateDir, 0o755);
  assert.equal((await preflight({ env })).ok, false);
  await chmod(privateDir, 0o500);
  assert.equal((await preflight({ env })).ok, false);
  await chmod(privateDir, 0o700);
  await symlink(project, env.VOXCODE_DATA);
  assert.equal((await preflight({ env })).ok, false);
});

test('private state leaf is blocked beneath a replaceable writable ancestor', async t => {
  const { env, dir } = await fixture(t);
  const shared = join(dir, 'shared'), privateParent = join(shared, 'private');
  await mkdir(shared); await mkdir(privateParent, { mode: 0o700 });
  const configured = { ...env, VOXCODE_DATA: join(privateParent, 'state') };
  for (const mode of [0o777, 0o775, 0o1777]) {
    await chmod(shared, mode);
    const report = await preflight({ env: configured });
    assert.equal(report.checks.find(check => check.name === 'data').status, 'blocked', `unsafe ancestor mode ${mode.toString(8)}`);
    assert.equal(JSON.stringify(report).includes(shared), false);
  }
  await chmod(shared, 0o755);
  assert.equal((await preflight({ env: configured })).ok, true);
  // A private descendant alone does not protect its directory entry in a writable parent.
  await chmod(shared, 0o777); await rename(privateParent, `${privateParent}-moved`);
  await mkdir(privateParent, { mode: 0o700 });
  assert.equal((await preflight({ env: configured })).ok, false);
});

test('root owned sticky temporary ancestors allow a private owned state parent', async t => {
  const { env } = await fixture(t);
  const shared = process.platform === 'darwin' ? '/private/tmp' : '/tmp', info = await stat(shared);
  assert.equal(info.uid, 0);
  assert.notEqual(info.mode & 0o1000, 0);
  const privateParent = await mkdtemp(join(shared, 'vox-server-sticky-'));
  t.after(() => rm(privateParent, { recursive: true, force: true }));
  const report = await preflight({ env: { ...env, VOXCODE_DATA: join(privateParent, 'state') } });
  assert.equal(report.ok, true);
  assert.equal(report.checks.find(check => check.name === 'data').status, 'ok');
});

test('strict relay credentials, WSS route and valid public CA are required', async t => {
  const { env, dir } = await fixture(t);
  for (const value of [undefined, 'ws://127.0.0.1:9899/connector', 'wss://x.invalid/wrong', 'wss://user:SECRET@x.invalid/connector', 'wss://x.invalid/connector?secret=SECRET', 'invalid']) {
    const result = await preflight({ env: { ...env, VOXCODE_RELAY_URL: value } });
    assert.equal(result.checks.find(c => c.name === 'relay').status, 'blocked');
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }
  for (const patch of [{ VOXCODE_MACHINE_ID: '' }, { VOXCODE_MACHINE_KEY: 'weak' }, { VOXCODE_PORT: '0' }, { VOXCODE_PORT: '1.5' }, { VOXCODE_PORT: '65536' }]) assert.equal((await preflight({ env: { ...env, ...patch } })).ok, false);
  for (const value of [undefined, join(dir, 'missing'), join(dir, 'fixture.key')]) assert.equal((await preflight({ env: { ...env, VOXCODE_TLS_CA: value } })).ok, false);
  await writeFile(join(dir, 'invalid.pem'), 'SECRET');
  assert.equal((await preflight({ env: { ...env, VOXCODE_TLS_CA: join(dir, 'invalid.pem') } })).ok, false);
});

test('Linx is optional, complete inputs are configured only, and partial/invalid inputs fail', async t => {
  const { env } = await fixture(t);
  const linx = { LINX_TOKEN: 'SYNTHETIC_SECRET', LINX_DEVICE_ID: '02:00:00:00:00:01', LINX_CLIENT_ID: '00000000-0000-4000-8000-000000000001' };
  const good = await preflight({ env: { ...env, ...linx } });
  assert.equal(good.ok, true);
  assert.match(good.checks.find(c => c.name === 'linx').detail, /configured.*unverified/);
  for (const patch of [{ LINX_TOKEN: ' ' }, { LINX_TOKEN: 'SECRET' }, { LINX_WS_URL: 'wss://x.invalid/' }, { ...linx, LINX_TOKEN: 'SECRET token' }, { ...linx, LINX_DEVICE_ID: 'bad' }, { ...linx, LINX_CLIENT_ID: 'bad' }, { ...linx, LINX_WS_URL: 'http://x.invalid/' }]) {
    const result = await preflight({ env: { ...env, ...patch } });
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /SECRET|x\.invalid/);
  }
});
