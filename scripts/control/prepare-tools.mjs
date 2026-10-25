import * as fs from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {canonical,exists,isMain,readJson,trusted} from './common.mjs';
import {sha256} from './package.mjs';

async function sourceFile(path,owners){
 const info=await fs.lstat(path);
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||!owners.includes(info.uid)||info.mode&0o022||info.size>512*1024*1024)throw Error('Regular owned source tool required');
 return {bytes:await fs.readFile(path),mode:info.mode&0o111?0o755:0o644};
}
async function npmSnapshot(root,owners){
 const files=new Map();
 async function visit(path,prefix){
  const info=await fs.lstat(path);
  if(info.isSymbolicLink()||!owners.includes(info.uid)||info.mode&0o002)throw Error('Owned regular npm closure without links required');
  if(info.isDirectory()){for(const name of (await fs.readdir(path)).sort())await visit(join(path,name),prefix?`${prefix}/${name}`:name);}
  else{const value=await sourceFile(path,owners);files.set(prefix,{sha256:sha256(value.bytes),mode:value.mode});}
 }
 await visit(root,'');if(!files.has('bin/npm-cli.js'))throw Error('Complete npm package root required');
 return {files,digest:sha256(JSON.stringify([...files].map(([name,value])=>[name,value.sha256])))};
}
function checkPlan(plan){
 const fields=['format','sourceNode','sourceNpmRoot','sourceOwners','nodeSha256','npmTreeSha256'];
 if(!plan||plan.format!==1||Object.keys(plan).some(key=>!fields.includes(key))||!Array.isArray(plan.sourceOwners)||!plan.sourceOwners.length||plan.sourceOwners.some(uid=>!Number.isInteger(uid)||uid<0)||!['nodeSha256','npmTreeSha256'].every(key=>/^[a-f0-9]{64}$/u.test(plan[key]??'')))throw Error('Explicit reviewed source tool plan required');
 canonical(plan.sourceNode);canonical(plan.sourceNpmRoot);
}

export async function inspectTools({node,npmRoot,sourceOwners=[0,process.getuid()]}={}){
 node=await fs.realpath(canonical(node));npmRoot=await fs.realpath(canonical(npmRoot));
 if(!Array.isArray(sourceOwners)||sourceOwners.some(uid=>!Number.isInteger(uid)||uid<0))throw Error('Explicit source owners required');
 const binary=await sourceFile(node,sourceOwners),npm=await npmSnapshot(npmRoot,sourceOwners);
 return {format:1,sourceNode:node,sourceNpmRoot:npmRoot,sourceOwners,nodeSha256:sha256(binary.bytes),npmTreeSha256:npm.digest};
}

export async function prepareTools({plan,destination,dryRun=false}){
 checkPlan(plan);canonical(destination);await trusted(dirname(destination),{type:'directory'});
 if(destination===plan.sourceNpmRoot||destination.startsWith(plan.sourceNpmRoot+'/'))throw Error('Destination must be outside the old npm installation');
 if(await exists(destination)){
  await trusted(destination,{type:'directory'});const manifest=await readJson(join(destination,'toolchain-provenance.json'));
  const actual=await inspectTools({node:join(destination,'node'),npmRoot:join(destination,'npm')});
  if(manifest.format!==1||JSON.stringify(manifest.source)!==JSON.stringify(plan)||actual.nodeSha256!==plan.nodeSha256||actual.npmTreeSha256!==plan.npmTreeSha256)throw Error('Existing tool destination ownership or digest mismatch');
  return {unchanged:true,dryRun,node:join(destination,'node'),npm:join(destination,'npm/bin/npm-cli.js')};
 }
 const actual=await inspectTools({node:plan.sourceNode,npmRoot:plan.sourceNpmRoot,sourceOwners:plan.sourceOwners});
 if(JSON.stringify(actual)!==JSON.stringify(plan))throw Error('Reviewed source tool digest mismatch');
 if(dryRun)return {dryRun:true,unchanged:false};
 await fs.mkdir(destination,{mode:0o755});await fs.chmod(destination,0o755);
 try{
  const binary=await sourceFile(plan.sourceNode,plan.sourceOwners);if(sha256(binary.bytes)!==plan.nodeSha256)throw Error('Source Node digest changed');
  await fs.writeFile(join(destination,'node'),binary.bytes,{mode:0o755,flag:'wx'});await fs.chmod(join(destination,'node'),0o755);
  const npm=await npmSnapshot(plan.sourceNpmRoot,plan.sourceOwners);if(npm.digest!==plan.npmTreeSha256)throw Error('Source npm digest changed');
  await fs.mkdir(join(destination,'npm'),{mode:0o755});
  for(const [name,expected] of npm.files){
   const value=await sourceFile(join(plan.sourceNpmRoot,name),plan.sourceOwners);if(sha256(value.bytes)!==expected.sha256)throw Error('Source npm digest changed during copy');
   const file=join(destination,'npm',name);await fs.mkdir(dirname(file),{recursive:true,mode:0o755});await fs.writeFile(file,value.bytes,{mode:expected.mode,flag:'wx'});await fs.chmod(file,expected.mode);
  }
  async function directories(path){await fs.chmod(path,0o755);for(const entry of await fs.readdir(path,{withFileTypes:true}))if(entry.isDirectory())await directories(join(path,entry.name));}await directories(join(destination,'npm'));
  const after=await inspectTools({node:plan.sourceNode,npmRoot:plan.sourceNpmRoot,sourceOwners:plan.sourceOwners}),copied=await inspectTools({node:join(destination,'node'),npmRoot:join(destination,'npm')});
  if(JSON.stringify(after)!==JSON.stringify(plan)||copied.nodeSha256!==plan.nodeSha256||copied.npmTreeSha256!==plan.npmTreeSha256)throw Error('Tool source or copied closure digest changed');
  await fs.writeFile(join(destination,'toolchain-provenance.json'),JSON.stringify({format:1,source:plan,createdAt:new Date().toISOString()})+'\n',{mode:0o600,flag:'wx'});
  return {unchanged:false,node:join(destination,'node'),npm:join(destination,'npm/bin/npm-cli.js')};
 }catch(error){await fs.rm(destination,{recursive:true,force:true});throw error;}
}

if(isMain(import.meta.url)){
 try{
  const [command,...args]=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++){const name=args[i];if(!['--node','--npm-root','--source-uid','--config','--destination','--dry-run'].includes(name)||Object.hasOwn(options,name))throw Error();options[name]=name==='--dry-run'?true:args[++i];if(options[name]===undefined)throw Error();}
  let result;
  if(command==='inspect')result=await inspectTools({node:options['--node'],npmRoot:options['--npm-root'],sourceOwners:options['--source-uid']===undefined?[0,process.getuid()]:[0,Number(options['--source-uid'])]});
  else if(command==='prepare')result=await prepareTools({plan:await readJson(options['--config']),destination:resolve(options['--destination']),dryRun:options['--dry-run']??false});
  else throw Error();console.log(JSON.stringify(result));
 }catch{console.error('Tool preparation blocked; inspect and review exact Node/npm source digests, supply a private plan and a new owned destination');process.exitCode=1;}
}
