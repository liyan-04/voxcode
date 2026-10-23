import {createServer} from 'node:http';
import {randomUUID, timingSafeEqual} from 'node:crypto';
import {WebSocketServer, WebSocket} from 'ws';
import {credentials,bounded,route,bearer,requestType,decodeBody,responseType,readBody,DEFAULT_BODY_LIMIT,DEFAULT_RESPONSE_LIMIT,FRAME_LIMIT,MAX_INFLIGHT} from './protocol.mjs';

export function createRelay(options) {
  const {machineId,machineKey} = options; credentials(machineId,machineKey);
  const maxBody = bounded(options.maxBodyBytes,DEFAULT_BODY_LIMIT,DEFAULT_BODY_LIMIT);
  const maxResponse = bounded(options.maxResponseBytes,DEFAULT_RESPONSE_LIMIT,DEFAULT_RESPONSE_LIMIT);
  const timeout = bounded(options.requestTimeoutMs,15000,60000);
  const pairLimit = bounded(options.pairLimit,5,100);
  let connector, closing = false;
  const pending = new Map(), expired = new Set();
  const rates = new Map();
  function rate(key,limit) {
    const now = Date.now(); let entry = rates.get(key);
    if (!entry || now - entry.start >= 60000) { entry = {start:now,count:0}; rates.set(key,entry); }
    return ++entry.count <= limit;
  }
  function sendError(res,status,message) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});
    res.end(JSON.stringify({error:{code:status===503?'unavailable':status===504?'timeout':status===401?'unauthenticated':status===429?'throttled':'invalid',message}}));
  }
  function retire(id) { expired.add(id); if (expired.size > 1024) expired.delete(expired.values().next().value); }
  function remove(id) { const entry = pending.get(id); if (entry) { pending.delete(id); clearTimeout(entry.timer); retire(id); } return entry; }
  function cancel(id) { if (connector?.readyState === WebSocket.OPEN) connector.send(JSON.stringify({type:'cancel',id})); }
  const server = createServer(async (req,res) => {
    const allowed = route(req.method,req.url);
    if (!allowed) { req.resume(); return sendError(res,404,'Unknown relay route'); }
    if (allowed.error) { req.resume(); return sendError(res,400,'Invalid query'); }
    const auth = req.headers.authorization;
    if (!allowed.public && (!bearer(auth) || auth === `Bearer ${machineKey}`)) { req.resume(); return sendError(res,401,'Phone session required'); }
    if (!requestType(req.method,allowed.kind,req.headers['content-type'])) { req.resume(); return sendError(res,415,'Unsupported content type'); }
    if ((allowed.kind === 'pair' && !rate('pair',pairLimit)) || (allowed.kind === 'health' && !rate('health',60))) { req.resume(); return sendError(res,429,'Relay request limit reached'); }
    if (closing || !connector || connector.readyState !== WebSocket.OPEN) { req.resume(); return sendError(res,503,'Mac is offline'); }
    if (pending.size >= MAX_INFLIGHT) { req.resume(); return sendError(res,429,'Too many in-flight requests'); }
    if (Number(req.headers['content-length']) > maxBody) { req.resume(); return sendError(res,413,'Request body too large'); }
    let body;
    try { body = await readBody(req,maxBody); } catch { return sendError(res,413,'Request body invalid or too large'); }
    if (req.method !== 'POST' && body.length) return sendError(res,400,'Unexpected request body');
    const target = connector;
    if (!target || target.readyState !== WebSocket.OPEN) return sendError(res,503,'Mac is offline');
    if (pending.size >= MAX_INFLIGHT) return sendError(res,429,'Too many in-flight requests');
    const id = randomUUID();
    const timer = setTimeout(() => { if (remove(id)) { sendError(res,504,'Mac request timed out'); cancel(id); } },timeout);
    pending.set(id,{res,timer,target});
    res.on('close', () => { if (remove(id)) cancel(id); });
    try { if (target.bufferedAmount > FRAME_LIMIT * 2) throw new Error('Backpressure'); target.send(JSON.stringify({type:'request',id,method:req.method,path:req.url,authorization:allowed.public?undefined:auth,contentType:req.headers['content-type'],body:body.toString('base64')})); }
    catch { remove(id); sendError(res,503,'Mac connection failed'); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxConnections = 128;
  const wss = new WebSocketServer({noServer:true,maxPayload:FRAME_LIMIT,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head) => {
    const reject = status => { socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); socket.destroy(); };
    if (req.url !== '/connector' || req.headers['x-voxcode-machine-id'] !== machineId || closing) return reject('401 Unauthorized');
    const auth = req.headers.authorization ?? ''; const expected = `Bearer ${machineKey}`;
    if (typeof auth !== 'string' || Buffer.byteLength(auth) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(auth),Buffer.from(expected))) return reject('401 Unauthorized');
    if (connector) return reject('409 Conflict');
    // The guard is set synchronously inside handleUpgrade, before another upgrade runs.
    wss.handleUpgrade(req,socket,head,ws => {
      connector = ws; ws.alive = true;
      ws.on('pong',() => { ws.alive = true; });
      ws.on('error',() => {});
      ws.on('message',(data,binary) => {
        if (connector !== ws || binary) return ws.terminate();
        let response;
        try { response = JSON.parse(data.toString()); } catch { return ws.terminate(); }
        if (response?.type !== 'response' || typeof response.id !== 'string') return ws.terminate();
        const entry = pending.get(response.id);
        if (!entry) { if (expired.has(response.id)) return; return ws.terminate(); }
        if (entry.target !== ws) return ws.terminate();
        let body;
        try {
          if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599 || !responseType(response.contentType)) throw new Error('Invalid response');
          body = decodeBody(response.body,maxResponse);
        } catch { ws.terminate(); return; }
        remove(response.id);
        if (entry.res.destroyed || entry.res.writableEnded) return;
        entry.res.writeHead(response.status,{'content-type':response.contentType,'content-length':body.length,'cache-control':'no-store','x-content-type-options':'nosniff'}); entry.res.end(body);
      });
      ws.on('close',() => {
        if (connector === ws) connector = undefined;
        for (const [id,entry] of pending) if (entry.target === ws) { remove(id); sendError(entry.res,503,'Mac disconnected'); }
      });
    });
  });
  const heartbeat = setInterval(() => { if (!connector) return; if (!connector.alive) connector.terminate(); else { connector.alive = false; connector.ping(); } },15000);
  heartbeat.unref();
  return {server,async close() { closing = true; clearInterval(heartbeat); connector?.terminate(); for (const [id,entry] of pending) { remove(id); sendError(entry.res,503,'Relay is stopping'); } server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await new Promise(resolve => wss.close(resolve)); }};
}
