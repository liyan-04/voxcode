import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, lstat, readFile, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { credentials } from '../relay/protocol.mjs';

const execute = promisify(execFile);
const checkedPaths = new WeakMap();
const required = value => typeof value === 'string' && value.trim().length > 0;
const within = (parent, child) => { const path = relative(parent, child); return !path || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)); };
const absolute = value => { if (!required(value) || !isAbsolute(value)) throw new Error('Absolute path required'); return resolve(value); };
const probeEnv = env => Object.fromEntries(Object.entries(env).filter(([key]) => !/^(GIT|VOXCODE|LINX)_/i.test(key)));

// Private launch data stays out of report JSON, object spreading and ordinary logs.
export function checkedRuntimePaths(report) {
  const paths = checkedPaths.get(report);
  if (!report.ok || !paths) throw new Error('Successful path preflight required');
  return paths;
}

export function relayOptions(env) {
  credentials(env.VOXCODE_MACHINE_ID, env.VOXCODE_MACHINE_KEY);
  const url = new URL(env.VOXCODE_RELAY_URL);
  if (url.protocol !== 'wss:' || url.pathname !== '/connector' || url.username || url.password || url.search || url.hash) throw new Error('Strict WSS connector required');
  return { relayURL: url.href, machineId: env.VOXCODE_MACHINE_ID, machineKey: env.VOXCODE_MACHINE_KEY };
}

export function voiceOptions(env) {
  const fields = ['LINX_TOKEN', 'LINX_DEVICE_ID', 'LINX_CLIENT_ID'];
  if (![...fields, 'LINX_WS_URL'].some(key => typeof env[key] === 'string' && env[key].length)) return null;
  if (!fields.every(key => required(env[key]))) throw new Error('Incomplete Linx configuration');
  if (/[\s\x00-\x1f\x7f]/u.test(env.LINX_TOKEN) || !/^([\da-f]{2}:){5}[\da-f]{2}$/iu.test(env.LINX_DEVICE_ID)
    || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu.test(env.LINX_CLIENT_ID)) throw new Error('Invalid Linx configuration');
  const url = new URL(env.LINX_WS_URL ?? 'wss://xrobo-io.qiniuapi.com/v1/ws/');
  if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash) throw new Error('Strict Linx WSS required');
  return { url: url.href, token: env.LINX_TOKEN, deviceId: env.LINX_DEVICE_ID, clientId: env.LINX_CLIENT_ID };
}

export function bridgePort(env) {
  const value = env.VOXCODE_PORT ?? '8787';
  if (!/^\d+$/u.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error('Invalid bridge port');
  return Number(value);
}

export async function readCA(env) {
  const path = absolute(env.VOXCODE_TLS_CA);
  const info = await stat(path);
  if (!info.isFile() || info.size > 1024 * 1024) throw new Error('Invalid CA file');
  const ca = await readFile(path);
  if (ca.includes('PRIVATE KEY') || !new X509Certificate(ca).ca) throw new Error('Public CA certificate required');
  return ca;
}

export async function preflight({ env = process.env, nodeVersion = process.versions.node, uid = process.getuid?.(), toolTimeoutMs = 3000 } = {}) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });
  const check = async (name, fn, failure) => { try { add(name, 'ok', await fn()); } catch { add(name, 'blocked', failure); } };
  add('node', Number(nodeVersion.split('.')[0]) >= 22 ? 'ok' : 'blocked', 'Node >=22 required');
  add('user', typeof uid === 'number' && uid !== 0 ? 'ok' : 'blocked', 'Dedicated ordinary execution user required; root is refused');
  if (checks.some(item => item.status === 'blocked')) return { ok: false, checks };
  const run = async (command, args) => (await execute(command, args, { env: probeEnv(env), encoding: 'utf8', timeout: toolTimeoutMs, killSignal: 'SIGKILL', maxBuffer: 4096 })).stdout.trim();
  for (const tool of ['git', 'codex']) await check(tool, async () => {
    const output = await run(tool, ['--version']);
    const version = output.match(tool === 'git' ? /^git version (\d+\.\d+(?:\.\d+)?)/u : /^codex(?:-cli)? (\d+\.\d+(?:\.\d+)?)/u)?.[1];
    if (!version) throw new Error('Unrecognized version');
    return `${tool} ${version.slice(0, 64)} present; authentication/model execution unverified`;
  }, `${tool} missing, failed, timed out or version unrecognized`);
  let project, dataDir;
  await check('project', async () => {
    project = await realpath(absolute(env.VOXCODE_PROJECT));
    const top = await run('git', ['-C', project, 'rev-parse', '--show-toplevel']);
    if (await realpath(top) !== project) throw new Error('Select checkout root');
    const head = await run('git', ['-C', project, 'rev-parse', '--verify', 'HEAD^{commit}']);
    if (!/^[\da-f]{40,64}$/u.test(head)) throw new Error('Missing HEAD');
    return `Existing authorized checkout HEAD ${head}; authorization is operator supplied`;
  }, 'Set VOXCODE_PROJECT to an authorized existing Git checkout root with HEAD');
  await check('data', async () => {
    const input = absolute(env.VOXCODE_DATA), parent = await realpath(dirname(input)), data = join(parent, basename(input));
    for (const path of [parent, data]) {
      let info;
      try { info = await lstat(path); } catch (error) { if (error.code === 'ENOENT' && path === data) continue; throw error; }
      if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== uid || (info.mode & 0o077) || (info.mode & 0o700) !== 0o700) throw new Error('Private owned writable directory required');
      await access(path, constants.W_OK | constants.X_OK);
    }
    // Protect directory entries too: a private leaf can be renamed from a shared ancestor.
    for (let ancestor = dirname(parent); ; ancestor = dirname(ancestor)) {
      const info = await lstat(ancestor), rootSticky = info.uid === 0 && (info.mode & 0o1000) !== 0;
      if (!info.isDirectory() || (info.uid !== 0 && info.uid !== uid) || ((info.mode & 0o022) && !rootSticky)) throw new Error('Untrusted writable data ancestor');
      if (ancestor === dirname(ancestor)) break;
    }
    if (project && (within(project, parent) || within(project, data) || within(data, project))) throw new Error('State must be separate from project');
    dataDir = data;
    return 'Private owned writable data parent exists; no files created';
  }, 'Set VOXCODE_DATA outside the project with a private owned writable parent (0700) and trusted ancestors');
  await check('relay', async () => { relayOptions(env); return 'Strict WSS connector and machine credentials configured; connectivity unverified'; }, 'Configure valid VOXCODE_RELAY_URL (WSS /connector), MACHINE_ID and strong MACHINE_KEY');
  await check('tls', async () => { await readCA(env); return 'Public CA certificate readable; server trust/hostname/connectivity unverified'; }, 'Set VOXCODE_TLS_CA to a readable public CA PEM file without a private key');
  await check('port', async () => { bridgePort(env); return 'Loopback bridge port configured; check port availability separately'; }, 'VOXCODE_PORT must be an integer from 1 to 65535');
  await check('linx', async () => voiceOptions(env) ? 'Linx configured; onboarding/authentication/live audio unverified' : 'Linx disabled; no credential inputs configured', 'Set all three LINX credential fields with a valid WSS endpoint, or omit all Linx inputs');
  const report = { ok: checks.every(item => item.status === 'ok'), checks };
  if (report.ok) checkedPaths.set(report, Object.freeze({ project, dataDir }));
  return report;
}
