import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {writeFile,realpath} from 'node:fs/promises';
import {posix,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const run=promisify(execFile),limit=32*1024*1024;
const modules=['apps/server','apps/mac-agent','packages/voice'];
const allowed=name=>/^(?:apps\/(?:server|mac-agent)\/[^/]+\.mjs|apps\/server\/public\/[A-Za-z0-9._-]+|packages\/control-protocol\/[^/]+\.mjs|packages\/voice\/src\/[A-Za-z0-9._-]+\.(?:js|mjs)|(?:apps\/(?:server|mac-agent)|packages\/voice)\/package(?:-lock)?\.json)$/u.test(name);
const required=['apps/server/control-cli.mjs','apps/server/control-config.mjs','apps/server/control-runtime.mjs','apps/server/task-cli.mjs','apps/server/public/index.html','apps/mac-agent/cli.mjs','packages/control-protocol/index.mjs','packages/voice/src/index.js','packages/voice/src/audio.js',...modules.flatMap(name=>[`${name}/package.json`,`${name}/package-lock.json`])];
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function checkRevision(value){if(!/^[a-f0-9]{40}$/u.test(value??''))throw Error('A full 40-character source revision is required');}

function validate(files){
 for(const name of required)if(!files.has(name))throw Error('Incomplete production source bundle');
 for(const module of modules){
  const pkg=JSON.parse(files.get(`${module}/package.json`)),lock=JSON.parse(files.get(`${module}/package-lock.json`));
  if(pkg.type!=='module'||pkg.workspaces||lock.lockfileVersion!==3||lock.packages?.['']?.name!==pkg.name||JSON.stringify(pkg.dependencies??{})!==JSON.stringify(lock.packages[''].dependencies??{}))throw Error('Package and production lock disagree');
  for(const [name,entry] of Object.entries(lock.packages))if(name&&(!name.startsWith('node_modules/')||entry.link||!/^https:\/\/registry\.npmjs\.org\//u.test(entry.resolved??'')||!/^sha512-/u.test(entry.integrity??'')))throw Error('Integrity-pinned registry dependencies required');
 }
 for(const [name,bytes] of files){
  if(!/\.(?:mjs|js)$/u.test(name))continue;
  for(const match of bytes.toString().matchAll(/(?:from\s*|import\s*(?:\(\s*)?)(['"])([^'"]+)\1/gu)){
   const specifier=match[2];
   if(specifier.startsWith('.')){if(!files.has(posix.normalize(posix.join(posix.dirname(name),specifier))))throw Error(`Missing production import in ${name}`);}
   else if(!specifier.startsWith('node:')){
    const module=modules.find(root=>name.startsWith(root+'/'));
    const pkg=module&&JSON.parse(files.get(`${module}/package.json`));
    if(!pkg?.dependencies?.[specifier.split('/').slice(0,specifier.startsWith('@')?2:1).join('/')])throw Error('Undeclared production dependency');
   }
  }
 }
 if(!files.get('apps/server/control-cli.mjs').toString().includes('realpathSync'))throw Error('Canonical control CLI entry fix is required');
}

export async function createBundle({root,revision}){
 checkRevision(revision);root=await realpath(root);
 const exact=(await run('git',['-C',root,'rev-parse','--verify',`${revision}^{commit}`],{maxBuffer:4096})).stdout.trim();
 if(exact!==revision)throw Error('Exact committed revision required');
 const tree=(await run('git',['-C',root,'ls-tree','-rz',revision,'--','apps/server','apps/mac-agent','packages/control-protocol','packages/voice'],{maxBuffer:4*1024*1024})).stdout;
 const files=new Map();
 for(const entry of tree.split('\0').filter(Boolean)){
  const match=/^(\d{6}) blob ([a-f0-9]{40})\t(.+)$/u.exec(entry);if(!match||!allowed(match[3]))continue;
  if(match[1]!=='100644')throw Error('Only committed regular production sources are accepted');
  const bytes=(await run('git',['-C',root,'show',`${revision}:${match[3]}`],{encoding:'buffer',maxBuffer:8*1024*1024})).stdout;
  files.set(match[3],bytes);
 }
 validate(files);
 const manifest={format:1,name:'voxcode-control',revision,node:22,dependencyMode:'npm-ci-ignore-scripts',files:Object.fromEntries([...files].map(([name,bytes])=>[name,sha256(bytes)]))};
 const bytes=gzipSync(JSON.stringify({manifest,files:Object.fromEntries([...files].map(([name,value])=>[name,value.toString('base64')]))}));
 readBundle({bytes,sha256:sha256(bytes)});return bytes;
}

export function readBundle({bytes,sha256:expected}){
 if(!Buffer.isBuffer(bytes)||bytes.length>limit||!/^[a-f0-9]{64}$/u.test(expected??'')||sha256(bytes)!==expected)throw Error('Bundle digest mismatch');
 const payload=JSON.parse(gunzipSync(bytes,{maxOutputLength:64*1024*1024}));
 const {manifest}=payload;checkRevision(manifest?.revision);
 if(manifest.format!==1||manifest.name!=='voxcode-control'||manifest.node!==22||manifest.dependencyMode!=='npm-ci-ignore-scripts'||!manifest.files||!payload.files||Object.keys(payload.files).sort().join('\n')!==Object.keys(manifest.files).sort().join('\n')||Object.keys(payload.files).length>500)throw Error('Invalid control bundle');
 const files=new Map();
 for(const [name,value] of Object.entries(payload.files)){
  if(!allowed(name)||typeof value!=='string')throw Error('Unexpected bundle entry');
  const file=Buffer.from(value,'base64');
  if(file.length>8*1024*1024||file.toString('base64')!==value||sha256(file)!==manifest.files[name])throw Error('Bundle source checksum mismatch');
  files.set(name,file);
 }
 validate(files);return {manifest,files,digest:expected};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i+=2){if(!['--root','--revision','--output'].includes(args[i])||options[args[i]]||!args[i+1])throw Error();options[args[i]]=args[i+1];}
  if(Object.keys(options).length!==3)throw Error();
  const bytes=await createBundle({root:options['--root'],revision:options['--revision']}),output=resolve(options['--output']);
  await writeFile(output,bytes,{mode:0o600,flag:'wx'});console.log(JSON.stringify({archive:output,revision:options['--revision'],sha256:sha256(bytes)}));
 }catch{console.error('Packaging failed; require --root CHECKOUT --revision FULL_COMMIT --output NEW_FILE and pinned production closure');process.exitCode=1;}
}
