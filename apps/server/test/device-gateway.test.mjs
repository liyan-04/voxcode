import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, realpath, rm, readFile, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {createDeviceStore} from '../device-store.mjs';
import {createDeviceGateway} from '../device-gateway.mjs';

async function fixture(t, options = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'vox-command-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  let now = 1000;
  const store = await createDeviceStore({root, clock: () => now});
  const pair = await store.startPairing({userId: 'u1'});
  const credential = await store.completePairing({code: pair.code, userId: 'u1', deviceId: 'mac'});
  const gateway = createDeviceGateway({deviceStore: store, clock: () => now, ...options});
  const sent = [], register = {type: 'register', protocolVersion: 1, ...credential, capabilities: ['switch_task', 'focus_window', 'open_project', 'task_rpc']};
  delete register.fixture;
  const handle = await gateway.connect(register, {send: frame => {sent.push(frame);}});
  const command = {userId: 'u1', deviceId: 'mac', projectId: 'p1', taskId: 'task', expectedRevision: 4, type: 'switch_task', payload: {focus: true}, requestId: 'req'};
  return {root, store, gateway, sent, handle, command, register, advance: ms => {now += ms;}};
}

test('commands deduplicate semantic request payloads and reject identity conflicts', async t => {
  const f = await fixture(t);
  const accepted = await f.gateway.submitCommand(f.command);
  assert.equal(accepted.status, 'accepted');
  assert.deepEqual(await f.gateway.submitCommand({...f.command, payload: {focus: true}}), accepted);
  await assert.rejects(f.gateway.submitCommand({...f.command, payload: {focus: false}}), {code: 'request_conflict'});
  assert.equal(f.sent.filter(x => x.type === 'command').length, 1);
});

test('local commands require target and revision while unsupported server actions never reach Mac', async t => {
  const f = await fixture(t);
  for (const key of ['projectId', 'taskId', 'expectedRevision']) {
    const input = {...f.command}; delete input[key];
    await assert.rejects(f.gateway.submitCommand(input), {code: 'invalid_argument'});
  }
  for (const type of ['send_message', 'pause_task', 'resume_task', 'stop_task', 'shell']) await assert.rejects(f.gateway.submitCommand({...f.command, type}), {code: 'capability_unavailable'});
  for (const payload of [{path: '/tmp'}, {shell: 'id'}, {focus: 'yes'}]) await assert.rejects(f.gateway.submitCommand({...f.command, payload}), {code: 'invalid_argument'});
  await assert.rejects(f.gateway.submitCommand({...f.command, expectedRevision: 0}), {code: 'invalid_argument'});
  assert.equal(f.sent.filter(x => x.type === 'command').length, 0);
});

test('task RPC uses fixed methods and validated argument arrays without a server executor', async t => {
  const f = await fixture(t);
  const read = {userId: 'u1', deviceId: 'mac', type: 'task_rpc', requestId: 'read', payload: {method: 'listProjects', params: []}};
  assert.equal((await f.gateway.submitCommand(read)).status, 'accepted');
  const write = {...read, requestId: 'write', payload: {method: 'confirmTask', params: ['task', {revision: 7, requestId: 'mac-confirm'}]}};
  assert.equal((await f.gateway.submitCommand(write)).status, 'accepted');
  assert.deepEqual(f.sent.at(-1).command.payload, write.payload);
  for (const payload of [{method: 'exec', params: ['id']}, {method: 'confirmTask', params: ['task', {revision: 7}]}, {method: 'startTask', params: [{projectId: 'p1', requestId: 'x', prompt: 'x', path: '/tmp'}]}]) {
    await assert.rejects(f.gateway.submitCommand({...read, requestId: 'invalid', payload}), {code: 'invalid_argument'});
  }
});

test('disconnect keeps unknown outcome and offline requests do not enter ledger', async t => {
  const f = await fixture(t), accepted = await f.gateway.submitCommand(f.command);
  await f.handle.close();
  assert.equal((await f.gateway.getOperation(accepted.operationId, {userId: 'u1', deviceId: 'mac'})).status, 'unknown');
  await assert.rejects(f.gateway.submitCommand({...f.command, requestId: 'offline'}), {code: 'offline'});
  await assert.rejects(f.gateway.getOperation(accepted.operationId, {userId: 'u2', deviceId: 'mac'}), {code: 'not_found'});
  assert.equal(await f.store.findRequest('mac', 'offline'), null);
});

