import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,chmod,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {loadControlConfiguration} from '../control-config.mjs';

test('control config validates TLS and private files without requiring server Codex or a server task socket',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'control-config-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const key=join(root,'key.pem'),cert=join(root,'cert.pem'),login=join(root,'login'),path=join(root,'config.json');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=Fixture','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
 await chmod(key,0o600);await writeFile(login,'synthetic-long-login',{mode:0o600});
 const config={host:'127.0.0.1',port:9899,publicOrigin:'https://127.0.0.1:9899',revision:'fixture-98',deviceId:'mac',userId:'owner',deviceRoot:join(root,'state'),tlsKeyFile:key,tlsCertFile:cert,loginSecretFile:login};
 await writeFile(path,JSON.stringify(config),{mode:0o600});
 const loaded=await loadControlConfiguration({path});assert.equal(loaded.deviceId,'mac');assert.equal(loaded.taskSocket,undefined);assert.equal(loaded.loginSecret,'synthetic-long-login');
 const serverTaskSocket=join(root,'not-yet-running.sock');
 await writeFile(path,JSON.stringify({...config,serverTaskSocket}));
 assert.equal((await loadControlConfiguration({path})).serverTaskSocket,serverTaskSocket);
 for(const socket of ['relative.sock','/private/tmp/../tmp/tasks.sock','/tmp/tasks.sock\n','/tmp/'+ 'x'.repeat(110),'',null]){
  await writeFile(path,JSON.stringify({...config,serverTaskSocket:socket}));
  await assert.rejects(loadControlConfiguration({path}),error=>error.message==='Invalid private control configuration');
 }
 await writeFile(path,JSON.stringify(config));
 await assert.rejects(loadControlConfiguration({path,uid:0}));
 await chmod(login,0o644);await assert.rejects(loadControlConfiguration({path}));await chmod(login,0o600);
 await writeFile(path,JSON.stringify({...config,publicOrigin:'http://127.0.0.1:9899'}));await assert.rejects(loadControlConfiguration({path}));
 await writeFile(path,JSON.stringify({...config,publicOrigin:'https://127.0.0.2:9899'}));await assert.rejects(loadControlConfiguration({path}));
 await writeFile(path,JSON.stringify({...config,loginSecretFile:'/private-secret'}));await assert.rejects(loadControlConfiguration({path}));
 assert.equal((await readFile(cert)).includes('PRIVATE KEY'),false);
 const endpoint=join(root,'mcp');await writeFile(endpoint,'private-token-invalid-url',{mode:0o600});
 await writeFile(path,JSON.stringify({...config,mcpEndpointFile:endpoint}));
 await assert.rejects(loadControlConfiguration({path}),error=>!JSON.stringify(error).includes('private-token')&&!error.message.includes('private-token'));
 await writeFile(endpoint,'wss://xrobo.qiniu.com/v1/mcpproxy/connect?token=long-private-token%00');
 await assert.rejects(loadControlConfiguration({path}));
 const voiceFile=join(root,'voice.json'),voice={url:'wss://xrobo-io.qiniuapi.com/v1/ws/',token:'synthetic-private-voice-token',deviceId:'aa:bb:cc:dd:ee:ff',clientId:'12345678-1234-4234-8234-123456789abc'};
 await writeFile(voiceFile,JSON.stringify(voice),{mode:0o600});
 await writeFile(path,JSON.stringify({...config,voiceFile}));
 assert.deepEqual((await loadControlConfiguration({path})).voice,voice);
 for(const invalid of [{...voice,url:'wss://evil.invalid/v1/ws/'},{...voice,url:voice.url+'?token=secret'},{...voice,token:'bad\nsecret'},{...voice,deviceId:'bad'},{...voice,clientId:'bad'},{...voice,extra:'secret'}]){
  await writeFile(voiceFile,JSON.stringify(invalid));
  await assert.rejects(loadControlConfiguration({path}),error=>error.message==='Invalid private control configuration');
 }
 await writeFile(voiceFile,JSON.stringify(voice));await chmod(voiceFile,0o644);
 await assert.rejects(loadControlConfiguration({path}));
});
