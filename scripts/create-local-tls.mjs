import {spawnSync} from 'node:child_process';
import {X509Certificate,randomBytes} from 'node:crypto';
import {chmod,lstat,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {isIPv4} from 'node:net';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const ignoredRoot=join(root,'.voxcode-tls');
function openssl(args,cwd,label){
  const result=spawnSync('openssl',args,{cwd,encoding:'utf8',timeout:30000,maxBuffer:65536,stdio:['ignore','pipe','pipe']});
  if(result.error||result.status!==0)throw new Error(`OpenSSL failed during ${label}; requires OpenSSL 3+`);
}
export async function createLocalTLS({ip,outDir}){
  if(typeof ip!=='string'||!isIPv4(ip))throw new Error('Supply a canonical IPv4 address with --ip');
  const output=resolve(outDir??join(ignoredRoot,ip));
  if(dirname(output)!==ignoredRoot)throw new Error('Output must be a new direct child of the ignored .voxcode-tls directory');
  const ignored=spawnSync('git',['check-ignore','--quiet','--no-index','--',output],{cwd:root,timeout:10000,stdio:'ignore'});
  if(ignored.status!==0)throw new Error('Output must be git-ignored before generating TLS material');
  try{await mkdir(ignoredRoot,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const parent=await lstat(ignoredRoot);
  if(!parent.isDirectory()||parent.isSymbolicLink())throw new Error('TLS output parent must be a real local directory');
  try{await mkdir(output,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw new Error('Output already exists; refusing to overwrite TLS material');throw error;}
  openssl(['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-sha256','-keyout','VoxCodeCA.key','-out','VoxCodeCA.pem','-days','3650','-subj','/CN=VoxCode Local CA','-addext','basicConstraints=critical,CA:TRUE,pathlen:0','-addext','keyUsage=critical,keyCertSign,cRLSign'],output,'CA generation');
  openssl(['req','-new','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-sha256','-keyout','relay.key','-out','relay.csr','-subj','/CN=VoxCode Relay'],output,'relay key generation');
  await chmod(join(output,'VoxCodeCA.key'),0o600);await chmod(join(output,'relay.key'),0o600);
  const extensions=`basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:${ip}\n`;
  await writeFile(join(output,'relay.ext'),extensions,{flag:'wx',mode:0o600});
  openssl(['x509','-req','-in','relay.csr','-CA','VoxCodeCA.pem','-CAkey','VoxCodeCA.key','-set_serial',`0x${randomBytes(16).toString('hex')}`,'-out','relay.pem','-days','365','-sha256','-extfile','relay.ext'],output,'relay signing');
  openssl(['verify','-CAfile','VoxCodeCA.pem','-verify_ip',ip,'-purpose','sslserver','relay.pem'],output,'IP and chain verification');
  const leaf=new X509Certificate(await readFile(join(output,'relay.pem')));
  if(leaf.ca||leaf.checkIP(ip)!==ip)throw new Error('Generated certificate does not match the supplied IP');
  openssl(['x509','-in','VoxCodeCA.pem','-outform','DER','-out','VoxCodeCA.der'],output,'public CA export');
  await rm(join(output,'relay.csr'));await rm(join(output,'relay.ext'));
  return {directory:output,caPEM:join(output,'VoxCodeCA.pem'),caDER:join(output,'VoxCodeCA.der')};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2),values={};
    for(let index=0;index<args.length;index+=2){const name=args[index];if(!['--ip','--out'].includes(name)||values[name]!==undefined||!args[index+1])throw new Error('Usage: node scripts/create-local-tls.mjs --ip <IPv4> [--out <new .voxcode-tls child>]');values[name]=args[index+1];}
    const result=await createLocalTLS({ip:values['--ip'],outDir:values['--out']});
    console.log(`Created local TLS material in ${result.directory}`);
    console.log('Public client trust only: VoxCodeCA.pem (Mac), VoxCodeCA.der (iOS). Keep both .key files private.');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
