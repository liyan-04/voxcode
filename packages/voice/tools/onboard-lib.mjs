import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import https from 'node:https';

export const OTA_URL = 'https://xrobo.qiniuapi.com/v1/ota/';
export const ACTIVATE_URL = 'https://xrobo.qiniuapi.com/v1/ota/activate';
export const WSS_URL = 'wss://xrobo-io.qiniuapi.com/v1/ws/';
const WS_URL = 'ws://xrobo-io.qiniuapi.com/v1/ws/';
const MAX_BODY = 64 * 1024;
const MESSAGES = {
  filesystem: 'Private configuration is unavailable or unsafe; check its ownership, permissions and paths.',
  identity: 'Private device identity is missing or invalid; it was not replaced.',
  exists: 'Private runtime configuration already exists; it was not replaced. Use status to inspect it.',
  configuration: 'Private runtime configuration is invalid; it was not replaced.',
  endpoint: 'Only the documented Linx endpoints are allowed.',
  timeout: 'Linx onboarding timed out; retry explicitly later.',
  transport: 'Linx onboarding request failed; retry explicitly later.',
  response: 'Linx returned an invalid or unsuccessful onboarding response.',
  usage: 'Usage: onboard.mjs init|status|activate --dir /absolute/private/directory [--show-code]',
  interactive: 'Activation code display requires activate --show-code with local interactive input and error output.',
};
class OnboardError extends Error {
  constructor(code) { super(MESSAGES[code]); this.code = code; }
}
function fail(code) { throw new OnboardError(code); }
async function guarded(action) {
  try { return await action(); } catch (error) {
    if (error instanceof OnboardError) throw error;
    throw new OnboardError('filesystem');
  }
}
function ownedPrivate(info, mode, directory = false) {
  return (directory ? info.isDirectory() : info.isFile() && info.nlink === 1)
    && info.uid === process.getuid() && (info.mode & 0o7777) === mode;
}
// Reject symlink ancestors too. Shared writable ancestors must have the sticky bit
// (for example /private/tmp); private files are confined to the owned 0700 leaf.
async function directoryPath(directory, create = false) {
  if (typeof directory !== 'string' || !directory.startsWith(sep) || directory.includes('\0')) fail('usage');
  const path = resolve(directory);
  let current = sep;
  for (const piece of path.split(sep).filter(Boolean)) {
    current = join(current, piece);
    let info;
    try { info = await lstat(current); } catch (error) {
      if (error.code !== 'ENOENT' || current !== path || !create) throw error;
      try { await mkdir(path, { mode: 0o700 }); } catch (mkdirError) {
        if (mkdirError.code !== 'EEXIST') throw mkdirError;
      }
      info = await lstat(path);
    }
    if (!info.isDirectory() || ![0, process.getuid()].includes(info.uid) || ((info.mode & 0o022) && !(info.mode & 0o1000))) fail('filesystem');
    if (current === path && !ownedPrivate(info, 0o700, true)) fail('filesystem');
  }
  if (path === sep) fail('filesystem');
  return path;
}
async function readPrivate(path, limit, optional = false) {
  let before;
  try { before = await lstat(path); } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw error;
  }
  if (!ownedPrivate(before, 0o600) || before.size > limit) fail('filesystem');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!ownedPrivate(info, 0o600) || info.dev !== before.dev || info.ino !== before.ino || info.size > limit) fail('filesystem');
    // Read one byte beyond the limit, even if a concurrent writer grows the file.
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit) fail('filesystem');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await file.close(); }
}
async function createPrivate(path, content) {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    if (!ownedPrivate(await file.stat(), 0o600)) fail('filesystem');
    await file.writeFile(content, 'utf8');
    await file.sync();
  } finally { await file.close(); }
}
async function identityAt(path) {
  let identity;
  try { identity = JSON.parse(await readPrivate(join(path, 'identity.json'), 2048)); } catch (error) {
    if (error instanceof OnboardError) throw error;
    fail('identity');
  }
  if (!identity || identity.version !== 1
      || typeof identity.deviceId !== 'string' || typeof identity.clientId !== 'string'
      || !/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(identity.deviceId)
      || (parseInt(identity.deviceId.slice(0, 2), 16) & 3) !== 2
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(identity.clientId)) fail('identity');
  return identity;
}
function validToken(token) {
  // A single dotenv-safe bearer token: no whitespace, quotes, escapes or expansion.
  return typeof token === 'string' && token.length <= 8192 && /^[A-Za-z0-9._~+/-]+=*$/.test(token);
}
async function configuredAt(path, identity) {
  const text = await readPrivate(join(path, '.env.linx'), MAX_BODY, true);
  if (text === null) return false;
  const match = /^LINX_WS_URL=([^\n]+)\nLINX_TOKEN=([^\n]+)\nLINX_DEVICE_ID=([^\n]+)\nLINX_CLIENT_ID=([^\n]+)\n$/.exec(text);
  if (!match || match[1] !== WSS_URL || !validToken(match[2])
      || match[3] !== identity.deviceId || match[4] !== identity.clientId) fail('configuration');
  return true;
}
export async function initialize({ directory } = {}) {
  return guarded(async () => {
    const path = await directoryPath(directory, true);
    if (await readPrivate(join(path, 'identity.json'), 2048, true) !== null) {
      await identityAt(path);
      return { state: 'initialized', created: false };
    }
    // An orphan runtime file must not be paired with a newly generated identity.
    if (await readPrivate(join(path, '.env.linx'), MAX_BODY, true) !== null) fail('exists');
    const mac = randomBytes(6);
    mac[0] = (mac[0] | 2) & 0xfe;
    const identity = { version: 1, deviceId: [...mac].map((byte) => byte.toString(16).padStart(2, '0')).join(':').toUpperCase(), clientId: randomUUID() };
    await directoryPath(directory);
    await createPrivate(join(path, 'identity.json'), `${JSON.stringify(identity)}\n`);
    return { state: 'initialized', created: true };
  });
}
export async function status({ directory } = {}) {
  return guarded(async () => {
    const path = await directoryPath(directory);
    const identity = await identityAt(path);
    return { state: await configuredAt(path, identity) ? 'configured' : 'unconfigured' };
  });
}

