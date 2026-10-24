import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {serverPreflight,checkedServerConfiguration} from './runtime-config.mjs';
import {startServerRuntime} from './runtime.mjs';

export async function runServerCli({args=process.argv.slice(2),env=process.env,preflight=serverPreflight,start=startServerRuntime,log=console.log,error=console.error}={}){
  if(args.length!==1||!['preflight','start'].includes(args[0])){error('Usage: node server-cli.mjs preflight|start (private environment files)');return {exitCode:2};}
  const report=await preflight({env});
  if(args[0]==='preflight'){log(JSON.stringify(report,null,2));return {exitCode:report.ok?0:1};}
  if(!report.ok){error('Server startup blocked; verify private configuration, dedicated identity and owned socket');return {exitCode:1};}
  try{const runtime=await start({config:checkedServerConfiguration(report)});log('VoxCode HTTPS listener started; voice and MCP mutations remain disabled');return {exitCode:0,runtime};}
  catch{error('Server startup failed; inspect redacted preflight and owned listeners');return {exitCode:1};}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await runServerCli();process.exitCode=result.exitCode;
  if(result.runtime){let closing=false;for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{if(closing)return;closing=true;const timeout=setTimeout(()=>{console.error('Web shutdown deadline reached; task service remains separately owned');process.exit(1);},15000);result.runtime.close().then(()=>{clearTimeout(timeout);process.exit(0);},()=>{clearTimeout(timeout);console.error('Web shutdown failed; task service remains separately owned');process.exit(1);});});}
}
