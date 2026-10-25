import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function fixture() {
  class Node {
    constructor() {this.value = '';this.textContent = '';this.hidden = false;this.children = [];this.classList = {add() {}, remove() {}, toggle() {}};this.style = {};}
    append(...items) {this.children.push(...items);}
    replaceChildren(...items) {this.children = items;}
    setAttribute() {}
    addEventListener() {}
    focus() {}
    querySelector(selector) {return get(selector);}
  }
  const nodes = new Map(), storage = new Map(), writes = [], reads=[], get = selector => {if (!nodes.has(selector)) nodes.set(selector, new Node());return nodes.get(selector);};
  let finish;
  const task = {id: 'created', projectId: 'a', title: 'Fixture', status: 'draft', revision: 1};
  const context = vm.createContext({console, structuredClone, URLSearchParams, setInterval() {}, clearInterval() {}, setTimeout, clearTimeout, Date, Math, performance, crypto: {randomUUID: () => 'fixture-id'},
    document: {querySelector: get, querySelectorAll: () => [], createElement: () => new Node(), createElementNS: () => new Node(), addEventListener() {}, body: new Node(), hidden: false}, window: {addEventListener() {}, innerWidth: 1000, innerHeight: 800},
    sessionStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key)},
    fetch: async (path, options = {}) => {
      if(!options.method)reads.push(path);
      if (new URL(path,'http://fixture.invalid').pathname === '/api/tasks' && options.method === 'POST') {writes.push(path);return new Promise(resolve => {finish = () => resolve({ok: true, status: 201, json: async () => ({taskId: 'created'})});});}
      if (path.startsWith('/api/tasks?')) return {ok: true, status: 200, json: async () => ({tasks: [task]})};
      if (path.startsWith('/api/tasks/')) return {ok: true, status: 200, json: async () => task};
      return new Promise(() => {});
    }});
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');vm.runInContext(html.split('<script>')[1].split('</script>')[0], context);
  const run = code => vm.runInContext(code, context);
  run("state.authenticated=true;state.inventoryKnown=true;state.targets=[{id:'mac',configured:true,online:true,available:true}];state.projects=[{id:'a',name:'Alpha',enabled:true},{id:'b',name:'Beta',enabled:true}];state.projectId='a';$('#composer-input').value='saved input';saveDraft();globalThis.voiceStarts=0;voiceAvailable=true;voiceClient={active:false,state:'idle',async start(){voiceStarts++;}};");
  return {run, writes, reads, get, finish: () => finish?.(), submit: () => get('#composer-form').onsubmit({preventDefault() {}})};
}

test('recording and recognition block submission only for the frozen draft', async () => {
  for (const state of ['recording', 'stopping']) {
    const f = await fixture();f.run("voiceClient.active=true;voiceStatus={state:'" + state + "',target:{draftKey:draftKey()}};render();");
    assert.equal(f.get('#send-button').disabled, true);const submitting = f.submit();f.finish();await submitting;
    assert.equal(f.writes.length, 0);assert.equal(f.get('#composer-input').value, 'saved input');
    f.run("openTarget({projectId:'b'});$('#composer-input').value='other draft';renderVoice();");assert.equal(f.get('#send-button').disabled, false);
    const other = f.submit();assert.equal(f.writes.length, 1);f.finish();await other;
  }
});
test('a pending create disables voice and the click handler cannot start a capture', async () => {
  const f = await fixture(), submitting = f.submit();f.run('renderVoice()');assert.equal(f.get('#voice-button').disabled, true);
  await f.get('#voice-button').onclick();assert.equal(f.run('voiceStarts'), 0);f.finish();await submitting;
});

