import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createBundle,sha256} from './package.mjs';
import {createLinuxController} from './linux.mjs';
import {createMacController} from './mac.mjs';
import {commandRunner,isMain} from './common.mjs';

const checkout=fileURLToPath(new URL('../../',import.meta.url));
const commands=['install','start','stop','restart','deploy','status','logs','rollback','adopt'];
export async function runEntry(args,{platform=process.platform,uid=process.getuid?.(),env=process.env,root=checkout,run=commandRunner,bundle=createBundle,controller}={}){
 const [action,...rest]=args;
 if(!commands.includes(action))throw Error('Unknown action');
 if(rest.length===1&&['--help','-h'].includes(rest[0]))return {help:`Usage: ./${action}.sh [--config /absolute/private/deployment.json] [--dry-run]\nSet VOXCODE_DEPLOY_CONFIG once to reuse the private configuration.\nRun on the service host: Linux as root, Mac as the owning GUI user.\ninstall registers without starting; deploy fetches origin/master and updates an owned installation.\nSee docs/deployment/control-lifecycle.md for first setup and adoption.`};
 let config=env.VOXCODE_DEPLOY_CONFIG??(platform==='darwin'?join(homedir(),'Library/Application Support/VoxCodeControl/private/deployment.json'):'/etc/voxcode-control/deployment.json'),dryRun=false;
 const seen=new Set();
 for(let i=0;i<rest.length;i++){
  const option=rest[i];if(seen.has(option))throw Error('Duplicate option');seen.add(option);
  if(option==='--dry-run')dryRun=true;
  else if(option==='--config'&&rest[i+1]&&!rest[i+1].startsWith('--'))config=rest[++i];
  else throw Error('Unknown option or missing value');
 }
 if(!['linux','darwin'].includes(platform)||(platform==='linux'?uid!==0:!Number.isInteger(uid)||uid<=0))throw Error('Unsupported platform or service operator');
 controller??=platform==='linux'?createLinuxController():createMacController();
 const options={command:action,config,dryRun};
 if(['install','deploy','adopt'].includes(action)){
  // Read committed blobs directly: never checkout/reset/stash the caller's tree.
  const gitOptions={timeout:60000,maxBuffer:65536,env:{PATH:env.PATH??'/usr/bin:/bin',HOME:env.HOME}};
  if(action==='deploy')await run('git',['-C',root,'fetch','--no-tags','origin','master'],gitOptions);
  const revision=(await run('git',['-C',root,'rev-parse','--verify',action==='deploy'?'FETCH_HEAD^{commit}':'HEAD^{commit}'],gitOptions)).stdout.trim();
  const bytes=await bundle({root,revision});
  options.bundle={bytes,sha256:sha256(bytes)};
  if(action!=='adopt')options.activate=action==='deploy';
  if(action==='deploy')options.command='update';
 }
 return controller.execute(options);
}
if(isMain(import.meta.url)){
 try{const result=await runEntry(process.argv.slice(2));console.log(result.help??result.logs??JSON.stringify(result));}
 catch{console.error('VoxCode operation failed. Check configuration, service ownership, Git origin/master access and pending activation; private state was not discarded.');process.exitCode=1;}
}
