import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLinxVoiceProvider} from '../voice-provider.mjs';
import {EventEmitter} from 'node:events';
import {createLinxSession} from '../../../packages/voice/src/index.js';
import {createOutputDecoder} from '../../../packages/voice/src/audio.js';

function fixture(extra={}){let callbacks,sessionOptions;const events=[];const session={async connect(){callbacks({type:'ready',audioParams:{format:'pcm',sample_rate:16000,channels:1}});},startListening(){this.started=true;},stopListening(){this.stopped=true;},sendAudio(data){this.sent=Buffer.from(data);},abort(){this.aborted=true;},close(){this.closed=true;}};const provider=createLinxVoiceProvider({config:{private:'not-for-browser'},createSession:options=>{sessionOptions=options;callbacks=options.onEvent;return session;},createDecoder:params=>({decode:frame=>frame,close(){}}),onEvent:e=>events.push(e),...extra});return {provider,events,session,get options(){return sessionOptions;},emit:e=>callbacks(e)};}
test('authenticated capture registers only its bound tools and returns actual result events',async()=>{
 const f=fixture({tools:[{name:'bound_tool',inputSchema:{type:'object'},invoke:async()=>({taskId:'actual',status:'completed'})}]});
 assert.equal((await f.provider.connect()).writeReady,true);assert.equal(f.options.tools.length,1);
 assert.deepEqual(await f.options.tools[0].invoke({}),{taskId:'actual',status:'completed'});
 f.provider.close();await assert.rejects(f.options.tools[0].invoke({}));
});
test('provider reuses session and decoder seams without exposing or registering write tools',async()=>{const f=fixture();const report=await f.provider.connect();assert.equal(report.writeReady,false);assert.deepEqual(f.options.tools,[]);f.provider.start();f.provider.sendAudio(Buffer.alloc(640));f.emit({type:'stt',text:'hello'});f.emit({type:'audio',data:Buffer.from([1,0])});assert(f.events.some(x=>x.type==='stt.final'&&x.text==='hello'));assert(f.events.some(x=>x.type==='audio'&&x.data.length===2));f.provider.stop();assert(f.session.stopped);f.provider.abort();assert(f.session.aborted);f.provider.close();assert(f.session.closed);assert(!JSON.stringify(f.events).includes('not-for-browser'));});
test('missing output metadata disables playback without inventing a format',async()=>{const f=fixture({createSession:({onEvent})=>({async connect(){onEvent({type:'ready'});},close(){},startListening(){},sendAudio(){}})});const report=await f.provider.connect();assert.equal(report.output,null);assert.equal(report.writeReady,false);f.provider.close();});
test('provider errors are redacted and late events are discarded after close',async()=>{const f=fixture();await f.provider.connect();f.emit({type:'error',message:'secret token'});assert.deepEqual(f.events.at(-1),{type:'error',code:'voice_provider_failed'});f.provider.close();const count=f.events.length;f.emit({type:'stt',text:'late'});assert.equal(f.events.length,count);});
test('the observed Linx quota notice is never represented as recognized speech',async()=>{for(const text of ['额度不足，请联系灵矽商务',' 额度不足。请联系灵矽商务！ ']){const f=fixture();await f.provider.connect();f.emit({type:'stt',text});assert.deepEqual(f.events,[{type:'error',code:'voice_provider_failed'}]);f.emit({type:'stt',text:'late after quota'});assert.equal(f.events.length,1);f.provider.close();}const f=fixture();await f.provider.connect();f.emit({type:'stt',text:'解释额度不足，请联系灵矽商务这句话'});assert.equal(f.events[0].type,'stt.final');f.provider.close();});
test('existing SDK handshake and real PCM decoder work through the provider seam',async()=>{let socket;class Socket extends EventEmitter{constructor(url,options){super();socket=this;this.url=url;this.options=options;this.sent=[];}send(data){this.sent.push(data);}close(){this.emit('close');}}const events=[];const provider=createLinxVoiceProvider({config:{url:'wss://xrobo-io.qiniuapi.com/v1/ws/',token:'fixture-token',deviceId:'aa:bb:cc:dd:ee:ff',clientId:'12345678-1234-4234-8234-123456789abc'},createSession:options=>createLinxSession({...options,WebSocketImpl:Socket}),createDecoder:createOutputDecoder,onEvent:e=>events.push(e)});const pending=provider.connect();socket.emit('open');assert.equal(socket.options.headers.Authorization,'Bearer fixture-token');assert.equal(JSON.parse(socket.sent[0]).audio_params.format,'pcm');socket.emit('message',Buffer.from(JSON.stringify({type:'hello',transport:'websocket',session_id:'fixture-session',audio_params:{format:'pcm',sample_rate:24000,channels:1}})),false);const report=await pending;assert.deepEqual(report.output,{codec:'pcm_s16le',sampleRate:24000,channels:1});provider.start();socket.emit('message',Buffer.from([1,0,2,0]),true);assert.deepEqual(events[0].data,Buffer.from([1,0,2,0]));assert.equal(JSON.parse(socket.sent[1]).session_id,'fixture-session');provider.close();});
test('capture operations require readiness and cannot restart or send after close',async()=>{
 const f=fixture();let sessionCloses=0,decoderCloses=0;
 f.session.close=()=>{sessionCloses++;};
 const g=fixture({createDecoder:()=>({decode:data=>data,close(){decoderCloses++;}})});
 for(const provider of [f.provider,g.provider]){
  assert.throws(()=>provider.start(),/Voice provider unavailable/);
  assert.throws(()=>provider.sendAudio(Buffer.alloc(640)),/Voice provider unavailable/);
  provider.stop();provider.abort();
 }
 assert.equal(f.session.started,undefined);assert.equal(f.session.sent,undefined);assert.equal(f.session.stopped,undefined);assert.equal(f.session.aborted,undefined);
 await f.provider.connect();await g.provider.connect();f.provider.close();g.provider.close();
 for(const provider of [f.provider,g.provider]){
  assert.throws(()=>provider.start(),/Voice provider unavailable/);
  assert.throws(()=>provider.sendAudio(Buffer.alloc(640)),/Voice provider unavailable/);
  provider.stop();provider.abort();provider.close();
 }
 assert.equal(sessionCloses,1);assert.equal(decoderCloses,1);assert.equal(f.session.stopped,undefined);assert.equal(f.session.aborted,undefined);
});
test('decoder construction failure retains transcription with output disabled and no private error',async()=>{
 const f=fixture({createDecoder:()=>{throw Error('private codec allocation detail');}}),report=await f.provider.connect();
 assert.equal(report.output,null);assert.equal(report.writeReady,false);f.provider.start();f.provider.sendAudio(Buffer.alloc(640));
 f.emit({type:'audio',data:Buffer.from([1,0])});f.emit({type:'stt',text:'transcription remains available'});
 assert.deepEqual(f.events,[{type:'stt.final',text:'transcription remains available'}]);assert.equal(f.session.sent.length,640);f.provider.close();
});
test('missing decoder injection does not advertise an invented output format',async()=>{
 const f=fixture({createDecoder:undefined}),report=await f.provider.connect();assert.equal(report.output,null);
 f.emit({type:'audio',data:Buffer.from([1,0])});f.emit({type:'stt',text:'text only'});
 assert.deepEqual(f.events,[{type:'stt.final',text:'text only'}]);f.provider.close();
});
test('decode failure emits only a generic audio error and decoder is closed once',async()=>{
 let closed=0;const f=fixture({createDecoder:()=>({decode(){throw Error('private invalid packet contents');},close(){closed++;}})});
 await f.provider.connect();f.emit({type:'audio',data:Buffer.from([1,0])});
 assert.deepEqual(f.events,[{type:'error',code:'voice_audio_invalid'}]);f.provider.close();f.provider.close();assert.equal(closed,1);
 f.emit({type:'audio',data:Buffer.from([2,0])});assert.equal(f.events.length,1);
});
test('TTS forwards only known states with bounded text and explicit true abort metadata',async()=>{
 const f=fixture();await f.provider.connect();
 for(const event of [
  {type:'tts',state:'start',text:'assistant begins',is_aborted:false},
  {type:'tts',state:'sentence_start',text:'x'.repeat(4001),is_aborted:true},
  {type:'tts',state:'stop'},
  {type:'tts',state:'sentence_start',text:42,is_aborted:'true'},
  {type:'tts',state:'unknown',text:'not forwarded'},
 ])f.emit(event);
 assert.deepEqual(f.events,[
  {type:'assistant.event',state:'start',text:'assistant begins'},
  {type:'assistant.event',state:'sentence_start',text:'x'.repeat(4000),aborted:true},
  {type:'assistant.event',state:'stop'},
  {type:'assistant.event',state:'sentence_start'},
 ]);f.provider.close();
});
test('closing during a pending connection prevents readiness and decoder allocation after late hello',async()=>{
 let resolveConnect,onEvent,sessionCloses=0,decoders=0;const events=[];
 const provider=createLinxVoiceProvider({config:{synthetic:true},createSession:options=>{
  onEvent=options.onEvent;return {connect:()=>new Promise(resolve=>{resolveConnect=resolve;}),close(){sessionCloses++;}};
 },createDecoder:()=>{decoders++;return {};},onEvent:event=>events.push(event)});
 const connecting=provider.connect(),rejected=assert.rejects(connecting,/Voice provider closed/);provider.close();
 onEvent({type:'ready',audioParams:{format:'pcm',sample_rate:16000,channels:1}});onEvent({type:'stt',text:'late private transcript'});resolveConnect();await rejected;
 assert.equal(sessionCloses,1);assert.equal(decoders,0);assert.deepEqual(events,[]);assert.throws(()=>provider.start(),/Voice provider unavailable/);provider.close();assert.equal(sessionCloses,1);
});
test('invalid SDK construction is rejected before any session is allocated',()=>{
 let created=0;assert.throws(()=>createLinxVoiceProvider({createSession:()=>{created++;}}),/Voice SDK configuration required/);
 assert.throws(()=>createLinxVoiceProvider({config:{},createSession:null}),/Voice SDK configuration required/);assert.equal(created,0);
});
