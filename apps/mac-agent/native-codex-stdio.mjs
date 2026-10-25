import {spawn, execFile} from 'node:child_process';
import {createInterface} from 'node:readline';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {readFile, realpath} from 'node:fs/promises';
import {isAbsolute} from 'node:path';

const execFileAsync = promisify(execFile);
const READ_METHODS = new Set([
  'project/list', 'project/read', 'thread/list', 'thread/read',
  'thread/turns/list', 'thread/items/list', 'thread/loaded/list',
]);
const SNAPSHOT_ARGS = [
  '-c', 'cli_auth_credentials_store="file"',
  '-c', 'analytics.enabled=false',
  '--disable', 'code_mode_host',
  'app-server', '--listen', 'stdio://',
];

function error(code, message) {
  return Object.assign(new Error(message), {code});
}

function validatePath(value, name) {
  if (typeof value !== 'string' || !isAbsolute(value)) throw error('configuration', `${name} must be an absolute path`);
}

async function executableIdentity(executable, expectedSha256, expectedVersion, environment, cwd) {
  validatePath(executable, 'executable');
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw error('configuration', 'expectedSha256 must be a SHA-256 digest');
  const bytes = await readFile(executable).catch(() => { throw error('configuration', 'Native Codex executable is unavailable'); });
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expectedSha256) throw error('version_mismatch', 'Native Codex executable digest changed');
  let version;
  try {
    const result = await execFileAsync(executable, ['--version'], {cwd, env: environment, timeout: 10000, maxBuffer: 64 * 1024});
    version = String(result.stdout).trim().split(/\s+/).at(-1);
  } catch {
    throw error('version_mismatch', 'Native Codex executable version probe failed');
  }
  if (expectedVersion && version !== expectedVersion) throw error('version_mismatch', 'Native Codex executable version changed');
  return {version, sha256, executable: await realpath(executable)};
}

export async function openNativeCodexSnapshot({
  executable,
  codexHome,
  cwd,
  expectedSha256,
  expectedVersion,
  timeoutMs = 30000,
  maxFrameBytes = 1024 * 1024,
  pageSize = 100,
} = {}) {
  validatePath(codexHome, 'codexHome');
  validatePath(cwd, 'cwd');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 120000) throw error('configuration', 'Native Codex timeout is invalid');
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1024 || maxFrameBytes > 8 * 1024 * 1024) throw error('configuration', 'Native Codex frame limit is invalid');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw error('configuration', 'Native Codex page size is invalid');
  const environment = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    CODEX_HOME: codexHome,
    TMPDIR: codexHome,
    RUST_LOG: 'off',
  };
  const identity = await executableIdentity(executable, expectedSha256, expectedVersion, environment, cwd);
  const child = spawn(identity.executable, SNAPSHOT_ARGS, {
    cwd,
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let closed = false;
  let nextId = 1;
  let buffer = Buffer.alloc(0);
  let stderrBytes = 0;
  const pending = new Map();
  const disconnected = () => error('disconnected', 'Native Codex snapshot transport is disconnected');
  const finishAll = failure => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(failure);
    }
    pending.clear();
  };
  child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
  child.stdout.on('data', chunk => {
    if (closed) return;
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > maxFrameBytes) {
      finishAll(error('response_too_large', 'Native Codex response exceeds the frame limit'));
      closed = true;
      child.kill('SIGTERM');
      return;
    }
    let newline;
    while ((newline = buffer.indexOf(10)) >= 0) {
      const line = buffer.subarray(0, newline);
      buffer = buffer.subarray(newline + 1);
      if (!line.length) continue;
      let response;
      try { response = JSON.parse(line); } catch {
        finishAll(error('invalid_response', 'Native Codex returned invalid JSON'));
        child.kill('SIGTERM');
        return;
      }
      if (response.method && response.id !== undefined) {
        child.stdin.write(`${JSON.stringify({id: response.id, error: {code: -32601, message: 'Read-only client does not accept server requests'}})}\n`);
        continue;
      }
      if (response.id === undefined || !pending.has(response.id)) continue;
      const entry = pending.get(response.id);
      pending.delete(response.id);
      clearTimeout(entry.timer);
      if (response.error) entry.reject(error('native_rpc_error', typeof response.error.message === 'string' ? response.error.message : 'Native Codex request failed'));
      else entry.resolve(response.result);
    }
  });
  child.on('error', () => { if (!closed) finishAll(disconnected()); });
  child.on('exit', () => { if (!closed) { closed = true; finishAll(disconnected()); } });

  const call = (method, params = {}, allowInternal = false) => new Promise((resolve, reject) => {
    if (closed) return reject(disconnected());
    if (!allowInternal && !READ_METHODS.has(method)) return reject(error('read_only', `Native Codex method ${method} is not permitted by the snapshot adapter`));
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(error('deadline_exceeded', 'Native Codex read result is unknown'));
      closed = true;
      child.kill('SIGTERM');
      finishAll(disconnected());
    }, timeoutMs);
    pending.set(id, {resolve, reject, timer});
    try { child.stdin.write(`${JSON.stringify({id, method, params})}\n`); }
    catch { clearTimeout(timer); pending.delete(id); reject(disconnected()); }
  });

  try {
    await call('initialize', {
      clientInfo: {name: 'voxcode-native-snapshot', title: 'VoxCode native Codex snapshot reader', version: '0.1.0'},
      capabilities: {experimentalApi: true},
    }, true);
    child.stdin.write('{"method":"initialized","params":{}}\n');
  } catch (cause) {
    closed = true;
    child.kill('SIGTERM');
    throw cause;
  }

  return Object.freeze({
    identity: {
      authority: 'stored-history',
      executionTarget: 'mac',
      backendId: `stdio:${identity.sha256}`,
      executable: identity.executable,
      version: identity.version,
      sha256: identity.sha256,
      pageSize,
      stderrBytes: () => stderrBytes,
    },
    request(method, params = {}) { return call(method, params); },
    async close() {
      if (closed) return;
      closed = true;
      finishAll(disconnected());
      child.stdin.end();
      await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill('SIGTERM'); resolve(); }, 1000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    },
  });
}

export {READ_METHODS};
