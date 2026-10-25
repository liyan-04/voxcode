import {createHttpServer} from './http-server.mjs';
import {createDeviceStore} from './device-store.mjs';
import {createDeviceGateway} from './device-gateway.mjs';
import {createRemoteTaskAdapter} from './remote-task-adapter.mjs';
import {createMcpDispatcher} from './mcp-server.mjs';
import {createMcpProxyBridge} from './mcp-proxy-bridge.mjs';

const reads=new Set(['codex_status','codex_list_projects','codex_list_tasks','codex_task_status','codex_task_logs','codex_task_diff','codex_task_checks']);
export async function startControlRuntime({config,createBridge=createMcpProxyBridge,attachTransport,onStatus=()=>{},shutdownTimeoutMs=5000}={}){
 if(!config?.tls?.key||!config.tls.cert||!config.publicOrigin?.startsWith('https://')||!Number.isSafeInteger(shutdownTimeoutMs)||shutdownTimeoutMs<10||shutdownTimeoutMs>20000)throw Error('Checked HTTPS control configuration required');
 const store=await createDeviceStore({root:config.deviceRoot});
 const gateway=createDeviceGateway({deviceStore:store});
 const adapter=createRemoteTaskAdapter({gateway,userId:config.userId,deviceId:config.deviceId});
 const {dispatch:baseDispatch,tools}=createMcpDispatcher({adapter,projectRegistry:adapter,authorizeWrite:()=>false});
 let proxyState=config.mcpEndpoint?'connecting':'disabled',bridge,transport,closing,timer;
 let cached={online:false,available:false,observedAt:null},refreshing;
 const refreshState=()=>refreshing??=Promise.resolve().then(async()=>{
  try{
   const device=(await gateway.listDevices({userId:config.userId})).find(item=>item.deviceId===config.deviceId);
   cached={online:device?.online===true,available:false,observedAt:new Date().toISOString()};
   if(cached.online){try{const status=await adapter.status();cached={...cached,available:status?.available===true||status?.codexAvailable===true};}catch{}}
  }catch{cached={online:false,available:false,observedAt:null};}
 }).finally(()=>{refreshing=null;});
 const dispatch=async(message,request)=>{
  if(message?.method==='tools/call'&&!reads.has(message.params?.name))return {jsonrpc:'2.0',id:message.id??null,error:{code:-32003,message:'MCP mutations disabled until trusted voice context correlation is verified'}};
  const result=await baseDispatch(message,request);
  if(message?.method==='tools/list'&&result?.result?.tools)result.result.tools=result.result.tools.filter(tool=>reads.has(tool.name));
  return result;
 };
 const info={name:'VoxCode',version:'0.1.0',simulation:false,executionHost:'mac',voiceAvailable:false,voiceState:'disabled',voiceBlocker:'cloud_mcp_session_correlation_unverified',mcpMutationsEnabled:false,get deviceOnline(){return cached.online;},get deviceObservedAt(){return cached.observedAt;},get mcpProxyState(){return proxyState;}};
 // A successful phone session controls only the operator-configured account/Mac.
 // Client and model input never choose another owner or execution device.
 const apiExtension=async({req,res,url,json,body})=>{
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
 const app=createHttpServer({adapter,projectRegistry:adapter,tls:{...config.tls,handshakeTimeout:10000},loginSecret:config.loginSecret,publicOrigin:config.publicOrigin,revision:config.revision,serverInfo:info,healthStatus:()=>cached,apiExtension});
 const sockets=new Set();app.server.maxConnections=128;
 app.server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));if(closing)socket.destroy();});
 app.server.headersTimeout=10000;app.server.requestTimeout=25000;app.server.keepAliveTimeout=5000;
 const close=()=>{
  if(closing)return closing;
  closing=(async()=>{clearInterval(timer);let deadline;
   const listener=()=>!app.server.listening?Promise.resolve():new Promise((resolve,reject)=>{app.server.close(error=>error?reject(error):resolve());app.server.closeIdleConnections();});
   try{
    const results=await Promise.race([
     Promise.allSettled([Promise.resolve().then(()=>bridge?.close()),Promise.resolve().then(()=>transport?.close()),Promise.resolve().then(listener)]),
     new Promise((_,reject)=>{deadline=setTimeout(()=>{app.server.closeAllConnections();reject(Error('Control shutdown deadline reached'));},shutdownTimeoutMs);}),
    ]);
    if(results.some(result=>result.status==='rejected'))throw Error('Control resource cleanup failed');
   }finally{clearTimeout(deadline);for(const socket of sockets)socket.destroy();}
  })();return closing;
 };
 try{
  const attach=attachTransport??(await import('./device-websocket.mjs')).attachDeviceWebSocket;
  transport=attach({server:app.server,gateway,publicOrigin:config.publicOrigin});
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(config.port,config.host,()=>{app.server.off('error',reject);resolve();});});
  if(config.mcpEndpoint){bridge=createBridge({endpoint:config.mcpEndpoint,dispatch,onStatus:status=>{proxyState=status;try{onStatus(status);}catch{}}});bridge.start();}
  timer=setInterval(()=>{void refreshState();},10000);timer.unref();
 }catch{await close().catch(()=>{});throw Error('Control listener or proxy startup failed');}
 return {...app,gateway,adapter,dispatch,tools:tools.filter(tool=>reads.has(tool.name)),refreshState,close};
}
