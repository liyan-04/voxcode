import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readConfiguration} from './bridge.mjs';

export async function prepareFixtures(config) {
  const read = config.projects.find(p => p.id === 'voice' && p.sandbox === 'read-only');
  const write = config.projects.find(p => p.id === 'write' && p.sandbox === 'workspace-write');
  if (!read || !write || read.root === write.root) throw Error('Separate read and write fixtures required');
  for (const project of [read, write]) {
    await mkdir(project.root, {recursive: true, mode: 0o700});
    let hasHead = true;
    try {execFileSync('git', ['-C', project.root, 'rev-parse', '--verify', 'HEAD'], {stdio: 'ignore'});} catch {hasHead = false;}
    if (hasHead) throw Error('Fixture already has a Git HEAD; use a new disposable checkout');
  }
  await writeFile(join(read.root, 'read-token.txt'), `${randomUUID()}\n`, {flag: 'wx', mode: 0o600});
  await writeFile(join(read.root, 'protected.txt'), 'READ_ONLY_GUARD\n', {flag: 'wx', mode: 0o600});
  await writeFile(join(write.root, 'sum.mjs'), 'export const sum = (a, b) => a - b;\n', {flag: 'wx', mode: 0o600});
  await writeFile(join(write.root, 'sum.test.mjs'), "import {sum} from './sum.mjs';\nimport assert from 'node:assert/strict';\nfor (const [a, b] of [[2, 3], [-4, 7], [0, 8]]) assert.equal(sum(a, b), a + b);\n", {flag: 'wx', mode: 0o600});
  for (const project of [read, write]) {
    execFileSync('git', ['init', project.root], {stdio: 'ignore'});
    execFileSync('git', ['-C', project.root, 'add', '--', ...(project.id === 'voice' ? ['read-token.txt', 'protected.txt'] : ['sum.mjs', 'sum.test.mjs'])]);
    execFileSync('git', ['-C', project.root, '-c', 'user.name=Acceptance fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'test: seed disposable acceptance fixture'], {stdio: 'ignore'});
  }
  await readFile(join(read.root, 'read-token.txt'));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareFixtures(await readConfiguration(process.argv[2]));
  console.log('Disposable read and write Git fixtures prepared.');
}
