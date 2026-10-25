import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDeviceStore} from '../device-store.mjs';

async function fixture(t, options = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'vox-store-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  let now = 1000;
  const store = await createDeviceStore({root, clock: () => now, ...options});
  return {store, advance: ms => {now += ms;}};
}

test('pairing codes expire and paired devices expose only safe state', async t => {
  const {store, advance} = await fixture(t, {pairingTtlMs: 100});
  const pairing = await store.startPairing({userId: 'u1'});
  assert.equal((await store.completePairing({code: pairing.code, userId: 'u1', deviceId: 'mac-1'})).deviceId, 'mac-1');
  assert.equal((await store.listDevices({userId: 'u1'}))[0].online, false);
  const expired = await store.startPairing({userId: 'u1'});
  advance(100);
  await assert.rejects(store.completePairing({code: expired.code, userId: 'u1', deviceId: 'mac-2'}), {code: 'pairing_expired'});
});

test('device credentials authenticate, expire online state and never appear in public snapshots', async t => {
  const {store, advance} = await fixture(t, {offlineAfterMs: 50});
  const pair = await store.startPairing({userId: 'u1'});
  const credential = await store.completePairing({code: pair.code, userId: 'u1', deviceId: 'mac-1'});
  assert.deepEqual(await store.authenticate(credential), {deviceId: 'mac-1', userId: 'u1'});
  await assert.rejects(store.authenticate({...credential, token: 'wrong'}), {code: 'unauthorized'});
  await store.observeDevice({deviceId: 'mac-1', userId: 'u1', capabilities: ['switch_task'], snapshot: {activeTaskId: 'task'}, agentObservedAt: new Date(1000).toISOString()});
  assert.equal((await store.getDevice('mac-1')).online, true);
  advance(50);
  const device = await store.getDevice('mac-1');
  assert.equal(device.online, false);
  assert.equal(device.agentObserved.stateSource, 'agentObserved');
  assert.equal(device.lastSeen, 1000);
  assert.equal(JSON.stringify(device).includes(credential.token), false);
  assert.equal(device.tokenDigest, undefined);
});

test('store rejects unknown limit keys instead of silently ignoring misspelled bounds', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'vox-limits-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  await assert.rejects(createDeviceStore({root, limits: {maxDevice: 1}}), {code: 'invalid_argument'});
});
