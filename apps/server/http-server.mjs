import {createServer} from 'node:http';
import {randomBytes, createHmac, timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

function cookieValue(header,name){const m=String(header||'').match(new RegExp('(?:^|;\\s*)'+name+'=([^;]+)'));return m?.[1];}
function sign(value,secret){return createHmac('sha256',secret).update(value).digest('base64url');}
function json(res,status,body){const data=Buffer.from(JSON.stringify(body));res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':data.length,'cache-control':'no-store'});res.end(data);}
async function body(req,limit=64*1024){const chunks=[];let n=0;for await(const c of req){n+=c.length;if(n>limit)throw Error('body too large');chunks.push(c);}if(!chunks.length)return {};return JSON.parse(Buffer.concat(chunks));}
export function createHttpServer({adapter,mcp,sessionSecret= randomBytes(32).toString('hex'),loginSecret,publicOrigin,secureCookies=true,sessionTtlMs=3600000,maxSessions=64,now=Date.now,serverInfo={name:'VoxCode',version:'0.1.0'},publicDir=new URL('./public/',import.meta.url)}){
 if(!adapter)throw Error('adapter required');
 if(typeof loginSecret!=='string'||loginSecret.length<16)throw Error('loginSecret must contain at least 16 characters');
 if(!publicOrigin||new URL(publicOrigin).origin!==publicOrigin)throw Error('publicOrigin required');
 if(!Number.isSafeInteger(maxSessions)||maxSessions<1||!Number.isFinite(sessionTtlMs)||sessionTtlMs<1)throw Error('invalid session limits');
 const sessions=new Map();
 const prune=()=>{for(const [id,expiry] of sessions)if(expiry<=now())sessions.delete(id);};
 const session=(req,res)=>{const raw=cookieValue(req.headers.cookie,'voxcode_session');if(!raw)return false;const [id,mac]=raw.split('.');if(!id||!mac)return false;const expected=sign(id,sessionSecret);if(mac.length!==expected.length||!timingSafeEqual(Buffer.from(mac),Buffer.from(expected)))return false;prune();return sessions.has(id);};
 const issue=(res)=>{const id=randomBytes(18).toString('base64url');prune();while(sessions.size>=maxSessions)sessions.delete(sessions.keys().next().value);sessions.set(id,now()+sessionTtlMs);res.setHeader('set-cookie',`voxcode_session=${id}.${sign(id,sessionSecret)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.ceil(sessionTtlMs/1000)}${secureCookies?'; Secure':''}`);};
 const handler=async(req,res)=>{try{const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/api/health'&&req.method==='GET')return json(res,200,{...serverInfo,codexAvailable:Boolean(adapter),mcpAvailable:Boolean(mcp)});
   if(req.method==='POST'&&url.pathname.startsWith('/api/')&&req.headers.origin!==publicOrigin)return json(res,403,{error:'invalid origin'});
   if(url.pathname==='/api/login'&&req.method==='POST'){const b=await body(req);const actual=sign(typeof b.password==='string'?b.password:'',sessionSecret),expected=sign(loginSecret,sessionSecret);if(!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return json(res,401,{error:'invalid credentials'});issue(res);return json(res,200,{ok:true});}
   if(url.pathname.startsWith('/api/')&&!session(req,res))return json(res,401,{error:'unauthenticated'});
   if(url.pathname==='/api/tasks'&&req.method==='GET')return json(res,200,{tasks:await adapter.listTasks()});
   if(url.pathname==='/api/tasks'&&req.method==='POST'){const b=await body(req);if(typeof b.prompt!=='string'||!b.prompt.trim())return json(res,400,{error:'prompt required'});return json(res,201,await adapter.startTask({prompt:b.prompt,title:b.title}));}
   const m=url.pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(confirm|cancel))?$/);if(m){const id=decodeURIComponent(m[1]);if(req.method==='GET'&&!m[2])return json(res,200,await adapter.getTask(id));if(req.method==='POST'&&m[2]==='confirm'){if(typeof adapter.confirmTask!=='function')return json(res,501,{error:'confirmation unavailable'});return json(res,200,await adapter.confirmTask(id));}if(req.method==='POST'&&m[2]==='cancel')return json(res,200,await adapter.cancelTask(id));}
   if(url.pathname.startsWith('/api/'))return json(res,404,{error:'not found'});
   if(url.pathname==='/mcp'&&mcp)return mcp(req,res);
   if(req.method==='GET'){const file=await readFile(join(new URL(publicDir).pathname,'index.html'));res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(file);}
   return json(res,404,{error:'not found'});
 }catch(e){return json(res,e.message==='body too large'?413:400,{error:e.message==='body too large'?'body too large':'request failed'});}};
 const server=createServer(handler);return {server,handler,sessions};
}
