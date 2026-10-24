import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const run = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
// Exact files only: adding a runtime import requires updating and reviewing this list.
export const sourcePaths = [
  'package.json', 'package-lock.json',
  'apps/server/cli.mjs', 'apps/server/preflight.mjs', 'apps/server/README.md',
  'apps/integration/runtime.mjs', 'apps/integration/cli.mjs', 'apps/integration/voice.mjs', 'apps/integration/voice-tools.mjs', 'apps/integration/README.md',
  'apps/mac/cli.mjs', 'apps/mac/server.mjs', 'apps/mac/service.mjs', 'apps/mac/codex.mjs', 'apps/mac/evidence.mjs', 'apps/mac/recover.mjs', 'apps/mac/package.json', 'apps/mac/README.md',
  'apps/relay/relay-cli.mjs', 'apps/relay/connector-cli.mjs', 'apps/relay/relay.mjs', 'apps/relay/connector.mjs', 'apps/relay/monitor.mjs', 'apps/relay/protocol.mjs', 'apps/relay/package.json', 'apps/relay/package-lock.json', 'apps/relay/README.md',
  'packages/voice/src/index.js', 'packages/voice/src/audio.js', 'packages/voice/package.json', 'packages/voice/package-lock.json', 'packages/voice/README.md',
  'scripts/build-server-package.mjs',
];

export async function buildServerPackage({ root = repositoryRoot, output, revision = 'HEAD' }) {
  if (typeof output !== 'string' || !output || typeof revision !== 'string' || !revision || revision.startsWith('-')) throw new Error('Output and Git revision required');
  root = await realpath(root); output = resolve(output);
  let parent = dirname(output);
  const tail = [basename(output)];
  while (true) {
    try { output = join(await realpath(parent), ...tail.reverse()); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; tail.push(basename(parent)); parent = dirname(parent); }
  }
  const target = relative(root, output);
  if (!target.startsWith(`..${sep}`) && !isAbsolute(target)) throw new Error('Output must be outside source checkout');
  try { await lstat(output); throw new Error('Refusing existing output'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const git = async args => (await run('git', ['--no-replace-objects', '-C', root, ...args], { encoding: 'buffer', timeout: 10000, maxBuffer: 16 * 1024 * 1024,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GIT|VOXCODE|LINX)_/iu.test(key))) })).stdout;
  const sha = (await git(['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`])).toString().trim();
  if (!/^[\da-f]{40,64}$/u.test(sha)) throw new Error('Invalid Git revision');
  const files = new Map(), hashes = {};
  for (const path of sourcePaths) {
    if (!/^[A-Za-z0-9_./-]+$/u.test(path) || path.split('/').some(part => !part || part === '.' || part === '..') || isAbsolute(path)) throw new Error('Unsafe archive path');
    const entry = (await git(['ls-tree', sha, '--', path])).toString();
    if (!/^100644 blob [\da-f]+\t/u.test(entry) && !/^100755 blob [\da-f]+\t/u.test(entry)) throw new Error('Required regular source file missing');
    const content = await git(['show', `${sha}:${path}`]);
    files.set(path, content); hashes[path] = createHash('sha256').update(content).digest('hex');
  }
  const pkg = JSON.parse(files.get('package.json'));
  if (!/^\d+\.\d+\.\d+$/u.test(pkg.version)) throw new Error('Unsafe package version');
  const name = `voxcode-server-${pkg.version}-${sha.slice(0, 12)}`;
  const stageRoot = await mkdtemp(join(tmpdir(), 'vox-server-source-')), stage = join(stageRoot, name);
  try {
    for (const [path, content] of files) { await mkdir(dirname(join(stage, path)), { recursive: true }); await writeFile(join(stage, path), content, { mode: 0o644 }); }
    await writeFile(join(stage, 'manifest.json'), `${JSON.stringify({ name: 'voxcode-server', version: pkg.version, revision: sha, node: '>=22', dependencyMode: 'source-only-locked-manual-install', files: hashes }, null, 2)}\n`);
    const archive = join(stageRoot, 'source.tar.gz');
    await run('tar', ['-czf', archive, '-C', stageRoot, ...[...files.keys(), 'manifest.json'].map(path => `${name}/${path}`)], { timeout: 30000 });
    await mkdir(dirname(output), { recursive: true });
    await copyFile(archive, output, constants.COPYFILE_EXCL);
    return { output, revision: sha, name };
  } finally { await rm(stageRoot, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (![2, 4].includes(args.length) || args[0] !== '--output' || !args[1] || (args.length === 4 && (args[2] !== '--revision' || !args[3]))) {
    console.error('Usage: node scripts/build-server-package.mjs --output /outside/checkout/package.tar.gz [--revision COMMIT]'); process.exitCode = 2;
  } else {
    try { const result = await buildServerPackage({ output: args[1], revision: args[3] }); console.log(`Server source bundle created from Git revision ${result.revision}`); }
    catch { console.error('Server source bundle failed; check revision, required committed regular sources and unused output outside checkout'); process.exitCode = 1; }
  }
}
