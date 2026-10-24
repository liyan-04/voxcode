import {mkdir, readFile, lstat, writeFile, chown} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn, execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {randomBytes, timingSafeEqual} from 'node:crypto';

const tools=[
  {name:'codex_status',description:'查询服务器上真实 Codex 版本和语音验收任务状态。',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'codex_voice_acceptance',description:'启动服务器 Codex 语音验收。请用户提供四位数字验证码；Codex 只在独立测试目录创建文件，不修改业务代码。',inputSchema:{type:'object',properties:{verification_code:{type:'string',pattern:'^[0-9]{4}$',description:'用户说出的四位验证码，例如 4826'}},required:['verification_code'],additionalProperties:false}},
  {name:'codex_voice_acceptance_result',description:'查询服务器 Codex 语音验收的真实执行结果、文件内容和退出状态。',inputSchema:{type:'object',properties:{},additionalProperties:false}},
];
const content=value=>({content:[{type:'text',text:JSON.stringify(value)}],isError:false});

export function createAcceptanceProbe({root,run,version,onEvent=()=>{}}){
  const runs=new Map();let active, pending=Promise.resolve();
  const snapshot=r=>r?{...r}:{status:'idle'};
  return {
    wait:()=>pending,
    async handle(m){
      if(m?.id===undefined)return null;
      const reply=result=>({jsonrpc:'2.0',id:m.id,result});
      const error=(code,message)=>({jsonrpc:'2.0',id:m.id,error:{code,message}});
      if(m.jsonrpc!=='2.0'||!['string','number'].includes(typeof m.id))return error(-32600,'Invalid Request');
      if(m.method==='initialize')return reply({protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'VoxCode server voice acceptance',version:'0.1.0'}});
      if(m.method==='ping')return reply({});
      if(m.method==='tools/list')return reply({tools});
      if(m.method!=='tools/call')return error(-32601,'Unknown method');
      const name=m.params?.name,args=m.params?.arguments??{};
      if(!tools.some(t=>t.name===name))return error(-32602,'Unknown tool');
      if(!args||typeof args!=='object'||Array.isArray(args))return error(-32602,'Invalid arguments');
      const keys=Object.keys(args);
      if(name!=='codex_voice_acceptance'&&keys.length)return error(-32602,'No arguments allowed');
      if(name==='codex_status')return reply(content({source:'live-server',version:version(),acceptance:snapshot(active)}));
      if(name==='codex_voice_acceptance_result')return reply(content(snapshot(active)));
      if(keys.length!==1||keys[0]!=='verification_code'||typeof args.verification_code!=='string'||!/^\d{4}$/.test(args.verification_code))return error(-32602,'Exactly four numeric digits are required');
      const code=args.verification_code;
      if(runs.has(code))return reply(content(snapshot(runs.get(code))));
      if(active?.status==='running'||runs.size>=4)return reply({...content({status:'busy',message:'Acceptance is running or the four-run limit is reached'}),isError:true});
      const record={verificationCode:code,status:'running',startedAt:new Date().toISOString()};
      runs.set(code,record);active=record;onEvent({event:'acceptance_started',code});
      pending=(async()=>{
        const cwd=join(root,code),expected=`VOXCODE_VOICE_${code}\n`;
        try{
          await mkdir(cwd,{recursive:false,mode:0o700});
          const result=await run({cwd,expected,prompt:`Create exactly one file voice-acceptance.txt in the current workspace containing exactly ${JSON.stringify(expected)}. Do not read or modify any other project. Do not access the network. Verify the file and finish briefly.`});
          record.exitCode=result.exitCode;
          const file=join(cwd,'voice-acceptance.txt');
          const stat=await lstat(file);
          if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128)throw new Error('Invalid result file');
          record.fileContent=await readFile(file,'utf8');
          record.status=result.exitCode===0&&record.fileContent===expected?'passed':'failed';
        }catch{record.status='failed';record.message='Execution failed or expected file was not verified';}
        record.finishedAt=new Date().toISOString();onEvent({event:'acceptance_finished',code,status:record.status});
      })();
      return reply(content(snapshot(record)));
    },
  };
}

