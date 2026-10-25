import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeCodexReader} from '../native-codex-reader.mjs';

function fixtureTransport() {
  const calls = [];
  const projects = [
    {id: 'p-empty', name: 'Empty', roots: [], recencyAt: null},
    {id: 'p-code', name: 'Code', roots: [{path: '/tmp/code'}], recencyAt: 20},
  ];
  const threads = [
    {id: 't-1', projectId: 'p-code', cwd: '/tmp/code', status: {type: 'active'}, source: 'appServer'},
    {id: 't-2', projectId: null, cwd: '/tmp/other', status: {type: 'notLoaded'}, source: 'cli'},
  ];
  return {
    calls,
    async request(method, params) {
      calls.push({method, params});
      if (method === 'project/list') {
        const start = params.cursor ? Number(params.cursor) : 0;
        const data = projects.slice(start, start + 1);
        return {data, nextCursor: start + data.length < projects.length ? String(start + data.length) : null};
      }
      if (method === 'thread/list') {
        if (params.archived) return {data: [], nextCursor: null};
        const start = params.cursor ? Number(params.cursor) : 0;
        const data = threads.slice(start, start + 1);
        return {data, nextCursor: start + data.length < threads.length ? String(start + data.length) : null};
      }
      if (method === 'thread/read') {
        const thread = threads.find(value => value.id === params.threadId);
        if (!thread) throw Object.assign(new Error('missing'), {code: 'not_found'});
        return {thread: {...thread, turns: []}};
      }
      if (method === 'thread/turns/list') {
        return params.cursor ? {data: [], nextCursor: null} : {
          data: [{id: 'turn-1', status: 'completed', items: [], itemsView: 'notLoaded'}],
          nextCursor: 'turn-page-2',
        };
      }
      if (method === 'thread/items/list') {
        return params.cursor ? {data: [], nextCursor: null} : {
          data: [
            {turnId: params.turnId, startedAtMs: 100, item: {id: 'item-user', type: 'userMessage', content: [{type: 'text', text: 'hello'}]}},
            {turnId: params.turnId, completedAtMs: 200, item: {id: 'item-agent', type: 'agentMessage', text: 'done'}},
          ],
          nextCursor: null,
        };
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}

test('native reader paginates projects and threads while preserving empty membership', async () => {
  const transport = fixtureTransport();
  const reader = createNativeCodexReader({
    request: transport.request,
    authority: {kind: 'stored-history', executionTarget: 'mac', backendId: 'desktop-stdio'},
    pageSize: 1,
  });
  const inventory = await reader.inventory();
  assert.deepEqual(inventory.projects.map(project => [project.id, project.roots]), [
    ['p-empty', []],
    ['p-code', [{path: '/tmp/code'}]],
  ]);
  assert.deepEqual(inventory.threads.map(thread => [thread.id, thread.projectId]), [
    ['t-1', 'p-code'],
    ['t-2', null],
  ]);
  assert.equal(inventory.source.authority, 'stored-history');
  assert.equal(transport.calls.filter(call => call.method === 'project/list').length, 2);
  assert.equal(transport.calls.filter(call => call.method === 'thread/list').length, 3);
  const threadListCalls = transport.calls.filter(call => call.method === 'thread/list');
  assert.deepEqual(threadListCalls.map(call => call.params.archived), [false, false, true]);
  assert.equal(threadListCalls[0].params.sourceKinds.length, 10);
});

test('native reader returns complete paginated history and retains IDs', async () => {
  const transport = fixtureTransport();
  const reader = createNativeCodexReader({
    request: transport.request,
    authority: {kind: 'stored-history', executionTarget: 'mac', backendId: 'desktop-stdio'},
  });
  const history = await reader.readThread('t-1');
  assert.equal(history.thread.id, 't-1');
  assert.equal(history.turns.length, 1);
  assert.deepEqual(history.turns[0].items.map(item => item.id), ['item-user', 'item-agent']);
  assert.equal(history.source.statusSource, 'stored-history');
});

test('stored history never claims a persisted active status is live', async () => {
  const transport = fixtureTransport();
  const reader = createNativeCodexReader({
    request: transport.request,
    authority: {kind: 'stored-history', executionTarget: 'mac', backendId: 'desktop-stdio'},
  });
  const status = await reader.observeStatus('t-1');
  assert.equal(status.status.type, 'active');
  assert.equal(status.live, false);
  assert.equal(status.statusSource, 'stored-history');
});

test('shared backend status is live only with explicit authority', async () => {
  const transport = fixtureTransport();
  const reader = createNativeCodexReader({
    request: transport.request,
    authority: {kind: 'shared-backend', executionTarget: 'mac', backendId: 'daemon-sock-v1'},
  });
  const status = await reader.observeStatus('t-1');
  assert.equal(status.live, true);
  assert.equal(status.statusSource, 'shared-backend');
});

test('reconnect preserves target and backend source while replacing transport', async () => {
  const first = fixtureTransport();
  const second = fixtureTransport();
  const reader = createNativeCodexReader({
    request: first.request,
    authority: {kind: 'shared-backend', executionTarget: 'mac', backendId: 'daemon-sock-v1'},
  });
  const reconnected = reader.reconnect({request: second.request, backendId: 'daemon-sock-v1'});
  const inventory = await reconnected.inventory();
  assert.equal(inventory.source.executionTarget, 'mac');
  assert.equal(inventory.source.backendId, 'daemon-sock-v1');
  assert.equal(first.calls.length, 0);
  assert.ok(second.calls.length > 0);
});

test('reader exposes no mutation methods that could create a competing turn', () => {
  const reader = createNativeCodexReader({
    request: async () => ({data: [], nextCursor: null}),
    authority: {kind: 'stored-history', executionTarget: 'mac', backendId: 'desktop-stdio'},
  });
  assert.equal('startTurn' in reader, false);
  assert.equal('resumeThread' in reader, false);
});

test('reader bounds paginated native inventory before unbounded accumulation', async () => {
  const transport = fixtureTransport();
  const reader = createNativeCodexReader({
    request: transport.request,
    authority: {kind: 'stored-history', executionTarget: 'mac', backendId: 'desktop-stdio'},
    pageSize: 1,
    maxRecords: 1,
  });
  await assert.rejects(reader.inventory(), {code: 'pagination_limit'});
});
