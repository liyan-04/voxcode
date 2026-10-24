import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, lstat, realpath, mkdir, mkdtemp, rename, symlink, readlink, rm, chmod } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { request } from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { bundlePaths, decodeBundle, sha256, revision, safeRoot } from './bundle.mjs';

const run = promisify(execFile), unitName = 'voxcode.service', taskUnitName='voxcode-task.service';
const bounded = { timeout: 30000, maxBuffer: 128 * 1024 };
export function parseConfig(value, root) {
  if (value.format !== 1 || value.service !== unitName || value.user !== 'voxcode' || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535) throw Error('Invalid deployment config');
  const origin = new URL(value.healthOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== value.healthOrigin || origin.username || origin.password || Number(origin.port || 443) !== value.port) throw Error('Health origin must be the HTTPS listening origin');
  if (value.healthCaFile !== join(root, 'shared/config/health-ca.pem')) throw Error('Health CA must be in shared config');
  return { ...value, host: origin.hostname.replace(/^\[|\]$/gu, '') };
}
function environmentValues(text) {
  const result={};
  for(const raw of text.split('\n')){
    const line=raw.trim();if(!line||line.startsWith('#'))continue;
    const match=line.match(/^([A-Z][A-Z0-9_]*)=([A-Za-z0-9_./:\[\]-]+)$/u);
    if(!match||Object.hasOwn(result,match[1]))throw Error('Unsupported or duplicate private environment entry');
    result[match[1]]=match[2];
  }
  return result;
}
export function validateExecutionConfig(config, environment, taskEnvironment, root='/opt/voxcode') {
  if(config.executionMode!=='task-rpc'||config.identityVerified!==true||config.taskService!==taskUnitName||config.taskUser!=='voxcode-task'||config.taskGroup!=='voxcode-rpc'||config.taskSocket!=='/run/voxcode-task/rpc.sock')throw Error('Deployment blocked: reviewed task RPC identity configuration required');
  const web=environmentValues(environment),task=environmentValues(taskEnvironment??'');
  const expectedWeb={VOXCODE_HOST:'0.0.0.0',VOXCODE_PORT:String(config.port),VOXCODE_PUBLIC_ORIGIN:config.healthOrigin,VOXCODE_DATA:join(root,'shared/state'),VOXCODE_TASK_SOCKET:config.taskSocket,VOXCODE_LOGIN_SECRET_FILE:join(root,'shared/config/login-secret'),VOXCODE_MCP_ENDPOINT_FILE:join(root,'shared/config/mcp-endpoint'),VOXCODE_TLS_CERT:join(root,'shared/config/server-cert.pem'),VOXCODE_TLS_KEY:join(root,'shared/config/server-key.pem')};
  const expectedTask={VOXCODE_PROJECTS_FILE:join(root,'shared/task-config/projects.json'),VOXCODE_TASK_DATA:join(root,'shared/task-state'),VOXCODE_TASK_SOCKET:config.taskSocket,VOXCODE_CODEX_COMMAND:'/usr/local/bin/codex'};
  if(Object.keys(web).sort().join()!==[...Object.keys(expectedWeb),'VOXCODE_TASK_UID'].sort().join()||Object.entries(expectedWeb).some(([k,v])=>web[k]!==v)||!/^\d+$/u.test(web.VOXCODE_TASK_UID)||Number(web.VOXCODE_TASK_UID)===0)throw Error('Web environment must contain only the reviewed Web paths and task RPC identity');
  if(Object.keys(task).sort().join()!==Object.keys(expectedTask).sort().join()||Object.entries(expectedTask).some(([k,v])=>task[k]!==v))throw Error('Task environment must contain only fixed task RPC configuration');
  return {web,task};
}
export async function validateHostIdentity({root,config,webEnvironment,taskEnvironment,exec=run,fs={lstat,realpath,readFile}}){
  const {web}=validateExecutionConfig(config,webEnvironment,taskEnvironment,root);
  const identity=async(name)=>{
    const uid=(await exec('id',['-u',name],bounded)).stdout.trim(),groups=(await exec('id',['-G',name],bounded)).stdout.trim().split(/\s+/u);
    if(!/^[1-9]\d*$/u.test(uid)||groups.some(x=>!/^\d+$/u.test(x)))throw Error('Invalid dedicated service identity');return {uid:Number(uid),groups:new Set(groups.map(Number))};
  };
  const webId=await identity('voxcode'),taskId=await identity('voxcode-task');
  const group=async name=>{const text=(await exec('getent',['group',name],bounded)).stdout.trim();const fields=text.split(':');if(fields[0]!==name||!/^\d+$/u.test(fields[2]??''))throw Error('Missing reviewed service group');return Number(fields[2]);};
  const webGroup=await group('voxcode'),rpcGroup=await group('voxcode-rpc');
  if(webId.uid===taskId.uid||Number(web.VOXCODE_TASK_UID)!==taskId.uid||!webId.groups.has(webGroup)||!webId.groups.has(rpcGroup)||!taskId.groups.has(rpcGroup)||taskId.groups.has(webGroup))throw Error('Web/task identities or credential groups are not isolated');
  const {stdout:accounts}=await exec('getent',['passwd'],bounded);
  if(accounts.split('\n').filter(Boolean).some(line=>{const row=line.split(':');return Number(row[2])===webId.uid&&row[0]!=='voxcode'||Number(row[2])===taskId.uid&&row[0]!=='voxcode-task'||Number(row[3])===webGroup&&row[0]!=='voxcode'||Number(row[3])===rpcGroup&&!['voxcode','voxcode-task'].includes(row[0]);}))throw Error('Dedicated service UID or private primary group is shared by another account');
  const {stdout:groups}=await exec('getent',['group'],bounded);
  for(const line of groups.split('\n').filter(Boolean)){
    const row=line.split(':'),members=(row[3]??'').split(',').filter(Boolean),gid=Number(row[2]);
    if(gid===webGroup&&members.some(name=>name!=='voxcode')||gid===rpcGroup&&members.some(name=>!['voxcode','voxcode-task'].includes(name)))throw Error('Private service groups include unrelated accounts');
  }
  const expectPath=async(path,{directory=false,uid,gid,mode})=>{
    const st=await fs.lstat(path);
    if(st.isSymbolicLink()||!(directory?st.isDirectory():st.isFile())||st.uid!==uid||gid!==undefined&&st.gid!==gid||(st.mode&0o777)!==mode||await fs.realpath(path)!==path)throw Error('Host path does not match reviewed identity permissions');return st;
  };
  await expectPath(join(root,'shared/config'),{directory:true,uid:0,gid:webGroup,mode:0o750});
  for(const name of ['server.env','login-secret','mcp-endpoint','server-cert.pem','server-key.pem'])await expectPath(join(root,'shared/config',name),{uid:0,gid:webGroup,mode:0o640});
  await expectPath(join(root,'shared/task-config'),{directory:true,uid:0,gid:rpcGroup,mode:0o750});
  for(const name of ['task.env','projects.json'])await expectPath(join(root,'shared/task-config',name),{uid:0,gid:rpcGroup,mode:0o640});
  await expectPath(join(root,'shared/task-state'),{directory:true,uid:taskId.uid,mode:0o700});
  await expectPath(join(root,'shared/state'),{directory:true,uid:webId.uid,mode:0o700});
  await expectPath('/var/lib/voxcode-task',{directory:true,uid:taskId.uid,mode:0o700});
  await expectPath('/var/lib/voxcode',{directory:true,uid:webId.uid,mode:0o700});
  const raw=JSON.parse(await fs.readFile(join(root,'shared/task-config/projects.json'),'utf8'));
  if(Object.keys(raw??{}).join()!=='projects'||!Array.isArray(raw.projects)||raw.projects.length!==1||raw.projects[0].root!=='/srv/voxcode/project'||raw.projects[0].enabled!==true)throw Error('This reviewed unit supports only its fixed authorized project path');
  const project=await fs.lstat('/srv/voxcode/project');
  if(!project.isDirectory()||project.isSymbolicLink()||project.uid!==taskId.uid||(project.mode&0o007)!==0||await fs.realpath('/srv/voxcode/project')!=='/srv/voxcode/project')throw Error('Authorized project must be task-owned and inaccessible to others');
  for(const path of ['/srv','/srv/voxcode']){
    const ancestor=await fs.lstat(path);if(!ancestor.isDirectory()||ancestor.isSymbolicLink()||ancestor.uid!==0||(ancestor.mode&0o022)!==0||await fs.realpath(path)!==path)throw Error('Authorized project ancestors must be root-owned and immutable to service users');
  }
  try{
    await expectPath('/run/voxcode-task',{directory:true,uid:taskId.uid,gid:rpcGroup,mode:0o750});
    const socket=await fs.lstat(config.taskSocket);if(!socket.isSocket()||socket.uid!==taskId.uid||socket.gid!==rpcGroup||(socket.mode&0o777)!==0o660)throw Error('Existing task socket identity is not verified');
  }catch(e){if(e.code!=='ENOENT')throw e;}
  return {webUid:webId.uid,taskUid:taskId.uid};
}
export async function readCurrent(root) {
  try {
    const stat = await lstat(join(root, 'current'));
    if (!stat.isSymbolicLink()) throw Error('Current must be a managed symlink');
    const target = await readlink(join(root, 'current'));
    if (!/^releases\/[a-f0-9]{7,64}$/u.test(target)) throw Error('Current points outside releases');
    await lstat(join(root, target)).then(stat => { if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Current release must be a directory'); });
    return target.slice('releases/'.length);
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function switchCurrent(root, target) {
  const temporary = join(root, `.current-${process.pid}-${Date.now()}`);
  if (target === null) { await rm(join(root, 'current'), { force: true }); return; }
  revision(target);
  try { await symlink(`releases/${target}`, temporary); await rename(temporary, join(root, 'current')); }
  finally { await rm(temporary, { force: true }); }
}
async function protectedPath(path, directory = false) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile()) || stat.uid !== 0 || (stat.mode & 0o022)) throw Error('Deployment files must be root-owned and not writable by group or others');
  return stat;
}
async function checkedRelease(root, id) {
  revision(id); const path = join(root, 'releases', id); await protectedPath(path, true);
  const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8'));
  if (manifest.revision !== id || manifest.name !== '@voxcode/server' || Object.keys(manifest.files ?? {}).sort().join('\n') !== [...bundlePaths].sort().join('\n')) throw Error('Invalid release manifest');
  for (const name of bundlePaths) { await protectedPath(join(path, name)); if (sha256(await readFile(join(path, name))) !== manifest.files[name]) throw Error('Release content changed'); }
  await protectedPath(join(path, 'release.env'));
  if (await readFile(join(path, 'release.env'), 'utf8') !== `VOXCODE_REVISION=${id}\n`) throw Error('Release environment changed');
  return path;
}
export function systemdDriver({ root, config, expectedUnit, expectedTaskUnit, exec = run, fs = { readFile, readlink } }) {
  const definitions=[{name:unitName,user:'voxcode',expected:expectedUnit},{name:taskUnitName,user:'voxcode-task',expected:expectedTaskUnit}];
  async function properties(name) {
    const { stdout } = await exec('systemctl', ['show', name, '--property=User,MainPID,ControlGroup,FragmentPath'], bounded);
    return Object.fromEntries(stdout.trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
  }
  async function ownedPid(pid, group, user) {
    if (!/^[1-9]\d*$/u.test(pid) || !group || group === '/') throw Error('Cannot prove service process ownership');
    const [status, groups] = await Promise.all([fs.readFile(`/proc/${pid}/status`, 'utf8'), fs.readFile(`/proc/${pid}/cgroup`, 'utf8')]);
    const uid = status.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/mu);
    const { stdout } = await exec('id', ['-u', user], bounded);
    if (!uid || !uid.slice(1).every(value => value === stdout.trim()) || !groups.split('\n').some(line => line.slice(line.lastIndexOf(':') + 1) === group)) throw Error('Process does not belong to the expected VoxCode service user and cgroup');
  }
  return {
    async assertOwned() {
      let web;
      for(const definition of definitions){
        const p=await properties(definition.name);
        if(p.User!==definition.user||p.FragmentPath!==`/etc/systemd/system/${definition.name}`||typeof definition.expected!=='string'||await fs.readFile(p.FragmentPath,'utf8')!==definition.expected)throw Error('Installed systemd service is not the reviewed VoxCode unit');
        if(p.MainPID!=='0')await ownedPid(p.MainPID,p.ControlGroup,definition.user);
        if(definition.name===unitName)web=p;
      }
      const { stdout } = await exec('ss', ['-H', '-ltnp', `sport = :${config.port}`], bounded);
      if (stdout.trim()) {
        if (web.MainPID === '0') throw Error('Configured port is occupied by an unrelated listener');
        for (const line of stdout.trim().split('\n')) {
          const pids = [...line.matchAll(/pid=(\d+)/gu)].map(match => match[1]);
          if (!pids.length) throw Error('Cannot identify the listening process');
          for (const pid of pids) await ownedPid(pid,web.ControlGroup,'voxcode');
        }
      }
    },
    async start(){await this.assertOwned();await exec('systemctl',['start',taskUnitName],bounded);await exec('systemctl',['start',unitName],bounded);},
    async restart() {
      await this.assertOwned();
      // Prevent HTTP writes while the task process owner changes release.
      await exec('systemctl',['stop',unitName],bounded);
      await exec('systemctl',['restart',taskUnitName],bounded);
      await exec('systemctl',['restart',unitName],bounded);
    },
    async stop() {await this.assertOwned();await exec('systemctl',['stop',unitName],bounded);await exec('systemctl',['stop',taskUnitName],bounded);},
    async logs(){
      await this.assertOwned();
      // Journal text may contain provider/user content. Return fixed lifecycle
      // events only, never arbitrary task output or raw diagnostic lines.
      const {stdout}=await exec('journalctl',['-u',unitName,'-u',taskUnitName,'--no-pager','--output=json','--lines=200'],bounded);
      const known=new Map([
        ['VoxCode task service listening on protected local socket','task_started'],
        ['Task startup blocked; verify private configuration, dedicated identity and owned socket','task_start_blocked'],
        ['Task shutdown cleanup unconfirmed; reconcile execution ownership','task_cleanup_unconfirmed'],
        ['Task shutdown deadline reached; reconcile execution ownership','task_shutdown_deadline'],
      ]);
      const events=[];
      for(const line of stdout.split('\n')){try{const entry=JSON.parse(line),event=known.get(entry.MESSAGE);if(event)events.push({event,unit:[unitName,taskUnitName].includes(entry._SYSTEMD_UNIT)?entry._SYSTEMD_UNIT:null,timestamp:/^\d{1,20}$/u.test(entry.__REALTIME_TIMESTAMP??'')?entry.__REALTIME_TIMESTAMP:null});}catch{}}
      return {events,rawMessagesOmitted:true};
    },
    async status() {const web=await properties(unitName),task=await properties(taskUnitName);return {mainPid:web.MainPID,user:web.User,unit:unitName,task:{mainPid:task.MainPID,user:task.User,unit:taskUnitName}};},
    async healthy(id) {
      const ca = await fs.readFile(config.healthCaFile);
      return new Promise(resolveHealth => {
        let timer;
        const finish = result => { clearTimeout(timer); resolveHealth(result); };
        const req = request({ hostname: '127.0.0.1', port: config.port, path: '/api/health', method: 'GET', ca,
          servername: isIP(config.host) ? undefined : config.host, checkServerIdentity: (_, cert) => checkServerIdentity(config.host, cert),
          headers: { host: new URL(config.healthOrigin).host }, timeout: 3000 }, res => {
          let body = ''; res.on('data', bytes => { body += bytes; if (body.length > 16384) req.destroy(); });
          res.on('error', () => finish(false));
          res.on('end', () => { try { const value = JSON.parse(body); finish(res.statusCode === 200 && value.name === 'VoxCode' && value.revision === id && value.codexAvailable===true); } catch { finish(false); } });
        });
        timer = setTimeout(() => { req.destroy(); finish(false); }, 3000);
        req.on('timeout', () => req.destroy()); req.on('error', () => finish(false)); req.end();
      });
    },
  };
}
async function awaitHealth(driver, id, attempts) {
  for (let i = 0; i < attempts; i++) { if (await driver.healthy(id)) return; if (i + 1 < attempts) await delay(1000); }
  throw Error('New release health check failed');
}
export async function operateLifecycle({root,command,driver,attempts=15,checkRelease=checkedRelease}){
  if(!['start','stop','restart'].includes(command))throw Error('Unsupported lifecycle command');
  const current=await readCurrent(root);
  if(command!=='stop'&&!current)throw Error('No installed current release; deploy before starting');
  if(current&&command!=='stop')await checkRelease(root,current);
  await driver.assertOwned();await driver[command]();
  if(command!=='stop')await awaitHealth(driver,current,attempts);
  return {command,current,...await driver.status()};
}

// Driver injection is an in-process test seam; the remote CLI always constructs
// and validates the systemd driver and never loads caller-selected code.
export async function activate({ root, target, driver, attempts = 15 }) {
  revision(target); const previous = await readCurrent(root);
  const destination = await lstat(join(root, 'releases', target));
  if (!destination.isDirectory() || destination.isSymbolicLink()) throw Error('Target must be an installed release directory');
  await driver.assertOwned();
  await switchCurrent(root, target);
  try { await driver.restart(); await awaitHealth(driver, target, attempts); }
  catch {
    await switchCurrent(root, previous);
    try { if (previous) { await driver.restart(); await awaitHealth(driver, previous, attempts); } else await driver.stop(); }
    catch { throw Error('Release failed and rollback health is unconfirmed; current was restored; inspect only the owned service'); }
    throw Error('Release health failed; previous release restored');
  }
  if (previous && previous !== target) await writeFile(join(root, 'previous'), `${previous}\n`, { mode: 0o600 });
  return { current: target, previous };
}
export async function stageRelease({ root, archive, digest, expectedRevision, install = async path => run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: path, timeout: 180000, maxBuffer: 128 * 1024 }) }) {
  revision(expectedRevision);
  if (!/^[a-f0-9]{64}$/u.test(digest)) throw Error('SHA256 required');
  const stat = await lstat(archive);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024) throw Error('Invalid upload');
  const bytes = await readFile(archive);
  if (sha256(bytes) !== digest) throw Error('Upload SHA256 mismatch');
  const { files, manifest } = decodeBundle(bytes);
  if (manifest.revision !== expectedRevision) throw Error('Uploaded revision mismatch');
  const destination = join(root, 'releases', manifest.revision);
  try { await lstat(destination); throw Error('Release already exists; use rollback or a new revision'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const stage = await mkdtemp(join(root, 'releases/.stage-'));
  try {
    for (const [name, content] of files) { await mkdir(dirname(join(stage, name)), { recursive: true, mode: 0o755 }); await writeFile(join(stage, name), content, { flag: 'wx', mode: 0o644 }); }
    await writeFile(join(stage, 'release.env'), `VOXCODE_REVISION=${manifest.revision}\n`, { mode: 0o644 });
    await install(stage);
    await chmod(stage, 0o755);
    await rename(stage, destination);
    return manifest.revision;
  } finally { await rm(stage, { recursive: true, force: true }); }
}
export async function runRemote(options) {
  if(!options||!['deploy','rollback','start','stop','restart','status','logs'].includes(options.command))throw Error('Unknown remote command');
  const root = safeRoot(options.root ?? '/opt/voxcode');
  if (process.getuid?.() !== 0) throw Error('Remote management requires root; runtime must use voxcode');
  if (Number(process.versions.node.split('.')[0]) !== 22) throw Error('Remote deployment requires Node 22');
  if (await realpath(root) !== root) throw Error('Deployment root must not contain symlinks');
  for (let path = dirname(root); path !== '/'; path = dirname(path)) await protectedPath(path, true);
  for (const path of [root, join(root, 'releases'), join(root, 'shared'), join(root, 'shared/config')]) await protectedPath(path, true);
  await protectedPath(join(root, 'shared/config/deploy.json'));
  const config = parseConfig(JSON.parse(await readFile(join(root, 'shared/config/deploy.json'), 'utf8')), root);
  const template = await readFile(new URL('../../apps/server/deploy/voxcode.service', import.meta.url), 'utf8');
  const taskTemplate=await readFile(new URL('../../apps/server/deploy/voxcode-task.service',import.meta.url),'utf8');
  const expectedUnit = template.replaceAll('@ROOT@', root),expectedTaskUnit=taskTemplate.replaceAll('@ROOT@',root);
  for(const name of [unitName,taskUnitName])await protectedPath(`/etc/systemd/system/${name}`);
  const driver = systemdDriver({ root, config, expectedUnit, expectedTaskUnit });
  await driver.assertOwned();
  if (['status','logs'].includes(options.command)) {
    const current = await readCurrent(root);
    if (current) await checkedRelease(root, current);
    return options.command==='logs'?{root,current,...await driver.logs()}:{ root, current, ...await driver.status() };
  }
  if(['start','restart'].includes(options.command)&&!await readCurrent(root))throw Error('No installed current release; deploy before starting');
  // Stopping a proven-owned service remains possible when launch credentials or
  // an installed release need repair. It does not start code or consume secrets.
  if(options.command!=='stop'){
    await protectedPath(join(root, 'shared/config/server.env'));
    await protectedPath(join(root,'shared/task-config'),true);await protectedPath(join(root,'shared/task-config/task.env'));
    const webEnvironment=await readFile(join(root,'shared/config/server.env'),'utf8'),taskEnvironment=await readFile(join(root,'shared/task-config/task.env'),'utf8');
    await validateHostIdentity({root,config,webEnvironment,taskEnvironment});
  }
  const lock = join(root, '.deploy-lock');
  await mkdir(lock, { mode: 0o700 }).catch(() => { throw Error('Deployment lock exists; investigate the owning operation before removing it'); });
  try {
    if(['start','stop','restart'].includes(options.command)){
      return await operateLifecycle({root,command:options.command,driver});
    }
    let target;
    if (options.command === 'deploy') {
      if (options.archive !== join(root, 'incoming', `${revision(options.revision)}.tar.gz`)) throw Error('Upload must use the managed incoming path');
      target = await stageRelease({ root, archive: options.archive, digest: options.sha256, expectedRevision: options.revision,
        install: path => run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', ...(options.offline ? ['--offline'] : [])], { cwd: path, timeout: 180000, maxBuffer: 128 * 1024 }) });
    } else if (options.command === 'rollback') target = revision(options.revision ?? (await readFile(join(root, 'previous'), 'utf8')).trim());
    else throw Error('Unknown remote command');
    await checkedRelease(root, target);
    const current = await readCurrent(root);
    if (current) await checkedRelease(root, current);
    return await activate({ root, target, driver });
  } finally { await rm(lock, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3 || !/^[A-Za-z0-9_-]+$/u.test(process.argv[2]) || process.argv[2].length > 8192) throw Error('Invalid management request');
    const options = JSON.parse(Buffer.from(process.argv[2], 'base64url').toString('utf8'));
    console.log(JSON.stringify(await runRemote(options)));
  } catch (error) { console.error(`VoxCode deployment failed: ${error.message}`); process.exitCode = 1; }
}
