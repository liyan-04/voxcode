import test from 'node:test';
import assert from 'node:assert/strict';
import {rpcMethods, validateRpcPayload, validateCommandEnvelope, stableJson} from '../index.mjs';

const base = {protocolVersion: 1, requestId: 'req-1', operationId: 'op-1', deviceId: 'mac-1', type: 'task_rpc', payload: {method: 'listProjects', params: []}, issuedAt: '2026-10-25T00:00:00.000Z', expiresAt: '2026-10-25T00:00:30.000Z'};
const now = Date.parse(base.issuedAt);
test('task RPC exposes fixed operations and preserves argument arrays', () => {
  assert.equal(rpcMethods.length, 15);
  assert.deepEqual(validateRpcPayload({method: 'getTask', params: ['task-1']}), {method: 'getTask', params: ['task-1']});
  for (const payload of [{method: 'exec', params: ['rm -rf']}, {method: 'getTask', params: ['/tmp', {}]}, {method: 'startTask', params: [{projectId: 'p', prompt: 'hello', requestId: 'r', cwd: '/'}]}]) assert.throws(() => validateRpcPayload(payload), {code: 'invalid_argument'});
});
test('continuation is additive and cannot select a session or omit its mutation identity',()=>{
 const params=['task',{prompt:'follow up',revision:3,requestId:'continue'}];
 assert.deepEqual(validateRpcPayload({method:'continueTask',params}),{method:'continueTask',params});
 for(const change of [{sessionId:'other'},{resumeSessionId:'other'},{revision:undefined},{requestId:undefined},{prompt:' '}])assert.throws(()=>validateRpcPayload({method:'continueTask',params:['task',{...params[1],...change}]}),{code:'invalid_argument'});
});
test('network mutations require their durable request and revision identities', () => {
  for (const payload of [{method: 'startTask', params: [{projectId: 'p', prompt: 'hello'}]}, {method: 'confirmTask', params: ['t', {requestId: 'r'}]}, {method: 'cancelTask', params: ['t']}]) assert.throws(() => validateRpcPayload(payload));
  assert.doesNotThrow(() => validateRpcPayload({method: 'confirmTask', params: ['t', {requestId: 'r', revision: 2}]}));
  assert.doesNotThrow(() => validateRpcPayload({method: 'startTask', params: [{projectId: 'p', prompt: 'hello', requestId: 'r'}]}));
});
test('commands freeze device, protocol, expiry and bounded JSON', () => {
  assert.deepEqual(validateCommandEnvelope(base, {deviceId: 'mac-1', now}), base);
  for (const command of [{...base, deviceId: 'other'}, {...base, protocolVersion: 0}, {...base, expiresAt: base.issuedAt}, {...base, issuedAt:'October 25, 2026 00:00:00 GMT'}, {...base, expiresAt: '2026-10-25T00:02:00.000Z'}, {...base, payload: {method: 'exec', params: []}}]) assert.throws(() => validateCommandEnvelope(command, {deviceId: 'mac-1', now}));
  assert.throws(() => validateCommandEnvelope({...base, payload: {method: 'startTask', params: [{projectId: 'p', prompt: 'x'.repeat(70000), requestId: 'r'}]}}, {now}));
});
test('fingerprints are stable across JSON object key order without changing array order', () => {
  assert.equal(stableJson({b:[1,null],a:{y:2,x:1}}), stableJson({a:{x:1,y:2},b:[1,null]}));
  assert.notEqual(stableJson([1,2]),stableJson([2,1]));
});
test('RPC uses exactly one target source, and projects can open before a task exists', () => {
  for (const extra of [{projectId:'other'}, {taskId:'other'}, {expectedRevision:2}]) assert.throws(() => validateCommandEnvelope({...base, ...extra}, {now}));
  assert.doesNotThrow(() => validateCommandEnvelope({...base, type:'open_project', projectId:'p', payload:{}}, {now}));
  assert.throws(() => validateCommandEnvelope({...base, type:'switch_task', projectId:'p', payload:{}}, {now}));
});
