import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const runtimePaths = Object.freeze([
  'server-cli.mjs', 'runtime.mjs', 'runtime-config.mjs',
  'task-cli.mjs', 'task-rpc.mjs', 'project-service.mjs', 'codex-cli-adapter.mjs', 'task-store.mjs',
  'mcp-server.mjs', 'mcp-proxy-bridge.mjs', 'http-server.mjs',
  'public/index.html', 'package.json', 'package-lock.json',
]);
export const templatePaths = Object.freeze([
  'deploy/voxcode.service', 'deploy/voxcode-task.service',
  'deploy/server.env.example', 'deploy/task.env.example', 'deploy/projects.json.example', 'deploy/deploy.json.example',
]);
export const bundlePaths = Object.freeze([...runtimePaths, ...templatePaths]);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function revision(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{7,64}$/u.test(value)) throw Error('Revision must be a hexadecimal commit identifier');
  return value;
}
export function safeRoot(value) {
  if (typeof value !== 'string' || !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/u.test(value) || value === '/tmp' || value.split('/').some(x => x === '.' || x === '..')) throw Error('Unsafe deployment root');
  return value;
}

// A deliberately small, regular-file-only ustar format. No links, extension
// headers or shell tar extraction are accepted on the deployment host.
function octal(buffer, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, '0');
  if (text.length >= length) throw Error('Archive entry too large');
  buffer.write(text, offset, length - 1, 'ascii');
}
export function encodeBundle(files) {
  const blocks = [];
  for (const [name, value] of files) {
    if (!/^[A-Za-z0-9_./-]+$/u.test(name) || name.length > 99 || name.split('/').some(x => !x || x === '.' || x === '..')) throw Error('Unsafe bundle entry');
    const bytes = Buffer.from(value), header = Buffer.alloc(512);
    if (bytes.length > 8 * 1024 * 1024) throw Error('Bundle entry too large');
    header.write(name); octal(header, 100, 8, 0o644); octal(header, 108, 8, 0); octal(header, 116, 8, 0);
    octal(header, 124, 12, bytes.length); octal(header, 136, 12, 0);
    header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257); header.write('00', 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]), { level: 9 });
}
export function decodeBundle(bytes) {
  if (bytes.length > 32 * 1024 * 1024) throw Error('Archive too large');
  const tar = gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }), files = new Map();
  const string = (header, start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/su, '');
  const number = (header, start, length) => {
    const text = string(header, start, length).trim();
    if (!/^[0-7]+$/u.test(text)) throw Error('Invalid archive number');
    return Number.parseInt(text, 8);
  };
  let offset = 0, ended = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512); offset += 512;
    if (header.every(byte => byte === 0)) {
      if (tar.length - offset < 512 || !tar.subarray(offset).every(byte => byte === 0)) throw Error('Invalid archive ending');
      ended = true; break;
    }
    const check = Buffer.from(header), recorded = number(header, 148, 8); check.fill(32, 148, 156);
    const name = string(header, 0, 100), size = number(header, 124, 12);
    if (recorded !== check.reduce((sum, byte) => sum + byte, 0) || string(header, 257, 6) !== 'ustar' || header[156] !== 48 || string(header, 345, 155) || string(header, 157, 100)) throw Error('Only regular ustar files are accepted');
    if (![...bundlePaths, 'manifest.json'].includes(name) || files.has(name) || size > 8 * 1024 * 1024 || offset + size > tar.length) throw Error('Unexpected archive entry');
    files.set(name, Buffer.from(tar.subarray(offset, offset + size))); offset += Math.ceil(size / 512) * 512;
  }
  if (!ended || files.size !== bundlePaths.length + 1) throw Error('Incomplete server bundle');
  let manifest;
  try { manifest = JSON.parse(files.get('manifest.json')); } catch { throw Error('Invalid bundle manifest'); }
  revision(manifest.revision);
  if (manifest.format !== 1 || manifest.name !== '@voxcode/server' || manifest.node !== '22' || manifest.dependencyMode !== 'npm-ci-ignore-scripts' || !manifest.files || Object.keys(manifest.files).sort().join('\n') !== [...bundlePaths].sort().join('\n')) throw Error('Unexpected bundle manifest');
  for (const name of bundlePaths) if (manifest.files[name] !== sha256(files.get(name))) throw Error('Bundle file checksum mismatch');
  const pkg = JSON.parse(files.get('package.json')), lock = JSON.parse(files.get('package-lock.json'));
  if (pkg.name !== '@voxcode/server' || pkg.type !== 'module' || pkg.workspaces || lock.lockfileVersion !== 3 || lock.packages?.['']?.name !== pkg.name || JSON.stringify(pkg.dependencies ?? {}) !== JSON.stringify(lock.packages[''].dependencies ?? {})) throw Error('Server package and lock must agree');
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (name && (!name.startsWith('node_modules/') || entry.link || !/^https:\/\/registry\.npmjs\.org\//u.test(entry.resolved ?? '') || !/^sha512-/u.test(entry.integrity ?? ''))) throw Error('Only integrity-pinned registry dependencies are accepted');
  }
  return { files, manifest };
}
