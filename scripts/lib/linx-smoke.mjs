import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';

const MAX_INPUT = 32000 * 60;
const MAX_RESPONSE = 2 * 1024 * 1024;
const SESSION = '/api/voice/sessions';
class SmokeError extends Error { constructor(category) { super(category); this.category = category; } }
const fail = category => { throw new SmokeError(category); };
const category = error => error instanceof SmokeError ? error.category : 'local_error';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const idValid = value => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(value);
const formatValid = value => object(value) && value.format === 'pcm' && [16000, 24000].includes(value.sample_rate) && value.channels === 1;

function optionsFor(options) {
  const limits = { deadlineMs: [90000, 1, 120000], requestTimeoutMs: [10000, 1, 15000],
    cleanupTimeoutMs: [2000, 1, 5000], pollIntervalMs: [500, 1, 5000], maxPolls: [180, 1, 600] };
  const values = {};
  for (const [key, [fallback, min, max]] of Object.entries(limits)) {
    values[key] = options[key] ?? fallback;
    if (!Number.isInteger(values[key]) || values[key] < min || values[key] > max) fail('invalid_options');
  }
  // A literal address avoids DNS rebinding; remote TLS/Relay access is deliberately outside this client.
  if (typeof options.origin !== 'string' || !/^http:\/\/(?:127\.0\.0\.1|\[::1\])(?::[1-9]\d{0,4})?\/?$/.test(options.origin)) fail('invalid_origin');
  try { values.origin = new URL(options.origin).origin; } catch { fail('invalid_origin'); }
  if (typeof options.token !== 'string' || !/^[A-Za-z0-9._~+/-]+={0,}$/.test(options.token) || options.token.length > 4096) fail('invalid_bearer');
  if (options.synthetic !== true || typeof options.input !== 'string' || !options.input) fail('invalid_input');
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) fail('invalid_options');
  return values;
}

async function readInput(path) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 2 || stat.size > MAX_INPUT || stat.size % 2) fail('invalid_input');
    // Bounded even if the file grows between stat and read; never follow a stream indefinitely.
    const bytes = Buffer.alloc(stat.size + 2);
    let count = 0;
    while (count < bytes.length) {
      const { bytesRead } = await file.read(bytes, count, bytes.length - count, null);
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count !== stat.size) fail('invalid_input');
    return bytes.subarray(0, count);
  } catch { fail('invalid_input'); }
  finally { await file?.close(); }
}

async function request(origin, token, path, { method = 'GET', body, signal, timeoutMs }) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetch(origin + path, { method, redirect: 'manual', signal: combined,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : {
        'content-type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json' }) },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
    if (response.status >= 300 && response.status < 400) fail('redirect_rejected');
    if (!response.ok) {
      const known = { 401: 'unauthorized', 403: 'unauthorized', 409: 'session_unavailable', 429: 'rate_limited', 503: 'service_unavailable' };
      fail(known[response.status] ?? 'http_error');
    }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_RESPONSE) fail('invalid_response');
      chunks.push(chunk);
    }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('invalid_response'); }
    if (!object(value)) fail('invalid_response');
    return value;
  } catch (error) {
    if (signal?.aborted) fail('interrupted');
    if (timeout.aborted) fail('timeout');
    if (error instanceof SmokeError) throw error;
    fail('network_error');
  } finally {
    try { await response?.body?.cancel(); } catch { /* Body may already be consumed or aborted. */ }
  }
}

function observe(batch, cursor, result, sampleRate) {
  if (!Array.isArray(batch.events) || batch.events.length > 256 || !Number.isSafeInteger(batch.cursor) || batch.cursor < cursor) fail('invalid_response');
  let previous = cursor;
  for (const event of batch.events) {
    if (!object(event) || !Number.isSafeInteger(event.seq) || event.seq !== previous + 1 || event.seq > batch.cursor) fail('invalid_response');
    previous = event.seq;
    if (typeof event.type !== 'string' || !Object.hasOwn(result.observed, event.type)) fail('invalid_response');
    if (event.type === 'error') { result.observed.error++; fail('provider_error'); }
    if (event.type === 'stt' && !text(event.text, 4096)) continue;
    if (event.type === 'draft') {
      const draft = event.draft;
      if (!object(draft) || !text(draft.id, 128) || draft.taskId !== null || draft.version !== null ||
        !text(draft.title, 120) || !text(draft.prompt, 12000) || !Array.isArray(draft.criteria) ||
        draft.criteria.length < 1 || draft.criteria.length > 12 ||
        !draft.criteria.every(item => object(item) && text(item.text, 500) && typeof item.required === 'boolean') ||
        typeof draft.expiresAt !== 'string' || !Number.isFinite(Date.parse(draft.expiresAt)) || Date.parse(draft.expiresAt) <= Date.now()) fail('invalid_response');
    }
    if (event.type === 'audio') {
      if (typeof event.data !== 'string' || event.data.length === 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.data)) fail('invalid_response');
      const decodedBytes = Buffer.from(event.data, 'base64').length;
      if (decodedBytes % 2 !== 0 || decodedBytes > sampleRate * 2 * 0.12) fail('invalid_response');
    }
    if (event.type === 'tts' && typeof event.state !== 'string') fail('invalid_response');
    if (event.type === 'focus' && !text(event.taskId, 128)) fail('invalid_response');
    result.observed[event.type]++;
  }
  if (previous !== batch.cursor) fail('invalid_response');
  return batch.cursor;
}

