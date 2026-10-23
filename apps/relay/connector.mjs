import {request as httpRequest} from 'node:http';
import {randomUUID} from 'node:crypto';
import WebSocket from 'ws';
import {credentials,bounded,route,bearer,requestType,decodeBody,responseType,readBody,atCapacity,DEFAULT_BODY_LIMIT,DEFAULT_RESPONSE_LIMIT,FRAME_LIMIT} from './protocol.mjs';

function loopback(hostname) { return ['localhost','127.0.0.1','[::1]'].includes(hostname); }
export function createConnector(options) {
  const {machineId,machineKey} = options; credentials(machineId,machineKey);
  let relay,bridge;
  try { relay = new URL(options.relayURL); bridge = new URL(options.bridgeURL); } catch { throw new Error('Invalid relay or bridge URL'); }
  if (relay.pathname !== '/connector' || relay.search || relay.hash || relay.username || relay.password || (relay.protocol !== 'wss:' && !(relay.protocol === 'ws:' && loopback(relay.hostname)))) throw new Error('Relay must use WSS (loopback WS is development only)');
  if (bridge.protocol !== 'http:' || !loopback(bridge.hostname) || bridge.username || bridge.password || bridge.pathname !== '/' || bridge.search || bridge.hash) throw new Error('Bridge must be a fixed loopback HTTP origin');
  const timeout = bounded(options.requestTimeoutMs,14000,60000);
  const heartbeatInterval = bounded(options.heartbeatIntervalMs,15000,60000);
  const heartbeatTimeout = bounded(options.heartbeatTimeoutMs,10000,60000);
  const inflight = new Map(), seen = new Set();
  let socket,closed = false,retryTimer,retries = 0,startPromise,resolveStart,rejectStart;
  const notify = status => { try { options.onStatus?.(status); } catch { /* UI callback cannot break reconnect. */ } };
  function respond(ws,id,status,contentType,body) { if (socket === ws && ws.readyState === WebSocket.OPEN) { if (ws.bufferedAmount > FRAME_LIMIT * 2) return ws.terminate(); ws.send(JSON.stringify({type:'response',id,status,contentType,body:body.toString('base64')})); } }
  function failure(ws,id,status,message) { respond(ws,id,status,'application/json',Buffer.from(JSON.stringify({error:{code:status===504?'timeout':'unavailable',message}}))); }
  function retire(id) { const entry = inflight.get(id); if (entry) { inflight.delete(id); clearTimeout(entry.timer); } return entry; }
  function cancel(id) { const entry = retire(id); entry?.request.destroy(); entry?.response?.destroy(); }
  function forward(ws,message) {
    const allowed = route(message.method,message.path);
    if (!allowed || allowed.error || typeof message.id !== 'string' || !/^[\da-f-]{36}$/.test(message.id) || seen.has(message.id) || !requestType(message.method,allowed.kind,message.contentType) || (!allowed.public && (!bearer(message.authorization) || message.authorization === `Bearer ${machineKey}`)) || (allowed.public && message.authorization !== undefined)) return ws.terminate();
    let body;
    try { body = decodeBody(message.body,DEFAULT_BODY_LIMIT); if (message.method !== 'POST' && body.length) throw new Error('Unexpected body'); } catch { return ws.terminate(); }
    seen.add(message.id); if (seen.size > 2048) seen.delete(seen.values().next().value);
    if (atCapacity(inflight,allowed.media)) return failure(ws,message.id,503,'Connector is busy');
    const headers = {};
    if (message.authorization) headers.authorization = message.authorization;
    if (message.contentType) headers['content-type'] = message.contentType;
    headers['content-length'] = body.length;
    const local = httpRequest(new URL(message.path,bridge),{method:message.method,headers},async res => {
      const entry = inflight.get(message.id);
      if (!entry) { res.destroy(); return; }
      entry.response = res;
      try {
        const data = await readBody(res,DEFAULT_RESPONSE_LIMIT);
        if (!retire(message.id)) return;
        if (!responseType(res.headers['content-type'])) return failure(ws,message.id,502,'Unsupported bridge response');
        respond(ws,message.id,res.statusCode,res.headers['content-type'],data);
      } catch { if (retire(message.id)) failure(ws,message.id,502,'Bridge response too large or unavailable'); res.destroy(); }
    });
    const timer = setTimeout(() => { if (inflight.has(message.id)) { cancel(message.id); failure(ws,message.id,504,'Bridge request timed out'); } },timeout);
    inflight.set(message.id,{request:local,timer,media:allowed.media});
    local.on('error',() => { if (retire(message.id)) failure(ws,message.id,502,'Bridge request failed'); });
    local.end(body);
  }
  function connect() {
    if (closed) return;
    notify('connecting');
    const ws = new WebSocket(relay.href,{headers:{authorization:`Bearer ${machineKey}`,'x-voxcode-machine-id':machineId},ca:options.ca,rejectUnauthorized:true,minVersion:'TLSv1.2',followRedirects:false,maxPayload:FRAME_LIMIT,perMessageDeflate:false,handshakeTimeout:10000}); socket = ws;
    let heartbeatTimer,pongTimer,ping;
    const clearHeartbeat = () => { clearInterval(heartbeatTimer); clearTimeout(pongTimer); heartbeatTimer = pongTimer = ping = undefined; };
    ws.on('pong',data => { if (ping && data.equals(ping)) { clearTimeout(pongTimer); pongTimer = ping = undefined; } });
    ws.on('open',() => {
      retries = 0;
      heartbeatTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN || pongTimer) return;
        ping = Buffer.from(randomUUID());
        pongTimer = setTimeout(() => { notify('connection_timeout'); ws.terminate(); },heartbeatTimeout);
        pongTimer.unref();
        try { ws.ping(ping); } catch { ws.terminate(); }
      },heartbeatInterval);
      heartbeatTimer.unref();
      resolveStart?.(); resolveStart = rejectStart = undefined; notify('connected');
    });
    ws.on('message',(data,binary) => {
      if (binary) return ws.terminate();
      let message; try { message = JSON.parse(data.toString()); } catch { return ws.terminate(); }
      if (message?.type === 'cancel' && typeof message.id === 'string') { cancel(message.id); return; }
      if (message?.type !== 'request') return ws.terminate();
      forward(ws,message);
    });
    ws.on('error',() => { notify('connection_error'); });
    ws.on('close',() => {
      clearHeartbeat();
      for (const id of inflight.keys()) cancel(id);
      notify(closed?'closed':'offline');
      if (!closed && options.reconnect !== false) { retryTimer = setTimeout(connect,Math.min(30000,500*2**Math.min(retries++,6)) + Math.floor(Math.random()*250)); }
      else if (!closed) { rejectStart?.(new Error('Relay connection failed')); resolveStart = rejectStart = undefined; }
    });
  }
  return {
    start() { if (closed) return Promise.reject(new Error('Connector is closed')); if (!startPromise) { startPromise = new Promise((resolve,reject) => { resolveStart=resolve; rejectStart=reject; }); connect(); } return startPromise; },
    get connected() { return socket?.readyState === WebSocket.OPEN; },
    async close() { if (closed) return; closed = true; clearTimeout(retryTimer); rejectStart?.(new Error('Connector closed')); resolveStart = rejectStart = undefined; for (const id of inflight.keys()) cancel(id); if (socket && socket.readyState !== WebSocket.CLOSED) { await new Promise(resolve => { socket.once('close',resolve); socket.terminate(); }); } },
  };
}
