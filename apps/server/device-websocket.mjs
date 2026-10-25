import {Server as HttpsServer} from 'node:https';
import WebSocket, {WebSocketServer} from 'ws';
import {MAX_RESULT_BYTES} from '../../packages/control-protocol/index.mjs';

const fail = message => Error(message);
const bounded = (value, maximum) => Number.isSafeInteger(value) && value > 0 && value <= maximum;

export function attachDeviceWebSocket({server, gateway, path = '/agent', publicOrigin, limits = {}} = {}) {
  if (!(server instanceof HttpsServer)) throw fail('HTTPS listener required');
  if (server.listenerCount('upgrade')) throw fail('Exclusive HTTPS upgrade listener required');
  if (typeof gateway?.connect !== 'function' || !/^\/[a-zA-Z0-9/_-]+$/u.test(path)) throw fail('Gateway and exact upgrade path required');
  let origin;
  try {origin = new URL(publicOrigin);} catch {throw fail('Canonical HTTPS publicOrigin required');}
  if (origin.protocol !== 'https:' || origin.origin !== publicOrigin) throw fail('Canonical HTTPS publicOrigin required');
  const defaults = {maxSockets: 32, maxUnauthenticated: 8, maxPayloadBytes: MAX_RESULT_BYTES + 2048, maxPendingMessages: 8, registrationTimeoutMs: 5000, idleTimeoutMs: 45000, shutdownTimeoutMs: 1000, sendTimeoutMs: 1000};
  if (!limits || typeof limits !== 'object' || Array.isArray(limits) || Object.keys(limits).some(key => !Object.hasOwn(defaults, key))) throw fail('Invalid device WebSocket limits');
  const cap = {...defaults, ...limits, maxUnauthenticated: Object.hasOwn(limits, 'maxUnauthenticated') ? limits.maxUnauthenticated : Math.min(defaults.maxUnauthenticated, limits.maxSockets ?? defaults.maxSockets)};
  if (!bounded(cap.maxSockets, 1024) || !bounded(cap.maxUnauthenticated, cap.maxSockets) || !bounded(cap.maxPayloadBytes, defaults.maxPayloadBytes) || !bounded(cap.maxPendingMessages, 64) || !bounded(cap.registrationTimeoutMs, 30000) || !bounded(cap.idleTimeoutMs, 120000) || !bounded(cap.shutdownTimeoutMs, 10000) || !bounded(cap.sendTimeoutMs, 10000)) throw fail('Invalid device WebSocket limits');
  const wss = new WebSocketServer({noServer: true, clientTracking: false, perMessageDeflate: false, maxPayload: cap.maxPayloadBytes});
  const entries = new Set(), waiters = new Set();
  let shuttingDown = false, closing;
  const retire = entry => {
    if (!entry.socketClosed || entry.authenticating || entry.pending || entry.handle && !entry.handleClosed) return;
    clearTimeout(entry.deadline); clearTimeout(entry.idleDeadline); clearTimeout(entry.forceTimer);
    entries.delete(entry);
    if (entries.size === 0) for (const notify of waiters) notify();
  };
  const cleanupHandle = entry => {
    if (!entry.handle || entry.cleanup) return;
    entry.cleanup = Promise.resolve().then(() => entry.handle.close()).catch(() => {}).finally(() => {entry.handleClosed = true; retire(entry);});
  };
  const drop = (entry, code = 1008, reason = 'Device connection rejected') => {
    if (!entry.closed) {
      entry.closed = true;
      clearTimeout(entry.deadline);
      clearTimeout(entry.idleDeadline);
      if (entry.ws?.readyState === WebSocket.OPEN) entry.ws.close(code, reason);
      else if (!entry.ws) entry.socket.destroy();
      entry.forceTimer = setTimeout(() => {entry.ws?.terminate(); entry.socket.destroy();}, cap.shutdownTimeoutMs);
      entry.forceTimer.unref?.();
    }
    cleanupHandle(entry);
    retire(entry);
  };
  const renewIdleDeadline = entry => {
    clearTimeout(entry.idleDeadline);
    if (entry.closed) return;
    entry.idleDeadline = setTimeout(() => drop(entry, 1008, 'Device idle deadline reached'), cap.idleTimeoutMs);
    entry.idleDeadline.unref?.();
  };
  const socketClosed = entry => {
    entry.socketClosed = true;
    drop(entry);
    clearTimeout(entry.forceTimer);
    retire(entry);
  };
  const send = (entry, value) => new Promise((resolve, reject) => {
    if (entry.closed || entry.ws?.readyState !== WebSocket.OPEN) return reject(fail('Device transport unavailable'));
    let raw;
    try {raw = JSON.stringify(value); if (Buffer.byteLength(raw) > cap.maxPayloadBytes || entry.ws.bufferedAmount > 2 * cap.maxPayloadBytes) throw fail('Device transport capacity reached');}
    catch {drop(entry, 1013, 'Device transport capacity reached'); return reject(fail('Device transport capacity reached'));}
    let settled = false;
    const finish = error => {if (settled) return; settled = true; clearTimeout(timer); error ? reject(fail('Device delivery failed')) : resolve();};
    const timer = setTimeout(() => {drop(entry, 1013, 'Device delivery deadline reached'); finish(fail('Device delivery deadline reached'));}, cap.sendTimeoutMs);
    try {entry.ws.send(raw, finish);} catch {finish(fail('Device delivery failed'));}
  });
  function message(entry, data, binary) {
    if (entry.closed || shuttingDown) return;
    if (binary) return drop(entry, 1003, 'Text control frames required');
    if (Buffer.byteLength(data) > cap.maxPayloadBytes) return drop(entry, 1009, 'Device frame too large');
    if (entry.pending >= cap.maxPendingMessages) return drop(entry, 1013, 'Device pending capacity reached');
    const text = data.toString('utf8');
    let registration;
    if (!entry.registerQueued) {
      try {registration = JSON.parse(text);} catch {return drop(entry, 1007, 'Invalid control JSON');}
      if (registration?.type !== 'register') return drop(entry, 1008, 'Device registration required');
      entry.registerQueued = true;
    }
    entry.pending++;
    entry.queue = entry.queue.then(async () => {
      if (entry.closed) return;
      if (registration) {
        entry.authenticating = true;
        try {
          const handle = await gateway.connect(registration, {send: value => send(entry, value)});
          if (!handle || typeof handle.receive !== 'function' || typeof handle.close !== 'function') throw fail('Invalid gateway handle');
          entry.handle = handle;
          entry.preauth = false;
          clearTimeout(entry.deadline);
          renewIdleDeadline(entry);
          if (entry.closed) cleanupHandle(entry);
        } finally {entry.authenticating = false; retire(entry);}
      } else {
        if (!entry.handle) throw fail('Authenticated gateway handle required');
        await entry.handle.receive(text);
        renewIdleDeadline(entry);
      }
    }).catch(() => drop(entry, 1008, 'Device control request rejected')).finally(() => {entry.pending--; retire(entry);});
  }
  function reject(socket, status) {
    if (socket.destroyed) return;
    socket.on('error', () => {});
    socket.end('HTTP/1.1 ' + status + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  }
  function upgrade(request, socket, head) {
    if (shuttingDown) return reject(socket, '503 Service Unavailable');
    if (request.url !== path) return reject(socket, '404 Not Found');
    if (request.headers.origin !== undefined && request.headers.origin !== publicOrigin) return reject(socket, '403 Forbidden');
    if (entries.size >= cap.maxSockets || [...entries].filter(entry => entry.preauth).length >= cap.maxUnauthenticated) return reject(socket, '503 Service Unavailable');
    const entry = {socket, ws: null, preauth: true, closed: false, socketClosed: false, registerQueued: false, authenticating: false, handle: null, handleClosed: false, cleanup: null, pending: 0, queue: Promise.resolve()};
    entries.add(entry);
    socket.once('close', () => socketClosed(entry));
    socket.on('error', () => drop(entry));
    entry.deadline = setTimeout(() => drop(entry, 1008, 'Device registration deadline reached'), cap.registrationTimeoutMs);
    entry.deadline.unref?.();
    try {
      wss.handleUpgrade(request, socket, head, ws => {
        entry.ws = ws;
        ws.on('message', (data, binary) => message(entry, data, binary));
        ws.on('error', () => drop(entry));
        ws.once('close', () => socketClosed(entry));
        if (entry.closed || shuttingDown) drop(entry);
      });
    } catch {drop(entry); socket.destroy();}
  }
  const onServerClose = () => {void close();};
  server.on('upgrade', upgrade);
  server.once('close', onServerClose);
  function close() {
    if (closing) return closing;
    shuttingDown = true;
    server.off('upgrade', upgrade);
    server.off('close', onServerClose);
    closing = (async () => {
      for (const entry of entries) drop(entry, 1001, 'Server shutdown');
      if (entries.size) await new Promise(resolve => {
        let timer;
        const done = () => {clearTimeout(timer); waiters.delete(done); resolve();};
        waiters.add(done);
        timer = setTimeout(() => {
          for (const entry of entries) {entry.ws?.terminate(); entry.socket.destroy(); cleanupHandle(entry);}
          done();
        }, cap.shutdownTimeoutMs);
      });
      await new Promise(resolve => wss.close(resolve));
    })();
    return closing;
  }
  return {close};
}
