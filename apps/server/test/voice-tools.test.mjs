import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceTools} from '../voice-tools.mjs';
function fixture({taskId}={}){
 let task=taskId?{id:taskId,projectId:'p',status:'completed',revision:3,sessionId:'original'}:undefined,valid=true;const calls=[],events=[];
 const adapter={getTask:async id=>task&&id===task.id?structuredClone(task):null,getLogs:async()=>({logs:[]}),
 startTask:async input=>{calls.push(['start',input]);task={id:'created',projectId:input.projectId,status:'draft',revision:1,turns:[{requestId:input.requestId}]};return {taskId:task.id};},
 continueTask:async(id,input)=>{calls.push(['continue',id,input]);task.status='draft';task.revision++;task.turns=[{requestId:input.requestId}];},
 confirmTask:async(id,input)=>{calls.push(['confirm',id,input]);task.status='completed';task.revision++;task.output='Real adapter reply';Object.assign(task.turns.at(-1),{status:task.status,revision:task.revision,output:task.output});}};
 const tools=createVoiceTools({adapter,context:{executionTarget:'mac',projectId:'p',...(taskId?{taskId}:{}),contextVersion:1},voiceSessionId:'session',captureId:'capture',authorize:async()=>valid,onResult:result=>events.push(result),waitMs:5,pollMs:1});
 return {tools,calls,events,get task(){return task;},invalidate(){valid=false;}};
}
test('capture execution is bound and replayed once; changed prompt cannot mutate again',async()=>{
 const f=fixture(),execute=f.tools.find(x=>x.name==='codex_execute_task');assert(execute);
 const [a,b]=await Promise.all([execute.invoke({prompt:'change file'}),execute.invoke({prompt:'change file'})]);
 assert.equal(a.taskId,'created');assert.equal(a.status,'completed');assert.equal(a.output,'Real adapter reply');assert.deepEqual(a,b);assert.equal(f.calls.filter(x=>x[0]==='start').length,1);
 await assert.rejects(execute.invoke({prompt:'different'}),{code:'request_conflict'});
 assert.deepEqual(f.tools.map(x=>x.name),['codex_execute_task','codex_task_result']);
});
test('same-task continuation preserves task and revision with no model target fields',async()=>{
 const f=fixture({taskId:'old'}),tool=f.tools.find(x=>x.name==='codex_continue_task');assert(tool);
 await tool.invoke({prompt:'refine'});assert.equal(f.calls[0][0],'continue');assert.equal(f.calls[0][1],'old');assert.equal(f.calls[0][2].revision,3);assert.equal(f.task.sessionId,'original');
 for(const args of [{prompt:'x',taskId:'foreign'},{prompt:'x',projectId:'foreign'},{prompt:'x',executionTarget:'server'},{prompt:'x',requestId:'chosen'}])await assert.rejects(tool.invoke(args),{code:'invalid_argument'});
 assert.equal(f.calls.filter(x=>x[0]==='continue').length,1);
});
test('closed or revoked capture cannot execute, query or replay',async()=>{
 const f=fixture();f.invalidate();for(const tool of f.tools)await assert.rejects(tool.invoke(tool.name==='codex_execute_task'?{prompt:'x'}:{}),{code:'voice_context_invalid'});assert.deepEqual(f.calls,[]);
});
test('query is confined to frozen task and emits actual output',async()=>{
 const f=fixture({taskId:'old'}),query=f.tools.find(x=>x.name==='codex_task_result');
 const result=await query.invoke({});assert.equal(result.taskId,'old');assert.equal(result.executionTarget,'mac');assert.equal(f.events.at(-1).taskId,'old');await assert.rejects(query.invoke({taskId:'foreign'}),{code:'invalid_argument'});
 f.task.projectId='foreign';await assert.rejects(query.invoke({}),{code:'voice_context_invalid'});
});
test('unknown mutation is not replayed and retains the identity for result reconciliation',async()=>{
 const f=fixture(),tool=f.tools[0];let attempts=0; // Replace the actual adapter through a dedicated fixture below.
 const adapter={startTask:async()=>{attempts++;throw Object.assign(Error('private details'),{code:'outcome_unknown',operationId:'op'});}};
 const tools=createVoiceTools({adapter,context:{executionTarget:'mac',projectId:'p',contextVersion:1},voiceSessionId:'s',captureId:'c',authorize:async()=>true,waitMs:1,pollMs:1});
 const first=await tools[0].invoke({prompt:'x'}),second=await tools[0].invoke({prompt:'x'});assert.equal(first.status,'outcome_unknown');assert.equal(first.operationId,'op');assert.equal(first.requestId,second.requestId);assert.equal(attempts,1);assert(!JSON.stringify(first).includes('private'));
});
test('revocation during submission intermediate read cannot dispatch execution',async()=>{
 let active=true,confirmed=0,reads=0;
 const adapter={startTask:async()=>({taskId:'created'}),getTask:async()=>{if(++reads===1)active=false;return {id:'created',projectId:'p',revision:1};},confirmTask:async()=>{confirmed++;}};
 const tools=createVoiceTools({adapter,context:{executionTarget:'mac',projectId:'p',contextVersion:1},voiceSessionId:'s',captureId:'c',authorize:async()=>active,waitMs:1,pollMs:1});
 await assert.rejects(tools[0].invoke({prompt:'x'}),{code:'voice_context_invalid'});assert.equal(confirmed,0);
});
test('lost continuation response cannot present a previous completed turn as its result',async()=>{
 const old={id:'old',projectId:'p',status:'completed',revision:3,output:'Previous result',turns:[{requestId:'previous',status:'completed',output:'Previous result'}]};
 const tools=createVoiceTools({adapter:{getTask:async()=>old,continueTask:async()=>{throw Object.assign(Error('lost'),{code:'outcome_unknown',operationId:'op'});}},context:{executionTarget:'mac',projectId:'p',taskId:'old'},voiceSessionId:'s',captureId:'c',authorize:async()=>true,waitMs:1,pollMs:1});
 await tools[0].invoke({prompt:'refine'});const result=await tools[1].invoke({});assert.equal(result.status,'outcome_unknown');assert.equal(result.operationId,'op');assert.equal(result.output,undefined);
});
test('Chinese and escaped output remains byte bounded with explicit truncation',async()=>{
 for(const output of ['中'.repeat(9000),'\u0000'.repeat(9000)]){
  const task={id:'t',projectId:'p',status:'completed',revision:3,output};
  const tools=createVoiceTools({adapter:{getTask:async()=>task},context:{executionTarget:'mac',projectId:'p',taskId:'t'},voiceSessionId:'s',captureId:'c',authorize:async()=>true,waitMs:1,pollMs:1});
  const result=await tools[1].invoke({});assert(Buffer.byteLength(JSON.stringify(result))<24000);assert.equal(result.outputTruncated,true);
 }
});
