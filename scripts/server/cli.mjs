#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packageServer } from './package.mjs';
import { decodeBundle, revision, safeRoot, sha256 } from './bundle.mjs';

const run = promisify(execFile), checkout = fileURLToPath(new URL('../../', import.meta.url));
const quote = text => `'${text.replaceAll("'", "'\\''")}'`;
const prepareRootScript = `const fs=require('node:fs'),p=require('node:path'),root=process.argv[1];
if(process.getuid()!==0||fs.realpathSync(root)!==root)throw Error('Untrusted deployment root');
for(let x=root;x!=='/';x=p.dirname(x)){const s=fs.lstatSync(x);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&18))throw Error('Untrusted deployment directory');}
for(const name of ['incoming','admin']){const x=p.join(root,name);if(!fs.existsSync(x))fs.mkdirSync(x,{mode:448});const s=fs.lstatSync(x);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&63))throw Error('Untrusted management directory');}`;
const usage = 'Usage: node scripts/server/cli.mjs package --revision HEX --output /outside/server.tar.gz [--source ROOT]\n       node scripts/server/cli.mjs upload|deploy|rollback|start|stop|restart|status|logs --host HOST [--archive FILE] [--revision HEX] [--root /opt/voxcode] [--identity KEY] [--known-hosts FILE] [--offline] [--password-file FILE]';
export function parseArgs(args) {
  const [command, ...rest] = args;
  if (!['package', 'upload', 'deploy', 'rollback', 'start', 'stop', 'restart', 'status', 'logs'].includes(command)) throw Error(usage);
  const options = { command };
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (key === '--offline') { if (options.offline) throw Error('Duplicate option'); options.offline = true; continue; }
    if (!['--revision', '--output', '--source', '--host', '--archive', '--root', '--identity', '--known-hosts', '--password-file'].includes(key) || i + 1 >= rest.length) throw Error(usage);
    const name = key.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    if (options[name] !== undefined) throw Error('Duplicate option');
    options[name] = rest[++i];
  }
  if (options.revision) revision(options.revision);
  if (command === 'package') { if (!options.revision || !options.output) throw Error(usage); return options; }
  safeRoot(options.root ?? '/opt/voxcode');
  if (!options.host || !/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)$/u.test(options.host) || options.host.includes('..')) throw Error('Invalid SSH hostname');
  if (options.passwordFile && (options.host !== '100.100.81.209' || (options.root && options.root !== '/opt/voxcode'))) throw Error('Password transport is restricted to fixed vm6 /opt/voxcode');
  if (options.passwordFile && options.identity) throw Error('Choose password or key/agent transport');
  if (['upload', 'deploy'].includes(command) && !options.archive && !(command === 'deploy' && options.revision)) throw Error('Archive or previously uploaded revision required');
  if (options.offline && command !== 'deploy') throw Error('--offline applies only to deploy');
  return options;
}
async function privateFile(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) throw Error('Credential file must be private, owned and regular');
  return realpath(path);
}
export async function transport(options, exec = run) {
  const common = ['-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3'];
  if (options.knownHosts) {
    const knownHosts = await realpath(options.knownHosts);
    if (!/^[A-Za-z0-9_./ -]+$/u.test(knownHosts)) throw Error('Unsupported known-hosts path');
    common.push('-o', `UserKnownHostsFile=${knownHosts}`);
  }
  if (options.identity) common.push('-i', await privateFile(options.identity), '-o', 'IdentitiesOnly=yes');
  if (!options.passwordFile) common.push('-o', 'BatchMode=yes');
  const target = `root@${options.host}`, password = options.passwordFile ? await privateFile(options.passwordFile) : null;
  const call = async (program, args) => {
    const result = password
      ? await exec('expect', [fileURLToPath(new URL('./vm6-password.exp', import.meta.url)), password, program, ...args], { timeout: 300000, maxBuffer: 256 * 1024 })
      : await exec(program, args, { timeout: 300000, maxBuffer: 256 * 1024 });
    return result.stdout;
  };
  return {
    ssh: command => call('ssh', [...common, '--', target, command]),
    copy: (source, path) => call('scp', [...common, '--', source, `${target}:${path}`]),
  };
}
export async function runCli(options, exec = run) {
  if (options.command === 'package') return packageServer({ root: options.source ?? checkout, output: options.output, revision: options.revision, verifyGit:true });
  const root = safeRoot(options.root ?? '/opt/voxcode'), connection = await transport(options, exec);
  // Host keys must be enrolled and reviewed separately. These commands never
  // change users, firewall, existing services, config, state or host keys.
  const uid = (await connection.ssh('id -u')).trim();
  if (uid !== '0') throw Error('SSH management identity must be root; runtime identity is voxcode');
  await connection.ssh(`/usr/bin/node -e ${quote(prepareRootScript)} ${quote(root)}`);
  if (options.archive) {
    const archive = await realpath(options.archive), stat = await lstat(options.archive);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024) throw Error('Invalid local archive');
    const bytes = await readFile(archive), parsed = decodeBundle(bytes);
    if (options.revision && options.revision !== parsed.manifest.revision) throw Error('Local revision mismatch');
    options = { ...options, revision: parsed.manifest.revision, sha256: sha256(bytes) };
    const destination = join(root, 'incoming', `${options.revision}.tar.gz`), temporary = `${destination}.${randomBytes(8).toString('hex')}.upload`;
    await connection.copy(archive, temporary);
    // sha256sum's input name and expected digest are generated safe values.
    await connection.ssh(`printf '%s  %s\n' ${quote(options.sha256)} ${quote(temporary)} | sha256sum --check --status && mv -f -- ${quote(temporary)} ${quote(destination)}`);
  }
  if (options.command === 'upload') return { uploaded: options.revision, sha256: options.sha256 };
  if (options.command === 'deploy' && !options.sha256) {
    const digest = (await connection.ssh(`sha256sum -- ${quote(join(root, 'incoming', `${revision(options.revision)}.tar.gz`))}`)).trim().split(/\s+/u)[0];
    if (!/^[a-f0-9]{64}$/u.test(digest)) throw Error('Cannot read uploaded checksum');
    options = { ...options, sha256: digest };
  }
  const management = join(root, 'admin', randomBytes(16).toString('hex'));
  await connection.ssh(`install -d -m 0700 -- ${quote(join(management, 'scripts/server'))} ${quote(join(management, 'apps/server/deploy'))}`);
  for (const name of ['bundle.mjs', 'remote.mjs']) await connection.copy(fileURLToPath(new URL(`./${name}`, import.meta.url)), join(management, 'scripts/server', name));
  for(const name of ['voxcode.service','voxcode-task.service'])await connection.copy(join(checkout,'apps/server/deploy',name),join(management,'apps/server/deploy',name));
  const payload = Buffer.from(JSON.stringify({ command: options.command, root, revision: options.revision, sha256: options.sha256, offline: options.offline === true,
    ...(options.command === 'deploy' ? { archive: join(root, 'incoming', `${options.revision}.tar.gz`) } : {}) })).toString('base64url');
  const output = await connection.ssh(`/usr/bin/node ${quote(join(management, 'scripts/server/remote.mjs'))} ${quote(payload)}`);
  return JSON.parse(output.trim().split('\n').at(-1));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await runCli(parseArgs(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(`VoxCode server command failed: ${error.message}`); process.exitCode = 1; }
}
