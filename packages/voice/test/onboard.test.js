import test, { mock } from 'node:test';
import https from 'node:https';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, mkdir, writeFile, symlink, chmod, link, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { initialize, status, activate, runCLI, OTA_URL, ACTIVATE_URL, WSS_URL, httpsTransport } from '../tools/onboard-lib.mjs';

// Deny outbound HTTPS for the entire test process, even if an injected transport
// is accidentally omitted. Wrapper tests explicitly inject a controlled request.
test.before(() => { mock.method(https, 'request', () => { throw new Error('Test network disabled'); }); });

async function fixture(t) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'vox-onboard-'));
  t.after(async () => (await import('node:fs/promises')).rm(root, { recursive: true, force: true }));
  return { root, directory: join(root, 'private') };
}

const token = 'fixture-private-token';
const code = '608303';
const bound = { status: 200, body: JSON.stringify({ websocket: { url: WSS_URL, token } }) };
const pending = { status: 200, body: JSON.stringify({ activation: { code, message: 'private response must not be logged' }, websocket: { url: 'ws://xrobo-io.qiniuapi.com/v1/ws/' }, firmware: { url: 'https://example.invalid/do-not-fetch' } }) };
function transport(...responses) {
  const calls = [];
  const send = async (request) => {
    calls.push(request);
    assert.ok(responses.length, 'unexpected network request (including firmware)');
    const reply = responses.shift();
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { send, calls };
}
function output(isTTY = false) {
  return { isTTY, text: '', write(text) { this.text += text; } };
}

test('init persists a private local unicast MAC/UUID without printing or replacing it', async (t) => {
  const { directory } = await fixture(t);
  assert.deepEqual(await initialize({ directory }), { state: 'initialized', created: true });
  const path = join(directory, 'identity.json');
  const original = await readFile(path, 'utf8');
  const identity = JSON.parse(original);
  assert.match(identity.deviceId, /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/);
  assert.equal(parseInt(identity.deviceId.slice(0, 2), 16) & 3, 2);
  assert.match(identity.clientId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await initialize({ directory }), { state: 'initialized', created: false });
  assert.equal(await readFile(path, 'utf8'), original);
  assert.deepEqual(await status({ directory }), { state: 'unconfigured' });
});

test('pending activation remains redacted, uses documented payload, and never fetches firmware', async (t) => {
  const { directory } = await fixture(t);
  await initialize({ directory });
  const identity = JSON.parse(await readFile(join(directory, 'identity.json'), 'utf8'));
  const wire = transport({ status: 202, body: '' }, pending);
  assert.deepEqual(await activate({ directory, transport: wire.send }), { state: 'pending', codeAvailable: true });
  assert.deepEqual(wire.calls.map((call) => call.url), [ACTIVATE_URL, OTA_URL]);
  assert.equal(wire.calls[0].body, undefined);
  assert.deepEqual(wire.calls[0].headers, { 'Device-Id': identity.deviceId });
  const request = wire.calls[1];
  assert.equal(request.headers['Activation-Version'], '1');
  assert.equal(request.headers['Device-Id'], identity.deviceId);
  assert.equal(request.headers['Client-Id'], identity.clientId);
  assert.equal(request.headers['User-Agent'], 'xiaoling-web-test/1.0.0');
  assert.equal(request.maxResponseBytes, 65536);
  assert.ok(request.signal instanceof AbortSignal);
  const payload = JSON.parse(request.body);
  assert.equal(payload.mac_address, identity.deviceId);
  assert.equal(payload.uuid, identity.clientId);
  assert.equal(payload.board.mac, identity.deviceId);
  assert.equal(payload.board.type, 'xiaoling-web-test');
  assert.match(payload.application.elf_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(await status({ directory }), { state: 'unconfigured' });
  await assert.rejects(readFile(join(directory, '.env.linx')), { code: 'ENOENT' });
});

test('bound response maps only documented WS to WSS and writes env without replacing it', async (t) => {
  const { directory } = await fixture(t);
  await initialize({ directory });
  const identity = await readFile(join(directory, 'identity.json'), 'utf8');
  const wire = transport({ status: 200, body: 'success' }, { ...bound, body: bound.body.replace('wss:', 'ws:') });
  const result = await activate({ directory, transport: wire.send });
  assert.deepEqual(result, { state: 'configured', saved: true });
  assert.ok(!JSON.stringify(result).includes(token));
  const envPath = join(directory, '.env.linx');
  const env = await readFile(envPath, 'utf8');
  assert.equal((await stat(envPath)).mode & 0o777, 0o600);
  assert.ok(env.includes(`LINX_WS_URL=${WSS_URL}\nLINX_TOKEN=${token}\n`));
  assert.equal(await readFile(join(directory, 'identity.json'), 'utf8'), identity);
  assert.deepEqual(await status({ directory }), { state: 'configured' });
  await assert.rejects(activate({ directory, transport: wire.send }), { code: 'exists' });
  assert.equal(wire.calls.length, 2);
  assert.equal(await readFile(envPath, 'utf8'), env);
  assert.deepEqual(await initialize({ directory }), { state: 'initialized', created: false });
});

test('already-bound first OTA registration may return token even after check reported unknown', async (t) => {
  const { directory } = await fixture(t);
  await initialize({ directory });
  const wire = transport({ status: 202, body: '' }, bound);
  assert.deepEqual(await activate({ directory, transport: wire.send }), { state: 'configured', saved: true });
});

test('check HTTP200 business errors, malformed or nonempty 202 and redirects fail without OTA', async (t) => {
  for (const reply of [
    { status: 200, body: JSON.stringify({ code: 500, msg: token, data: null }) },
    { status: 200, body: JSON.stringify({ error: token }) },
    { status: 200, body: 'not success' },
    { status: 202, body: token },
    { status: 302, body: token },
    { status: 429, body: token },
  ]) {
    const { directory } = await fixture(t);
    await initialize({ directory });
    const wire = transport(reply);
    await assert.rejects(activate({ directory, transport: wire.send }), (error) => error.code === 'response' && !error.message.includes(token));
    assert.equal(wire.calls.length, 1);
  }
});

test('OTA rejects business errors, malformed/tokenless replies and unsafe token encodings', async (t) => {
  const invalid = [
    { error: token, websocket: { url: WSS_URL, token } },
    {}, [], null, true, 1, 'secret scalar',
    { websocket: null, activation: { code } },
    { websocket: false, activation: { code } },
    { websocket: 0, activation: { code } },
    { websocket: [], activation: { code } },
    { websocket: 'string', activation: { code } },
    { websocket: { url: WSS_URL } },
    { websocket: { url: WSS_URL, token: '' } },
    { websocket: { url: WSS_URL, token: null } },
    { websocket: { url: WSS_URL, token: 123 } },
    { websocket: { url: WSS_URL, token: true } },
    { websocket: { url: WSS_URL, token: [token] } },
    { activation: null }, { activation: false }, { activation: [] },
    { activation: { code: [code] } },
    { websocket: { url: WSS_URL, token: 'x\nLINX_TOKEN=forged' } },
    { websocket: { url: WSS_URL, token: 'secret#comment' } },
    { websocket: { url: WSS_URL, token: 'secret"quote' } },
    { websocket: { url: WSS_URL, token: 'secret$dollar' } },
    { websocket: { url: WSS_URL, token: 'x'.repeat(8193) } },
    { activation: { code: '12345' } },
    { activation: { code }, websocket: { url: WSS_URL, token } },
  ];
  for (const data of invalid) {
    const { directory } = await fixture(t);
    await initialize({ directory });
    const wire = transport({ status: 202, body: '' }, { status: 200, body: JSON.stringify(data) });
    await assert.rejects(activate({ directory, transport: wire.send }), { code: 'response' });
    await assert.rejects(readFile(join(directory, '.env.linx')), { code: 'ENOENT' });
  }
  for (const reply of [{ status: 200, body: '<html>private upstream</html>' }, { status: 301, body: '' }, { status: 500, body: token }]) {
    const { directory } = await fixture(t);
    await initialize({ directory });
    const wire = transport({ status: 202, body: '' }, reply);
    await assert.rejects(activate({ directory, transport: wire.send }), { code: 'response' });
  }
});

test('pending after successful binding check fails honestly rather than declaring configured', async (t) => {
  const { directory } = await fixture(t);
  await initialize({ directory });
  const wire = transport({ status: 200, body: 'success' }, pending);
  await assert.rejects(activate({ directory, transport: wire.send }), { code: 'response' });
});

test('rejects arbitrary HTTP/HTTPS/WSS, userinfo, query and path variants before saving tokens', async (t) => {
  const { directory } = await fixture(t);
  await initialize({ directory });
  for (const options of [{ otaUrl: 'https://example.invalid/' }, { activateUrl: 'http://xrobo.qiniuapi.com/v1/ota/activate' }]) {
    let called = false;
    await assert.rejects(activate({ directory, ...options, transport: async () => { called = true; } }), { code: 'endpoint' });
    assert.equal(called, false);
  }
  for (const url of ['ws://example.invalid/v1/ws/', 'wss://example.invalid/v1/ws/', 'https://xrobo-io.qiniuapi.com/v1/ws/', 'wss://user@xrobo-io.qiniuapi.com/v1/ws/', `${WSS_URL}?token=x`, 'wss://xrobo-io.qiniuapi.com/v1/other/', 'wss://xrobo-io.qiniuapi.com:443/v1/ws/']) {
    const wire = transport({ status: 200, body: 'success' }, { status: 200, body: JSON.stringify({ websocket: { url, token } }) });
    await assert.rejects(activate({ directory, transport: wire.send }), { code: 'endpoint' });
  }
});

test('bounded timeout aborts controlled transport, does not save late data or retry', async (t) => {
  const { directory } = await fixture(t);
  await initialize({ directory });
  let signal;
  let calls = 0;
  let finish;
  const send = (request) => { calls += 1; signal = request.signal; return new Promise((resolve) => { finish = resolve; }); };
  await assert.rejects(activate({ directory, timeoutMs: 5, transport: send }), { code: 'timeout' });
  assert.equal(signal.aborted, true);
  finish(bound);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  await assert.rejects(readFile(join(directory, '.env.linx')), { code: 'ENOENT' });
  for (const timeoutMs of [0, 30001, NaN, '1000']) await assert.rejects(activate({ directory, timeoutMs, transport: send }), { code: 'usage' });
});

test('response bounds and untrusted transport exceptions never leak raw data', async (t) => {
  const { directory } = await fixture(t);
  await initialize({ directory });
  for (const reply of [new Error(`Authorization: Bearer ${token}`), { status: 200, body: 'x'.repeat(65537) }, { status: 200, body: '中'.repeat(22000) }, { status: 200, body: {} }, null]) {
    const wire = transport(reply);
    await assert.rejects(activate({ directory, transport: wire.send }), (error) => ['transport', 'response'].includes(error.code) && !error.message.includes(token));
  }
});

test('identity, leaf and ancestor symlinks, hardlinks and public permissions are rejected', async (t) => {
  const { root, directory } = await fixture(t);
  await initialize({ directory });
  const identityPath = join(directory, 'identity.json');
  const identity = await readFile(identityPath, 'utf8');
  const external = join(root, 'external');
  await writeFile(external, identity, { mode: 0o600 });
  const alias = join(root, 'alias');
  await symlink(directory, alias);
  await assert.rejects(status({ directory: alias }), { code: 'filesystem' });
  await assert.rejects(initialize({ directory: join(alias, 'child') }), { code: 'filesystem' });
  const { unlink } = await import('node:fs/promises');
  await unlink(identityPath);
  await symlink(external, identityPath);
  await assert.rejects(initialize({ directory }), { code: 'filesystem' });
  await assert.rejects(status({ directory }), { code: 'filesystem' });
  assert.equal(await readFile(external, 'utf8'), identity);
  await unlink(identityPath);
  await link(external, identityPath);
  await assert.rejects(status({ directory }), { code: 'filesystem' });
  await unlink(identityPath);
  await writeFile(identityPath, identity, { mode: 0o600 });
  await chmod(identityPath, 0o644);
  await assert.rejects(status({ directory }), { code: 'filesystem' });
  await chmod(identityPath, 0o600);
  await chmod(directory, 0o755);
  await assert.rejects(initialize({ directory }), { code: 'filesystem' });
});

test('corrupt identity, orphan env and malformed env are never replaced', async (t) => {
  const { directory } = await fixture(t);
  await mkdir(directory, { mode: 0o700 });
  const envPath = join(directory, '.env.linx');
  await writeFile(envPath, token, { mode: 0o600 });
  await assert.rejects(initialize({ directory }), { code: 'exists' });
  await assert.rejects(readFile(join(directory, 'identity.json')), { code: 'ENOENT' });
  const { unlink } = await import('node:fs/promises');
  await unlink(envPath);
  await initialize({ directory });
  await writeFile(envPath, token, { mode: 0o600 });
  await assert.rejects(status({ directory }), { code: 'configuration' });
  const wire = transport();
  await assert.rejects(activate({ directory, transport: wire.send }), { code: 'configuration' });
  assert.equal(wire.calls.length, 0);
  assert.equal(await readFile(envPath, 'utf8'), token);
  await writeFile(join(directory, 'identity.json'), '{invalid');
  await assert.rejects(initialize({ directory }), { code: 'identity' });
  assert.equal(await readFile(join(directory, 'identity.json'), 'utf8'), '{invalid');
});

test('env symlink is rejected before network, and concurrent create never clobbers a file', async (t) => {
  const { root, directory } = await fixture(t);
  await initialize({ directory });
  const outside = join(root, 'outside');
  await writeFile(outside, token, { mode: 0o600 });
  const envPath = join(directory, '.env.linx');
  await symlink(outside, envPath);
  const wire = transport();
  await assert.rejects(activate({ directory, transport: wire.send }), { code: 'filesystem' });
  assert.equal(wire.calls.length, 0);
  const { unlink } = await import('node:fs/promises');
  await unlink(envPath);
  let calls = 0;
  await assert.rejects(activate({ directory, transport: async () => {
    calls += 1;
    if (calls === 1) return { status: 200, body: 'success' };
    await writeFile(envPath, 'concurrent-private-data', { mode: 0o600 });
    return bound;
  } }), { code: 'filesystem' });
  assert.equal(await readFile(envPath, 'utf8'), 'concurrent-private-data');
  assert.equal(await readFile(outside, 'utf8'), token);
});

test('CLI codes are explicit interactive-only, JSON/errors redact and unknown options do no work', async (t) => {
  const { directory } = await fixture(t);
  await initialize({ directory });
  const identity = JSON.parse(await readFile(join(directory, 'identity.json'), 'utf8'));
  let stdout = output();
  let stderr = output();
  let wire = transport({ status: 202, body: '' }, pending);
  assert.equal(await runCLI(['activate', '--dir', directory], { stdout, stderr, transport: wire.send }), 0);
  assert.deepEqual(JSON.parse(stdout.text), { state: 'pending', codeAvailable: true });
  assert.equal(stderr.text, '');
  assert.ok(!stdout.text.includes(code) && !stdout.text.includes(identity.deviceId));
  stdout = output(); stderr = output(true);
  wire = transport({ status: 202, body: '' }, pending);
  assert.equal(await runCLI(['activate', '--dir', directory, '--show-code'], { stdin: { isTTY: true }, stdout, stderr, transport: wire.send }), 0);
  assert.ok(stderr.text.includes(code));
  assert.ok(!stdout.text.includes(code));
  for (const args of [
    ['activate', '--dir', directory, '--show-code'],
    ['status', '--dir', directory, '--show-code'],
    ['activate', '--dir', directory, '--token', token],
    ['activate', '--dir', directory, '--endpoint', OTA_URL],
    ['activate', '--dir', directory, '--dir', directory],
    ['bogus'], ['init'],
  ]) {
    stdout = output(); stderr = output(); wire = transport();
    assert.equal(await runCLI(args, { stdin: { isTTY: false }, stdout, stderr, transport: wire.send }), 1);
    assert.equal(wire.calls.length, 0);
    assert.equal(stdout.text, '');
    assert.ok(!stderr.text.includes(token) && !stderr.text.includes(directory));
  }
  stdout = output(); stderr = output();
  wire = transport(new Error(`${token} ${code} ${identity.deviceId}`));
  assert.equal(await runCLI(['activate', '--dir', directory], { stdout, stderr, transport: wire.send }), 1);
  assert.ok(!stderr.text.includes(token) && !stderr.text.includes(code) && !stderr.text.includes(identity.deviceId));
  assert.equal(stdout.text, '');
});

test('entrypoint supports init/status offline and does not accept token arguments', async (t) => {
  const { directory } = await fixture(t);
  const cli = new URL('../tools/onboard.mjs', import.meta.url);
  let child = spawnSync(process.execPath, [cli.pathname, 'init', '--dir', directory], { encoding: 'utf8' });
  assert.equal(child.status, 0);
  assert.deepEqual(JSON.parse(child.stdout), { state: 'initialized', created: true });
  child = spawnSync(process.execPath, [cli.pathname, 'status', '--dir', directory], { encoding: 'utf8' });
  assert.equal(child.status, 0);
  assert.deepEqual(JSON.parse(child.stdout), { state: 'unconfigured' });
  child = spawnSync(process.execPath, [cli.pathname, 'activate', '--dir', directory, '--token', token], { encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.ok(!`${child.stdout}${child.stderr}`.includes(token));
});


test('default HTTPS wrapper bounds streamed bytes and never follows redirects or arbitrary endpoints', async () => {
  let calls = 0;
  let sentBody;
  let opts;
  let response;
  const requestImpl = (url, options, onResponse) => {
    calls += 1;
    assert.equal(url, OTA_URL);
    opts = options;
    const request = new EventEmitter();
    request.end = (body) => { sentBody = body; response = new EventEmitter(); response.statusCode = 302; response.destroy = () => {}; onResponse(response); };
    return request;
  };
  const promise = httpsTransport({ url: OTA_URL, headers: { 'Device-Id': 'fixture' }, body: '{}', maxResponseBytes: 65536, requestImpl });
  response.emit('data', Buffer.from('redirect-body'));
  response.emit('end');
  assert.deepEqual(await promise, { status: 302, body: 'redirect-body' });
  assert.equal(calls, 1);
  assert.equal(opts.method, 'POST');
  assert.equal(sentBody, '{}');
  await assert.rejects(httpsTransport({ url: 'http://example.invalid/', requestImpl }), { code: 'endpoint' });
  assert.equal(calls, 1);
  const overflow = httpsTransport({ url: OTA_URL, maxResponseBytes: 65536, requestImpl });
  let destroyed = false;
  response.destroy = () => { destroyed = true; };
  response.emit('data', Buffer.alloc(65536));
  response.emit('data', Buffer.alloc(1));
  await assert.rejects(overflow, { code: 'response' });
  assert.equal(destroyed, true);
});

test('non-string activation codes and identity fields are malformed rather than coerced', async (t) => {
  const { directory } = await fixture(t);
  await initialize({ directory });
  const wire = transport({ status: 202, body: '' }, { status: 200, body: JSON.stringify({ activation: { code: 608303 } }) });
  await assert.rejects(activate({ directory, transport: wire.send }), { code: 'response' });
  const path = join(directory, 'identity.json');
  const identity = JSON.parse(await readFile(path, 'utf8'));
  identity.deviceId = [identity.deviceId];
  await writeFile(path, JSON.stringify(identity));
  await assert.rejects(status({ directory }), { code: 'identity' });
});


test('test harness blocks outbound HTTPS when transport injection is accidentally omitted', async (t) => {
  const { directory } = await fixture(t);
  await initialize({ directory });
  await assert.rejects(activate({ directory }), { code: 'transport' });
});
