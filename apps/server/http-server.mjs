import {createServer} from 'node:http';
import {randomBytes, createHmac, timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

function cookieValue(header,name){const m=String(header||'').match(new RegExp('(?:^|;\\s*)'+name+'=([^;]+)'));return m?.[1];}
function sign(value,secret){return createHmac('sha256',secret).update(value).digest('base64url');}
const validRequestId=value=>typeof value==='string'&&value.length>=1&&value.length<=128&&!/[\s\x00-\x1f\x7f]/u.test(value);
function json(res,status,body){const data=Buffer.from(JSON.stringify(body));res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':data.length,'cache-control':'no-store'});res.end(data);}
async function body(req,limit=64*1024){const chunks=[];let n=0;for await(const c of req){n+=c.length;if(n>limit)throw Error('body too large');chunks.push(c);}if(!chunks.length)return {};return JSON.parse(Buffer.concat(chunks));}
export function createHttpServer({adapter,mcp,projectRegistry,legacyProjectId,revision=process.env.VOXCODE_REVISION??null,sessionSecret= randomBytes(32).toString('hex'),loginSecret,publicOrigin,secureCookies=true,sessionTtlMs=3600000,maxSessions=64,now=Date.now,serverInfo={name:'VoxCode',version:'0.1.0'},publicDir=new URL('./public/',import.meta.url)}){
 if(!adapter)throw Error('adapter required');
 if(typeof loginSecret!=='string'||loginSecret.length<16)throw Error('loginSecret must contain at least 16 characters');
 if(!publicOrigin||new URL(publicOrigin).origin!==publicOrigin)throw Error('publicOrigin required');
 if(!Number.isSafeInteger(maxSessions)||maxSessions<1||!Number.isFinite(sessionTtlMs)||sessionTtlMs<1)throw Error('invalid session limits');
 const safeProject=p=>({id:p.id,name:p.name,enabled:p.enabled===true,scopes:[{id:'all',name:'全项目'}]});
 const project=async id=>{if(typeof id!=='string'||!id) return null;if(projectRegistry){const p=await projectRegistry.getProject(id);return p?.enabled===true?p:null;}return legacyProjectId&&id===legacyProjectId?{id,name:id,enabled:true}:null;};
 const taskProject=t=>t?.projectId??legacyProjectId;
 const sessions=new Map();
 const prune=()=>{for(const [id,expiry] of sessions)if(expiry<=now())sessions.delete(id);};
 const session=(req,res)=>{const raw=cookieValue(req.headers.cookie,'voxcode_session');if(!raw)return false;const [id,mac]=raw.split('.');if(!id||!mac)return false;const expected=sign(id,sessionSecret);if(mac.length!==expected.length||!timingSafeEqual(Buffer.from(mac),Buffer.from(expected)))return false;prune();return sessions.has(id);};
 const issue=(res)=>{const id=randomBytes(18).toString('base64url');prune();while(sessions.size>=maxSessions)sessions.delete(sessions.keys().next().value);sessions.set(id,now()+sessionTtlMs);res.setHeader('set-cookie',`voxcode_session=${id}.${sign(id,sessionSecret)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.ceil(sessionTtlMs/1000)}${secureCookies?'; Secure':''}`);};
 const handler=async(req,res)=>{try{const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/api/health'&&req.method==='GET'){let readiness;try{readiness=await adapter.status?.();}catch{}return json(res,200,{...serverInfo,name:'VoxCode',revision,simulation:serverInfo.simulation===true||!projectRegistry&&!legacyProjectId,codexAvailable:readiness?.available===true||readiness?.codexAvailable===true,mcpAvailable:Boolean(mcp)});}
   if(req.method==='POST'&&url.pathname.startsWith('/api/')&&req.headers.origin!==publicOrigin)return json(res,403,{error:'invalid origin'});
   if(url.pathname==='/api/login'&&req.method==='POST'){const b=await body(req);const actual=sign(typeof b.password==='string'?b.password:'',sessionSecret),expected=sign(loginSecret,sessionSecret);if(!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return json(res,401,{error:'invalid credentials'});issue(res);return json(res,200,{ok:true});}
   if(url.pathname.startsWith('/api/')&&!session(req,res))return json(res,401,{error:'unauthenticated'});
   if(url.pathname==='/api/projects'&&req.method==='GET')return json(res,200,{projects:projectRegistry?(await projectRegistry.listProjects()).map(safeProject):legacyProjectId?[safeProject({id:legacyProjectId,name:legacyProjectId,enabled:true})]:[]});
   if(url.pathname==='/api/tasks'&&req.method==='GET'){
     const id=url.searchParams.get('projectId');if(!await project(id))return json(res,404,{error:'project unavailable'});
     const flags={};for(const key of ['includeArchived','includeDeleted']){const values=url.searchParams.getAll(key);if(values.length>1||values.length&& !['true','false'].includes(values[0]))return json(res,400,{error:'invalid visibility filter'});flags[key]=values[0]==='true';}
     const tasks=await adapter.listTasks({projectId:id,...flags});return json(res,200,{tasks:tasks.filter(t=>taskProject(t)===id&&(flags.includeArchived||!t.archived)&&(flags.includeDeleted||!t.deletedAt))});
   }
   if(url.pathname==='/api/tasks'&&req.method==='POST'){
     const b=await body(req);if(!await project(b.projectId))return json(res,404,{error:'project unavailable'});if(!validRequestId(b.requestId))return json(res,400,{error:'invalid requestId'});if(typeof b.prompt!=='string'||!b.prompt.trim())return json(res,400,{error:'prompt required'});
     if(b.parentTaskId!==undefined&&b.parentTaskId!==null){if(typeof b.parentTaskId!=='string'||!b.parentTaskId||b.parentTaskId.length>128)return json(res,400,{error:'invalid parent task'});let parent;try{parent=await adapter.getTask(b.parentTaskId);}catch{}if(!parent||taskProject(parent)!==b.projectId||parent.deletedAt)return json(res,400,{error:'parent task unavailable'});}
     return json(res,201,await adapter.startTask({projectId:b.projectId,prompt:b.prompt,title:b.title,requestId:b.requestId,...(b.parentTaskId!==undefined?{parentTaskId:b.parentTaskId}:{})}));
   }
   const m=url.pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(confirm|cancel|archive|delete|restore))?$/);if(m){
     const id=decodeURIComponent(m[1]);const task=await adapter.getTask(id);if(!task||!await project(taskProject(task)))return json(res,404,{error:'task unavailable'});const requested=url.searchParams.get('projectId');if(requested&&requested!==taskProject(task))return json(res,404,{error:'task unavailable'});
     if(req.method==='GET'&&!m[2])return json(res,200,{...task,projectId:taskProject(task),parentTaskId:task.parentTaskId??null,metadataRevision:task.metadataRevision??1,archived:task.archived===true,deletedAt:task.deletedAt??null});
     if(req.method==='POST'&&m[2]){
       const b=await body(req);if(b.projectId&&b.projectId!==taskProject(task))return json(res,404,{error:'task unavailable'});
       if(m[2]==='confirm'){if(!validRequestId(b.requestId)||!Number.isSafeInteger(b.revision)||b.revision<1)return json(res,400,{error:'invalid execution mutation'});if(typeof adapter.confirmTask!=='function')return json(res,501,{error:'confirmation unavailable'});return json(res,200,await adapter.confirmTask(id,{revision:b.revision,requestId:b.requestId}));}
       if(m[2]==='cancel'){if(!validRequestId(b.requestId))return json(res,400,{error:'invalid requestId'});if(typeof adapter.cancelTask!=='function')return json(res,501,{error:'cancellation unavailable'});return json(res,200,await adapter.cancelTask(id,{requestId:b.requestId}));}
       if(typeof adapter[m[2]+'Task']!=='function')return json(res,501,{error:'task visibility unavailable'});
       if(!validRequestId(b.requestId)||!Number.isSafeInteger(b.metadataRevision)||b.metadataRevision<1||m[2]==='archive'&&typeof b.archived!=='boolean')return json(res,400,{error:'invalid metadata mutation'});
       if(m[2]!=='restore'&&(['queued','running','cancelling','waiting_approval','approval_required'].includes(task.status)||task.quarantined))return json(res,409,{error:'stop and reconcile task first'});
       return json(res,200,await adapter[m[2]+'Task'](id,{requestId:b.requestId,metadataRevision:b.metadataRevision,...(m[2]==='archive'?{archived:b.archived}:{})}));
     }
   }
   if(url.pathname.startsWith('/api/'))return json(res,404,{error:'not found'});
   if(url.pathname==='/mcp'&&mcp)return mcp(req,res);
   if(req.method==='GET'){const file=await readFile(join(new URL(publicDir).pathname,'index.html'));res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(file);}
   return json(res,404,{error:'not found'});
 }catch(e){return json(res,e.message==='body too large'?413:['revision_conflict','request_conflict','busy','quarantined','outcome_unknown'].includes(e.code)?409:400,{error:e.message==='body too large'?'body too large':'request failed'});}};
 const server=createServer(handler);return {server,handler,sessions};
}
