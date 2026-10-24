import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { chmod, mkdir, readFile, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRelay } from '../../relay/relay.mjs';
import { createServer } from 'node:net';
import { fixture } from './fixtures/environment.mjs';

const run = promisify(execFile);
const cli = new URL('../cli.mjs', import.meta.url).pathname;

test('CLI preflight returns a redacted JSON report without starting services', async t => {
  const { env } = await fixture(t);
  const result = await run(process.execPath, [cli, 'preflight'], { env });
  assert.equal(JSON.parse(result.stdout).ok, true);
  assert.equal(result.stderr, '');
  await assert.rejects(run(process.execPath, [cli, 'preflight'], { env: { ...env, LINX_TOKEN: 'SECRET' } }), error => error.code === 1 && !/SECRET/.test(error.stdout + error.stderr));
});

test('CLI rejects unknown arguments, root execution and failed startup without raw errors', async t => {
  const { env, dir } = await fixture(t);
  await assert.rejects(run(process.execPath, [cli, 'SECRET']), error => error.code === 2 && !/SECRET/.test(error.stdout + error.stderr));
  await assert.rejects(run(process.execPath, [cli, 'start', '--show-pairing-code'], { env }), error => error.code === 1 && /private terminal/.test(error.stderr));
  const source = `process.getuid=()=>0; process.argv=[process.execPath,${JSON.stringify(cli)},'start']; await import(${JSON.stringify(new URL('../cli.mjs', import.meta.url).href)});`;
  await assert.rejects(run(process.execPath, ['--input-type=module', '-e', source], { env }), error => error.code === 1 && /preflight blocked/i.test(error.stderr));
  await writeFile(join(dir, 'private', 'state'), 'SECRET');
  await assert.rejects(run(process.execPath, [cli, 'start'], { env }), error => error.code === 1 && !/SECRET|Error:|at file:/.test(error.stderr));
});

test('occupied bridge port fails generically and leaves the existing listener unchanged', async t => {
  const { env } = await fixture(t), listener = createServer(socket => socket.end('existing fixture service'));
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => listener.close(resolve)));
  env.VOXCODE_PORT = String(listener.address().port);
  await assert.rejects(run(process.execPath, [cli, 'start'], { env }), error => error.code === 1 && /startup failed/i.test(error.stderr) && !/Error:|EADDRINUSE|synthetic_machine_key/.test(error.stderr));
  assert.equal(listener.listening, true);
});

test('explicit private TTY mode emits a short lived pairing code and shuts down cleanly', async t => {
  const { env } = await fixture(t), port = createServer();
  await new Promise(resolve => port.listen(0, '127.0.0.1', resolve));
  env.VOXCODE_PORT = String(port.address().port); await new Promise(resolve => port.close(resolve));
  // Only the terminal capability is controlled; runtime, state, listener and shutdown are real.
  const source = `Object.defineProperty(process.stderr,'isTTY',{value:true}); process.argv=[process.execPath,${JSON.stringify(cli)},'start','--show-pairing-code']; await import(${JSON.stringify(new URL('../cli.mjs', import.meta.url).href)}); process.kill(process.pid,'SIGTERM');`;
  const result = await run(process.execPath, ['--input-type=module', '-e', source], { env });
  assert.match(result.stderr, /Pairing code \(5 minutes\): [a-f0-9]{12}/);
  assert.doesNotMatch(result.stdout, /Pairing code/);
  await assert.rejects(fetch(`http://127.0.0.1:${env.VOXCODE_PORT}/api/health`));
});

test('CLI pins checked canonical project and data when mutable lexical aliases are retargeted', async t => {
  const { env, dir, project, privateDir } = await fixture(t), port = createServer();
  await new Promise(resolve => port.listen(0, '127.0.0.1', resolve));
  env.VOXCODE_PORT = String(port.address().port); await new Promise(resolve => port.close(resolve));
  const shared = join(dir, 'shared'), alternateData = join(dir, 'alternate-data'), alternateProject = join(dir, 'alternate-project');
  for (const path of [shared, alternateData, alternateProject]) await mkdir(path, { mode: 0o700 });
  await chmod(shared, 0o777);
  await run('git', ['init', '-q', alternateProject]);
  await run('git', ['-C', alternateProject, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'alternate']);
  const projectAlias = join(shared, 'project'), dataAlias = join(shared, 'selected');
  await symlink(project, projectAlias); await symlink(privateDir, dataAlias);
  env.VOXCODE_PROJECT = projectAlias; env.VOXCODE_DATA = join(dataAlias, 'state');
  // Retarget at the real preflight→runtime import boundary, before any service/state creation.
  const source = `
    import {registerHooks} from 'node:module';
    import {unlinkSync,symlinkSync} from 'node:fs';
    let changed=false;
    registerHooks({resolve(specifier,context,next){
      if(specifier==='../integration/runtime.mjs'){
        changed=true;
        unlinkSync(${JSON.stringify(projectAlias)}); symlinkSync(${JSON.stringify(alternateProject)},${JSON.stringify(projectAlias)});
        unlinkSync(${JSON.stringify(dataAlias)}); symlinkSync(${JSON.stringify(alternateData)},${JSON.stringify(dataAlias)});
      }
      return next(specifier,context);
    }});
    process.argv=[process.execPath,${JSON.stringify(cli)},'start'];
    await import(${JSON.stringify(new URL('../cli.mjs', import.meta.url).href)});
    if(!changed)throw Error('Fixture missed runtime boundary');
    process.kill(process.pid,'SIGTERM');
  `;
  const result = await run(process.execPath, ['--input-type=module', '-e', source], { env });
  assert.match(result.stdout, /Server bridge listening/);
  assert.equal(await stat(join(alternateData, 'state')).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error)), null);
  const state = JSON.parse(await readFile(join(privateDir, 'state', 'state.json'), 'utf8'));
  assert.equal(state.project, await realpath(project));
  assert.doesNotMatch(result.stdout + result.stderr, /shared|selected|alternate-project|alternate-data/);
});

test('server CLI starts existing runtime over strict local TLS and terminates its own bridge', async t => {
  const { env, dir } = await fixture(t);
  const relay = createRelay({ machineId: env.VOXCODE_MACHINE_ID, machineKey: env.VOXCODE_MACHINE_KEY,
    tls: { cert: await readFile(join(dir, 'ca.pem')), key: await readFile(join(dir, 'fixture.key')) } });
  await new Promise(resolve => relay.server.listen(0, '127.0.0.1', resolve));
  env.VOXCODE_RELAY_URL = `wss://127.0.0.1:${relay.server.address().port}/connector`;
  const socket = await import('node:net').then(({ createServer }) => createServer());
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  env.VOXCODE_PORT = String(socket.address().port); await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, [cli, 'start'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await relay.close(); });
  const exit = once(child, 'exit');
  await Promise.race([new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No bridge startup')), 5000);
    child.stdout.on('data', () => { if (out.includes('Server connector: connected')) { clearTimeout(timeout); resolve(); } });
  }), exit.then(() => { throw new Error('Server exited before startup'); })]);
  assert.equal((await fetch(`http://127.0.0.1:${env.VOXCODE_PORT}/api/tasks`)).status, 401);
  child.kill('SIGTERM');
  assert.equal((await exit)[0], 0);
  await assert.rejects(fetch(`http://127.0.0.1:${env.VOXCODE_PORT}/api/health`));
  assert.doesNotMatch(out + err, /Pairing code|synthetic_machine_key|BEGIN|Error:|Fixture/);
});
