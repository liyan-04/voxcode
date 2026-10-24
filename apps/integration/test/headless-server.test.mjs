import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { createService } from '../../mac/service.mjs';
import { createServer } from '../../mac/server.mjs';
import { runCodex } from '../../mac/codex.mjs';
import { createRelay } from '../../relay/relay.mjs';
import { createConnector } from '../../relay/connector.mjs';
import { createVoiceHandler } from '../voice.mjs';
import { createLinxSession } from '../../../packages/voice/src/index.js';

const OpusScript = createRequire(new URL('../../../packages/voice/package.json', import.meta.url))('opusscript');
const config = { url: 'wss://fixture.invalid/v1/ws/', token: 'fixture-provider-token',
  deviceId: 'aa:bb:cc:dd:ee:ff', clientId: '12345678-1234-4234-8234-123456789abc' };

function opusPacket() {
  const codec = new OpusScript(24000, 1, OpusScript.Application.AUDIO);
  try {
    const pcm = Buffer.alloc(960);
    for (let i = 0; i < 480; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin(i * 0.1)), i * 2);
    return Buffer.from(codec.encode(pcm, 480));
  } finally { codec.delete(); }
}

async function eventually(read, check, label) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = await read();
    if (check(value)) return value;
    await delay(20);
  }
  assert.fail(`Timed out waiting for ${label}`);
}

