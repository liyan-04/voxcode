import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildServerPackage, sourcePaths } from '../build-server-package.mjs';

const run = promisify(execFile), root = new URL('../../', import.meta.url).pathname;
async function repository(t) {
  const dir = await mkdtemp(join(tmpdir(), 'vox-server-package-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo'); await mkdir(repo);
  for (const file of sourcePaths) { await mkdir(join(repo, file, '..'), { recursive: true }); await cp(join(root, file), join(repo, file)); }
  await mkdir(join(repo, 'apps', 'server', 'test'), { recursive: true });
  for (const file of ['.env', 'apps/server/private.key', 'apps/server/test/state.json']) await writeFile(join(repo, file), 'SYNTHETIC_SECRET');
  await run('git', ['init', '-q', repo]);
  await run('git', ['-C', repo, 'add', '-f', '.']);
  await run('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture source']);
  const revision = (await run('git', ['-C', repo, 'rev-parse', 'HEAD'])).stdout.trim();
  return { dir, repo, revision, output: join(dir, 'server.tar.gz') };
}

test('packages exactly committed allowlisted sources and locks, excluding private/untracked state', async t => {
  const { dir, repo, revision, output } = await repository(t);
  await writeFile(join(repo, 'apps/server/cli.mjs'), 'UNCOMMITTED_SECRET');
  await buildServerPackage({ root: repo, output, revision });
  const listing = (await run('tar', ['-tzf', output])).stdout.trim().split('\n');
  const prefix = listing[0].split('/')[0];
  assert.equal(prefix, `voxcode-server-0.1.0-${revision.slice(0, 12)}`);
  assert.deepEqual(listing.map(file => file.slice(prefix.length + 1)).sort(), [...sourcePaths, 'manifest.json'].sort());
  assert.doesNotMatch(listing.join('\n'), /node_modules|\.git|private\.key|\.env|test\/state/);
  const unpack = join(dir, 'unpack'); await mkdir(unpack); await run('tar', ['-xzf', output, '-C', unpack]);
  const packageDir = join(unpack, prefix);
  assert.doesNotMatch(await readFile(join(packageDir, 'apps/server/cli.mjs'), 'utf8'), /UNCOMMITTED/);
  const manifest = JSON.parse(await readFile(join(packageDir, 'manifest.json')));
  assert.equal(manifest.revision, revision);
  assert.equal(manifest.dependencyMode, 'source-only-locked-manual-install');
  for (const file of ['package-lock.json', 'apps/relay/package-lock.json', 'packages/voice/package-lock.json']) assert.equal(await readFile(join(packageDir, file), 'utf8'), await readFile(join(root, file), 'utf8'));
});

test('archive revision and file bytes ignore local commit and blob replace objects', async t => {
  const { dir, repo, revision, output } = await repository(t);
  const path = 'apps/server/cli.mjs', original = await readFile(join(repo, path));
  const originalBlob = (await run('git', ['-C', repo, 'rev-parse', `${revision}:${path}`])).stdout.trim();
  await writeFile(join(repo, path), 'REPLACED_SOURCE_BYTES');
  await run('git', ['-C', repo, 'add', path]);
  await run('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'replacement source']);
  const replacement = (await run('git', ['-C', repo, 'rev-parse', 'HEAD'])).stdout.trim();
  const replacementBlob = (await run('git', ['-C', repo, 'rev-parse', `HEAD:${path}`])).stdout.trim();
  await run('git', ['-C', repo, 'replace', revision, replacement]);
  assert.equal((await run('git', ['-C', repo, 'show', `${revision}:${path}`])).stdout, 'REPLACED_SOURCE_BYTES');
  for (const kind of ['commit', 'blob']) {
    if (kind === 'blob') {
      await run('git', ['-C', repo, 'replace', '-d', revision]);
      await run('git', ['-C', repo, 'replace', originalBlob, replacementBlob]);
    }
    const built = await buildServerPackage({ root: repo, output: `${output}.${kind}`, revision });
    const content = (await run('tar', ['-xOzf', `${output}.${kind}`, `${built.name}/${path}`], { encoding: 'buffer' })).stdout;
    assert.equal(content.equals(original), true, `${kind} replacement must not change the recorded revision source`);
    const manifest = JSON.parse((await run('tar', ['-xOzf', `${output}.${kind}`, `${built.name}/manifest.json`])).stdout);
    assert.equal(manifest.revision, revision);
  }
});

test('refuses existing output, missing revision/files, unsafe paths and source symlinks', async t => {
  const { repo, output } = await repository(t);
  await writeFile(output, 'KEEP');
  await assert.rejects(buildServerPackage({ root: repo, output }), /existing output/i);
  assert.equal(await readFile(output, 'utf8'), 'KEEP'); await rm(output);
  await assert.rejects(buildServerPackage({ root: repo, output, revision: '--evil' }));
  await assert.rejects(buildServerPackage({ root: repo, output: join(repo, 'inside.tar.gz') }));
  await run('git', ['-C', repo, 'rm', 'apps/server/cli.mjs']);
  await run('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'missing']);
  await assert.rejects(buildServerPackage({ root: repo, output }));
  await run('ln', ['-s', '/etc/passwd', join(repo, 'apps/server/cli.mjs')]);
  await run('git', ['-C', repo, 'add', 'apps/server/cli.mjs']);
  await run('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'symlink']);
  await assert.rejects(buildServerPackage({ root: repo, output }), /regular source/i);
});

test('unpacked source installs exact locks manually then imports and starts the existing runtime', async t => {
  const { dir, repo, output } = await repository(t);
  await buildServerPackage({ root: repo, output });
  const unpack = join(dir, 'unpack'); await mkdir(unpack); await run('tar', ['-xzf', output, '-C', unpack]);
  const packageDir = join(unpack, (await readdir(unpack))[0]);
  // Reuse the cache populated by the checkout's manual npm ci; never contact the registry here.
  for (const prefix of ['.', 'apps/relay', 'packages/voice']) await run('npm', ['ci', '--ignore-scripts', '--offline', '--prefix', prefix], { cwd: packageDir });
  const source = `
    const {startRuntime} = await import(${JSON.stringify(pathToFileURL(join(packageDir, 'apps/integration/runtime.mjs')).href)});
    const runtime = await startRuntime({project:${JSON.stringify(repo)},dataDir:${JSON.stringify(join(dir, 'state'))},port:0});
    const origin='http://127.0.0.1:'+runtime.app.server.address().port;
    try { if((await fetch(origin+'/api/tasks')).status!==401) throw Error('Lost authorization'); console.log('source runtime fixture started'); }
    finally { await runtime.close(); }
  `;
  assert.match((await run(process.execPath, ['--input-type=module', '-e', source], { cwd: packageDir })).stdout, /fixture started/);
});

test('builder CLI has bounded usage and build failures', async () => {
  const cli = join(root, 'scripts/build-server-package.mjs');
  await assert.rejects(run(process.execPath, [cli]), error => error.code === 2 && /Usage:/.test(error.stderr));
  await assert.rejects(run(process.execPath, [cli, '--output', '/missing/PATH/secret', '--revision', 'SECRET']), error => error.code === 1 && !/SECRET/.test(error.stderr));
});
