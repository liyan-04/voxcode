import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const response=(body,status=200)=>({ok:status<400,status,json:async()=>structuredClone(body)});
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const inventory=()=>response({targets:[{id:'mac',kind:'remote',name:'Mac Codex',configured:true,online:false,available:false,observedAt:'2026-10-25T00:00:00.000Z'},{id:'server',kind:'local',name:'Server Codex',configured:false,online:false,available:false,observedAt:null}]});

async function pageFixture({discover=()=>response({},401),projects=()=>response({code:'offline'},503),login=()=>response({ok:true})}={}){
 class Node{
  constructor(){this.value='';this.textContent='';this.hidden=false;this.children=[];this.attributes=new Map();this.classList={add(){},remove(){},toggle(){}};this.style={};this.scrollLeft=0;this.scrollWidth=400;this.clientWidth=400;}
  append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}setAttribute(key,value){this.attributes.set(key,String(value));}addEventListener(){}focus(){}scrollTo({left}){this.scrollLeft=left;}
 }
 const nodes=new Map(),storage=new Map(),reads=[],writes=[],get=selector=>{if(!nodes.has(selector))nodes.set(selector,new Node());return nodes.get(selector);};get('#login-overlay').hidden=true;
 const context=vm.createContext({console,structuredClone,Date,Math,performance,setTimeout,clearTimeout,setInterval(){},clearInterval(){},crypto:{randomUUID:()=> 'fixture-request'},sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},
  document:{querySelector:get,querySelectorAll:()=>[],createElement:()=>new Node(),createElementNS:()=>new Node(),addEventListener(){},body:new Node(),visibilityState:'visible'},window:{addEventListener(){},innerWidth:390,innerHeight:844},
  fetch:async(path,options={})=>{
   if(options.method==='POST'){writes.push({path,payload:JSON.parse(options.body)});return login();}
   reads.push(path);
   if(path==='/api/health')return response({executionHost:'mac',deviceOnline:false,simulation:false,voiceAvailable:false});
   if(path==='/api/execution-targets')return discover();
   if(path==='/api/devices')return response({code:'offline'},503);
   if(path==='/api/projects')return projects();
   if(path.startsWith('/api/tasks?'))return response({tasks:[]});
   return response({},404);
  }});
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');vm.runInContext(html.split('<script>')[1].split('</script>')[0],context);
 const run=source=>vm.runInContext(source,context);await flush();return {run,get,reads,writes,login:()=>{get('#login-button').onclick();get('#password').value='fixture-password';return get('#login-form').onsubmit({preventDefault(){}});}};
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
 const gate=deferred(),f=await pageFixture({discover:()=>gate.promise});await f.login();gate.resolve(response({},401));await flush();assert.equal(f.run('state.authenticated'),true);assert.equal(f.get('#login-overlay').hidden,true);assert.equal(f.get('#login-button').textContent,'已登录');
});
test('invalid credentials keep the login modal and report a password error',async()=>{
 const f=await pageFixture({login:()=>response({error:'invalid credentials'},401)});await f.login();assert.equal(f.run('state.authenticated'),false);assert.equal(f.get('#login-overlay').hidden,false);assert.equal(f.get('#password').value,'fixture-password');assert.match(f.get('#login-error').textContent,/密码/);assert.equal(f.get('#login-submit').disabled,false);
});
