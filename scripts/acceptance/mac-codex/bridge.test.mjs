import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, chmod, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readConfiguration} from './bridge.mjs';

test('operator configuration requires private paths and separate credential/runtime storage', async t => {
  const base = await mkdtemp(join(tmpdir(), 'mac-bridge-config-'));
  t.after(() => rm(base, {recursive: true, force: true}));
  const file = join(base, 'config.json');
  const config = {runtimeRoot: join(base, 'runtime'), connectionFile: join(base, 'connection.json'), command: '/bin/codex', codexHome: join(base, 'home'), dataDir: join(base, 'data'), socketPath: join(base, 'owner.sock'), statusPort: 51241,
    projects: [{id: 'voice', name: 'Read only', root: join(base, 'readonly'), enabled: true, sandbox: 'read-only'}]};
  const save = value => writeFile(file, JSON.stringify(value), {mode: 0o600});
  await save(config);
  assert.deepEqual(await readConfiguration(file), config);
  await chmod(file, 0o644);
  await assert.rejects(readConfiguration(file), /Private owned/);
  await chmod(file, 0o600);
  await assert.rejects(readConfiguration('relative'), /Absolute/);
  await save({...config, command: 'codex'});
  await assert.rejects(readConfiguration(file), /Absolute runtime/);
  await save({...config, statusPort: 0});
  await assert.rejects(readConfiguration(file), /loopback port/);
  await save({...config, projects: [{...config.projects[0], sandbox: 'workspace-write'}]});
  await assert.rejects(readConfiguration(file), /Read-only voice/);
  await save({...config, codexHome: join(config.projects[0].root, 'private')});
  await assert.rejects(readConfiguration(file), /outside projects/);
});
