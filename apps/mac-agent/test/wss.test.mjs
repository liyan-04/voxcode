import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:https';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import WebSocket,{WebSocketServer} from 'ws';
import {createMacAgent} from '../agent.mjs';

async function until(check){const deadline=Date.now()+3000;while(!check()){if(Date.now()>deadline)assert.fail('WSS fixture deadline');await delay(5);}}
test('real WSS registers, returns raw RPC result, heartbeats and reconnects with strict TLS',async t=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'voxcode-agent-wss-'))),key=join(dir,'key.pem'),cert=join(dir,'cert.pem');
 await promisify(execFile)('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1']);
 const ca=await readFile(cert),server=createServer({key:await readFile(key),cert:ca}),wss=new WebSocketServer({server,maxPayload:1024*1024+4096});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const connections=[],frames=[];
 wss.on('connection',ws=>{connections.push(ws);const connectionId=`connection${connections.length}`;ws.on('message',raw=>{const frame=JSON.parse(raw);frames.push(frame);if(frame.type==='register')ws.send(JSON.stringify({type:'connected',protocolVersion:1,deviceId:'mac1',connectionId}));if(frame.type==='heartbeat')ws.send(JSON.stringify({type:'heartbeat_ack',protocolVersion:1,deviceId:'mac1',connectionId,serverObservedAt:new Date().toISOString()}));});});
 class TrustedSocket extends WebSocket{constructor(url,options){assert.equal(options.rejectUnauthorized,true);super(url,{...options,ca});}}
 let calls=0;
 const agent=await createMacAgent({endpoint:`wss://127.0.0.1:${server.address().port}/agent`,deviceId:'mac1',token:'fixture-token',stateFile:join(dir,'ledger.json'),capabilities:['task_rpc'],WebSocketImpl:TrustedSocket,heartbeatMs:10,retryMinMs:5,retryMaxMs:5,onCommand:async()=>{calls++;return [{id:'p1'}];}});
 t.after(async()=>{await agent.close();for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));});agent.start();
 await until(()=>frames.some(frame=>frame.type==='heartbeat'));
 const c={protocolVersion:1,requestId:'request1',operationId:'operation1',deviceId:'mac1',type:'task_rpc',payload:{method:'listProjects',params:[]},issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30000).toISOString()};
 connections[0].send(JSON.stringify({type:'command',command:c}));await until(()=>frames.some(frame=>frame.type==='commandResult'));
 assert.deepEqual(frames.find(frame=>frame.type==='commandResult').snapshot,[{id:'p1'}]);assert.equal(calls,1);
 connections[0].terminate();await until(()=>connections.length===2);await until(()=>frames.filter(frame=>frame.type==='register').length===2);
 connections[1].send(JSON.stringify({type:'command',command:c}));await until(()=>frames.filter(frame=>frame.type==='commandResult').length===2);assert.equal(calls,1);
 const untrusted=new WebSocket(`wss://127.0.0.1:${server.address().port}`);const [failure]=await once(untrusted,'error');assert.ok(failure);assert.equal(connections.length,2);
});
