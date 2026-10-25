import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {createTaskRpcServer} from '../../server/task-rpc.mjs';
import {createTaskCapability} from '../task-capability.mjs';

test('task capability uses actual private Unix RPC without starting a model',async t=>{
 const directory=await realpath(await mkdtemp('/private/tmp/vx-agent-rpc-')),socketPath=join(directory,'task.sock');let writes=0;
 const rpc=await createTaskRpcServer({socketPath,adapter:{status:()=>({executionLocation:'mac'}),startTask:args=>{writes++;return {id:'draft1',requestId:args.requestId};}}});t.after(()=>rpc.close());
 const capability=createTaskCapability({socketPath});
 assert.deepEqual(await capability.execute({type:'task_rpc',requestId:'r1',payload:{method:'status',params:[]}}),{executionLocation:'mac'});
 assert.deepEqual(await capability.execute({type:'task_rpc',requestId:'r2',payload:{method:'startTask',params:[{projectId:'p1',prompt:'fixture only',requestId:'r2'}]}}),{id:'draft1',requestId:'r2'});assert.equal(writes,1);
 await assert.rejects(()=>capability.execute({type:'task_rpc',requestId:'r3',payload:{method:'confirmTask',params:['draft1',{requestId:'r3'}]}}),/task_rpc_denied/);
});
