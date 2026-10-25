import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createLinxSession } from '../src/index.js';
class Socket extends EventEmitter {
  static last;
  constructor(url, options) { super(); this.url=url; this.options=options; this.sent=[]; Socket.last=this; }
  send(data) { this.sent.push(data); }
  close() { this.closed=true; this.emit('close'); }
  message(data) { this.emit('message', Buffer.from(JSON.stringify(data)), false); }
}
const config={url:'wss://xrobo-io.qiniuapi.com/v1/ws/',token:'private-token',deviceId:'aa:bb:cc:dd:ee:ff',clientId:'12345678-1234-4234-8234-123456789abc'};
const hello={type:'hello',transport:'websocket',session_id:'s',audio_params:{format:'opus',sample_rate:24000,channels:1,frame_duration:60}};
function setup(extra={}) { const events=[]; const session=createLinxSession({config,onEvent:e=>events.push(e),WebSocketImpl:Socket,...extra}); return {events,session}; }
async function ready(extra) { const x=setup(extra); const p=x.session.connect(); Socket.last.emit('open'); Socket.last.message(hello); await p; return x; }
test('validates credentials and encrypted endpoint',()=>{ for(const change of [{token:''},{token:'bad\r\nheader'},{url:'ws://host'},{deviceId:'bad'},{clientId:'bad'}]) assert.throws(()=>setup({config:{...config,...change}})); });
test('authenticates handshake and waits for server hello',async()=>{ const {session,events}=setup(); const p=session.connect(); const socket=Socket.last; assert.equal(socket.options.headers.Authorization,'Bearer private-token'); assert.equal(socket.options.headers['Protocol-Version'],'1'); socket.emit('open'); assert.equal(JSON.parse(socket.sent[0]).audio_params.format,'pcm'); assert.throws(()=>session.startListening()); socket.message(hello); await p; assert.equal(events[0].type,'ready'); session.close(); });
test('manual PCM lifecycle and forwarding',async()=>{ const {session,events}=await ready(); const s=Socket.last; assert.throws(()=>session.sendAudio(Buffer.alloc(640))); session.startListening(); assert.equal(JSON.parse(s.sent[1]).mode,'manual'); assert.throws(()=>session.sendAudio(Buffer.alloc(3))); session.sendAudio(Buffer.alloc(640)); s.message({type:'stt',text:'hello'}); s.message({type:'tts',state:'start'}); s.emit('message',Buffer.from([1,2]),true); assert.deepEqual(events.slice(1).map(e=>e.type),['stt','tts','audio']); session.stopListening(); session.abort(); session.close(); assert.throws(()=>session.sendAudio(Buffer.alloc(640))); });
test('timeout and transport error never expose provider secrets',async()=>{ const a=setup({config:{...config,handshakeTimeoutMs:5}}); await assert.rejects(a.session.connect(),/timed out/); assert.equal(Socket.last.closed,true); const b=setup(); const p=b.session.connect(); Socket.last.emit('error',new Error('private-token')); await assert.rejects(p,/connection failed/); assert(!JSON.stringify(b.events).includes('private-token')); });
test('close rejects a pending connection',async()=>{ const {session}=setup(); const p=session.connect(); session.close(); await assert.rejects(p,/closed/); });
test('MCP only invokes explicitly registered tools and deduplicates IDs',async()=>{ let calls=0; const {session}=await ready({tools:[{name:'task.submit',description:'Submit to frozen task',inputSchema:{type:'object'},invoke:async args=>{calls++; return args.prompt;}}]}); const s=Socket.last; const rpc=(id,method,params)=>s.message({type:'mcp',payload:{jsonrpc:'2.0',id,method,params}}); rpc(1,'initialize',{}); rpc(2,'tools/list'); rpc(3,'tools/call',{name:'task.submit',arguments:{prompt:'fix'}}); rpc(3,'tools/call',{name:'task.submit',arguments:{prompt:'fix'}}); rpc(4,'tools/call',{name:'shell',arguments:{}}); await new Promise(r=>setImmediate(r)); assert.equal(calls,1); const replies=s.sent.slice(1).map(x=>JSON.parse(x).payload); assert(replies.some(x=>x.id===2&&x.result.tools[0].name==='task.submit')); assert(replies.some(x=>x.id===4&&x.error)); session.close(); });
test('MCP cannot invoke a tool before a validated server hello',async t=>{let calls=0;const {session}=setup({tools:[{name:'task.submit',inputSchema:{type:'object'},invoke:()=>{calls++;return 'ok';}}]});t.after(()=>session.close());const pending=session.connect();pending.catch(()=>{});const s=Socket.last;const call={type:'mcp',payload:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'task.submit',arguments:{}}}};s.message(call);s.emit('open');s.message(call);await new Promise(r=>setImmediate(r));assert.equal(calls,0);s.message(hello);await pending;s.message(call);await new Promise(r=>setImmediate(r));assert.equal(calls,1);});
test('closing synchronously from ready settles connect without a listener exception',async()=>{let session;session=createLinxSession({config,WebSocketImpl:Socket,onEvent:event=>{if(event.type==='ready')session.close();}});const pending=session.connect();pending.catch(()=>{});const s=Socket.last;s.emit('open');assert.doesNotThrow(()=>s.message(hello));await pending;assert.equal(s.closed,true);assert.throws(()=>session.startListening(),/not ready/);});
test('closing from an MCP callback prevents later tool execution',async()=>{let session,calls=0;session=createLinxSession({config,WebSocketImpl:Socket,onEvent:event=>{if(event.type==='mcp')session.close();},tools:[{name:'task.submit',inputSchema:{type:'object'},invoke:()=>{calls++;return 'ok';}}]});const pending=session.connect();const s=Socket.last;s.emit('open');s.message(hello);await pending;s.message({type:'mcp',payload:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'task.submit',arguments:{}}}});await new Promise(r=>setImmediate(r));assert.equal(calls,0);});
test('documented hello placeholders and aborted TTS metadata are preserved', async t => {
  const { session, events } = setup({ config: { ...config, promptContext: { voxcode_target: 'task-a version 2' } } });
  t.after(() => session.close());
  const pending = session.connect(); const socket = Socket.last;
  pending.catch(() => {});
  socket.emit('open');
  assert.deepEqual(JSON.parse(socket.sent[0]).agent_params, { custom_replace_prompt: { voxcode_target: 'task-a version 2' } });
  socket.message(hello); await pending;
  socket.message({ type: 'tts', state: 'stop', is_aborted: true });
  assert.equal(events.at(-1).is_aborted, true); session.close();
  assert.throws(() => setup({ config: { ...config, promptContext: { bad: 'x'.repeat(10001) } } }));
});
test('conflicting MCP retries never invoke a second tool or return the old result', async () => {
  let calls = 0;
  const { session } = await ready({ tools: [{ name: 'read', inputSchema: { type: 'object' }, invoke: args => { calls++; return args; } }] });
  const socket = Socket.last;
  for (const value of [1, 2]) socket.message({ type: 'mcp', payload: { jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name: 'read', arguments: { value } } } });
  await new Promise(resolve => setImmediate(resolve));
  const replies = socket.sent.slice(1).map(value => JSON.parse(value).payload);
  assert.equal(calls, 1); assert(replies.some(value => value.id === 42 && value.error));
  session.close();
});

