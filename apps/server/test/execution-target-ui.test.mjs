import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const response=(body,status=200)=>({ok:status<400,status,json:async()=>structuredClone(body)});
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const inventory=()=>response({targets:[{id:'mac',kind:'remote',name:'Mac Codex',configured:true,online:false,available:false,observedAt:'2026-10-25T00:00:00.000Z'},{id:'server',kind:'local',name:'Server Codex',configured:false,online:false,available:false,observedAt:null}]});

async function pageFixture({discover,projects=()=>response({code:'offline'},503),login=()=>response({ok:true}),request,storage=new Map(),preferences=new Map()}={}){
 class Node{
  constructor(){this.value='';this.textContent='';this.hidden=false;this.children=[];this.attributes=new Map();this.classList={add(){},remove(){},toggle(){}};this.style={};this.scrollLeft=0;this.scrollWidth=400;this.clientWidth=400;}
  append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}setAttribute(key,value){this.attributes.set(key,String(value));}addEventListener(){}focus(){}scrollTo({left}){this.scrollLeft=left;}
 }
 const nodes=new Map(),reads=[],writes=[],get=selector=>{if(!nodes.has(selector))nodes.set(selector,new Node());return nodes.get(selector);};get('#login-overlay').hidden=true;let sequence=0,authenticated=false;
 const context=vm.createContext({console,structuredClone,Date,Math,performance,URL,URLSearchParams,setTimeout,clearTimeout,setInterval(){},clearInterval(){},crypto:{randomUUID:()=> 'fixture-request-'+ ++sequence},sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},localStorage:{getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value))},
  document:{querySelector:get,querySelectorAll:()=>[],createElement:()=>new Node(),createElementNS:()=>new Node(),addEventListener(){},body:new Node(),visibilityState:'visible'},window:{addEventListener(){},innerWidth:390,innerHeight:844},
  fetch:async(path,options={})=>{
   const url=new URL(path,'http://fixture.invalid');if(options.method==='POST')writes.push({path,payload:JSON.parse(options.body)});else reads.push(path);
   if(request){const result=await request(url,options);if(result)return result;}
   if(options.method==='POST'){const result=login();authenticated=(await result).ok;return result;}
   if(path==='/api/health')return response({executionHost:'mac',deviceOnline:false,simulation:false,voiceAvailable:false});
   if(path==='/api/execution-targets')return discover?discover():authenticated?inventory():response({},401);
   if(path==='/api/devices')return response({code:'offline'},503);
   if(url.pathname==='/api/projects')return projects(path);
   if(path.startsWith('/api/tasks?'))return response({tasks:[]});
   return response({},404);
  }});
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');vm.runInContext(html.split('<script>')[1].split('</script>')[0],context);
 const run=source=>vm.runInContext(source,context);await flush();return {run,get,reads,writes,storage,preferences,login:()=>{get('#login-button').onclick();get('#password').value='fixture-password';return get('#login-form').onsubmit({preventDefault(){}});}};
}

