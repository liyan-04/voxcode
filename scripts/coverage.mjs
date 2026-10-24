import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const toolingRoot = fileURLToPath(new URL('../', import.meta.url));
const slash = path => path.split(sep).join('/');
const integer = value => {
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid LCOV count.');
  return Number(value);
};

export function parseLcov(input, root) {
  const files = new Map();
  let current;
  for (const line of input.split(/\r?\n/u)) {
    if (line.startsWith('SF:')) {
      if (current) throw new Error('Incomplete LCOV record.');
      const source = line.slice(3);
      if (!source) throw new Error('Missing LCOV source path.');
      const path = slash(relative(resolve(root), isAbsolute(source) ? source : resolve(root, source)));
      current = { path, lines: new Map(), branches: new Map() };
    } else if (line.startsWith('DA:')) {
      if (!current) throw new Error('LCOV line outside a source record.');
      const [position, hits] = line.slice(3).split(',');
      const number = integer(position);
      if (!number) throw new Error('Invalid LCOV line number.');
      current.lines.set(number, (current.lines.get(number) ?? 0) + integer(hits));
    } else if (line.startsWith('BRDA:')) {
      if (!current) throw new Error('LCOV branch outside a source record.');
      const [position, block, branch, hits] = line.slice(5).split(',');
      const number = integer(position);
      if (!number) throw new Error('Invalid LCOV branch line.');
      integer(block); integer(branch);
      const key = `${number}:${block}:${branch}`;
      current.branches.set(key, { line: number, count: (current.branches.get(key)?.count ?? 0) + (hits === '-' ? 0 : integer(hits)) });
    } else if (line === 'end_of_record') {
      if (!current) throw new Error('Unexpected LCOV record end.');
      const previous = files.get(current.path);
      if (previous) {
        for (const [number, count] of current.lines) previous.lines.set(number, (previous.lines.get(number) ?? 0) + count);
        for (const [key, value] of current.branches) previous.branches.set(key, { ...value, count: (previous.branches.get(key)?.count ?? 0) + value.count });
      } else files.set(current.path, current);
      current = undefined;
    }
  }
  if (current || !files.size) throw new Error('Missing or incomplete LCOV report.');
  return files;
}

const eligible = (path, scope) => scope.include.some(prefix => path.startsWith(prefix))
  && scope.extensions.includes(extname(path)) && !scope.exclude.some(fragment => path.includes(fragment));
const metric = counts => {
  const total = counts.length;
  const covered = counts.filter(count => count > 0).length;
  return { covered, total, percent: total ? covered / total * 100 : null };
};
function summarize(files, scope, changes) {
  const lines = [], branches = [];
  for (const [path, file] of files) {
    if (!eligible(path, scope)) continue;
    for (const [line, count] of file.lines) if (!changes || changes.get(path)?.has(line)) lines.push(count);
    for (const value of file.branches.values()) if (!changes || changes.get(path)?.has(value.line)) branches.push(value.count);
  }
  return { lines: metric(lines), branches: metric(branches) };
}

export function evaluateCoverage({ head, baseline, changed, language, policy }) {
  const scope = policy.languages[language];
  if (!scope) throw new Error('Unknown coverage language.');
  const overall = summarize(head, scope);
  const previous = baseline ? summarize(baseline, scope) : null;
  const delta = summarize(head, scope, changed);
  const hasEligibleChanges = [...changed.keys()].some(path => eligible(path, scope));
  const errors = [];
  if (!overall.lines.total) errors.push('No executable source coverage for the selected language.');
  if (baseline && !previous.lines.total) errors.push('No executable baseline coverage for the selected language.');
  for (const path of changed.keys()) {
    if (eligible(path, scope) && !head.has(path)) errors.push(`Missing coverage for changed source: ${path}`);
  }
  for (const [name, threshold] of [['lines', policy.changedLines], ['branches', policy.changedBranches]]) {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) throw new Error('Invalid coverage threshold.');
    if (delta[name].total && delta[name].covered * 100 < threshold * delta[name].total) {
      errors.push(`${language} changed ${name} below ${threshold}%.`);
    }
    if (previous && hasEligibleChanges && policy.allowOverallDecrease === false && previous[name].total
      && (!overall[name].total || overall[name].covered * previous[name].total < previous[name].covered * overall[name].total)) {
      errors.push(`${language} overall ${name} decreased from the PR baseline.`);
    }
  }
  return { language, overall, baseline: previous, changed: delta, errors };
}

