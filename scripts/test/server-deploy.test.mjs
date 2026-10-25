import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, readlink, lstat, rm, cp,chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:https';
import { packageServer } from '../server/package.mjs';
import { bundlePaths, runtimePaths, templatePaths, encodeBundle, decodeBundle, sha256, safeRoot } from '../server/bundle.mjs';
import { activate, readCurrent, stageRelease, systemdDriver, parseConfig, validateExecutionConfig,validateHostIdentity,operateLifecycle } from '../server/remote.mjs';

const run = promisify(execFile), root = new URL('../../', import.meta.url).pathname, revA = 'a'.repeat(40), revB = 'b'.repeat(40);
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'vox-deploy-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo'), server = join(repo, 'apps/server'); await mkdir(server, { recursive: true });
  for (const name of runtimePaths) {
    await mkdir(dirname(join(server, name)), { recursive: true });
    let content = name.endsWith('.mjs') ? 'export const fixture = true;\n' : '<!doctype html><title>fixture</title>';
    if (name === 'package.json') content = JSON.stringify({ name: '@voxcode/server', version: '0.1.0', type: 'module', engines: { node: '>=22' }, dependencies: {} });
    if (name === 'package-lock.json') content = JSON.stringify({ name: '@voxcode/server', version: '0.1.0', lockfileVersion: 3, packages: { '': { name: '@voxcode/server', version: '0.1.0', dependencies: {} } } });
    await writeFile(join(server, name), content);
  }
  for (const name of templatePaths) { await mkdir(dirname(join(server, name)), { recursive: true }); await cp(join(root, 'apps/server', name), join(server, name)); }
  for (const name of ['.env', 'private.key', 'node_modules/secret', 'data/tasks.json', 'test/secret']) { await mkdir(dirname(join(server, name)), { recursive: true }); await writeFile(join(server, name), 'SYNTHETIC_SECRET'); }
  const deploy = join(dir, 'deploy'); await mkdir(join(deploy, 'releases'), { recursive: true }); await mkdir(join(deploy, 'shared/config'), { recursive: true });
  await writeFile(join(deploy, 'shared/config/keep'), 'PRIVATE_CONFIG');
  return { dir, repo, server, deploy, output: join(dir, 'server.tar.gz') };
}

test('module bundle has exact reviewed files and hashes; no secrets or legacy runtime', async t => {
  const f = await fixture(t), built = await packageServer({ root: f.repo, output: f.output, revision: revA });
  assert.equal((await readFile(`${f.output}.sha256`, 'utf8')).trim(), built.sha256);
  const bytes = await readFile(f.output), { manifest, files } = decodeBundle(bytes);
  assert.equal(sha256(bytes), built.sha256); assert.equal(manifest.revision, revA);
  assert.deepEqual([...files.keys()].sort(), [...bundlePaths, 'manifest.json'].sort());
  assert.doesNotMatch([...files.values()].map(String).join('\n'), /SYNTHETIC_SECRET/);
  assert.doesNotMatch([...files.keys()].join('\n'), /apps\/mac|apps\/relay|node_modules|^\.env$|private\.key/mu);
  assert.equal((await lstat(f.output)).mode & 0o777, 0o600);
  await assert.rejects(packageServer({ root: f.repo, output: f.output, revision: revA }), /existing/);
  await assert.rejects(packageServer({ root: f.repo, output: join(f.repo, 'inside.tar.gz'), revision: revA }), /outside/);
});

test('production package mode rejects stale revision and dirty allowlist files', async t => {
  const f=await fixture(t);
  await run('git',['-C',f.repo,'init','-q']);await run('git',['-C',f.repo,'config','user.email','fixture@example.test']);await run('git',['-C',f.repo,'config','user.name','Fixture']);
  await run('git',['-C',f.repo,'add','apps/server']);await run('git',['-C',f.repo,'commit','-qm','fixture']);
  const head=(await run('git',['-C',f.repo,'rev-parse','HEAD'])).stdout.trim(),out=join(f.dir,'production.tar.gz');
  await assert.rejects(packageServer({root:f.repo,output:out,revision:revA,verifyGit:true}),/current Git HEAD|Needed a single revision/);
  await packageServer({root:f.repo,output:out,revision:head,verifyGit:true});
  await assert.rejects(packageServer({root:f.repo,output:out,revision:head,verifyGit:true}),/existing/);
  await writeFile(join(f.server,'server-cli.mjs'),'dirty');
  const dirty=await packageServer({root:f.repo,output:join(f.dir,'dirty2.tar.gz'),revision:head,verifyGit:true});
  assert.equal(dirty.revision,head);
});