test('login succeeds immediately while Mac project discovery is still pending',async()=>{
 const gate=deferred(),f=await pageFixture({projects:()=>gate.promise});const request=f.login();await flush();
 assert.equal(f.run('state.authenticated'),true);assert.equal(f.get('#login-overlay').hidden,true);assert.equal(f.get('#login-button').textContent,'已登录');assert.equal(f.get('#login-submit').disabled,false);assert.equal(f.get('#password').value,'');
 gate.resolve(response({code:'offline'},503));await request;await flush();assert.equal(f.run('state.authenticated'),true);assert.equal(f.get('#login-error').textContent,'');
});
test('project failure after valid login is a workspace error and leaves authentication successful',async()=>{
 const f=await pageFixture();await f.login();await flush();assert.equal(f.run('state.authenticated'),true);assert.equal(f.get('#login-overlay').hidden,true);assert.equal(f.get('#login-error').textContent,'');assert.match(f.get('#feedback').textContent,/工作空间/);assert.equal(f.get('#login-button').textContent,'已登录');
});
test('existing session is discovered through inventory even when Mac and project requests fail',async()=>{
 const f=await pageFixture({discover:inventory});await flush();assert.equal(f.run('state.authenticated'),true);assert.equal(f.get('#login-button').textContent,'已登录');assert.ok(f.reads.includes('/api/execution-targets'));assert.equal(f.reads.filter(path=>path.startsWith('/api/')&&path!=='/api/health')[0],'/api/execution-targets');assert.equal(f.writes.length,0);
});
test('an unauthenticated inventory never falls back to successful project discovery as authentication',async()=>{
 const f=await pageFixture({projects:()=>response({projects:[]})});await flush();assert.equal(f.run('state.authenticated'),false);assert.ok(f.reads.includes('/api/execution-targets'));assert.equal(f.reads.includes('/api/projects'),false);assert.equal(f.reads.includes('/api/devices'),false);
});
test('a delayed old session rejection cannot overwrite a newer successful login',async()=>{
 const gate=deferred();let requests=0;const f=await pageFixture({discover:()=>++requests===1?gate.promise:inventory()});await f.login();gate.resolve(response({},401));await flush();assert.equal(f.run('state.authenticated'),true);assert.equal(f.get('#login-overlay').hidden,true);assert.equal(f.get('#login-button').textContent,'已登录');
});
test('invalid credentials keep the login modal and report a password error',async()=>{
 const f=await pageFixture({login:()=>response({error:'invalid credentials'},401)});await f.login();assert.equal(f.run('state.authenticated'),false);assert.equal(f.get('#login-overlay').hidden,false);assert.equal(f.get('#password').value,'fixture-password');assert.match(f.get('#login-error').textContent,/密码/);assert.equal(f.get('#login-submit').disabled,false);
});

const targets=()=>[{id:'mac',kind:'remote',name:'Mac Codex',configured:true,online:true,available:true,observedAt:'2026-10-25T00:00:00.000Z'},{id:'server',kind:'local',name:'Server Codex',configured:true,online:true,available:true,observedAt:'2026-10-25T00:00:00.000Z'}];
const task=target=>({id:'one',projectId:'same',title:target+' task',status:'completed',revision:3,metadataRevision:1,sessionId:'12345678-1234-4234-8234-123456789abc',output:target+' output',turns:[{prompt:target+' prompt',output:target+' output'}]});
async function targetFixture(options={}){
 const f=await pageFixture({discover:()=>response({targets:targets()}),projects:()=>response({projects:[{id:'same',name:'Same project',enabled:true}]}),...options,request:async(url,request)=>{
  const overridden=await options.request?.(url,request);if(overridden)return overridden;
  const target=url.searchParams.get('executionTarget')||'mac';
  if(url.pathname==='/api/tasks')return response({tasks:[task(target)]});
  if(url.pathname.startsWith('/api/tasks/'))return response(task(target));
 }});await flush();await flush();return f;
}
const selectTask=f=>f.run("openTarget({projectId:'same',selected:'one'})");
const setInput=(f,text)=>{f.get('#composer-input').value=text;f.run('saveDraft()');};
const submit=f=>f.get('#composer-form').onsubmit({preventDefault(){}});