// No redirect support and no firmware handling. The deadline also covers the body.
export function httpsTransport({ url, headers, body, signal, maxResponseBytes = MAX_BODY, requestImpl = https.request }) {
  return new Promise((resolveReply, reject) => {
    if (url !== OTA_URL && url !== ACTIVATE_URL) { reject(new OnboardError('endpoint')); return; }
    const request = requestImpl(url, { method: 'POST', headers, signal }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxResponseBytes) { reject(new OnboardError('response')); response.destroy(); }
        else chunks.push(chunk);
      });
      response.on('error', () => reject(new OnboardError('transport')));
      response.on('end', () => resolveReply({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', () => reject(new OnboardError('transport')));
    request.end(body);
  });
}
async function requestReply(transport, url, headers, body, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    const reply = await Promise.race([
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new OnboardError('timeout')); }, timeoutMs); }),
      Promise.resolve().then(() => transport({ url, headers, body, signal: controller.signal, maxResponseBytes: MAX_BODY })),
    ]);
    if (!reply || typeof reply.body !== 'string' || Buffer.byteLength(reply.body) > MAX_BODY || !Number.isInteger(reply.status)) fail('response');
    return reply;
  } catch (error) {
    if (controller.signal.aborted) fail('timeout');
    // Transport errors may contain private headers/body; never propagate them.
    if (error instanceof OnboardError && error.code === 'response') throw error;
    fail('transport');
  } finally { clearTimeout(timer); }
}
function otaPayload(identity) {
  return JSON.stringify({ version: 0, uuid: identity.clientId,
    application: { name: 'xiaoling-web-test', version: '1.0.0', elf_sha256: createHash('sha256').update('voxcode-software-device/1.0.0').digest('hex') },
    ota: { label: 'xiaoling-web-test' },
    board: { type: 'xiaoling-web-test', ssid: '', rssi: 0, channel: 0, ip: '0.0.0.0', mac: identity.deviceId },
    flash_size: 0, minimum_free_heap_size: 0, mac_address: identity.deviceId, chip_model_name: '',
    chip_info: { model: 0, cores: 0, revision: 0, features: 0 }, partition_table: [] });
}
export async function activate({ directory, transport = httpsTransport, timeoutMs = 10000, otaUrl = OTA_URL, activateUrl = ACTIVATE_URL, onActivationCode } = {}) {
  return guarded(async () => {
    if (otaUrl !== OTA_URL || activateUrl !== ACTIVATE_URL) fail('endpoint');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) fail('usage');
    const path = await directoryPath(directory);
    const identity = await identityAt(path);
    if (await configuredAt(path, identity)) fail('exists');
    const check = await requestReply(transport, activateUrl, { 'Device-Id': identity.deviceId }, undefined, timeoutMs);
    if (!((check.status === 202 && check.body === '') || (check.status === 200 && check.body.trim() === 'success'))) fail('response');
    const reply = await requestReply(transport, otaUrl, {
      'Activation-Version': '1', 'Device-Id': identity.deviceId, 'Client-Id': identity.clientId,
      'User-Agent': 'xiaoling-web-test/1.0.0', 'Accept-Language': 'zh-CN', 'Content-Type': 'application/json',
    }, otaPayload(identity), timeoutMs);
    if (reply.status !== 200) fail('response');
    let data;
    try { data = JSON.parse(reply.body); } catch { fail('response'); }
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.hasOwn(data, 'error')) fail('response');
    const ws = data.websocket;
    if (Object.hasOwn(data, 'websocket') && (!ws || typeof ws !== 'object' || Array.isArray(ws))) fail('response');
    if (Object.hasOwn(data, 'activation') && (!data.activation || typeof data.activation !== 'object' || Array.isArray(data.activation))) fail('response');
    if (ws && ws.url !== WSS_URL && ws.url !== WS_URL) fail('endpoint');
    if (ws && Object.hasOwn(ws, 'token')) {
      if (!validToken(ws.token) || ![WSS_URL, WS_URL].includes(ws.url) || data.activation !== undefined) fail('response');
      await directoryPath(directory);
      const sameIdentity = await identityAt(path);
      if (sameIdentity.deviceId !== identity.deviceId || sameIdentity.clientId !== identity.clientId) fail('identity');
      await createPrivate(join(path, '.env.linx'), `LINX_WS_URL=${WSS_URL}\nLINX_TOKEN=${ws.token}\nLINX_DEVICE_ID=${identity.deviceId}\nLINX_CLIENT_ID=${identity.clientId}\n`);
      return { state: 'configured', saved: true };
    }
    if (check.status !== 202 || typeof data.activation?.code !== 'string' || !/^\d{6}$/.test(data.activation.code)) fail('response');
    if (onActivationCode) await onActivationCode(data.activation.code);
    return { state: 'pending', codeAvailable: true };
  });
}

export async function runCLI(args, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, transport } = {}) {
  try {
    const [command, ...options] = args;
    if (!['init', 'status', 'activate'].includes(command)) fail('usage');
    let directory;
    let showCode = false;
    for (let index = 0; index < options.length; index += 1) {
      if (options[index] === '--dir' && directory === undefined && options[index + 1] && !options[index + 1].startsWith('--')) directory = options[++index];
      else if (options[index] === '--show-code' && !showCode) showCode = true;
      else fail('usage');
    }
    if (!directory) fail('usage');
    if (showCode && (command !== 'activate' || !stdin.isTTY || !stderr.isTTY)) fail('interactive');
    const result = command === 'init' ? await initialize({ directory })
      : command === 'status' ? await status({ directory })
        : await activate({ directory, transport, onActivationCode: showCode ? (code) => stderr.write(`Local activation code: ${code}\nBind it in your own Linx console, then rerun activate. Keep this terminal private.\n`) : undefined });
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof OnboardError ? error.code : 'filesystem';
    stderr.write(`Linx onboarding: ${MESSAGES[code]}\n`);
    return 1;
  }
}
