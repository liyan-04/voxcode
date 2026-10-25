import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

let createVoiceClient;
try {({createVoiceClient} = await import('../public/voice-client.mjs'));} catch {}
const tick = () => new Promise(resolve => setImmediate(resolve));
class Socket {
  static instances = [];
  constructor(url) {this.url = url;this.readyState = 0;this.bufferedAmount = 0;this.sent = [];Socket.instances.push(this);}
  open() {this.readyState = 1;this.onopen?.();}
  send(value) {this.sent.push(value);}
  receive(value) {this.onmessage?.({data: typeof value === 'string' ? value : JSON.stringify(value)});}
  close() {this.readyState = 3;this.onclose?.();}
}
class Audio {
  constructor() {this.sampleRate = 16000;this.audioWorklet = {addModule: async () => {}};this.destination = {};this.closed = false;Audio.instances.push(this);}
  static instances = [];
  async resume() {}
  createMediaStreamSource() {return {connect() {}, disconnect() {}};}
  async close() {this.closed = true;}
}
class Worklet {
  static instances = [];
  constructor() {this.port = {onmessage: null, close() {}};Worklet.instances.push(this);}
  connect() {}
  disconnect() {}
}
function fixture(options = {}) {
  assert.equal(typeof createVoiceClient, 'function', 'browser voice client is implemented');
  const track = {stopped: false, stop() {this.stopped = true;}}, stream = {getTracks: () => [track]}, states = [], transcripts = [];
  const client = createVoiceClient({endpoint: 'ws://127.0.0.1/ws/voice', WebSocketImpl: Socket, AudioContextImpl: Audio, AudioWorkletNodeImpl: Worklet, mediaDevices: {getUserMedia: async () => stream}, onState: value => states.push(value), onTranscript: (text, target) => transcripts.push({text, target}), ...options});
  return {client, track, stream, states, transcripts};
}
async function ready(f, target = {projectId: 'project-a', taskId: 'task-a', draftKey: 'project-a::task-a'}) {
  const starting = f.client.start(target);await tick();await tick();
  const socket = Socket.instances.at(-1);assert(socket);socket.open();
  const session = JSON.parse(socket.sent[0]);
  socket.receive({type: 'session.ready', requestId: session.requestId, voiceSessionId: 'voice-a', contextVersion: session.context.contextVersion, captureId: null, seq: 1});
  const capture = JSON.parse(socket.sent[1]);
  socket.receive({type: 'capture.ready', requestId: capture.requestId, captureId: capture.captureId, contextVersion: capture.contextVersion, input: capture.format, output: null, seq: 2});
  assert.equal(await starting, true);
  return {socket, session, capture, worklet: Worklet.instances.at(-1)};
}
test('voice capture freezes context and sends PCM only after negotiated readiness', async t => {
  const f = fixture();t.after(() => f.client.close());
  const target = {projectId: 'project-a', taskId: 'task-a', draftKey: 'project-a::task-a'};
  const wire = await ready(f, target);target.projectId = 'project-b';
  assert.equal(wire.session.context.projectId, 'project-a');assert.equal(wire.session.context.taskId, 'task-a');
  assert.deepEqual(wire.capture.format, {codec: 'pcm_s16le', sampleRate: 16000, channels: 1, frameMs: 20});
  wire.worklet.port.onmessage({data: new ArrayBuffer(640)});
  assert.equal(wire.socket.sent.at(-1).byteLength, 640);
  await f.client.stop();
  const sent = wire.socket.sent.length;wire.worklet.port.onmessage?.({data: new ArrayBuffer(640)});assert.equal(wire.socket.sent.length, sent);
  assert.equal(f.track.stopped, true);assert.equal(Audio.instances.at(-1).closed, true);
});
test('only the latest matching final is committed to the original draft after stopping', async t => {
  const f = fixture();t.after(() => f.client.close());const wire = await ready(f);
  wire.socket.receive({type: 'stt.final', captureId: 'other', text: 'wrong task', seq: 3});
  wire.socket.receive({type: 'stt.final', captureId: wire.capture.captureId, text: 'first candidate', seq: 4});
  wire.socket.receive({type: 'stt.final', captureId: wire.capture.captureId, text: 'final candidate', seq: 5});
  assert.equal(f.transcripts.length, 0);
  await f.client.stop();
  wire.socket.receive({type: 'capture.stopped', captureId: wire.capture.captureId, lastSeq: 0, seq: 6});
  assert.equal(f.transcripts.length, 0, 'a candidate received before stop must not hide the final recognition tail');
  wire.socket.receive({type: 'stt.final', captureId: wire.capture.captureId, text: 'final tail candidate', seq: 7});
  await tick();assert.deepEqual(f.transcripts.map(item => item.text), ['final tail candidate']);assert.equal(f.transcripts[0].target.draftKey, 'project-a::task-a');
});
test('abort ignores late transcript and stops all browser resources', async () => {
  const f = fixture(), wire = await ready(f);await f.client.abort();
  wire.socket.receive({type: 'stt.final', captureId: wire.capture.captureId, text: 'late', seq: 3});
  assert.equal(f.transcripts.length, 0);assert.equal(f.track.stopped, true);assert.equal(Audio.instances.at(-1).closed, true);assert.equal(wire.socket.readyState, 3);
});
test('audio close errors cannot prevent abort cleanup', async () => {
  class ThrowingAudio extends Audio {close() {this.closed = true;throw Error('already closed');}}
  const f = fixture({AudioContextImpl: ThrowingAudio}), wire = await ready(f);await f.client.abort();
  assert.equal(f.track.stopped, true);assert.equal(wire.socket.readyState, 3);assert.equal(f.client.active, false);assert.equal(f.client.state, 'idle');
});
test('processor errors stop capture immediately without committing a candidate', async () => {
  const f = fixture(), wire = await ready(f);
  wire.socket.receive({type: 'stt.final', captureId: wire.capture.captureId, text: 'unfinished candidate', seq: 3});
  assert.equal(typeof wire.worklet.onprocessorerror, 'function');wire.worklet.onprocessorerror();await tick();
  assert.equal(f.transcripts.length, 0);assert.equal(f.track.stopped, true);assert.equal(wire.socket.readyState, 3);assert.equal(f.states.at(-1).reason, 'capture_unavailable');assert.equal(wire.worklet.onprocessorerror, null);
});
test('an old abort finishing audio cleanup cannot overwrite a newly started capture state', async () => {
  let grants = 0, finishClose;
  const f = fixture({mediaDevices: {getUserMedia: async () => {if (++grants === 1) return f.stream;return new Promise(() => {});}}});
  await ready(f);Audio.instances.at(-1).close = () => new Promise(resolve => {finishClose = resolve;});
  const aborting = f.client.abort(), starting = f.client.start({projectId: 'next', draftKey: 'next::new'});finishClose();await aborting;
  assert.equal(f.client.active, true);assert.notEqual(f.client.state, 'idle');
  await f.client.abort();await starting;
});
test('permission resolving after abort releases the late stream without connecting', async () => {
  let grant;const f = fixture({mediaDevices: {getUserMedia: () => new Promise(resolve => {grant = resolve;})}});
  const count = Socket.instances.length, starting = f.client.start({projectId: 'p', draftKey: 'p::new'});await tick();await f.client.abort();grant(f.stream);await starting;await tick();
  assert.equal(f.track.stopped, true);assert.equal(Socket.instances.length, count);
});
test('permission errors surface safely and close the audio context', async () => {
  const f = fixture({mediaDevices: {getUserMedia: async () => {throw Object.assign(Error('private device name'), {name: 'NotAllowedError'});}}});
  assert.equal(await f.client.start({projectId: 'p', draftKey: 'p::new'}), false);
  assert.equal(f.states.at(-1).state, 'error');assert.equal(f.states.at(-1).reason, 'microphone_denied');assert.equal(JSON.stringify(f.states).includes('private device'), false);assert.equal(Audio.instances.at(-1).closed, true);
});
test('backpressure aborts instead of buffering or replaying audio', async t => {
  const f = fixture();t.after(() => f.client.close());const wire = await ready(f);wire.socket.bufferedAmount = 65537;
  wire.worklet.port.onmessage({data: new ArrayBuffer(640)});await tick();
  assert.equal(f.states.at(-1).reason, 'backpressure');assert.equal(f.track.stopped, true);assert.equal(wire.socket.readyState, 3);
});
test('startup and post-stop recognition have bounded waits and release resources', async () => {
  const f = fixture({startTimeoutMs: 10});assert.equal(await f.client.start({projectId: 'p', draftKey: 'p::new'}), false);
  assert.equal(f.states.at(-1).reason, 'connection_timeout');assert.equal(f.track.stopped, true);
  const g = fixture({finalTimeoutMs: 10});await ready(g);await g.client.stop();await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(g.states.at(-1).reason, 'recognition_timeout');assert.equal(g.transcripts.length, 0);assert.equal(g.track.stopped, true);
});
test('capture frame budget stops recording without sending an extra frame', async t => {
  const f = fixture({maxFrames: 1});t.after(() => f.client.close());const wire = await ready(f);
  wire.worklet.port.onmessage({data: new ArrayBuffer(640)});wire.worklet.port.onmessage({data: new ArrayBuffer(640)});
  assert.equal(wire.socket.sent.filter(value => value instanceof ArrayBuffer).length, 1);assert.equal(JSON.parse(wire.socket.sent.at(-1)).type, 'capture.stop');assert.equal(f.track.stopped, true);
});
test('provider failure never commits a previously received candidate', async () => {
  const f = fixture(), wire = await ready(f);
  wire.socket.receive({type: 'stt.final', captureId: wire.capture.captureId, text: 'unconfirmed candidate', seq: 3});
  wire.socket.receive({type: 'error', captureId: wire.capture.captureId, code: 'voice_provider', seq: 4});
  assert.equal(f.transcripts.length, 0);assert.equal(f.states.at(-1).reason, 'provider_error');assert.equal(f.track.stopped, true);
});
test('a pre-stop final remains available after the bounded recognition tail', async () => {
  const f = fixture({finalTimeoutMs: 10}), wire = await ready(f);
  wire.socket.receive({type: 'stt.final', captureId: wire.capture.captureId, text: 'pre-stop final', seq: 3});await f.client.stop();
  wire.socket.receive({type: 'capture.stopped', captureId: wire.capture.captureId, lastSeq: 0, seq: 4});await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(f.transcripts.map(item => item.text), ['pre-stop final']);
});
test('valid maximum-length project and task IDs retain their full draft key', async t => {
  const f = fixture();t.after(() => f.client.close());const projectId = 'p'.repeat(128), taskId = 't'.repeat(128), draftKey = projectId + '::' + taskId;
  const wire = await ready(f, {projectId, taskId, draftKey});assert.equal(wire.session.context.projectId, projectId);
});
test('the real browser default resolves a secure same-origin voice WebSocket', async t => {
  const previous = globalThis.location;globalThis.location = {href: 'https://fixture.invalid/workspace', origin: 'https://fixture.invalid'};t.after(() => {if (previous === undefined) delete globalThis.location;else globalThis.location = previous;});
  const f = fixture({endpoint: undefined});t.after(() => f.client.close());const wire = await ready(f);assert.equal(wire.socket.url, 'wss://fixture.invalid/ws/voice');
});
test('automatic capture stop leaves a margin before the server thirty-second limit', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});const f = fixture();t.after(() => f.client.close());const wire = await ready(f);
  t.mock.timers.tick(28999);assert.equal(f.client.state, 'recording');t.mock.timers.tick(1);assert.equal(f.client.state, 'stopping');assert.equal(JSON.parse(wire.socket.sent.at(-1)).type, 'capture.stop');
});
test('audio worklet emits exact 20 ms PCM frames and silent speaker output', async () => {
  let Processor;const buffers = [];
  const context = vm.createContext({AudioWorkletProcessor: class {constructor() {this.port = {postMessage: buffer => buffers.push(buffer)};}}, registerProcessor: (_name, value) => {Processor = value;}, sampleRate: 16000, Int16Array, Float32Array, Math});
  let source = '';try {source = await readFile(new URL('../public/voice-worklet.js', import.meta.url), 'utf8');} catch {}
  assert(source.length, 'bounded PCM audio worklet is implemented');vm.runInContext(source, context, {filename: fileURLToPath(new URL('../public/voice-worklet.js', import.meta.url))});const processor = new Processor();
  const output = new Float32Array(128).fill(1);
  for (let index = 0; index < 3; index++) processor.process([[new Float32Array(128).fill(.5)]], [[output]]);
  assert.equal(buffers.length, 1);assert.equal(buffers[0].byteLength, 640);assert.equal(new Int16Array(buffers[0])[0], 16384);assert(output.every(value => value === 0));
});
async function workletFixture(sampleRate = 16000) {
  let Processor;const buffers = [], path = new URL('../public/voice-worklet.js', import.meta.url);
  const context = vm.createContext({AudioWorkletProcessor: class {constructor() {this.port = {postMessage: buffer => buffers.push(buffer)};}}, registerProcessor: (_name, value) => {Processor = value;}, sampleRate, Int16Array, Float32Array, Math});
  vm.runInContext(await readFile(path, 'utf8'), context, {filename: fileURLToPath(path)});
  return {processor: new Processor(), buffers};
}
test('worklet clips signed extremes and preserves sample order across callback and frame boundaries', async () => {
  const {processor, buffers} = await workletFixture(), pattern = [-2, -1, -.5, 0, .5, 1, 2], expected = [-32768, -32768, -16384, 0, 16384, 32767, 32767];
  const input = Float32Array.from({length: 640}, (_, index) => pattern[index % pattern.length]);
  processor.process([[input.slice(0, 111)]], []);assert.equal(buffers.length, 0);
  processor.process([[input.slice(111, 321)]], []);assert.equal(buffers.length, 1);
  processor.process([[input.slice(321)]], []);assert.equal(buffers.length, 2);assert.notEqual(buffers[0], buffers[1]);
  const samples = buffers.flatMap(buffer => [...new Int16Array(buffer)]);
  assert.equal(samples.length, 640);for (let index = 0; index < samples.length; index++) assert.equal(samples[index], expected[index % expected.length]);
});
test('worklet missing input and unsupported actual sample rate emit no PCM and silence every output', async () => {
  for (const sampleRate of [16000, 48000]) {
    const {processor, buffers} = await workletFixture(sampleRate), output = new Float32Array(320).fill(1);
    assert.equal(processor.process([], [[output]]), true);assert(output.every(value => value === 0));
    assert.equal(processor.process([[]], []), true);
    if (sampleRate !== 16000) {output.fill(1);assert.equal(processor.process([[new Float32Array(320).fill(.5)]], [[output]]), true);assert(output.every(value => value === 0));}
    assert.equal(buffers.length, 0);
  }
});
test('unsupported browser capabilities and invalid capture budgets reject before requesting media', () => {
  for (const options of [{mediaDevices: null}, {AudioContextImpl: null}, {AudioWorkletNodeImpl: null}, {WebSocketImpl: null}, {startTimeoutMs: 0}, {finalTimeoutMs: 1.5}, {captureTimeoutMs: 30001}, {maxFrames: 1501}]) assert.throws(() => fixture(options), /Browser voice capture unavailable/);
});
test('unsafe endpoints and a foreign secure origin are rejected before recording', t => {
  for (const endpoint of ['https://fixture.invalid/ws/voice', 'ws://fixture.invalid/ws/voice', 'wss://user:pass@fixture.invalid/ws/voice', 'wss://fixture.invalid/ws/voice?token=private', 'wss://fixture.invalid/ws/voice#fragment', 'wss://fixture.invalid/other']) assert.throws(() => fixture({endpoint}), /Secure same-origin voice endpoint required/);
  const previous = globalThis.location;globalThis.location = {href: 'https://fixture.invalid/', origin: 'https://fixture.invalid'};
  t.after(() => {if (previous === undefined) delete globalThis.location;else globalThis.location = previous;});
  assert.throws(() => fixture({endpoint: 'wss://foreign.invalid/ws/voice'}), /Same-origin voice endpoint required/);
});
test('invalid or ambiguous frozen targets reject without opening a socket', async () => {
  const f = fixture(), before = Socket.instances.length, valid = {projectId: 'p', draftKey: 'p::new'};
  for (const target of [null, {...valid, projectId: '../p'}, {...valid, draftKey: ''}, {...valid, draftKey: 'x'.repeat(513)}, {...valid, draftKey: 'p\nprivate'}, {...valid, taskId: ''}, {...valid, parentTaskId: '../parent'}, {...valid, taskId: 'task', parentTaskId: 'parent'}]) await assert.rejects(f.client.start(target), /fixed voice draft target/);
  assert.equal(Socket.instances.length, before);assert.equal(f.client.active, false);
});
async function opening(f) {
  const starting = f.client.start({projectId: 'p', parentTaskId: 'parent', draftKey: 'p::new:parent'});await tick();await tick();
  const socket = Socket.instances.at(-1);socket.open();return {starting, socket, session: JSON.parse(socket.sent[0]), worklet: Worklet.instances.at(-1)};
}
test('session handshake rejects mismatched identity and never sends capture or audio', async () => {
  for (const mismatch of [{requestId: 'foreign'}, {contextVersion: 99}, {voiceSessionId: ''}, {captureId: undefined}]) {
    const f = fixture(), wire = await opening(f);
    wire.socket.receive({type: 'session.ready', requestId: wire.session.requestId, contextVersion: wire.session.context.contextVersion, voiceSessionId: 'voice', captureId: null, seq: 1, ...mismatch});
    assert.equal(await wire.starting, false);assert.equal(f.states.at(-1).reason, 'invalid_event');assert.equal(wire.socket.sent.length, 1);assert.equal(f.track.stopped, true);
  }
});
test('negotiated format and capture identity must match before any PCM upload', async () => {
  for (const mismatch of [{input: null}, {input: {codec: 'opus'}}, {input: {codec: 'pcm_s16le', sampleRate: 48000, channels: 1, frameMs: 20}}, {requestId: 'foreign'}, {contextVersion: 99}]) {
    const f = fixture(), wire = await opening(f);
    assert.equal(wire.session.context.parentTaskId, 'parent');assert.equal(wire.session.context.taskId, undefined);
    wire.worklet.port.onmessage({data: new ArrayBuffer(640)});assert.equal(wire.socket.sent.length, 1);
    wire.socket.receive({type: 'session.ready', requestId: wire.session.requestId, contextVersion: wire.session.context.contextVersion, voiceSessionId: 'voice', captureId: null, seq: 1});
    const capture = JSON.parse(wire.socket.sent[1]);
    wire.socket.receive({type: 'capture.ready', requestId: capture.requestId, captureId: capture.captureId, contextVersion: capture.contextVersion, input: capture.format, seq: 2, ...mismatch});
    assert.equal(await wire.starting, false);assert.equal(f.states.at(-1).reason, 'format_unavailable');assert.equal(wire.socket.sent.filter(value => value instanceof ArrayBuffer).length, 0);assert.equal(f.track.stopped, true);
  }
});
test('wrong actual browser sample rate or missing worklet support closes media without connecting', async () => {
  for (const configure of [audio => {audio.sampleRate = 48000;}, audio => {audio.audioWorklet = null;}]) {
    class UnsupportedAudio extends Audio {constructor() {super();configure(this);}}
    const before = Socket.instances.length, f = fixture({AudioContextImpl: UnsupportedAudio});
    assert.equal(await f.client.start({projectId: 'p', draftKey: 'p::new'}), false);assert.equal(f.states.at(-1).reason, 'format_unavailable');assert.equal(f.track.stopped, true);assert.equal(Socket.instances.length, before);
  }
});
test('malformed, oversized and invalid-sequence events terminate without changing the draft', async () => {
  for (const data of ['not json', 'null', '[]', '{"seq":-1}', '{"seq":1.5}', 'x'.repeat(65537), new ArrayBuffer(65537)]) {
    const f = fixture(), wire = await ready(f);wire.socket.onmessage({data});
    assert.equal(f.states.at(-1).reason, 'invalid_event');assert.equal(f.transcripts.length, 0);assert.equal(f.track.stopped, true);
  }
});
test('transcript type, size and context mismatches never become a draft candidate', async () => {
  for (const mismatch of [{text: 3}, {text: 'x'.repeat(4001)}, {contextVersion: 99}]) {
    const f = fixture(), wire = await ready(f);wire.socket.receive({type: 'stt.final', captureId: wire.capture.captureId, text: 'candidate', seq: 3, ...mismatch});
    assert.equal(f.states.at(-1).reason, 'invalid_event');assert.equal(f.transcripts.length, 0);assert.equal(f.track.stopped, true);
  }
});
test('foreign capture events and stale sequences cannot replace a valid partial', async t => {
  const partials = [], f = fixture({onPartial: text => partials.push(text)});t.after(() => f.client.close());const wire = await ready(f);
  wire.socket.receive({type: 'stt.partial', captureId: 'foreign', text: 'foreign', seq: 100});
  wire.socket.receive({type: 'stt.partial', captureId: wire.capture.captureId, text: 'current', seq: 3});
  wire.socket.receive({type: 'stt.partial', captureId: wire.capture.captureId, text: 'stale', seq: 3});
  wire.socket.onmessage({data: new ArrayBuffer(10)});assert.deepEqual(partials, ['current']);assert.equal(f.client.state, 'recording');
});
test('invalid worklet frame shape and failed audio send stop recording without replay', async () => {
  for (const data of [new Uint8Array(640), new ArrayBuffer(638)]) {
    const f = fixture(), wire = await ready(f);wire.worklet.port.onmessage({data});assert.equal(f.states.at(-1).reason, 'format_unavailable');assert.equal(f.track.stopped, true);
  }
  const f = fixture(), wire = await ready(f);wire.socket.send = () => {throw Error('private socket failure');};wire.worklet.port.onmessage({data: new ArrayBuffer(640)});
  assert.equal(f.states.at(-1).reason, 'connection_failed');assert.equal(f.transcripts.length, 0);assert.equal(f.track.stopped, true);
});
test('missing microphone and socket closure surface safe reasons and release resources', async () => {
  const f = fixture({mediaDevices: {getUserMedia: async () => {throw Object.assign(Error('private hardware'), {name: 'NotFoundError'});}}});
  assert.equal(await f.client.start({projectId: 'p', draftKey: 'p::new'}), false);assert.equal(f.states.at(-1).reason, 'microphone_missing');
  for (const event of ['onerror', 'onclose']) {const g = fixture(), wire = await ready(g);wire.socket[event]();assert.equal(g.states.at(-1).reason, event === 'onerror' ? 'connection_failed' : 'connection_closed');assert.equal(g.track.stopped, true);}
});
test('draft persistence failure reports an error after resource cleanup without resubmission', async () => {
  const f = fixture({onTranscript: () => {throw Error('private storage failure');}}), wire = await ready(f);await f.client.stop();
  wire.socket.receive({type: 'capture.stopped', captureId: wire.capture.captureId, seq: 3});wire.socket.receive({type: 'stt.final', captureId: wire.capture.captureId, text: 'candidate', seq: 4});
  assert.equal(f.states.at(-1).reason, 'draft_unavailable');assert.equal(f.track.stopped, true);assert.equal(wire.socket.readyState, 3);assert.equal(f.client.active, false);
});
