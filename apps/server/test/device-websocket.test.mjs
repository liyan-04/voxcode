import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {createServer as createHttpServer} from 'node:http';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import WebSocket from 'ws';
import {attachDeviceWebSocket} from '../device-websocket.mjs';

const origin = 'https://vox.example';
let certificate;
async function tls() {
  if (!certificate) certificate = (async () => {
    const root = await mkdtemp(join(tmpdir(), 'vox-device-wss-'));
    after(() => rm(root, {recursive: true, force: true}));
    const key = join(root, 'key.pem'), cert = join(root, 'cert.pem');
    await promisify(execFile)('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=Fixture', '-addext', 'subjectAltName=IP:127.0.0.1']);
    return {key: await readFile(key), cert: await readFile(cert)};
  })();
  return certificate;
}

function gatewayFixture() {
  const records = [];
  return {records, async connect(register, transport) {
    if (register.token !== 'synthetic-paired-token') throw Object.assign(Error('private authentication detail'), {code: 'unauthorized'});
    const record = {register, messages: [], closed: 0}; records.push(record);
    await transport.send({type: 'connected', protocolVersion: 1, deviceId: register.deviceId, connectionId: 'connection-' + records.length});
    return {receive: async message => {record.messages.push(JSON.parse(message));}, close: async () => {record.closed++;}};
  }};
}

async function fixture(t, options = {}) {
  const context = await tls(), server = createServer(context, (_req, res) => {res.writeHead(404); res.end();});
  const gateway = options.gateway ?? gatewayFixture();
  const transport = attachDeviceWebSocket({server, gateway, publicOrigin: origin, ...options});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const clients = new Set(), url = 'wss://127.0.0.1:' + server.address().port;
  t.after(async () => {
    for (const ws of clients) ws.terminate();
    await transport.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  });
  const create = (path = '/agent', extra = {}) => {const ws = new WebSocket(url + path, {ca: context.cert, ...extra}); clients.add(ws); ws.on('error', () => {}); return ws;};
  const connect = async extra => {const ws = create('/agent', extra); await once(ws, 'open'); return ws;};
  return {server, gateway, transport, create, connect, context};
}
const register = (deviceId = 'mac') => ({type: 'register', protocolVersion: 1, deviceId, token: 'synthetic-paired-token', capabilities: ['task_rpc']});
async function authenticate(ws, input = register()) {
  const pending = once(ws, 'message'); ws.send(JSON.stringify(input));
  return JSON.parse((await pending)[0].toString());
}
async function rejected(ws) {
  return new Promise((resolve, reject) => {
    ws.once('unexpected-response', (_request, response) => {response.resume(); resolve(response.statusCode);});
    ws.once('open', () => reject(Error('unexpected upgrade')));
    ws.once('error', reject);
  });
}
async function until(check) {
  const deadline = Date.now() + 2000;
  while (!await check()) {if (Date.now() > deadline) assert.fail('fixture deadline'); await delay(2);}
}

test('strict trusted WSS forwards text only through the authenticated connection handle', async t => {
  const f = await fixture(t), ws = await f.connect();
  assert.equal((await authenticate(ws)).type, 'connected');
  ws.send(JSON.stringify({type: 'heartbeat', protocolVersion: 1, deviceId: 'mac'}));
  await until(() => f.gateway.records[0].messages.length === 1);
  assert.equal(f.gateway.records[0].messages[0].type, 'heartbeat');
  const closed = once(ws, 'close'); ws.close(); await closed;
  await until(() => f.gateway.records[0].closed === 1);
  const wrongTrust = f.create('/agent', {ca: undefined});
  assert.ok((await once(wrongTrust, 'error'))[0]);
});

test('wrong path query and cross-origin upgrades are rejected before gateway authentication', async t => {
  const f = await fixture(t);
  for (const [path, headers, expected] of [['/other', {}, 404], ['/agent?token=secret', {}, 404], ['/agent', {origin: 'https://evil.example'}, 403], ['/agent', {origin: origin + '/'}, 403]]) {
    assert.equal(await rejected(f.create(path, {headers})), expected);
  }
  const browser = await f.connect({origin});
  assert.equal((await authenticate(browser)).type, 'connected');
  assert.equal(f.gateway.records.length, 1);
});

