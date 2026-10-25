import {randomUUID} from 'node:crypto';
import WebSocket,{WebSocketServer} from 'ws';

const INPUT=Object.freeze({codec:'pcm_s16le',sampleRate:16000,channels:1,frameMs:20});
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const sameFormat=value=>plain(value)&&Object.keys(value).length===4&&Object.entries(INPUT).every(([key,v])=>value[key]===v);
const bounded=(promise,ms)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Voice operation timed out')),ms);})]).finally(()=>clearTimeout(timer));};
const closeProvider=provider=>{try{provider?.close();}catch{ /* Cleanup cannot retain admission or throw from socket callbacks. */ }};

export function createVoiceTransport({server,publicOrigin,authorizeUpgrade,resolveContext,providerFactory,path='/ws/voice',maxConnections=8,operationTimeoutMs=10000,maxCaptureMs=30000,maxSessionMs=300000,maxBufferedBytes=65536,tailTimeoutMs=20000,registerUpgrade=true}={}) {
  const origin=new URL(publicOrigin);
  if(origin.origin!==publicOrigin||origin.protocol!=='https:'&&!(origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname)))throw Error('Strict public origin required');
  if(!server||typeof authorizeUpgrade!=='function'||typeof resolveContext!=='function'||typeof providerFactory!=='function')throw Error('Voice auth, context and provider required');
  for(const number of [maxConnections,operationTimeoutMs,maxCaptureMs,maxSessionMs,maxBufferedBytes,tailTimeoutMs])if(!Number.isSafeInteger(number)||number<1)throw Error('Invalid voice limit');
  const wss=new WebSocketServer({noServer:true,maxPayload:16384,perMessageDeflate:false});
  const owners=new Set(),sessions=new Set(),pendingSockets=new Set();let closing=false,pendingUpgrades=0;
  const reject=(socket,status)=>{if(!socket.destroyed){socket.on('error',()=>{});socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);const timer=setTimeout(()=>socket.destroy(),1000);timer.unref();socket.once('close',()=>clearTimeout(timer));}};
  async function upgrade(req,socket,head){
    let url;try{url=new URL(req.url,publicOrigin);}catch{return reject(socket,400);}
    if(req.url!==path)return reject(socket,404);
    if(closing||sessions.size+pendingUpgrades>=maxConnections)return reject(socket,503);
    if(url.search||url.hash||req.headers.origin!==publicOrigin||typeof req.headers.cookie!=='string')return reject(socket,403);
    pendingUpgrades++;pendingSockets.add(socket);
    try{
      const auth=await bounded(Promise.resolve().then(()=>authorizeUpgrade(req)),operationTimeoutMs);
      if(closing||!plain(auth)||!id(auth.ownerId)||!Number.isSafeInteger(auth.expiresAt)||auth.expiresAt<=Date.now()||owners.has(auth.ownerId)||socket.destroyed)return reject(socket,403);
      owners.add(auth.ownerId);
      try{wss.handleUpgrade(req,socket,head,ws=>connected(ws,auth));}catch{owners.delete(auth.ownerId);reject(socket,400);}
    }catch{reject(socket,403);}finally{pendingUpgrades--;pendingSockets.delete(socket);}
  }
  if(registerUpgrade)server.on('upgrade',upgrade);
  function connected(ws,auth){
    const session={ws};sessions.add(session);
    let closed=false,context,requestedContext,voiceSessionId,capture,sequence=0,queue=Promise.resolve(),queuedBytes=0,queuedCount=0,rateStart=Date.now(),messageCount=0;
    const requests=new Map(),captureIds=new Set();
    const expiry=setTimeout(()=>fail('voice_session_expired',1008),Math.min(auth.expiresAt-Date.now(),maxSessionMs,2147483647));
    const initialTimer=setTimeout(()=>fail('voice_session_timeout',1008),operationTimeoutMs);
    function cleanup(){if(closed)return;closed=true;clearTimeout(expiry);clearTimeout(initialTimer);clearTimeout(capture?.timer);closeProvider(capture?.provider);owners.delete(auth.ownerId);sessions.delete(session);requests.clear();}
    function fail(code,closeCode=1008){if(closed)return;if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<maxBufferedBytes)ws.send(JSON.stringify({type:'error',code,captureId:capture?.id??null,seq:++sequence}));cleanup();ws.close(closeCode);setTimeout(()=>ws.terminate(),1000).unref();}
    function send(event,binary=false){
      if(closed||ws.readyState!==WebSocket.OPEN)return;
      const data=binary?event:JSON.stringify({...event,seq:++sequence});
      if(ws.bufferedAmount+Buffer.byteLength(data)>maxBufferedBytes){fail('voice_backpressure',1013);return;}
      ws.send(data,{binary});
    }
    function forward(entry,event){
      if(closed||capture!==entry||!['recording','stopped'].includes(entry.state))return;
      if(event?.type==='audio'){
        const format=event.format;
        if(!entry.output||!plain(format)||format.codec!=='pcm_s16le'||format.sampleRate!==entry.output.sampleRate||format.channels!==1||!(event.data instanceof Uint8Array)||!event.data.length||event.data.length%2||event.data.length>5760)return fail('voice_audio_invalid');
        return send(event.data,true);
      }
      if(event?.type==='tool.started')send({type:'tool.started',captureId:entry.id});
      else if(event?.type==='tool.result'&&plain(event.result)&&Buffer.byteLength(JSON.stringify(event.result))<=24000)send({type:'tool.result',captureId:entry.id,result:event.result});
      else if(['stt.partial','stt.final'].includes(event?.type)&&typeof event.text==='string')send({type:event.type,captureId:entry.id,text:event.text.slice(0,4000)});
      else if(event?.type==='assistant.event'&&['start','stop','sentence_start'].includes(event.state))send({type:'assistant.event',captureId:entry.id,state:event.state,...(typeof event.text==='string'?{text:event.text.slice(0,4000)}:{}),...(event.aborted===true?{aborted:true}:{})});
      else if(event?.type==='error')fail('voice_provider_failed',1011);
    }
    async function control(message){
      if(!plain(message)||!id(message.requestId)||typeof message.type!=='string')return fail('voice_control_invalid');
      const fingerprint=JSON.stringify(message),prior=requests.get(message.requestId);
      if(prior){if(prior.fingerprint!==fingerprint)return fail('voice_request_conflict');return send(prior.response);}
      if(requests.size>=128)return fail('voice_request_limit');
      let response;
      if(message.type==='session.start'){
        if(context||!plain(message.context))return fail('voice_context_invalid');
        const allowed=await bounded(Promise.resolve(resolveContext({ownerId:auth.ownerId,context:structuredClone(message.context)})),operationTimeoutMs);
        if(closed)return;
        if(!plain(allowed)||!id(allowed.projectId)||!Number.isSafeInteger(allowed.contextVersion)||allowed.contextVersion<1||allowed.projectId!==message.context.projectId||allowed.contextVersion!==message.context.contextVersion)return fail('voice_context_invalid');
        requestedContext=Object.freeze(structuredClone(message.context));context=Object.freeze(structuredClone(allowed));voiceSessionId=randomUUID();clearTimeout(initialTimer);
        response={type:'session.ready',voiceSessionId,contextVersion:context.contextVersion,captureId:null,writeReady:false};
      }else if(message.type==='capture.start'){
        if(!context||capture?.state==='recording'||!id(message.captureId)||captureIds.has(message.captureId)||message.contextVersion!==context.contextVersion||!sameFormat(message.format))return fail('voice_capture_invalid');
        const refreshed=await bounded(Promise.resolve(resolveContext({ownerId:auth.ownerId,context:structuredClone(requestedContext)})),operationTimeoutMs);
        if(closed)return;
        if(!refreshed||JSON.stringify(refreshed)!==JSON.stringify(context))return fail('voice_context_invalid');
        clearTimeout(capture?.timer);closeProvider(capture?.provider);
        const entry={id:message.captureId,state:'connecting',frames:0,output:null};capture=entry;captureIds.add(entry.id);
        const authorizeTool=async()=>{
          const active=()=>!closed&&capture===entry&&['recording','stopped'].includes(entry.state)&&Date.now()<auth.expiresAt;
          if(!active())return false;
          const refreshed=await bounded(Promise.resolve(resolveContext({ownerId:auth.ownerId,context:structuredClone(requestedContext)})),operationTimeoutMs);
          return active()&&JSON.stringify(refreshed)===JSON.stringify(context);
        };
        const provider=await bounded(Promise.resolve().then(()=>providerFactory({ownerId:auth.ownerId,voiceSessionId,captureId:entry.id,context,authorizeTool,onEvent:event=>forward(entry,event)})).then(value=>{if(closed){closeProvider(value);return null;}return value;}),operationTimeoutMs);
        entry.provider=provider;if(closed){closeProvider(provider);return;}
        const report=await bounded(Promise.resolve(provider.connect()),operationTimeoutMs);if(closed){closeProvider(provider);return;}
        if(!sameFormat(report?.input))return fail('voice_format_unsupported');
        if(report.output){if(report.output.codec!=='pcm_s16le'||![16000,24000].includes(report.output.sampleRate)||report.output.channels!==1)return fail('voice_format_unsupported');entry.output={...report.output};}
        provider.start();entry.state='recording';entry.writeReady=report.writeReady===true;entry.timer=setTimeout(()=>fail('voice_capture_limit'),maxCaptureMs);
        response={type:'capture.ready',captureId:entry.id,contextVersion:context.contextVersion,input:INPUT,output:entry.output,writeReady:entry.writeReady,...(!entry.writeReady?{writeBlocker:'cloud_mcp_session_correlation_unverified'}:{})};
      }else if(message.type==='capture.stop'||message.type==='capture.abort'){
        if(!capture||capture.id!==message.captureId||!(capture.state==='recording'||message.type==='capture.abort'&&capture.state==='stopped'))return fail('voice_capture_invalid');
        clearTimeout(capture.timer);
        if(message.type==='capture.abort'){capture.state='aborted';capture.provider.abort();closeProvider(capture.provider);}else{capture.provider.stop();capture.state='stopped';capture.timer=setTimeout(()=>{capture.state='finished';closeProvider(capture.provider);},capture.writeReady?Math.max(tailTimeoutMs,180000):tailTimeoutMs);}
        response={type:message.type==='capture.abort'?'capture.aborted':'capture.stopped',captureId:capture.id,lastSeq:capture.frames};
      }else return fail('voice_control_unknown');
      if(!closed){response={...response,requestId:message.requestId};requests.set(message.requestId,{fingerprint,response});send(response);}
    }
    ws.on('message',(data,binary)=>{
      if(closed)return;
      if(Date.now()>=auth.expiresAt)return fail('voice_session_expired');
      if(Date.now()-rateStart>=1000){rateStart=Date.now();messageCount=0;}if(++messageCount>120)return fail('voice_rate_limit',1013);
      queuedBytes+=data.length;queuedCount++;
      if(queuedBytes>32768||queuedCount>64)return fail('voice_backpressure',1013);
      queue=queue.then(async()=>{
        if(closed)return;
        if(binary){
          if(capture?.state!=='recording'||data.length!==640)return fail('voice_audio_invalid');
          if(++capture.frames>Math.ceil(maxCaptureMs/20))return fail('voice_capture_limit');
          try{capture.provider.sendAudio(Buffer.from(data));}catch{return fail('voice_backpressure',1013);}
        }else{let message;try{message=JSON.parse(data);}catch{return fail('voice_control_invalid');}await control(message);}
      }).catch(()=>fail('voice_provider_failed',1011)).finally(()=>{queuedBytes-=data.length;queuedCount--;});
    });
    ws.on('close',cleanup);ws.on('error',cleanup);
  }
  return {handleUpgrade:upgrade,async close(){closing=true;server.off('upgrade',upgrade);for(const socket of pendingSockets)socket.destroy();for(const {ws} of sessions)ws.terminate();await new Promise(resolve=>wss.close(resolve));},get activeSessions(){return sessions.size;}};
}
