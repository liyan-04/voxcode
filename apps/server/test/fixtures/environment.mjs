import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'vox-server-preflight-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const project = join(dir, 'project'), privateDir = join(dir, 'private'), bin = join(dir, 'bin');
  for (const path of [project, privateDir, bin]) await mkdir(path, { mode: 0o700 });
  execFileSync('git', ['init', '-q', project]);
  execFileSync('git', ['-C', project, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture']);
  await writeFile(join(bin, 'codex'), '#!/bin/sh\n[ "$1" = "--version" ] || exit 8\nprintf "codex-cli 0.162.1\\n"\n', { mode: 0o755 });
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'fixture.key'), '-out', join(dir, 'ca.pem'), '-days', '1', '-subj', '/CN=Fixture', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, VOXCODE_PROJECT: project, VOXCODE_DATA: join(privateDir, 'state'), VOXCODE_RELAY_URL: 'wss://127.0.0.1:9899/connector', VOXCODE_MACHINE_ID: 'fixture', VOXCODE_MACHINE_KEY: 'synthetic_machine_key_at_least_32_characters', VOXCODE_TLS_CA: join(dir, 'ca.pem') };
  for (const key of Object.keys(env)) if (key.startsWith('LINX_')) delete env[key];
  return { dir, project, privateDir, bin, env };
}