test('registration rejects malformed JSON binary non-register and failed authentication', async t => {
  const f = await fixture(t);
  for (const [body, options] of [['{', {}], [JSON.stringify({type: 'heartbeat'}), {}], [Buffer.from('{}'), {binary: true}], [JSON.stringify({...register(), token: 'wrong'}), {}]]) {
    const ws = await f.connect(), closed = once(ws, 'close'); ws.send(body, options);
    const [code, reason] = await closed;
    assert.ok([1003, 1007, 1008].includes(code));
    assert.equal(reason.toString().includes('private'), false);
  }
  assert.equal(f.gateway.records.length, 0);
});

test('unregistered and asynchronously authenticating sockets have a bounded registration deadline', async t => {
  let release, closed = 0;
  const gateway = {connect: async () => new Promise(resolve => {release = () => resolve({receive: async () => {}, close: async () => {closed++;}});})};
  const f = await fixture(t, {gateway, limits: {registrationTimeoutMs: 30}});
  const idle = await f.connect(); assert.equal((await once(idle, 'close'))[0], 1008);
  const pending = await f.connect(), disconnected = once(pending, 'close'); pending.send(JSON.stringify(register()));
  await until(() => release);
  assert.equal((await disconnected)[0], 1008);
  release(); await until(() => closed === 1);
});

test('preauth and total socket capacity reject before upgrade and recover after close', async t => {
  const f = await fixture(t, {limits: {maxSockets: 2, maxUnauthenticated: 1}}), first = await f.connect();
  assert.equal(await rejected(f.create()), 503);
  await authenticate(first);
  const second = await f.connect(); await authenticate(second, register('mac-2'));
  assert.equal(await rejected(f.create()), 503);
  const closed = once(first, 'close'); first.close(); await closed;
  const next = await f.connect(); assert.equal((await authenticate(next, register('mac-3'))).type, 'connected');
});

test('oversize frames are closed before gateway calls', async t => {
  const f = await fixture(t, {limits: {maxPayloadBytes: 256}}), ws = await f.connect(), closed = once(ws, 'close');
  ws.send('x'.repeat(257)); assert.equal((await closed)[0], 1009);
  assert.equal(f.gateway.records.length, 0);
});

test('a bounded per-socket queue closes flooding clients and releases the handle once', async t => {
  let release, started = false, closes = 0, calls = 0;
  const gateway = {connect: async (_message, transport) => {
    await transport.send({type: 'connected'});
    return {receive: async () => {calls++; started = true; await new Promise(resolve => {release = resolve;});}, close: async () => {closes++;}};
  }};
  const f = await fixture(t, {gateway, limits: {maxPendingMessages: 2}}), ws = await f.connect();
  await authenticate(ws);
  ws.send('{}'); await until(() => started);
  const closed = once(ws, 'close'); ws.send('{}'); ws.send('{}');
  assert.equal((await closed)[0], 1013);
  await until(() => closes === 1);
  release(); await delay(5);
  assert.equal(calls, 1);
});

test('close during async gateway connect cleans its eventual authenticated handle', async t => {
  let release, closes = 0;
  const f = await fixture(t, {gateway: {connect: async () => new Promise(resolve => {release = () => resolve({receive: async () => {}, close: async () => {closes++;}});})}});
  const ws = await f.connect(); ws.send(JSON.stringify(register())); await until(() => release);
  const closed = once(ws, 'close'); ws.close(); await closed;
  release(); await until(() => closes === 1);
});

test('retiring authentication keeps its preauth capacity until the gateway settles', async t => {
  let release, closes = 0;
  const f = await fixture(t, {limits: {maxSockets: 2, maxUnauthenticated: 1, registrationTimeoutMs: 30}, gateway: {
    connect: async () => new Promise(resolve => {release = () => resolve({receive: async () => {}, close: async () => {closes++;}});}),
  }});
  const ws = await f.connect(), disconnected = once(ws, 'close');
  ws.send(JSON.stringify(register())); await until(() => release);
  assert.equal((await disconnected)[0], 1008);
  assert.equal(await rejected(f.create()), 503);
  release(); await until(() => closes === 1);
  const next = await f.connect(); next.close();
});

