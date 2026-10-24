import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocketServer} from 'ws';
import {createMcpDispatcher} from '../mcp-server.mjs';
import {createMcpProxyBridge} from '../mcp-proxy-bridge.mjs';
const rpc=(id,method='ping',params={})=>({jsonrpc:'2.0',id,method,params});
async function fixture(t,options={}){
 const server=new WebSocketServer({port:0,host:'127.0.0.1'});await once(server,'listening');const connected=once(server,'connection');
 const bridge=createMcpProxyBridge({endpoint:`ws://127.0.0.1:${server.address().port}`,retryMinMs:5,retryMaxMs:5,...options});bridge.start();const [ws]=await connected;
 t.after(async()=>{await bridge.close();for(const client of server.clients)client.terminate();await new Promise(r=>server.close(r));});return {server,bridge,ws};
}
async function request(ws,msg){return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>finish(Error('Response deadline')),1000);const message=data=>{const value=JSON.parse(data);if(value.id===msg.id)finish(null,value);};const close=code=>finish(Error(`Socket closed ${code}`));
 function finish(error,value){clearTimeout(timer);ws.off('message',message);ws.off('close',close);if(error)reject(error);else resolve(value);}ws.on('message',message);ws.on('close',close);ws.send(JSON.stringify(msg));
});}
test('real WS initialize, tools, status and same-connection draft retry are deduplicated',async t=>{
 let drafts=0;const registry={listProjects:async()=>[{id:'p1',name:'One',enabled:true}],getProject:async id=>id==='p1'?{id,enabled:true}:null};const mcp=createMcpDispatcher({adapter:{...registry,status:()=>({cli:true}),startTask:()=>({taskId:`draft-${++drafts}`})},authorizeWrite:async()=>true});const {ws}=await fixture(t,{dispatch:mcp.dispatch});
 assert.ok((await request(ws,rpc(1,'initialize'))).result.serverInfo);assert.ok((await request(ws,rpc(2,'tools/list'))).result.tools.some(x=>x.name==='codex_start_task'));assert.ok((await request(ws,rpc(3,'tools/call',{name:'codex_status'}))).result);
 const draft=rpc(4,'tools/call',{name:'codex_start_task',arguments:{projectId:'p1',prompt:'draft only',requestId:'draft-1'}});assert.ok((await request(ws,draft)).result);await request(ws,draft);assert.equal(drafts,1);
});
test('completed cache evicts instead of permanently closing after 256 requests',async t=>{
 let calls=0;const {ws}=await fixture(t,{dispatch:async msg=>({jsonrpc:'2.0',id:msg.id,result:{count:++calls}})});for(let id=0;id<300;id++)assert.equal((await request(ws,rpc(id))).result.count,id+1);assert.equal(ws.readyState,1);assert.equal(calls,300);
});
test('reconnect resets request IDs rather than replaying the prior connection response',async t=>{
 let calls=0;const {server,ws}=await fixture(t,{dispatch:async msg=>({jsonrpc:'2.0',id:msg.id,result:{call:++calls,method:msg.method}})});assert.equal((await request(ws,rpc(1,'initialize'))).result.call,1);
 const reconnected=once(server,'connection');ws.close();const [next]=await reconnected;const result=await request(next,rpc(1,'tools/list'));assert.equal(result.result.call,2);assert.equal(result.result.method,'tools/list');
});
test('conflicting same-connection reuse closes without dispatching a second mutation',async t=>{
 let calls=0;const {ws}=await fixture(t,{dispatch:async msg=>({jsonrpc:'2.0',id:msg.id,result:++calls})});await request(ws,rpc(1));const closed=once(ws,'close');ws.send(JSON.stringify(rpc(1,'changed')));assert.equal((await closed)[0],1008);assert.equal(calls,1);
});
test('timed out handlers retain capacity across reconnect until underlying dispatch settles',async t=>{
 let calls=0;const resolvers=[];const {server,ws}=await fixture(t,{timeoutMs:25,maxInflight:2,dispatch:msg=>{calls++;return new Promise(resolve=>resolvers.push(()=>resolve({jsonrpc:'2.0',id:msg.id,result:{}})));}});t.after(()=>resolvers.forEach(resolve=>resolve()));
 const first=request(ws,rpc(1)),second=request(ws,rpc(2));assert.equal((await first).error.message,'Request timed out');assert.equal((await second).error.message,'Request timed out');
 const connected=once(server,'connection');ws.close();const [next]=await connected;const closed=once(next,'close');next.send(JSON.stringify(rpc(3)));assert.equal((await closed)[0],1013);assert.equal(calls,2);
});
test('notifications consume the same underlying handler budget',async t=>{
 let calls=0;const resolvers=[];const {ws}=await fixture(t,{timeoutMs:100,maxInflight:2,dispatch:()=>{calls++;return new Promise(resolve=>resolvers.push(resolve));}});t.after(()=>resolvers.forEach(resolve=>resolve(null)));const closed=once(ws,'close');
 for(let n=0;n<3;n++)ws.send(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}));assert.equal((await closed)[0],1013);assert.equal(calls,2);
});
test('repeated pending IDs do not dispatch duplicate handlers',async t=>{
 let calls=0,release;const {ws}=await fixture(t,{dispatch:msg=>{calls++;return new Promise(resolve=>{release=()=>resolve({jsonrpc:'2.0',id:msg.id,result:{}});});}});const response=request(ws,rpc(1));for(let n=0;n<20;n++)ws.send(JSON.stringify(rpc(1)));await delay(10);release();assert.ok((await response).result);assert.equal(calls,1);
});
test('malformed notifications close the connection without unbounded dispatch',async t=>{
 let calls=0;const {ws}=await fixture(t,{dispatch:async()=>{calls++;}});const closed=once(ws,'close');ws.send('null');assert.equal((await closed)[0],1008);assert.equal(calls,0);
});
test('cache byte budget evicts completed replies while newest retry stays deduplicated',async t=>{
 let calls=0;const {ws}=await fixture(t,{maxCacheBytes:1024*1024,dispatch:async msg=>({jsonrpc:'2.0',id:msg.id,result:{count:++calls,padding:'x'.repeat(600000)}})});
 await request(ws,rpc(1));await request(ws,rpc(2));assert.equal((await request(ws,rpc(2))).result.count,2);
 assert.equal((await request(ws,rpc(1))).result.count,3);
});
test('settled handlers free timed-out capacity without replaying timed-out response',async t=>{
 let release,calls=0;const {ws}=await fixture(t,{maxInflight:1,timeoutMs:20,dispatch:msg=>{calls++;if(msg.id===1)return new Promise(resolve=>{release=()=>resolve({jsonrpc:'2.0',id:1,result:'late'});});return {jsonrpc:'2.0',id:msg.id,result:'next'};}});
 const first=await request(ws,rpc(1));assert.equal(first.error.message,'Request timed out');release();await delay(1);
 assert.deepEqual(await request(ws,rpc(1)),first);assert.equal((await request(ws,rpc(2))).result,'next');assert.equal(calls,2);
});
test('binary frames, malformed JSON, handler rejection and oversized replies stay bounded',async t=>{
 const binary=await fixture(t,{dispatch:async()=>null});const binaryClosed=once(binary.ws,'close');binary.ws.send(Buffer.from([1]));assert.equal((await binaryClosed)[0],1003);
 const malformed=await fixture(t,{dispatch:async()=>null});const malformedClosed=once(malformed.ws,'close');malformed.ws.send('{');assert.equal((await malformedClosed)[0],1007);
 const rejected=await fixture(t,{dispatch:async()=>{throw Error('PRIVATE_SECRET');}});assert.equal((await request(rejected.ws,rpc(1))).error.message,'Request failed');
 const huge=await fixture(t,{dispatch:async msg=>({jsonrpc:'2.0',id:msg.id,result:'x'.repeat(1024*1024)})});assert.equal((await request(huge.ws,rpc(1))).error.message,'Response too large');
});
test('bridge rejects plaintext remote endpoints and invalid handler limits',()=>{
 assert.throws(()=>createMcpProxyBridge({endpoint:'ws://example.com',dispatch:()=>{}}),/WSS endpoint/);
 assert.throws(()=>createMcpProxyBridge({endpoint:'wss://example.com',dispatch:()=>{},maxInflight:0}),/Invalid bridge limits/);
});
