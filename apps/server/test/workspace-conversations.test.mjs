import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const SESSION='12345678-1234-4234-8234-123456789abc';
const initial=()=>({id:'one',projectId:'a',title:'One',status:'completed',revision:3,metadataRevision:1,sessionId:SESSION,createdAt:'2026-10-24T00:00:00.000Z',lastConversationAt:'2026-10-24T00:00:00.000Z',output:'first result',logs:[],turns:[{id:'turn-1',prompt:'first request',output:'first result',status:'completed',logs:[],createdAt:'2026-10-24T00:00:00.000Z'}]});
const summary=task=>Object.fromEntries(['id','projectId','title','status','revision','metadataRevision','sessionId','lastConversationAt','createdAt','archived','deletedAt','quarantined'].filter(key=>task[key]!==undefined).map(key=>[key,task[key]]));
const response=(body,status=200)=>({ok:status<400,status,json:async()=>structuredClone(body)});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture({task=initial(),post,read}={}){
 class Node{
  constructor(){this.value='';this.textContent='';this.hidden=false;this.children=[];this.attributes=new Map();this.classList={add(){},remove(){},toggle(){}};this.style={};this.scrollLeft=0;this.scrollWidth=400;this.clientWidth=400;}
  append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}setAttribute(key,value){this.attributes.set(key,String(value));}getAttribute(key){return this.attributes.get(key);}addEventListener(){}focus(){}scrollTo({left}){this.scrollLeft=left;}
 }
 const nodes=new Map(),session=new Map(),writes=[],reads=[],get=selector=>{if(!nodes.has(selector))nodes.set(selector,new Node());return nodes.get(selector);};
 const storage={getItem:key=>session.get(key)??null,setItem:(key,value)=>session.set(key,String(value)),removeItem:key=>session.delete(key)};
 let current=structuredClone(task),sequence=0;
 const context=vm.createContext({console,structuredClone,Date,Math,performance,setTimeout,clearTimeout,setInterval(){},clearInterval(){},crypto:{randomUUID:()=>`fixture-${++sequence}`},sessionStorage:storage,
  document:{querySelector:get,querySelectorAll:()=>[],createElement:()=>new Node(),createElementNS:()=>new Node(),addEventListener(){},body:new Node(),visibilityState:'visible'},window:{addEventListener(){},innerWidth:1440,innerHeight:900},
  fetch:async(path,options={})=>{
   if(options.method==='POST'){const call={path,payload:JSON.parse(options.body)};writes.push(call);return post?post(call,()=>current,value=>current=structuredClone(value)):response(current);}
   reads.push(path);
   if(path.startsWith('/api/tasks?'))return response({tasks:new URL(path,'http://fixture.invalid').searchParams.get('projectId')==='a'?[summary(current)]:[]});
   if(path.startsWith('/api/tasks/'))return read?read(path,()=>current):response(current);
   return new Promise(()=>{});
  }});
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');vm.runInContext(html.split('<script>')[1].split('</script>')[0],context);
 const run=source=>vm.runInContext(source,context);context.fixtureTask=structuredClone(task);
 run("state.authenticated=true;state.projects=[{id:'a',name:'Alpha',enabled:true},{id:'b',name:'Beta',enabled:true}];state.tasks=[fixtureTask];state.projectId='a';state.selected='one';state.snapshot=fixtureTask;render();");
 const text=node=>[node.textContent,...node.children.map(text)].join('\n');
 return {run,get,writes,reads,session,text:()=>text(get('#messages')),setTask:value=>{current=structuredClone(value);},submit:()=>get('#composer-form').onsubmit({preventDefault(){}}),input:value=>{get('#composer-input').value=value;run('saveDraft()');},snapshot:()=>JSON.parse(run('JSON.stringify(state.snapshot)'))};
}
function running(task,prompt='fix spacing'){
 return {...task,status:'running',revision:5,output:'',logs:[],turns:[...task.turns,{id:'turn-2',kind:'continuation',prompt,status:'running',output:'',logs:[],createdAt:'2026-10-25T00:00:00.000Z'}]};
}

