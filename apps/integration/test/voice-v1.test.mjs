import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createVoiceHandler } from '../voice.mjs';

async function harness(t, options = {}) {
  let args, revoked = false, listener;
  const calls = [];
  const tasks = new Map([
    ['task-a', { id: 'task-a', title: 'Alpha', version: 2, status: 'completed', summary: 'Checked', evidence: [{ kind: 'test', label: 'node --test', value: 'passed', version: 2 }] }],
    ['task-b', { id: 'task-b', title: 'Beta', version: 1, status: 'running', summary: '', evidence: [] }],
  ]);
  const service = {
    get(id) { if (!tasks.has(id)) throw new Error('unknown'); return structuredClone(tasks.get(id)); },
    list() { return [...tasks.values()].map(value => structuredClone(value)); },
    authorize(header) { if (revoked || header !== 'Bearer phone-a') throw Object.assign(new Error('denied'), { status: 401 }); return 'phone-a'; },
    onAuthorizationChange(callback) { listener = callback; return () => { listener = null; }; },
    mutate() { throw new Error('Voice tools must never mutate tasks'); },
  };
  const handler = createVoiceHandler({ config: { token: 'private' }, sessionFactory: input => {
    args = input;
    return {
      async connect() { input.onEvent({ type: 'ready', audioParams: { format: 'pcm', sample_rate: 16000, channels: 1 } }); },
      startListening() { calls.push('start'); }, stopListening() { calls.push('stop'); },
      sendAudio() {}, abort() { calls.push('abort'); }, close() { calls.push('close'); },
    };
  }, ...options });
  const server = createServer(async (req, res) => {
    try { await handler(req, res, service.authorize(req.headers.authorization), service); }
    catch (error) { res.writeHead(error.status ?? 500); res.end(JSON.stringify({ error: { code: error.code, message: error.message } })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { handler.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const request = (path = '', method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}/api/voice/sessions${path}`, {
    method, headers: { authorization: 'Bearer phone-a', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const open = async (taskId = 'task-a', version = 2) => (await request('', 'POST', { requestId: 'recording', taskId, version })).json();
  return { request, open, calls, tasks, get args() { return args; }, revoke() { revoked = true; listener?.(); } };
}

test('registered Linx tools read real task state and propose frozen drafts without executing', async t => {
  const h = await harness(t);
  const voice = await h.open();
  assert.deepEqual(h.args.tools.map(tool => tool.name).sort(), ['get_task_evidence', 'get_task_status', 'list_tasks', 'propose_focus', 'propose_followup', 'propose_task']);
  const tool = name => h.args.tools.find(item => item.name === name);
  assert.equal((await tool('get_task_status').invoke({ taskId: 'task-a' })).status, 'completed');
  assert.equal((await tool('get_task_evidence').invoke({ taskId: 'task-a' })).evidence[0].label, 'node --test');
  const draft = await tool('propose_followup').invoke({ prompt: 'Add one more check', criteria: [{ text: 'Tests pass', required: true }] });
  assert.equal(draft.taskId, 'task-a'); assert.equal(draft.version, 2);
  assert(draft.expiresAt > new Date().toISOString());
  const result = await (await h.request(`/${voice.id}/events?after=0`)).json();
  assert.equal(result.events.find(event => event.type === 'draft').draft.id, draft.id);
  assert.equal(h.tasks.get('task-a').version, 2);
  await assert.rejects(async () => tool('get_task_status').invoke({ taskId: 'task-b' }));
  await assert.rejects(async () => tool('propose_task').invoke({ title: 'Escape', prompt: 'Change task' }));
  h.tasks.get('task-a').version = 3;
  await assert.rejects(async () => tool('propose_followup').invoke({ prompt: 'Stale' }));
});

test('follow-up drafts inherit existing manual criteria unless explicitly edited', async t => {
  const h = await harness(t);
  const original = [{ id: 'checks', text: 'All requested checks pass', required: true, status: 'passed' },
    { id: 'layout', text: 'Review mobile layout', required: false, status: 'pending' }];
  h.tasks.get('task-a').criteria = structuredClone(original);
  await h.open();
  const tool = h.args.tools.find(item => item.name === 'propose_followup');
  const inherited = tool.invoke({ prompt: 'Improve the title' });
  assert.deepEqual(inherited.criteria, original.map(({ text, required }) => ({ text, required })));
  assert.deepEqual(h.tasks.get('task-a').criteria, original);
  const edited = tool.invoke({ prompt: 'Improve the title', criteria: [{ text: 'New manual check', required: true }] });
  assert.deepEqual(edited.criteria, [{ text: 'New manual check', required: true }]);
  assert.throws(() => tool.invoke({ prompt: 'Invalid criteria', criteria: null }));
});

test('new-task drafts validate schemas and closed or revoked tools cannot access state', async t => {
  const h = await harness(t);
  const voice = await h.open(null, null);
  const tool = name => h.args.tools.find(item => item.name === name);
  assert(tool('propose_task'), 'New task draft tool is registered');
  const draft = await tool('propose_task').invoke({ title: 'Timer', prompt: 'Build a timer' });
  assert.equal(draft.taskId, null); assert.equal(draft.version, null); assert.equal(draft.criteria.length, 1);
  for (const bad of [{ title: 'x', prompt: '' }, { title: 'x', prompt: 'x', execute: true }, { title: 'x', prompt: 'x', criteria: [] }, { title: 'x', prompt: 'x', criteria: [{ text: 'x', required: 'yes' }] }]) {
    await assert.rejects(async () => tool('propose_task').invoke(bad));
  }
  assert.equal((await h.request(`/${voice.id}`, 'DELETE')).status, 200);
  assert.equal((await h.request(`/${voice.id}/events?after=0`)).status, 409);
  await assert.rejects(async () => tool('list_tasks').invoke({}));
  const other = await harness(t);
  await other.open();
  other.revoke();
  await assert.rejects(async () => other.args.tools.find(item => item.name === 'get_task_status').invoke({ taskId: 'task-a' }));
  assert(other.calls.includes('close'));
});

test('closing discards draft and audio payloads and rejects further polling', async t => {
  const h = await harness(t);
  const voice = await h.open();
  h.args.tools.find(tool => tool.name === 'propose_followup').invoke({ prompt: 'Add a check' });
  h.args.onEvent({ type: 'audio', data: Buffer.from([1, 0]) });
  const before = await (await h.request(`/${voice.id}/events`)).json();
  assert(before.events.some(event => event.type === 'draft'));
  assert(before.events.some(event => event.type === 'audio'));
  await h.request(`/${voice.id}`, 'DELETE');
  const after = await h.request(`/${voice.id}/events`);
  assert.equal(after.status, 409);
  assert(!JSON.stringify(await after.json()).includes('data'));
});

test('closed entries expire and do not permanently occupy recording capacity', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
  const h = await harness(t, { ttlMs: 20, maxEntries: 1 });
  const first = await h.open();
  await h.request(`/${first.id}`, 'DELETE');
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal((await h.request(`/${first.id}/events`)).status, 404);
  t.mock.timers.tick(600001);
  const next = await h.request('', 'POST', { requestId: 'next-recording', taskId: null, version: null });
  assert.equal(next.status, 200);
  assert.equal(h.calls.filter(call => call === 'start').length, 2);
});

test('negotiated PCM audio, aborted TTS and bounded cursor gaps reach only the owning session', async t => {
  const h = await harness(t);
  const voice = await h.open();
  assert.equal(voice.outputSupported, true);
  assert.deepEqual(voice.outputFormat, { format: 'pcm', sample_rate: 16000, channels: 1 });
  h.args.onEvent({ type: 'audio', data: Buffer.from([1, 0, 2, 0]) });
  h.args.onEvent({ type: 'tts', state: 'stop', is_aborted: true });
  let result = await (await h.request(`/${voice.id}/events?after=0`)).json();
  assert.deepEqual(Buffer.from(result.events.find(event => event.type === 'audio').data, 'base64'), Buffer.from([1, 0, 2, 0]));
  assert.equal(result.events.at(-1).is_aborted, true);
  assert.equal((await h.request(`/${voice.id}/stop`, 'POST')).status, 200);
  assert.equal((await h.request(`/${voice.id}/abort`, 'POST', {})).status, 200);
  assert(h.calls.includes('abort'));
  h.args.onEvent({ type: 'audio', data: Buffer.from([3, 0]) });
  result = await (await h.request(`/${voice.id}/events?after=${result.cursor}`)).json();
  assert(!result.events.some(event => event.type === 'audio'));
  for (let i = 0; i < 300; i++) h.args.onEvent({ type: 'stt', text: `chunk ${i}` });
  const gap = await h.request(`/${voice.id}/events?after=0`);
  assert.equal(gap.status, 409); assert.equal((await gap.json()).error.code, 'cursor_expired');
});
