// Persist only a report recomputed from the exact stored evidence and validated proposal.
// Internal building block, not exposed as a client route.
import crypto from 'node:crypto';import fs from 'node:fs/promises';import {z} from 'zod';
import {ApiError} from '../../lib/errors.js';import {checkCancelled} from '../../lib/taskContext.js';
import {assistantProjectSnapshot} from '../assistant.js';import {withProjectMutation} from '../projects.js';
import {BrainstormProposal,composeBrainstormReport} from './brainstormReport.js';
import type {ScanResult} from './brainstormScan.js';import type {TopicResult} from './brainstormTopics.js';
const id=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const Ask=z.object({projectId:id,attemptId:id,evidenceArtifactId:id,evidenceHash:hash,proposal:BrainstormProposal}).strict();
const digest=(x:unknown)=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=(msg:string,status:409|413=409)=>new ApiError('VALIDATION',msg,status);
async function commitFile(from:string,to:string){for(let i=0;;i++){checkCancelled();try{await fs.rename(from,to);return;}catch(e){if(!['EPERM','EBUSY','EACCES'].includes((e as NodeJS.ErrnoException).code??'')||i>=7)throw e;await new Promise(r=>setTimeout(r,25*2**i));}}}
export async function saveBrainstormIdeaReport(raw:z.infer<typeof Ask>){
 const d=Ask.parse(raw);
 return withProjectMutation(async()=>{
  checkCancelled();const snap=await assistantProjectSnapshot(d.projectId),evidenceRows=snap.project.artifacts.filter(a=>a.id===d.evidenceArtifactId&&(a.data as any)?.source==='brainstorm-evidence');
  if(evidenceRows.length!==1)throw fail('Данные исследования отсутствуют или неоднозначны. Отчёт не сохранён.');
  const data=evidenceRows[0].data as any,e=data?.evidence;
  if(!e||e.format!=='tubestudio-brainstorm-evidence'||e.version!==1||data.hash!==digest(e)||!e.research||!Array.isArray(e.topics)||digest({scan:e.research,topics:e.topics})!==d.evidenceHash)throw fail('Данные исследования изменились или повреждены. Отчёт не сохранён.');
  let report;try{report=composeBrainstormReport(e.research as ScanResult,e.topics as TopicResult[],d.proposal);}catch{throw fail('Идеи или источники не прошли проверку. Отчёт не сохранён.');}
  const reportHash=digest({evidenceArtifactId:d.evidenceArtifactId,evidenceHash:d.evidenceHash,proposal:d.proposal}),existing=snap.project.artifacts.filter(a=>(a.data as any)?.source==='brainstorm-ideas'&&(a.data as any)?.attemptId===d.attemptId);
  if(existing.length){if(existing.length!==1||(existing[0].data as any)?.reportHash!==reportHash)throw fail('Этот запуск уже сохранён с другими данными.');return {projectId:d.projectId,artifact:existing[0],alreadySaved:true};}
  const now=new Date().toISOString(),artifact={id:crypto.randomUUID(),kind:'analysis' as const,title:'Мозговой штурм: идеи канала',createdAt:now,version:snap.project.artifacts.filter(a=>a.kind==='analysis').length+1,data:{source:'brainstorm-ideas',attemptId:d.attemptId,evidenceArtifactId:d.evidenceArtifactId,evidenceHash:d.evidenceHash,reportHash,proposal:d.proposal,report}};
  const serialized=JSON.stringify({...snap.project,updatedAt:now,artifacts:[...snap.project.artifacts,artifact]},null,2);
  if(Buffer.byteLength(serialized)>10*1024*1024)throw fail('Отчёт превышает размер проекта. Ничего не записано; исходные данные сохранены.',413);
  const tmp=snap.target+'.'+crypto.randomUUID()+'.tmp';try{checkCancelled();await fs.writeFile(tmp,serialized,{flag:'wx',mode:0o600});if((await assistantProjectSnapshot(d.projectId)).snapshot!==snap.snapshot)throw fail('Проект изменился во время сохранения. Отчёт не записан.');checkCancelled();await commitFile(tmp,snap.target);}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
  return {projectId:d.projectId,artifact,alreadySaved:false};
 });
}
