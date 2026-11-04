/** Fail closed: damaged tracker data must never be replaced with an empty store. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { dataPath } from '../lib/storage.js';
import { ApiError } from '../lib/errors.js';
import type { Comp, Alert } from './competitors.js';
export type CompetitorStore={channels:Comp[];alerts:Alert[];lastAuto?:string};
const text=z.string().max(10000),num=z.number().finite();
const point=z.object({t:num,v:num,l:num,c:num,viewsKnown:z.boolean().optional()}).passthrough();
const video=z.object({id:text,title:text,publishedAt:text,durationSec:num,isShort:z.boolean(),points:z.array(point).max(60),alerted:z.array(text).max(1000)}).passthrough();
const schema=z.object({channels:z.array(z.object({id:text,title:text,uploadsPlaylistId:text,addedAt:text,history:z.array(z.object({d:text}).passthrough()).max(400),videos:z.array(video).max(60)}).passthrough()).max(50),alerts:z.array(z.object({id:text,t:text,channelId:text,channelTitle:text,kind:z.enum(['new','outlier','spike','subs']),title:text,text,read:z.boolean()}).passthrough()).max(500),lastAuto:text.optional()}).passthrough();
const MAX=32*1024*1024;
export async function loadCompetitorStore():Promise<CompetitorStore>{
 let f,existed=false;try{const before=await fs.lstat(dataPath('competitors.json'));existed=true;if(!before.isFile()||before.isSymbolicLink()||before.size>MAX)throw Error();f=await fs.open(dataPath('competitors.json'),constants.O_RDONLY|constants.O_NOFOLLOW);const s=await f.stat();if(!s.isFile()||s.size>MAX||s.ino!==before.ino||s.dev!==before.dev)throw Error();const bytes=Buffer.alloc(Math.min(s.size+1,MAX+1));let used=0;while(used<bytes.length){const {bytesRead}=await f.read(bytes,used,bytes.length-used,null);if(!bytesRead)break;used+=bytesRead;}if(used>s.size||used>MAX)throw Error();return schema.parse(JSON.parse(bytes.subarray(0,used).toString('utf8'))) as unknown as CompetitorStore;}
 catch(e){if(!existed&&(e as NodeJS.ErrnoException).code==='ENOENT')return {channels:[],alerts:[]};throw new ApiError('VALIDATION','Хранилище конкурентов недоступно или повреждено. Восстановите резервную копию; файл не изменён.',409);}
 finally{await f?.close();}
}
export async function saveCompetitorStore(s:CompetitorStore){
 const bytes=JSON.stringify(s,null,2);if(Buffer.byteLength(bytes)>MAX)throw new ApiError('VALIDATION','Хранилище конкурентов превышает лимит 32 МиБ',409);
 schema.parse(s);const file=dataPath('competitors.json'),tmp=file+'.'+crypto.randomUUID()+'.tmp';
 try{await fs.mkdir(dataPath(),{recursive:true});await fs.writeFile(tmp,bytes,{mode:0o600,flag:'wx'});await fs.rename(tmp,file);}finally{await fs.rm(tmp,{force:true});}
}
