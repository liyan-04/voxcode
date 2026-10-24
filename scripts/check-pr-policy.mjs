import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { marked } from 'marked';
import { protectedBranches } from './branch-policy.mjs';

const subjectPattern = /^(feat|fix|docs|test|refactor|perf|chore|ci|build|revert)\([a-z][a-z0-9-]*\)!?: \S(?:[^\r\n]*\S)?$/u;
const requiredSections = ['Summary', 'Validation', 'Risks', 'Review', 'Milestone tag'];

export function validateTitle(title) {
  if (typeof title !== 'string' || !subjectPattern.test(title) || /[\r\n]/u.test(title)) {
    return ['Use type(scope): summary with a lowercase type/scope and a nonempty single-line summary.'];
  }
  return [...title].length > 100 ? ['Subject must be at most 100 Unicode characters.'] : [];
}

function sectionsIn(body) {
  const sections = new Map();
  const duplicates = new Set();
  let current;
  for (const token of marked.lexer(body)) {
    if (token.type === 'heading' && token.depth === 2) {
      current = token.text;
      if (sections.has(current)) duplicates.add(current);
      else sections.set(current, []);
    } else if (token.type === 'heading' && token.depth === 1) {
      current = undefined;
    } else if (current) {
      sections.get(current).push(token);
    }
  }
  return { sections, duplicates };
}

function textIn(tokens) {
  return tokens.flatMap(token => {
    if (['space', 'hr', 'heading', 'html'].includes(token.type)) return [];
    if (token.type === 'list') return textIn(token.items.filter(item => !item.task || item.checked).flatMap(item => item.tokens));
    if (token.type === 'table') return textIn([...token.header, ...token.rows.flat()].flatMap(cell => cell.tokens));
    if (token.tokens) return textIn(token.tokens);
    return typeof token.text === 'string' ? [token.text] : [];
  });
}

function hasContent(tokens) {
  return textIn(tokens).some(text => {
    const value = text.trim();
    return value && !/^(?:tbd|todo|n\/a|none|pending)[.!]?$/iu.test(value);
  });
}

export function validatePullRequest(pr) {
  if (!pr || typeof pr !== 'object') return ['PR metadata is required.'];
  const errors = validateTitle(pr.title);
  if (typeof pr.headRef !== 'string' || !/^codex\/\S+$/u.test(pr.headRef)) {
    errors.push('PR head branch must start with codex/.');
  } else if (protectedBranches().includes(pr.headRef)) {
    errors.push(`PR head branch ${pr.headRef} is protected; create the change on a separate codex/* branch.`);
  }
  const { sections, duplicates } = sectionsIn(typeof pr.body === 'string' ? pr.body : '');
  for (const section of requiredSections) {
    if (!sections.has(section) || !hasContent(sections.get(section))) errors.push(`PR requires substantive ## ${section} content.`);
    if (duplicates.has(section)) errors.push(`PR must contain only one ## ${section} section.`);
  }
  if (sections.has('Milestone tag') && hasContent(sections.get('Milestone tag'))) {
    const tagText = textIn(sections.get('Milestone tag')).join(' ');
    if (!/\bVoxCode\d+\.\d+\.\d+\b/u.test(tagText)) errors.push('PR Milestone tag section must name a tag matching incremented VoxCode<major>.<minor>.<patch>.');
  }
  return errors;
}

export function validateCommits(commits) {
  if (!Array.isArray(commits) || !commits.length) return ['At least one PR commit is required.'];
  return commits.flatMap((commit, index) => validateTitle(typeof commit?.message === 'string' ? commit.message.split(/\r?\n/u)[0] : undefined)
    .map(error => `Commit ${index + 1}: ${error}`));
}

async function main(args) {
  const [mode, file, ...extra] = args;
  if (!file || extra.length || !['--commit-file', '--pr-file'].includes(mode)) {
    throw new Error('Usage: node scripts/check-pr-policy.mjs --commit-file PATH | --pr-file PATH');
  }
  const content = await readFile(file, 'utf8');
  let errors;
  if (mode === '--commit-file') {
    errors = validateCommits([{ message: content }]);
  } else {
    const pr = JSON.parse(content);
    errors = [...validatePullRequest(pr), ...validateCommits(pr.commits)];
    if (!Number.isInteger(pr.commitCount) || pr.commitCount < 1 || pr.commitCount !== pr.commits?.length) {
      errors.push('Fetched commit count must match the current PR; split PRs above the API limit.');
    }
  }
  for (const error of errors) console.error(`Policy: ${error}`);
  if (errors.length) process.exitCode = 1;
  else console.log('Commit/PR policy passed. This does not certify tests, reviews or product acceptance.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => {
    console.error('Policy: unable to validate input; check the file, JSON schema and CLI arguments.');
    process.exitCode = 1;
  });
}
