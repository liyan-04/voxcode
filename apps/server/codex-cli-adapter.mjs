import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {realpathSync} from 'node:fs';
import {createTaskStore} from './task-store.mjs';

export function createCodexCliAdapter({command='codex',projectRoot,dataDir,spawnImpl=spawn,timeoutMs=1800000,killGraceMs=1000,signalGroup=(pid,signal)=>process.kill(-pid,signal)}={}) {
  if(typeof projectRoot!=='string') throw new Error('projectRoot required');
  const root=realpathSync(projectRoot),store=createTaskStore(resolve(dataDir??'.voxcode','tasks.json')),running=new Map();
  const ready=(async()=>{for(const task of await store.list())if(['running','cancelling'].includes(task.status)){task.status='interrupted';task.error='Previous process ownership is unknown; task was not restarted';await store.put(task);}})();
  const get=async id=>{await ready;const task=await store.get(id);if(!task)throw new Error('task not found');return task;};
  async function startTask({prompt,title,projectRoot:requested='.'}={}) {
    await ready;
    if(typeof prompt!=='string'||!prompt.trim()||prompt.length>20000)throw new Error('prompt required');
    if(realpathSync(resolve(root,requested))!==root)throw new Error('project must equal configured root');
    const id=randomUUID();await store.put({id,title:typeof title==='string'?title.slice(0,200):'Codex task',prompt,status:'draft',createdAt:new Date().toISOString(),output:'',logs:[],checks:null,diff:null});return {taskId:id};
  }
  async function confirmTask(id) {
    const task=await get(id);if(task.status!=='draft')throw new Error('task is not a draft');
    if(running.size)throw new Error('Codex execution slot busy');
    // Reserve before awaiting persistence so concurrent confirmations cannot both spawn.
    const entry={task,child:null,stopping:false};running.set(id,entry);task.status='running';
    await store.put(task);
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^(VOXCODE_|LINX_|MCP_)/.test(key)));
    let child;try{child=spawnImpl(command,['exec','--json','--sandbox','workspace-write','-'],{cwd:root,env,detached:true,stdio:['pipe','pipe','pipe']});}catch{running.delete(id);task.status='failed';task.error='Codex CLI launch failed';await store.put(task);return task;}
    entry.child=child;let buffer='',finished=false,timer,killTimer;
    function signal(signal){try{if(child.pid)signalGroup(child.pid,signal);else child.kill(signal);}catch(error){if(error.code!=='ESRCH')task.error='Unable to signal task process group';}}
    async function stop(){if(entry.stopping)return;entry.stopping=true;task.status='cancelling';await store.put(task);signal('SIGTERM');killTimer=setTimeout(()=>signal('SIGKILL'),killGraceMs);killTimer.unref?.();}
    entry.stop=stop;
    function event(line){let e;try{e=JSON.parse(line);}catch{return;}if(e.type==='thread.started'&&typeof e.thread_id==='string')task.sessionId=e.thread_id;if(e.type==='item.completed'&&e.item?.type==='agent_message'&&typeof e.item.text==='string')task.output=e.item.text.slice(-20000);task.logs.push({type:String(e.type??'unknown').slice(0,80)});task.logs=task.logs.slice(-200);}
    child.stdout?.on('data',data=>{buffer+=data.toString();if(buffer.length>65536){buffer='';void stop();return;}let i;while((i=buffer.indexOf('\n'))>=0){event(buffer.slice(0,i));buffer=buffer.slice(i+1);}});
    child.stderr?.on('data',()=>{task.error='Codex CLI reported diagnostics';});
    async function finish(code,signalName,error){if(finished)return;finished=true;clearTimeout(timer);clearTimeout(killTimer);if(buffer)event(buffer);task.status=entry.stopping?'cancelled':error||code!==0?'failed':'completed';task.exitCode=code;delete task.prompt;await store.put(task);running.delete(id);entry.resolve?.();}
    entry.closed=new Promise(r=>entry.resolve=r);
    child.once('error',()=>{void finish(null,null,true);});child.once('close',(code,s)=>{void finish(code,s,false);});
    child.stdin?.on('error',()=>{});child.stdin?.end(task.prompt);timer=setTimeout(()=>{void stop();},timeoutMs);timer.unref?.();return task;
  }
  return {startTask,confirmTask,getTask:get,async listTasks(){await ready;return store.list();},async status(){await ready;return {available:true,activeTasks:running.size};},async cancelTask(id){const task=await get(id);const entry=running.get(id);if(entry){await entry.stop();await entry.closed;return get(id);}if(task.status==='draft'){task.status='cancelled';delete task.prompt;await store.put(task);}return task;},async getLogs(id){const t=await get(id);return {logs:t.logs};},async getDiff(id){await get(id);return {collected:false,reason:'Diff evidence has not been collected'};},async getChecks(id){await get(id);return {collected:false,reason:'Check evidence has not been collected'};}};
}
