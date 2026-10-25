import {createHash, randomUUID} from 'node:crypto';
import {open, mkdir, rename} from 'node:fs/promises';
import {dirname, isAbsolute} from 'node:path';
import {validateCommandEnvelope,validId,stableJson,readMethods,MAX_COMMAND_BYTES,MAX_RESULT_BYTES} from '../../packages/control-protocol/index.mjs';
import WebSocket from 'ws';
import {assertPrivateParent,readPrivateJson} from './private-files.mjs';
import {acquireLedgerLock} from './ledger-lock.mjs';

const MAX_FRAME = MAX_COMMAND_BYTES;
const TYPES = ['task_rpc', 'switch_task', 'focus_window', 'open_project'];
const SAFE_ERRORS=new Set(['project_denied','application_denied','payload_denied','capability_unavailable','task_rpc_denied','invalid_argument','project_unavailable','task_conflict','not_found','request_conflict','outcome_unknown','ledger_full','quarantined','busy','revision_conflict','task_deleted','task_hidden','invalid_parent','deadline_exceeded','unavailable','response_too_large']);
const UNKNOWN_ERRORS=new Set(['outcome_unknown','deadline_exceeded','unavailable','response_too_large','invalid_response']);
const id = validId;
const digest = value => createHash('sha256').update(stableJson(value)).digest('hex');

async function ledger(stateFile, deviceId, maxEntries) {
 if (!isAbsolute(stateFile ?? '')) throw Error('absolute state file required');
 const parent = dirname(stateFile);
 await mkdir(parent, {recursive:true, mode:0o700});
 await assertPrivateParent(stateFile);
 const lock=await acquireLedgerLock({stateFile,deviceId});
 let released=false,pendingSave=Promise.resolve(),committed;
 async function release(){
  if(released)return;
  released=true;await pendingSave;
  await lock.release();
 }
 try{
 let data = {version:1, deviceId, revision:1, entries:{}};
 try {
  data=await readPrivateJson(stateFile,{maxBytes:8*1024*1024});
 } catch (error) { if (error.code !== 'ENOENT') throw error; }
 if (data.version !== 1 || data.deviceId !== deviceId || !Number.isSafeInteger(data.revision) || data.revision < 0 || !data.entries || typeof data.entries !== 'object' || Array.isArray(data.entries) || Object.keys(data.entries).length > maxEntries) throw Error('invalid ledger');
 function save() {
  if(released)return Promise.reject(Error('ledger lock released'));
  const operation=pendingSave.then(async()=>{
  if(released)throw Error('ledger lock released');
  await lock.assertHeld();
  const raw=JSON.stringify(data);
  if(Buffer.byteLength(raw)>8*1024*1024)throw Error('ledger byte limit');
  const temp = `${stateFile}.${randomUUID()}.tmp`;
  const file = await open(temp, 'wx', 0o600);
  try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); }
  await rename(temp, stateFile);
  const directory=await open(parent,'r');try{await directory.sync();}finally{await directory.close();}
  committed=JSON.parse(raw);
  });
  pendingSave=operation.catch(()=>{});
  return operation;
 }
 for (const entry of Object.values(data.entries)) {
  if (!entry || !id(entry.operationId) || typeof entry.fingerprint !== 'string' || !['inflight','unknown','completed'].includes(entry.state)) throw Error('invalid ledger entry');
  if(entry.readOnly!==undefined&&typeof entry.readOnly!=='boolean'||entry.readOnly===true&&!Number.isSafeInteger(entry.expiresAt))throw Error('invalid ledger read expiry');
  if (entry.state === 'inflight') entry.state = 'unknown';
 }
 await save();
 return {data,save,release,getEntry(requestId){return committed&&Object.hasOwn(committed.entries,requestId)?structuredClone(committed.entries[requestId]):null;}};
 }catch(error){await release();throw error;}
}