test('bundle rejects symlink/escaping sources, undeclared runtime imports and mismatched locks', async t => {
  const f = await fixture(t);
  await rm(join(f.server, 'server-cli.mjs')); await symlink('/etc/passwd', join(f.server, 'server-cli.mjs'));
  await assert.rejects(packageServer({ root: f.repo, output: f.output, revision: revA }), /regular/);
  await rm(join(f.server, 'server-cli.mjs')); await writeFile(join(f.server, 'server-cli.mjs'), "import '../integration/runtime.mjs';\nimport {x} from '../integration/runtime.mjs';");
  await assert.rejects(packageServer({ root: f.repo, output: f.output, revision: revA }), /allowlist/);
  await writeFile(join(f.server, 'server-cli.mjs'), 'export {};');
  await writeFile(join(f.server, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { name: '@voxcode/server', dependencies: { ws: 'wrong' } } } }));
  await assert.rejects(packageServer({ root: f.repo, output: f.output, revision: revA }), /lock/);
});

test('decoder rejects unexpected files, links, duplicate entries, tampering and truncation', async t => {
  const f = await fixture(t); await packageServer({ root: f.repo, output: f.output, revision: revA });
  const { files } = decodeBundle(await readFile(f.output));
  assert.throws(() => decodeBundle(encodeBundle([...files, ['../escape', Buffer.from('x')]])), /Unsafe/);
  assert.throws(() => decodeBundle(encodeBundle([...files, ['other.mjs', Buffer.from('x')]])), /Unexpected/);
  assert.throws(() => decodeBundle(encodeBundle([...files, ['server-cli.mjs', Buffer.from('x')]])), /Unexpected/);
  files.set('server-cli.mjs', Buffer.from('tampered'));
  assert.throws(() => decodeBundle(encodeBundle(files)), /checksum/);
  assert.throws(() => decodeBundle(Buffer.from('not gzip')));
});

test('stage executes real npm ci --ignore-scripts in a temporary release; SHA mismatch changes nothing', async t => {
  const f = await fixture(t), built = await packageServer({ root: f.repo, output: f.output, revision: revA });
  await assert.rejects(stageRelease({ root: f.deploy, archive: f.output, digest: '0'.repeat(64), expectedRevision: revA }), /SHA256/);
  const result = await stageRelease({ root: f.deploy, archive: f.output, digest: built.sha256, expectedRevision: revA });
  assert.equal(result, revA); assert.equal(await readFile(join(f.deploy, 'releases', revA, 'release.env'), 'utf8'), `VOXCODE_REVISION=${revA}\n`);
  assert.equal((await lstat(join(f.deploy, 'releases', revA))).mode & 0o777, 0o755);
  assert.equal(await readFile(join(f.deploy, 'shared/config/keep'), 'utf8'), 'PRIVATE_CONFIG');
  await assert.rejects(stageRelease({ root: f.deploy, archive: f.output, digest: built.sha256, expectedRevision: revA }), /already exists/);
});

test('atomic activation and manual rollback keep shared state; failed health restores symlink and restarts old release', async t => {
  const f = await fixture(t); await mkdir(join(f.deploy, 'releases', revA)); await mkdir(join(f.deploy, 'releases', revB));
  const events = [], driver = { async assertOwned() { events.push('owned'); }, async restart() { events.push(`restart:${await readCurrent(f.deploy)}`); }, async stop() { events.push('stop'); }, async healthy(id) { return id === revA; } };
  await activate({ root: f.deploy, target: revA, driver, attempts: 1 });
  assert.equal(await readlink(join(f.deploy, 'current')), `releases/${revA}`);
  await assert.rejects(activate({ root: f.deploy, target: revB, driver, attempts: 1 }), /previous release restored/);
  assert.equal(await readCurrent(f.deploy), revA);
  assert.deepEqual(events.slice(-3), ['owned', `restart:${revB}`, `restart:${revA}`]);
  driver.healthy = async () => true;
  await activate({ root: f.deploy, target: revB, driver, attempts: 1 });
  assert.equal((await readFile(join(f.deploy, 'previous'), 'utf8')).trim(), revA);
  await activate({ root: f.deploy, target: revA, driver, attempts: 1 });
  assert.equal(await readCurrent(f.deploy), revA);
  assert.equal(await readFile(join(f.deploy, 'shared/config/keep'), 'utf8'), 'PRIVATE_CONFIG');
});

