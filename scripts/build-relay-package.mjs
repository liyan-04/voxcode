import {cp, mkdir, mkdtemp, readFile, rm, writeFile, chmod} from 'node:fs/promises';
import {join, resolve, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const relay = join(root, 'apps', 'relay');
const packageJson = JSON.parse(await readFile(join(relay, 'package.json'), 'utf8'));
const version = packageJson.version;
const packageName = `voxcode-relay-${version}`;
const index = process.argv.indexOf('--output');
const outputArg = index === -1 ? undefined : process.argv[index + 1];
if (!outputArg || process.argv.includes('--help')) {
  console.error('Usage: node scripts/build-relay-package.mjs --output PATH');
  process.exit(2);
}
const output = resolve(outputArg);
const stageRoot = await mkdtemp(join(tmpdir(), 'voxcode-relay-build-'));
const stage = join(stageRoot, packageName);

try {
  for (const dir of ['app', 'bin', 'templates', 'systemd']) await mkdir(join(stage, dir), {recursive: true, mode: 0o755});
  for (const file of ['connector-cli.mjs', 'connector.mjs', 'protocol.mjs', 'relay-cli.mjs', 'relay.mjs', 'package.json', 'package-lock.json']) await cp(join(relay, file), join(stage, 'app', file));
  await cp(join(relay, 'node_modules', 'ws'), join(stage, 'app', 'node_modules', 'ws'), {recursive: true});
  for (const file of ['install.sh', 'README.md']) await cp(join(relay, 'packaging', file), join(stage, file));
  for (const file of ['start-relay', 'start-connector', 'status', 'stop']) await cp(join(relay, 'packaging', 'bin', file), join(stage, 'bin', file));
  for (const file of ['relay.env.example', 'connector.env.example']) await cp(join(relay, 'packaging', 'templates', file), join(stage, 'templates', file));
  for (const file of ['voxcode-relay.service', 'voxcode-connector.service']) await cp(join(relay, 'packaging', 'systemd', file), join(stage, 'systemd', file));
  const manifest = {name: 'voxcode-relay', version, node: packageJson.engines?.node ?? '>=22', dependencyMode: 'bundled-ws', roles: ['relay', 'connector']};
  await writeFile(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {mode: 0o644});
  for (const file of ['install.sh', 'bin/start-relay', 'bin/start-connector', 'bin/status', 'bin/stop']) await chmod(join(stage, file), 0o755);
  await mkdir(dirname(output), {recursive: true});
  try { await readFile(output); throw new Error(`Refusing to overwrite existing output: ${output}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await run('tar', ['-czf', output, '-C', stageRoot, packageName]);
  console.log(`Created ${output}`);
} finally {
  await rm(stageRoot, {recursive: true, force: true});
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {stdio: 'inherit'});
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`)));
  });
}
