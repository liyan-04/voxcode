import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile,writeFile} from 'node:fs/promises';

if(!process.env.VOXCODE_PLAYWRIGHT_MODULE)throw Error('Set VOXCODE_PLAYWRIGHT_MODULE to a local Playwright module');
const {chromium}=await import(process.env.VOXCODE_PLAYWRIGHT_MODULE);
const output=process.env.VOXCODE_EXECUTION_TARGET_FIXTURE_OUTPUT??'/private/tmp/execution-target-login-131';
const files=new Map(await Promise.all(['index.html','voice-client.mjs','voice-worklet.js'].map(async name=>['/'+name,await readFile(new URL('../public/'+name,import.meta.url))])));
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
const requests=[],results=[],errors=[],sockets=new Set();let browser,projectGate,projectSeen,holdProjects=false;
const json=(res,status,value,headers={})=>{res.writeHead(status,{'content-type':'application/json',...headers});res.end(JSON.stringify(value));};
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://fixture.invalid');
 if(!url.pathname.startsWith('/api/')){const path=files.has(url.pathname)?url.pathname:'/index.html';res.writeHead(200,{'content-type':path.endsWith('.html')?'text/html; charset=utf-8':'text/javascript'});res.end(files.get(path));return;}
 requests.push({path:url.pathname,method:req.method});
 if(url.pathname==='/api/health')return json(res,200,{simulation:true,executionHost:'mac',deviceOnline:false,voiceAvailable:false});
 if(url.pathname==='/api/login'){
  let body='';for await(const chunk of req)body+=chunk;
  return JSON.parse(body).password==='fixture-password'?json(res,200,{ok:true},{'set-cookie':'fixture=authenticated; HttpOnly; SameSite=Strict; Path=/'}):json(res,401,{error:'invalid credentials'});
 }
 if(!String(req.headers.cookie).includes('fixture=authenticated'))return json(res,401,{error:'unauthenticated'});
 if(url.pathname==='/api/execution-targets')return json(res,200,{targets:[{id:'mac',kind:'remote',name:'Mac Codex',configured:true,online:false,available:false,observedAt:'2026-10-25T00:00:00.000Z'},{id:'server',kind:'local',name:'Server Codex',configured:false,online:false,available:false,observedAt:null}]});
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
 holdProjects=true;projectGate=deferred();projectSeen=deferred();const context=await browser.newContext({viewport,isMobile:true,hasTouch:true}),page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});await page.locator('#login-button').click();await page.locator('#password').fill('wrong');await page.locator('#login-submit').click();await page.waitForFunction(()=>document.querySelector('#login-error').textContent.includes('密码'));assert.equal(await page.locator('#login-overlay').isVisible(),true);await page.screenshot({path:output+'-'+name+'-invalid-password.png'});
 await page.locator('#password').fill('fixture-password');await page.locator('#login-submit').click();await projectSeen.promise;
 await page.waitForFunction(()=>document.querySelector('#login-overlay').hidden&&document.querySelector('#login-button').textContent==='已登录');assert.equal(await page.locator('#login-submit').isDisabled(),false);assert.equal(await page.locator('#password').inputValue(),'');assert.equal(await page.locator('#login-error').textContent(),'');await page.screenshot({path:output+'-'+name+'-projects-pending.png'});
 holdProjects=false;projectGate.resolve();await page.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('工作空间加载失败'));assert.equal(await page.locator('#login-overlay').isHidden(),true);assert.equal(await page.locator('#login-button').textContent(),'已登录');const failedBounds=await bounds(page);await page.screenshot({path:output+'-'+name+'-projects-failed.png'});
 const beforeReload=requests.length;await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelector('#login-button').textContent==='已登录'&&document.querySelector('#feedback').textContent.includes('工作空间加载失败'));assert.equal(await page.locator('#login-overlay').isHidden(),true);
 const discovery=requests.slice(beforeReload).filter(request=>request.path!=='/api/health');assert.equal(discovery[0].path,'/api/execution-targets');assert.equal(discovery.some(request=>request.path==='/api/login'),false);const restoredBounds=await bounds(page);await page.screenshot({path:output+'-'+name+'-session-restored.png'});
 results.push({name,validLoginWithOfflineMac:true,modalClosedBeforeProjects:true,workspaceFailureKeepsLogin:true,inventoryRestoresSession:true,invalidPasswordRemainsLoginError:true,failedBounds,restoredBounds});await context.close();
}
try{
 server.listen(0,'127.0.0.1');await once(server,'listening');browser=await chromium.launch({headless:true,...(process.env.VOXCODE_PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.VOXCODE_PLAYWRIGHT_EXECUTABLE}:{})});
 for(const [name,viewport]of[['mobile',{width:390,height:844}],['narrow',{width:320,height:740}]])await run(name,viewport);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({fixture:true,results,errors},null,2));
}catch(error){console.error(error.stack);process.exitCode=1;}finally{
 projectGate?.resolve();await browser?.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await writeFile(output+'-results.json',JSON.stringify({fixture:true,results,errors},null,2));
}
