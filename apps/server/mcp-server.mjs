import {timingSafeEqual} from 'node:crypto';
const LIMIT=1024*1024;
const definitions=[
 ['codex_status','status','Return Codex status',false,{}],
 ['codex_list_tasks','listTasks','List managed tasks',false,{}],
 ['codex_start_task','startTask','Start a confirmed coding task',true,{prompt:{type:'string',minLength:1,maxLength:20000},title:{type:'string',maxLength:200}}],
 ['codex_continue_task','continueTask','Continue a task',true,{taskId:{type:'string',minLength:1,maxLength:128},prompt:{type:'string',minLength:1,maxLength:20000}}],
 ...[['status','getTask'],['logs','getLogs'],['diff','getDiff'],['checks','getChecks']].map(([label,method])=>[`codex_task_${label}`,method,`Get task ${label}`,false,{taskId:{type:'string',minLength:1,maxLength:128}}]),
 ['codex_cancel_task','cancelTask','Cancel a task',true,{taskId:{type:'string',minLength:1,maxLength:128}}],
 ['codex_retry_task','retryTask','Retry a task',true,{taskId:{type:'string',minLength:1,maxLength:128}}],
];
export function createMcpServer({adapter,token,serverInfo={name:'VoxCode',version:'0.1.0'},authorizeWrite}={}) {
 if(!adapter||typeof token!=='string'||!token)throw new Error('MCP configuration required');
 const entries=definitions.filter(([,method])=>typeof adapter[method]==='function');
 const tools=entries.map(([name,,description,,properties])=>({name,description,inputSchema:{type:'object',properties,required:Object.keys(properties).filter(k=>k!=='title'),additionalProperties:false}}));
 const failure=(id,code,message)=>({jsonrpc:'2.0',id:id??null,error:{code,message}});
 function json(res,status,body){let data=JSON.stringify(body);if(Buffer.byteLength(data)>LIMIT){status=500;data=JSON.stringify(failure(body.id,-32603,'Response too large'));}res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','content-length':Buffer.byteLength(data)});res.end(data);}
 async function dispatch(msg,req){
  if(!msg||typeof msg!=='object'||Array.isArray(msg)||msg.jsonrpc!=='2.0'||typeof msg.method!=='string')return failure(null,-32600,'Invalid Request');
  if(msg.id===undefined){if(msg.method==='notifications/initialized')return null;return failure(null,-32600,'Invalid Request');}
  if(!['string','number'].includes(typeof msg.id)||typeof msg.id==='number'&&!Number.isSafeInteger(msg.id))return failure(null,-32600,'Invalid Request');
  const base={jsonrpc:'2.0',id:msg.id};
  if(msg.method==='initialize')return {...base,result:{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo}};
  if(msg.method==='ping')return {...base,result:{}};
  if(msg.method==='tools/list')return {...base,result:{tools}};
  if(msg.method!=='tools/call')return failure(msg.id,-32601,'Method not found');
  const entry=entries.find(([name])=>name===msg.params?.name);if(!entry)return failure(msg.id,-32602,'Unknown tool');
  const [name,method,,write,properties]=entry,args=msg.params?.arguments??{};
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(properties,k))||Object.entries(properties).some(([k,s])=>k!=='title'&&args[k]===undefined||args[k]!==undefined&&(typeof args[k]!=='string'||args[k].length<(s.minLength??0)||args[k].length>s.maxLength)))return failure(msg.id,-32602,'Invalid arguments');
  try{
   if(write&&!(typeof authorizeWrite==='function'&&await authorizeWrite({request:req,tool:name,args})))return failure(msg.id,-32003,'Phone confirmation required');
   const result=await adapter[method](method==='startTask'||method==='continueTask'?args:args.taskId);
   return {...base,result:{content:[{type:'text',text:typeof result==='string'?result:JSON.stringify(result??null)}],isError:false}};
  }catch{return failure(msg.id,-32603,'Tool execution failed');}
 }
 async function handleRequest(req,res){try{
  if(req.method!=='POST'){res.setHeader('allow','POST');return json(res,405,{error:'Method not allowed'});}
  const got=req.headers['x-mcp-token'];if(typeof got!=='string'||Buffer.byteLength(got)!==Buffer.byteLength(token)||!timingSafeEqual(Buffer.from(got),Buffer.from(token)))return json(res,401,{error:'Unauthorized'});
  let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>LIMIT)return json(res,413,{error:'Request too large'});chunks.push(chunk);}
  let msg;try{msg=JSON.parse(Buffer.concat(chunks).toString());}catch{return json(res,400,failure(null,-32700,'Parse error'));}
  const out=await dispatch(msg,req);if(out)json(res,200,out);else{res.writeHead(202);res.end();}
 }catch{if(!res.headersSent)json(res,500,failure(null,-32603,'Internal error'));else res.destroy();}}
 return {handleRequest,tools};
}
