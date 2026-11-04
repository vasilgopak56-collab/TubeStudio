/** Append-only recovery journal. Snapshots remain readable for manual export; continuation requires strict replay checks. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { dataPath } from '../lib/storage.js';
import { ApiError } from '../lib/errors.js';

const Id=z.string().uuid();
const MAX=8*1024*1024;
const digest=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ZERO='0'.repeat(64);
function verifyChain(events:any[]) {let prev=ZERO;for(const e of events){if(!e||typeof e!=="object"||Object.keys(e).sort().join(',')!=="at,data,hash,prev,type"||e.prev!==prev||e.hash!==digest({type:e.type,at:e.at,data:e.data,prev:e.prev}))throw problem();prev=e.hash;}return prev;}
const problem=()=>new ApiError('VALIDATION','Журнал прогресса недоступен или повреждён. Проверьте резервную копию; автоматический повтор не выполняется.',409);
async function directory(audioId:string,create=false){
  Id.parse(audioId); const root=dataPath('audio-storyboards'), progress=path.join(root,'progress'), dir=path.join(progress,audioId);
  for(const p of [root,progress,dir]) {
    if(create)await fs.mkdir(p,{recursive:false}).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='EEXIST')throw e;});
    try{const s=await fs.lstat(p);if(!s.isDirectory()||s.isSymbolicLink())throw problem();}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT'&&!create)return null;throw e;}
  } return dir;
}
export async function createAudioProgress(audioId:string,initial:unknown,runId?:string){
  const dir=await directory(audioId,true);if(!dir)throw problem(); const id=Id.parse(runId??crypto.randomUUID());
  const h=await fs.open(path.join(dir,`${id}.ndjson`),'wx',0o600);let length=0,prev=ZERO;
  async function append(type:string,data:unknown){const core={type,at:new Date().toISOString(),data,prev},hash=digest(core),line=Buffer.from(JSON.stringify({...core,hash})+'\n');if(length+line.length>MAX)throw problem();await h.writeFile(line);await h.sync();length+=line.length;prev=hash;}
  try{await append('begin',{schema:2,id,audioId,initial});}catch(e){await h.close();throw e;}
  return {id,append,close:()=>h.close()};
}
async function read(audioId:string,id:string){
  Id.parse(id);const dir=await directory(audioId);if(!dir)throw problem();let h;
  try {h=await fs.open(path.join(dir,`${id}.ndjson`),constants.O_RDONLY|(process.platform==='win32'?0:(constants.O_NOFOLLOW||0)));const stat=await h.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>MAX||stat.size<1)throw problem();const bytes=Buffer.alloc(stat.size);let n=0;while(n<bytes.length){const r=await h.read(bytes,n,bytes.length-n,n);if(!r.bytesRead)throw problem();n+=r.bytesRead;}const text=bytes.toString('utf8');const parts=text.split('\n');const truncated=parts.pop()!=='';const events=parts.map(x=>JSON.parse(x));if(!events.length||events[0]?.type!=='begin'||![1,2].includes(events[0]?.data?.schema)||events[0]?.data?.id!==id||events[0]?.data?.audioId!==audioId||events.some(e=>typeof e?.type!=='string'||typeof e?.at!=='string'))throw problem();if(events[0].data.schema===2)verifyChain(events);return {events,truncated,hash:crypto.createHash("sha256").update(bytes).digest("hex")};
  }catch{throw problem();}finally{await h?.close();}
}
export async function audioProgressDetail(audioId:string,id:string){await directory(audioId);return read(audioId,id);}
/** Re-check exact reviewed bytes on the same append handle. Caller holds the per-audio lock. */
export async function appendAudioProgress(audioId:string,id:string,expectedHash:string){
  Id.parse(id);if(!/^[a-f0-9]{64}$/.test(expectedHash))throw problem();const dir=await directory(audioId);if(!dir)throw problem();let h;
  try{h=await fs.open(path.join(dir,`${id}.ndjson`),constants.O_RDWR|constants.O_APPEND|(process.platform==='win32'?0:(constants.O_NOFOLLOW||0)));const st=await h.stat();if(!st.isFile()||st.nlink!==1||st.size<1||st.size>MAX)throw problem();const bytes=Buffer.alloc(st.size);let n=0;while(n<bytes.length){const r=await h.read(bytes,n,bytes.length-n,n);if(!r.bytesRead)throw problem();n+=r.bytesRead;}if(bytes.at(-1)!==10||crypto.createHash('sha256').update(bytes).digest('hex')!==expectedHash)throw problem();const events=bytes.toString('utf8').trimEnd().split('\n').map(x=>JSON.parse(x));if(events[0]?.data?.schema!==2||events[0]?.data?.audioId!==audioId||events[0]?.data?.id!==id)throw problem();let prev=verifyChain(events),length=st.size;const handle=h;return {id,async append(type:string,data:unknown){const core={type,at:new Date().toISOString(),data,prev},hash=digest(core),line=Buffer.from(JSON.stringify({...core,hash})+'\n');if(length+line.length>MAX)throw problem();await handle.writeFile(line);await handle.sync();length+=line.length;prev=hash;},close:()=>handle.close()};
  }catch(e){await h?.close();throw e;}
}
export async function listAudioProgress(audioId:string){
  const dir=await directory(audioId);if(!dir)return [];
  const names=(await fs.readdir(dir)).filter(n=>/^[0-9a-f-]{36}\.ndjson$/i.test(n));
  if(names.length>10000)throw problem();
  const candidates=await Promise.all(names.map(async name=>({name,mtime:(await fs.lstat(path.join(dir,name))).mtimeMs})));
  candidates.sort((a,b)=>b.mtime-a.mtime);
  const records=[];
  for(const {name} of candidates.slice(0,30)){const id=name.slice(0,-7);try{const {events,truncated}=await read(audioId,id);records.push({id,createdAt:events[0].at,bible:events.some(e=>e.type==='bible'),batches:events.filter(e=>e.type==='batch').length,last:events.at(-1).type,truncated});}catch{records.push({id,createdAt:'',bible:false,batches:0,last:'damaged',truncated:true});}}
  return records;
}
