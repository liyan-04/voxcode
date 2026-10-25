import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeCodexBridge} from '../native-codex-bridge.mjs';

test('Mac bridge freezes execution target and rejects a mismatched reconnect', async () => {
  const requests = [];
  const request = async (method, params) => {
    requests.push({method, params});
    if (method === 'project/list') return {data: [], nextCursor: null};
    if (method === 'thread/list') return {data: [], nextCursor: null};
    throw new Error('unexpected');
  };
  const bridge = createNativeCodexBridge({
    request,
    executionTarget: 'mac',
    backendId: 'desktop-stdio',
  });
  const inventory = await bridge.inventory();
  assert.equal(inventory.source.executionTarget, 'mac');
  assert.throws(() => bridge.reconnect({request, executionTarget: 'server', backendId: 'desktop-stdio'}), /executionTarget/);
  assert.throws(() => bridge.reconnect({request, executionTarget: 'mac', backendId: 'other-backend'}), /backend/);
  assert.equal(requests.length, 3);
});

test('Mac bridge defaults to stored-history and normalizes read-only status', async () => {
  const request = async (method) => {
    if (method === 'thread/read') return {thread: {id: 't-1', status: {type: 'active'}, turns: []}};
    throw new Error('unexpected');
  };
  const bridge = createNativeCodexBridge({request, executionTarget: 'mac', backendId: 'desktop-stdio'});
  const status = await bridge.observeStatus('t-1');
  assert.equal(status.live, false);
  assert.equal(status.statusSource, 'stored-history');
});