test('first deployment failure stops only the owned service and removes current', async t => {
  const f = await fixture(t); await mkdir(join(f.deploy, 'releases', revA)); let stopped = 0;
  const driver = { async assertOwned() {}, async restart() {}, async healthy() { return false; }, async stop() { stopped++; } };
  await assert.rejects(activate({ root: f.deploy, target: revA, driver, attempts: 1 }), /restored/);
  assert.equal(await readCurrent(f.deploy), null); assert.equal(stopped, 1);
  driver.assertOwned = async () => { throw Error('unrelated listener'); };
  await assert.rejects(activate({ root: f.deploy, target: revA, driver, attempts: 1 }), /unrelated/);
  assert.equal(await readCurrent(f.deploy), null);
});

function fakeSystemd({listener='LISTEN 0 128 *:9899 *:* users:(("node",pid=42,fd=1))',uid='1001',group='/system.slice/voxcode.service',unit='EXPECTED',mainPid='42',taskUid='1002',taskGroup='/system.slice/voxcode-task.service',taskUnit='TASK'}={}){
  const calls=[];
  const exec=async(name,args)=>{
    calls.push([name,...args]);
    if(name==='systemctl'&&args[0]==='show'){
      const task=args[1]==='voxcode-task.service',service=task?'voxcode-task.service':'voxcode.service';
      return {stdout:`User=${task?'voxcode-task':'voxcode'}\nMainPID=${task?'43':mainPid}\nControlGroup=/system.slice/${service}\nFragmentPath=/etc/systemd/system/${service}\n`};
    }
    if(name==='ss')return {stdout:listener};if(name==='id')return {stdout:args[1]==='voxcode-task'?'1002\n':'1001\n'};
    return {stdout:''};
  };
  const fs={async readFile(path){
    if(path==='/etc/systemd/system/voxcode.service')return unit;if(path==='/etc/systemd/system/voxcode-task.service')return taskUnit;
    const task=path.startsWith('/proc/43/');
    if(path.endsWith('/status')){const value=task?taskUid:uid;return `Uid:\t${value}\t${value}\t${value}\t${value}\n`;}
    if(path.endsWith('/cgroup'))return `0::${task?taskGroup:group}\n`;throw Error('Unexpected read');
  }};
  return {calls,driver:systemdDriver({root:'/opt/voxcode',config:{port:9899},expectedUnit:'EXPECTED',expectedTaskUnit:'TASK',exec,fs})};
}
test('dual-service replacement verifies both identities and restarts task before Web',async()=>{
  const owned=fakeSystemd();await owned.driver.restart();
  assert.deepEqual(owned.calls.filter(x=>x[0]==='systemctl'&&['restart','stop'].includes(x[1])),[['systemctl','stop','voxcode.service'],['systemctl','restart','voxcode-task.service'],['systemctl','restart','voxcode.service']]);
  for(const options of [{uid:'0'},{group:'/user.slice/foreign'},{unit:'OTHER'},{listener:'LISTEN unknown'},{mainPid:'0'},{taskUid:'0'},{taskGroup:'/foreign'},{taskUnit:'OTHER'}]){
    const f=fakeSystemd(options);await assert.rejects(f.driver.restart());assert.equal(f.calls.some(x=>x[0]==='kill'||['restart','stop'].includes(x[1])),false);
  }
  await fakeSystemd({mainPid:'0',listener:''}).driver.assertOwned();
  const start=fakeSystemd();await start.driver.start();assert.deepEqual(start.calls.filter(x=>x[0]==='systemctl'&&x[1]==='start'),[['systemctl','start','voxcode-task.service'],['systemctl','start','voxcode.service']]);
  const stop=fakeSystemd();await stop.driver.stop();assert.deepEqual(stop.calls.filter(x=>x[0]==='systemctl'&&x[1]==='stop'),[['systemctl','stop','voxcode.service'],['systemctl','stop','voxcode-task.service']]);
});