test('failed durable reservation prevents transmission and retry sends only after repair', async t => {
  const f = await fixture(t), file = join(f.root, 'devices.json'), saved = await readFile(file);
  await rm(file); await mkdir(file);
  await assert.rejects(f.gateway.submitCommand(f.command));
  assert.equal(f.sent.filter(x => x.type === 'command').length, 0);
  await rm(file, {recursive: true}); await writeFile(file, saved, {mode: 0o600});
  assert.equal((await f.gateway.submitCommand(f.command)).status, 'accepted');
  assert.equal(f.sent.filter(x => x.type === 'command').length, 1);
});

test('send failure is durable unknown and repeat submissions never resend', async t => {
  const f = await fixture(t, {limits: {sendTimeoutMs: 10}});
  await f.handle.close();
  let calls = 0;
  await f.gateway.connect(f.register, {send: frame => {if (frame.type === 'command') {calls++; return new Promise(() => {});}}});
  const accepted = await f.gateway.submitCommand(f.command);
  assert.equal(accepted.status, 'unknown');
  assert.deepEqual(await f.gateway.submitCommand(f.command), accepted);
  assert.equal(calls, 1);
});

test('RPC result snapshots preserve raw arrays and terminal receipts reject a changed result', async t => {
  const f = await fixture(t);
  const accepted = await f.gateway.submitCommand({userId: 'u1', deviceId: 'mac', type: 'task_rpc', requestId: 'list', payload: {method: 'listProjects', params: []}});
  const reply = {type: 'commandResult', protocolVersion: 1, deviceId: 'mac', requestId: accepted.requestId, operationId: accepted.operationId, status: 'succeeded', errorCode: null, snapshot: [{id: 'p1', enabled: true}]};
  const result = await f.handle.receive(reply);
  assert.deepEqual(result.snapshot, reply.snapshot);
  assert.deepEqual(await f.handle.receive(reply), result);
  await assert.rejects(f.handle.receive({...reply, snapshot: []}), {code: 'request_conflict'});
  await f.handle.receive({type: 'heartbeat', protocolVersion: 1, deviceId: 'mac'});
  assert.equal((await f.gateway.listDevices({userId: 'u1'}))[0].agentObserved, null);
});

test('expiry during durable reservation prevents send, while a delivered command becomes unknown after its deadline', async t => {
  const f = await fixture(t, {ttlMs: 100});
  const reserve = f.store.reserveOperation.bind(f.store);
  f.store.reserveOperation = async (...args) => {const value = await reserve(...args); f.advance(101); return value;};
  const expired = await f.gateway.submitCommand(f.command);
  assert.equal(expired.status, 'expired');
  assert.equal(f.sent.filter(x => x.type === 'command').length, 0);
  f.store.reserveOperation = reserve;
  const pending = await f.gateway.submitCommand({...f.command, requestId: 'delivered'});
  assert.equal(pending.status, 'accepted');
  f.advance(101);
  const after = await f.gateway.getOperation(pending.operationId, {userId: 'u1', deviceId: 'mac'});
  assert.equal(after.status, 'unknown');
  assert.equal((await f.gateway.submitCommand({...f.command, requestId: 'delivered'})).status, 'unknown');
  assert.equal(f.sent.filter(x => x.type === 'command').length, 1);
});

test('accepted protocol identifiers retain the same meaning after reopening the ledger', async t => {
  const f = await fixture(t);
  const requestId = '\u8bf7\u6c42-1';
  const accepted = await f.gateway.submitCommand({...f.command, requestId});
  const restored = await createDeviceStore({root: f.root});
  assert.equal((await restored.getOperation(accepted.operationId)).command.requestId, requestId);
});

