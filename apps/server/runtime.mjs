import {createHttpServer} from './http-server.mjs';
import {createTaskRpcClient} from './task-rpc.mjs';
import {createMcpDispatcher} from './mcp-server.mjs';
import {createMcpProxyBridge} from './mcp-proxy-bridge.mjs';

const reads=new Set(['codex_status','codex_list_projects','codex_list_tasks','codex_task_status','codex_task_logs','codex_task_diff','codex_task_checks']);
export async function startServerRuntime({config,adapter=createTaskRpcClient({socketPath:config?.taskSocket}),createBridge=createMcpProxyBridge,onStatus=()=>{},shutdownTimeoutMs=10000}={}){
  if(!config||!config.tls?.key||!config.tls?.cert||!config.publicOrigin?.startsWith('https://')||!Number.isFinite(shutdownTimeoutMs)||shutdownTimeoutMs<10||shutdownTimeoutMs>20000)throw Error('Checked HTTPS runtime configuration required');
  let proxyStatus=config.mcpEndpoint?'connecting':'disabled',bridge,closing;
  const {dispatch:unsafeDispatch,tools}=createMcpDispatcher({adapter,projectRegistry:adapter,authorizeWrite:()=>false});
  const dispatch=async(message,request)=>{
    if(message?.method==='tools/call'&&!reads.has(message.params?.name))return {jsonrpc:'2.0',id:message.id??null,error:{code:-32003,message:'MCP mutations disabled until trusted voice context correlation is verified'}};
    const result=await unsafeDispatch(message,request);
    if(message?.method==='tools/list'&&result?.result?.tools)result.result.tools=result.result.tools.filter(tool=>reads.has(tool.name));
    return result;
  };
  const info={name:'VoxCode',version:'0.1.0',simulation:false,voiceAvailable:false,voiceState:'disabled',voiceBlocker:'cloud_mcp_session_correlation_unverified',mcpMutationsEnabled:false,get mcpProxyState(){return proxyStatus;}};
  const app=createHttpServer({adapter,projectRegistry:adapter,tls:config.tls,loginSecret:config.loginSecret,publicOrigin:config.publicOrigin,revision:config.revision,secureCookies:true,serverInfo:info});
  // No inbound MCP route is exposed. Only the configured outbound proxy may
  // invoke the guarded dispatcher. Browser APIs require their login session.
  app.server.headersTimeout=10000;app.server.requestTimeout=20000;app.server.keepAliveTimeout=5000;
  app.server.on('upgrade',(_req,socket)=>socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  try{
    await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(config.port,config.host,()=>{app.server.off('error',reject);resolve();});});
    if(config.mcpEndpoint){bridge=createBridge({endpoint:config.mcpEndpoint,dispatch,onStatus:status=>{proxyStatus=status;try{onStatus(status);}catch{}}});bridge.start();}
  }catch{await bridge?.close();if(app.server.listening)await new Promise(resolve=>app.server.close(resolve));throw Error('Server listener or proxy startup failed');}
  return {...app,dispatch,tools:tools.filter(tool=>reads.has(tool.name)),async close(){
    if(closing)return closing;
    closing=(async()=>{await bridge?.close();if(!app.server.listening)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{app.server.closeAllConnections();reject(Error('Web shutdown deadline reached'));},shutdownTimeoutMs);app.server.close(error=>{clearTimeout(timer);error?reject(error):resolve();});app.server.closeIdleConnections();});})();
    return closing;
  }};
}