test('voice execution receives actual results on the frozen target without replaying recognition', async () => {
  const f = await fixture();
  f.run("state.executionHost='mac';state.macOnline=true;globalThis.voiceTarget=null;voiceClient={active:false,state:'idle',async start(target){voiceTarget=target;}};");
  await f.get('#voice-button').onclick();assert.equal(f.run('voiceTarget.executionTarget'), 'mac');
  f.run("receiveVoiceResult({executionTarget:'mac',projectId:'a',taskId:'voice-task',status:'running',revision:1},{executionTarget:'mac',projectId:'a',draftKey:draftKey(),label:'Alpha'});");
  assert.equal(f.run('state.selected'), 'voice-task');assert.equal(f.run('state.snapshot.status'), 'running');assert.equal(f.writes.length, 0);assert.equal(f.run("storedDraft('mac::a::new:')"), 'saved input');
});
test('late voice results do not change a newly selected project or execution target', async () => {
  for (const switchTo of ["openTarget({projectId:'b'});", "state.executionTarget='server';"]) {
    const f = await fixture();f.run("const frozen={executionTarget:'mac',projectId:'a',draftKey:draftKey(),label:'Alpha'};" + switchTo + "receiveVoiceResult({executionTarget:'mac',projectId:'a',taskId:'voice-task',status:'completed',revision:1},frozen);");
    assert.equal(f.run('state.selected'), null);assert.equal(f.writes.length, 0);
  }
});
test('processing and speaking remain cancellable and visibly distinguish execution from transcription', async () => {
  for (const state of ['processing', 'speaking']) {
    const f = await fixture();f.run("voiceClient.active=true;voiceStatus={state:'" + state + "',target:{draftKey:draftKey()}};renderVoice();");
    assert.equal(f.get('#voice-button').disabled, true);assert.equal(f.get('#voice-cancel').hidden, false);assert.equal(f.get('#voice-status').hidden, false);assert.equal(f.get('#send-button').disabled, true);
  }
});

test('voice unknown outcomes join original-target operation recovery even after navigation',async()=>{
 const f=await fixture();f.run("const frozen={executionTarget:'mac',projectId:'a',draftKey:draftKey(),label:'Mac Alpha'};state.executionTarget='server';receiveVoiceResult({executionTarget:'mac',projectId:'a',status:'outcome_unknown',operationId:'voice-operation'},frozen);");
 assert.equal(f.run("unknownOperations.get('mac:voice-operation').target"),'mac');assert.equal(f.run("unknownOperations.has('server:voice-operation')"),false);assert.equal(f.run('state.selected'),null);
});
test('later voice query refreshes the task opened by its initial running result',async()=>{
 const f=await fixture();f.run("const frozen={executionTarget:'mac',projectId:'a',draftKey:draftKey(),label:'Mac Alpha'};receiveVoiceResult({executionTarget:'mac',projectId:'a',taskId:'voice-task',status:'running',revision:1},frozen);receiveVoiceResult({executionTarget:'mac',projectId:'a',taskId:'voice-task',status:'completed',revision:1},frozen);");
 assert.equal(f.run('state.snapshot.status'),'completed');
});
test('early progress opens actual task and requests authenticated target details before a result',async()=>{
 const f=await fixture();f.run("receiveVoiceProgress({executionTarget:'mac',projectId:'a',taskId:'voice-task',requestId:'voice-request',status:'running',revision:2},{executionTarget:'mac',projectId:'a',draftKey:draftKey(),label:'Alpha'});");
 assert.equal(f.run('state.selected'),'voice-task');assert.equal(f.run('state.snapshot.status'),'running');assert(f.reads.some(path=>path.startsWith('/api/tasks/voice-task?')&&path.includes('executionTarget=mac')));assert.equal(f.writes.length,0);assert.equal(f.run("storedDraft('mac::a::new:')"),'saved input');
});
test('late progress preserves navigation within the same project and across target or project',async()=>{
 for(const navigate of ["openTarget({projectId:'a',selected:'other'});","openTarget({projectId:'b'});","state.executionTarget='server';"]){
  const f=await fixture();f.run("const frozen={executionTarget:'mac',projectId:'a',draftKey:draftKey(),label:'Alpha'};"+navigate+"receiveVoiceProgress({executionTarget:'mac',projectId:'a',taskId:'voice-task',requestId:'r',status:'running',revision:2},frozen);");
  assert.notEqual(f.run('state.selected'),'voice-task');assert(!f.reads.includes('/api/tasks/voice-task?executionTarget=mac'));assert.equal(f.writes.length,0);
 }
});
