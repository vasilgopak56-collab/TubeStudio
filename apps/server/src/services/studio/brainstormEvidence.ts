// Private building block: save observed evidence, not an AI report or channel changes.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {z} from 'zod';
import {ApiError} from '../../lib/errors.js';
import {checkCancelled} from '../../lib/taskContext.js';
import {assistantProjectSnapshot} from '../assistant.js';
import {withProjectMutation} from '../projects.js';
import type {ScanResult} from './brainstormScan.js';
import type {TopicResult} from './brainstormTopics.js';

const id=z.string().uuid();
const inputSchema=z.object({projectId:id,runId:id,task:z.string().trim().min(2).max(10000),research:z.record(z.string(),z.unknown()),topics:z.array(z.record(z.string(),z.unknown())).max(30).optional()}).strict();
const problem=(message:string,status:409|413=409)=>new ApiError('VALIDATION',message,status);
// Recheck cancellation at each Windows retry, including after a lock delay.
async function commitFile(from:string,to:string){for(let i=0;;i++){checkCancelled();try{await fs.rename(from,to);return;}catch(e){if(!['EPERM','EBUSY','EACCES'].includes((e as NodeJS.ErrnoException).code??'')||i>=7)throw e;await new Promise(r=>setTimeout(r,25*2**i));}}}
export async function saveBrainstormEvidence(input:{projectId:string;runId:string;task:string;research:ScanResult;topics?:TopicResult[]}){
 const d=inputSchema.parse(input);
 const evidence={format:'tubestudio-brainstorm-evidence',version:1,runId:d.runId,task:d.task,research:d.research,topics:d.topics??[],notice:'Наблюдения YouTube, а не готовый отчёт. Выборки могут быть неполными и устареть.'};
 const serialized=JSON.stringify(evidence);
 if(Buffer.byteLength(serialized)>4*1024*1024)throw problem('Результат исследования больше 4 МиБ. Ничего не сохранено.',413);
 const hash=crypto.createHash('sha256').update(serialized).digest('hex');
 // Freeze the actual bytes used for the hash before any asynchronous operation.
 const frozenEvidence=JSON.parse(serialized);
 return withProjectMutation(async()=>{
  checkCancelled();const snap=await assistantProjectSnapshot(d.projectId);
  const existing=snap.project.artifacts.filter(a=>(a.data as any)?.source==='brainstorm-evidence'&&(a.data as any)?.runId===d.runId);
  if(existing.length){if(existing.length!==1||(existing[0].data as any)?.hash!==hash)throw problem('Результат этого исследования уже сохранён с другими данными. Ничего не изменено.');return {projectId:d.projectId,artifact:existing[0],alreadySaved:true};}
  const now=new Date().toISOString();
  const artifact={id:crypto.randomUUID(),kind:'analysis' as const,title:'Исследование канала: данные YouTube',createdAt:now,version:snap.project.artifacts.filter(x=>x.kind==='analysis').length+1,data:{source:'brainstorm-evidence',runId:d.runId,hash,evidence:frozenEvidence}};
  const bytes=JSON.stringify({...snap.project,updatedAt:now,artifacts:[...snap.project.artifacts,artifact]},null,2);
  if(Buffer.byteLength(bytes)>10*1024*1024)throw problem('После добавления проект превысит 10 МиБ. Ничего не записано.',413);
  const tmp=snap.target+'.'+crypto.randomUUID()+'.tmp';
  try{checkCancelled();await fs.writeFile(tmp,bytes,{flag:'wx',mode:0o600});const current=await assistantProjectSnapshot(d.projectId);if(current.snapshot!==snap.snapshot)throw problem('Проект изменился во время сохранения. Ничего не записано.');checkCancelled();await commitFile(tmp,snap.target);}
  finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
  return {projectId:d.projectId,artifact,alreadySaved:false};
 });
}