/** Uses existing authenticated loopback HTTP routes. Returns only a fixed, redacted schema. */
export async function runLinxSmoke(options = {}) {
  const result = { passed: false, evidence: 'local_http', provider: 'not_independently_verified', reason: 'local_error',
    readiness: { voiceConfigured: null },
    observed: { ready: 0, stt: 0, draft: 0, audio: 0, tts: 0, focus: 0, error: 0 },
    stages: { handshake: 'not_observed', stt: 'not_observed', draft: 'not_observed', audio: 'not_observed', tools: 'manual_required', playback: 'manual_required' },
    cleanup: { abort: 'not_needed', close: 'not_needed' } };
  let config, id, createAttempted = false, recover = false, negotiated = false;
  let createBody;
  try {
    config = optionsFor(options);
    const input = await readInput(options.input);
    const deadline = AbortSignal.timeout(config.deadlineMs);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    const call = async (path, method, body) => {
      try { return await request(config.origin, options.token, path, { method, body, signal, timeoutMs: config.requestTimeoutMs }); }
      catch (error) { if (deadline.aborted && !options.signal?.aborted) fail('timeout'); throw error; }
    };
    const health = await call('/api/health');
    if (typeof health.voiceConfigured !== 'boolean') fail('invalid_response');
    result.readiness.voiceConfigured = health.voiceConfigured;
    if (!health.voiceConfigured) fail('not_configured');
    createBody = { requestId: randomUUID(), taskId: null, version: null };
    createAttempted = true;
    const created = await call(SESSION, 'POST', createBody);
    if (!idValid(created.id)) fail('invalid_response');
    id = created.id;
    if (created.inputFormat?.sampleRate !== 16000 || created.inputFormat?.channels !== 1 || created.inputFormat?.encoding !== 'pcm_s16le') fail('invalid_response');
    negotiated = created.outputSupported === true && formatValid(created.outputFormat);
    if (!negotiated) fail('output_unsupported');
    // 100 ms blocks retain PCM boundaries; pace uploads so a 60 s input is not burst into the provider.
    for (let offset = 0; offset < input.length; offset += 3200) {
      if (offset) await pause(100, undefined, { signal }).catch(() => { fail(options.signal?.aborted ? 'interrupted' : 'timeout'); });
      const value = await call(`${SESSION}/${id}/audio`, 'POST', input.subarray(offset, offset + 3200));
      if (value.accepted !== true) fail('invalid_response');
    }
    if ((await call(`${SESSION}/${id}/stop`, 'POST', {})).stopped !== true) fail('invalid_response');
    let cursor = 0;
    for (let polls = 0; polls < config.maxPolls; polls++) {
      const batch = await call(`${SESSION}/${id}/events?after=${cursor}`);
      cursor = observe(batch, cursor, result, created.outputFormat.sample_rate);
      if (result.observed.ready && result.observed.stt && result.observed.draft && result.observed.audio) {
        result.passed = true; result.reason = 'observations_complete'; break;
      }
      if (polls === config.maxPolls - 1) fail('poll_limit');
      await pause(config.pollIntervalMs, undefined, { signal }).catch(() => { fail(options.signal?.aborted ? 'interrupted' : 'timeout'); });
    }
  } catch (error) {
    result.reason = category(error);
    recover = createAttempted && !id && ['network_error', 'timeout', 'interrupted', 'invalid_response'].includes(result.reason);
  } finally {
    // Independent, bounded requests survive caller cancellation. Replay only reconciles an uncertain create.
    const cleanupCall = (path, method, body) => request(config.origin, options.token, path, { method, body, timeoutMs: config.cleanupTimeoutMs });
    if (recover) {
      try {
        const created = await cleanupCall(SESSION, 'POST', createBody);
        if (idValid(created.id)) id = created.id;
      } catch { /* The bridge TTL is the remaining fallback if replay cannot identify the session. */ }
      if (!id) { result.cleanup.abort = 'unconfirmed'; result.cleanup.close = 'unconfirmed'; }
    }
    if (id) {
      try { result.cleanup.abort = (await cleanupCall(`${SESSION}/${id}/abort`, 'POST', {})).aborted === true ? 'confirmed' : 'failed'; }
      catch { result.cleanup.abort = 'failed'; }
      try { result.cleanup.close = (await cleanupCall(`${SESSION}/${id}`, 'DELETE')).closed === true ? 'confirmed' : 'failed'; }
      catch { result.cleanup.close = 'failed'; }
    }
    if (result.passed && (result.cleanup.abort !== 'confirmed' || result.cleanup.close !== 'confirmed')) {
      result.passed = false; result.reason = 'cleanup_failed';
    }
    result.stages.handshake = negotiated && result.observed.ready > 0 ? 'observed' : 'not_observed';
    for (const stage of ['stt', 'draft', 'audio']) result.stages[stage] = result.observed[stage] > 0 ? 'observed' : 'not_observed';
  }
  return result;
}
