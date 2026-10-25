import {open,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,resolve,dirname} from 'node:path';
import {isIP} from 'node:net';
import {X509Certificate,createPrivateKey,createPublicKey} from 'node:crypto';
import {validId} from '../../packages/control-protocol/index.mjs';

const invalid=()=>{throw Error('Invalid private control configuration');};
export async function readControlFile(path,{uid=process.getuid?.(),privateFile=true}={}){
 if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path)invalid();
 const info=await lstat(path);
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||![0,uid].includes(info.uid)||info.size<1||info.size>65536||await realpath(path)!==path||info.mode&(privateFile?0o077:0o022))invalid();
 for(let parent=dirname(path);;parent=dirname(parent)){
  const stat=await lstat(parent),stickyRoot=stat.uid===0&&(stat.mode&0o1000)!==0;
  if(!stat.isDirectory()||stat.isSymbolicLink()||![0,uid].includes(stat.uid)||(stat.mode&0o022)!==0&&!stickyRoot)invalid();
  if(parent===dirname(parent))break;
 }
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const current=await handle.stat();
  if(current.dev!==info.dev||current.ino!==info.ino||current.size!==info.size||current.mode!==info.mode||current.uid!==info.uid)invalid();
  const bytes=await handle.readFile();
  if(bytes.length>65536)invalid();
  return bytes;
 }finally{await handle.close();}
}
export async function loadControlConfiguration({path,uid=process.getuid?.(),nodeVersion=process.versions.node,now=Date.now}={}){
 try{
 if(!Number.isInteger(uid)||uid<=0||Number(nodeVersion.split('.')[0])<22||process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')invalid();
 const config=JSON.parse(await readControlFile(path,{uid}));
 const fields=['host','port','publicOrigin','revision','deviceId','userId','deviceRoot','tlsKeyFile','tlsCertFile','loginSecretFile','mcpEndpointFile'];
 if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).some(key=>!fields.includes(key))||!validId(config.deviceId)||!validId(config.userId)||!validId(config.revision)||!isAbsolute(config.deviceRoot??'')||resolve(config.deviceRoot)!==config.deviceRoot)invalid();
 const origin=new URL(config.publicOrigin);
 if(origin.protocol!=='https:'||origin.origin!==config.publicOrigin||origin.username||origin.password||!isIP(config.host)||!Number.isSafeInteger(config.port)||config.port<1024||config.port>65535||Number(origin.port||443)!==config.port)invalid();
 const key=await readControlFile(config.tlsKeyFile,{uid}),cert=await readControlFile(config.tlsCertFile,{uid,privateFile:false});
 const certificate=new X509Certificate(cert),host=origin.hostname.replace(/^\[|\]$/gu,'');
 if(!certificate.subjectAltName||!(isIP(host)?certificate.checkIP(host):certificate.checkHost(host,{subject:'never'}))||now()<Date.parse(certificate.validFrom)||now()>=Date.parse(certificate.validTo)||!certificate.publicKey.export({type:'spki',format:'der'}).equals(createPublicKey(createPrivateKey(key)).export({type:'spki',format:'der'})))invalid();
 const loginSecret=(await readControlFile(config.loginSecretFile,{uid})).toString().replace(/\r?\n$/u,'');
 if(loginSecret.length<16||loginSecret.length>4096||/[\x00\r\n]/u.test(loginSecret))invalid();
 let mcpEndpoint=null;
 if(config.mcpEndpointFile){
  const endpoint=new URL((await readControlFile(config.mcpEndpointFile,{uid})).toString().trim());
  if(endpoint.protocol!=='wss:'||endpoint.hostname!=='xrobo.qiniu.com'||endpoint.port||endpoint.pathname!=='/v1/mcpproxy/connect'||endpoint.username||endpoint.password||endpoint.hash||endpoint.searchParams.getAll('token').length!==1||[...endpoint.searchParams.keys()].some(k=>k!=='token')||!/^\S{16,512}$/u.test(endpoint.searchParams.get('token')??'')||/[\x00-\x1f\x7f]/u.test(endpoint.searchParams.get('token')??''))invalid();
  mcpEndpoint=endpoint.href;
 }
 return {...config,loginSecret,tls:{key,cert},mcpEndpoint};
 }catch{invalid();}
}
