import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCommitBranch, validatePushInput, protectedBranches} from '../branch-policy.mjs';

test('rejects commits on protected branches and allows topic branches', () => {
  for (const branch of protectedBranches()) {
    assert.match(validateCommitBranch(branch), /blocked/i);
  }
  for (const branch of ['codex/relay-package']) {
    assert.equal(validateCommitBranch(branch), null);
  }
  assert.match(validateCommitBranch('feature/local-check'), /codex\/\*/i);
});

test('rejects pushes whose remote destination is a protected branch', () => {
  const input = [
    'refs/heads/codex/relay-package abc refs/heads/main 000',
    'refs/heads/codex/relay-package abc refs/heads/master 000',
    'refs/heads/codex/relay-package abc refs/heads/codex/mvp 000',
  ].join('\n');
  const errors = validatePushInput(input);
  assert.equal(errors.length, 3);
  assert.ok(errors.every(error => /PR/i.test(error)));
});

test('allows topic branch pushes and ignores blank hook input', () => {
  assert.deepEqual(validatePushInput('refs/heads/codex/relay-package abc refs/heads/codex/relay-package 000\n'), []);
  assert.deepEqual(validatePushInput('refs/tags/v0.1.0 abc refs/tags/v0.1.0 000\n'), []);
  assert.deepEqual(validatePushInput(''), []);
});

test('rejects malformed push records instead of silently allowing them', () => {
  assert.ok(validatePushInput('refs/heads/codex/foo abc refs/heads/main').some(error => /invalid/i.test(error)));
});
