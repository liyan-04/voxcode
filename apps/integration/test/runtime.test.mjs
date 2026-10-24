import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createRelay } from '../../relay/relay.mjs';
import { startRuntime } from '../runtime.mjs';

test('one Mac entry starts its local bridge and connector and stops both', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'vox-runtime-'));
  const machineId = 'fixture-mac', machineKey = 'a-synthetic-machine-secret-at-least-32-characters';
  const relay = createRelay({ machineId, machineKey });
  relay.server.listen(0, '127.0.0.1'); await once(relay.server, 'listening');
  const origin = `http://127.0.0.1:${relay.server.address().port}`;
  let runtime;
  t.after(async () => { await runtime?.close(); await relay.close(); await rm(dir, { recursive: true, force: true }); });
  runtime = await startRuntime({ project: dir, dataDir: join(dir, 'state'), port: 0, relayURL: origin.replace('http:', 'ws:') + '/connector', machineId, machineKey });
  await runtime.connector.start();
  const response = await fetch(origin + '/api/health');
  assert.equal(response.status, 200); assert.equal((await response.json()).name, 'VoxCode');
  const local = `http://127.0.0.1:${runtime.app.server.address().port}`;
  assert.equal((await fetch(local + '/api/tasks')).status, 401);
  await runtime.close(); await runtime.close();
  assert.equal(runtime.connector.connected, false);
  assert.equal((await fetch(origin + '/api/health')).status, 503);
  await assert.rejects(fetch(local + '/api/health'));
});

test('invalid or partial relay configuration never leaves a bridge running', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'vox-invalid-runtime-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const options of [{ relayURL: 'wss://example.invalid/connector' }, { port: -1 }, { port: 1.5 },
    { relayURL: 'ws://public.example/connector', machineId: 'fixture', machineKey: 'a-synthetic-machine-secret-at-least-32-characters' }]) {
    await assert.rejects(startRuntime({ project: dir, dataDir: join(dir, 'state'), port: 0, ...options }));
  }
});
