import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile,writeFile} from 'node:fs/promises';

if(!process.env.VOXCODE_PLAYWRIGHT_MODULE)throw Error('Set VOXCODE_PLAYWRIGHT_MODULE to a local Playwright module');
const {chromium}=await import(process.env.VOXCODE_PLAYWRIGHT_MODULE);
const output=process.env.VOXCODE_WORKSPACE_FIXTURE_OUTPUT??'/private/tmp/workspace-conversations-124';
const files=new Map(await Promise.all(['index.html','voice-client.mjs','voice-worklet.js'].map(async name=>['/'+name,await readFile(new URL('../public/'+name,import.meta.url))])));
const sessionId='12345678-1234-4234-8234-123456789abc',projects=[{id:'alpha',name:'Fixture Alpha',enabled:true},{id:'beta',name:'Fixture Beta',enabled:true}];
const initial=()=>[
 {id:'one',projectId:'alpha',title:'Same-session conversation',status:'completed',revision:3,metadataRevision:1,sessionId,output:'Original result',logs:[],createdAt:'2026-10-24T00:00:00.000Z',turns:[{id:'first',prompt:'Original request',output:'Original result',status:'completed',logs:[],createdAt:'2026-10-24T00:00:00.000Z'}]},
 {id:'legacy',projectId:'alpha',title:'Saved unexecuted task',status:'draft',revision:1,metadataRevision:1,prompt:'Saved original request',output:'',logs:[],createdAt:'2026-10-23T00:00:00.000Z',turns:[{id:'legacy-first',prompt:'Saved original request',output:'',status:'draft',logs:[]}]}
];
let tasks=[],browser,releaseDelayed=null,delayNext=false,failNext=false,continuationReads=0;
const requests=[],errors=[],results=[],sockets=new Set(),receipts=new Map();
const json=(res,status,value,headers={})=>{res.writeHead(status,{'content-type':'application/json',...headers});res.end(JSON.stringify(value));};
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://fixture.invalid');
 if(files.has(url.pathname)||!url.pathname.startsWith('/api/')){const path=files.has(url.pathname)?url.pathname:'/index.html';res.writeHead(200,{'content-type':path.endsWith('.html')?'text/html; charset=utf-8':'text/javascript'});res.end(files.get(path));return;}
 if(url.pathname==='/api/health')return json(res,200,{simulation:true,executionHost:'mac',deviceOnline:true,voiceAvailable:false});
 if(url.pathname==='/api/login')return json(res,200,{ok:true},{'set-cookie':'fixture=workspace; HttpOnly; SameSite=Strict; Path=/'});
 if(!String(req.headers.cookie).includes('fixture=workspace'))return json(res,401,{});
 if(url.pathname==='/api/devices')return json(res,200,{deviceId:'fixture-mac',devices:[{deviceId:'fixture-mac',online:true}]});
 if(url.pathname==='/api/projects')return json(res,200,{projects});
 if(url.pathname==='/api/tasks'&&req.method!=='POST')return json(res,200,{tasks:tasks.filter(task=>task.projectId===url.searchParams.get('projectId')).map(({turns,prompt,output,logs,...task})=>task)});
 const task=tasks.find(task=>url.pathname==='/api/tasks/'+task.id||url.pathname.startsWith('/api/tasks/'+task.id+'/'));
 if(req.method!=='POST'){
  if(task?.status==='running'&&task.id==='one'&&++continuationReads>=2){
   task.output='Live fixture result';task.logs=[{type:'item.completed',itemType:'command_execution',command:'npm test -- '+('long-command-argument-'.repeat(12)),output:'Actual synthetic command output: 1 passed',exitCode:0,at:'2026-10-25T00:01:00.000Z'},{type:'item.completed',itemType:'file_change',changes:[{path:'src/'+('long-directory/'.repeat(10))+'index.js',kind:'update'}],at:'2026-10-25T00:02:00.000Z'}];
  }
  return json(res,task?200:404,task??{});
 }
 let body='';for await(const chunk of req)body+=chunk;const payload=JSON.parse(body);requests.push({path:url.pathname,payload});
 if(receipts.has(payload.requestId))return json(res,200,receipts.get(payload.requestId));
 if(!task||payload.projectId!==task.projectId)return json(res,404,{});
 const loseAcknowledgement=failNext;failNext=false;
 if(delayNext){delayNext=false;await new Promise(resolve=>releaseDelayed=resolve);releaseDelayed=null;}
 if(url.pathname.endsWith('/continue')){
  assert.deepEqual(Object.keys(payload).sort(),['projectId','prompt','requestId','revision']);assert.equal(payload.revision,task.revision);assert(['completed','cancelled','failed'].includes(task.status));
  task.turns.push({id:'turn-'+task.turns.length,prompt:payload.prompt,output:'',logs:[],status:'running',createdAt:'2026-10-25T00:00:00.000Z'});task.status='running';task.revision+=2;task.output='';task.logs=[];continuationReads=0;
 }else if(url.pathname.endsWith('/confirm')){assert.equal(task.status,'draft');assert.equal(payload.revision,task.revision);task.status='running';task.revision++;}
 else if(url.pathname.endsWith('/cancel')){task.status='cancelled';task.revision++;}
 else return json(res,404,{});
 if(loseAcknowledgement){task.status='completed';task.revision++;task.output='Committed before lost acknowledgement';task.turns.at(-1).status='completed';}
 const result=structuredClone(task);receipts.set(payload.requestId,result);return json(res,200,result);
});
server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
async function chooseTask(page,id){await page.locator('#task-tabs [data-task-id="'+id+'"] .tab-name').click();await page.waitForFunction(id=>document.querySelector('#task-title').textContent===(id==='one'?'Same-session conversation':'Saved unexecuted task'),id);}
async function chooseProject(page,name,mobile){if(mobile)await page.locator('#open-tree').click();await page.locator('.project-name').filter({hasText:name}).click();if(mobile)await page.waitForFunction(()=>!document.body.classList.contains('tree-open'));}
async function layout(page,name){
 if(page.viewportSize().height<=500)await page.locator('#composer-form').scrollIntoViewIfNeeded();
 const viewport=page.viewportSize(),bounds=await page.evaluate(()=>{
  const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
  const bad=[...document.querySelectorAll('#messages .message-body,#messages pre,#messages .event-file')].filter(node=>node.scrollWidth>node.clientWidth+1).map(node=>node.className);
  return {width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,composer:box('#composer-form'),messages:box('#messages'),tabs:box('.task-navigation'),recovery:document.querySelector('#submission-recovery').hidden?null:box('#retry-submission'),bad};
 });
 assert.equal(bounds.width,viewport.width);assert.equal(bounds.height,viewport.height);assert.deepEqual(bounds.bad,[]);assert(bounds.composer.left>=0&&bounds.composer.right<=viewport.width);assert(bounds.composer.bottom<=viewport.height);assert(bounds.composer.top>=bounds.tabs.bottom);assert(bounds.messages.bottom<=bounds.composer.top);if(bounds.recovery){assert(bounds.recovery.top>=bounds.tabs.bottom);assert(bounds.recovery.bottom<=viewport.height);assert(bounds.recovery.left>=0&&bounds.recovery.right<=viewport.width);}results.push({name,bounds});
}
async function run(name,viewport){
 tasks=initial();receipts.clear();const start=requests.length,mobile=viewport.width<=700,context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile}),page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});await page.locator('#login-button').click();await page.locator('#password').fill('fixture-only');await page.locator('#login-submit').click();await page.waitForFunction(()=>document.querySelector('#login-overlay').hidden&&document.querySelector('#tab-count').textContent==='2');
 await chooseTask(page,'one');await page.waitForFunction(()=>document.querySelector('#messages').textContent.includes('Original request'));assert.equal(await page.locator('#send-button').isDisabled(),false);
 await page.locator('#composer-input').fill('Adjust the original result');await page.locator('#send-button').click();await page.waitForFunction(()=>document.querySelector('#detail-status').textContent==='执行中');
 assert.equal(requests.length-start,1);assert.equal(requests.at(-1).path,'/api/tasks/one/continue');assert.equal(requests.at(-1).payload.revision,3);assert.equal(tasks[0].sessionId,sessionId);assert.equal(tasks[0].turns.length,2);assert.equal(await page.locator('#send-button').isDisabled(),true);
 await page.waitForFunction(()=>document.querySelector('#messages').textContent.includes('Actual synthetic command output'));const text=await page.locator('#messages').textContent();for(const value of ['Original request','Original result','Adjust the original result','Live fixture result','src/','退出码 0'])assert(text.includes(value),value);
 assert.equal(await page.locator('#messages button').filter({hasText:'停止任务'}).count(),1);await layout(page,name+' running');await page.screenshot({path:output+'-'+name+'-running.png'});
 tasks[0].status='completed';tasks[0].revision++;tasks[0].output='Completed fixture result';await page.waitForFunction(()=>document.querySelector('#messages').textContent.includes('Completed fixture result'));assert.equal(await page.locator('#send-button').isDisabled(),false);
 await page.route('**/api/tasks/one/continue',async route=>{await route.fetch();await route.abort('failed');},{times:1});
 failNext=true;await page.locator('#composer-input').fill('Retry safely');await page.locator('#send-button').click();await page.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('网络连接中断'));const failed=requests.at(-1);assert.equal(await page.locator('#composer-input').inputValue(),'Retry safely');
 await page.waitForFunction(()=>document.querySelector('#messages').textContent.includes('Committed before lost acknowledgement'));assert.equal(tasks[0].turns.length,3);assert(tasks[0].revision>failed.payload.revision);
 await page.locator('#composer-input').fill('Later edited turn');const beforeRecovery=requests.length;await page.locator('#send-button').click();await page.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('核对上次发送'));assert.equal(requests.length,beforeRecovery);assert.equal(await page.locator('#retry-submission').isVisible(),true);await layout(page,name+' recovery');await page.screenshot({path:output+'-'+name+'-recovery.png'});
 await page.locator('#retry-submission').click();await page.waitForFunction(()=>document.querySelector('#submission-recovery').hidden);assert.deepEqual(requests.at(-1),failed);assert.equal(tasks[0].turns.length,3);assert.equal(await page.locator('#composer-input').inputValue(),'Later edited turn');
 await page.locator('#send-button').click();await page.waitForFunction(()=>document.querySelector('#detail-status').textContent==='执行中');assert.equal(requests.at(-1).payload.prompt,'Later edited turn');assert.notEqual(requests.at(-1).payload.requestId,failed.payload.requestId);assert.equal(tasks[0].turns.length,4);
 await page.locator('#messages button').filter({hasText:'停止任务'}).click();await page.waitForFunction(()=>document.querySelector('#detail-status').textContent==='已停止');
 delayNext=true;await page.locator('#composer-input').fill('Delayed Alpha follow-up');await page.locator('#send-button').click();await page.waitForFunction(()=>document.querySelector('#send-button').disabled);while(!releaseDelayed)await new Promise(resolve=>setTimeout(resolve,5));
 await chooseProject(page,'Fixture Beta',mobile);await page.locator('#composer-input').fill('Preserve Beta input');releaseDelayed();await page.waitForFunction(()=>document.querySelector('#send-button').textContent.includes('发送')&&!document.querySelector('#send-button').disabled);assert.equal(await page.locator('#composer-input').inputValue(),'Preserve Beta input');assert.equal(await page.locator('#breadcrumb-project').textContent(),'Fixture Beta');
 await chooseTask(page,'legacy');await page.waitForFunction(()=>document.querySelector('#messages').textContent.includes('Saved original request'));const before=requests.length;await page.locator('#composer-input').fill('Preserve later input');assert.equal(requests.length,before);await page.locator('.conversation-execute button').click();await page.waitForFunction(()=>document.querySelector('#detail-status').textContent==='执行中');assert.equal(requests.at(-1).path,'/api/tasks/legacy/confirm');assert.equal(await page.locator('#composer-input').inputValue(),'Preserve later input');
 await layout(page,name+' final');await page.screenshot({path:output+'-'+name+'-final.png'});assert(requests.slice(start).every(request=>request.path!=='/api/tasks/one/confirm'));
 results.push({name,directSend:true,sameSession:true,fullHistorySurvivesSummaries:true,selectedTaskPolling:true,realEventFields:true,lostAcknowledgementAfterCommit:true,uncertainRetryIdentity:true,editedInputSurvivesRecovery:true,laterNewTurn:true,delayedTargetPreserved:true,legacyRunsOnlyOnClick:true});await context.close();
}
try{
 server.listen(0,'127.0.0.1');await once(server,'listening');browser=await chromium.launch({headless:true,...(process.env.VOXCODE_PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.VOXCODE_PLAYWRIGHT_EXECUTABLE}:{})});
 for(const [name,viewport]of[['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}],['narrow',{width:320,height:740}],['landscape',{width:844,height:390}]])await run(name,viewport);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({fixture:true,results,errors},null,2));
}catch(error){console.error(error.stack);process.exitCode=1;}finally{
 await browser?.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await writeFile(output+'-results.json',JSON.stringify({fixture:true,results,errors},null,2));
}