export async function createMacAgent({endpoint, deviceId, token, capabilities = [], stateFile,
 WebSocketImpl = WebSocket, heartbeatMs = 15000, retryMinMs = 500, retryMaxMs = 30000,
 handshakeMs = 10000, maxEntries = 1024, clock=Date.now, onCommand, onStatus = ()=>{}} = {}) {
 const url = new URL(endpoint);
 if (url.protocol !== 'wss:' || url.username || url.password || url.hash || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error('verified WSS endpoint required');
 if (!id(deviceId) || typeof token !== 'string' || token.length < 1 || token.length > 4096 || /[\r\n]/.test(token)) throw Error('invalid agent identity');
 if (!Array.isArray(capabilities) || capabilities.some(value=>!TYPES.includes(value)) || typeof WebSocketImpl !== 'function') throw Error('invalid agent capabilities');
 if (![heartbeatMs,retryMinMs,retryMaxMs,handshakeMs,maxEntries].every(Number.isSafeInteger) || heartbeatMs<1 || retryMinMs<1 || retryMaxMs<retryMinMs || handshakeMs<1 || maxEntries<1 || maxEntries>4096) throw Error('invalid agent limits');
 if(typeof clock!=='function')throw Error('invalid agent clock');
 const store = await ledger(stateFile, deviceId, maxEntries);
 const advertised = [...new Set(capabilities)].sort();
 let socket, generation = 0, stopped = false, halted = false, registered = false, retryTimer, heartbeatTimer, handshakeTimer, attempt = 0, connectionId, lastAcknowledgedAt=0;
 let queue = Promise.resolve(), queued=0;
 const status = value => { try { onStatus(value); } catch {} };
 const active = (ws, gen) => !stopped && !halted && socket===ws && generation===gen;
 const clearTimers = () => { clearInterval(heartbeatTimer); clearTimeout(handshakeTimer); };
 const send = (ws,gen,frame) => {
  if (!active(ws,gen) || ws.readyState!==1) return;
  try { const raw=JSON.stringify(frame); if(Buffer.byteLength(raw)>MAX_RESULT_BYTES+4096 || ws.bufferedAmount>2*MAX_RESULT_BYTES) throw Error('frame limit'); ws.send(raw); }
  catch { ws.close(); }
 };
 const response = (command,statusValue,errorCode,snapshot=null) => ({type:'commandResult',protocolVersion:1,requestId:command.requestId,operationId:command.operationId,deviceId,status:statusValue,errorCode,snapshot});
 const reject = (ws,gen,command,code) => send(ws,gen,response(command,'rejected',code));
 async function execute(ws,gen,command) {
  if (!active(ws,gen) || !registered) return;
  if (!command || !id(command.requestId) || !id(command.operationId)) { ws.close(); return; }
  if(command.deviceId!==deviceId) return reject(ws,gen,command,'device_mismatch');
  const expires = Date.parse(command.expiresAt), now=Number(clock());
  if(!Number.isSafeInteger(now)||now<0)throw Error('invalid agent clock');
  if(expires<=now) return reject(ws,gen,command,'command_expired');
  try{command=validateCommandEnvelope(command,{deviceId,now});}catch{return reject(ws,gen,command,'invalid_argument');}
  if(!advertised.includes(command.type)) return reject(ws,gen,command,'capability_denied');
  let pruned=false;
  for(const [requestId,entry]of Object.entries(store.data.entries)){
   if(entry.readOnly===true&&entry.state!=='inflight'&&entry.expiresAt<=now){delete store.data.entries[requestId];pruned=true;}
  }
  if(pruned)await store.save();
  const hash = digest(command), prior=Object.hasOwn(store.data.entries,command.requestId)?store.data.entries[command.requestId]:null;
  if(prior){
   if(prior.fingerprint!==hash) return reject(ws,gen,command,'request_conflict');
   if(prior.state!=='completed'){send(ws,gen,prior.response?.status==='unknown'?prior.response:response(command,'unknown','operation_unknown'));return;}
   send(ws,gen,prior.response);return;
  }
  if(Object.values(store.data.entries).some(entry=>entry.operationId===command.operationId)) return reject(ws,gen,command,'operation_conflict');
  if(Object.hasOwn(command,'expectedRevision')&&command.expectedRevision!==store.data.revision) return reject(ws,gen,command,'revision_conflict');
  if(Object.keys(store.data.entries).length>=maxEntries||Buffer.byteLength(JSON.stringify(store.data))>7*1024*1024-8192) return reject(ws,gen,command,'ledger_full');
  const entry={fingerprint:hash,operationId:command.operationId,state:'inflight',readOnly:command.type==='task_rpc'&&readMethods.includes(command.payload.method),expiresAt:expires};
  Object.defineProperty(store.data.entries,command.requestId,{value:entry,writable:true,configurable:true,enumerable:true});
  await store.save();
  if(!active(ws,gen) || expires<=Number(clock())) {
   entry.state='completed';entry.response=response(command,'rejected',expires<=Number(clock())?'command_expired':'connection_lost');await store.save();return;
  }
  let value;
  if(typeof onCommand!=='function') value=response(command,'rejected','capability_unavailable');
  else try {
   const snapshot=await onCommand(Object.freeze(structuredClone(command)));
   let encoded;try{encoded=JSON.stringify(snapshot);}catch{throw Object.assign(Error('Unencodable result'),{code:'invalid_response'});}
   if(encoded===undefined)throw Object.assign(Error('Unencodable result'),{code:'invalid_response'});
   if(Buffer.byteLength(encoded)>MAX_RESULT_BYTES)throw Object.assign(Error('Result exceeds limit'),{code:'response_too_large'});
   if(command.type!=='task_rpc')store.data.revision++;
   value=response(command,'succeeded',null,command.type==='task_rpc'?snapshot:{...snapshot,revision:store.data.revision});
  } catch (error) {
   value=response(command,UNKNOWN_ERRORS.has(error?.code)?'unknown':'failed',UNKNOWN_ERRORS.has(error?.code)||SAFE_ERRORS.has(error?.code)?error.code:'command_failed');
  }
  if(stopped) return;
  entry.state=value.status==='unknown'?'unknown':'completed';entry.response=value;await store.save();send(ws,gen,value);
 }
 const schedule = () => {
  if(stopped || halted || retryTimer)return;
  retryTimer=setTimeout(()=>{retryTimer=undefined;connect();},Math.min(retryMaxMs,retryMinMs*2**Math.min(attempt++,8)));
 };
 function connect(){
  if(stopped||halted)return;
  const gen=++generation;registered=false;connectionId=undefined;lastAcknowledgedAt=0;status('connecting');
  let ws;try{ws=new WebSocketImpl(url.href,{rejectUnauthorized:true,followRedirects:false,maxPayload:MAX_FRAME,perMessageDeflate:false,handshakeTimeout:handshakeMs});}catch{schedule();return;}
  socket=ws;
  const on=(event,handler)=>typeof ws.on==='function'?ws.on(event,handler):ws.addEventListener(event,handler);
  on('open',()=>{if(!active(ws,gen))return;send(ws,gen,{type:'register',protocolVersion:1,deviceId,token,capabilities:advertised});handshakeTimer=setTimeout(()=>{if(active(ws,gen)&&!registered)ws.close();},handshakeMs);});
  on('message',(event,binary)=>{
   if(!active(ws,gen))return;
   if(binary)return ws.close();
   let frame;try{const raw=event?.data??event;if(Buffer.byteLength(raw)>MAX_FRAME)throw Error();frame=JSON.parse(raw.toString());}catch{return ws.close();}
   if(frame?.type==='connected'){
    if(registered||frame.protocolVersion!==1||frame.deviceId!==deviceId||!id(frame.connectionId))return ws.close();
    registered=true;connectionId=frame.connectionId;lastAcknowledgedAt=performance.now();attempt=0;clearTimeout(handshakeTimer);status('connected');
    heartbeatTimer=setInterval(()=>{if(!active(ws,gen))return;if(performance.now()-lastAcknowledgedAt>=heartbeatMs*3)return ws.close();send(ws,gen,{type:'heartbeat',protocolVersion:1,deviceId});},heartbeatMs);heartbeatTimer.unref?.();return;
   }
   if(!registered)return ws.close();
   if(frame?.type==='heartbeat_ack') {
    if(frame.protocolVersion!==1||frame.deviceId!==deviceId||frame.connectionId!==connectionId||typeof frame.serverObservedAt!=='string'||!Number.isFinite(Date.parse(frame.serverObservedAt)))return ws.close();
    lastAcknowledgedAt=performance.now();return;
   }
   if(frame?.type==='reconcile'){
    if(frame.protocolVersion!==1||frame.deviceId!==deviceId||!id(frame.requestId)||!id(frame.operationId))return ws.close();
    const entry=store.getEntry(frame.requestId);
    send(ws,gen,entry?.operationId===frame.operationId&&(entry.state==='completed'||entry.response?.status==='unknown')?entry.response:response(frame,'unknown','operation_unknown'));return;
   }
   if(frame?.type!=='command')return ws.close();
   if(queued>=32){if(id(frame.command?.requestId)&&id(frame.command?.operationId))reject(ws,gen,frame.command,'busy');else ws.close();return;}
   queued++;
   queue=queue.then(()=>execute(ws,gen,frame.command)).catch(()=>{halted=true;clearTimers();status('state_error');ws.close();}).finally(()=>queued--);
  });
  on('error',()=>{if(active(ws,gen))status('connection_error');});
  on('close',()=>{if(!active(ws,gen))return;clearTimers();socket=undefined;registered=false;status('offline');schedule();});
 }
 return {start(){if(!socket&&!stopped)connect();},async close(){if(stopped)return;stopped=true;generation++;clearTimers();clearTimeout(retryTimer);socket?.close();socket=undefined;await store.release();status('closed');}};
}
