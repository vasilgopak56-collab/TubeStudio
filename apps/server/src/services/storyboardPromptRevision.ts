/** Explicit, local single-row prompt revision; source artifact remains immutable. */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {z} from 'zod';
import {ApiError} from '../lib/errors.js';
import {checkCancelled} from '../lib/taskContext.js';
import {assistantProjectSnapshot} from './assistant.js';
import {withProjectMutation} from './projects.js';
const id=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const PromptRevisionAsk=z.object({projectId:id,artifactId:id,position:z.number().int().min(1).max(100000),title:z.string().trim().min(1).max(200),image:z.string().max(10000),video:z.string().max(10000),actionId:id,sourceSnapshot:hash}).strict();
export const PromptRevisionSend=PromptRevisionAsk.extend({previewHash:hash,confirmed:z.literal(true)}).strict();
const fail=(m:string,status:409|413=409)=>new ApiError('VALIDATION',m,status);
const digest=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function plan(input:z.infer<typeof PromptRevisionAsk>){
 const d=PromptRevisionAsk.parse(input),snap=await assistantProjectSnapshot(d.projectId),matches=snap.project.artifacts.filter(a=>a.id===d.artifactId);
 if(matches.length!==1||matches[0].kind!=='storyboard')throw fail('Нужна одна выбранная сохранённая раскадровка.');
 if(snap.project.artifacts.some(a=>a.id===d.actionId))throw fail('Этот запрос уже сохранён или его ID занят. Проверьте версии проекта; повтор не создан.');
 if(snap.snapshot!==d.sourceSnapshot)throw fail('Проект изменился после загрузки сцены. Загрузите её заново.');
 const source=matches[0],data=source.data as any;
 if(!data||typeof data!=='object'||Array.isArray(data)||data.source==='audio'||!Array.isArray(data.rows))throw fail('Нужна текстовая раскадровка со списком сцен; раскадровка из аудио пока не поддерживается.');
 const row=data.rows[d.position-1];
 if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.image!=='string'||typeof row.video!=='string'||typeof row.text!=='string'||typeof row.concept!=='string'||!Number.isSafeInteger(row.n))throw fail('Выбранная позиция отсутствует или повреждена.');
 if(row.image.length>10000||row.video.length>10000)throw fail('Исходный промпт превышает 10 000 символов; он не обрезан.');
 if(d.image===row.image&&d.video===row.video)throw fail('Измените хотя бы один промпт.');
 const before={image:row.image,video:row.video},after={image:d.image,video:d.video};
 const previewHash=digest({input:d,snapshot:snap.snapshot,before,after});
 return {input:d,snap,source,data,row,before,after,hash:previewHash};
}
export async function previewPromptRevision(input:z.infer<typeof PromptRevisionAsk>){
 const p=await plan(input);return {input:p.input,hash:p.hash,project:{id:p.snap.project.id,title:p.snap.project.title},source:{id:p.source.id,title:p.source.title,version:p.source.version??null,n:p.row.n,position:p.input.position,text:p.row.text,concept:p.row.concept},before:p.before,after:p.after};
}
export async function savePromptRevision(input:z.infer<typeof PromptRevisionSend>){
 const {previewHash,confirmed:_,...ask}=PromptRevisionSend.parse(input);
 return withProjectMutation(async()=>{
  const p=await plan(ask);if(p.hash!==previewHash)throw fail('Проект или правки изменились после просмотра. Ничего не записано.');
  const rows=p.data.rows.map((r:unknown,i:number)=>i===p.input.position-1?{...p.row,image:p.after.image,video:p.after.video}:r);
  const artifact={id:p.input.actionId,kind:'storyboard',title:p.input.title,createdAt:new Date().toISOString(),version:p.snap.project.artifacts.filter(a=>a.kind==='storyboard').length+1,data:{...p.data,rows,manualPromptRevision:{sourceArtifactId:p.source.id,position:p.input.position,sourceSnapshot:p.snap.snapshot,notice:'Ручная правка промптов; прежние результаты валидаторов не проверяют новые промпты.'}}};
  const project={...p.snap.project,updatedAt:new Date().toISOString(),artifacts:[...p.snap.project.artifacts,artifact]},bytes=JSON.stringify(project,null,2);
  if(Buffer.byteLength(bytes)>10*1024*1024)throw fail('После добавления проект превысит 10 МиБ. Ничего не записано.',413);
  const tmp=p.snap.target+'.'+crypto.randomUUID()+'.tmp';try{checkCancelled();await fs.writeFile(tmp,bytes,{flag:'wx',mode:0o600});checkCancelled();const current=await assistantProjectSnapshot(p.input.projectId);if(current.snapshot!==p.snap.snapshot)throw fail('Проект изменился. Ничего не записано.');checkCancelled();await fs.rename(tmp,p.snap.target);}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
  return {projectId:project.id,artifact};
 });
}

