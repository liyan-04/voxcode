import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isAbsolute} from 'node:path';

const defaultRun=promisify(execFile);
const fail=code=>{const error=Error(code);error.code=code;throw error;};
const bundle=value=>typeof value==='string'&&/^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+$/.test(value);
const FOCUS_SCRIPT='on run argv\ntell application "System Events"\nset targetProcess to first application process whose bundle identifier is item 1 of argv\nset frontmost of targetProcess to true\nend tell\nend run';

export function createLocalCapabilities({projects=[],applications=[],run=defaultRun}={}){
 const apps=new Set(applications.map(app=>app.id));
 if([...apps].some(value=>!bundle(value)))throw Error('invalid application registry');
 const registered=new Map();
 for(const project of projects){if(typeof project.id!=='string'||!isAbsolute(project.path??'')||!apps.has(project.applicationId)||registered.has(project.id))throw Error('invalid project registry');registered.set(project.id,{...project});}
 return {capabilities:['focus_window','open_project'],async execute(command){
  const project=registered.get(command.projectId);if(!project)fail('project_denied');
  const payload=command.payload??{};
  if(Object.keys(payload).some(key=>!['appId','focus'].includes(key)))fail('payload_denied');
  const applicationId=payload.appId??project.applicationId;
  if(!apps.has(applicationId)||applicationId!==project.applicationId)fail('application_denied');
  if(command.type==='open_project')await run('/usr/bin/open',['-b',applicationId,project.path],{timeout:10000,maxBuffer:16384,env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME}});
  else if(command.type==='focus_window')await run('/usr/bin/osascript',['-e',FOCUS_SCRIPT,applicationId],{timeout:10000,maxBuffer:16384,env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME}});
  else fail('capability_unavailable');
  return {projectId:project.id,taskId:command.taskId,applicationId};
 }};
}
