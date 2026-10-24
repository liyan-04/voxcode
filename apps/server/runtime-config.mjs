import * as fileSystem from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import {isIP} from 'node:net';
import {X509Certificate,createPrivateKey,createPublicKey} from 'node:crypto';

const checked=new WeakMap();
const error=(code,message)=>Object.assign(Error(message),{code});
const absolute=value=>{if(typeof value!=='string'||!isAbsolute(value)||resolve(value)!==value)throw error('paths','Canonical absolute configuration paths required');return value;};
async function ancestors(path,uid,fs){
  for(let part=dirname(path);;part=dirname(part)){
    const info=await fs.lstat(part),stickyRoot=info.uid===0&&(info.mode&0o1000)!==0;
    if(!info.isDirectory()||info.isSymbolicLink()||![0,uid].includes(info.uid)||((info.mode&0o022)!==0&&!stickyRoot))throw error('permissions','Untrusted configuration ancestors');
    if(part===dirname(part))break;
  }
}
async function readTrusted(path,{uid,groups,taskGid,privateFile=true,fs}){
  absolute(path);const info=await fs.lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||![0,uid].includes(info.uid)||info.size<1||info.size>65536||await fs.realpath(path)!==path||(info.mode&0o022)!==0)throw error('permissions','Trusted configuration file required');
  if(privateFile&&((info.mode&0o007)!==0||(info.mode&0o040)!==0&&(info.gid===taskGid||!groups.includes(info.gid))))throw error('permissions','Private Web credential permissions required');
  await ancestors(path,uid,fs);await fs.access(path,constants.R_OK);return fs.readFile(path);
}
export async function loadServerConfiguration({env=process.env,uid=process.getuid?.(),groups=process.getgroups?.()??[],nodeVersion=process.versions.node,now=Date.now,fs=fileSystem}={}){
  if(!Number.isSafeInteger(uid)||uid<=0)throw error('identity','Dedicated non-root Web identity required');
  if(Number(nodeVersion.split('.')[0])!==22)throw error('node','Node22 runtime required');
  const origin=new URL(env.VOXCODE_PUBLIC_ORIGIN??'https://invalid.invalid');
  if(!env.VOXCODE_PUBLIC_ORIGIN||origin.protocol!=='https:'||origin.origin!==env.VOXCODE_PUBLIC_ORIGIN||origin.username||origin.password)throw error('origin','Strict HTTPS public origin required');
  const host=env.VOXCODE_HOST??'127.0.0.1',port=Number(env.VOXCODE_PORT??9899);
  if(!isIP(host)||!/^\d+$/u.test(String(env.VOXCODE_PORT??9899))||!Number.isSafeInteger(port)||port<1024||port>65535||Number(origin.port||443)!==port)throw error('origin','Fixed bind address and matching HTTPS port required');
  const taskUid=Number(env.VOXCODE_TASK_UID);
  if(!/^\d+$/u.test(env.VOXCODE_TASK_UID??'')||!Number.isSafeInteger(taskUid)||taskUid<=0||taskUid===uid)throw error('identity','A separate task identity is required');
  const taskSocket=absolute(env.VOXCODE_TASK_SOCKET),parent=dirname(taskSocket),parentInfo=await fs.lstat(parent),socketInfo=await fs.lstat(taskSocket);
  if(Buffer.byteLength(taskSocket)>100||!parentInfo.isDirectory()||parentInfo.isSymbolicLink()||await fs.realpath(parent)!==parent||parentInfo.uid!==taskUid||(parentInfo.mode&0o777)!==0o750||!socketInfo.isSocket()||socketInfo.isSymbolicLink()||socketInfo.uid!==taskUid||socketInfo.gid!==parentInfo.gid||(socketInfo.mode&0o777)!==0o660||!groups.includes(parentInfo.gid))throw error('socket','Protected task socket ownership and group access required');
  await ancestors(parent,uid,fs);await fs.access(taskSocket,constants.W_OK);
  const options={uid,groups,taskGid:parentInfo.gid,fs};
  const [key,cert,login]=await Promise.all([readTrusted(env.VOXCODE_TLS_KEY,options),readTrusted(env.VOXCODE_TLS_CERT,{...options,privateFile:false}),readTrusted(env.VOXCODE_LOGIN_SECRET_FILE,options)]);
  const loginSecret=login.toString('utf8').replace(/\r?\n$/u,'');
  if(loginSecret.length<16||loginSecret.length>4096||/[\r\n\x00]/u.test(loginSecret))throw error('credentials','Invalid private login secret');
  let certificate;
  try{
    certificate=new X509Certificate(cert);
    const hostname=origin.hostname.replace(/^\[|\]$/gu,''),matches=isIP(hostname)?certificate.checkIP(hostname):certificate.checkHost(hostname,{subject:'never'});
    if(!certificate.subjectAltName||!matches||!Number.isFinite(Date.parse(certificate.validFrom))||!Number.isFinite(Date.parse(certificate.validTo))||now()<Date.parse(certificate.validFrom)||now()>=Date.parse(certificate.validTo))throw Error('Certificate identity/date mismatch');
    const actual=certificate.publicKey.export({type:'spki',format:'der'}),expected=createPublicKey(createPrivateKey(key)).export({type:'spki',format:'der'});
    if(!actual.equals(expected))throw Error('Key mismatch');
  }catch{throw error('tls','TLS SAN, validity dates and key matching required');}
  let mcpEndpoint=null;
  if(env.VOXCODE_MCP_ENDPOINT_FILE){
    const raw=(await readTrusted(env.VOXCODE_MCP_ENDPOINT_FILE,options)).toString('utf8').replace(/\r?\n$/u,'');
    try{
      const endpoint=new URL(raw),tokens=endpoint.searchParams.getAll('token');
      if(endpoint.protocol!=='wss:'||endpoint.hostname!=='xrobo.qiniu.com'||endpoint.port||endpoint.pathname!=='/v1/mcpproxy/connect'||endpoint.username||endpoint.password||endpoint.hash||tokens.length!==1||tokens[0].length<16||tokens[0].length>512||/[\s\x00-\x1f\x7f]/u.test(tokens[0])||[...endpoint.searchParams.keys()].some(key=>key!=='token'))throw Error('Invalid endpoint');
      mcpEndpoint=endpoint.href;
    }catch{throw error('mcp','Private fixed WSS proxy endpoint required');}
  }
  const revision=env.VOXCODE_REVISION;
  if(typeof revision!=='string'||!/^[-a-zA-Z0-9_.]{7,100}$/u.test(revision))throw error('revision','Release revision required');
  return {host,port,publicOrigin:origin.origin,revision,taskSocket,taskUid,loginSecret,tls:{key,cert},mcpEndpoint,voiceAvailable:false};
}
export async function serverPreflight(options={}){
  try{
    const config=await loadServerConfiguration(options),report={ok:true,checks:[{name:'identity',status:'ok',detail:'Dedicated Web identity and separate protected task socket verified'},{name:'tls',status:'ok',detail:'HTTPS certificate SAN, dates and key match verified'},{name:'credentials',status:'ok',detail:'Private Web credential files verified'},{name:'mcp',status:config.mcpEndpoint?'configured':'disabled',detail:'Proxy registration remains connectivity-unverified; MCP mutations disabled'},{name:'voice',status:'disabled',detail:'Voice context correlation remains unverified'}]};checked.set(report,config);return report;
  }catch(e){return {ok:false,checks:[{name:['identity','node','origin','paths','permissions','socket','credentials','tls','mcp','revision'].includes(e?.code)?e.code:'configuration',status:'blocked',detail:'Startup blocked; verify dedicated identities, private configuration, TLS and task socket'}]};}
}
export function checkedServerConfiguration(report){const config=checked.get(report);if(!report?.ok||!config)throw error('configuration','Successful private preflight required');return config;}
