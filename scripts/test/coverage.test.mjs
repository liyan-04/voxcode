import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLcov, evaluateCoverage, changedLines } from '../coverage.mjs';

const root = '/checkout/head';
const source = 'apps/mac/service.mjs';
const report = (path, lines, branches = []) => `TN:\nSF:${path}\n${lines.map(([line, count]) => `DA:${line},${count}`).join('\n')}\n${branches.map(([line, id, count]) => `BRDA:${line},0,${id},${count}`).join('\n')}\nend_of_record\n`;
const policy = { changedLines: 80, changedBranches: 70, allowOverallDecrease: false, languages: {
  node: { include: ['apps/mac/'], extensions: ['.mjs'], exclude: ['/test/'] },
  swift: { include: ['apps/ios/Sources/VoxCodeCore/'], extensions: ['.swift'], exclude: [] },
} };
const parsed = (lines, branches = []) => parseLcov(report(`${root}/${source}`, lines, branches), root);
const run = (head, baseline, changed = new Map([[source, new Set([1, 2, 3, 4, 5])]])) => evaluateCoverage({ head, baseline, changed, language: 'node', policy });

test('LCOV normalizes checkout paths, merges records and preserves unknown branch hits as uncovered', () => {
  const result = parseLcov(report(`${root}/${source}`, [[1, 0], [2, 1]], [[1, '0', '-']]) + report(`${root}/${source}`, [[1, 2]]), root);
  assert.equal(result.get(source).lines.get(1), 2);
  assert.equal(result.get(source).lines.get(2), 1);
  assert.equal([...result.get(source).branches.values()][0].count, 0);
});

test('rejects malformed, incomplete and absent coverage rather than treating it as 100 percent', () => {
  for (const input of ['', 'SF:/checkout/head/apps/mac/service.mjs\nDA:1,1\n', report(`${root}/${source}`, [[0, 1]]), report(`${root}/${source}`, [[1, -1]])]) {
    assert.throws(() => parseLcov(input, root));
  }
});

test('passes inclusive changed-code thresholds using counts, not rounded percentages', () => {
  const head = parsed([[1, 1], [2, 1], [3, 1], [4, 1], [5, 0]], Array.from({ length: 10 }, (_, id) => [1, String(id), id < 7 ? 1 : 0]));
  const baseline = parsed([[1, 1], [2, 0]]);
  const result = run(head, baseline);
  assert.deepEqual(result.errors, []);
  assert.equal(result.changed.lines.percent, 80);
  assert.equal(result.changed.branches.percent, 70);
});

test('fails changed lines below 80 percent and branches below 70 percent', () => {
  const head = parsed([[1, 1], [2, 1], [3, 1], [4, 0], [5, 0]], [[1, '0', 1], [1, '1', 1], [1, '2', 0]]);
  const errors = run(head, parsed([[1, 0]])).errors;
  assert.ok(errors.some(error => error.includes('changed lines')));
  assert.ok(errors.some(error => error.includes('changed branches')));
});

test('rejects overall baseline regression even when changed code is covered', () => {
  const head = parsed([[1, 1], [2, 0]]);
  const baseline = parseLcov(report(`/checkout/base/${source}`, [[1, 1], [2, 1]]), '/checkout/base');
  const errors = run(head, baseline, new Map([[source, new Set([1])]])).errors;
  assert.ok(errors.some(error => error.includes('overall lines decreased')));
});

test('checks overall branch regression independently of changed lines', () => {
  const head = parsed([[1, 1]], [[1, '0', 1], [1, '1', 0]]);
  const baseline = parsed([[1, 1]], [[1, '0', 1], [1, '1', 1]]);
  assert.ok(run(head, baseline, new Map([[source, new Set([1])]])).errors.some(error => error.includes('overall branches decreased')));
});

test('does not fail overall branch drift when a PR has no eligible Node source changes', () => {
  const head = parsed([[1, 1]], [[1, '0', 1], [1, '1', 0]]);
  const baseline = parsed([[1, 1]], [[1, '0', 1], [1, '1', 1]]);
  assert.deepEqual(run(head, baseline, new Map()).errors, []);
});

test('missing changed source coverage fails, while excluded tests and comment-only changes do not invent executable lines', () => {
  const head = parsed([[1, 1]]);
  assert.ok(run(head, head, new Map([['apps/mac/new.mjs', new Set([1])]])).errors.some(error => error.includes('Missing coverage')));
  assert.deepEqual(run(head, head, new Map([['apps/mac/test/new.test.mjs', new Set([1])]])).errors, []);
  const comments = run(head, head, new Map([[source, new Set([20])]]));
  assert.deepEqual(comments.errors, []);
  assert.equal(comments.changed.lines.percent, null);
});

test('Swift lines are enforced separately and missing branch instrumentation is N/A', () => {
  const path = 'apps/ios/Sources/VoxCodeCore/Core.swift';
  const head = parseLcov(report(`${root}/${path}`, [[1, 1], [2, 0]]), root);
  const baseline = parseLcov(report(`${root}/${path}`, [[1, 0], [2, 0]]), root);
  const result = evaluateCoverage({ head, baseline, changed: new Map([[path, new Set([1, 2])]]), language: 'swift', policy });
  assert.ok(result.errors.some(error => error.includes('changed lines')));
  assert.equal(result.overall.branches.percent, null);
  assert.equal(result.changed.branches.percent, null);
});

test('a report without any eligible executable source cannot pass', () => {
  const other = parseLcov(report(`${root}/scripts/check.mjs`, [[1, 1]]), root);
  assert.ok(run(other, other, new Map()).errors.some(error => error.includes('No executable')));
});

test('git diff identifies added executable line candidates without mutating the checkout', () => {
  const directory = mkdtempSync(join(tmpdir(), 'voxcode-coverage-diff-'));
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Coverage Test', '-c', 'user.email=coverage@example.invalid', '-C', directory, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  try {
    git('init');
    mkdirSync(join(directory, 'apps/mac'), { recursive: true });
    writeFileSync(join(directory, source), 'first\nsecond\nthird\n');
    git('add', source); git('commit', '-m', 'test(coverage): create base');
    const base = git('rev-parse', 'HEAD');
    writeFileSync(join(directory, source), 'first\nchanged\nthird\nadded\n');
    git('add', source); git('commit', '-m', 'test(coverage): create head');
    const head = git('rev-parse', 'HEAD');
    const result = changedLines(directory, base, head);
    assert.deepEqual([...result.get(source)], [2, 4]);
    assert.equal(git('status', '--porcelain'), '');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
