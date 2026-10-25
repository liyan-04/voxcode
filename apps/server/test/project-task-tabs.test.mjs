import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function fixture({tasks = [], storage = new Map()} = {}) {
  class Node {
    constructor() {this.value = '';this.textContent = '';this.children = [];this.attributes = new Map();this.classList = {add() {}, remove() {}, toggle() {}};this.style = {};this.scrollLeft = 0;this.clientWidth = 400;this.scrollWidth = 400;}
    append(...items) {this.children.push(...items);}
    replaceChildren(...items) {this.children = items;}
    setAttribute(key, value) {this.attributes.set(key, String(value));}
    getAttribute(key) {return this.attributes.get(key);}
    addEventListener() {}
    focus() {}
    scrollBy({left}) {this.scrollLeft += left;this.onscroll?.();}
    scrollTo({left}) {this.scrollLeft = left;this.onscroll?.();}
  }
  const nodes = new Map(), session = new Map(), calls = [], get = selector => {if (!nodes.has(selector)) nodes.set(selector, new Node());return nodes.get(selector);};
  const store = values => ({getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key)});
  const context = vm.createContext({console, structuredClone, Date, Math, performance, URLSearchParams, setTimeout, clearTimeout, setInterval() {}, clearInterval() {}, crypto: {randomUUID: () => 'fixture-id'}, localStorage: store(storage), sessionStorage: store(session),
    document: {querySelector: get, querySelectorAll: () => [], createElement: () => new Node(), createElementNS: () => new Node(), addEventListener() {}, body: new Node()}, window: {addEventListener() {}, innerWidth: 1440, innerHeight: 900},
    fetch: async (path, options = {}) => {
      calls.push({path, method: options.method ?? 'GET'});
      if (path.startsWith('/api/tasks?')) {const projectId = new URL(path, 'http://fixture.invalid').searchParams.get('projectId');return {ok: true, status: 200, json: async () => ({tasks: tasks.filter(task => task.projectId === projectId)})};}
      return new Promise(() => {});
    }});
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  vm.runInContext(html.split('<script>')[1].split('</script>')[0], context);
  const run = source => vm.runInContext(source, context);
  context.fixtureTasks = structuredClone(tasks);
  run("state.authenticated=true;state.inventoryKnown=true;state.targets=[{id:'mac',configured:true,online:true,available:true}];state.projects=[{id:'a',name:'Alpha',enabled:true},{id:'b',name:'Beta',enabled:true}];state.tasks=fixtureTasks;state.projectId='a';render();");
  return {run, get, calls, storage, session, setTasks: rows => {context.fixtureTasks = structuredClone(rows);run('state.tasks=fixtureTasks;render()');}, ids: () => get('#task-tabs').children.map(row => row.getAttribute('data-task-id')).filter(Boolean)};
}
const task = (id, projectId, extra = {}) => ({id, projectId, title: 'Fixture ' + id, status: 'completed', createdAt: '2026-10-20T00:00:00Z', ...extra});

