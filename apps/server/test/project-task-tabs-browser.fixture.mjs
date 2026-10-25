import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {WebSocketServer} from 'ws';

if (!process.env.VOXCODE_PLAYWRIGHT_MODULE) throw Error('Set VOXCODE_PLAYWRIGHT_MODULE to a local Playwright module');
const {chromium} = await import(process.env.VOXCODE_PLAYWRIGHT_MODULE);
const output = process.env.VOXCODE_TABS_FIXTURE_OUTPUT ?? '/private/tmp/project-task-tabs-118';
const files = new Map(await Promise.all(['index.html', 'voice-client.mjs', 'voice-worklet.js'].map(async name => ['/' + name, await readFile(new URL('../public/' + name, import.meta.url))])));
const projects = [{id: 'alpha', name: 'Fixture Alpha long project', enabled: true}, {id: 'beta', name: 'Fixture Beta long project', enabled: true}];
const initial = Array.from({length: 48}, (_, index) => ({id: 'task-' + String(index).padStart(2, '0'), projectId: index % 2 ? 'beta' : 'alpha', title: '模拟长标题任务 ' + index + '：核对项目、任务与子任务的导航及原始输入，保留完整目标身份和最终结果。'.repeat(3), initialPrompt: 'Synthetic task input ' + index, status: 'completed', revision: 1, metadataRevision: 1, createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(), ...(index % 3 ? {} : {lastConversationAt: new Date(Date.UTC(2026, 9, 20, 0, index)).toISOString()}), ...(index === 2 ? {parentTaskId: 'task-00'} : {}), ...(index >= 40 && index < 44 ? {archived: true} : {}), ...(index >= 44 ? {deletedAt: '2026-10-24T00:00:00Z'} : {})}));
let tasks = [], browser, voiceFrames = 0;
const writes = [], errors = [], results = [], sockets = new Set();
const json = (res, status, value, headers = {}) => {res.writeHead(status, {'content-type': 'application/json', ...headers});res.end(JSON.stringify(value));};
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture.invalid');
  if (files.has(url.pathname)) {res.writeHead(200, {'content-type': url.pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript'});res.end(files.get(url.pathname));return;}
  if (!url.pathname.startsWith('/api/')) {res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});res.end(files.get('/index.html'));return;}
  if (url.pathname === '/api/health') return json(res, 200, {simulation: true, executionHost: 'mac', deviceOnline: true, voiceAvailable: true});
  if (url.pathname === '/api/login') return json(res, 200, {ok: true}, {'set-cookie': 'fixture=tabs-synthetic; HttpOnly; SameSite=Strict; Path=/'});
  if (!String(req.headers.cookie).includes('fixture=tabs-synthetic')) return json(res, 401, {});
  if (req.method === 'POST') {writes.push(url.pathname);return json(res, 500, {});}
  if (url.pathname === '/api/devices') return json(res, 200, {deviceId: 'fixture-mac', devices: [{deviceId: 'fixture-mac', online: true}]});
  if (url.pathname === '/api/projects') return json(res, 200, {projects});
  if (url.pathname === '/api/tasks') return json(res, 200, {tasks: tasks.filter(task => task.projectId === url.searchParams.get('projectId'))});
  return json(res, 200, tasks.find(task => '/api/tasks/' + task.id === url.pathname) ?? {});
});
server.on('connection', socket => {sockets.add(socket);socket.once('close', () => sockets.delete(socket));});
const wss = new WebSocketServer({noServer: true});
server.on('upgrade', (req, socket, head) => {if (req.url !== '/ws/voice') return socket.destroy();wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));});
wss.on('connection', ws => {
  let captureId, seq = 0;const send = message => {if (ws.readyState === 1) ws.send(JSON.stringify({...message, seq: ++seq}));};
  ws.on('message', (data, binary) => {
    if (binary) {assert.equal(data.length, 640);voiceFrames++;send({type: 'stt.partial', captureId, text: 'Synthetic voice preview'});return;}
    const message = JSON.parse(data);
    if (message.type === 'session.start') send({type: 'session.ready', requestId: message.requestId, voiceSessionId: 'fixture-voice', contextVersion: message.context.contextVersion, captureId: null});
    if (message.type === 'capture.start') {captureId = message.captureId;send({type: 'capture.ready', requestId: message.requestId, captureId, contextVersion: message.contextVersion, input: message.format, output: null});}
    if (message.type === 'capture.stop') {send({type: 'capture.stopped', captureId});send({type: 'stt.final', captureId, text: 'Synthetic frozen project voice'});}
  });
});
const expected = filter => tasks.filter(task => filter === 'deleted' ? task.deletedAt : !task.deletedAt && (filter === 'archived' ? task.archived : !task.archived)).sort((a, b) => Date.parse(b.lastConversationAt ?? b.createdAt) - Date.parse(a.lastConversationAt ?? a.createdAt) || a.id.localeCompare(b.id)).map(task => task.id);
const tabIds = page => page.locator('#task-tabs [data-task-id]').evaluateAll(rows => rows.map(row => row.getAttribute('data-task-id')));
async function tree(page, mobile) {if (mobile && !await page.locator('body').evaluate(body => body.classList.contains('tree-open'))) await page.locator('#open-tree').click();}
async function hideTree(page, mobile) {if (mobile) await page.locator('#tree-backdrop').click({position: {x: 300, y: 30}});}
async function choose(page, project, checked, mobile) {await tree(page, mobile);await page.locator('[data-tab-project="' + project + '"]').setChecked(checked);await hideTree(page, mobile);}
async function allTabsReachable(page) {
  const seen = new Set(), wanted = await tabIds(page);await page.locator('#task-tabs').evaluate(box => {box.scrollLeft = 0;});
  await page.waitForFunction(() => document.querySelector('#tabs-previous').disabled);
  for (let step = 0; step < 100; step++) {
    const visible = await page.locator('#task-tabs').evaluate(box => {const bounds = box.getBoundingClientRect();return [...box.querySelectorAll('[data-task-id]')].filter(row => {const rect = row.getBoundingClientRect();return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;}).map(row => row.getAttribute('data-task-id'));});
    visible.forEach(id => seen.add(id));if (await page.locator('#tabs-next').isDisabled()) break;
    const previous = await page.locator('#task-tabs').evaluate(box => box.scrollLeft);await page.locator('#tabs-next').click();
    try {await page.waitForFunction(old => {const box = document.querySelector('#task-tabs');return box.scrollLeft > old + 20 || document.querySelector('#tabs-next').disabled;}, previous);} catch (error) {
      const geometry = await page.locator('#task-tabs').evaluate(box => ({left: box.scrollLeft, width: box.clientWidth, total: box.scrollWidth, tabs: [...box.children].slice(0, 4).map(row => ({left: row.offsetLeft, width: row.offsetWidth}))}));
      throw Error('Task arrow did not advance: ' + JSON.stringify({previous, geometry}), {cause: error});
    }
    await page.waitForFunction(() => {const box = document.querySelector('#task-tabs');return !box.matches(':active');});
    await page.evaluate(() => new Promise(resolve => {let last = -1, stable = 0;function next() {const value = document.querySelector('#task-tabs').scrollLeft;stable = value === last ? stable + 1 : 0;last = value;if (stable > 3) resolve();else requestAnimationFrame(next);}requestAnimationFrame(next);}));
  }
  assert.equal(seen.size, wanted.length, 'every task must be fully reachable using arrow controls');return seen.size;
}
async function layout(page, name) {
  const viewport = page.viewportSize();if (viewport.height <= 500) await page.locator('#composer-form').scrollIntoViewIfNeeded();
  const bounds = await page.evaluate(() => {
    const box = selector => {const r = document.querySelector(selector).getBoundingClientRect();return {left: r.left, right: r.right, top: r.top, bottom: r.bottom};};
    return {width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, header: box('main>header'), tabs: box('.task-navigation'), workspace: box('.workspace'), composer: box('#composer-form'), voice: box('#voice-button')};
  });
  assert.equal(bounds.width, viewport.width);assert.equal(bounds.height, viewport.height);assert(bounds.tabs.top >= bounds.header.bottom - 1);assert(bounds.workspace.top >= bounds.tabs.bottom - 1);assert(bounds.tabs.right <= viewport.width);assert(bounds.voice.left >= 0 && bounds.voice.right <= viewport.width);
  assert(bounds.composer.top >= bounds.tabs.bottom && bounds.composer.bottom <= viewport.height);assert(bounds.voice.top >= bounds.tabs.bottom && bounds.voice.bottom <= viewport.height);
  results.push({name, bounds});
}
async function run(name, viewport) {
  tasks = structuredClone(initial);const mobile = viewport.width <= 700, context = await browser.newContext({viewport, isMobile: mobile, hasTouch: mobile, permissions: ['microphone']}), page = await context.newPage();
  page.setDefaultTimeout(10000);page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port, {waitUntil: 'networkidle'});
  await page.locator('#login-button').click();await page.locator('#password').fill('fixture-only');await page.locator('#login-submit').click();
  await page.waitForFunction(() => document.querySelector('#login-overlay').hidden && document.querySelector('#tab-count').textContent === '40');
  assert.deepEqual(await tabIds(page), expected('active'));await layout(page, name + ' first');await page.screenshot({path: output + '-' + name + '-first.png'});
  const reached = await allTabsReachable(page);await page.screenshot({path: output + '-' + name + '-overflow.png'});
  const last = expected('active').at(-1);await page.locator('[data-task-id="' + last + '"] .tab-name').click();await page.waitForFunction(id => document.querySelector('#task-title').textContent.includes('任务 ' + Number(id.slice(-2))), last);
  assert.deepEqual(await tabIds(page), expected('active'));assert.equal(tasks.find(task => task.id === last).lastConversationAt, initial.find(task => task.id === last).lastConversationAt);
  await page.locator('#composer-input').scrollIntoViewIfNeeded();await page.locator('#composer-input').fill('Current task input kept');
  await choose(page, 'alpha', false, mobile);assert((await tabIds(page)).every(id => tasks.find(task => task.id === id).projectId === 'beta'));
  await choose(page, 'beta', false, mobile);assert.equal(await page.locator('#task-tabs [data-task-id]').count(), 0);await page.reload({waitUntil: 'networkidle'});
  await page.waitForFunction(() => document.querySelector('#login-button').textContent === '已登录');assert.equal(await page.locator('#task-tabs [data-task-id]').count(), 0);assert.equal(await page.locator('#composer-input').inputValue(), 'Current task input kept');
  await choose(page, 'alpha', true, mobile);await choose(page, 'beta', true, mobile);assert.deepEqual(await tabIds(page), expected('active'));
  for (const filter of ['archived', 'deleted', 'active']) {await tree(page, mobile);await page.locator('[data-filter="' + filter + '"]').click();await hideTree(page, mobile);assert.deepEqual(await tabIds(page), expected(filter));}
  tasks[0].lastConversationAt = '2026-10-25T23:00:00Z';await tree(page, mobile);await page.locator('#refresh-tree').click();await hideTree(page, mobile);await page.waitForFunction(() => document.querySelector('#task-tabs [data-task-id]').getAttribute('data-task-id') === 'task-00');assert.deepEqual(await tabIds(page), expected('active'));
  await tree(page, mobile);await page.locator('.project-name').filter({hasText: 'Fixture Alpha'}).click();if (mobile) await page.waitForFunction(() => !document.body.classList.contains('tree-open'));
  await page.locator('#composer-input').scrollIntoViewIfNeeded();await page.locator('#composer-input').fill('Frozen Alpha new draft');await page.locator('#voice-button').click();await page.waitForFunction(() => document.querySelector('#voice-button').getAttribute('aria-pressed') === 'true');
  await choose(page, 'alpha', false, mobile);await tree(page, mobile);await page.locator('.project-name').filter({hasText: 'Fixture Beta'}).click();if (mobile) await page.waitForFunction(() => !document.body.classList.contains('tree-open'));
  await page.locator('#composer-input').scrollIntoViewIfNeeded();await page.locator('#composer-input').fill('Keep Beta new draft');await page.locator('#voice-button').click();await page.waitForFunction(() => document.querySelector('#feedback').textContent.includes('尚未提交'));
  assert.equal(await page.locator('#composer-input').inputValue(), 'Keep Beta new draft');assert.equal(await page.evaluate(() => sessionStorage.getItem('voxcode:draft:alpha::new:')), 'Frozen Alpha new draft\nSynthetic frozen project voice');
  assert.equal(await page.locator('[data-tab-project="alpha"]').isChecked(), false);await layout(page, name + ' final');await page.screenshot({path: output + '-' + name + '-final.png'});
  results.push({name, tasksReachedWithArrows: reached, allSelectedTasks: true, emptySelectionPersists: true, openingDoesNotSelect: true, recencyRefresh: true, visibilityClasses: true, draftsAndVoicePreserved: true});await context.close();
}
try {
  server.listen(0, '127.0.0.1');await once(server, 'listening');browser = await chromium.launch({headless: true, ...(process.env.VOXCODE_PLAYWRIGHT_EXECUTABLE ? {executablePath: process.env.VOXCODE_PLAYWRIGHT_EXECUTABLE} : {}), args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']});
  for (const [name, viewport] of [['desktop', {width: 1440, height: 900}], ['mobile', {width: 390, height: 844}], ['narrow', {width: 320, height: 740}], ['landscape', {width: 844, height: 390}]]) await run(name, viewport);
  assert.equal(writes.length, 0);assert(voiceFrames > 0);assert.deepEqual(errors, []);console.log(JSON.stringify({fixture: true, results, voiceFrames, taskWrites: writes.length, errors}, null, 2));
} catch (error) {console.error(error.stack);process.exitCode = 1;} finally {
  await browser?.close();for (const ws of wss.clients) ws.terminate();await new Promise(resolve => wss.close(resolve));for (const socket of sockets) socket.destroy();await new Promise(resolve => server.close(resolve));
  await writeFile(output + '-results.json', JSON.stringify({fixture: true, results, voiceFrames, taskWrites: writes.length, errors}, null, 2));
}