test('target switching isolates identical IDs, drafts, selected tabs and project checkbox preferences',async()=>{
 const f=await targetFixture();selectTask(f);await flush();setInput(f,'Mac private input');f.run("setTabProject('same',false)");await f.run("switchExecutionTarget('server')");selectTask(f);await flush();assert.equal(f.run('state.snapshot.output'),'server output');assert.equal(f.get('#composer-input').value,'');assert.equal(f.run("state.tabProjects.has('same')"),true);
 setInput(f,'Server private input');await f.run("switchExecutionTarget('mac')");assert.equal(f.run('state.selected'),'one');assert.equal(f.get('#composer-input').value,'Mac private input');assert.equal(f.run("state.tabProjects.has('same')"),false);assert.equal(f.writes.length,0);
 const restored=await targetFixture({storage:f.storage,preferences:f.preferences});await flush();assert.equal(restored.run('state.executionTarget'),'mac');assert.equal(restored.run('state.selected'),'one');assert.equal(restored.get('#composer-input').value,'Mac private input');assert.equal(restored.run("state.tabProjects.has('same')"),false);
});
test('protected requests select exactly one frozen execution target including results and metadata actions',async()=>{
 const f=await targetFixture();await f.run("switchExecutionTarget('server')");selectTask(f);await flush();setInput(f,'server instruction');await submit(f);await f.run("taskAction(state.snapshot,'archive',{archived:true})");await f.run("api('/api/tasks/one/results/result?projectId=same')");
 const protectedPaths=[...f.reads,...f.writes.map(item=>item.path)].filter(path=>/^\/api\/(projects|tasks)([/?]|$)/u.test(path));assert(protectedPaths.length>3);for(const path of protectedPaths){const params=new URL(path,'http://fixture.invalid').searchParams;assert.equal(params.getAll('executionTarget').length,1);assert(['mac','server'].includes(params.get('executionTarget')));}for(const call of f.writes)assert.equal(new URL(call.path,'http://fixture.invalid').searchParams.get('executionTarget'),'server');
});
test('late projects and task details from an old target cannot replace a target with identical IDs',async()=>{
 const gate=deferred();let hold=false;const f=await targetFixture({request:async(url,options)=>{if(hold&&url.searchParams.get('executionTarget')==='mac'&&url.pathname==='/api/projects')return gate.promise;}});hold=true;const old=f.run('loadProjects()');await f.run("switchExecutionTarget('server')");selectTask(f);await flush();gate.resolve(response({projects:[{id:'foreign',name:'Old Mac',enabled:true}]}));await old;assert.equal(f.run('state.projects[0].id'),'same');assert.equal(f.run('state.snapshot.output'),'server output');
 const detail=deferred();const g=await targetFixture({request:async url=>url.pathname==='/api/tasks/one'&&url.searchParams.get('executionTarget')==='mac'?detail.promise:undefined});selectTask(g);await g.run("switchExecutionTarget('server')");selectTask(g);await flush();detail.resolve(response(task('mac')));await flush();assert.equal(g.run('state.snapshot.output'),'server output');
});
test('late workspace failures from an old target cannot change current feedback',async()=>{
 for(const operation of ['refresh','loadProjects']){
  const gate=deferred();let hold=false;const path=operation==='refresh'?'/api/tasks':'/api/projects',f=await targetFixture({request:async url=>hold&&url.searchParams.get('executionTarget')==='mac'&&url.pathname===path?gate.promise:undefined});hold=true;
  const old=f.run(operation+'().catch(error=>feedback(error.message,true))');await f.run("switchExecutionTarget('server')");const before=f.get('#feedback').textContent;gate.resolve(response({error:'old target failure'},503));await old;assert.equal(f.get('#feedback').textContent,before);assert.equal(f.run('state.executionTarget'),'server');
 }
});
test('late mutation and metadata responses update only their original target and retain current input',async()=>{
 for(const action of ['send','archive']){
  const gate=deferred(),f=await targetFixture({request:async(url,options)=>options.method==='POST'&&url.searchParams.get('executionTarget')==='mac'?gate.promise:undefined});selectTask(f);await flush();setInput(f,'Mac original');const old=action==='send'?submit(f):f.run("taskAction(state.snapshot,'archive',{archived:true})");await f.run("switchExecutionTarget('server')");selectTask(f);await flush();setInput(f,'Server edit');assert.equal(f.run('state.loading'),false);const before=f.get('#feedback').textContent;gate.resolve(response({...task('mac'),revision:6,archived:action==='archive'}));await old;await flush();assert.equal(f.run('state.executionTarget'),'server');assert.equal(f.run('state.snapshot.output'),'server output');assert.equal(f.get('#composer-input').value,'Server edit');assert.equal(f.get('#feedback').textContent,before);assert.equal(new URL(f.writes[0].path,'http://fixture.invalid').searchParams.get('executionTarget'),'mac');
 }
});
test('typed metadata revision rejection allows a new explicit action with the refreshed revision and request identity',async()=>{
 for(const target of ['mac','server']){
  let current=task(target),commits=0;const f=await targetFixture({request:async(url,options)=>{
   if(url.searchParams.get('executionTarget')!==target)return;
   if(options.method==='POST'&&url.pathname.endsWith('/archive')){const payload=JSON.parse(options.body);if(payload.metadataRevision!==current.metadataRevision)return response({code:'revision_conflict'},409);commits++;current={...current,archived:payload.archived,metadataRevision:current.metadataRevision+1};return response(current);}
   if(url.pathname==='/api/tasks')return response({tasks:[current]});if(url.pathname==='/api/tasks/one')return response(current);
  }});if(target==='server')await f.run("switchExecutionTarget('server')");selectTask(f);await flush();current={...current,metadataRevision:2};await f.run("taskAction(state.snapshot,'archive',{archived:true})");await flush();await flush();
  assert.equal(f.run('state.snapshot.metadataRevision'),2);assert.equal(f.writes.length,1);assert.equal(commits,0);assert.deepEqual(JSON.parse(f.storage.get('voxcode:pending:'+target)),[]);
  await f.run("taskAction(state.snapshot,'archive',{archived:true})");assert.equal(commits,1);assert.equal(f.writes.length,2);assert.equal(f.writes[0].payload.metadataRevision,1);assert.equal(f.writes[1].payload.metadataRevision,2);assert.notEqual(f.writes[1].payload.requestId,f.writes[0].payload.requestId);
 }
});
test('ambiguous metadata failures and identity conflicts retain the original payload after a newer snapshot',async()=>{
 for(const failure of ['network','outcome_unknown','request_conflict','untyped_409']){
  let current=task('mac'),attempts=0;const f=await targetFixture({request:async(url,options)=>{
   if(options.method==='POST'&&url.pathname.endsWith('/archive')){current={...current,metadataRevision:2};if(++attempts>1)return response(current);if(failure==='network')throw Error('lost response');return response(failure==='untyped_409'?{}:{code:failure},409);}
   if(url.pathname==='/api/tasks')return response({tasks:[current]});if(url.pathname==='/api/tasks/one')return response(current);
  }});selectTask(f);await flush();await f.run("taskAction(state.snapshot,'archive',{archived:true})");await flush();await flush();assert.equal(f.run('state.snapshot.metadataRevision'),2);assert.equal(f.writes.length,1);
  await f.run("taskAction(state.snapshot,'archive',{archived:true})");assert.equal(f.writes.length,2);assert.deepEqual(f.writes[1],f.writes[0],failure);
 }
});
test('metadata request identity survives storage cleanup failure after rejection or success',async()=>{
 for(const outcome of ['revision_conflict','succeeded']){
  let failCleanup=false,current=task('mac'),attempts=0;class Storage extends Map{set(key,value){if(failCleanup&&key==='voxcode:pending:mac'&&JSON.parse(value).length===0)throw Error('storage unavailable');return super.set(key,value);}}
  const storage=new Storage(),f=await targetFixture({storage,request:async(url,options)=>{
   if(options.method==='POST'&&url.pathname.endsWith('/archive')){current={...current,metadataRevision:2};if(++attempts===1){failCleanup=true;return outcome==='revision_conflict'?response({code:outcome},409):response(current);}failCleanup=false;return response(current);}
   if(url.pathname==='/api/tasks')return response({tasks:[current]});if(url.pathname==='/api/tasks/one')return response(current);
  }});selectTask(f);await flush();await f.run("taskAction(state.snapshot,'archive',{archived:true})");await flush();await flush();assert.equal(f.writes.length,1);assert.equal(JSON.parse(storage.get('voxcode:pending:mac')).length,1);
  await f.run("taskAction(state.snapshot,'archive',{archived:true})");assert.equal(f.writes.length,2);assert.deepEqual(f.writes[1],f.writes[0],outcome);
 }
});
test('an unresolved committed request survives reload and target changes with its exact original payload',async()=>{
 const receipts=new Map();let current=task('mac'),lost=false;const request=async(url,options)=>{
  if(url.pathname==='/api/tasks'&&options.method!=='POST')return response({tasks:[url.searchParams.get('executionTarget')==='mac'?current:task('server')]});
  if(url.pathname==='/api/tasks/one'&&url.searchParams.get('executionTarget')==='mac')return response(current);
  if(options.method==='POST'&&url.pathname.endsWith('/continue')){const payload=JSON.parse(options.body);if(receipts.has(payload.requestId))return response(current);receipts.set(payload.requestId,true);current={...current,revision:6,turns:[...current.turns,{prompt:payload.prompt,output:'done'}]};if(!lost){lost=true;throw Error('lost response after commit');}return response(current);}
 };
 const first=await targetFixture({request});selectTask(first);await flush();setInput(first,'execute once');await submit(first);assert.equal(current.turns.length,2);
 const second=await targetFixture({request,storage:first.storage,preferences:first.preferences});await flush();assert.equal(second.run('state.selected'),'one');assert.equal(second.get('#submission-recovery').hidden,false);setInput(second,'later edited input');await submit(second);assert.equal(second.writes.length,0);await second.get('#retry-submission').onclick();assert.deepEqual(second.writes[0],first.writes[0]);assert.equal(current.turns.length,2);assert.equal(second.get('#composer-input').value,'later edited input');await second.run("switchExecutionTarget('server')");assert.equal(second.get('#submission-recovery').hidden,true);await second.run("switchExecutionTarget('mac')");assert.equal(second.get('#composer-input').value,'later edited input');
});
test('legacy unknown operations retain their original ID on Mac without appearing on Server',async()=>{
 const storage=new Map([['voxcode:unknown-operations',JSON.stringify(['legacy_pending_operation'])]]),request=async url=>url.pathname==='/api/operations/legacy_pending_operation'?response({status:'succeeded'}):undefined,f=await targetFixture({storage,request});
 assert.equal(f.run("unknownOperations.get('mac:legacy_pending_operation').id"),'legacy_pending_operation');assert.equal(f.get('#operation-recovery').hidden,false);await f.run("switchExecutionTarget('server')");assert.equal(f.get('#operation-recovery').hidden,true);assert.equal(f.run("[...unknownOperations.values()].some(item=>item.target==='server')"),false);
 await f.run("switchExecutionTarget('mac')");await f.get('#query-operation').onclick();assert(f.reads.includes('/api/operations/legacy_pending_operation?executionTarget=mac'));const restored=await targetFixture({storage,request});assert.equal(restored.get('#operation-recovery').hidden,true);assert.equal(restored.run('unknownOperations.size'),0);
});
test('offline Mac does not disable server selection or server execution, and unconfigured server stays disabled',async()=>{
 const offline=targets();offline[0].online=false;offline[0].available=false;const f=await targetFixture({discover:()=>response({targets:offline})});selectTask(f);await flush();assert.equal(f.get('#send-button').disabled,true);await f.run("switchExecutionTarget('server')");selectTask(f);await flush();assert.equal(f.get('#send-button').disabled,false);assert.equal(f.get('#execution-target').disabled,false);
 const unconfigured=targets();unconfigured[1].configured=false;unconfigured[1].available=false;const g=await targetFixture({discover:()=>response({targets:unconfigured})});await g.run("switchExecutionTarget('server')");assert.equal(g.run('state.executionTarget'),'mac');const option=g.get('#execution-target').children.find(node=>node.value==='server');assert.equal(option.disabled,true);assert.match(option.textContent,/未配置/);
});
test('frozen voice context and late transcript remain scoped to the original target',async()=>{
 const f=await targetFixture();selectTask(f);await flush();setInput(f,'Mac input');f.run("voiceAvailable=true;voiceClient={active:false,state:'idle',start:async target=>{globalThis.capturedTarget=target;}};");await f.get('#voice-button').onclick();assert.equal(f.run('capturedTarget.executionTarget'),'mac');await f.run("switchExecutionTarget('server')");selectTask(f);await flush();setInput(f,'Server input');const feedback=f.get('#feedback').textContent;f.run("saveVoiceTranscript('Mac transcript',capturedTarget)");assert.equal(f.get('#composer-input').value,'Server input');assert.equal(f.get('#feedback').textContent,feedback);await f.run("switchExecutionTarget('mac')");assert.equal(f.get('#composer-input').value,'Mac input\nMac transcript');
});
