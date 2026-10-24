import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer as httpServer, request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createServer} from '../../mac/server.mjs';
import {createRelay} from '../relay.mjs';
import {createConnector} from '../connector.mjs';
import {route} from '../protocol.mjs';

const machineId='monitor-machine',machineKey='monitor-machine-key-with-at-least-32-characters';
const relayKeys=['connected','uptimeSeconds','inFlight','requestsTotal','responsesTotal','errorsTotal','timeoutsTotal','latencySamples','latencyP50Ms','latencyP95Ms'].sort();
async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;}
async function fixture(t,{handler,relay:relayOptions,connector:connectorOptions}={}){
  const dataDir=await mkdtemp(join(tmpdir(),'vox-monitor-'));
  const app=createServer({project:tmpdir(),dataDir,executor(){},prepareWorktree:(_,id)=>join(tmpdir(),id)});
  const bridge=handler?httpServer(handler):app.server;
  const bridgeURL=await listen(bridge);
  const relay=createRelay({machineId,machineKey,...relayOptions});const base=await listen(relay.server);
  let connector;
  t.after(async()=>{await connector?.close();await relay.close();bridge.closeAllConnections();await new Promise(resolve=>bridge.close(resolve));await app.service.close();await rm(dataDir,{recursive:true,force:true});});
  const call=async(path='/api/monitor',token,extra={})=>{const response=await fetch(base+path,{...extra,headers:{...(token?{authorization:`Bearer ${token}`} :{}),...extra.headers}});return {status:response.status,headers:response.headers,body:await response.json()};};
  return {app,relay,base,call,async connect(){connector=createConnector({machineId,machineKey,bridgeURL,relayURL:base.replace('http:','ws:')+'/connector',reconnect:false,...connectorOptions});await connector.start();return connector;},async pair(){const result=await call('/api/pair',undefined,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:app.service.pairCode})});assert.equal(result.status,200);return result.body.sessionToken;}};
}

test('monitor has one exact protected route and rejects queries or adjacent paths',()=>{
  assert.deepEqual(route('GET','/api/monitor'),{kind:'monitor',public:false,media:false});
  for(const path of ['/api/monitor?','/api/monitor?after=0','/api/monitor?token=secret'])assert.deepEqual(route('GET',path),{error:400});
  for(const path of ['/api/monitor/','/api/monitor/other','/api/monitors','/api/%6donitor'])assert.equal(route('GET',path),null);
  for(const method of ['POST','DELETE','HEAD'])assert.equal(route(method,'/api/monitor'),null);
});

test('real Mac pairing authorizes monitor, rejects invalid/revoked/machine credentials, and never leaks contents',async t=>{
  const f=await fixture(t);await f.connect();const token=await f.pair();
  const created=await f.call('/api/tasks',token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:'PRIVATE_REQUEST',title:'PRIVATE_TITLE',prompt:'PRIVATE_PROMPT',criteria:[{text:'PRIVATE_CRITERION'}]})});
  assert.equal(created.status,200);
  for(const credential of [undefined,'bad-session',machineKey]){
    const denied=await f.call('/api/monitor',credential);assert.equal(denied.status,401);assert.deepEqual(Object.keys(denied.body),['error']);
  }
  const result=await f.call('/api/monitor',token);assert.equal(result.status,200);
  assert.equal(result.headers.get('cache-control'),'no-store');
  assert.deepEqual(Object.keys(result.body).sort(),['generatedAt','uptimeSeconds','executionLimit','maxTasks','activeExecutions','recoveryRequired','counts','memory','readiness','relay'].sort());
  assert.equal(typeof result.body.readiness.codexAvailable,'boolean');assert.equal(result.body.readiness.voiceConfigured,false);
  assert.deepEqual(Object.keys(result.body.relay).sort(),relayKeys);assert.equal(result.body.relay.connected,true);
  assert.equal(result.body.relay.requestsTotal,5);assert.equal(result.body.relay.responsesTotal,2);assert.equal(result.body.relay.errorsTotal,3);
  assert.equal(result.body.relay.inFlight,1);
  const encoded=JSON.stringify(result.body);
  for(const secret of ['PRIVATE_',token,machineKey,created.body.task.id])assert.ok(!encoded.includes(secret));
  await f.call('/api/unpair',token,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  const revoked=await f.call('/api/monitor',token);assert.equal(revoked.status,401);assert.deepEqual(Object.keys(revoked.body),['error']);
});

test('offline and timeout monitor reads keep existing errors without authorized-looking snapshots',async t=>{
  const f=await fixture(t,{handler:(req)=>req.resume(),relay:{requestTimeoutMs:35},connector:{requestTimeoutMs:200}});
  assert.equal((await f.call('/api/monitor')).status,401);
  assert.equal((await f.call('/api/monitor',machineKey)).status,401);
  const offline=await f.call('/api/monitor','syntactic-session');assert.equal(offline.status,503);assert.deepEqual(Object.keys(offline.body),['error']);
  await f.connect();const timeout=await f.call('/api/monitor','syntactic-session');assert.equal(timeout.status,504);assert.deepEqual(Object.keys(timeout.body),['error']);
});

