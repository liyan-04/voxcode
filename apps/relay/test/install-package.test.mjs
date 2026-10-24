import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, stat, rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const run = promisify(execFile);
const root = new URL('../../..', import.meta.url).pathname;
const builder = join(root, 'scripts', 'build-relay-package.mjs');

async function buildFixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'voxcode-relay-package-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const output = join(dir, 'voxcode-relay.tar.gz');
  await run(process.execPath, [builder, '--output', output], {cwd: root});
  const unpack = join(dir, 'unpack');
  await run('mkdir', ['-p', unpack]);
  await run('tar', ['-xzf', output, '-C', unpack]);
  const entries = await readdir(unpack);
  assert.equal(entries.length, 1);
  return {dir, packageDir: join(unpack, entries[0])};
}

test('builds a self-contained relay package without secrets or dependencies', async t => {
  const {packageDir} = await buildFixture(t);
  const manifest = JSON.parse(await readFile(join(packageDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.name, 'voxcode-relay');
  assert.match(manifest.version, /^0\.1\.0$/);
  for (const file of [
    'install.sh',
    'README.md',
    'app/relay-cli.mjs',
    'app/connector-cli.mjs',
    'app/package-lock.json',
    'templates/relay.env.example',
    'templates/connector.env.example',
    'bin/start-relay',
    'bin/start-connector',
    'bin/status',
    'bin/stop',
  ]) await stat(join(packageDir, file));
  await stat(join(packageDir, 'app', 'node_modules', 'ws', 'index.js'));
  const all = JSON.stringify(await readdir(packageDir, {recursive: true}));
  assert.doesNotMatch(all, /\.key$|\.pem$|\.env$/);
});

test('installs a role into a new private prefix and refuses overwrite', async t => {
  const {packageDir, dir} = await buildFixture(t);
  const prefix = join(dir, 'install');
  await run('bash', [join(packageDir, 'install.sh'), '--role', 'relay', '--prefix', prefix, '--skip-deps'], {cwd: packageDir});
  assert.equal(await readFile(join(prefix, 'config', 'relay.env'), 'utf8'), await readFile(join(packageDir, 'templates', 'relay.env.example'), 'utf8'));
  assert.equal((await stat(join(prefix, 'config', 'relay.env'))).mode & 0o777, 0o600);
  assert.equal((await stat(join(prefix, 'bin', 'start-relay'))).mode & 0o111, 0o111);
  await assert.rejects(
    run('bash', [join(packageDir, 'install.sh'), '--role', 'relay', '--prefix', prefix, '--skip-deps'], {cwd: packageDir}),
    error => error.code === 1 && /Refusing to overwrite existing prefix/i.test(error.stderr ?? ''),
  );
});

test('installs connector role without creating relay config', async t => {
  const {packageDir, dir} = await buildFixture(t);
  const prefix = join(dir, 'connector');
  await run('bash', [join(packageDir, 'install.sh'), '--role', 'connector', '--prefix', prefix, '--skip-deps'], {cwd: packageDir});
  await stat(join(prefix, 'config', 'connector.env'));
  assert.equal(await stat(join(prefix, 'config', 'relay.env')).catch(() => null), null);
  assert.equal(await stat(join(prefix, 'bin', 'start-connector')).then(() => true), true);
});

test('all shell entrypoints pass bash syntax checks', async t => {
  const {packageDir} = await buildFixture(t);
  const scripts = ['install.sh', 'bin/start-relay', 'bin/start-connector', 'bin/status', 'bin/stop'];
  for (const script of scripts) await run('bash', ['-n', join(packageDir, script)]);
});
