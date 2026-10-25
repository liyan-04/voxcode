import assert from 'node:assert/strict';
import {readFile, writeFile, unlink, lstat} from 'node:fs/promises';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {readConfiguration} from './bridge.mjs';
import {createLaunchPolicy} from './launch-policy.mjs';

const hash = input => createHash('sha256').update(input).digest('hex');
export async function verifyLive(config) {
  const read = config.projects.find(p => p.id === 'voice' && p.sandbox === 'read-only');
  const write = config.projects.find(p => p.id === 'write' && p.sandbox === 'workspace-write');
  assert.ok(read && write, 'Separate read and write fixtures required');
  const connection = JSON.parse(await readFile(config.connectionFile, 'utf8'));
  const token = new URL(connection.endpoint).searchParams.get('token');
  const {createTaskRpcClient} = await import(pathToFileURL(join(config.runtimeRoot, 'task-rpc.mjs')).href);
  const owner = createTaskRpcClient({socketPath: config.socketPath});
  let id = 0;
  async function rpc(method, params) {
    const response = await fetch('https://xrobo.qiniu.com/v1/mcpproxy/mcp', {method: 'POST',
      headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'X-MCP-Token': token},
      body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, ...(params ? {params} : {})}), signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200, 'Production MCP HTTP request failed');
    return response.json();
  }
  async function call(name, args = {}) {
    const result = await rpc('tools/call', {name, arguments: args});
    assert.ok(!result.error && !result.result?.isError, 'Production MCP tool failed');
    return JSON.parse(result.result.content.find(item => item.type === 'text').text);
  }
  async function finish(taskId) {
    for (let attempt = 0; attempt < 90; attempt++) {
      const task = await call('codex_task_status', {taskId});
      if (['completed', 'failed', 'cancelled', 'interrupted'].includes(task.status)) {
        assert.equal(task.status, 'completed', 'Codex task did not complete'); return task;
      }
      await delay(2000);
    }
    throw Error('Codex task exceeded verification deadline');
  }
  const listed = await rpc('tools/list');
  assert.ok(!listed.error && listed.result.tools.some(tool => tool.name === 'codex_ask_readonly'));
  assert.ok(!listed.result.tools.some(tool => tool.name === 'codex_confirm_task'));
  assert.ok((await rpc('tools/call', {name: 'codex_confirm_task', arguments: {taskId: 'not-a-task'}})).error);
  const readBefore = await readFile(join(read.root, 'read-token.txt'));
  const guardBefore = await readFile(join(read.root, 'protected.txt'));
  const sourceBefore = await readFile(join(write.root, 'sum.mjs'));
  const testBefore = await readFile(join(write.root, 'sum.test.mjs'));
  const beforeCheck = spawnSync(process.execPath, ['--test', 'sum.test.mjs'], {cwd: write.root, encoding: 'utf8', timeout: 10000});
  assert.ok(beforeCheck.status !== null && beforeCheck.status !== 0, 'Seed test must fail before the model edit');
  const sandbox = await verifySandbox(config, read, write);
  const requestId = `rw-${Date.now()}`;
  const readArgs = {prompt: 'Read read-token.txt from the current directory and reply with exactly its file contents. Do not modify files.', requestId: `${requestId}-read`};
  const reading = await call('codex_ask_readonly', readArgs);
  const readTask = await finish(reading.taskId);
  assert.equal(readTask.output.trim(), readBefore.toString().trim(), 'Model did not read the randomized fixture');
  assert.deepEqual(await readFile(join(read.root, 'read-token.txt')), readBefore);
  assert.deepEqual(await readFile(join(read.root, 'protected.txt')), guardBefore);
  assert.equal((await call('codex_ask_readonly', readArgs)).taskId, reading.taskId);
  const writeArgs = {projectId: 'write', title: 'Linx Mac write verification', requestId: `${requestId}-write`,
    prompt: 'Fix sum.mjs so that sum(a, b) returns the addition of its two arguments and the existing sum.test.mjs passes. Read both files, edit only sum.mjs, and run the existing test. Do not modify tests or other files. Do not access the network. Finish briefly.'};
  const draft = await call('codex_start_task', writeArgs);
  assert.equal((await call('codex_task_status', {taskId: draft.taskId})).status, 'draft');
  assert.deepEqual(await readFile(join(write.root, 'sum.mjs')), sourceBefore, 'Draft unexpectedly modified code');
  const confirmation = {revision: 1, requestId: `${requestId}-confirm`};
  await owner.confirmTask(draft.taskId, confirmation);
  const writeTask = await finish(draft.taskId);
  const sourceAfter = await readFile(join(write.root, 'sum.mjs'));
  assert.notDeepEqual(sourceAfter, sourceBefore);
  assert.deepEqual(await readFile(join(write.root, 'sum.test.mjs')), testBefore, 'Model changed the acceptance test');
  const git = args => execFileSync('git', ['-C', write.root, ...args], {encoding: 'utf8', timeout: 10000});
  assert.deepEqual(git(['diff', '--name-only', 'HEAD', '--']).trim().split('\n'), ['sum.mjs']);
  assert.equal(git(['ls-files', '--others', '--exclude-standard']).trim(), '');
  const patch = git(['diff', '--no-ext-diff', 'HEAD', '--', 'sum.mjs']);
  assert.ok(patch.includes('a - b') && patch.includes('+'));
  const check = spawnSync(process.execPath, ['--test', 'sum.test.mjs'], {cwd: write.root, encoding: 'utf8', timeout: 10000});
  assert.equal(check.status, 0, 'Independent test failed after model edit');
  assert.equal((await call('codex_start_task', writeArgs)).taskId, draft.taskId);
  await owner.confirmTask(draft.taskId, confirmation);
  assert.equal((await call('codex_task_status', {taskId: draft.taskId})).sessionId, writeTask.sessionId);
  const report = {verifiedAt: new Date().toISOString(), evidenceClass: 'live', platform: process.platform, node: process.version,
    cli: await call('codex_status'), toolCount: listed.result.tools.length,
    read: {status: 'passed', taskId: readTask.id, randomizedContentMatched: true, inputSha256: hash(readBefore), unchanged: true, replay: 'passed'},
    write: {status: 'passed', taskId: writeTask.id, confirmation: 'private local Unix socket', draftDidNotExecute: true,
      beforeTestExit: beforeCheck.status, afterTestExit: check.status, testUnchanged: true, changedFiles: ['sum.mjs'],
      beforeSha256: hash(sourceBefore), afterSha256: hash(sourceAfter), diff: patch, replay: 'passed'}, sandbox,
    limits: ['No microphone/device/phone/outdoor verification', 'No existing desktop-chat control', 'Same-UID acceptance harness; not credential isolation', 'Diff/checks independently collected by verifier, not runtime result snapshots'],
  };
  await writeFile(join(config.dataDir, 'read-write-verification.json'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
  return report;
}

export async function verifySandbox(config, read, write) {
  const env = createLaunchPolicy(config)(['exec', '--json', '--sandbox', 'workspace-write', '-'], {cwd: write.root, env: process.env}).options.env;
  const inside = join(write.root, 'sandbox-positive.txt');
  const outside = join(dirname(write.root), 'sandbox-outside-denied.txt');
  for (const file of [inside, outside]) {
    try {await lstat(file); throw Error('Sandbox probe target already exists');} catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
  const run = (mode, cwd, file) => spawnSync(config.command, ['sandbox', '-P', mode === 'read-only' ? ':read-only' : ':workspace', '-C', cwd, '--', process.execPath, '-e', 'require("node:fs").writeFileSync(process.argv[1], "SANDBOX_PROBE\\n");', file], {cwd, env, encoding: 'utf8', timeout: 15000});
  const positive = run('workspace-write', write.root, inside);
  assert.equal(positive.status, 0, 'Workspace sandbox must first prove it can execute and write inside the fixture');
  assert.equal((await readFile(inside, 'utf8')), 'SANDBOX_PROBE\n');
  await unlink(inside);
  const readGuard = join(read.root, 'protected.txt'), before = await readFile(readGuard);
  const readonly = run('read-only', read.root, readGuard);
  const denied = run('workspace-write', write.root, outside);
  for (const result of [readonly, denied]) {
    assert.ok(result.status !== null && result.status !== 0, 'Sandbox unexpectedly allowed a forbidden write');
    assert.match(result.stderr, /EACCES|EPERM|Permission denied|Operation not permitted/);
    assert.ok(!result.stderr.includes('sandbox_apply'), 'Sandbox failed to start; denial is not proven');
  }
  assert.deepEqual(await readFile(readGuard), before);
  await assert.rejects(lstat(outside), {code: 'ENOENT'});
  return {workspaceWriteInside: 'passed', readOnlyWriteDenied: 'passed', workspaceWriteOutsideDenied: 'passed'};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = await readConfiguration(process.argv[2]);
  console.log(JSON.stringify(await verifyLive(config), null, 2));
}
