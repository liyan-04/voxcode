import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile,writeFile} from 'node:fs/promises';

if(!process.env.VOXCODE_PLAYWRIGHT_MODULE)throw Error('Set VOXCODE_PLAYWRIGHT_MODULE to a local Playwright module');
const {chromium}=await import(process.env.VOXCODE_PLAYWRIGHT_MODULE);
const output=process.env.VOXCODE_EXECUTION_TARGET_FIXTURE_OUTPUT??'/private/tmp/execution-target-login-131';
const files=new Map(await Promise.all(['index.html','voice-client.mjs','voice-worklet.js'].map(async name=>['/'+name,await readFile(new URL('../public/'+name,import.meta.url))])));
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
const requests=[],results=[],errors=[],sockets=new Set();let browser,projectGate,projectSeen,holdProjects=false,selectorMode=false,inventoryRows=[],tasksByTarget={},delayMutation=false,mutationGate,mutationSeen;
const receipts=new Map();
const targetRows=()=>[{id:'mac',kind:'remote',name:'Mac Codex',configured:true,online:false,available:false,observedAt:'2026-10-25T00:00:00.000Z'},{id:'server',kind:'local',name:'Server Codex',configured:true,online:true,available:true,observedAt:'2026-10-25T00:00:00.000Z'}];
const initialTask=target=>({id:'one',projectId:'same',title:target==='mac'?'Mac conversation':'Server conversation',status:'completed',revision:3,metadataRevision:1,sessionId:'12345678-1234-4234-8234-123456789abc',output:target+' original output',turns:[{id:'first',prompt:target+' original instruction',output:target+' original output',status:'completed'}]});
const json=(res,status,value,headers={})=>{res.writeHead(status,{'content-type':'application/json',...headers});res.end(JSON.stringify(value));};
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://fixture.invalid');
 if(!url.pathname.startsWith('/api/')){const path=files.has(url.pathname)?url.pathname:'/index.html';res.writeHead(200,{'content-type':path.endsWith('.html')?'text/html; charset=utf-8':'text/javascript'});res.end(files.get(path));return;}
 requests.push({path:url.pathname,url:url.pathname+url.search,method:req.method});
 if(url.pathname==='/api/health')return json(res,200,{simulation:true,executionHost:'mac',deviceOnline:false,voiceAvailable:false});
 if(url.pathname==='/api/login'){
  let body='';for await(const chunk of req)body+=chunk;
  return JSON.parse(body).password==='fixture-password'?json(res,200,{ok:true},{'set-cookie':'fixture=authenticated; HttpOnly; SameSite=Strict; Path=/'}):json(res,401,{error:'invalid credentials'});
 }
 if(!String(req.headers.cookie).includes('fixture=authenticated'))return json(res,401,{error:'unauthenticated'});
 if(url.pathname==='/api/execution-targets')return json(res,200,{targets:selectorMode?inventoryRows:[{id:'mac',kind:'remote',name:'Mac Codex',configured:true,online:false,available:false,observedAt:'2026-10-25T00:00:00.000Z'},{id:'server',kind:'local',name:'Server Codex',configured:false,online:false,available:false,observedAt:null}]});
 if(selectorMode&&/^\/api\/(projects|tasks)([/?]|$)/u.test(url.pathname)){
  assert.equal(url.searchParams.getAll('executionTarget').length,1);const target=url.searchParams.get('executionTarget');assert(['mac','server'].includes(target));const task=tasksByTarget[target];
  if(url.pathname==='/api/projects')return json(res,200,{projects:[{id:'same',name:'Shared project',enabled:true}]});
  if(req.method==='GET')return json(res,200,url.pathname==='/api/tasks'?{tasks:[task]}:task);
  let body='';for await(const chunk of req)body+=chunk;const payload=JSON.parse(body),key=target+':'+payload.requestId;requests.at(-1).payload=payload;
  if(receipts.has(key)){assert.deepEqual(receipts.get(key),payload);return json(res,200,task);}
  if(delayMutation&&target==='mac'){delayMutation=false;mutationSeen.resolve();await mutationGate.promise;}
  assert.equal(url.pathname,'/api/tasks/one/continue');assert.equal(payload.projectId,'same');assert.equal(payload.revision,task.revision);task.turns.push({id:'turn-'+task.turns.length,prompt:payload.prompt,output:target+' completed output',status:'completed'});task.revision+=3;task.output=target+' completed output';receipts.set(key,payload);return json(res,200,task);
 }
 if(url.pathname==='/api/projects'){projectSeen?.resolve();if(holdProjects)await projectGate.promise;return json(res,503,{code:'offline'});}
 if(url.pathname==='/api/devices')return json(res,503,{code:'offline'});
 return json(res,404,{});
});
server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
async function bounds(page){
 const viewport=page.viewportSize(),value=await page.evaluate(()=>{
  const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
  return {width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,composer:box('#composer-form'),feedback:box('#feedback'),login:box('#login-button')};
 });
 assert.equal(value.width,viewport.width);assert.equal(value.height,viewport.height);
 for(const box of [value.composer,value.feedback,value.login]){assert(box.left>=0&&box.right<=viewport.width);assert(box.top>=0&&box.bottom<=viewport.height);}
 return value;
}
async function run(name,viewport){
 selectorMode=false;
 holdProjects=true;projectGate=deferred();projectSeen=deferred();const context=await browser.newContext({viewport,isMobile:true,hasTouch:true}),page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});await page.locator('#login-button').click();await page.locator('#password').fill('wrong');await page.locator('#login-submit').click();await page.waitForFunction(()=>document.querySelector('#login-error').textContent.includes('密码'));assert.equal(await page.locator('#login-overlay').isVisible(),true);await page.screenshot({path:output+'-'+name+'-invalid-password.png'});
 await page.locator('#password').fill('fixture-password');await page.locator('#login-submit').click();await projectSeen.promise;
 await page.waitForFunction(()=>document.querySelector('#login-overlay').hidden&&document.querySelector('#login-button').textContent==='已登录');assert.equal(await page.locator('#login-submit').isDisabled(),false);assert.equal(await page.locator('#password').inputValue(),'');assert.equal(await page.locator('#login-error').textContent(),'');await page.screenshot({path:output+'-'+name+'-projects-pending.png'});
 holdProjects=false;projectGate.resolve();await page.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('工作空间加载失败'));assert.equal(await page.locator('#login-overlay').isHidden(),true);assert.equal(await page.locator('#login-button').textContent(),'已登录');const failedBounds=await bounds(page);await page.screenshot({path:output+'-'+name+'-projects-failed.png'});
 const beforeReload=requests.length;await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelector('#login-button').textContent==='已登录'&&document.querySelector('#feedback').textContent.includes('工作空间加载失败'));assert.equal(await page.locator('#login-overlay').isHidden(),true);
 const discovery=requests.slice(beforeReload).filter(request=>request.path!=='/api/health');assert.equal(discovery[0].path,'/api/execution-targets');assert.equal(discovery.some(request=>request.path==='/api/login'),false);const restoredBounds=await bounds(page);await page.screenshot({path:output+'-'+name+'-session-restored.png'});
 results.push({name,validLoginWithOfflineMac:true,modalClosedBeforeProjects:true,workspaceFailureKeepsLogin:true,inventoryRestoresSession:true,invalidPasswordRemainsLoginError:true,failedBounds,restoredBounds});await context.close();
}
async function selectorBounds(page){
 if(page.viewportSize().height<=500)await page.locator('#composer-form').scrollIntoViewIfNeeded();
 const viewport=page.viewportSize(),value=await page.evaluate(()=>{const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};return {width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,selector:box('#execution-target'),tabs:box('.task-navigation'),composer:box('#composer-form'),send:box('#send-button'),recovery:document.querySelector('#submission-recovery').hidden?null:box('#retry-submission')};});
 assert.equal(value.width,viewport.width);assert.equal(value.height,viewport.height);for(const item of [value.selector,value.composer,value.send,...(value.recovery?[value.recovery]:[])]){assert(item.left>=0&&item.right<=viewport.width);assert(item.top>=0&&item.bottom<=viewport.height);}assert(value.composer.top>=value.tabs.bottom);if(value.recovery)assert(value.recovery.right<=value.send.left);return value;
}
async function selectTarget(page,target){await page.locator('#execution-target').selectOption(target);await page.waitForFunction(target=>document.querySelector('#execution-target').value===target,target);await page.waitForFunction(()=>document.querySelector('#tab-count').textContent==='1'||document.querySelector('#task-title').textContent.includes('conversation'));}
async function selectTask(page,target){await page.locator('#task-tabs [data-task-id="one"] .tab-name').click();await page.waitForFunction(target=>document.querySelector('#messages').textContent.includes(target+' original instruction'),target);}
async function checkbox(page,checked,mobile){if(mobile)await page.locator('#open-tree').click();await page.locator('[data-tab-project="same"]').setChecked(checked);if(mobile)await page.locator('#tree-backdrop').click({position:{x:page.viewportSize().width-8,y:page.viewportSize().height/2}});}
async function runSelector(name,viewport){
 selectorMode=true;inventoryRows=targetRows();tasksByTarget={mac:initialTask('mac'),server:initialTask('server')};receipts.clear();const start=requests.length,mobile=viewport.width<=700,context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile}),page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});await page.locator('#login-button').click();await page.locator('#password').fill('fixture-password');await page.locator('#login-submit').click();await page.waitForFunction(()=>document.querySelector('#login-overlay').hidden&&document.querySelector('#tab-count').textContent==='1');await selectTask(page,'mac');assert.equal(await page.locator('#send-button').isDisabled(),true);assert.equal(await page.locator('#execution-target').isDisabled(),false);await page.locator('#composer-input').fill('Mac private draft');await page.screenshot({path:output+'-'+name+'-mac-offline.png'});
 await selectTarget(page,'server');await selectTask(page,'server');assert.equal(await page.locator('#composer-input').inputValue(),'');assert.equal(await page.locator('#send-button').isDisabled(),false);await page.locator('#composer-input').fill('Server private draft');await checkbox(page,false,mobile);assert.equal(await page.locator('#tab-count').textContent(),'0');await selectTarget(page,'mac');assert.equal(await page.locator('#composer-input').inputValue(),'Mac private draft');assert.equal(await page.locator('#tab-count').textContent(),'1');await selectTarget(page,'server');assert.equal(await page.locator('#composer-input').inputValue(),'Server private draft');assert.equal(await page.locator('#tab-count').textContent(),'0');await checkbox(page,true,mobile);await selectTarget(page,'mac');
 inventoryRows[0].online=true;inventoryRows[0].available=true;await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>!document.querySelector('#send-button').disabled&&document.querySelector('#messages').textContent.includes('mac original instruction'));assert.equal(await page.locator('#composer-input').inputValue(),'Mac private draft');assert.equal(requests.slice(start).filter(item=>item.method==='POST'&&item.path!=='/api/login').length,0);
 await page.route(url=>url.pathname==='/api/tasks/one/continue'&&url.searchParams.get('executionTarget')==='mac',async route=>{await route.fetch();await route.abort('failed');},{times:1});await page.locator('#composer-input').fill('Execute once');await page.locator('#send-button').click();await page.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('网络连接中断'));const original=requests.findLast(item=>item.method==='POST'&&item.path==='/api/tasks/one/continue');assert.equal(tasksByTarget.mac.turns.length,2);await page.locator('#composer-input').fill('Later Mac edit');await selectTarget(page,'server');await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelector('#messages').textContent.includes('server original instruction'));assert.equal(await page.locator('#execution-target').inputValue(),'server');assert.equal(await page.locator('#composer-input').inputValue(),'Server private draft');await selectTarget(page,'mac');await page.waitForFunction(()=>!document.querySelector('#submission-recovery').hidden);assert.equal(await page.locator('#composer-input').inputValue(),'Later Mac edit');const recoveryBounds=await selectorBounds(page);await page.screenshot({path:output+'-'+name+'-recovery.png'});await page.locator('#retry-submission').click();await page.waitForFunction(()=>document.querySelector('#submission-recovery').hidden);assert.deepEqual(requests.findLast(item=>item.method==='POST'&&item.path==='/api/tasks/one/continue').payload,original.payload);assert.equal(tasksByTarget.mac.turns.length,2);assert.equal(await page.locator('#composer-input').inputValue(),'Later Mac edit');
 delayMutation=true;mutationGate=deferred();mutationSeen=deferred();await page.locator('#send-button').click();await mutationSeen.promise;await selectTarget(page,'server');await page.locator('#composer-input').fill('Server independent turn');await page.locator('#send-button').click();await page.waitForFunction(()=>document.querySelector('#composer-input').value==='');await page.locator('#composer-input').fill('Server newest draft');mutationGate.resolve();await page.waitForFunction(()=>document.querySelector('#execution-target').value==='server'&&!document.querySelector('#send-button').disabled);assert.equal(await page.locator('#composer-input').inputValue(),'Server newest draft');assert.equal(tasksByTarget.server.turns.length,2);await selectorBounds(page);await page.screenshot({path:output+'-'+name+'-server.png'});
 inventoryRows[1].configured=false;inventoryRows[1].available=false;await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelector('#execution-state').textContent.includes('未配置'));assert.equal(await page.locator('#execution-target option[value="server"]').isDisabled(),true);assert.equal(await page.locator('#send-button').isDisabled(),true);await selectorBounds(page);await page.screenshot({path:output+'-'+name+'-unconfigured.png'});
 results.push({name,selector:true,offlineMacAllowsServer:true,sameIDsIsolated:true,draftsAndCheckboxesRestored:true,noAutomaticExecution:true,unknownReplayAcrossReload:true,lateMutationIsolated:true,unconfiguredServerDisabled:true,recoveryBounds});await context.close();
}
try{
 server.listen(0,'127.0.0.1');await once(server,'listening');browser=await chromium.launch({headless:true,...(process.env.VOXCODE_PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.VOXCODE_PLAYWRIGHT_EXECUTABLE}:{})});
 for(const [name,viewport]of[['mobile',{width:390,height:844}],['narrow',{width:320,height:740}]])await run(name,viewport);
 for(const [name,viewport]of[['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}],['narrow',{width:320,height:740}],['landscape',{width:844,height:390}]])await runSelector(name,viewport);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({fixture:true,results,errors},null,2));
}catch(error){console.error(error.stack);process.exitCode=1;}finally{
 projectGate?.resolve();mutationGate?.resolve();await browser?.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await writeFile(output+'-results.json',JSON.stringify({fixture:true,results,errors},null,2));
}