/** Explicit per-field scene edits, grouped and committed as one version. */
const BatchEntry=z.object({position:z.number().int().min(1).max(100000),field:z.enum(['image','video']),value:z.string().max(10000).refine(x=>!!x.trim(),'Текст промпта не должен быть пустым.')}).strict();
export const PromptBatchAsk=z.object({projectId:id,artifactId:id,title:z.string().trim().min(1).max(200),actionId:id,sourceSnapshot:hash,entries:z.array(BatchEntry).min(1).max(40)}).strict().superRefine((x,ctx)=>{
 if(new Set(x.entries.map(e=>`${e.position}:${e.field}`)).size!==x.entries.length)ctx.addIssue({code:'custom',path:['entries'],message:'Каждое поле позиции можно выбрать только один раз.'});
 if(new Set(x.entries.map(e=>e.position)).size>20)ctx.addIssue({code:'custom',path:['entries'],message:'Не более 20 разных позиций.'});
 if(x.entries.reduce((n,e)=>n+e.value.length,0)>40000)ctx.addIssue({code:'custom',path:['entries'],message:'Не более 40 000 символов суммарно.'});
});
// Keep an object schema for extend(), while reapplying all cross-field constraints.
export const PromptBatchSend=z.object({projectId:id,artifactId:id,title:z.string().trim().min(1).max(200),actionId:id,sourceSnapshot:hash,entries:z.array(BatchEntry).min(1).max(40),previewHash:hash,confirmed:z.literal(true)}).strict().superRefine((x,ctx)=>{
 if(new Set(x.entries.map(e=>`${e.position}:${e.field}`)).size!==x.entries.length)ctx.addIssue({code:'custom',path:['entries'],message:'Каждое поле позиции можно выбрать только один раз.'});
 if(new Set(x.entries.map(e=>e.position)).size>20)ctx.addIssue({code:'custom',path:['entries'],message:'Не более 20 разных позиций.'});
 if(x.entries.reduce((n,e)=>n+e.value.length,0)>40000)ctx.addIssue({code:'custom',path:['entries'],message:'Не более 40 000 символов суммарно.'});
});
async function batchPlan(input:z.infer<typeof PromptBatchAsk>){
 const d=PromptBatchAsk.parse(input),snap=await assistantProjectSnapshot(d.projectId),matches=snap.project.artifacts.filter(a=>a.id===d.artifactId);
 if(matches.length!==1||matches[0].kind!=='storyboard')throw fail('Нужна одна выбранная сохранённая раскадровка.');
 if(snap.project.artifacts.some(a=>a.id===d.actionId))throw fail('Этот запрос уже сохранён или его ID занят. Проверьте версии проекта; повтор не создан.');
 if(snap.snapshot!==d.sourceSnapshot)throw fail('Проект изменился после загрузки сцен. Начните выбор заново.');
 const source=matches[0],data=source.data as any;
 if(!data||typeof data!=='object'||Array.isArray(data)||data.source==='audio'||!Array.isArray(data.rows))throw fail('Нужна текстовая раскадровка со списком сцен; раскадровка из аудио не поддерживается.');
 let sourceChars=0;
 const grouped=new Map<number,typeof d.entries>();
 for(const e of d.entries){const group=grouped.get(e.position)??[];group.push(e);grouped.set(e.position,group);}
 const changes=[...grouped].map(([position,entries])=>{
  const row=data.rows[position-1];
  if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.image!=='string'||typeof row.video!=='string'||typeof row.text!=='string'||typeof row.concept!=='string'||!Number.isSafeInteger(row.n))throw fail(`Позиция ${position} отсутствует или повреждена.`);
  if(row.image.length>10000||row.video.length>10000)throw fail(`Позиция ${position}: исходный промпт превышает 10 000 символов; обрезания нет.`);
  const chars=row.text.length+row.concept.length+row.image.length+row.video.length;sourceChars+=chars;if(chars>30000||sourceChars>120000)throw fail('Исходные данные превышают 30 000 символов на сцену или 120 000 суммарно; обрезания нет.');
  const before={image:row.image,video:row.video},after={...before};
  for(const e of entries){if(row[e.field]===e.value)throw fail(`Позиция ${position}: выбранный промпт не изменён.`);after[e.field]=e.value;}
  return {position,n:row.n,text:row.text,concept:row.concept,field:entries[0].field,fields:entries.map(e=>e.field),before,after};
 });
 return {input:d,snap,source,data,changes,hash:digest({input:d,snapshot:snap.snapshot,changes})};
}
export async function previewPromptBatch(input:z.infer<typeof PromptBatchAsk>){
 const p=await batchPlan(input);return {input:p.input,hash:p.hash,project:{id:p.snap.project.id,title:p.snap.project.title},source:{id:p.source.id,title:p.source.title,version:p.source.version??null},changes:p.changes};
}
export async function savePromptBatch(input:z.infer<typeof PromptBatchSend>){
 const {previewHash,confirmed:_,...ask}=PromptBatchSend.parse(input);
 return withProjectMutation(async()=>{
  const p=await batchPlan(ask);if(p.hash!==previewHash)throw fail('Проект или пакет изменились после просмотра. Ничего не записано.');
  const byPosition=new Map(p.changes.map(c=>[c.position,c]));
  const rows=p.data.rows.map((r:unknown,i:number)=>{const c=byPosition.get(i+1);return c?{...(r as object),image:c.after.image,video:c.after.video}:r;});
  const artifact={id:p.input.actionId,kind:'storyboard',title:p.input.title,createdAt:new Date().toISOString(),version:p.snap.project.artifacts.filter(a=>a.kind==='storyboard').length+1,data:{...p.data,rows,manualPromptRevision:{sourceArtifactId:p.source.id,positions:p.changes.map(c=>c.position),notice:'Ручная правка промптов; прежние результаты валидаторов не проверяют новые промпты.'}}};
  const project={...p.snap.project,updatedAt:new Date().toISOString(),artifacts:[...p.snap.project.artifacts,artifact]},bytes=JSON.stringify(project,null,2);
  if(Buffer.byteLength(bytes)>10*1024*1024)throw fail('После добавления проект превысит 10 МиБ. Ничего не записано.',413);
  const tmp=p.snap.target+'.'+crypto.randomUUID()+'.tmp';try{checkCancelled();await fs.writeFile(tmp,bytes,{flag:'wx',mode:0o600});checkCancelled();const current=await assistantProjectSnapshot(p.input.projectId);if(current.snapshot!==p.snap.snapshot)throw fail('Проект изменился. Ничего не записано.');checkCancelled();await fs.rename(tmp,p.snap.target);}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
  return {projectId:project.id,artifact};
 });
}