async function main(){
  const privateConfig=JSON.parse(await readFile(process.argv[2],'utf8'));
  const endpoint=new URL(privateConfig.endpoint);
  if(endpoint.protocol!=='wss:'||endpoint.hostname!=='xrobo.qiniu.com'||endpoint.pathname!=='/v1/mcpproxy/connect')throw new Error('Expected official WSS endpoint');
  const base=resolve(process.argv[3]);const root=join(base,'runs');
  const uid=Number(privateConfig.uid),gid=Number(privateConfig.gid);
  if(!Number.isInteger(uid)||uid<=0||!Number.isInteger(gid)||gid<=0)throw new Error('Non-root task identity required');
  const modelToken=randomBytes(32).toString('hex');
  const key=JSON.parse(await readFile('/root/.secrets/mykey.json','utf8')).key.trim();
  const equal=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
  const modelServer=createServer((req,res)=>{
    if(req.method!=='POST'||req.url!=='/v1/responses'||!equal(req.headers.authorization,`Bearer ${modelToken}`)){res.writeHead(403);res.end();return;}
    const upstream=httpsRequest('https://llmapi.qiniu.io/v1/responses',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key}`}},r=>{res.writeHead(r.statusCode,{'content-type':r.headers['content-type']??'application/json'});r.pipe(res);});
    upstream.setTimeout(120000,()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
    res.on('close',()=>upstream.destroy());let bytes=0;
    req.on('data',c=>{bytes+=c.length;if(bytes>4*1024*1024){req.destroy();upstream.destroy();}});req.pipe(upstream);
  });
  await new Promise(r=>modelServer.listen(0,'127.0.0.1',r));
  const config=`model = "gpt-6.1-sol"\nmodel_provider = "acceptance"\nweb_search = "disabled"\napproval_policy = "never"\nsandbox_mode = "workspace-write"\n[model_providers.acceptance]\nname = "Acceptance scoped gateway"\nbase_url = "http://127.0.0.1:${modelServer.address().port}/v1"\nwire_api = "responses"\nenv_key = "VOXCODE_ACCEPTANCE_MODEL_TOKEN"\nsupports_websockets = false\n[sandbox_workspace_write]\nnetwork_access = false\n`;
  const home=join(base,'home');await writeFile(join(home,'.codex','config.toml'),config,{mode:0o644});
  let child,stopping=false,socket,retry,timer;
  const log=event=>console.log(JSON.stringify({at:new Date().toISOString(),...event}));
  const codex=join(base,'bin','codex');
  const probe=createAcceptanceProbe({root,version:()=>execFileSync(codex,['--version'],{encoding:'utf8',timeout:5000}).trim(),onEvent:log,
    run:async({cwd,prompt})=>{
      await chown(cwd,uid,gid);
      return new Promise(resolveRun=>{
      const childEnv={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:home,CODEX_HOME:join(home,'.codex'),VOXCODE_ACCEPTANCE_MODEL_TOKEN:modelToken,LANG:'C.UTF-8'};
      child=spawn(codex,['-a','never','exec','--json','--ephemeral','--sandbox','workspace-write','--skip-git-repo-check','-C',cwd,'-'],{uid,gid,env:childEnv,stdio:['pipe','pipe','pipe'],detached:true});
      let diagnostic='';
      const capture=data=>{if(diagnostic.length<32768)diagnostic+=data.toString().slice(0,32768-diagnostic.length);};
      child.stdout.on('data',capture);child.stderr.on('data',capture);
      const owned=child;let killTimer;
      const timeout=setTimeout(()=>{try{process.kill(-owned.pid,'SIGTERM')}catch{}killTimer=setTimeout(()=>{try{process.kill(-owned.pid,'SIGKILL')}catch{}},1000);},120000);
      owned.on('error',()=>resolveRun({exitCode:-1}));owned.on('close',async code=>{clearTimeout(timeout);clearTimeout(killTimer);child=undefined;const safe=diagnostic.replaceAll(modelToken,'[scoped-token]').replaceAll(key,'[upstream-key]').replaceAll(endpoint.searchParams.get('token'),'[endpoint-token]');try{await mkdir(join(base,'diagnostics'),{mode:0o700});}catch{}try{await writeFile(join(base,'diagnostics',`${cwd.split('/').at(-1)}.log`),safe,{mode:0o600});}catch{}log({event:'codex_exit',exitCode:code});resolveRun({exitCode:code});});owned.stdin.on('error',()=>{});owned.stdin.end(prompt);
      });
    }});
  function connect(){
    if(stopping)return;socket=new WebSocket(endpoint);
    const ws=socket;
    ws.onopen=()=>log({event:'proxy_connected'});
    ws.onerror=()=>log({event:'proxy_connection_error'});
    ws.onclose=()=>{log({event:'proxy_disconnected'});if(!stopping)retry=setTimeout(connect,3000);};
    ws.onmessage=async event=>{
      if(typeof event.data!=='string'||Buffer.byteLength(event.data)>32768){ws.close();return;}
      let request;try{request=JSON.parse(event.data)}catch{return;}
      log({event:'mcp_request',method:request.method,tool:request.params?.name});
      try{const response=await probe.handle(request);if(response&&ws.readyState===1)ws.send(JSON.stringify(response));}catch{log({event:'mcp_handler_error'});}
    };
  }
  async function close(){if(stopping)return;stopping=true;clearTimeout(retry);clearTimeout(timer);socket?.close();if(child?.pid){try{process.kill(-child.pid,'SIGTERM')}catch{}setTimeout(()=>{if(child?.pid){try{process.kill(-child.pid,'SIGKILL')}catch{}}},1000);}modelServer.closeAllConnections();modelServer.close();setTimeout(()=>process.exit(0),1500);}
  process.once('SIGTERM',close);process.once('SIGINT',close);
  timer=setTimeout(close,45*60*1000);connect();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('Acceptance probe configuration failed');process.exit(1);});
