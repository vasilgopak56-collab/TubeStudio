// Durable, bounded recovery for the YouTube uploads check; never makes network calls.
import {constants} from 'node:fs';
import fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ApiError} from '../../lib/errors.js';
import {dataPath} from '../../lib/storage.js';
import {checkCancelled} from '../../lib/taskContext.js';
import {assistantSafeDir,assistantProjectSnapshot} from '../assistant.js';
import {withProjectMutation} from '../projects.js';
import {loadBrainstormProjectEvidence} from './brainstormProjectEvidence.js';
import {uploadsQuotaBound} from './brainstormUploadsAdapter.js';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),cid=z.string().regex(/^UC[A-Za-z0-9_-]{22}$/),pid=z.string().regex(/^UU[A-Za-z0-9_-]{22}$/),vid=z.string().regex(/^[A-Za-z0-9_-]{11}$/),stamp=z.string().datetime();
const Earliest=z.object({videoId:vid,url:z.string(),publishedAt:stamp,ageDays:z.number().finite().nonnegative()}).strict().refine(x=>x.url===`https://www.youtube.com/watch?v=${x.videoId}`);
const Observation=z.object({channelId:cid,playlistId:pid,observedAt:stamp,pagesRead:z.number().int().min(1).max(3),validPublicCount:z.number().int().min(0).max(150),complete:z.boolean(),reason:z.enum(['complete','empty','page-limit','invalid-page','invalid-item','invalid-token']),earliest:Earliest.nullable(),freshness:z.enum(['new','not-new','unknown'])}).strict().refine(x=>{
 const e=x.earliest,age=e?(Date.parse(x.observedAt)-Date.parse(e.publishedAt))/86400000:null;
 return x.validPublicCount<=x.pagesRead*50&&Boolean(e)===(x.validPublicCount>0)&&x.complete===(x.reason==='complete')&&(!x.complete||!!e)&&(!e||(age!==null&&age>=0&&Math.abs(e.ageDays-age)<1e-9))&&x.freshness===(e&&e.ageDays>150?'not-new':x.complete&&e?'new':'unknown');
});
const Row=z.discriminatedUnion('status',[z.object({channelId:cid,status:z.literal('ok'),observation:Observation}).strict(),z.object({channelId:cid,status:z.enum(['unavailable','error','not-requested']),observation:z.null()}).strict()]);
export const UploadsRecovery=z.object({projectId:uuid,evidenceArtifactId:uuid,evidenceHash:hash,attemptId:uuid,observedAt:stamp,maxPages:z.number().int().min(1).max(3),logicalRequestsStarted:z.number().int().min(1),results:z.array(Row).min(1).max(50)}).strict().refine(x=>{
 const ids=x.results.map(r=>r.channelId),quota=uploadsQuotaBound(ids.length,x.maxPages);
 let stopped=false,pages=0;
 for(const row of x.results){
  if(stopped&&row.status!=='not-requested'||!stopped&&row.status==='not-requested')return false;
  if(row.status==='error')stopped=true;
  if(row.status==='ok'){if(row.observation.channelId!==row.channelId||row.observation.observedAt!==x.observedAt||row.observation.pagesRead>x.maxPages)return false;pages+=row.observation.pagesRead;}
 }
 return new Set(ids).size===ids.length&&x.logicalRequestsStarted>=1+pages&&x.logicalRequestsStarted<=quota.logicalRequests;
});
export type UploadsRecoveryT=z.infer<typeof UploadsRecovery>;
const Stored=z.object({version:z.literal(1),createdAt:stamp,recovery:UploadsRecovery,hash}).strict();
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const problem=(m:string,status:409|413=409)=>new ApiError('VALIDATION',m,status);
const folder='assistant-brainstorm-uploads';
const dir=()=>dataPath(folder);
export async function stageBrainstormUploads(raw:UploadsRecoveryT){
 const recovery=UploadsRecovery.parse(raw),base={version:1 as const,createdAt:new Date().toISOString(),recovery},record={...base,hash:digest(base)};
 await assistantSafeDir(dir(),true);checkCancelled();if((await fs.readdir(dir())).filter(n=>/^[0-9a-f-]{36}\.json$/i.test(n)).length>=500)throw problem('Хранилище результатов заполнено.');
 const bytes=JSON.stringify(record);if(Buffer.byteLength(bytes)>128*1024)throw problem('Результат проверки слишком велик.',413);
 const file=dataPath(folder,recovery.attemptId+'.json'),tmp=file+'.'+randomUUID()+'.tmp';
 try{await fs.writeFile(tmp,bytes,{flag:'wx',mode:0o600});checkCancelled();await fs.link(tmp,file);}
 catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw problem('Результат этой попытки уже существует.');throw e;}
 finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
 return {attemptId:recovery.attemptId};
}
export async function loadStagedBrainstormUploads(attemptId:string){
 uuid.parse(attemptId);if(!await assistantSafeDir(dir()))throw problem('Сохранённый результат не найден.');
 const file=dataPath(folder,attemptId+'.json'),st=await fs.lstat(file).catch(()=>null);
 if(!st||!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>128*1024)throw problem('Результат недоступен или повреждён.');
 const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);let buf:Buffer;try{const s=await h.stat();if(!s.isFile()||s.nlink!==1||s.size>128*1024)throw problem('Небезопасный файл результата.');buf=await h.readFile();if(buf.length>128*1024)throw problem('Слишком большой файл результата.');}finally{await h.close();}
 let r:z.infer<typeof Stored>;try{r=Stored.parse(JSON.parse(buf.toString('utf8')));}catch{throw problem('Результат повреждён. Исходный файл не изменён.');}
 const {hash:stored,...base}=r;if(r.recovery.attemptId!==attemptId||digest(base)!==stored)throw problem('Результат изменён или повреждён. Исходный файл не изменён.');return r;
}
async function commit(from:string,to:string){for(let i=0;;i++){checkCancelled();try{await fs.rename(from,to);return;}catch(e){if(!['EPERM','EBUSY','EACCES'].includes((e as NodeJS.ErrnoException).code??'')||i>=7)throw e;await new Promise(r=>setTimeout(r,25*2**i));}}}
export async function saveBrainstormUploads(raw:UploadsRecoveryT){
 const value=UploadsRecovery.parse(raw),valueHash=digest(value);
 return withProjectMutation(async()=>{
  checkCancelled();const loaded=await loadBrainstormProjectEvidence(value.projectId,value.evidenceArtifactId);
  if(loaded.evidenceHash!==value.evidenceHash)throw problem('Исследование изменилось или повреждено. Проверка не добавлена.');
  for(const r of value.results)if(loaded.scan.channels.filter(c=>c.id===r.channelId).length!==1)throw problem('Канал не найден в исходном исследовании. Проверка не добавлена.');
  const snap=await assistantProjectSnapshot(value.projectId);if(snap.snapshot!==loaded.projectSnapshot)throw problem('Проект изменился при чтении. Проверка не добавлена.');
  const existing=snap.project.artifacts.filter(a=>(a.data as any)?.source==='brainstorm-uploads'&&(a.data as any)?.attemptId===value.attemptId);
  if(existing.length){const data=existing[0].data as any;if(existing.length!==1||data.hash!==valueHash||digest(data.result)!==valueHash||!UploadsRecovery.safeParse(data.result).success)throw problem('Сохранённый результат этой попытки отличается или повреждён.');return {projectId:value.projectId,artifact:existing[0],alreadySaved:true};}
  const now=new Date().toISOString(),artifact={id:randomUUID(),kind:'analysis' as const,title:'Мозговой штурм: публичные загрузки каналов',createdAt:now,version:snap.project.artifacts.filter(a=>a.kind==='analysis').length+1,data:{source:'brainstorm-uploads',attemptId:value.attemptId,hash:valueHash,result:value}};
  const bytes=JSON.stringify({...snap.project,updatedAt:now,artifacts:[...snap.project.artifacts,artifact]},null,2);if(Buffer.byteLength(bytes)>10*1024*1024)throw problem('Результат не помещается в проект.',413);
  const tmp=snap.target+'.'+randomUUID()+'.tmp';try{checkCancelled();await fs.writeFile(tmp,bytes,{flag:'wx',mode:0o600});if((await assistantProjectSnapshot(value.projectId)).snapshot!==snap.snapshot)throw problem('Проект изменился во время сохранения. Результат не добавлен.');checkCancelled();await commit(tmp,snap.target);}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
  return {projectId:value.projectId,artifact,alreadySaved:false};
 });
}
export async function recoverBrainstormUploads(attemptId:string){checkCancelled();const r=await loadStagedBrainstormUploads(attemptId);checkCancelled();return saveBrainstormUploads(r.recovery);}
/** Read only the exact, intact upload result associated with this research. */
export async function loadBrainstormUploadsArtifact(projectId:string,artifactId:string){
 uuid.parse(projectId);uuid.parse(artifactId);const snap=await assistantProjectSnapshot(projectId);
 const found=snap.project.artifacts.filter(a=>a.id===artifactId&&(a.data as any)?.source==='brainstorm-uploads');
 if(found.length!==1)throw problem('Сохранённая проверка загрузок не найдена или неоднозначна.');
 const data=found[0].data as any,parsed=UploadsRecovery.safeParse(data?.result);
 if(!parsed.success||parsed.data.projectId!==projectId||data.attemptId!==parsed.data.attemptId||digest(data.result)!==data.hash)throw problem('Сохранённая проверка загрузок повреждена.');
 const evidence=await loadBrainstormProjectEvidence(projectId,parsed.data.evidenceArtifactId);
 if(evidence.projectSnapshot!==snap.snapshot||evidence.evidenceHash!==parsed.data.evidenceHash||parsed.data.results.some(r=>evidence.scan.channels.filter(c=>c.id===r.channelId).length!==1))throw problem('Исходное исследование изменилось или повреждено.');
 return {project:snap.project,projectSnapshot:snap.snapshot,artifactId,result:parsed.data};
}
