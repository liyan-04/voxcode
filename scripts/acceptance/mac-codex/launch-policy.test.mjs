import test from 'node:test';
import assert from 'node:assert/strict';
import {createLaunchPolicy} from './launch-policy.mjs';

const args = ['exec', '--json', '--sandbox', 'workspace-write', '-'];
const projects = [{root: '/readonly', sandbox: 'read-only'}, {root: '/writable', sandbox: 'workspace-write'}];
test('pins each registered project sandbox and strips unrelated credentials', () => {
  const launch = createLaunchPolicy({projects, codexHome: '/private/codex'});
  for (const project of projects) {
    const result = launch(args, {cwd: project.root, env: {HOME: '/home', PATH: '/bin', LANG: 'en_US.UTF-8', QINIU_LLM_API_KEY: 'secret', MCP_TOKEN: 'secret', SSH_AUTH_SOCK: '/socket'}});
    assert.equal(result.args[3], project.sandbox);
    assert.equal(result.options.env.CODEX_HOME, '/private/codex');
    assert.equal(result.options.env.HOME, '/home');
    assert.equal(result.options.env.PATH, '/bin');
    assert.equal(result.options.env.QINIU_LLM_API_KEY, undefined);
    assert.equal(result.options.env.MCP_TOKEN, undefined);
    assert.equal(result.options.env.SSH_AUTH_SOCK, undefined);
  }
});
test('unknown roots, bypass flags and unsupported configuration fail closed', () => {
  const launch = createLaunchPolicy({projects, codexHome: '/private/codex'});
  assert.throws(() => launch(args, {cwd: '/elsewhere'}));
  assert.throws(() => launch([...args, '--add-dir', '/'], {cwd: '/writable'}));
  assert.throws(() => launch(['exec', '--dangerously-bypass-approvals-and-sandbox', '-'], {cwd: '/writable'}));
  assert.throws(() => createLaunchPolicy({projects: [{root: '/project', sandbox: 'danger-full-access'}], codexHome: '/private'}));
  assert.throws(() => createLaunchPolicy({projects: [projects[0], projects[0]], codexHome: '/private'}));
  assert.throws(() => createLaunchPolicy({projects, codexHome: 'relative'}));
});
