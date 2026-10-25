import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,realpath,writeFile} from 'node:fs/promises';
import {basename,dirname,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createBundle,sha256} from './package.mjs';

const runFile=promisify(execFile);
const runDefault=(command,args,options={})=>runFile(command,args,{timeout:60000,maxBuffer:256*1024,...options});
const usage='Usage: node scripts/control/upload-master.mjs --root CHECKOUT --output NEW_BUNDLE [--qup QUP_BIN]';

async function packageArtifact({root,revision,output}){
  const archive=resolve(output);
  const bytes=await createBundle({root,revision});
  await writeFile(archive,bytes,{flag:'wx',mode:0o600});
  return {archive,revision,sha256:sha256(bytes)};
}

export async function uploadArtifact({archive,qup,run=runFile}){
  const path=resolve(archive);
  const executable=qup.includes('/')&&!isAbsolute(qup)?resolve(qup):qup;
  const {stdout}=await run(executable,[basename(path)],{cwd:dirname(path),timeout:120000,maxBuffer:256*1024});
  const match=stdout.match(/download url (https?:\/\/\S+)/u);
  if(!match)throw Error('QUP upload did not return a download URL');
  return match[1];
}

async function verifyArtifact({archive,digest}){
  const actual=sha256(await readFile(archive));
  if(actual!==digest)throw Error('Archive changed before upload');
}

export async function publishMaster({root,output,qup='qup-mac.2026',run=runDefault,packageBundle=packageArtifact,verify=verifyArtifact,upload=uploadArtifact}={}){
  if(typeof root!=='string'||typeof output!=='string'||typeof qup!=='string'||!qup)throw Error('Checkout, output and QUP paths are required');
  root=await realpath(root);
  await run('git',['-C',root,'fetch','--no-tags','origin','master']);
  const revision=(await run('git',['-C',root,'rev-parse','--verify','FETCH_HEAD^{commit}'])).stdout.trim();
  if(!/^[a-f0-9]{40}$/u.test(revision))throw Error('A full fetched master revision is required');
  const artifact=await packageBundle({root,revision,output:resolve(output)});
  if(artifact?.revision!==revision)throw Error('Packager revision does not match fetched master');
  await verify({archive:artifact.archive,digest:artifact.sha256});
  const url=await upload({archive:artifact.archive,qup});
  return {...artifact,sourceRef:'origin/master',url};
}

function parseArgs(args){
  const options={};
  for(let i=0;i<args.length;i++){
    const name=args[i];
    if(!['--root','--output','--qup'].includes(name)||options[name]!==undefined||!args[i+1]||args[i+1].startsWith('--'))throw Error(usage);
    options[name]=args[++i];
  }
  if(!options['--root']||!options['--output'])throw Error(usage);
  return options;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.slice(2).length===1&&['--help','-h'].includes(process.argv[2])){console.log(usage);process.exit(0);}
    const options=parseArgs(process.argv.slice(2));
    const result=await publishMaster({root:options['--root'],output:options['--output'],qup:options['--qup']});
    console.log(JSON.stringify(result));
  }catch(error){
    console.error(error.message===usage||error.message.startsWith('Usage:')?error.message:'Master package upload failed; no remote service was changed.');
    process.exitCode=1;
  }
}
