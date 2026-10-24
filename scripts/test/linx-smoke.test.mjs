import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const secret = 'fixture-bearer-DO-NOT-LOG';
const privateText = 'private transcript prompt error /private/fixture-secret';
const sessionId = '11111111-1111-4111-8111-111111111111';
const format = { format: 'pcm', sample_rate: 16000, channels: 1 };
const payload = [
  { seq: 1, type: 'ready' },
  { seq: 2, type: 'stt', text: privateText },
  { seq: 3, type: 'draft', draft: { id: sessionId, taskId: null, version: null, title: privateText,
    prompt: privateText, criteria: [{ text: privateText, required: true }], expiresAt: new Date(Date.now() + 60000).toISOString() } },
  { seq: 4, type: 'audio', data: Buffer.from([1, 0, 2, 0]).toString('base64') },
];

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'voxcode-linx-smoke-'));
  const input = join(directory, 'synthetic-private-input.pcm');
  await writeFile(input, Buffer.alloc(6402));
  const calls = []; let cursor = 0;
  const server = createServer(async (req, res) => {
    const bytes = []; for await (const chunk of req) bytes.push(chunk);
    const call = { path: req.url, method: req.method, authorization: req.headers.authorization,
      contentType: req.headers['content-type'], body: Buffer.concat(bytes) };
    calls.push(call);
    const send = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (await options.handle?.(call, { req, res, send, calls })) return;
    if (req.url === '/api/health') return send({ name: 'VoxCode', voiceConfigured: true, codexAvailable: false });
    if (req.headers.authorization !== `Bearer ${secret}`) return send({ error: { message: privateText } }, 401);
    if (req.url === '/api/voice/sessions') return send({ id: sessionId,
      inputFormat: { sampleRate: 16000, channels: 1, encoding: 'pcm_s16le' }, outputSupported: true, outputFormat: format });
    if (req.url.endsWith('/audio')) return send({ accepted: true });
    if (req.url.endsWith('/stop')) return send({ stopped: true });
    if (req.url.endsWith('/abort')) return send({ aborted: true });
    if (req.method === 'DELETE') return send({ closed: true });
    if (req.url.includes('/events?')) {
      const events = options.events ?? payload;
      const after = Number(new URL(req.url, 'http://localhost').searchParams.get('after'));
      cursor = events.at(-1)?.seq ?? 0;
      return send({ events: events.filter(event => event.seq > after), cursor });
    }
    send({}, 404);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  return { origin: `http://127.0.0.1:${server.address().port}`, input, calls };
}

async function run(h, options = {}) {
  const { runLinxSmoke } = await import('../lib/linx-smoke.mjs');
  return runLinxSmoke({ origin: h.origin, token: secret, input: h.input, synthetic: true,
    deadlineMs: 2000, requestTimeoutMs: 300, cleanupTimeoutMs: 600, pollIntervalMs: 10, ...options });
}

function noLeaks(value, h) {
  const text = JSON.stringify(value);
  for (const forbidden of [secret, privateText, sessionId, h.input, payload[3].data]) assert(!text.includes(forbidden), forbidden);
}

test('uploads bounded PCM to frozen null target and reports observations without task mutations or payloads', async t => {
  const h = await fixture(t);
  const result = await run(h);
  assert.equal(result.passed, true);
  assert.deepEqual(result.observed, { ready: 1, stt: 1, draft: 1, audio: 1, tts: 0, focus: 0, error: 0 });
  assert.deepEqual(result.stages, { handshake: 'observed', stt: 'observed', draft: 'observed', audio: 'observed', tools: 'manual_required', playback: 'manual_required' });
  assert.deepEqual(result.cleanup, { abort: 'confirmed', close: 'confirmed' });
  const created = JSON.parse(h.calls.find(call => call.path === '/api/voice/sessions').body);
  assert.equal(created.taskId, null); assert.equal(created.version, null); assert.equal(typeof created.requestId, 'string');
  const chunks = h.calls.filter(call => call.path.endsWith('/audio'));
  assert.equal(chunks.length, 3); assert.equal(chunks.reduce((n, call) => n + call.body.length, 0), 6402);
  assert(chunks.every(call => call.body.length <= 32000 && call.body.length % 2 === 0 && call.contentType === 'application/octet-stream'));
  assert(h.calls.every(call => call.path === '/api/health' || call.path.startsWith('/api/voice/sessions')));
  assert.deepEqual(h.calls.slice(-2).map(call => call.method + ' ' + call.path.split('/').at(-1)), ['POST abort', `DELETE ${sessionId}`]);
  noLeaks(result, h);
});

test('401 and 429 stop without retries or leaking server error bodies', async t => {
  for (const [status, reason] of [[401, 'unauthorized'], [429, 'rate_limited']]) {
    const h = await fixture(t, { handle(call, { send }) { if (call.path === '/api/voice/sessions') { send({ error: { message: privateText } }, status); return true; } } });
    const result = await run(h);
    assert.equal(result.passed, false); assert.equal(result.reason, reason);
    assert.equal(h.calls.filter(call => call.path === '/api/voice/sessions').length, 1);
    assert(!h.calls.some(call => call.path.endsWith('/audio')));
    noLeaks(result, h);
  }
});

test('provider event error and unavailable session still attempt abort and delete', async t => {
  for (const options of [
    { events: [{ seq: 1, type: 'error', message: privateText }] },
    { handle(call, { send }) { if (call.path.includes('/events?')) { send({ error: { message: privateText } }, 409); return true; } } },
  ]) {
    const h = await fixture(t, options);
    const result = await run(h);
    assert.equal(result.passed, false);
    assert(['provider_error', 'session_unavailable'].includes(result.reason));
    assert(h.calls.some(call => call.path.endsWith('/abort'))); assert(h.calls.some(call => call.method === 'DELETE'));
    noLeaks(result, h);
  }
});

test('missing observations reach bounded poll limit and never claim ready from configured alone', async t => {
  const h = await fixture(t, { events: [] });
  const result = await run(h, { maxPolls: 2 });
  assert.equal(result.reason, 'poll_limit'); assert.equal(result.passed, false);
  assert.equal(result.readiness.voiceConfigured, true); assert.equal(result.stages.handshake, 'not_observed');
  assert.equal(result.stages.stt, 'not_observed');
  assert.equal(h.calls.filter(call => call.path.includes('/events?')).length, 2);
  assert.equal(result.cleanup.close, 'confirmed'); noLeaks(result, h);
});

test('deadline and caller interrupt abort in-flight requests and use independent cleanup budget', async t => {
  for (const interrupt of [false, true]) {
    const controller = new AbortController();
    const h = await fixture(t, { handle(call) {
      if (call.path.includes('/events?')) { if (interrupt) controller.abort(new Error(privateText)); return true; }
    } });
    const result = await run(h, { deadlineMs: 400, requestTimeoutMs: 500, signal: controller.signal });
    assert.equal(result.reason, interrupt ? 'interrupted' : 'timeout');
    assert.equal(result.cleanup.close, 'confirmed'); noLeaks(result, h);
  }
});

test('lost create response is recovered with same requestId solely for cleanup', async t => {
  let creates = 0;
  const h = await fixture(t, { handle(call, { req }) {
    if (call.path === '/api/voice/sessions' && ++creates === 1) { req.socket.destroy(); return true; }
  } });
  const result = await run(h);
  assert.equal(result.passed, false); assert.equal(result.reason, 'network_error');
  const requests = h.calls.filter(call => call.path === '/api/voice/sessions');
  assert.equal(requests.length, 2); assert.deepEqual(requests[0].body, requests[1].body);
  assert.equal(result.cleanup.close, 'confirmed'); assert(!h.calls.some(call => call.path.endsWith('/audio')));
});

test('invalid PCM, input declaration, bearer and nonliteral loopback fail before HTTP', async t => {
  const h = await fixture(t);
  for (const value of [Buffer.alloc(0), Buffer.alloc(3), Buffer.alloc(1920002)]) {
    await writeFile(h.input, value);
    const result = await run(h); assert.equal(result.reason, 'invalid_input'); noLeaks(result, h);
  }
  await writeFile(h.input, Buffer.alloc(2));
  for (const options of [{ synthetic: false }, { token: '' }, { token: 'bad\nheader' },
    { origin: 'http://example.com:8787' }, { origin: 'http://localhost:8787' }, { origin: 'https://127.0.0.1:8787' },
    { origin: 'http://user:password@127.0.0.1:8787' }, { origin: h.origin + '/api/tasks' },
    { origin: h.origin + '?secret=private' }]) {
    const result = await run(h, options); assert.equal(result.passed, false); noLeaks(result, h);
  }
  assert.equal(h.calls.length, 0);
});

test('redirects are never followed with bearer and cleanup continues after abort failure', async t => {
  const h = await fixture(t, { handle(call, { res, send }) {
    if (call.path.endsWith('/audio')) { res.writeHead(302, { location: '/api/tasks' }); res.end(privateText); return true; }
    if (call.path.endsWith('/abort')) { send({ error: { message: privateText } }, 503); return true; }
  } });
  const result = await run(h);
  assert.equal(result.reason, 'redirect_rejected'); assert.equal(result.cleanup.abort, 'failed'); assert.equal(result.cleanup.close, 'confirmed');
  assert(!h.calls.some(call => call.path === '/api/tasks')); noLeaks(result, h);
});

test('nonregular and symlink input cannot start HTTP or block awaiting a writer', async t => {
  const h = await fixture(t);
  const link = h.input + '-symlink'; await symlink(h.input, link);
  const directory = h.input + '-directory'; await mkdir(directory);
  const fifo = h.input + '-fifo'; execFileSync('mkfifo', [fifo]);
  for (const input of [link, directory, fifo, h.input + '-missing']) {
    const result = await run(h, { input }); assert.equal(result.reason, 'invalid_input');
  }
  assert.equal(h.calls.length, 0);
});

test('session identifiers, cursors, frozen drafts, audio and response bounds fail closed with cleanup', async t => {
  const invalids = [
    { events: ['ready', 'stt', 'draft', 'audio'].map((name, index) => ({ seq: index + 1, type: [name] })), cursor: 4 },
    { events: [{ seq: 1, type: { toString: 'ready' } }], cursor: 1 },
    { events: [{ seq: 1, type: 1 }], cursor: 1 },
    { events: [{ seq: 2, type: 'ready' }], cursor: 2 },
    { events: [], cursor: 1 },
    { events: [{ seq: 1, type: 'mcp', payload: privateText }], cursor: 1 },
    { events: [{ seq: 1, type: 'draft', draft: { ...payload[2].draft, taskId: sessionId } }], cursor: 1 },
    { events: [{ seq: 1, type: 'audio', data: 'raw-private' }], cursor: 1 },
    { events: [{ seq: 1, type: 'audio', data: 'AQ==' }], cursor: 1 },
  ];
  for (const batch of invalids) {
    const h = await fixture(t, { handle(call, { send }) { if (call.path.includes('/events?')) { send(batch); return true; } } });
    const result = await run(h); assert.equal(result.reason, 'invalid_response'); assert.equal(result.cleanup.close, 'confirmed'); noLeaks(result, h);
  }
  const h = await fixture(t, { handle(call, { send }) { if (call.path === '/api/voice/sessions') {
    send({ id: 'a', inputFormat: { sampleRate: 16000, channels: 1, encoding: 'pcm_s16le' }, outputSupported: true, outputFormat: format }); return true;
  } } });
  const result = await run(h); assert.equal(result.reason, 'invalid_response');
  assert(!h.calls.some(call => call.path.endsWith('/audio'))); assert.equal(result.cleanup.close, 'unconfirmed');
});

test('incomplete or oversized HTTP response is bounded and cleanup delete follows a stalled abort', async t => {
  for (const kind of ['oversized', 'incomplete', 'abort_stall']) {
    const h = await fixture(t, { handle(call, { res }) {
      if ((kind === 'abort_stall' && call.path.endsWith('/abort')) || (kind !== 'abort_stall' && call.path.includes('/events?'))) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write(kind === 'oversized' ? 'x'.repeat(2 * 1024 * 1024 + 1) : '{'); return true;
      }
    } });
    const result = await run(h, { requestTimeoutMs: 100, cleanupTimeoutMs: 100 });
    assert.equal(result.reason, kind === 'oversized' ? 'invalid_response' : kind === 'incomplete' ? 'timeout' : 'cleanup_failed');
    assert.equal(result.cleanup.close, 'confirmed'); noLeaks(result, h);
  }
});

