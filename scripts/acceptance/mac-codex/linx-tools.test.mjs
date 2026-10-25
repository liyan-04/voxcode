import test from 'node:test';
import assert from 'node:assert/strict';
import {createMcpDispatcher} from '../../../apps/server/mcp-server.mjs';
import {createLinxDispatcher} from './linx-tools.mjs';

function fixture() {
  let task, launches = 0;
  const service = {
    async listProjects() {return [{id: 'voice', name: 'Read only', enabled: true}, {id: 'write', name: 'Write fixture', enabled: true}];},
    async getProject(id) {return {id, enabled: ['voice', 'write'].includes(id)};},
    async status() {return {available: true};},
    async listTasks() {return task ? [task] : [];},
    async startTask(input) {task ??= {id: 'task-1', revision: 1, status: 'draft', ...input}; return {taskId: task.id};},
    async getTask() {return task;},
    async confirmTask() {launches++; task.status = 'running'; return task;},
    async cancelTask() {task.status = 'cancelled'; return task;},
    async getLogs() {return {logs: []};},
  };
  return {service, launched: () => launches};
}
const call = (name, args) => ({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name, arguments: args}});
test('read-only request retries return the same task without another launch', async () => {
  const f = fixture(), {dispatch} = createLinxDispatcher({...f, createMcpDispatcher});
  const request = call('codex_ask_readonly', {prompt: 'Read the fixture', requestId: 'read-1'});
  assert.equal(JSON.parse((await dispatch(request)).result.content[0].text).taskId, 'task-1');
  await dispatch({...request, id: 2});
  assert.equal(f.launched(), 1);
});
test('write drafts cannot execute through MCP and caller sandbox options are rejected', async () => {
  const f = fixture(), {dispatch} = createLinxDispatcher({...f, createMcpDispatcher});
  const draft = await dispatch(call('codex_start_task', {projectId: 'write', prompt: 'Fix code', requestId: 'write-1'}));
  assert.ok(draft.result && !draft.result.isError);
  assert.equal(f.launched(), 0);
  assert.equal((await dispatch(call('codex_confirm_task', {taskId: 'task-1'}))).error.code, -32602);
  for (const args of [{prompt: 'Hello', requestId: 'r', sandbox: 'workspace-write'}, {prompt: 'Hello', requestId: 'r', projectId: 'write'}, {prompt: '', requestId: 'r'}, {prompt: 'Hello', requestId: ''}, []]) {
    assert.equal((await dispatch(call('codex_ask_readonly', args))).error.code, -32602);
  }
  assert.equal(f.launched(), 0);
});
test('discovery and errors do not advertise uncollected evidence or arbitrary launch tools', async () => {
  const f = fixture(), {dispatch} = createLinxDispatcher({...f, createMcpDispatcher});
  const response = await dispatch({jsonrpc: '2.0', id: 1, method: 'tools/list'});
  const names = response.result.tools.map(tool => tool.name);
  assert.ok(names.includes('codex_ask_readonly'));
  assert.ok(!names.includes('codex_task_diff'));
  assert.ok(!names.includes('codex_confirm_task'));
  f.service.startTask = async () => {throw Object.assign(Error('private details'), {code: 'busy'});};
  const busy = await dispatch(call('codex_ask_readonly', {prompt: 'Hello', requestId: 'r'}));
  assert.match(busy.error.message, /retry later/);
  f.service.startTask = async () => {throw Error('private details');};
  assert.ok(!(await dispatch(call('codex_ask_readonly', {prompt: 'Hello', requestId: 'r'}))).error.message.includes('private details'));
  assert.equal((await dispatch({...call('codex_ask_readonly', {}), jsonrpc: 'invalid'})).error.code, -32600);
});
