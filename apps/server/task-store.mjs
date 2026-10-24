import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

export function createTaskStore(file) {
  let queue=Promise.resolve();
  async function load() {
    try { return JSON.parse(await readFile(file,'utf8')); }
    catch(error) { if(error.code==='ENOENT') return {}; throw error; }
  }
  return {
    async list() { await queue; return Object.values(await load()); },
    async get(id) { await queue; return (await load())[id]; },
    put(task) {
      const operation=queue.then(async()=>{
        const tasks=await load(); tasks[task.id]=structuredClone(task);
        await mkdir(dirname(file),{recursive:true,mode:0o700});
        const temp=`${file}.${randomUUID()}.tmp`;
        await writeFile(temp,JSON.stringify(tasks),{mode:0o600});
        await rename(temp,file);
        return structuredClone(task);
      });
      queue=operation.catch(()=>{}); return operation;
    },
  };
}
