import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough, Writable} from 'node:stream';
import {createCodexCliAdapter} from '../../../apps/server/codex-cli-adapter.mjs';

for (const [exitCode, expectedStatus] of [[0, 'completed'], [42, 'failed']]) {
test(`CLI exit ${exitCode} with lingering descendants remains ${expectedStatus} after cleanup`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'mac-codex-lifecycle-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const signals = [];
  const adapter = createCodexCliAdapter({projectRoot: root, dataDir: root, killGraceMs: 1,
    groupExists: () => !signals.includes('SIGKILL'), signalGroup: (_pid, signal) => signals.push(signal),
    spawnImpl: () => {
      const child = new EventEmitter();
      child.pid = 424242;
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.stdin = new Writable({write(_chunk, _encoding, callback) {callback();}, final(callback) {
        queueMicrotask(() => {child.stdout.write('{"type":"item.completed","item":{"type":"agent_message","text":"OK"}}\n'); child.emit('close', exitCode);});
        callback();
      }});
      return child;
    },
  });
  const {taskId} = await adapter.startTask({prompt: 'Answer OK'});
  await adapter.confirmTask(taskId);
  const task = await adapter.getTask(taskId);
  assert.equal(task.status, expectedStatus);
  assert.equal(task.output, 'OK');
  assert.equal(task.exitCode, exitCode);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});
}

test('CLI launch failure reports failure and releases the execution slot', async t => {
  const root = await mkdtemp(join(tmpdir(), 'mac-codex-launch-failure-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const adapter = createCodexCliAdapter({projectRoot: root, dataDir: root,
    spawnImpl: () => {throw Error('Synthetic launch failure');},
  });
  const {taskId} = await adapter.startTask({prompt: 'Answer OK'});
  assert.equal((await adapter.confirmTask(taskId)).status, 'failed');
  assert.equal((await adapter.status()).activeTasks, 0);
});

test('unconfirmed descendant cleanup quarantines a successful CLI exit and retains the slot', async t => {
  const root = await mkdtemp(join(tmpdir(), 'mac-codex-quarantine-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const adapter = createCodexCliAdapter({projectRoot: root, dataDir: root, killGraceMs: 1,
    groupExists: () => true, signalGroup: () => {},
    spawnImpl: () => {
      const child = new EventEmitter();
      child.pid = 424242;
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.stdin = new Writable({write(_chunk, _encoding, callback) {callback();}, final(callback) {
        queueMicrotask(() => child.emit('close', 0)); callback();
      }});
      return child;
    },
  });
  const {taskId} = await adapter.startTask({prompt: 'Answer OK'});
  await adapter.confirmTask(taskId);
  const task = await adapter.getTask(taskId);
  assert.equal(task.status, 'cancelling');
  assert.equal(task.quarantined, true);
  assert.equal(task.error, 'Process group cleanup unconfirmed');
  assert.equal((await adapter.status()).activeTasks, 1);
});
