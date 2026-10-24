import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTitle, validatePullRequest, validateCommits } from '../check-pr-policy.mjs';

const body = `## Summary
Reject expired preview sessions before serving the artifact.
Refs #42
## Validation
Local fixture: node --test apps/preview/test/*.test.mjs; 4 passed. Device: not run.
## Risks
Native WebView cookie propagation remains unverified.
## Review
Independent review reports are pending; keep this PR in draft.
## Milestone tag
Tag: VoxCode1.2.3
`;
const pr = { title: 'fix(preview): reject expired preview sessions', body, headRef: 'codex/preview-expiry' };

test('accepts scoped conventional titles including Chinese and breaking changes', () => {
  for (const title of ['feat(ios): add task filters', 'fix(mac): 修复取消后的名额释放', 'feat(protocol)!: require versioned evidence', 'revert(relay): restore the previous allowlist']) {
    assert.deepEqual(validateTitle(title), []);
  }
});

test('rejects missing scope, unsupported types, empty summaries and multiline titles', () => {
  for (const title of ['add support', 'feat: add support', 'feature(mac): add slots', 'fix(mac): ', 'fix(mac): test\nhidden subject', 'Fix(mac): test']) {
    assert.ok(validateTitle(title).length > 0, title);
  }
});

test('limits title to 100 Unicode characters rather than bytes', () => {
  assert.deepEqual(validateTitle(`docs(repo): ${'测'.repeat(80)}`), []);
  assert.ok(validateTitle(`docs(repo): ${'a'.repeat(101)}`).length > 0);
});

test('accepts complete PR metadata without demanding invented device evidence', () => {
  assert.deepEqual(validatePullRequest(pr), []);
});

test('requires a primary Issue reference in the PR body', () => {
  assert.ok(validatePullRequest({ ...pr, body: body.replace('Refs #42\n', '') }).some(error => /Issue/u.test(error)));
  assert.deepEqual(validatePullRequest({ ...pr, body: body.replace('Refs #42', 'Fixes #42') }), []);
});

test('Issue examples, comments, placeholders and zero are not actual linkage', () => {
  const unlinked = body.replace('Refs #42\n', '');
  for (const example of ['<!-- Refs #42 -->', '`Refs #42`', '```text\nRefs #42\n```', 'Issue: Refs #<number>', 'Refs #0', 'Example: Refs #42', '> ```text\n> Refs #42\n> ```']) {
    assert.ok(validatePullRequest({ ...pr, body: `${unlinked}\n${example}` }).some(error => /Issue/u.test(error)), example);
  }
  for (const reference of ['Issue: Refs #21', 'fixes #21', '- Refs #21']) {
    assert.deepEqual(validatePullRequest({ ...pr, body: `${unlinked}\n${reference}` }), []);
  }
});

test('requires a three-level VoxCode milestone tag in every PR', () => {
  assert.ok(validatePullRequest({ ...pr, body: body.replace('## Milestone tag\nTag: VoxCode1.2.3\n', '') }).some(error => error.includes('Milestone tag')));
  assert.ok(validatePullRequest({ ...pr, body: body.replace('VoxCode1.2.3', 'VoxCode1.2') }).some(error => error.includes('must name a tag')));
  assert.ok(validatePullRequest({ ...pr, body: body.replace('VoxCode1.2.3', 'milestone/1.2.3') }).some(error => error.includes('must name a tag')));
  assert.deepEqual(validatePullRequest(pr), []);
});

test('requires an explicit codex branch and all four substantive sections', () => {
  assert.ok(validatePullRequest({ ...pr, headRef: 'main' }).length > 0);
  assert.ok(validatePullRequest({ ...pr, headRef: 'codex/mvp' }).some(error => /protected/u.test(error)));
  for (const section of ['Summary', 'Validation', 'Risks', 'Review']) {
    assert.ok(validatePullRequest({ ...pr, body: body.replace(`## ${section}`, '## Other') }).length > 0, section);
  }
});

test('comments and untouched checklist placeholders do not count as content', () => {
  const empty = '## Summary\n<!-- Describe the change -->\n## Validation\n- [ ] Run tests\n## Risks\n\n## Review\n<!-- report -->';
  assert.ok(validatePullRequest({ ...pr, body: empty }).length >= 4);
});

test('a heading inside a fenced example does not satisfy a missing section', () => {
  const incomplete = body.replace('## Risks\nNative WebView cookie propagation remains unverified.', '```md\n## Risks\nExample only\n```');
  assert.ok(validatePullRequest({ ...pr, body: incomplete }).some(error => error.includes('Risks')));
});

test('keeps comment-looking literals inside inline and fenced code', () => {
  for (const example of ['The literal `<!--` is not a Markdown comment.', "```sh\nprintf '<!--'\n```", 'Ordinary text <!-- hidden comment --> remains substantive.']) {
    assert.deepEqual(validatePullRequest({ ...pr, body: body.replace('Reject expired preview sessions before serving the artifact.', example) }), []);
  }
});

test('thematic breaks alone are not substantive PR content', () => {
  for (const marker of ['---', '***', '_ _ _']) {
    assert.ok(validatePullRequest({ ...pr, body: body.replace('Native WebView cookie propagation remains unverified.', marker) }).some(error => error.includes('Risks')));
  }
});

test('commit validation uses only subject and permits a useful body', () => {
  assert.deepEqual(validateCommits([{ sha: 'a'.repeat(40), message: 'feat(mac): persist execution settings\n\nValidation: node --test apps/mac/test/settings.test.mjs' }]), []);
  assert.ok(validateCommits([{ sha: 'b'.repeat(40), message: 'WIP fix stuff' }]).length > 0);
  assert.ok(validateCommits([]).length > 0);
});

test('rejects duplicated required headings and unfilled status words', () => {
  assert.ok(validatePullRequest({ ...pr, body: `${body}\n## Summary\nAnother summary` }).some(error => error.includes('only one')));
  assert.ok(validatePullRequest({ ...pr, body: body.replace('Native WebView cookie propagation remains unverified.', 'TBD') }).some(error => error.includes('Risks')));
});

test('handles malformed metadata without throwing from exported validators', () => {
  for (const invalid of [null, undefined, 42, { message: 42 }]) {
    assert.ok(validateCommits([invalid]).length > 0);
  }
  assert.ok(validatePullRequest(null).length > 0);
});

test('CLI validates commit files and complete paginated PR data without executing body text', () => {
  const directory = mkdtempSync(join(tmpdir(), 'voxcode-policy-'));
  const checker = fileURLToPath(new URL('../check-pr-policy.mjs', import.meta.url));
  const input = join(directory, 'input.json');
  const run = mode => spawnSync(process.execPath, [checker, mode, input], { encoding: 'utf8' });
  try {
    writeFileSync(input, 'fix(mac): preserve task ownership\n\nValidation: fixture checks passed.');
    assert.equal(run('--commit-file').status, 0);
    writeFileSync(input, 'WIP');
    assert.equal(run('--commit-file').status, 1);
    const metadata = { ...pr, body: `${body}\nLiteral text: $(exit 17) and \`exit 18\``, commitCount: 1, commits: [{ message: pr.title }] };
    writeFileSync(input, JSON.stringify(metadata));
    assert.equal(run('--pr-file').status, 0);
    writeFileSync(input, JSON.stringify({ ...metadata, commitCount: 2 }));
    const truncated = run('--pr-file');
    assert.equal(truncated.status, 1);
    assert.match(truncated.stderr, /commit count/u);
    writeFileSync(input, '{invalid JSON');
    assert.equal(run('--pr-file').status, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
