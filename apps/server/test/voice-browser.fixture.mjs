import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {WebSocketServer} from 'ws';

if (!process.env.VOXCODE_PLAYWRIGHT_MODULE) throw Error('Set VOXCODE_PLAYWRIGHT_MODULE to a local Playwright entry module');
const {chromium} = await import(process.env.VOXCODE_PLAYWRIGHT_MODULE);
const output = process.env.VOXCODE_VOICE_FIXTURE_OUTPUT ?? '/private/tmp/voice-ui-112';
const files = new Map(await Promise.all(['index.html', 'voice-client.mjs', 'voice-worklet.js'].map(async name => ['/' + name, await readFile(new URL('../public/' + name, import.meta.url))])));
const projects = [{id: 'alpha', name: 'Fixture Alpha', enabled: true}, {id: 'beta', name: 'Fixture Beta', enabled: true}];
const tasks = [{id: 'task-a', projectId: 'alpha', title: 'Fixture task A', status: 'draft', revision: 1}, {id: 'task-b', projectId: 'alpha', title: 'Fixture task B', status: 'draft', revision: 1}];
const captures = [], writes = [], errors = [], results = [], sockets = new Set();
let browser;
const json = (res, status, body, headers = {}) => {res.writeHead(status, {'content-type': 'application/json', ...headers});res.end(JSON.stringify(body));};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture.invalid');
  if (url.pathname === '/voice-client.mjs' || url.pathname === '/voice-worklet.js') {res.writeHead(200, {'content-type': 'text/javascript'});res.end(files.get(url.pathname));return;}
  if (!url.pathname.startsWith('/api/')) {res.writeHead(200, {'content-type': 'text/html; charset=utf-8', ...(url.pathname === '/denied' ? {'permissions-policy': 'microphone=()'} : {})});res.end(files.get('/index.html'));return;}
  if (url.pathname === '/api/health') return json(res, 200, {simulation: true, executionHost: 'mac', deviceOnline: true, voiceAvailable: true, voiceState: 'configured'});
  if (url.pathname === '/api/login') return json(res, 200, {ok: true}, {'set-cookie': 'fixture=synthetic; HttpOnly; SameSite=Strict; Path=/'});
  if (!String(req.headers.cookie).includes('fixture=synthetic')) return json(res, 401, {});
  if (url.pathname === '/api/devices') return json(res, 200, {deviceId: 'fixture-mac', devices: [{deviceId: 'fixture-mac', online: true}]});
  if (url.pathname === '/api/execution-targets') return json(res, 200, {targets: [{id: 'mac', name: 'Mac Codex', configured: true, online: true, available: true}, {id: 'server', name: 'Server Codex', configured: false, online: false, available: false}]});
  if (/^\/api\/(projects|tasks)([/?]|$)/u.test(url.pathname)) assert.deepEqual(url.searchParams.getAll('executionTarget'), ['mac']);
  if (url.pathname === '/api/projects') return json(res, 200, {projects});
  if (req.method === 'POST' && url.pathname.startsWith('/api/tasks')) {writes.push(url.pathname);return json(res, 500, {});}
  if (url.pathname === '/api/tasks') return json(res, 200, {tasks: tasks.filter(task => task.projectId === url.searchParams.get('projectId'))});
  return json(res, 200, tasks.find(task => url.pathname === '/api/tasks/' + task.id) ?? {});
});
server.on('connection', socket => {sockets.add(socket);socket.once('close', () => sockets.delete(socket));});
const wss = new WebSocketServer({noServer: true});
server.on('upgrade', (req, socket, head) => {if (req.url !== '/ws/voice') return socket.destroy();wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));});
wss.on('connection', ws => {
  let capture, seq = 0;
  const send = value => {if (ws.readyState === 1) ws.send(JSON.stringify({...value, seq: ++seq}));};
  ws.on('message', (data, binary) => {
    if (binary) {
      assert(capture);assert.equal(data.length, 640);capture.frames++;
      if (capture.frames === 1) {send({type: 'stt.partial', captureId: capture.id, text: 'Synthetic partial'});send({type: 'stt.final', captureId: capture.id, text: 'Earlier synthetic candidate'});}
      return;
    }
    const message = JSON.parse(data.toString());
    if (message.type === 'session.start') {capture = {context: message.context, frames: 0, closed: false};captures.push(capture);send({type: 'session.ready', requestId: message.requestId, voiceSessionId: 'fixture-session', contextVersion: message.context.contextVersion, captureId: null, writeReady: false});}
    if (message.type === 'capture.start') {capture.id = message.captureId;capture.text = 'Synthetic final transcript ' + captures.length;send({type: 'capture.ready', requestId: message.requestId, captureId: message.captureId, contextVersion: message.contextVersion, input: message.format, output: null, writeReady: false});}
    if (message.type === 'capture.stop') {capture.stopped = true;send({type: 'capture.stopped', captureId: capture.id, lastSeq: capture.frames});setTimeout(() => send({type: 'stt.final', captureId: capture.id, text: capture.text}), 40);}
    if (message.type === 'capture.abort') {capture.aborted = true;send({type: 'stt.final', captureId: capture.id, text: 'Late aborted transcript'});}
  });
  ws.on('close', () => {if (capture) capture.closed = true;});
});
async function tree(page, mobile) {if (mobile && !await page.locator('body').evaluate(element => element.classList.contains('tree-open'))) await page.locator('#open-tree').click();}
async function project(page, name, mobile) {await tree(page, mobile);await page.locator('.project-name').filter({hasText: name}).click();if (mobile) await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 1);}
async function record(page) {await page.locator('#voice-button').scrollIntoViewIfNeeded();await page.locator('#voice-button').click();await page.waitForFunction(() => document.querySelector('#voice-button').getAttribute('aria-pressed') === 'true');await page.waitForFunction(() => document.querySelector('#voice-preview').textContent.includes('Earlier synthetic'));return captures.at(-1);}
async function resourcesStopped(page) {await page.waitForFunction(() => window.fixtureStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')) && window.fixtureAudio.every(audio => audio.state === 'closed'));}
async function layout(page, name) {
  const size = page.viewportSize();
  const bounds = await page.evaluate(() => {const input = document.querySelector('#composer-form').getBoundingClientRect(), button = document.querySelector('#voice-button').getBoundingClientRect();return {width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, input: {x: input.x, y: input.y, right: input.right, bottom: input.bottom}, mic: {x: button.x, right: button.right, y: button.y, bottom: button.bottom}};});
  assert.equal(bounds.width, size.width);assert.equal(bounds.height, size.height);assert(bounds.mic.x >= 0 && bounds.mic.right <= size.width);
  if (size.height > 500) assert(bounds.input.y >= 0 && bounds.input.bottom <= size.height);
  results.push({name, layout: bounds});
}
async function run(name, viewport) {
  const mobile = viewport.width < 700, context = await browser.newContext({viewport, isMobile: mobile, hasTouch: mobile, permissions: ['microphone']});
  const page = await context.newPage();page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(10000);page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.fixtureStreams = [];window.fixtureAudio = [];
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia = async options => {const stream = await get(options);window.fixtureStreams.push(stream);return stream;};
    const NativeAudio = window.AudioContext;window.AudioContext = class extends NativeAudio {constructor(options) {super(options);window.fixtureAudio.push(this);}};
  });
  await page.goto('http://127.0.0.1:' + server.address().port, {waitUntil: 'networkidle'});
  await page.locator('#login-button').click();await page.locator('#password').fill('synthetic-fixture');await page.locator('#login-submit').click();
  await page.waitForFunction(() => document.querySelector('#login-overlay').hidden && !document.querySelector('#voice-button').disabled);
  await page.locator('#composer-input').fill('Existing Alpha draft');const capture = await record(page);
  assert.equal(await page.locator('#send-button').isDisabled(), true);
  await page.locator('#composer-form').evaluate(form => form.dispatchEvent(new Event('submit', {cancelable: true})));
  assert.equal(writes.length, 0);assert.equal(await page.locator('#composer-input').inputValue(), 'Existing Alpha draft');
  await layout(page, name + ' recording');await page.screenshot({path: output + '-' + name + '-recording.png'});
  await project(page, 'Fixture Beta', mobile);await page.locator('#composer-input').fill('Keep Beta draft');await page.locator('#voice-button').click();
  await page.waitForFunction(() => document.querySelector('#feedback').textContent.includes('尚未提交'));
  assert.equal(await page.locator('#composer-input').inputValue(), 'Keep Beta draft');assert.equal(await page.evaluate(() => sessionStorage.getItem('voxcode:draft:mac::alpha::new:')), 'Existing Alpha draft\n' + capture.text);assert.equal(capture.context.projectId, 'alpha');assert.equal(capture.context.executionTarget, 'mac');assert(capture.frames > 0);await resourcesStopped(page);
  await project(page, 'Fixture Alpha', mobile);assert.equal(await page.locator('#composer-input').inputValue(), 'Existing Alpha draft\n' + capture.text);
  await tree(page, mobile);await page.locator('.task-label').filter({hasText: 'Fixture task A'}).click();if (mobile) await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 1);
  await page.locator('#composer-input').fill('Task A saved input');const taskCapture = await record(page);
  await tree(page, mobile);await page.locator('.task-label').filter({hasText: 'Fixture task B'}).click();if (mobile) await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 1);
  await page.locator('#composer-input').fill('Task B saved input');await page.locator('#voice-button').click();
  await page.waitForFunction(() => document.querySelector('#voice-button').getAttribute('aria-pressed') === 'false' && document.querySelector('#voice-cancel').hidden);
  assert.equal(await page.locator('#composer-input').inputValue(), 'Task B saved input');assert.equal(await page.evaluate(() => sessionStorage.getItem('voxcode:draft:mac::alpha::task-a')), 'Task A saved input\n' + taskCapture.text);assert.equal(taskCapture.context.taskId, 'task-a');assert.equal(taskCapture.context.executionTarget, 'mac');await resourcesStopped(page);
  await record(page);await page.locator('#voice-cancel').click();await resourcesStopped(page);assert.equal(await page.locator('#composer-input').inputValue(), 'Task B saved input');
  await record(page);await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {configurable: true, get: () => true});Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'});
    document.dispatchEvent(new Event('visibilitychange'));
  });await resourcesStopped(page);assert.equal(await page.locator('#composer-input').inputValue(), 'Task B saved input');
  await page.evaluate(() => {delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
  await record(page);await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));await resourcesStopped(page);assert.equal(await page.locator('#composer-input').inputValue(), 'Task B saved input');
  await page.locator('#composer-input').scrollIntoViewIfNeeded();await layout(page, name + ' final');await page.screenshot({path: output + '-' + name + '-final.png'});
  await page.goto('http://127.0.0.1:' + server.address().port + '/denied', {waitUntil: 'networkidle'});await page.waitForFunction(() => !document.querySelector('#voice-button').disabled);await page.locator('#voice-button').scrollIntoViewIfNeeded();await page.locator('#voice-button').click();await page.waitForFunction(() => document.querySelector('#voice-state-label').textContent.includes('权限被拒绝'));await resourcesStopped(page);
  results.push({name, frozenProjectAndTask: true, preexistingDraftPreserved: true, exactPcmFrames: true, permissionDenial: true, abortIgnoresLateFinal: true, matchingCapturePreventsSubmit: true, hiddenReleasesResources: true, pagehideReleasesResources: true});
  await context.close();
}
try {
  server.listen(0, '127.0.0.1');await once(server, 'listening');
  browser = await chromium.launch({headless: true, ...(process.env.VOXCODE_PLAYWRIGHT_EXECUTABLE ? {executablePath: process.env.VOXCODE_PLAYWRIGHT_EXECUTABLE} : {}), args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']});
  for (const [name, viewport] of [['desktop', {width: 1440, height: 900}], ['mobile', {width: 390, height: 844}], ['landscape', {width: 844, height: 390}]]) await run(name, viewport);
  assert.equal(writes.length, 0);assert.deepEqual(errors, []);console.log(JSON.stringify({fixture: true, results, captureFrames: captures.map(capture => capture.frames), taskWrites: writes.length, errors}, null, 2));
} catch (error) {console.error(error.stack);process.exitCode = 1;} finally {
  await browser?.close();for (const ws of wss.clients) ws.terminate();await new Promise(resolve => wss.close(resolve));for (const socket of sockets) socket.destroy();await new Promise(resolve => server.close(resolve));
  await writeFile(output + '-results.json', JSON.stringify({fixture: true, results, captureFrames: captures.map(capture => capture.frames), taskWrites: writes.length, errors}, null, 2));
}
