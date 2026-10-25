import * as fileSystem from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';

export async function assertPrivateParent(filePath,{fs=fileSystem}={}){
 if(!isAbsolute(filePath??'')||resolve(filePath)!==filePath)throw Error('Canonical private file path required');
 const parent=dirname(filePath),uid=process.getuid();
 const info=await fs.lstat(parent);
 if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==uid||(info.mode&0o077)||await fs.realpath(parent)!==parent)throw Error('Private owned parent required');
 for(let path=dirname(parent);;path=dirname(path)){
  const ancestor=await fs.lstat(path),stickyRoot=ancestor.uid===0&&(ancestor.mode&0o1000)!==0;
  if(!ancestor.isDirectory()||ancestor.isSymbolicLink()||![0,uid].includes(ancestor.uid)||((ancestor.mode&0o022)!==0&&!stickyRoot))throw Error('Trusted private file ancestors required');
  if(path===dirname(path))break;
 }
}

export async function readPrivateJson(filePath,{maxBytes=65536,fs=fileSystem}={}){
 await assertPrivateParent(filePath,{fs});
 const file=await fs.open(filePath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const info=await file.stat();
  if(!info.isFile()||info.nlink!==1||info.uid!==process.getuid()||(info.mode&0o077)||info.size>maxBytes)throw Error('Private operator-owned file required');
  const body=await file.readFile('utf8');
  if(Buffer.byteLength(body)>maxBytes)throw Error('Private file size limit');
  try{return JSON.parse(body);}catch{throw Error('Invalid private JSON file');}
 }finally{await file.close();}
}