export function changedLines(root, base, head) {
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const commit = ref => {
    if (typeof ref !== 'string' || !ref) throw new Error('Both coverage comparison revisions are required.');
    return git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
  };
  const before = commit(base), after = commit(head);
  const names = git(['diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', '--diff-filter=ACM', before, after, '--']).split('\0').filter(Boolean);
  return new Map(names.map(path => {
    const patch = git(['diff', '--no-ext-diff', '--no-renames', '--unified=0', before, after, '--', path]);
    const lines = new Set();
    for (const match of patch.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gmu)) {
      const first = Number(match[1]), length = match[2] === undefined ? 1 : Number(match[2]);
      for (let line = first; line < first + length; line++) lines.add(line);
    }
    return [slash(path), lines];
  }));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} failed; coverage cannot pass without successful tests.`);
}

function collectNode(root, output) {
  const c8 = join(toolingRoot, 'node_modules/c8/bin/c8.js');
  if (!existsSync(c8)) throw new Error('Install locked root dependencies with npm ci --ignore-scripts first.');
  const scope = JSON.parse(readFileSync(join(toolingRoot, 'config/coverage-policy.json'), 'utf8')).languages.node;
  const includes = scope.include.flatMap(prefix => scope.extensions.map(extension => `${prefix}**/*${extension}`));
  run(process.execPath, [c8, '--all', ...includes.map(pattern => `--include=${pattern}`), ...scope.exclude.map(fragment => `--exclude=**${fragment}**`),
    '--reporter=lcovonly', '--reporter=json-summary', '--reporter=text-summary', `--reports-dir=${output}`, `--temp-directory=${join(output, 'v8')}`, 'npm', 'test'], { cwd: root });
}

function collectSwift(root, output) {
  if (process.platform !== 'darwin') throw new Error('Swift core coverage requires the macOS Xcode toolchain.');
  const pkg = join(root, 'apps/ios');
  const scratch = join(output, 'build');
  const common = ['--package-path', pkg, '--scratch-path', scratch, '--cache-path', join(output, 'cache'), '--manifest-cache', 'none'];
  const env = { ...process.env, CLANG_MODULE_CACHE_PATH: join(output, 'module-cache') };
  run('swift', ['test', ...common, '--enable-code-coverage', '-Xswiftc', '-module-cache-path', '-Xswiftc', join(output, 'module-cache')], { cwd: root, env });
  const bin = execFileSync('swift', ['build', ...common, '--show-bin-path'], { cwd: root, env, encoding: 'utf8' }).trim();
  const binary = join(bin, 'VoxCodeCorePackageTests.xctest/Contents/MacOS/VoxCodeCorePackageTests');
  const lcov = execFileSync('xcrun', ['llvm-cov', 'export', '--format=lcov', `--instr-profile=${join(bin, 'codecov/default.profdata')}`, binary], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  writeFileSync(join(output, 'lcov.info'), lcov);
}

function options(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!args[index]?.startsWith('--') || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Expected --option VALUE pairs.');
    result[args[index].slice(2)] = args[index + 1];
  }
  return result;
}

function main(args) {
  const [mode, ...rest] = args;
  const opts = options(rest);
  const root = resolve(opts.root ?? toolingRoot);
  const output = resolve(opts.output ?? join(toolingRoot, 'coverage', mode));
  mkdirSync(output, { recursive: true });
  if (mode === 'collect-node') return collectNode(root, output);
  if (mode === 'collect-swift') return collectSwift(root, output);
  if (mode !== 'check' || !opts.language || !opts.report) throw new Error('Use collect-node, collect-swift or check --language KIND --report LCOV.');
  const policy = JSON.parse(readFileSync(join(toolingRoot, 'config/coverage-policy.json'), 'utf8'));
  const result = evaluateCoverage({
    head: parseLcov(readFileSync(resolve(opts.report), 'utf8'), root),
    baseline: opts.baseline ? parseLcov(readFileSync(resolve(opts.baseline), 'utf8'), resolve(opts['base-root'] ?? root)) : null,
    changed: opts.base && opts.head ? changedLines(root, opts.base, opts.head) : new Map(),
    language: opts.language, policy,
  });
  if (!opts.baseline || !opts.base || !opts.head) result.errors.push('PR enforcement requires baseline coverage and both comparison revisions.');
  writeFileSync(join(output, 'gate.json'), `${JSON.stringify(result, null, 2)}\n`);
  const format = value => value.percent === null ? 'N/A (no executable items)' : `${value.percent.toFixed(2)}% (${value.covered}/${value.total})`;
  const summary = [`### ${opts.language} coverage`, '', '| Metric | PR base | Current | Changed |', '| --- | --- | --- | --- |',
    ...['lines', 'branches'].map(name => `| ${name} | ${result.baseline ? format(result.baseline[name]) : 'missing'} | ${format(result.overall[name])} | ${format(result.changed[name])} |`),
    '', ...result.errors.map(error => `- FAIL: ${error}`), '', result.errors.length ? 'Coverage gate failed.' : 'Coverage gate passed. Device/live/benchmark acceptance is separate.', ''].join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (result.errors.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`Coverage: ${error.message}`); process.exitCode = 1; }
}
