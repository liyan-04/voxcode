import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createVoiceHandler } from '../voice.mjs';

async function harness(t, options = {}) {
  let onEvent;
  const calls = [];
  const handler = createVoiceHandler({
    config: { token: 'test' },
    sessionFactory: (args) => {
      onEvent = args.onEvent;
      return {
        async connect() { calls.push('connect'); },
        startListening() { calls.push('start'); },
        sendAudio(data) { calls.push(Buffer.from(data)); },
        stopListening() { calls.push('stop'); },
        close() { calls.push('close'); },
      };
    },
    ...options,
  });
  const service = { get(id) { assert.equal(id, 'task-a'); return { version: 2 }; } };
  const server = createServer(async (req, res) => {
    try { await handler(req, res, req.headers.authorization, service); }
    catch (e) { res.writeHead(e.status ?? 500); res.end(JSON.stringify({ error: e.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { handler.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const request = (path, method = 'GET', body, token = 'phone-a') => fetch(`http://127.0.0.1:${server.address().port}/api/voice/sessions${path}`, {
    method, headers: { authorization: token, 'content-type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json' },
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  return { request, calls, emit: event => onEvent(event) };
}

test('voice binds owner and target, replay does not create another session', async t => {
  const h = await harness(t);
  const body = { requestId: 'one', taskId: 'task-a', version: 2 };
  const first = await (await h.request('', 'POST', body)).json();
  assert.equal(first.outputSupported, false);
  assert.equal((await (await h.request('', 'POST', body)).json()).id, first.id);
  assert.equal(h.calls.filter(x => x === 'connect').length, 1);
  assert.equal((await h.request(`/${first.id}/events`, 'GET', undefined, 'phone-b')).status, 404);
  assert.equal((await h.request('', 'POST', { ...body, version: 1 })).status, 409);
  h.emit({ type: 'stt', text: 'Build timer' });
  const events = await (await h.request(`/${first.id}/events?after=0`)).json();
  assert.equal(events.events[0].text, 'Build timer');
});

test('PCM lifecycle, chunk validation and delete replay', async t => {
  const h = await harness(t);
  const { id } = await (await h.request('', 'POST', { requestId: 'two', taskId: null, version: null })).json();
  assert.equal((await h.request(`/${id}/audio`, 'POST', Buffer.alloc(640))).status, 200);
  assert.equal((await h.request(`/${id}/audio`, 'POST', Buffer.alloc(3))).status, 400);
  assert.equal((await h.request(`/${id}/stop`, 'POST')).status, 200);
  assert.equal((await h.request(`/${id}/stop`, 'POST')).status, 200);
  assert.equal((await h.request(`/${id}/audio`, 'POST', Buffer.alloc(640))).status, 409);
  assert.equal((await h.request(`/${id}`, 'DELETE')).status, 200);
  assert.equal((await h.request('', 'POST', { requestId: 'two', taskId: null, version: null })).status, 409);
});

test('voice sessions reject stale task, unconfigured and global capacity', async t => {
  const h = await harness(t);
  assert.equal((await h.request('', 'POST', { requestId: 'stale', taskId: 'task-a', version: 1 })).status, 409);
  await h.request('', 'POST', { requestId: 'ok', taskId: null, version: null });
  assert.equal((await h.request('', 'POST', { requestId: 'other', taskId: null, version: null }, 'phone-b')).status, 429);
  const missing = await harness(t, { config: null });
  assert.equal((await missing.request('', 'POST', { requestId: 'x', taskId: null, version: null })).status, 503);
});

test('expired recording retains replay tombstone and retained sessions are bounded', async t => {
  const h = await harness(t, { ttlMs: 20, maxEntries: 2 });
  const body = { requestId: 'expired', taskId: null, version: null };
  await h.request('', 'POST', body);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal((await h.request('', 'POST', body)).status, 409);
  const second = await (await h.request('', 'POST', { ...body, requestId: 'new' })).json();
  await h.request(`/${second.id}`, 'DELETE');
  assert.equal((await h.request('', 'POST', { ...body, requestId: 'third' })).status, 429);
});