test('agent unknown reconciliation remains nonterminal and later accepts its final receipt', async t => {
  const f = await fixture(t), accepted = await f.gateway.submitCommand(f.command);
  const receipt = {type: 'commandResult', protocolVersion: 1, deviceId: 'mac', requestId: accepted.requestId, operationId: accepted.operationId, status: 'unknown', errorCode: 'outcome_unknown', snapshot: null};
  assert.equal((await f.handle.receive(receipt)).status, 'unknown');
  assert.equal((await f.gateway.submitCommand(f.command)).status, 'unknown');
  assert.equal(f.sent.filter(x => x.type === 'command').length, 1);
  await f.gateway.reconcile({userId: 'u1', deviceId: 'mac', operationId: accepted.operationId});
  assert.equal(f.sent.at(-1).type, 'reconcile');
  assert.equal((await f.handle.receive({...receipt, status: 'succeeded', errorCode: null, snapshot: {activeTaskId: 'task'}})).status, 'succeeded');
});

test('pending admission is bounded and frame size checks run before a blocked queue', async t => {
  const f = await fixture(t, {limits: {maxPending: 2, maxFrameBytes: 1024}});
  await f.handle.close();
  let signal, release;
  const started = new Promise(resolve => {signal = resolve;});
  const blocked = new Promise(resolve => {release = resolve;});
  const handle = await f.gateway.connect(f.register, {send: frame => {if (frame.type === 'command') {signal(); return blocked;}}});
  const active = f.gateway.submitCommand(f.command);
  await started;
  const queued = f.gateway.getOperation('pending', {userId: 'u1', deviceId: 'mac'});
  const queuedResult = assert.rejects(queued, {code: 'not_found'});
  await assert.rejects(f.gateway.getOperation('overflow', {userId: 'u1', deviceId: 'mac'}), {code: 'capacity'});
  const immediate = await Promise.race([
    handle.receive('x'.repeat(1025)).then(() => 'accepted', error => error.code),
    new Promise(resolve => setImmediate(() => resolve('still queued'))),
  ]);
  assert.equal(immediate, 'payload_too_large');
  const close = handle.close();
  release();
  await active; await queuedResult; await close;
  await assert.rejects(f.gateway.submitCommand({...f.command, requestId: 'closed'}), {code: 'offline'});
});

test('directory fsync completes before a durable reservation can be sent', async t => {
  const f = await fixture(t), originalOpen = fs.open;
  let release, signal;
  const barrier = new Promise(resolve => {release = resolve;});
  const syncing = new Promise(resolve => {signal = resolve;});
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] !== f.root) return handle;
    return {sync: async () => {signal('directory_sync'); await barrier; await handle.sync();}, close: () => handle.close()};
  });
  syncBuiltinESMExports();
  t.after(() => {t.mock.restoreAll(); syncBuiltinESMExports();});
  const pending = f.gateway.submitCommand(f.command);
  try {
    assert.equal(await Promise.race([syncing, pending.then(() => 'sent_before_directory_sync')]), 'directory_sync');
    assert.equal(f.sent.filter(x => x.type === 'command').length, 0);
  } finally {release();}
  assert.equal((await pending).status, 'accepted');
});

test('uncertain directory commit blocks further calls until reopen and never sends', async t => {
  const f = await fixture(t), originalOpen = fs.open;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] !== f.root) return handle;
    return {sync: async () => {throw Error('injected directory sync failure');}, close: () => handle.close()};
  });
  syncBuiltinESMExports();
  t.after(() => {t.mock.restoreAll(); syncBuiltinESMExports();});
  await assert.rejects(f.gateway.submitCommand(f.command), {code: 'outcome_unknown'});
  await assert.rejects(f.gateway.submitCommand(f.command), {code: 'outcome_unknown'});
  assert.equal(f.sent.filter(x => x.type === 'command').length, 0);
  t.mock.restoreAll(); syncBuiltinESMExports();
  const restored = await createDeviceStore({root: f.root});
  assert.equal((await restored.findRequest('mac', f.command.requestId)).response.status, 'unknown');
});