test('default project selection contributes every task without an opened-tab cap', async () => {
  const tasks = Array.from({length: 47}, (_, index) => task('t' + String(index).padStart(2, '0'), index % 2 ? 'b' : 'a'));
  const f = await fixture({tasks});assert.equal(f.ids().length, 47);assert.deepEqual(f.ids(), tasks.map(row => row.id));
  assert.equal(f.run('state.tabProjects.size'), 2);assert.equal(f.get('#tab-count').textContent, '47');
});
test('explicit multi-selection and no selection persist without changing current target or saved draft', async () => {
  const tasks = [task('a1', 'a'), task('b1', 'b')], storage = new Map(), f = await fixture({tasks, storage});
  f.run("$('#composer-input').value='Alpha draft';setTabProject('a',false)");assert.deepEqual(f.ids(), ['b1']);assert.equal(f.run('state.projectId'), 'a');assert.equal(f.session.get('voxcode:draft:mac::a::new:'), 'Alpha draft');
  f.run("setTabProject('b',false)");assert.deepEqual(f.ids(), []);assert.match(f.get('#task-tabs').children[0].textContent, /选择项目/);
  const reloaded = await fixture({tasks, storage});assert.deepEqual(reloaded.ids(), []);assert.equal(reloaded.run('state.tabProjects.size'), 0);
  reloaded.run("setTabProject('a',true);setTabProject('b',true)");assert.deepEqual(reloaded.ids(), ['a1', 'b1']);
});
test('conversation time sorts descending with createdAt-only legacy fallback and stable IDs', async () => {
  const tasks = [
    task('z', 'a', {lastConversationAt: '2026-10-22T00:00:00Z'}),
    task('b', 'b', {createdAt: '2026-10-24T00:00:00Z', updatedAt: '2099-01-01T00:00:00Z'}),
    task('a', 'a', {lastConversationAt: Date.parse('2026-10-24T00:00:00Z')}),
    task('legacy', 'b', {createdAt: '2026-10-23T00:00:00Z', archivedAt: '2099-01-01T00:00:00Z'}),
    task('unknown', 'a', {createdAt: null, updatedAt: '2099-01-01T00:00:00Z'}),
  ];
  const f = await fixture({tasks});assert.deepEqual(f.ids(), ['a', 'b', 'legacy', 'z', 'unknown']);
  f.setTasks([...tasks].reverse());assert.deepEqual(f.ids(), ['a', 'b', 'legacy', 'z', 'unknown']);
});
test('opening, reading and polling preserve recency and never change explicit project choices', async () => {
  const tasks = [task('old', 'a'), task('new', 'b', {lastConversationAt: '2026-10-24T00:00:00Z'})], f = await fixture({tasks});
  f.run("setTabProject('a',false);openTarget({projectId:'a',selected:'old'},{fetch:false})");assert.deepEqual(f.ids(), ['new']);assert.equal(f.run("state.tabProjects.has('a')"), false);
  await f.run('refresh()');assert.deepEqual(f.ids(), ['new']);assert.equal(f.run("state.tabProjects.has('a')"), false);
  assert.equal(f.run("taskById('old').lastConversationAt"), undefined);assert(f.calls.every(call => call.method === 'GET'));
});
test('a newly received conversation timestamp moves its actual task to the front', async () => {
  const tasks = [task('old', 'a'), task('new', 'b', {lastConversationAt: '2026-10-24T00:00:00Z'})], f = await fixture({tasks});assert.deepEqual(f.ids(), ['new', 'old']);
  tasks[0] = {...tasks[0], lastConversationAt: '2026-10-25T00:00:00Z'};await f.run('refresh()');assert.deepEqual(f.ids(), ['old', 'new']);
});
test('active archive and trash classes apply equally to all selected project tabs and keep children', async () => {
  const tasks = [task('root', 'a'), task('child', 'a', {parentTaskId: 'root'}), task('archive', 'b', {archived: true}), task('trash', 'b', {archived: true, deletedAt: '2026-10-25T00:00:00Z'})], f = await fixture({tasks});
  assert.deepEqual(f.ids(), ['child', 'root']);f.run("state.filter='archived';render()");assert.deepEqual(f.ids(), ['archive']);
  f.run("state.filter='deleted';render()");assert.deepEqual(f.ids(), ['trash']);f.run("state.filter='active';render();openTarget({projectId:'a',selected:'child'},{fetch:false})");assert.equal(f.run('state.snapshot.parentTaskId'), 'root');
});
test('switching selected tabs preserves draft text and a frozen voice target', async () => {
  const f = await fixture({tasks: [task('a1', 'a'), task('b1', 'b')]});
  f.run("openTarget({projectId:'a',selected:'a1'},{fetch:false});$('#composer-input').value='Task A input';voiceClient={active:true};voiceStatus={state:'recording',target:{draftKey:draftKey()}};openTarget({projectId:'b',selected:'b1'},{fetch:false})");
  assert.equal(f.session.get('voxcode:draft:mac::a::a1'), 'Task A input');assert.equal(f.run('voiceStatus.target.draftKey'), 'mac::a::a1');
  f.run("$('#composer-input').value='Task B input';setTabProject('a',false);setTabProject('a',true);openTarget({projectId:'a',selected:'a1'},{fetch:false})");assert.equal(f.get('#composer-input').value, 'Task A input');assert.equal(f.session.get('voxcode:draft:mac::b::b1'), 'Task B input');
});
test('overflow controls reflect scroll position and move the visible task strip', async () => {
  const f = await fixture({tasks: [task('a1', 'a')]}), box = f.get('#task-tabs');box.clientWidth = 400;box.scrollWidth = 1600;
  f.run('updateTabScroll()');assert.equal(f.get('#tabs-previous').disabled, true);assert.equal(f.get('#tabs-next').disabled, false);
  f.get('#tabs-next').onclick();assert(box.scrollLeft > 0);f.run('updateTabScroll()');assert.equal(f.get('#tabs-previous').disabled, false);
  box.scrollLeft = 1200;f.run('updateTabScroll()');assert.equal(f.get('#tabs-next').disabled, true);
});
test('arrows align adjacent task boundaries without a delayed animation that polling can interrupt', async () => {
  const f = await fixture(), box = f.get('#task-tabs');box.clientWidth = 288;box.scrollWidth = 1013;
  box.children = [40, 211, 492, 773].map(offsetLeft => ({offsetLeft}));
  box.scrollTo = options => {assert.notEqual(options.behavior, 'smooth');box.scrollLeft = options.left;};
  f.get('#tabs-next').onclick();assert.equal(box.scrollLeft, 171);
  f.get('#tabs-next').onclick();assert.equal(box.scrollLeft, 452);
  f.get('#tabs-next').onclick();assert.equal(box.scrollLeft, 725);assert.equal(f.get('#tabs-next').disabled, true);
  f.get('#tabs-previous').onclick();assert.equal(box.scrollLeft, 452);
  f.get('#tabs-previous').onclick();assert.equal(box.scrollLeft, 171);
  f.get('#tabs-previous').onclick();assert.equal(box.scrollLeft, 0);assert.equal(f.get('#tabs-previous').disabled, true);
});
