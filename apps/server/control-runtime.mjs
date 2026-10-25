import {createHttpServer} from './http-server.mjs';
import {createDeviceStore} from './device-store.mjs';
import {createDeviceGateway} from './device-gateway.mjs';
import {createRemoteTaskAdapter} from './remote-task-adapter.mjs';
import {createTaskRpcClient} from './task-rpc.mjs';
import {createExecutionTargets,resolveExecutionVoiceContext} from './execution-targets.mjs';
import {createMcpDispatcher} from './mcp-server.mjs';
import {createMcpProxyBridge} from './mcp-proxy-bridge.mjs';
import {attachControlWebSocketRouter} from './device-websocket.mjs';
import {createVoiceTransport} from './voice-transport.mjs';
import {createLinxVoiceProvider} from './voice-provider.mjs';
import {createVoiceTools} from './voice-tools.mjs';

const reads=new Set(['codex_status','codex_list_projects','codex_list_tasks','codex_task_status','codex_task_logs','codex_task_diff','codex_task_checks']);
export async function startControlRuntime({config,createBridge=createMcpProxyBridge,attachTransport,createVoiceProvider,onStatus=()=>{},shutdownTimeoutMs=5000}={}){
 if(!config?.tls?.key||!config.tls.cert||!config.publicOrigin?.startsWith('https://')||!Number.isSafeInteger(shutdownTimeoutMs)||shutdownTimeoutMs<10||shutdownTimeoutMs>20000)throw Error('Checked HTTPS control configuration required');
 const store=await createDeviceStore({root:config.deviceRoot});
 const gateway=createDeviceGateway({deviceStore:store});
 const adapter=createRemoteTaskAdapter({gateway,userId:config.userId,deviceId:config.deviceId});
 const {dispatch:baseDispatch,tools}=createMcpDispatcher({adapter,projectRegistry:adapter,authorizeWrite:()=>false});
 let proxyState=config.mcpEndpoint?'connecting':'disabled',bridge,transport,voiceTransport,upgradeRouter,closing,timer,voiceProviderState=config.voice?'idle':'disabled';
 let cached={online:false,available:false,observedAt:null},serverCached={online:false,available:false,observedAt:null},refreshing;
 const serverAdapter=config.serverTaskSocket?createTaskRpcClient({socketPath:config.serverTaskSocket}):null;
 const executionTargets=createExecutionTargets({mac:{adapter,deviceId:config.deviceId,readState:()=>cached},...(serverAdapter?{server:{adapter:serverAdapter,deviceId:'server',readState:()=>serverCached}}:{})});
 const refreshState=()=>refreshing??=Promise.all([Promise.resolve().then(async()=>{
  try{
   const device=(await gateway.listDevices({userId:config.userId})).find(item=>item.deviceId===config.deviceId);
   cached={online:device?.online===true,available:false,observedAt:new Date().toISOString()};
   if(cached.online){try{const status=await adapter.status();cached={...cached,available:status?.available===true||status?.codexAvailable===true};}catch{}}
  }catch{cached={online:false,available:false,observedAt:null};}
 }),Promise.resolve().then(async()=>{
  if(!serverAdapter)return;
  try{const status=await serverAdapter.status();serverCached={online:true,available:status?.available===true||status?.codexAvailable===true,observedAt:new Date().toISOString()};}
  catch{serverCached={online:false,available:false,observedAt:new Date().toISOString()};}
 })]).finally(()=>{refreshing=null;});
 const dispatch=async(message,request)=>{
  if(message?.method==='tools/call'&&!reads.has(message.params?.name))return {jsonrpc:'2.0',id:message.id??null,error:{code:-32003,message:'MCP mutations disabled until trusted voice context correlation is verified'}};
  const result=await baseDispatch(message,request);
  if(message?.method==='tools/list'&&result?.result?.tools)result.result.tools=result.result.tools.filter(tool=>reads.has(tool.name));
  return result;
 };
 const info={name:'VoxCode',version:'0.1.0',simulation:false,executionHost:'mac',voiceAvailable:Boolean(config.voice),voiceState:config.voice?'configured':'disabled',voiceBlocker:config.voice?null:'voice_not_configured',get voiceProviderState(){return voiceProviderState;},mcpMutationsEnabled:false,get deviceOnline(){return cached.online;},get deviceObservedAt(){return cached.observedAt;},get mcpProxyState(){return proxyState;}};
 // A successful phone session controls only the operator-configured account/Mac.
 // Client and model input never choose another owner or execution device.
 const apiExtension=async({req,res,url,json,body})=>{
  if(url.pathname==='/api/execution-targets'&&req.method==='GET'){json(res,200,{targets:executionTargets.listTargets()});return true;}
  if(url.pathname==='/api/devices'&&req.method==='GET'){json(res,200,{executionHost:'mac',deviceId:config.deviceId,devices:await gateway.listDevices({userId:config.userId})});return true;}
  if(url.pathname==='/api/pairings'&&req.method==='POST'){const input=await body(req);if(Object.keys(input).length)throw Error('Invalid pairing request');json(res,201,await gateway.startPairing({userId:config.userId}));return true;}
  if(url.pathname==='/api/pairings/complete'&&req.method==='POST'){const input=await body(req);if(Object.keys(input).some(key=>key!=='code'))throw Error('Invalid pairing request');json(res,201,await gateway.completePairing({code:input.code,userId:config.userId,deviceId:config.deviceId}));return true;}
  const match=url.pathname.match(/^\/api\/operations\/([a-zA-Z0-9_-]+)(\/reconcile)?$/u);
  if(match&&((req.method==='GET'&&!match[2])||(req.method==='POST'&&match[2]))){
   const identity={userId:config.userId,deviceId:config.deviceId};
   json(res,200,match[2]?await gateway.reconcile({...identity,operationId:match[1]}):await gateway.getOperation(match[1],identity));return true;
  }
  return false;
 };
 const app=createHttpServer({adapter,projectRegistry:adapter,executionTargets,directSubmissions:true,tls:{...config.tls,handshakeTimeout:10000},loginSecret:config.loginSecret,publicOrigin:config.publicOrigin,revision:config.revision,serverInfo:info,healthStatus:()=>cached,apiExtension});
 const sockets=new Set();app.server.maxConnections=128;
 app.server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));if(closing)socket.destroy();});
 app.server.headersTimeout=10000;app.server.requestTimeout=25000;app.server.keepAliveTimeout=5000;
 const close=()=>{
  if(closing)return closing;
  closing=(async()=>{clearInterval(timer);let deadline;
   const listener=()=>!app.server.listening?Promise.resolve():new Promise((resolve,reject)=>{app.server.close(error=>error?reject(error):resolve());app.server.closeIdleConnections();});
   try{
    const results=await Promise.race([
     Promise.allSettled([Promise.resolve().then(()=>bridge?.close()),Promise.resolve().then(()=>upgradeRouter?.close()),Promise.resolve().then(()=>voiceTransport?.close()),Promise.resolve().then(()=>transport?.close()),Promise.resolve().then(listener)]),
     new Promise((_,reject)=>{deadline=setTimeout(()=>{app.server.closeAllConnections();reject(Error('Control shutdown deadline reached'));},shutdownTimeoutMs);}),
    ]);
    if(results.some(result=>result.status==='rejected'))throw Error('Control resource cleanup failed');
   }finally{clearTimeout(deadline);for(const socket of sockets)socket.destroy();}
  })();return closing;
 };
 try{
  const attach=attachTransport??(await import('./device-websocket.mjs')).attachDeviceWebSocket;
  transport=attach({server:app.server,gateway,publicOrigin:config.publicOrigin,registerUpgrade:false});
  if(config.voice){
   let factory=createVoiceProvider;
   if(!factory){
    const [{createLinxSession},{createOutputDecoder}]=await Promise.all([import('../../packages/voice/src/index.js'),import('../../packages/voice/src/audio.js')]);
    factory=options=>createLinxVoiceProvider({...options,config:config.voice,createSession:createLinxSession,createDecoder:createOutputDecoder});
   }
   const resolveContext=({context})=>resolveExecutionVoiceContext({targets:executionTargets,context,userId:config.userId});
   const authorizeVoiceUpgrade=req=>{const session=app.authorizeUpgrade(req);return session?{...session,ownerId:config.userId}:null;};
   voiceTransport=createVoiceTransport({server:app.server,publicOrigin:config.publicOrigin,authorizeUpgrade:authorizeVoiceUpgrade,resolveContext,registerUpgrade:false,maxConnections:1,providerFactory:async options=>{
    voiceProviderState='connecting';
    const bound=executionTargets.getTarget(options.context.executionTarget);
    const tools=createVoiceTools({adapter:bound.adapter,context:options.context,voiceSessionId:options.voiceSessionId,captureId:options.captureId,authorize:options.authorizeTool,onStart:()=>options.onEvent({type:'tool.started'}),onResult:result=>options.onEvent({type:'tool.result',result})});
    const provider=await factory({...options,tools,onEvent:event=>{if(event.type==='error')voiceProviderState='failed';options.onEvent(event);}});
    return {...provider,async connect(){try{const report=await provider.connect();voiceProviderState='ready';return report;}catch{voiceProviderState='failed';throw Error('Voice provider unavailable');}}};
   }});
  }
  if(typeof transport?.handleUpgrade==='function')upgradeRouter=attachControlWebSocketRouter({server:app.server,deviceTransport:transport,voiceTransport});
  else if(config.voice)throw Error('Shared upgrade transport required');
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(config.port,config.host,()=>{app.server.off('error',reject);resolve();});});
  if(config.mcpEndpoint){bridge=createBridge({endpoint:config.mcpEndpoint,dispatch,onStatus:status=>{proxyState=status;try{onStatus(status);}catch{}}});bridge.start();}
  timer=setInterval(()=>{void refreshState();},10000);timer.unref();
 }catch{await close().catch(()=>{});throw Error('Control listener or proxy startup failed');}
 return {...app,gateway,adapter,executionTargets,dispatch,tools:tools.filter(tool=>reads.has(tool.name)),refreshState,close};
}
