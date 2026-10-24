import { randomUUID } from 'node:crypto';
import { createLinxSession } from '../../packages/voice/src/index.js';
import { createOutputDecoder } from '../../packages/voice/src/audio.js';
import { createVoiceTools } from './voice-tools.mjs';

function fail(status, message) { throw Object.assign(new Error(message), { status, code: 'voice_error' }); }
async function read(req, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, 'Voice payload too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function send(res, value) {
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

export function createVoiceHandler({ config, sessionFactory = createLinxSession, ttlMs = 120000, maxEntries = 32 }) {
  const sessions = new Map();
  const requests = new Map();
  const subscriptions = new Map();
  function close(entry) {
    if (entry.closed) return;
    entry.closed = true; entry.session?.close(); entry.session = null;
    entry.decoder?.close(); entry.decoder = null; entry.drafts.clear();
    entry.events.length = 0; entry.eventBytes = 0;
    requests.set(entry.key, { fingerprint: entry.fingerprint, closed: true, expiresAt: Date.now() + 600000 });
  }
  const handler = async (req, res, owner, service) => {
    if (service.onAuthorizationChange && !subscriptions.has(service)) {
      subscriptions.set(service, service.onAuthorizationChange(() => {
        for (const entry of sessions.values()) {
          if (entry.service !== service) continue;
          try { service.authorize(`Bearer ${entry.owner}`); } catch { close(entry); }
        }
      }));
    }
    const url = new URL(req.url, 'http://localhost');
    const match = url.pathname.match(/^\/api\/voice\/sessions(?:\/([a-f\d-]+)(?:\/(audio|stop|abort|events))?)?$/);
    if (!match) fail(404, 'Unknown voice endpoint');
    if (!config) fail(503, 'Linx AI credentials are not configured');
    const [, id, action] = match;
    if (!id && req.method === 'POST') {
      let body;
      try { body = JSON.parse((await read(req, 4096)).toString()); } catch (error) {
        if (error.status) throw error;
        fail(400, 'Invalid voice request');
      }
      service.authorize?.(`Bearer ${owner}`);
      if (!body || typeof body.requestId !== 'string' || !body.requestId.trim() || body.requestId.length > 128) fail(400, 'Invalid voice request ID');
      const key = `${owner}:${body.requestId}`;
      const fingerprint = JSON.stringify([body.taskId, body.version]);
      for (const [requestKey, record] of requests) if (record.expiresAt < Date.now()) requests.delete(requestKey);
      if (requests.has(key)) {
        const previous = requests.get(key);
        if (previous.fingerprint !== fingerprint || previous.closed) fail(409, 'Voice request changed or expired; begin a new recording');
        await previous.ready;
        service.authorize?.(`Bearer ${owner}`);
        if (previous.closed) fail(409, 'Voice session is closed');
        return send(res, previous.response);
      }
      if (body.taskId !== null) {
        if (typeof body.taskId !== 'string' || !Number.isInteger(body.version)) fail(400, 'Invalid task target');
        if (service.get(body.taskId).version !== body.version) fail(409, 'Task version changed');
      } else if (body.version !== null) fail(400, 'New task must have a null version');
      if (requests.size >= maxEntries || sessions.size >= maxEntries) fail(429, 'Recording history is full; retry after the retention window');
      // One physical Linx device identity is configured; overlapping sessions are not assumed safe.
      if ([...sessions.values()].some(entry => !entry.closed)) fail(429, 'Another recording is active');
      const entry = { id: randomUUID(), key, owner, service, taskId: body.taskId, version: body.version, fingerprint,
        expiresAt: Date.now() + ttlMs, events: [], eventBytes: 0, drafts: new Map(), seq: 0, bytes: 0, stopped: false, aborted: false, closed: false };
      entry.response = { id: entry.id, inputFormat: { sampleRate: 16000, channels: 1, encoding: 'pcm_s16le' }, outputFormat: null, outputSupported: false };
      const emit = event => {
        if (entry.closed || !['stt', 'tts', 'audio', 'draft', 'focus', 'error', 'ready'].includes(event.type)) return;
        if (event.type === 'ready' && event.audioParams) {
          try {
            entry.decoder = createOutputDecoder(event.audioParams);
            entry.response.outputFormat = entry.decoder.format;
            entry.response.outputSupported = true;
          } catch { emit({ type: 'error', message: 'Unsupported voice output format' }); return; }
        }
        let audio;
        if (event.type === 'audio') {
          if (entry.aborted || !entry.decoder) return;
          try { audio = entry.decoder.decode(event.data).toString('base64'); }
          catch { emit({ type: 'error', message: 'Unable to decode voice output' }); return; }
        }
        const value = { seq: ++entry.seq, type: event.type,
          ...(typeof event.text === 'string' ? { text: event.text.slice(0, 4096) } : {}),
          ...(typeof event.state === 'string' ? { state: event.state.slice(0, 64) } : {}),
          ...(typeof event.is_aborted === 'boolean' ? { is_aborted: event.is_aborted } : {}),
          ...(audio ? { data: audio } : {}),
          ...(event.type === 'draft' ? { draft: structuredClone(event.draft) } : {}),
          ...(event.type === 'focus' ? { taskId: event.taskId } : {}),
          ...(typeof event.message === 'string' ? { message: event.message.slice(0, 200) } : {}) };
        entry.events.push(value); entry.eventBytes += Buffer.byteLength(JSON.stringify(value));
        while (entry.events.length > 256 || entry.eventBytes > 1048576) entry.eventBytes -= Buffer.byteLength(JSON.stringify(entry.events.shift()));
        if (event.type === 'error') close(entry);
      };
      sessions.set(entry.id, entry); requests.set(key, entry);
      entry.timer = setTimeout(() => {
        emit({ type: 'error', message: 'Recording expired; start a new recording' });
        close(entry);
        sessions.delete(entry.id);
      }, ttlMs).unref();
      entry.ready = (async () => {
        try {
          const context = { voxcode_target: JSON.stringify({ taskId: entry.taskId, version: entry.version }),
            voxcode_policy: 'Use read-only tools for actual progress. Propose drafts only. The phone user must confirm execution, operations and acceptance.' };
          entry.session = sessionFactory({ config: { ...config, promptContext: context }, onEvent: emit, tools: createVoiceTools({ entry, service, emit }) });
          await entry.session.connect();
          if (entry.closed) fail(503, 'Voice connection closed');
          entry.session.startListening();
        } catch {
          close(entry);
          fail(503, 'Unable to start Linx AI voice session');
        }
      })();
      await entry.ready;
      service.authorize?.(`Bearer ${owner}`);
      if (entry.closed) fail(409, 'Voice session is closed');
      return send(res, entry.response);
    }
    const entry = sessions.get(id);
    if (!entry || entry.owner !== owner) fail(404, 'Unknown voice session');
    if (req.method === 'DELETE' && !action) { close(entry); return send(res, { closed: true }); }
    if (entry.closed) fail(409, 'Voice session is closed');
    if (req.method === 'GET' && action === 'events') {
      const after = Number(url.searchParams.get('after') ?? 0);
      if (!Number.isSafeInteger(after) || after < 0 || after > entry.seq) fail(400, 'Invalid voice event cursor');
      if (entry.events.length && after < entry.events[0].seq - 1)
        throw Object.assign(new Error('Voice events expired; start a new recording'), { status: 409, code: 'cursor_expired' });
      return send(res, { events: entry.events.filter(event => event.seq > after), cursor: entry.seq });
    }
    await entry.ready;
    service.authorize?.(`Bearer ${owner}`);
    if (entry.closed) fail(409, 'Voice session is closed');
    if (req.method === 'POST' && action === 'abort') {
      if (!entry.aborted) {
        entry.session.abort(); entry.aborted = true; entry.stopped = true;
        entry.decoder?.close(); entry.decoder = null;
      }
      return send(res, { aborted: true });
    }
    if (req.method === 'POST' && action === 'stop') {
      if (!entry.stopped) { entry.session.stopListening(); entry.stopped = true; }
      return send(res, { stopped: true });
    }
    if (req.method === 'POST' && action === 'audio') {
      if (entry.stopped) fail(409, 'Recording already stopped');
      if (req.headers['content-type'] !== 'application/octet-stream') fail(400, 'Expected PCM binary audio');
      const audio = await read(req, 32000);
      service.authorize?.(`Bearer ${owner}`);
      if (entry.closed) fail(409, 'Voice session is closed');
      if (entry.stopped) fail(409, 'Recording already stopped');
      if (!audio.length || audio.length % 2) fail(400, 'Expected PCM int16 samples');
      if (entry.bytes + audio.length > 32000 * 60) { close(entry); fail(413, 'Recording exceeds 60 seconds'); }
      try { entry.session.sendAudio(audio); } catch { close(entry); fail(503, 'Audio upload failed'); }
      entry.bytes += audio.length;
      return send(res, { accepted: true });
    }
    fail(404, 'Unknown voice endpoint');
  };
  handler.close = () => {
    for (const unsubscribe of subscriptions.values()) unsubscribe();
    subscriptions.clear();
    for (const entry of sessions.values()) { close(entry); clearTimeout(entry.timer); }
    sessions.clear(); requests.clear();
  };
  return handler;
}
