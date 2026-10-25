import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import * as files from 'node:fs/promises';
import {isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createMacAgent} from './agent.mjs';
import {createTaskCapability} from './task-capability.mjs';
import {readPrivateJson} from './private-files.mjs';

export function parseArguments(args){
 const parsed={};
 for(let index=0;index<args.length;index+=2){const name=args[index];if(!['--config','--task-socket'].includes(name)||parsed[name]!==undefined||!args[index+1])throw Error('Unknown or duplicate argument');parsed[name]=args[index+1];}
 return parsed;
}

export async function startAgent({args=process.argv.slice(2),env=process.env,run=promisify(execFile),WebSocketImpl,createAgent=createMacAgent,fileSystem=files}={}){
 if(env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error('TLS verification is required');
 const options=parseArguments(args),configPath=options['--config'],socketPath=options['--task-socket'];
 if(!isAbsolute(configPath??'')||!isAbsolute(socketPath??''))throw Error('Absolute --config and --task-socket required');
 const config=await readPrivateJson(configPath,{fs:fileSystem});
 if(!config||Object.keys(config).some(key=>!['endpoint','deviceId','stateFile','keychainService','keychainAccount'].includes(key)))throw Error('Invalid agent configuration');
 const url=new URL(config.endpoint);
 if(url.protocol!=='wss:'||url.username||url.password||url.hash)throw Error('Verified WSS required');
 if(![config.keychainService,config.keychainAccount].every(value=>typeof value==='string'&&/^[A-Za-z0-9._-]{1,128}$/.test(value)))throw Error('Invalid Keychain identity');
 const secret=await run('/usr/bin/security',['find-generic-password','-s',config.keychainService,'-a',config.keychainAccount,'-w'],{timeout:10000,maxBuffer:8192,env:{PATH:'/usr/bin:/bin',HOME:env.HOME??process.env.HOME}});
 const token=secret.stdout.replace(/\r?\n$/,'');
 if(!WebSocketImpl)({default:WebSocketImpl}=await import('ws'));
 const task=createTaskCapability({socketPath});
 const agent=await createAgent({endpoint:url.href,deviceId:config.deviceId,token,stateFile:config.stateFile,capabilities:task.capabilities,onCommand:command=>task.execute(command),WebSocketImpl,onStatus:status=>{if(status==='state_error')console.error('Mac agent state error; operator reconciliation required');}});
 agent.start();return agent;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const agent=await startAgent();console.log('VoxCode Mac agent started');for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{agent.close().then(()=>process.exit(0));});}
 catch{console.error('Mac agent startup blocked; verify private config, Keychain item, task socket and TLS');process.exitCode=1;}
}
