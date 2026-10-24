import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const DEFAULT_PROTECTED = ['main', 'master', 'codex/mvp'];

export function protectedBranches(value = process.env.VOXCODE_PROTECTED_BRANCHES) {
  const raw = typeof value === 'string' && value.trim() ? value : DEFAULT_PROTECTED.join(',');
  return [...new Set(raw.split(',').map(branch => branch.trim()).filter(Boolean))];
}

export function validateCommitBranch(branch, protectedNames = protectedBranches()) {
  if (typeof branch !== 'string' || !branch) return 'Current branch is unavailable; create a codex/* topic branch before committing.';
  if (protectedNames.includes(branch)) return `Direct commits on protected branch ${branch} are blocked; commit on codex/* and open a PR.`;
  if (!/^codex\/\S+$/u.test(branch)) return `Commits must be made on a codex/* topic branch; current branch is ${branch}.`;
  return null;
}

export function validatePushInput(input, protectedNames = protectedBranches()) {
  if (typeof input !== 'string' || !input.trim()) return [];
  const errors = [];
  for (const line of input.split(/\r?\n/u).filter(Boolean)) {
    const fields = line.trim().split(/\s+/u);
    if (fields.length !== 4) {
      errors.push(`Invalid pre-push record; refusing push: ${line}`);
      continue;
    }
    if (!fields[2].startsWith('refs/heads/')) continue;
    const destination = fields[2].slice('refs/heads/'.length);
    if (protectedNames.includes(destination)) {
      errors.push(`Direct push to protected branch ${destination} is blocked; push codex/* and open a PR.`);
    }
  }
  return errors;
}

async function main(args) {
  const [mode, inputPath] = args;
  if (mode === '--commit') {
    const branch = process.env.GIT_BRANCH ?? inputPath ?? '';
    const error = validateCommitBranch(branch);
    if (error) throw new Error(error);
  } else if (mode === '--pre-push') {
    const input = inputPath ? readFileSync(resolve(inputPath), 'utf8') : await readStdin();
    const errors = validatePushInput(input);
    if (errors.length) throw new Error(errors.join('\n'));
  } else {
    throw new Error('Usage: node scripts/branch-policy.mjs --commit BRANCH | --pre-push [INPUT_FILE]');
  }
  console.log('Branch policy passed: use a codex/* topic branch and merge through a PR.');
}

function readStdin() {
  return new Promise(resolvePromise => {
    let value = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { value += chunk; });
    process.stdin.on('end', () => resolvePromise(value));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`Branch policy: ${error.message}`);
    process.exitCode = 1;
  });
}
