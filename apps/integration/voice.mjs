import { randomUUID } from 'node:crypto';
import { createLinxSession } from '../../packages/voice/src/index.js';

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
    requests.set(entry.key, { fingerprint: entry.fingerprint, closed: true, expiresAt: Date.now() + 600000 });
  }
  const handler = async (req, res, owner, service) => {
    if (service.onAuthorizationChange && !subscriptions.has(service)) {
      subscriptions.set(service, service.onAuthorizationChange(() => {
        for (const entry of sessions.values()) {
          try { service.authorize(`Bearer ${entry.owner}`); } catch { close(entry); }
        }
      }));
    }
    const url = new URL(req.url, 'http://localhost');
    const match = url.pathname.match(/^\/api\/voice\/sessions(?:\/([a-f\d-]+)(?:\/(audio|stop|events))?)?$/);
    if (!match) fail(404, 'Unknown voice endpoint');
    if (!config) fail(503, 'Linx AI credentials are not configured');
    const [, id, action] = match;
    if (!id && req.method === 'POST') {
      let body;
      try { body = JSON.parse((await read(req, 4096)).toString()); } catch (error) {
        if (error.status) throw error;
        fail(400, 'Invalid voice request');
      }
      if (!body || typeof body.requestId !== 'string' || !body.requestId.trim() || body.requestId.length > 128) fail(400, 'Invalid voice request ID');
      const key = `${owner}:${body.requestId}`;
      const fingerprint = JSON.stringify([body.taskId, body.version]);
      for (const [requestKey, record] of requests) if (record.expiresAt < Date.now()) requests.delete(requestKey);
      if (requests.has(key)) {
        const previous = requests.get(key);
        if (previous.fingerprint !== fingerprint || previous.closed) fail(409, 'Voice request changed or expired; begin a new recording');
        await previous.ready;
        return send(res, previous.response);
      }
      if (body.taskId !== null) {
        if (typeof body.taskId !== 'string' || !Number.isInteger(body.version)) fail(400, 'Invalid task target');
        if (service.get(body.taskId).version !== body.version) fail(409, 'Task version changed');
      } else if (body.version !== null) fail(400, 'New task must have a null version');
      if (requests.size >= maxEntries || sessions.size >= maxEntries) fail(429, 'Recording history is full; retry after the retention window');
      // One physical Linx device identity is configured; overlapping sessions are not assumed safe.
      if ([...sessions.values()].some(entry => !entry.closed)) fail(429, 'Another recording is active');
      const entry = { id: randomUUID(), key, owner, fingerprint, expiresAt: Date.now() + 600000, events: [], seq: 0, bytes: 0, stopped: false, closed: false };
      entry.response = { id: entry.id, inputFormat: { sampleRate: 16000, channels: 1, encoding: 'pcm_s16le' }, outputSupported: false };
      const emit = event => {
        if (entry.closed || !['stt', 'tts', 'error', 'ready'].includes(event.type)) return;
        entry.events.push({ seq: ++entry.seq, type: event.type,
          ...(typeof event.text === 'string' ? { text: event.text.slice(0, 4096) } : {}),
          ...(typeof event.state === 'string' ? { state: event.state.slice(0, 64) } : {}),
          ...(typeof event.message === 'string' ? { message: event.message.slice(0, 200) } : {}) });
        if (entry.events.length > 48) entry.events.shift();
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
          entry.session = sessionFactory({ config, onEvent: emit, tools: [] });
          await entry.session.connect();
          if (entry.closed) fail(503, 'Voice connection closed');
          entry.session.startListening();
        } catch {
          close(entry);
          fail(503, 'Unable to start Linx AI voice session');
        }
      })();
      await entry.ready;
      return send(res, entry.response);
    }
    const entry = sessions.get(id);
    if (!entry || entry.owner !== owner) fail(404, 'Unknown voice session');
    if (req.method === 'GET' && action === 'events') {
      const after = Number(url.searchParams.get('after') ?? 0);
      if (!Number.isSafeInteger(after) || after < 0 || after > entry.seq) fail(400, 'Invalid voice event cursor');
      return send(res, { events: entry.events.filter(event => event.seq > after), cursor: entry.seq });
    }
    if (req.method === 'DELETE' && !action) { close(entry); return send(res, { closed: true }); }
    if (entry.closed) fail(409, 'Voice session is closed');
    await entry.ready;
    if (req.method === 'POST' && action === 'stop') {
      if (!entry.stopped) { entry.session.stopListening(); entry.stopped = true; }
      return send(res, { stopped: true });
    }
    if (req.method === 'POST' && action === 'audio') {
      if (entry.stopped) fail(409, 'Recording already stopped');
      if (req.headers['content-type'] !== 'application/octet-stream') fail(400, 'Expected PCM binary audio');
      const audio = await read(req, 32000);
      if (entry.closed) fail(409, 'Voice session is closed');
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
