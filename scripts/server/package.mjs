import { lstat, realpath, readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { bundlePaths, runtimePaths, encodeBundle, decodeBundle, sha256, revision as checkRevision } from './bundle.mjs';
const run=promisify(execFile);

async function committedFiles(root, revision) {
  const resolved=(await run('git',['-C',root,'rev-parse','--verify',`${revision}^{commit}`],{timeout:10000,maxBuffer:4096})).stdout.trim();
  const head=(await run('git',['-C',root,'rev-parse','HEAD'],{timeout:10000,maxBuffer:4096})).stdout.trim();
  if(resolved!==head)throw Error('Requested revision must be the current Git HEAD');
  const files=new Map();
  for(const name of bundlePaths){
    const path=`apps/server/${name}`;
    const {stdout}=await run('git',['-C',root,'ls-tree','-z',resolved,'--',path],{timeout:10000,maxBuffer:16384});
    const entry=stdout.replace(/\0$/u,'').split('\0')[0],match=entry.match(/^(\d{6})\s+(blob|commit)\s+([a-f0-9]{40})\t(.+)$/u);
    if(!match||match[4]!==path||match[2]!=='blob'||match[1]!=='100644')throw Error(`Required committed regular file missing: ${name}`);
    const bytes=Buffer.from((await run('git',['-C',root,'show',`${resolved}:${path}`],{timeout:10000,maxBuffer:8*1024*1024+1})).stdout);
    if(bytes.length>8*1024*1024)throw Error('Required committed source too large');files.set(name,bytes);
  }
  return files;
}

export async function packageServer({ root, output, revision, verifyGit=false }) {
  checkRevision(revision);
  root = await realpath(root); output = resolve(output);
  const serverRoot = await realpath(join(root, 'apps/server'));
  const files = verifyGit ? await committedFiles(root,revision) : new Map();
  for (const name of verifyGit ? [] : bundlePaths) {
    const source = join(serverRoot, name), stat = await lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw Error('Required regular server source missing');
    const actual = await realpath(source), path = relative(serverRoot, actual);
    if (path.startsWith(`..${sep}`) || path === '..') throw Error('Server source escapes module');
    files.set(name, await readFile(source));
  }
  for (const name of runtimePaths.filter(path => path.endsWith('.mjs'))) {
    const source = files.get(name).toString();
    for (const match of source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)(['"])([^'"]+)\1/gu)) {
      const specifier = match[2];
      if (specifier.startsWith('.') && !runtimePaths.includes(relative(serverRoot, resolve(serverRoot, dirname(name), specifier)).split(sep).join('/'))) throw Error('Runtime import is outside the reviewed module allowlist');
    }
  }
  const manifest = { format: 1, name: '@voxcode/server', revision, node: '22', dependencyMode: 'npm-ci-ignore-scripts', files: Object.fromEntries([...files].map(([name, bytes]) => [name, sha256(bytes)])) };
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  const bytes = encodeBundle(files); decodeBundle(bytes);
  await mkdir(dirname(output), { recursive: true });
  const parent = await realpath(dirname(output));
  const inside = relative(root, parent);
  if (!inside || (!inside.startsWith(`..${sep}`) && inside !== '..')) throw Error('Bundle output must be outside the checkout');
  for (const path of [output, `${output}.sha256`]) {
    try { await lstat(path); throw Error('Refusing existing bundle output'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await writeFile(output, bytes, { flag: 'wx', mode: 0o600 });
  const digest = sha256(bytes);
  await writeFile(`${output}.sha256`, `${digest}\n`, { flag: 'wx', mode: 0o600 });
  return { archive: output, sha256: digest, revision, dependencyMode: manifest.dependencyMode };
}
