import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../mac/server.mjs';
import { createService } from '../../mac/service.mjs';
import { createVoiceHandler } from '../voice.mjs';

test('revoking during an authenticated partial create body never starts a provider', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'vox-voice-revoke-'));
  const service = createService({ project: directory, dataDir: join(directory, 'data') });
  let subscribed;
  const entered = new Promise(resolve => { subscribed = resolve; });
  const subscribe = service.onAuthorizationChange.bind(service);
  service.onAuthorizationChange = callback => { const unsubscribe = subscribe(callback); subscribed(); return unsubscribe; };
  let providers = 0;
  const handler = createVoiceHandler({ config: { token: 'fixture' }, sessionFactory() {
    providers++;
    return { async connect() {}, startListening() {}, close() {} };
  } });
  const { server } = createServer({ service, voiceHandler: handler });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    handler.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await service.close(); rmSync(directory, { recursive: true, force: true });
  });
  const token = service.pair(service.pairCode);
  const body = JSON.stringify({ requestId: 'slow-create', taskId: null, version: null });
  let pending;
  const response = new Promise((resolve, reject) => {
    pending = request({ host: '127.0.0.1', port: server.address().port, path: '/api/voice/sessions', method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
      const parts = []; res.on('data', part => parts.push(part)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts).toString() }));
    });
    pending.on('error', reject); pending.write(body.slice(0, 10));
  });
  await entered;
  service.revoke(token);
  pending.end(body.slice(10));
  assert.equal((await response).status, 401);
  assert.equal(providers, 0);
});
