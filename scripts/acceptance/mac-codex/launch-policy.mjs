import {isAbsolute} from 'node:path';

export function createLaunchPolicy({projects, codexHome}) {
  if (!isAbsolute(codexHome ?? '') || !Array.isArray(projects) || !projects.length) throw Error('Explicit project policy required');
  const modes = new Map();
  for (const project of projects) {
    if (!isAbsolute(project.root ?? '') || !['read-only', 'workspace-write'].includes(project.sandbox) || modes.has(project.root)) throw Error('Invalid project sandbox policy');
    modes.set(project.root, project.sandbox);
  }
  const expected = ['exec', '--json', '--sandbox', 'workspace-write', '-'];
  const allowed = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM']);
  return (args, options = {}) => {
    if (!Array.isArray(args) || args.length !== expected.length || args.some((arg, index) => arg !== expected[index]) || !modes.has(options.cwd)) throw Error('Unsupported Codex launch');
    const env = Object.fromEntries(Object.entries(options.env ?? {}).filter(([key]) => allowed.has(key)));
    env.CODEX_HOME = codexHome;
    return {args: ['exec', '--json', '--sandbox', modes.get(options.cwd), '-'], options: {...options, env}};
  };
}