test('health probes use real HTTPS with strict public IP identity and exact release revision', async t => {
  const f = await fixture(t), keyPath = join(f.dir, 'fixture.key'), caPath = join(f.dir, 'fixture.pem');
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', caPath, '-days', '1', '-subj', '/CN=VoxCode Fixture', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'subjectAltName=IP:203.0.113.10']);
  let body = { name: 'VoxCode', revision: revA, codexAvailable:true }, seenHost;
  const server = createServer({ key: await readFile(keyPath), cert: await readFile(caPath) }, (req, res) => { seenHost = req.headers.host; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const config = { port, host: '203.0.113.10', healthOrigin: `https://203.0.113.10:${port}`, healthCaFile: caPath };
  const driver = systemdDriver({ root: f.deploy, config });
  assert.equal(await driver.healthy(revA), true); assert.equal(seenHost, `203.0.113.10:${port}`);
  assert.equal(await driver.healthy(revB), false);
  body = { name: 'Other', revision: revA }; assert.equal(await driver.healthy(revA), false);
  body={name:'VoxCode',revision:revA,codexAvailable:false};assert.equal(await driver.healthy(revA),false);
  const wrong = systemdDriver({ root: f.deploy, config: { ...config, host: '203.0.113.11' } });
  assert.equal(await wrong.healthy(revA), false);
});

test('deployment root and service configuration reject unsafe values', () => {
  for (const value of ['/opt/x y', '/opt/a/../b', '/tmp', 'relative', '/opt/a;id']) assert.throws(() => safeRoot(value));
  assert.throws(() => parseConfig({ format: 1, service: 'other', user: 'root', port: 9899 }, '/opt/voxcode'));
});

test('reviewed dual templates enforce separated users, groups, mounts and fixed entry points',async()=>{
  const web=await readFile(join(root,'apps/server/deploy/voxcode.service'),'utf8'),task=await readFile(join(root,'apps/server/deploy/voxcode-task.service'),'utf8');
  assert.match(web,/^User=voxcode$/mu);assert.match(web,/^SupplementaryGroups=voxcode-rpc$/mu);assert.match(web,/server-cli\.mjs start/);
  assert.match(task,/^User=voxcode-task$/mu);assert.match(task,/^Group=voxcode-rpc$/mu);assert.match(task,/task-cli\.mjs start/);
  assert.match(task,/^RuntimeDirectoryMode=0750$/mu);assert.match(task,/InaccessiblePaths=.*shared\/config/);
  for(const unit of [web,task]){assert.match(unit,/^KillMode=control-group$/mu);assert.match(unit,/^NoNewPrivileges=yes$/mu);assert.doesNotMatch(unit,/sudo|User=root/);}
  await assert.rejects(run('expect',[join(root,'scripts/server/vm6-password.exp'),'/missing','ssh','-o','StrictHostKeyChecking=yes','root@example.test','true']),e=>e.code===2&&/fixed vm6/.test(e.stderr));
});

async function executionConfig(){
  const config=JSON.parse(await readFile(join(root,'apps/server/deploy/deploy.json.example'),'utf8'));
  const web=(await readFile(join(root,'apps/server/deploy/server.env.example'),'utf8')).replace('REPLACE_WITH_TASK_UID','1002');
  const task=await readFile(join(root,'apps/server/deploy/task.env.example'),'utf8');
  return {config,web,task,reviewed:{...config,executionMode:'task-rpc',identityVerified:true}};
}
test('activation defaults blocked and only exact task RPC configuration can pass',async()=>{
  const {config,web,task,reviewed}=await executionConfig();
  assert.throws(()=>validateExecutionConfig(config,web,task),/blocked/);assert.doesNotThrow(()=>validateExecutionConfig(reviewed,web,task));
  for(const c of [{...reviewed,executionMode:'service-user-shared-credentials'},{...reviewed,identityVerified:false},{...reviewed,taskSocket:'/tmp/task.sock'}])assert.throws(()=>validateExecutionConfig(c,web,task));
  for(const text of [web+'\nVOXCODE_CODEX_COMMAND=/bin/sh',web+'\nVOXCODE_TASK_SOCKET=/evil',web.replace('VOXCODE_TASK_UID=1002','VOXCODE_TASK_UID=0')])assert.throws(()=>validateExecutionConfig(reviewed,text,task));
  assert.throws(()=>validateExecutionConfig(reviewed,web,task+'\nLINX_TOKEN=synthetic'));
});

test('host identity preflight rejects shared credential groups and unsafe task paths',async()=>{
  const {web,task,reviewed}=await executionConfig(),base='/opt/voxcode';
  function host({taskGroups='1003',badPath,modeOverride}={}){
    const paths=new Map();
    const add=(path,directory,uid,gid,mode)=>paths.set(path,{uid,gid,mode:path===badPath?modeOverride:mode,isDirectory:()=>directory,isFile:()=>!directory,isSymbolicLink:()=>false});
    add(base+'/shared/config',true,0,1001,0o750);
    for(const name of ['server.env','login-secret','mcp-endpoint','server-cert.pem','server-key.pem'])add(base+'/shared/config/'+name,false,0,1001,0o640);
    add(base+'/shared/task-config',true,0,1003,0o750);for(const name of ['task.env','projects.json'])add(base+'/shared/task-config/'+name,false,0,1003,0o640);
    add(base+'/shared/state',true,1001,1001,0o700);add(base+'/shared/task-state',true,1002,1003,0o700);
    add('/var/lib/voxcode',true,1001,1001,0o700);add('/var/lib/voxcode-task',true,1002,1003,0o700);add('/srv/voxcode/project',true,1002,1003,0o770);add('/srv',true,0,0,0o755);add('/srv/voxcode',true,0,0,0o755);
    const fs={lstat:async path=>{if(!paths.has(path))throw Object.assign(Error('missing'),{code:'ENOENT'});return paths.get(path);},realpath:async path=>path,readFile:async()=>JSON.stringify({projects:[{id:'demo',name:'Demo',root:'/srv/voxcode/project',enabled:true}]})};
    const exec=async(name,args)=>{
      if(name==='getent'){
        if(args[0]==='passwd')return {stdout:'voxcode:x:1001:1001::/var/lib/voxcode:/usr/sbin/nologin\nvoxcode-task:x:1002:1003::/var/lib/voxcode-task:/usr/sbin/nologin\n'};
        if(args.length===1)return {stdout:'voxcode:x:1001:\nvoxcode-rpc:x:1003:voxcode\n'};
        return {stdout:`${args[1]}:x:${args[1]==='voxcode'?1001:1003}:\n`};
      }
      const isTask=args[1]==='voxcode-task';return {stdout:args[0]==='-u'?`${isTask?1002:1001}\n`:`${isTask?taskGroups:'1001 1003'}\n`};
    };
    return {fs,exec};
  }
  assert.deepEqual(await validateHostIdentity({root:base,config:reviewed,webEnvironment:web,taskEnvironment:task,...host()}),{webUid:1001,taskUid:1002});
  for(const options of [{taskGroups:'1001 1003'},{badPath:base+'/shared/config',modeOverride:0o755},{badPath:base+'/shared/task-state',modeOverride:0o750}])await assert.rejects(validateHostIdentity({root:base,config:reviewed,webEnvironment:web,taskEnvironment:task,...host(options)}));
});

test('journal output contains only recognized redacted lifecycle events',async()=>{
  const base=fakeSystemd(),driver=systemdDriver({root:'/opt/voxcode',config:{port:9899},expectedUnit:'EXPECTED',expectedTaskUnit:'TASK',
    exec:async(name,args,opts)=>{
      if(name==='journalctl')return {stdout:[{MESSAGE:'secret user prompt token=synthetic',_SYSTEMD_UNIT:'voxcode.service'},{MESSAGE:'VoxCode task service listening on protected local socket',_SYSTEMD_UNIT:'voxcode-task.service',__REALTIME_TIMESTAMP:'123'}].map(JSON.stringify).join('\n')};
      // Reuse a fresh fixture driver only for its independently checked ownership seam.
      if(name==='systemctl'&&args[0]==='show'){const task=args[1]==='voxcode-task.service';return {stdout:`User=${task?'voxcode-task':'voxcode'}\nMainPID=0\nControlGroup=/system.slice/${args[1]}\nFragmentPath=/etc/systemd/system/${args[1]}\n`};}
      if(name==='ss')return {stdout:''};return {stdout:''};
    },fs:{readFile:async path=>path.endsWith('/voxcode-task.service')?'TASK':'EXPECTED'}});
  const logs=await driver.logs();assert.deepEqual(logs.events,[{event:'task_started',unit:'voxcode-task.service',timestamp:'123'}]);assert.equal(logs.rawMessagesOmitted,true);assert.doesNotMatch(JSON.stringify(logs),/synthetic|secret user/);
});

test('before first deployment start/restart refuse; stop is idempotent and does not need a release',async t=>{
  const f=await fixture(t),events=[];
  const driver={assertOwned:async()=>events.push('owned'),start:async()=>events.push('start'),stop:async()=>events.push('stop'),restart:async()=>events.push('restart'),healthy:async()=>true,status:async()=>({mainPid:'0'})};
  for(const command of ['start','restart'])await assert.rejects(operateLifecycle({root:f.deploy,command,driver}),/deploy before starting/);
  assert.deepEqual(events,[]);
  assert.equal((await operateLifecycle({root:f.deploy,command:'stop',driver})).current,null);
  assert.equal((await operateLifecycle({root:f.deploy,command:'stop',driver})).current,null);
  assert.deepEqual(events,['owned','stop','owned','stop']);
  await mkdir(join(f.deploy,'releases',revA));await symlink('releases/'+revA,join(f.deploy,'current'));
  const checked=[];
  await operateLifecycle({root:f.deploy,command:'start',driver,checkRelease:async(_root,id)=>checked.push(id),attempts:1});
  assert.deepEqual(checked,[revA]);assert.equal(events.at(-1),'start');
  driver.healthy=async()=>false;
  await assert.rejects(operateLifecycle({root:f.deploy,command:'restart',driver,checkRelease:async()=>{},attempts:1}),/health check failed/);
});

test('Expect password transport performs one synthetic interaction without printing the secret',async t=>{
  const f=await fixture(t),bin=join(f.dir,'bin'),secret=join(f.dir,'password');await mkdir(bin);await writeFile(secret,'SYNTHETIC_TEST_PASSWORD',{mode:0o600});
  await writeFile(join(bin,'ssh'),'#!/bin/sh\nstty -echo\nprintf "password: "\nIFS= read -r answer\nstty echo\nif [ "$answer" = SYNTHETIC_TEST_PASSWORD ]; then printf "\\nfixture-ok\\n"; exit 0; fi\nexit 3\n',{mode:0o700});
  const args=[join(root,'scripts/server/vm6-password.exp'),secret,'ssh','-o','StrictHostKeyChecking=yes','root@203.0.113.10','true'];
  const result=await run('expect',args,{env:{...process.env,PATH:bin+':'+process.env.PATH}});
  assert.match(result.stdout,/fixture-ok/);assert.doesNotMatch(result.stdout+result.stderr,/SYNTHETIC_TEST_PASSWORD/);
  // Even an unexpected echoing PTY must not expose the password at EOF.
  await writeFile(join(bin,'ssh'),'#!/bin/sh\nprintf "password: "\nIFS= read -r answer\nprintf "\\nfixture-ok\\n"\n',{mode:0o700});
  const echoing=await run('expect',args,{env:{...process.env,PATH:bin+':'+process.env.PATH}});
  assert.match(echoing.stdout,/fixture-ok/);assert.doesNotMatch(echoing.stdout+echoing.stderr,/SYNTHETIC_TEST_PASSWORD/);
  await chmod(secret,0o644);await assert.rejects(run('expect',args,{env:{...process.env,PATH:bin+':'+process.env.PATH}}),e=>e.code===1&&/private password/.test(e.stderr));
});
