import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, chmod, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {openNativeCodexSnapshot} from '../native-codex-stdio.mjs';

async function executableFixture(mode = 'normal') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'native-codex-fixture-')));
  const executable = join(root, 'codex');
  const source = `#!${process.execPath}
import {createInterface} from 'node:readline';
if (process.argv.includes('--version')) { console.log('codex-cli 0.164.0-alpha.11.1'); process.exit(0); }
const lines = createInterface({input: process.stdin});
lines.on('line', line => {
  const message = JSON.parse(line);
  if (!message.id) return;
  if (message.method === 'initialize') console.log(JSON.stringify({id: message.id, result: {userAgent: 'fixture', codexHome: process.env.CODEX_HOME}}));
  else if (${JSON.stringify(mode)} === 'timeout') return;
  else if (${JSON.stringify(mode)} === 'oversize') process.stdout.write('x'.repeat(9000));
  else if (${JSON.stringify(mode)} === 'exit') process.exit(1);
  else console.log(JSON.stringify({id: message.id, result: {data: [], nextCursor: null}}));
});
`;
  await writeFile(executable, source, {mode: 0o700});
  await chmod(executable, 0o700);
  return {root, executable, hash: createHash('sha256').update(source).digest('hex')};
}

test('stored snapshot transport pins executable identity and permits only read methods', async t => {
  const fixture = await executableFixture();
  const transport = await openNativeCodexSnapshot({
    executable: fixture.executable, codexHome: fixture.root, cwd: fixture.root,
    expectedSha256: fixture.hash,
  });
  t.after(() => transport.close());
  assert.equal(transport.identity.version, '0.164.0-alpha.11.1');
  assert.equal(transport.identity.authority, 'stored-history');
  assert.deepEqual(await transport.request('project/list', {limit: 10}), {data: [], nextCursor: null});
  await assert.rejects(transport.request('turn/start', {threadId: 'real-thread'}), {code: 'read_only'});
  await assert.rejects(transport.request('thread/resume', {threadId: 'real-thread'}), {code: 'read_only'});
  await transport.close();
  await assert.rejects(transport.request('project/list', {}), {code: 'disconnected'});
});

test('version or digest drift blocks snapshot process startup', async () => {
  const fixture = await executableFixture();
  const options = {executable: fixture.executable, codexHome: fixture.root, cwd: fixture.root, expectedSha256: fixture.hash};
  await assert.rejects(openNativeCodexSnapshot({...options, expectedVersion: '0.0.0'}), {code: 'version_mismatch'});
  await assert.rejects(openNativeCodexSnapshot({...options, expectedSha256: '0'.repeat(64)}), {code: 'version_mismatch'});
});

test('snapshot timeout never retries or switches to a different backend', async t => {
  const fixture = await executableFixture('timeout');
  const transport = await openNativeCodexSnapshot({
    executable: fixture.executable, codexHome: fixture.root, cwd: fixture.root,
    expectedSha256: fixture.hash, timeoutMs: 100,
  });
  t.after(() => transport.close());
  await assert.rejects(transport.request('thread/list', {}), {code: 'deadline_exceeded'});
});

test('snapshot transport bounds response frames and handles child exit', async t => {
  for (const mode of ['oversize', 'exit']) {
    const fixture = await executableFixture(mode);
    const transport = await openNativeCodexSnapshot({
      executable: fixture.executable, codexHome: fixture.root, cwd: fixture.root,
      expectedSha256: fixture.hash, maxFrameBytes: 8192,
    });
    t.after(() => transport.close());
    await assert.rejects(transport.request('thread/list', {}), {code: mode === 'exit' ? 'disconnected' : 'response_too_large'});
  }
});