test('old operation receipts and out-of-order heartbeats cannot replace or freshen current state', async t => {
  const f = await fixture(t);
  const heartbeat = (snapshot, time) => ({type: 'heartbeat', protocolVersion: 1, deviceId: 'mac', snapshot, agentObservedAt: new Date(time).toISOString()});
  await assert.rejects(f.handle.receive({type: 'heartbeat', protocolVersion: 1, deviceId: 'mac', snapshot: {activeTaskId: 'missing-time'}}), {code: 'invalid_argument'});
  await f.handle.receive(heartbeat({activeTaskId: 'current'}, 1000));
  const accepted = await f.gateway.submitCommand(f.command);
  f.advance(500);
  const receipt = {type: 'commandResult', protocolVersion: 1, deviceId: 'mac', requestId: accepted.requestId, operationId: accepted.operationId, status: 'succeeded', errorCode: null, snapshot: {activeTaskId: 'old'}, agentObservedAt: new Date(900).toISOString()};
  await f.handle.receive(receipt);
  let device = (await f.gateway.listDevices({userId: 'u1'}))[0];
  assert.equal(device.agentObserved.snapshot.activeTaskId, 'current');
  assert.equal(device.agentObserved.observedAt, new Date(1000).toISOString());
  assert.equal(device.lastSeen, 1000);
  await f.handle.receive(heartbeat({activeTaskId: 'newest'}, 1400));
  f.advance(100);
  await f.handle.receive(receipt);
  await f.handle.receive(heartbeat({activeTaskId: 'stale'}, 1200));
  await f.handle.receive(heartbeat({activeTaskId: 'same-time-altered'}, 1400));
  device = (await f.gateway.listDevices({userId: 'u1'}))[0];
  assert.equal(device.agentObserved.snapshot.activeTaskId, 'newest');
  assert.equal(device.agentObserved.observedAt, new Date(1400).toISOString());
  assert.equal(device.agentObserved.receivedAt, new Date(1500).toISOString());
  assert.equal(device.lastSeen, 1600);
  assert.equal((await f.gateway.getOperation(accepted.operationId, {userId: 'u1', deviceId: 'mac'})).snapshot.activeTaskId, 'old');
});

test('a settled request releases pending capacity before its caller resumes', async t => {
  const f = await fixture(t, {limits: {maxPending: 1}});
  await f.gateway.listDevices({userId: 'u1'});
  await f.gateway.listDevices({userId: 'u1'});
  const result = await f.gateway.submitCommand(f.command);
  assert.equal(result.status, 'accepted');
});

test('expired read polling records can be reclaimed while write deduplication remains durable', async t => {
  const f = await fixture(t, {ttlMs: 100, limits: {maxOperations: 4}});
  const write = await f.gateway.submitCommand(f.command);
  const rpcWriteInput = {userId: 'u1', deviceId: 'mac', type: 'task_rpc', requestId: 'rpc-write', payload: {method: 'cancelTask', params: ['task', {requestId: 'cancel-on-mac'}]}};
  const rpcWrite = await f.gateway.submitCommand(rpcWriteInput);
  for (const requestId of ['live-read-1', 'live-read-2']) await f.gateway.submitCommand({userId: 'u1', deviceId: 'mac', type: 'task_rpc', requestId, payload: {method: 'status', params: []}});
  await assert.rejects(f.gateway.submitCommand({userId: 'u1', deviceId: 'mac', type: 'task_rpc', requestId: 'too-early', payload: {method: 'status', params: []}}), {code: 'capacity'});
  f.advance(101);
  for (let index = 0; index < 10; index++) {
    const read = await f.gateway.submitCommand({userId: 'u1', deviceId: 'mac', type: 'task_rpc', requestId: 'poll-' + index, payload: {method: 'status', params: []}});
    assert.equal(read.status, 'accepted');
    await f.handle.receive({type: 'commandResult', protocolVersion: 1, deviceId: 'mac', requestId: read.requestId, operationId: read.operationId, status: 'unknown', errorCode: 'outcome_unknown', snapshot: null});
    f.advance(101);
  }
  const repeated = await f.gateway.submitCommand(f.command);
  assert.equal(repeated.operationId, write.operationId);
  assert.equal(repeated.status, 'unknown');
  assert.equal((await f.gateway.submitCommand(rpcWriteInput)).operationId, rpcWrite.operationId);
  assert.equal(f.sent.filter(x => x.type === 'command' && x.command.requestId === f.command.requestId).length, 1);
  const disk = JSON.parse(await readFile(join(f.root, 'devices.json'), 'utf8'));
  assert.ok(disk.operations.length <= 4);
  assert.ok(disk.operations.some(x => x.command.operationId === write.operationId));
  const restored = await createDeviceStore({root: f.root});
  assert.equal((await restored.findRequest('mac', f.command.requestId)).command.operationId, write.operationId);
});