test('authenticated idle sockets close and successful gateway messages renew their deadline', async t => {
  const f = await fixture(t, {limits: {idleTimeoutMs: 80}}), ws = await f.connect();
  await authenticate(ws);
  await delay(40);
  ws.send(JSON.stringify({type: 'heartbeat', protocolVersion: 1, deviceId: 'mac'}));
  await until(() => f.gateway.records[0].messages.length === 1);
  await delay(45);
  assert.equal(ws.readyState, WebSocket.OPEN, 'a successful heartbeat renews the original idle deadline');
  assert.equal((await once(ws, 'close'))[0], 1008);
  await until(() => f.gateway.records[0].closed === 1);
});

test('an idle client that does not answer the close frame releases total capacity after termination', async t => {
  const f = await fixture(t, {limits: {maxSockets: 1, idleTimeoutMs: 30, shutdownTimeoutMs: 20}}), ws = await f.connect();
  await authenticate(ws); ws.pause();
  await until(() => new Promise((resolve, reject) => f.server.getConnections((error, count) => error ? reject(error) : resolve(count === 0))));
  assert.equal(f.gateway.records[0].closed, 1);
  const next = await f.connect(); next.close();
  const closed = once(ws, 'close'); ws.resume(); await closed;
});

test('shutdown closes owned sockets within its deadline and keeps the HTTPS listener running', async t => {
  const f = await fixture(t, {limits: {shutdownTimeoutMs: 30}}), ws = await f.connect();
  await authenticate(ws);
  const closed = once(ws, 'close');
  await f.transport.close(); await closed;
  assert.equal(f.gateway.records[0].closed, 1);
  assert.equal(f.server.listening, true);
  await f.transport.close();
});

test('shutdown terminates unresponsive sockets by its deadline while receive and cleanup remain pending', async t => {
  let releaseReceive, releaseClose, closes = 0, cancellations = 0;
  const f = await fixture(t, {limits: {shutdownTimeoutMs: 30}, gateway: {
    cancelTask: () => {cancellations++;},
    connect: async (_message, transport) => {
      await transport.send({type: 'connected'});
      return {
        receive: async () => new Promise(resolve => {releaseReceive = resolve;}),
        close: async () => {closes++; await new Promise(resolve => {releaseClose = resolve;});},
      };
    },
  }});
  const ws = await f.connect(); await authenticate(ws);
  ws.send('{}'); await until(() => releaseReceive);
  ws.pause();
  const started = Date.now();
  await f.transport.close();
  assert.ok(Date.now() - started < 500, 'shutdown must not wait for task receive or cleanup');
  assert.equal(closes, 1);
  assert.equal(cancellations, 0);
  assert.equal(f.server.listening, true);
  releaseReceive(); releaseClose();
  const disconnected = once(ws, 'close'); ws.resume(); await disconnected;
});

test('configuration refuses plaintext listeners invalid origins and unsafe limits', () => {
  const gateway = gatewayFixture();
  assert.throws(() => attachDeviceWebSocket({server: createHttpServer(), gateway, publicOrigin: origin}), /HTTPS/);
  for (const publicOrigin of [undefined, 'http://vox.example', origin + '/', origin + '/path', 'https://user:password@vox.example']) {
    assert.throws(() => attachDeviceWebSocket({server: createServer(), gateway, publicOrigin}), /publicOrigin/);
  }
  for (const limits of [null, [], {maxSockets: 0}, {maxSockets: 1025}, {maxUnauthenticated: null}, {maxUnauthenticated: 33}, {maxPayloadBytes: 0}, {maxPendingMessages: 65}, {registrationTimeoutMs: 30001}, {idleTimeoutMs: 0}, {idleTimeoutMs: 120001}, {shutdownTimeoutMs: 10001}, {sendTimeoutMs: 10001}, {unexpected: 1}]) {
    assert.throws(() => attachDeviceWebSocket({server: createServer(), gateway, publicOrigin: origin, limits}), /limits/);
  }
});

test('attachment requires exclusive ownership of the HTTPS upgrade listener', () => {
  const server = createServer(); server.on('upgrade', () => {});
  assert.throws(() => attachDeviceWebSocket({server, gateway: gatewayFixture(), publicOrigin: origin}), /upgrade listener/);
  assert.equal(server.listenerCount('upgrade'), 1);
});

test('a smaller total socket limit also bounds the default preauth limit', async t => {
  const f = await fixture(t, {limits: {maxSockets: 1}}), ws = await f.connect();
  assert.equal(await rejected(f.create()), 503);
  await authenticate(ws);
});
