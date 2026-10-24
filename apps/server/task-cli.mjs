import {readFile,lstat,realpath,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createProjectService} from './project-service.mjs';
import {createTaskRpcServer} from './task-rpc.mjs';

async function trustedAncestors(path,uid){
  for(let part=dirname(path);;part=dirname(part)){
    const info=await lstat(part),stickyRoot=info.uid===0&&(info.mode&0o1000)!==0;
    if(!info.isDirectory()||![0,uid].includes(info.uid)||((info.mode&0o022)!==0&&!stickyRoot))throw Error('Untrusted configuration ancestor');
    if(part===dirname(part))break;
  }
}
export async function readTaskConfiguration({env=process.env,uid=process.getuid?.()}={}){
  if(!Number.isInteger(uid)||uid===0)throw Error('Dedicated non-root task identity required');
  if(Object.keys(env).some(k=>/^(LINX_|MCP_)/u.test(k)||/^VOXCODE_(LOGIN|SESSION|TLS|MCP)/u.test(k)))throw Error('Web and voice credentials must not enter the task service');
  const configPath=env.VOXCODE_PROJECTS_FILE,dataDir=env.VOXCODE_TASK_DATA,socketPath=env.VOXCODE_TASK_SOCKET,command=env.VOXCODE_CODEX_COMMAND??'/usr/local/bin/codex';
  if([configPath,dataDir,socketPath,command].some(x=>typeof x!=='string'||!isAbsolute(x)||resolve(x)!==x))throw Error('Absolute canonical task configuration paths required');
  const info=await lstat(configPath);
  if(!info.isFile()||info.isSymbolicLink()||![0,uid].includes(info.uid)||(info.mode&0o027)!==0||info.size>65536||await realpath(configPath)!==configPath)throw Error('Private operator-owned project configuration required');
  await trustedAncestors(configPath,uid);
  const parsed=JSON.parse(await readFile(configPath,'utf8'));
  const projects=Array.isArray(parsed)?parsed:parsed&&Object.keys(parsed).length===1&&Array.isArray(parsed.projects)?parsed.projects:null;
  if(!projects)throw Error('Invalid project configuration');
  const executable=await realpath(command),tool=await lstat(executable);
  if(!tool.isFile()||![0,uid].includes(tool.uid)||(tool.mode&0o022)!==0)throw Error('Trusted Codex CLI executable required');
  await trustedAncestors(executable,uid);await access(executable,constants.X_OK);
  return {projects,dataDir,socketPath,command};
}

export async function startTaskRuntime({env=process.env,createService=createProjectService,createRpc=createTaskRpcServer}={}){
  const config=await readTaskConfiguration({env});
  const service=await createService(config);
  const rpc=await createRpc({socketPath:config.socketPath,adapter:service});
  let closing=false;
  return {service,rpc,async close(){if(closing)return;closing=true;
    await rpc.close();
    for(const project of await service.listProjects()){
      if(!project.enabled)continue;
      for(const task of await service.listTasks({projectId:project.id}))if(['running','cancelling'].includes(task.status))await service.cancelTask(task.id);
    }
    const status=await service.status();if(status.activeTasks||status.quarantined)throw Error('Task process cleanup is unconfirmed');
  }};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3||process.argv[2]!=='start'){console.error('Usage: node apps/server/task-cli.mjs start');process.exitCode=2;}
  else try{
    const runtime=await startTaskRuntime();console.log('VoxCode task service listening on protected local socket');
    let stopping=false;
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{
      if(stopping)return;stopping=true;
      const deadline=setTimeout(()=>{console.error('Task shutdown deadline reached; reconcile execution ownership');process.exit(1);},15000);
      runtime.close().then(()=>{clearTimeout(deadline);process.exit(0);},()=>{clearTimeout(deadline);console.error('Task shutdown cleanup unconfirmed; reconcile execution ownership');process.exit(1);});
    });
  }catch{console.error('Task startup blocked; verify private configuration, dedicated identity and owned socket');process.exitCode=1;}
}
