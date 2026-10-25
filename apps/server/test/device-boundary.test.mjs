import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, realpath, rm, readFile, chmod, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDeviceStore} from '../device-store.mjs';
import {createDeviceGateway} from '../device-gateway.mjs';

async function fixture(t, options = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'vox-gateway-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  let now = 1000;
  const clock = () => now, store = await createDeviceStore({root, clock, ...options.store});
  const p = await store.startPairing({userId: 'u1'}), paired = await store.completePairing({code: p.code, userId: 'u1', deviceId: 'mac'});
  const config = {deviceStore: store, clock, ...options.gateway};
  const gateway = createDeviceGateway(config), sent = [];
  const register = {type: 'register', protocolVersion: 1, deviceId: 'mac', token: paired.token, capabilities: ['switch_task', 'focus_window', 'open_project', 'task_rpc']};
  const handle = await gateway.connect(register, {send: value => {sent.push(value);}});
  const command = {userId: 'u1', deviceId: 'mac', projectId: 'p1', type: 'switch_task', taskId: 'task', expectedRevision: 4, payload: {focus: true}, requestId: 'req'};
  const result = accepted => ({type: 'commandResult', protocolVersion: 1, requestId: accepted.requestId, operationId: accepted.operationId, deviceId: 'mac', status: 'succeeded', errorCode: null, snapshot: {activeTaskId: 'task'}});
  return {root, store, clock, config, gateway, sent, handle, command, register, result, paired, advance: ms => {now += ms;}};
}

test('pairing cannot replace another owner and secrets persist only as digests', async t => {
  const f = await fixture(t);
  const other = await f.store.startPairing({userId: 'u2'});
  await assert.rejects(f.store.completePairing({code: other.code, userId: 'u2', deviceId: 'mac'}), {code: 'device_conflict'});
  const disk = await readFile(join(f.root, 'devices.json'), 'utf8');
  assert.equal(disk.includes(f.paired.token), false);
  assert.equal(disk.includes(other.code), false);
  const restarted = await createDeviceStore({root: f.root, clock: f.clock});
  assert.deepEqual(await restarted.authenticate({deviceId: 'mac', token: f.paired.token}), {deviceId: 'mac', userId: 'u1'});
  assert.equal((await restarted.listDevices({userId: 'u1'}))[0].online, false);
});

test('pairings expire at the boundary and storage capacity is bounded', async t => {
  const f = await fixture(t, {store: {pairingTtlMs: 100, limits: {maxPairings: 1, maxDevices: 1}}});
  const p = await f.store.startPairing({userId: 'u1'});
  await assert.rejects(f.store.startPairing({userId: 'u1'}), {code: 'capacity'});
  f.advance(100);
  await assert.rejects(f.store.completePairing({code: p.code, userId: 'u1', deviceId: 'later'}), {code: 'pairing_expired'});
  const next = await f.store.startPairing({userId: 'u1'});
  await assert.rejects(f.store.completePairing({code: next.code, userId: 'u1', deviceId: 'second'}), {code: 'capacity'});
});

test('private root and atomic writes fail closed without consuming pairing in RAM', async t => {
  await assert.rejects(createDeviceStore({root: 'relative'}), /private|absolute/i);
  const f = await fixture(t), p = await f.store.startPairing({userId: 'u1'});
  const file = join(f.root, 'devices.json'), saved = await readFile(file);
  await rm(file); await mkdir(file);
  await assert.rejects(f.store.completePairing({code: p.code, userId: 'u1', deviceId: 'new'}));
  await rm(file, {recursive: true}); await writeFile(file, saved, {mode: 0o600});
  assert.equal((await f.store.completePairing({code: p.code, userId: 'u1', deviceId: 'new'})).deviceId, 'new');
  await chmod(f.root, 0o755);
  await assert.rejects(createDeviceStore({root: f.root}), /private/i);
});

