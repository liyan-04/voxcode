import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {once} from 'node:events';
import {readFile,rm,stat,mkdir,mkdtemp,symlink,readdir} from 'node:fs/promises';
import {X509Certificate,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const script=join(root,'scripts/create-local-tls.mjs');
const machine={VOXCODE_MACHINE_ID:'fixture-mac',VOXCODE_MACHINE_KEY:'fixture-machine-key-longer-than-thirty-two-characters'};
function runHelper(args){return spawnSync(process.execPath,[script,...args],{cwd:root,encoding:'utf8',timeout:10000});}
async function outputDirectory(t){const path=join(root,'.voxcode-tls',`fixture-${randomUUID()}`);t.after(()=>rm(path,{recursive:true,force:true}));return path;}
test('certificate helper is opt-in, ignored, IP-bound and exports public client PEM/DER',{timeout:15000},async t=>{
  const dir=await outputDirectory(t),result=runHelper(['--ip','127.0.0.1','--out',dir]);
  assert.equal(result.status,0,result.stderr);
  const ca=await readFile(join(dir,'VoxCodeCA.pem')),der=await readFile(join(dir,'VoxCodeCA.der')),leaf=new X509Certificate(await readFile(join(dir,'relay.pem')));
  const rootCertificate=new X509Certificate(ca);
  assert.deepEqual(rootCertificate.raw,der);assert.equal(rootCertificate.ca,true);assert.equal(leaf.ca,false);assert.equal(leaf.checkIP('127.0.0.1'),'127.0.0.1');assert.equal(leaf.checkIP('127.0.0.2'),undefined);assert(leaf.verify(rootCertificate.publicKey));
  assert.equal((await stat(dir)).mode&0o777,0o700);assert.equal((await stat(join(dir,'relay.key'))).mode&0o777,0o600);assert.equal((await stat(join(dir,'VoxCodeCA.key'))).mode&0o777,0o600);
  assert(!result.stdout.includes('PRIVATE KEY'));assert(!ca.toString().includes('PRIVATE KEY'));
  const before=await readFile(join(dir,'relay.key'));const retry=runHelper(['--ip','127.0.0.1','--out',dir]);assert.notEqual(retry.status,0);assert.match(retry.stderr,/overwrite|exists/i);assert.deepEqual(await readFile(join(dir,'relay.key')),before);
});
test('certificate helper rejects invalid IP and non-ignored output without writing',async t=>{
  const dir=await outputDirectory(t);
  for(const ip of ['localhost','127.0.0.1;touch injected','999.1.1.1','127.0.0.01']){const result=runHelper(['--ip',ip,'--out',dir]);assert.notEqual(result.status,0);assert.match(result.stderr,/IPv4/);}
  await assert.rejects(stat(dir),{code:'ENOENT'});
  const outside=join(root,`fixture-tls-${randomUUID()}`),result=runHelper(['--ip','127.0.0.1','--out',outside]);assert.notEqual(result.status,0);await assert.rejects(stat(outside),{code:'ENOENT'});
  const missing=runHelper([]);assert.notEqual(missing.status,0);assert.match(missing.stderr,/--ip/);
});
test('certificate helper refuses existing directories',async t=>{
  const dir=await outputDirectory(t);await mkdir(join(root,'.voxcode-tls'),{recursive:true,mode:0o700});await mkdir(dir,{mode:0o700});
  const result=runHelper(['--ip','127.0.0.1','--out',dir]);assert.notEqual(result.status,0);assert.match(result.stderr,/overwrite|exists/i);
});
test('certificate helper does not write through an existing output symlink',async t=>{
  const dir=await outputDirectory(t),target=await mkdtemp(join(tmpdir(),'voxcode-ca-symlink-'));t.after(()=>rm(target,{recursive:true,force:true}));
  await symlink(target,dir,'dir');const result=runHelper(['--ip','127.0.0.1','--out',dir]);assert.notEqual(result.status,0);assert.match(result.stderr,/overwrite|exists/i);assert.deepEqual(await readdir(target),[]);
});
async function launch(t,path,env,ready){
  const child=spawn(process.execPath,[join(root,path)],{cwd:root,env:{...process.env,...machine,...env},stdio:['ignore','pipe','pipe']});let output='';
  const exited=once(child,'exit');
  t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await exited;}});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('CLI startup timed out')),5000);child.stdout.on('data',chunk=>{output+=chunk;if(ready.test(output)){clearTimeout(timer);resolve();}});child.stderr.on('data',chunk=>{output+=chunk;});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`CLI exited ${code}: ${output}`));});});
  return child;
}
test('relay and connector CLIs use cert/key/CA file paths over HTTPS/WSS',{timeout:15000},async t=>{
  const dir=await outputDirectory(t),generated=runHelper(['--ip','127.0.0.1','--out',dir]);assert.equal(generated.status,0,generated.stderr);
  const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const bridge=createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end('{"fixture":true}');});bridge.listen(0,'127.0.0.1');await once(bridge,'listening');t.after(async()=>{bridge.closeAllConnections();await new Promise(resolve=>bridge.close(resolve));});
  await launch(t,'apps/relay/relay-cli.mjs',{VOXCODE_RELAY_HOST:'127.0.0.1',VOXCODE_RELAY_PORT:String(port),VOXCODE_TLS_CERT:join(dir,'relay.pem'),VOXCODE_TLS_KEY:join(dir,'relay.key')},/HTTPS/);
  await launch(t,'apps/relay/connector-cli.mjs',{VOXCODE_RELAY_URL:`wss://127.0.0.1:${port}/connector`,VOXCODE_BRIDGE_URL:`http://127.0.0.1:${bridge.address().port}`,VOXCODE_TLS_CA:join(dir,'VoxCodeCA.pem')},/connected/);
  const ca=await readFile(join(dir,'VoxCodeCA.pem'));
  const response=await new Promise((resolve,reject)=>{const req=httpsRequest(`https://127.0.0.1:${port}/api/health`,{ca,rejectUnauthorized:true},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks)}));});req.on('error',reject);req.end();});
  assert.equal(response.status,200);assert.deepEqual(JSON.parse(response.body),{fixture:true});
});
test('relay CLI rejects incomplete TLS and remote plaintext without exposing configuration',()=>{
  for(const config of [{VOXCODE_TLS_CERT:'/private/fixture-secret-cert.pem'},{VOXCODE_RELAY_HOST:'203.0.113.9'}]){
    const result=spawnSync(process.execPath,[join(root,'apps/relay/relay-cli.mjs')],{cwd:root,env:{...process.env,...machine,VOXCODE_RELAY_PORT:'9899',VOXCODE_TLS_CERT:'',VOXCODE_TLS_KEY:'',...config},encoding:'utf8',timeout:3000});
    assert.equal(result.status,1);assert.match(result.stderr,/configuration invalid/i);assert(!result.stderr.includes(machine.VOXCODE_MACHINE_KEY));assert(!result.stderr.includes('fixture-secret-cert'));
  }
});