test('negotiated 16 and 24 kHz audio frames enforce the bridge 120 ms decoded PCM bound', async t => {
  for (const sampleRate of [16000, 24000]) {
    const maxBytes = sampleRate * 2 * 0.12;
    for (const extraBytes of [0, 2]) {
      const h = await fixture(t, { events: [...payload.slice(0, 3),
        { seq: 4, type: 'audio', data: Buffer.alloc(maxBytes + extraBytes).toString('base64') }],
      handle(call, { send }) {
        if (call.path === '/api/voice/sessions') {
          send({ id: sessionId, inputFormat: { sampleRate: 16000, channels: 1, encoding: 'pcm_s16le' },
            outputSupported: true, outputFormat: { ...format, sample_rate: sampleRate } }); return true;
        }
      } });
      const result = await run(h);
      assert.equal(result.passed, extraBytes === 0);
      assert.equal(result.reason, extraBytes === 0 ? 'observations_complete' : 'invalid_response');
      assert.equal(result.cleanup.close, 'confirmed');
      noLeaks(result, h);
    }
  }
});

test('configured presence and empty STT do not substitute for observed payloads', async t => {
  const h = await fixture(t, { events: [{ seq: 1, type: 'ready' }, { seq: 2, type: 'stt', text: ' ' }] });
  const result = await run(h, { maxPolls: 1 });
  assert.equal(result.passed, false); assert.equal(result.stages.stt, 'not_observed'); assert.equal(result.stages.audio, 'not_observed');
  const unavailable = await fixture(t, { handle(call, { send }) { if (call.path === '/api/health') { send({ voiceConfigured: false }); return true; } } });
  const missing = await run(unavailable); assert.equal(missing.reason, 'not_configured'); assert.equal(unavailable.calls.length, 1);
});

async function cli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/smoke-linx.mjs', ...args], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject); child.once('exit', code => resolve({ code, stdout, stderr }));
  });
}

test('CLI help/import perform no HTTP and invalid secret flags never echo their values', async t => {
  const h = await fixture(t);
  const help = await cli(['--help'], { VOXCODE_SESSION_TOKEN: secret, VOXCODE_BRIDGE_URL: h.origin });
  assert.equal(help.code, 0); assert(help.stdout.includes('--synthetic')); noLeaks(help, h);
  const invalid = await cli(['--token', secret, '--input', h.input]);
  assert.equal(invalid.code, 1); noLeaks(invalid, h);
  await import('../smoke-linx.mjs');
  assert.equal(h.calls.length, 0);
});