test('unified wire binds a connection and concurrent request IDs send exactly once', async t => {
  const f = await fixture(t);
  assert.equal(f.sent[0].type, 'connected');
  assert.equal(typeof f.sent[0].connectionId, 'string');
  const [a, b] = await Promise.all([f.gateway.submitCommand(f.command), f.gateway.submitCommand({...f.command})]);
  assert.equal(a.operationId, b.operationId);
  const frames = f.sent.filter(x => x.type === 'command');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].command.projectId, 'p1');
  await assert.rejects(f.gateway.submitCommand({...f.command, payload: {focus: false}}), {code: 'request_conflict'});
});

test('current authenticated device handle owns results and old close preserves replacement', async t => {
  const f = await fixture(t), accepted = await f.gateway.submitCommand(f.command);
  const p = await f.store.startPairing({userId: 'u2'}), paired = await f.store.completePairing({code: p.code, userId: 'u2', deviceId: 'other'});
  const other = await f.gateway.connect({type: 'register', protocolVersion: 1, deviceId: 'other', token: paired.token, capabilities: ['switch_task']}, {send: () => {}});
  await assert.rejects(other.receive(f.result(accepted)), {code: 'unauthorized'});
  const replacement = await f.gateway.connect(f.register, {send: () => {}});
  await assert.rejects(f.handle.receive(f.result(accepted)), {code: 'connection_replaced'});
  await f.handle.close();
  assert.equal((await replacement.receive({type: 'heartbeat', protocolVersion: 1, deviceId: 'mac', snapshot: {activeTaskId: 'task'}, agentObservedAt: new Date(1000).toISOString()})).type, 'heartbeat_ack');
  await assert.rejects(replacement.receive({...f.result(accepted), deviceId: 'other'}), {code: 'unauthorized'});
  assert.equal((await replacement.receive(f.result(accepted))).status, 'succeeded');
  assert.equal((await f.gateway.getOperation(accepted.operationId, {userId: 'u1', deviceId: 'mac'})).status, 'succeeded');
});

test('restart restores unknown operations, never replays and queries the new agent to reconcile', async t => {
  const f = await fixture(t), accepted = await f.gateway.submitCommand(f.command);
  const store = await createDeviceStore({root: f.root, clock: f.clock});
  const gateway = createDeviceGateway({...f.config, deviceStore: store}), frames = [];
  assert.equal((await gateway.getOperation(accepted.operationId, {userId: 'u1', deviceId: 'mac'})).status, 'unknown');
  const handle = await gateway.connect(f.register, {send: value => {frames.push(value);}});
  const replay = await gateway.submitCommand(f.command);
  assert.equal(replay.status, 'unknown');
  assert.equal(frames.filter(x => x.type === 'command').length, 0);
  await gateway.reconcile({userId: 'u1', deviceId: 'mac', operationId: accepted.operationId});
  assert.equal(frames.at(-1).type, 'reconcile');
  await handle.receive(f.result(accepted));
  assert.equal((await gateway.getOperation(accepted.operationId, {userId: 'u1', deviceId: 'mac'})).status, 'succeeded');
});

test('frames, payloads and operation ledger are bounded and message identity cannot override context', async t => {
  const f = await fixture(t, {gateway: {limits: {maxFrameBytes: 1024, maxPayloadBytes: 128, maxOperations: 1}}});
  await assert.rejects(f.handle.receive('x'.repeat(1025)), {code: 'payload_too_large'});
  await assert.rejects(f.handle.receive(Buffer.from('{}')), {code: 'invalid_argument'});
  await assert.rejects(f.handle.receive({type: 'heartbeat', protocolVersion: 1, deviceId: 'mac', userId: 'u2'}), {code: 'invalid_argument'});
  await f.gateway.submitCommand(f.command);
  await assert.rejects(f.gateway.submitCommand({...f.command, requestId: 'next'}), {code: 'capacity'});
  await assert.rejects(f.gateway.submitCommand({...f.command, payload: {focus: true, text: 'x'.repeat(200)}}), {code: 'payload_too_large'});
});
