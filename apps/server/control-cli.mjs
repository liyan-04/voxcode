import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {loadControlConfiguration} from './control-config.mjs';
import {startControlRuntime} from './control-runtime.mjs';

export async function runControlCli({args=process.argv.slice(2),env=process.env,load=loadControlConfiguration,start=startControlRuntime,log=console.log,error=console.error}={}){
 if(args.length!==1||!['start','preflight'].includes(args[0])){error('Usage: node apps/server/control-cli.mjs start|preflight');return {exitCode:2};}
 try{
  const config=await load({path:env.VOXCODE_CONTROL_CONFIG});
  if(args[0]==='preflight'){log(JSON.stringify({ok:true,executionHost:'mac',revision:config.revision,mcpConfigured:Boolean(config.mcpEndpoint)}));return {exitCode:0};}
  const runtime=await start({config});log('VoxCode HTTPS control server started; execution host: Mac');return {exitCode:0,runtime};
 }catch{error('Control startup blocked; verify private configuration, TLS and owned listener');return {exitCode:1};}
}
function isMain(){
 if(!process.argv[1])return false;
 try{return realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url));}catch{return false;}
}
if(isMain()){
 const result=await runControlCli();process.exitCode=result.exitCode;
 if(result.runtime){let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{
  if(stopping)return;stopping=true;
  const timer=setTimeout(()=>{console.error('Control shutdown deadline reached; reconcile Mac operations');process.exit(1);},15000);
  result.runtime.close().then(()=>{clearTimeout(timer);process.exit(0);},()=>{clearTimeout(timer);console.error('Control cleanup unconfirmed');process.exit(1);});
 });}
}
