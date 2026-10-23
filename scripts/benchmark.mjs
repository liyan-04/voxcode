import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { cpus, platform, release, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createServer } from '../apps/mac/server.mjs';

const root = new URL('../', import.meta.url);
const outIndex = process.argv.indexOf('--output');
const output = resolve(outIndex >= 0 ? process.argv[outIndex + 1] : 'coverage/benchmark.json');
const dir = await mkdtemp(join(tmpdir(), 'voxcode-benchmark-'));
const measurements = [], gates = new Map(), executions = new Map();
let peakExecutions = 0, app;
const until = async predicate => {
  const deadline = performance.now() + 5000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error('Benchmark scenario did not settle');
    await new Promise(resolve => setTimeout(resolve, 1));
  }
};
const summarize = values => {
  const sorted = values.map(value => value.ms).sort((a, b) => a - b);
  const quantile = fraction => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return { samples: sorted.length, p50Ms: quantile(0.5), p95Ms: quantile(0.95), p99Ms: quantile(0.99), errors: values.filter(value => !value.ok).length };
};

try {
  app = createServer({ project: dir, dataDir: join(dir, 'state'),
    prepareWorktree(_project, id) { const path = join(dir, 'fixture-workspaces', id); mkdirSync(path, { recursive: true }); return path; },
    executor: ({ task, signal, onEvent }) => new Promise(resolve => {
      assert(!gates.has(task.id), 'One active turn per task');
      executions.set(task.id, (executions.get(task.id) ?? 0) + 1);
      gates.set(task.id, { signal, release() { gates.delete(task.id); resolve(); } });
      peakExecutions = Math.max(peakExecutions, gates.size);
      assert(gates.size <= 4, 'Default execution limit is never exceeded');
      onEvent('fixture', 'Controlled benchmark executor; no Codex model is running.');
    }),
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const token = app.service.pair(app.service.pairCode, 'benchmark');
  const request = async (name, path, body, expected = 200, measured = true) => {
    const start = performance.now();
    const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    const result = await response.json();
    if (measured) measurements.push({ name, ms: performance.now() - start, ok: response.status === expected });
    assert.equal(response.status, expected, `Unexpected ${name} response`);
    return result;
  };
  for (let i = 0; i < 5; i++) await request('warmup', '/api/tasks', undefined, 200, false);
  const tasks = [];
  for (let i = 0; i < 24; i++) {
    const body = { requestId: `bench-create-${i}`, title: `Fixture task ${i + 1}`, prompt: 'Controlled benchmark only' };
    tasks.push((await request('create', '/api/tasks', body)).task);
  }
  await until(() => gates.size === 4);
  assert.equal(app.service.list().length, 24);
  assert.equal(app.service.settings().queuedTasks, 20);
  assert.equal(app.service.get(tasks[4].id).status, 'queued');
  const replay = await request('replay', '/api/tasks', { requestId: 'bench-create-0', title: 'Fixture task 1', prompt: 'Controlled benchmark only' });
  assert.equal(replay.task.id, tasks[0].id);
  assert.equal(executions.get(tasks[0].id), 1);
  await request('expected-conflict', '/api/tasks', { requestId: 'bench-create-0', title: 'Changed body', prompt: 'Controlled benchmark only' }, 409);
  const cancelStart = performance.now();
  await request('cancel', `/api/tasks/${tasks[0].id}/cancel`, { requestId: 'bench-cancel', version: 0 });
  assert.equal(app.service.get(tasks[0].id).status, 'stopping');
  assert.equal(app.service.active.size, 4, 'Stopping retains its slot until executor settlement');
  assert.equal(app.service.get(tasks[4].id).status, 'queued');
  gates.get(tasks[0].id).release();
  await until(() => app.service.get(tasks[0].id).status === 'interrupted' && gates.has(tasks[4].id));
  const cancelSettlementMs = performance.now() - cancelStart;
  for (let i = 0; i < 60; i++) {
    await request('list', '/api/tasks');
    await request('status', `/api/tasks/${tasks[i % tasks.length].id}`);
  }
  while (app.service.list().some(task => ['queued', 'running', 'stopping'].includes(task.status))) {
    const prior = [...gates.values()];
    assert(prior.length > 0, 'Queued tasks can make progress');
    for (const gate of prior) gate.release();
    await until(() => prior.every(gate => ![...gates.values()].includes(gate)) && (gates.size > 0 || app.service.active.size === 0));
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(app.service.active.size, 0);
  assert.equal(app.service.list().filter(task => task.status === 'completed').length, 23);
  assert.equal(executions.size, 24);
  assert([...executions.values()].every(value => value === 1), 'Replay never executes another turn');
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), revision, dirty,
    evidence: 'local-fixture', dependencies: { executor: 'controlled gated executor, no Codex', workspaces: 'temporary directories, no git worktree preparation', voice: 'not exercised', network: 'loopback HTTP, no TLS/cellular' },
    environment: { node: process.version, os: platform(), release: release(), cpu: cpus()[0]?.model, cpuCount: cpus().length },
    configuration: { managedTasks: 24, executionLimit: 4, warmupRequests: 5, repetitions: 1 },
    invariants: { maxActive: peakExecutions, executedOnce: 24, completed: 23, cancelled: 1, fifthQueued: true, stoppingRetainedSlot: true, replayDeduplicated: true },
    cancelSettlementMs,
    api: Object.fromEntries([...new Set(measurements.map(value => value.name))].map(name => [name, summarize(measurements.filter(value => value.name === name))])),
    limitations: ['Single local baseline; p99 with small samples is the observed upper tail, not a production guarantee.', 'Fixture durations do not measure Codex, Linx, native UI, TLS, real worktree setup or outdoor behavior. No performance thresholds established.'],
  };
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ passed: true, evidence: report.evidence, revision, dirty, invariants: report.invariants, api: report.api }));
} finally {
  if (app) {
    const closing = app.close();
    for (const gate of [...gates.values()]) gate.release();
    await closing;
  }
  await rm(dir, { recursive: true, force: true });
}
