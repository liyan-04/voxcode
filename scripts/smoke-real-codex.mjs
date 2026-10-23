import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runCodex } from '../apps/mac/codex.mjs';

// Uses the locally configured Codex account. Never prints credentials or model output.
const cwd = await mkdtemp(join(tmpdir(), 'voxcode-real-smoke-'));
try {
  execFileSync('git', ['init', '-q', cwd]);
  execFileSync('git', ['-C', cwd, '-c', 'user.name=VoxCode Smoke', '-c', 'user.email=smoke@localhost', 'commit', '--allow-empty', '-qm', 'chore: initialize isolated smoke fixture']);
  let events = 0, threadId;
  const callbacks = {
    cwd,
    command: process.env.VOXCODE_CODEX_COMMAND ? resolve(process.env.VOXCODE_CODEX_COMMAND) : 'codex',
    task: { prompt: 'Create a file answer.txt in the current workspace containing exactly VOXCODE_OK followed by a newline. Do not access other projects or any network. Report completion briefly.' },
    onEvent() { events++; },
    onEvidence() {},
    onApproval(_details, reply) { reply('decline'); },
    async onSession(session) {
      if (threadId && threadId !== session.threadId) throw new Error('Follow-up changed its owned Codex thread');
      threadId = session.threadId;
    },
  };
  await runCodex({ ...callbacks, signal: AbortSignal.timeout(90000) });
  const content = await readFile(join(cwd, 'answer.txt'), 'utf8');
  if (content !== 'VOXCODE_OK\n') throw new Error('Model turn ended without the expected filesystem result');
  if (!threadId) throw new Error('Model turn did not persist its owned thread');
  await runCodex({ ...callbacks, signal: AbortSignal.timeout(90000), task: { codexThreadId: threadId,
    prompt: 'Continue this task in the same workspace. Append exactly VOXCODE_FOLLOWUP followed by a newline to answer.txt, preserving its existing contents. Do not access other projects or any network.' } });
  if (await readFile(join(cwd, 'answer.txt'), 'utf8') !== 'VOXCODE_OK\nVOXCODE_FOLLOWUP\n') throw new Error('Follow-up did not preserve the expected filesystem result');
  console.log(JSON.stringify({ passed: true, evidence: 'live-local', realModelTurns: 2, fileVerified: true, sameOwnedThread: true, events }));
} catch (error) {
  console.error(JSON.stringify({ passed: false, reason: error.message }));
  process.exitCode = 1;
} finally {
  await rm(cwd, { recursive: true, force: true });
}