// This composes real local transport, worktrees and a controlled stdio child.
// Linx and model execution remain fixtures; no audio device or external call is used.
test('headless phone confirmation composes Relay, Connector, Linx MCP, Opus and isolated stdio execution', { timeout: 20000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'vox-headless-'));
  let connector, voice, bridge, relay;
  t.after(async () => {
    await connector?.close();
    voice?.close();
    bridge?.server.closeAllConnections();
    try { await bridge?.close(); } finally {
      try { await relay?.close(); } finally { await rm(root, { recursive: true, force: true }); }
    }
  });
  const project = join(root, 'project'), state = join(root, 'state');
  await mkdir(project);
  await writeFile(join(project, 'initial.txt'), 'original\n');
  const git = (...args) => execFileSync('git', ['-C', project, ...args], { stdio: 'pipe', timeout: 5000 });
  git('init'); git('add', 'initial.txt');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'chore: fixture');
  const executable = join(root, 'controlled-app-server.mjs');
  await copyFile(new URL('../../mac/test/fixtures/app-server.mjs', import.meta.url), executable);
  const packet = opusPacket(), providers = [];
  class ProviderSocket extends EventEmitter {
    constructor(url, options) {
      super(); this.url = url; this.options = options; this.bufferedAmount = 0;
      this.audioBytes = 0; this.sent = []; this.replies = []; this.providerSession = `fixture-${providers.length}`;
      providers.push(this); setImmediate(() => this.emit('open'));
    }
    json(value) { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
    rpc(id, method, params) { this.json({ type: 'mcp', payload: { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) } }); }
    send(data) {
      if (typeof data !== 'string') { this.audioBytes += data.length; return; }
      const message = JSON.parse(data); this.sent.push(message);
      if (message.type === 'hello') setImmediate(() => {
        this.json({ type: 'hello', transport: 'websocket', session_id: this.providerSession,
          ...(this === providers[2] ? {} : { audio_params: { format: 'opus', sample_rate: 24000, channels: 1, frame_duration: 20 } }) });
        this.rpc(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {} });
        this.rpc(2, 'tools/list');
      });
      if (message.type === 'mcp') this.replies.push(message);
      if (message.type === 'listen' && message.state === 'stop') {
        this.json({ type: 'stt', session_id: this.providerSession, text: 'Create the fixture file' });
        const proposal = { name: 'propose_task', arguments: { title: 'Fixture task', prompt: 'new' } };
        this.rpc(3, 'tools/call', proposal); this.rpc(3, 'tools/call', proposal);
        this.json({ type: 'tts', session_id: this.providerSession, state: 'start' });
        this.emit('message', packet, true);
        this.json({ type: 'tts', session_id: this.providerSession, state: 'stop' });
      }
    }
    close() { this.closed = true; this.emit('close'); }
  }
  voice = createVoiceHandler({ config, sessionFactory: input => createLinxSession({ ...input, WebSocketImpl: ProviderSocket }) });
  let executions = 0;
  const service = createService({ project, dataDir: state, executor: options => {
    executions++;
    return runCodex({ ...options, command: process.execPath, args: [executable], terminationGraceMs: 40 });
  } });
  bridge = createServer({ service, voiceHandler: voice });
  bridge.server.listen(0, '127.0.0.1'); await once(bridge.server, 'listening');
  const machineId = 'fixture-server', machineKey = 'fixture-server-machine-key-longer-than-32-characters';
  relay = createRelay({ machineId, machineKey });
  relay.server.listen(0, '127.0.0.1'); await once(relay.server, 'listening');
  const origin = `http://127.0.0.1:${relay.server.address().port}`;
  connector = createConnector({ machineId, machineKey, relayURL: origin.replace('http:', 'ws:') + '/connector',
    bridgeURL: `http://127.0.0.1:${bridge.server.address().port}`, reconnect: false });
  let bearer;
  const request = async (path, { method = 'GET', body, status = 200, authorize = true } = {}) => {
    const binary = Buffer.isBuffer(body), headers = {};
    if (authorize && bearer) headers.authorization = `Bearer ${bearer}`;
    if (body !== undefined) headers['content-type'] = binary ? 'application/octet-stream' : 'application/json';
    const response = await fetch(origin + path, { method, headers, signal: AbortSignal.timeout(5000),
      body: body === undefined ? undefined : binary ? body : JSON.stringify(body) });
    const value = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(value)}`);
    return value;
  };
  const completed = id => eventually(async () => (await request(`/api/tasks/${id}`)).task, task => {
    assert(!['failed', 'interrupted'].includes(task.status), task.summary);
    return task.status === 'completed';
  }, 'completed stdio fixture task');

  await connector.start();
  await request('/api/tasks', { status: 401 });
  await request('/api/voice/sessions', { method: 'POST', body: {}, status: 401 });
  assert.equal(providers.length, 0);
  bearer = (await request('/api/pair', { method: 'POST', body: { code: service.pairCode }, authorize: false })).sessionToken;
  const recordingBody = { requestId: 'voice-1', taskId: null, version: null };
  const recording = await request('/api/voice/sessions', { method: 'POST', body: recordingBody });
  assert.equal((await request('/api/voice/sessions', { method: 'POST', body: recordingBody })).id, recording.id);
  assert.equal(providers.length, 1);
  assert.deepEqual(recording.inputFormat, { sampleRate: 16000, channels: 1, encoding: 'pcm_s16le' });
  assert.deepEqual(recording.outputFormat, { format: 'pcm', sample_rate: 24000, channels: 1 });
  const provider = providers[0];
  assert.equal(provider.options.headers.Authorization, 'Bearer fixture-provider-token');
  assert.equal(provider.options.headers['Protocol-Version'], '1');
  assert.equal(provider.sent[0].features.mcp, true);
  assert.equal(provider.sent[0].audio_params.format, 'pcm');
  assert.equal(provider.sent[0].audio_params.sample_rate, 16000);
  assert.deepEqual(JSON.parse(provider.sent[0].agent_params.custom_replace_prompt.voxcode_target), { taskId: null, version: null });
  await eventually(async () => provider.replies, replies => replies.length === 2, 'MCP discovery');
  assert.equal(provider.replies.find(reply => reply.payload.id === 1).payload.result.protocolVersion, '2024-11-05');
  const tools = provider.replies.find(reply => reply.payload.id === 2).payload.result.tools;
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['get_task_evidence', 'get_task_status', 'list_tasks', 'propose_focus', 'propose_followup', 'propose_task']);
  await request(`/api/voice/sessions/${recording.id}/audio`, { method: 'POST', body: Buffer.alloc(640) });
  await request(`/api/voice/sessions/${recording.id}/stop`, { method: 'POST', body: {} });
  const result = await eventually(() => request(`/api/voice/sessions/${recording.id}/events?after=0`),
    value => value.events.some(event => event.type === 'draft'), 'voice draft');
  assert.equal(provider.audioBytes, 640);
  assert.equal(result.events.find(event => event.type === 'stt').text, 'Create the fixture file');
  const drafts = result.events.filter(event => event.type === 'draft');
  assert.equal(drafts.length, 1, 'duplicate MCP ID emits one proposal');
  const draft = drafts[0].draft;
  assert.equal(draft.taskId, null); assert.equal(draft.version, null);
  const pcm = Buffer.from(result.events.find(event => event.type === 'audio').data, 'base64');
  assert.equal(pcm.length, 960); assert(pcm.some(byte => byte !== 0));
  assert.equal(executions, 0); assert.equal((await request('/api/tasks')).tasks.length, 0);
  await eventually(async () => provider.replies, replies => replies.length === 4, 'deduplicated MCP replies');
  assert.deepEqual(provider.replies.filter(reply => reply.payload.id === 3).map(reply => JSON.parse(reply.payload.result.content[0].text).id), [draft.id, draft.id]);
  assert(provider.sent.slice(1).every(message => message.session_id === provider.providerSession));

  const body = { requestId: 'task-1', title: draft.title, prompt: draft.prompt, criteria: draft.criteria };
  const created = (await request('/api/tasks', { method: 'POST', body })).task;
  const task = await completed(created.id);
  assert(task.evidence.some(item => item.kind === 'diff' && item.value.includes('new visible source')));
  assert(!JSON.stringify(task.evidence).includes('must-not-be-evidence'));
  assert.equal(executions, 1);
  const replay = (await request('/api/tasks', { method: 'POST', body })).task;
  assert.equal(replay.id, created.id); assert.equal(executions, 1);
  await request(`/api/tasks/${created.id}/messages`, { method: 'POST', body: { requestId: 'followup-1', version: 0, prompt: 'new' } });
  await completed(created.id); assert.equal(executions, 2);
  const stored = JSON.parse(await readFile(join(state, 'state.json'), 'utf8')).tasks[created.id];
  assert.notEqual(stored.worktree, project);
  const protocol = (await readFile(join(stored.worktree, 'protocol.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(protocol.filter(message => message.method === 'thread/start').length, 1);
  assert(protocol.some(message => message.method === 'thread/resume' && message.params.threadId === stored.codexThreadId));
  assert.equal(protocol.filter(message => message.method === 'turn/start').length, 2);
  assert.equal(await readFile(join(project, 'initial.txt'), 'utf8'), 'original\n');
  assert.equal(git('status', '--porcelain').toString(), '');

  await request(`/api/voice/sessions/${recording.id}/abort`, { method: 'POST', body: {} });
  const afterAbort = (await request(`/api/voice/sessions/${recording.id}/events`)).cursor;
  provider.emit('message', packet, true);
  assert.deepEqual((await request(`/api/voice/sessions/${recording.id}/events?after=${afterAbort}`)).events, []);
  assert(provider.sent.some(message => message.type === 'abort' && message.session_id === provider.providerSession));
  await request(`/api/voice/sessions/${recording.id}`, { method: 'DELETE' });
  assert.equal(provider.closed, true);
  await request(`/api/voice/sessions/${recording.id}/events`, { status: 409 });

  const frozen = await request('/api/voice/sessions', { method: 'POST', body: { requestId: 'voice-2', taskId: created.id, version: stored.version } });
  const conflicting = providers[1];
  assert.deepEqual(JSON.parse(conflicting.sent[0].agent_params.custom_replace_prompt.voxcode_target), { taskId: created.id, version: stored.version });
  conflicting.json({ type: 'mcp', session_id: 'foreign-session', payload: { jsonrpc: '2.0', id: 99,
    method: 'tools/call', params: { name: 'propose_followup', arguments: { prompt: 'Wrong session' } } } });
  assert.equal(conflicting.closed, true);
  await request(`/api/voice/sessions/${frozen.id}/events`, { status: 409 });
  assert(!conflicting.replies.some(reply => reply.payload.id === 99));
  assert.equal((await request(`/api/tasks/${created.id}`)).task.version, stored.version);
  assert.equal(executions, 2);

  const inputOnly = await request('/api/voice/sessions', { method: 'POST', body: { requestId: 'voice-3', taskId: null, version: null } });
  assert.equal(inputOnly.outputSupported, false); assert.equal(inputOnly.outputFormat, null);
  await request(`/api/voice/sessions/${inputOnly.id}/audio`, { method: 'POST', body: Buffer.alloc(640) });
  await request(`/api/voice/sessions/${inputOnly.id}/stop`, { method: 'POST', body: {} });
  const inputEvents = await request(`/api/voice/sessions/${inputOnly.id}/events`);
  assert.equal(providers[2].audioBytes, 640);
  assert(inputEvents.events.some(event => event.type === 'draft'));
  assert(!inputEvents.events.some(event => event.type === 'audio' || event.type === 'error'));
  assert.equal(executions, 2);
  await request(`/api/voice/sessions/${inputOnly.id}`, { method: 'DELETE' });
  assert.equal(providers[2].closed, true);
});