test('monitor metrics count finishes once, include rejection/timeout, and cap duration storage at the last 128',async t=>{
  const f=await fixture(t);const connector=await f.connect();const token=await f.pair();
  let now=1000;const clock=t.mock.method(performance,'now',()=>now);t.after(()=>clock.mock.restore());
  const durations=[];f.relay.server.on('request',()=>{now+=durations.shift()??1;});
  // Requests are distinguished only by fixed counters, never task IDs or request paths.
  for(let i=0;i<130;i++){durations.push(i<2?10000:10);assert.equal((await f.call('/api/tasks',token)).status,200);}
  let result=await f.call('/api/monitor',token);
  assert.equal(result.body.relay.latencySamples,128);assert.equal(result.body.relay.latencyP50Ms,10);assert.equal(result.body.relay.latencyP95Ms,10);
  assert.equal(result.body.relay.requestsTotal,131);assert.equal(result.body.relay.responsesTotal,131);assert.equal(result.body.relay.errorsTotal,0);
  assert.equal((await f.call('/private/PRIVATE_PATH',token)).status,404);
  await connector.close();assert.equal((await f.call('/api/monitor',token)).status,503);await f.connect();
  result=await f.call('/api/monitor',token);assert.equal(result.body.relay.requestsTotal,134);assert.equal(result.body.relay.responsesTotal,132);assert.equal(result.body.relay.errorsTotal,2);assert.equal(result.body.relay.timeoutsTotal,0);
  assert.deepEqual(Object.keys(result.body.relay).sort(),relayKeys);
});

test('monitor latency includes unfinished request upload and uses monotonic time despite wall-clock jumps',async t=>{
  const f=await fixture(t,{relay:{requestTimeoutMs:30}});await f.connect();const token=await f.pair();
  let now=0;t.mock.method(performance,'now',()=>now);t.mock.method(Date,'now',()=>-100000);
  const status=await new Promise((resolve,reject)=>{
    const request=httpRequest(f.base+'/api/tasks',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','content-length':'100'}},response=>{response.resume();response.once('end',()=>{request.destroy();resolve(response.statusCode);});});
    request.on('error',reject);request.write('{');f.relay.server.once('request',()=>{now=200;});
  });
  assert.equal(status,504);
  const result=await f.call('/api/monitor',token);assert.equal(result.body.relay.requestsTotal,2);assert.equal(result.body.relay.responsesTotal,1);assert.equal(result.body.relay.errorsTotal,1);assert.equal(result.body.relay.timeoutsTotal,1);assert.equal(result.body.relay.latencyP95Ms,200);
});

test('first successful monitor has null latency percentiles and restart does not reuse counters',async t=>{
  for(let attempt=0;attempt<2;attempt++){
    const f=await fixture(t);await f.connect();const token=f.app.service.pair(f.app.service.pairCode);
    const result=await f.call('/api/monitor',token);assert.equal(result.status,200);assert.equal(result.body.relay.requestsTotal,0);assert.equal(result.body.relay.latencySamples,0);assert.equal(result.body.relay.latencyP50Ms,null);assert.equal(result.body.relay.latencyP95Ms,null);
  }
});

test('malformed or content-bearing upstream monitor success cannot leak fields or acquire transport metrics',async t=>{
  const valid={generatedAt:'2026-10-24T00:00:00.000Z',uptimeSeconds:1,executionLimit:4,maxTasks:32,activeExecutions:0,recoveryRequired:false,counts:{queued:0,running:0,waiting_approval:0,waiting_input:0,stopping:0,interrupted:0,failed:0,completed:0,accepted:0},memory:{rssBytes:1,heapUsedBytes:1}};
  let body='PRIVATE_RAW_ERROR',type='application/json',status=200;
  const f=await fixture(t,{handler:(req,res)=>{req.resume();res.writeHead(status,{'content-type':type});res.end(body);}});await f.connect();
  for(const bad of ['PRIVATE_RAW_ERROR','null','[]',JSON.stringify({...valid,counts:{queued:'PRIVATE_PROMPT'}})]){
    body=bad;const result=await f.call('/api/monitor','syntactic-session');assert.equal(result.status,502);assert.deepEqual(Object.keys(result.body),['error']);assert.doesNotMatch(JSON.stringify(result.body),/PRIVATE_/);
  }
  body=JSON.stringify(valid);type='application/octet-stream';assert.equal((await f.call('/api/monitor','syntactic-session')).status,502);
  type='application/json';body=JSON.stringify({...valid,PRIVATE_PROMPT:'PRIVATE_CONTENT',relay:{PRIVATE_SECRET:'PRIVATE_TOKEN'}});
  const clean=await f.call('/api/monitor','syntactic-session');assert.equal(clean.status,200);assert.doesNotMatch(JSON.stringify(clean.body),/PRIVATE_/);assert.deepEqual(Object.keys(clean.body.relay).sort(),relayKeys);
  status=401;body=JSON.stringify({error:{code:'unauthenticated',message:'denied'}});const rejected=await f.call('/api/monitor','syntactic-session');assert.equal(rejected.status,401);assert.deepEqual(Object.keys(rejected.body),['error']);
});
