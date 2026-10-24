import {timingSafeEqual} from 'node:crypto';

const LIMIT=1024*1024;
const idSchema={type:'string',minLength:1,maxLength:128};
const definitions=[
 {name:'codex_status',method:'status',description:'Return actual Codex CLI availability',properties:{},required:[]},
 {name:'codex_list_projects',method:'listProjects',description:'List configured projects without server paths',properties:{},required:[],project:true},
 {name:'codex_list_tasks',method:'listTasks',description:'List tasks for one enabled project',properties:{projectId:idSchema},required:['projectId'],project:true},
 {name:'codex_start_task',method:'startTask',description:'Create a draft for an enabled project; execution requires webpage confirmation',properties:{projectId:idSchema,prompt:{type:'string',minLength:1,maxLength:20000},title:{type:'string',maxLength:200},requestId:idSchema},required:['projectId','prompt','requestId'],project:true},
 ...[['status','getTask'],['logs','getLogs'],['diff','getDiff'],['checks','getChecks']].map(([label,method])=>({name:`codex_task_${label}`,method,description:`Get task ${label}`,properties:{taskId:idSchema},required:['taskId'],task:true,project:true})),
 {name:'codex_cancel_task',method:'cancelTask',description:'Request cancellation of a task; does not undo file changes',properties:{taskId:idSchema,requestId:idSchema},required:['taskId','requestId'],task:true,project:true,write:true},
];
const failure=(id,code,message)=>({jsonrpc:'2.0',id:id??null,error:{code,message}});
const safeProject=p=>({id:p.id,name:p.name,enabled:p.enabled===true,scopes:[{id:'all',name:'全项目'}]});

export function createMcpDispatcher({adapter,projectRegistry=adapter,serverInfo={name:'VoxCode',version:'0.1.0'},authorizeWrite}={}) {
 if(!adapter)throw Error('MCP adapter required');
 const hasRegistry=typeof projectRegistry?.listProjects==='function'&&typeof projectRegistry?.getProject==='function';
 const entries=definitions.filter(entry=>(!entry.project||hasRegistry)&&(!entry.task||typeof adapter.getTask==='function')&&typeof (entry.method==='listProjects'?projectRegistry:adapter)[entry.method]==='function');
 const tools=entries.map(({name,description,properties,required})=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}}));
 async function enabledProject(id){return (await projectRegistry.getProject(id))?.enabled===true;}
 async function dispatch(msg,request){
  if(!msg||typeof msg!=='object'||Array.isArray(msg)||msg.jsonrpc!=='2.0'||typeof msg.method!=='string')return failure(null,-32600,'Invalid Request');
  if(msg.id===undefined)return msg.method==='notifications/initialized'?null:failure(null,-32600,'Invalid Request');
  if(!['string','number'].includes(typeof msg.id)||typeof msg.id==='number'&&!Number.isSafeInteger(msg.id))return failure(null,-32600,'Invalid Request');
  const base={jsonrpc:'2.0',id:msg.id};
  if(msg.method==='initialize')return {...base,result:{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo}};
  if(msg.method==='ping')return {...base,result:{}};
  if(msg.method==='tools/list')return {...base,result:{tools}};
  if(msg.method!=='tools/call')return failure(msg.id,-32601,'Method not found');
  const entry=entries.find(item=>item.name===msg.params?.name);
  if(!entry)return failure(msg.id,-32602,'Unknown tool');
  const args=msg.params?.arguments??{};
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>!Object.hasOwn(entry.properties,key))||entry.required.some(key=>!Object.hasOwn(args,key))||Object.entries(args).some(([key,value])=>typeof value!=='string'||value.length<(entry.properties[key].minLength??0)||value.length>entry.properties[key].maxLength))return failure(msg.id,-32602,'Invalid arguments');
  try{
   let context;
   if(entry.task){
    const task=await adapter.getTask(args.taskId);
    if(!task||typeof task.projectId!=='string'||!await enabledProject(task.projectId))return failure(msg.id,-32004,'Task project unavailable');
    context={taskId:args.taskId,projectId:task.projectId};
   }else if(args.projectId&&!await enabledProject(args.projectId))return failure(msg.id,-32004,'Project unavailable');
   if(entry.write&&!(typeof authorizeWrite==='function'&&await authorizeWrite({request,tool:entry.name,args,context})))return failure(msg.id,-32003,'Task mutation authorization required');
   let result;
   if(entry.method==='listProjects')result={projects:(await projectRegistry.listProjects()).map(safeProject)};
   else if(entry.method==='listTasks')result=(await adapter.listTasks({projectId:args.projectId})).filter(task=>task.projectId===args.projectId);
   else if(entry.method==='startTask')result=await adapter.startTask(args);
   else if(entry.method==='cancelTask')result=await adapter.cancelTask(args.taskId,{requestId:args.requestId});
   else if(entry.task)result=await adapter[entry.method](args.taskId);
   else result=await adapter[entry.method]();
   return {...base,result:{content:[{type:'text',text:typeof result==='string'?result:JSON.stringify(result??null)}],isError:false}};
  }catch{return failure(msg.id,-32603,'Tool execution failed');}
 }
 return {dispatch,tools};
}

export function createMcpServer({token,...options}={}){
 if(typeof token!=='string'||!token)throw Error('MCP token required');
 const {dispatch,tools}=createMcpDispatcher(options);
 function json(res,status,payload){
  let body=JSON.stringify(payload);
  if(Buffer.byteLength(body)>LIMIT){status=500;body=JSON.stringify({error:{message:'Response too large'}});}
  res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(body);
 }
 async function handleRequest(req,res){try{
  if(req.method!=='POST'){res.setHeader('allow','POST');return json(res,405,{error:'Method not allowed'});}
  const got=req.headers['x-mcp-token'];
  if(typeof got!=='string'||Buffer.byteLength(got)!==Buffer.byteLength(token)||!timingSafeEqual(Buffer.from(got),Buffer.from(token)))return json(res,401,{error:'Unauthorized'});
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>LIMIT)return json(res,413,{error:'Request too large'});chunks.push(chunk);}
  let msg;try{msg=JSON.parse(Buffer.concat(chunks).toString());}catch{return json(res,400,failure(null,-32700,'Parse error'));}
  const output=await dispatch(msg,req);
  if(output)json(res,200,output);else{res.writeHead(202);res.end();}
 }catch{if(!res.headersSent)json(res,500,failure(null,-32603,'Internal error'));else res.destroy();}}
 return {handleRequest,dispatch,tools};
}