test('list refresh retains full history and polls the selected task for equal-revision feedback',async()=>{
 const f=await fixture(),next=running(initial());f.run('state.snapshot.status="running";state.snapshot.revision=5');f.setTask({...next,output:'live result',logs:[{type:'item.completed',itemType:'command_execution',command:'npm test',exitCode:0,output:'actual command result',at:'2026-10-25T00:01:00.000Z'}]});
 await f.run('refresh()');await flush();
 assert.equal(f.snapshot().turns.length,2);assert.equal(f.snapshot().output,'live result');assert.ok(f.reads.some(path=>path==='/api/tasks/one?projectId=a'));
 assert.match(f.text(),/first request/);assert.match(f.text(),/first result/);assert.match(f.text(),/fix spacing/);assert.match(f.text(),/actual command result/);
});
test('every retained turn renders literal prompts, results, command evidence and file paths',async()=>{
 const task=running(initial());task.status='completed';task.output='<script>result</script>';task.logs=[{type:'item.completed',itemType:'command_execution',command:'npm test -- --run',output:'1 passed',exitCode:0,at:'2026-10-25T00:01:00.000Z'},{type:'item.completed',itemType:'file_change',changes:[{path:'src/index.js',kind:'update'}],at:'2026-10-25T00:02:00.000Z'}];
 const f=await fixture({task}),text=f.text();for(const value of ['first request','first result','fix spacing','<script>result</script>','npm test -- --run','1 passed','src/index.js','2026-10-25T00:01:00.000Z'])assert.ok(text.includes(value),value);
});
test('terminal task send continues the same saved session using one endpoint without a JS confirm chain',async()=>{
 const f=await fixture({post:async(call,get,set)=>{const next=running(get(),call.payload.prompt);set(next);return response(next);}});f.input('fix spacing');
 assert.equal(f.get('#send-button').disabled,false);await f.submit();await flush();
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].path,'/api/tasks/one/continue');assert.deepEqual(f.writes[0].payload,{projectId:'a',prompt:'fix spacing',revision:3,requestId:'fixture-1'});
 assert.equal(f.snapshot().id,'one');assert.equal(f.snapshot().sessionId,SESSION);assert.equal(f.snapshot().status,'running');assert.equal(f.snapshot().turns.length,2);assert.equal(f.get('#composer-input').value,'');assert.equal(f.get('#send-button').disabled,true);
});
test('new task send creates and executes through one backend request',async()=>{
 const f=await fixture({post:async(call,get,set)=>{const next={...running(get(),call.payload.prompt),id:'created'};set(next);return response(next,201);}});f.run("openTarget({projectId:'a'})");f.input('new request');await f.submit();await flush();
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].path,'/api/tasks');assert.equal(f.writes[0].payload.prompt,'new request');assert.equal(f.run('state.selected'),'created');assert.equal(f.snapshot().status,'running');
});
test('busy hidden quarantined missing-session and stale identity tasks cannot send continuation',async()=>{
 for(const extra of [{status:'running'},{status:'cancelling'},{status:'draft'},{status:'interrupted'},{quarantined:true},{archived:true},{deletedAt:'now'},{sessionId:null},{sessionId:'not-a-uuid'},{revision:null},{id:'foreign'},{projectId:'b'}]){
  const f=await fixture({task:{...initial(),...extra}});f.input('keep this');f.run('render();renderVoice()');assert.equal(f.get('#send-button').disabled,true,JSON.stringify(extra));await f.submit();assert.equal(f.writes.length,0);assert.equal(f.get('#composer-input').value,'keep this');
 }
});
test('legacy saved draft executes only on explicit action and preserves new input',async()=>{
 const f=await fixture({task:{...initial(),status:'draft',revision:1},post:async(call,get,set)=>{const next={...get(),status:'running',revision:2};set(next);return response(next);}});f.input('later follow-up');assert.equal(f.writes.length,0);
 const button=f.get('#detail-controls').children.find(node=>node.textContent==='执行任务');assert.ok(button);await button.onclick();await flush();assert.equal(f.writes.length,1);assert.equal(f.writes[0].path,'/api/tasks/one/confirm');assert.equal(f.writes[0].payload.revision,1);assert.equal(f.get('#composer-input').value,'later follow-up');
});
test('delayed continuation keeps edited source text and the current target',async()=>{
 for(const switchTarget of [false,true]){
  const gate=deferred(),f=await fixture({post:async(call,get,set)=>{await gate.promise;const next=running(get());set(next);return response(next);}});f.input('fix spacing');const request=f.submit();assert.equal(f.writes.length,1);await f.submit();assert.equal(f.writes.length,1);
  f.input('revised source');if(switchTarget){f.run("openTarget({projectId:'b'})");f.input('beta input');}gate.resolve();await request;await flush();
  assert.equal(f.session.get('voxcode:draft:a::one'),'revised source');assert.equal(f.get('#composer-input').value,switchTarget?'beta input':'revised source');assert.equal(f.run('state.projectId'),switchTarget?'b':'a');assert.equal(f.run('state.selected'),switchTarget?null:'one');
 }
});
test('uncertain continuation retries preserve the exact request after switching targets',async()=>{
 let attempts=0;const f=await fixture({post:async(call,get,set)=>{if(++attempts===1)throw Error('synthetic disconnect');const next=running(get());set(next);return response(next);}});f.input('fix spacing');await f.submit();assert.equal(f.get('#composer-input').value,'fix spacing');
 f.run("openTarget({projectId:'b'});openTarget({projectId:'a',selected:'one'},{fetch:false})");await f.submit();assert.equal(f.writes.length,2);assert.deepEqual(f.writes[0],f.writes[1]);assert.equal(f.snapshot().turns.length,2);
});
test('lost acknowledgement after commit replays the original request after a newer full-detail poll',async()=>{
 const receipts=new Map();const f=await fixture({post:async(call,get,set)=>{
  if(receipts.has(call.payload.requestId))return response(get());
  const next=running(get(),call.payload.prompt);next.status='completed';next.revision=get().revision+3;next.turns.at(-1).status='completed';set(next);receipts.set(call.payload.requestId,true);
  if(receipts.size===1)throw Error('response lost after commit');return response(next);
 }});f.input('fix spacing');await f.submit();await f.run('refresh()');await flush();assert.equal(f.snapshot().revision,6);assert.equal(f.snapshot().turns.length,2);
 await f.submit();assert.deepEqual(f.writes[1],f.writes[0]);assert.equal(f.snapshot().turns.length,2);assert.equal(f.get('#composer-input').value,'');
 f.input('later intentional turn');await f.submit();assert.equal(f.snapshot().turns.length,3);assert.notEqual(f.writes[2].payload.requestId,f.writes[0].payload.requestId);assert.equal(f.writes[2].payload.revision,6);
});
test('edited input waits for visible original-request recovery and survives successful reconciliation',async()=>{
 let attempted=false;const f=await fixture({post:async(call,get,set)=>{
  if(attempted)return response(get());attempted=true;const next={...running(get(),call.payload.prompt),status:'completed',revision:6};set(next);throw Error('response lost after commit');
 }});f.input('fix spacing');await f.submit();await f.run('refresh()');await flush();f.input('later edited instruction');await f.submit();
 assert.equal(f.writes.length,1);assert.equal(f.get('#composer-input').value,'later edited instruction');assert.equal(f.get('#submission-recovery').hidden,false);assert.equal(f.get('#retry-submission').disabled,false);
 await f.get('#retry-submission').onclick();assert.deepEqual(f.writes[1],f.writes[0]);assert.equal(f.get('#composer-input').value,'later edited instruction');assert.equal(f.get('#submission-recovery').hidden,true);
 await f.submit();assert.equal(f.writes[2].payload.prompt,'later edited instruction');assert.notEqual(f.writes[2].payload.requestId,f.writes[0].payload.requestId);
});
test('partial admission responses preserve original identity until recovery succeeds',async()=>{
 for(const [status,code] of [[409,'busy'],[409,undefined],[503,'offline'],[409,'outcome_unknown']]){
  let attempted=false;const f=await fixture({post:async(call,get,set)=>{if(!attempted){attempted=true;set({...get(),status:'running',revision:4});return response({code},status);}return response({...get(),status:'completed',revision:6});}});f.input('fix spacing');await f.submit();await f.run('refresh()');await flush();f.input('new edited text');await f.submit();assert.equal(f.writes.length,1,`${status} ${code}`);
  await f.get('#retry-submission').onclick();assert.deepEqual(f.writes[1],f.writes[0]);assert.equal(f.get('#composer-input').value,'new edited text');
 }
});
test('late detail from an old target and older execution versions cannot replace current content',async()=>{
 const gate=deferred(),f=await fixture({read:()=>gate.promise}),loading=f.run("loadTask('one','a')");f.run("openTarget({projectId:'b'},{fetch:false})");gate.resolve(response(initial()));await loading;assert.equal(f.run('state.snapshot'),null);assert.equal(f.run('state.projectId'),'b');
 const old=await fixture({task:running(initial()),read:async()=>response(initial())});await old.run("loadTask('one','a')");assert.equal(old.snapshot().revision,5);assert.equal(old.snapshot().turns.length,2);
});
test('overlapping selected-task polls share a read instead of starving slow feedback',async()=>{
 const gate=deferred(),f=await fixture({read:()=>gate.promise}),first=f.run("loadTask('one','a')"),second=f.run("loadTask('one','a')");assert.equal(f.reads.filter(path=>path.startsWith('/api/tasks/')).length,1);gate.resolve(response({...initial(),output:'updated'}));await Promise.all([first,second]);assert.equal(f.snapshot().output,'updated');
});
test('frozen voice callbacks preserve task drafts and only block their original target',async()=>{
 const f=await fixture();f.input('task input');f.run("voiceClient={active:true};voiceStatus={state:'recording',target:{draftKey:draftKey()}};renderVoice()");assert.equal(f.get('#send-button').disabled,true);await f.submit();assert.equal(f.writes.length,0);
 f.run("openTarget({projectId:'b'});$('#composer-input').value='beta';saveDraft();saveVoiceTranscript('recognized',{draftKey:'a::one',label:'Alpha / One'});renderVoice()");assert.equal(f.get('#send-button').disabled,false);assert.equal(f.get('#composer-input').value,'beta');assert.equal(f.session.get('voxcode:draft:a::one'),'task input\nrecognized');
});
test('pending explicit legacy execution cannot dispatch twice',async()=>{
 const gate=deferred(),f=await fixture({task:{...initial(),status:'draft'},post:async(call,get)=>{await gate.promise;return response({...get(),status:'running',revision:4});}}),task=f.snapshot();
 f.run('globalThis.legacyTask=state.snapshot');const first=f.run("taskAction(legacyTask,'confirm')"),second=f.run("taskAction(legacyTask,'confirm')");assert.equal(f.writes.length,1);gate.resolve();await Promise.all([first,second]);assert.equal(task.revision,3);
});
