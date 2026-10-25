import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,realpath,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

for(const scenario of ['socket-close','constructor-failure']){
 test(`pending ${scenario} reconnect keeps a real child alive until close releases its lock`,async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'agent-reconnect-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const stateFile=join(root,'ledger.json'),moduleUrl=new URL('../agent.mjs',import.meta.url).href;
  const source=`
   import {EventEmitter} from 'node:events';
   import {createMacAgent} from ${JSON.stringify(moduleUrl)};
   class Socket extends EventEmitter{
    constructor(){super();if(${JSON.stringify(scenario)}==='constructor-failure')throw Error('synthetic connection failure');this.readyState=1;queueMicrotask(()=>this.emit('open'));}
    send(raw){if(JSON.parse(raw).type==='register')queueMicrotask(()=>{this.emit('message',JSON.stringify({type:'connected',protocolVersion:1,deviceId:'mac',connectionId:'fixture'}));this.readyState=3;this.emit('close');});}
    close(){this.readyState=3;this.emit('close');}
   }
   const agent=await createMacAgent({endpoint:'wss://fixture.invalid/agent',deviceId:'mac',token:'synthetic-token',stateFile:${JSON.stringify(stateFile)},WebSocketImpl:Socket,retryMinMs:1000,retryMaxMs:1000});
   // This timer deliberately cannot keep Node alive; the production retry must do it.
   setTimeout(async()=>{await agent.close();process.stdout.write('closed-and-released\\n');},250).unref();
   agent.start();
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',timeout:5000,maxBuffer:65536});
  assert.ifError(result.error);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout,'closed-and-released\n','standalone process must survive the pending reconnect');
  await assert.rejects(lstat(stateFile+'.lock'),{code:'ENOENT'});
 });
}
