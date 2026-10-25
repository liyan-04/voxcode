import test from 'node:test';
import assert from 'node:assert/strict';
import {runControlCli} from '../control-cli.mjs';
test('control CLI preflight/start consume private checked config and redact failures',async()=>{
 const output=[],config={revision:'fixture',mcpEndpoint:'private-token'},options={log:value=>output.push(value),error:value=>output.push(value)};
 let loaded=0,received;
 const load=async()=>{loaded++;return config;};
 assert.equal((await runControlCli({...options,args:['start','private-token'],load})).exitCode,2);assert.equal(loaded,0);
 assert.equal((await runControlCli({...options,args:['preflight'],load})).exitCode,0);
 assert.equal((await runControlCli({...options,args:['start'],load,start:async({config})=>{received=config;return{close:async()=>{}};}})).exitCode,0);assert.equal(received,config);
 assert.equal((await runControlCli({...options,args:['start'],load:()=>{throw Error('private-token');}})).exitCode,1);
 assert.equal(output.join().includes('private-token'),false);
});