test('bound sessions accept matching or omitted IDs and bind controls and every MCP reply', async t => {
  let calls = 0;
  const { session, events } = await ready({ tools: [{ name: 'read', inputSchema: { type: 'object' }, invoke: () => ++calls }] });
  t.after(() => session.close());
  const socket = Socket.last;
  session.startListening(); session.stopListening(); session.abort();
  socket.message({ type: 'stt', session_id: 's', text: 'matching' });
  socket.message({ type: 'stt', text: 'omitted' });
  socket.message({ type: 'tts', session_id: 's', state: 'stop', is_aborted: true });
  const rpc = (id, method, params, extra = {}) => socket.message({ type: 'mcp', ...extra, payload: { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) } });
  rpc(1, 'initialize', { protocolVersion: '2024-11-05' }, { session_id: 's' });
  rpc(2, 'tools/list');
  rpc(3, 'tools/call', { name: 'read' });
  rpc(3, 'tools/call', { name: 'read' });
  rpc(3, 'tools/call', { name: 'read', arguments: { changed: true } });
  rpc(4, 'tools/call', { name: 'read', arguments: { text: 'x'.repeat(32768) } });
  rpc(5, 'tools/call', { name: 'unknown' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.deepEqual(events.filter(event => event.type === 'stt').map(event => event.text), ['matching', 'omitted']);
  const sent = socket.sent.slice(1).map(JSON.parse);
  assert(sent.every(message => message.session_id === 's'));
  const replies = sent.filter(message => message.type === 'mcp').map(message => message.payload);
  assert.equal(replies.find(reply => reply.id === 1).result.protocolVersion, '2024-11-05');
  assert.equal(replies.find(reply => reply.id === 2).result.tools[0].name, 'read');
  assert.equal(replies.filter(reply => reply.id === 3 && reply.result?.isError === false).length, 2);
  assert(replies.some(reply => reply.id === 3 && reply.error?.code === -32602));
  assert(replies.some(reply => reply.id === 4 && reply.error?.code === -32602));
  assert(replies.some(reply => reply.id === 5 && reply.error?.code === -32601));
});

test('conflicting or malformed incoming session IDs close before STT, TTS or tool dispatch', async t => {
  for (const type of ['stt', 'tts', 'mcp']) for (const id of ['foreign-private-session', '', null, 7, 'bad\nvalue', 'x'.repeat(257)]) {
    let calls = 0;
    const { session, events } = await ready({ tools: [{ name: 'read', inputSchema: { type: 'object' }, invoke: () => ++calls }] });
    t.after(() => session.close());
    const socket = Socket.last;
    socket.message({ type, session_id: id, text: 'private transcript', state: 'start', payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read' } } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(socket.closed, true, `${type} with ${typeof id} ID`);
    assert.equal(calls, 0);
    assert.deepEqual(events.map(event => event.type), ['ready', 'error']);
    assert(!JSON.stringify(events).includes('foreign-private-session'));
    assert(!JSON.stringify(events).includes('private transcript'));
    assert.equal(socket.sent.length, 1);
    assert.throws(() => session.startListening(), /not ready/);
  }
});

test('hello accepts an omitted session ID but rejects malformed supplied IDs', async t => {
  for (const id of ['', null, 7, 'bad value', 'x'.repeat(257)]) {
    const { session, events } = setup(); t.after(() => session.close());
    const pending = session.connect(); pending.catch(() => {});
    Socket.last.emit('open'); Socket.last.message({ ...hello, session_id: id });
    await assert.rejects(pending, /Invalid Linx hello/);
    assert.equal(Socket.last.closed, true);
    assert(!JSON.stringify(events).includes('private-token'));
  }
  const { session } = setup(); t.after(() => session.close());
  const pending = session.connect(); const socket = Socket.last;
  socket.emit('open'); const { session_id, ...unboundHello } = hello;
  socket.message(unboundHello); await pending;
  session.startListening(); session.stopListening(); session.abort();
  socket.message({ type: 'mcp', payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
  await new Promise(resolve => setImmediate(resolve));
  assert(socket.sent.slice(1).map(JSON.parse).every(message => !Object.hasOwn(message, 'session_id')));
});

test('documented optional hello audio metadata never invents an output sample rate', async t => {
  for (const audio of [undefined, { format: 'opus', sample_rate: 16000, play_buffer_duration: 1000 }]) {
    const { session, events } = setup(); t.after(() => session.close());
    const pending = session.connect(); const socket = Socket.last;
    socket.emit('open'); const { audio_params, ...metadata } = hello;
    socket.message({ ...metadata, ...(audio ? { audio_params: audio } : {}) }); await pending;
    session.startListening(); session.sendAudio(Buffer.alloc(640));
    assert.deepEqual(events[0].audioParams, audio ? { ...audio, channels: 1 } : undefined);
  }
  for (const audio of [null, {}, { format: 'opus', channels: 1 }, { format: 'opus', sample_rate: 48000 }, { format: 'opus', sample_rate: 16000, channels: 2 }]) {
    const { session } = setup(); t.after(() => session.close());
    const pending = session.connect(); pending.catch(() => {});
    Socket.last.emit('open'); Socket.last.message({ ...hello, audio_params: audio });
    await assert.rejects(pending, /Invalid Linx hello/);
  }
});

test('a conflicting session during an in-flight tool prevents its late MCP reply', async t => {
  let resolve, calls = 0;
  const { session, events } = await ready({ tools: [{ name: 'read', inputSchema: { type: 'object' }, invoke: () => { calls++; return new Promise(done => { resolve = done; }); } }] });
  t.after(() => session.close()); const socket = Socket.last;
  socket.message({ type: 'mcp', session_id: 's', payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read' } } });
  assert.equal(calls, 1);
  socket.message({ type: 'stt', session_id: 'foreign', text: 'wrong target' });
  resolve('late result'); await new Promise(done => setImmediate(done));
  assert.equal(socket.sent.length, 1);
  assert.equal(events.at(-1).type, 'error');
});
