import {createHash} from 'node:crypto';
import WebSocket from 'ws';

const LIMIT=1024*1024;
const errorResponse=(id,message)=>({jsonrpc:'2.0',id,error:{code:-32603,message}});
export function createMcpProxyBridge({endpoint,dispatch,onStatus=()=>{},WebSocketImpl=WebSocket,retryMinMs=500,retryMaxMs=30000,timeoutMs=10000,maxInflight=8,maxCompleted=256,maxCacheBytes=8*LIMIT}={}){
 const url=new URL(endpoint);
 if(!['wss:','ws:'].includes(url.protocol)||url.protocol==='ws:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password)throw Error('WSS endpoint required');
 if(typeof dispatch!=='function')throw Error('dispatcher required');
 if(!Number.isSafeInteger(maxInflight)||maxInflight<1||maxInflight>64||!Number.isSafeInteger(maxCompleted)||maxCompleted<1||maxCompleted>1024||!Number.isSafeInteger(maxCacheBytes)||maxCacheBytes<LIMIT||!Number.isFinite(timeoutMs)||timeoutMs<1)throw Error('Invalid bridge limits');
 let socket,closed=false,retryTimer,attempt=0;
 // A deadline ends the caller's wait, never the underlying side effect. Keep
 // active handlers counted across reconnect until their real promise settles.
 const active=new Set();
 const status=value=>{try{onStatus(value);}catch{}};
 function connect(){
  if(closed)return;
  status('connecting');
  let ws;
  try{ws=new WebSocketImpl(url.href,{maxPayload:LIMIT,handshakeTimeout:timeoutMs,followRedirects:false,perMessageDeflate:false});}
  catch{status('connection_error');schedule();return;}
  socket=ws;
  const requests=new Map(),completed=new Map();let cachedBytes=0;
  const available=()=>!closed&&socket===ws&&ws.readyState===WebSocket.OPEN;
  function send(body){if(!available())return;if(ws.bufferedAmount>2*LIMIT)return ws.close(1013);try{ws.send(body);}catch{ws.terminate();}}
  function encode(value,id){try{const body=JSON.stringify(value);if(typeof body==='string'&&Buffer.byteLength(body)<=LIMIT)return body;}catch{}return JSON.stringify(errorResponse(id,'Response too large'));}
  function retain(key,entry){
   if(!available()||entry.active)return;
   const bytes=Buffer.byteLength(entry.body??'')+entry.fingerprint.length+key.length;
   entry.bytes=bytes;completed.set(key,entry);cachedBytes+=bytes;
   while(completed.size>maxCompleted||cachedBytes>maxCacheBytes){const [oldKey,old]=completed.entries().next().value;completed.delete(oldKey);requests.delete(oldKey);cachedBytes-=old.bytes;}
  }
  function run(msg,key,fingerprint){
   if(active.size>=maxInflight)return ws.close(1013);
   const entry={active:true,fingerprint,body:null,timer:null};
   if(key!==null)requests.set(key,entry);
   active.add(entry);
   const respond=value=>{if(entry.body!==null||key===null)return;entry.body=encode(value??errorResponse(msg.id,'Empty response'),msg.id);send(entry.body);};
   entry.timer=setTimeout(()=>{if(key!==null)respond(errorResponse(msg.id,'Request timed out'));},timeoutMs);
   Promise.resolve().then(()=>dispatch(msg,{transport:'proxy'})).then(respond,()=>respond(errorResponse(msg.id??null,'Request failed'))).finally(()=>{
    clearTimeout(entry.timer);entry.active=false;active.delete(entry);if(key!==null)retain(key,entry);
   });
  }
  ws.on('open',()=>{attempt=0;status('connected');});
  ws.on('error',()=>status('connection_error'));
  ws.on('close',()=>{
   for(const entry of requests.values())clearTimeout(entry.timer);
   requests.clear();completed.clear();cachedBytes=0;
   if(!closed&&socket===ws){status('offline');schedule();}
  });
  ws.on('message',(data,binary)=>{
   if(!available())return;
   if(binary)return ws.close(1003);
   let msg;try{msg=JSON.parse(data.toString());}catch{return ws.close(1007);}
   if(!msg||typeof msg!=='object'||Array.isArray(msg)||msg.jsonrpc!=='2.0'||typeof msg.method!=='string'||msg.id!==undefined&&(!['string','number'].includes(typeof msg.id)||typeof msg.id==='number'&&!Number.isSafeInteger(msg.id)))return ws.close(1008);
   if(msg.id===undefined)return run(msg,null,'');
   const key=JSON.stringify(msg.id),fingerprint=createHash('sha256').update(JSON.stringify(msg)).digest('hex');
   const cached=requests.get(key);
   if(cached){if(cached.fingerprint!==fingerprint)return ws.close(1008);if(cached.body!==null)send(cached.body);return;}
   run(msg,key,fingerprint);
  });
 }
 // Constructor failures and normal closes share the same bounded retry path.
 function schedule(){if(!closed)retryTimer=setTimeout(connect,Math.min(retryMaxMs,retryMinMs*2**Math.min(attempt++,10)));}
 return {
  start(){if(!socket&&!closed)connect();},
  async close(){closed=true;clearTimeout(retryTimer);for(const entry of active)clearTimeout(entry.timer);if(socket&&socket.readyState!==WebSocket.CLOSED)socket.terminate();status('closed');},
 };
}
