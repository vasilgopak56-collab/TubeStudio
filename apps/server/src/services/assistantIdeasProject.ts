import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {z} from 'zod';
import {ApiError} from '../lib/errors.js';
import {checkCancelled} from '../lib/taskContext.js';
import {loadAssistant,assistantProjectSnapshot} from './assistant.js';
import {withProjectMutation} from './projects.js';
const ID=z.string().uuid(),Hash=z.string().regex(/^[a-f0-9]{64}$/);
const digest=(x:unknown)=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=(message:string,status:400|409|413=409)=>new ApiError('VALIDATION',message,status);
const Choice=z.object({message:z.number().int().min(1).max(20),idea:z.number().int().min(1).max(8)}).strict();
export const IdeasProjectAsk=z.object({runId:ID,projectId:ID,title:z.string().trim().min(1).max(200),choices:z.array(Choice).min(1).max(8)}).strict();
export const IdeasProjectSend=IdeasProjectAsk.extend({previewHash:Hash,confirmed:z.literal(true)}).strict();
async function plan(input:z.infer<typeof IdeasProjectAsk>){
 const d=IdeasProjectAsk.parse(input),run=await loadAssistant(d.runId),seen=new Set<string>();
 const ordered=[...d.choices].sort((a,b)=>a.message-b.message||a.idea-b.idea);
 const ideas=ordered.map(c=>{const key=c.message+':'+c.idea;if(seen.has(key))throw fail('Идея выбрана повторно.');seen.add(key);
  const m=run.messages[c.message-1],idea=m?.output?.audienceIdeas?.[c.idea-1];if(m?.role!=='assistant'||!idea)throw fail('Выбранная идея недоступна. Обновите выбор.');
  const evidence=idea.evidence.map(e=>{const sources=run.context.sources.filter(s=>s.id===e.sourceId);if(sources.length!==1||sources[0].commentsStatus!=='ok')throw fail('Источник цитаты недоступен или неоднозначен.');const source=sources[0],comments=source.comments.filter(x=>x.id===e.commentId);if(comments.length!==1||!comments[0].text.includes(e.quote))throw fail('Комментарий или цитата недоступны либо неоднозначны.');return {...e,source:{title:source.title,channel:source.channel,url:source.url,fetchedAt:source.fetchedAt},commentTruncated:comments[0].truncated};});
  return {message:c.message,idea:c.idea,at:m.at,task:m.task,provider:m.provider??null,model:m.model??null,title:idea.title,reason:idea.reason,evidence};
 });
 const resultKey=digest({rootId:run.rootId,ideas}),text=JSON.stringify({format:'tubestudio-audience-ideas',version:1,notice:'Выбранные кандидаты AI и дословные цитаты из сохранённых комментариев. Это не проверка происхождения, смысла, фактов или спроса; выборка неполная и могла устареть.',dialogue:{id:run.id,rootId:run.rootId,title:run.title},ideas},null,2);
 if(text.length>60000)throw fail('Выбранная копия превышает 60 000 символов. Уменьшите выбор; текст не обрезан.',413);
 const snap=await assistantProjectSnapshot(d.projectId);if(snap.project.artifacts.some(x=>(x.data as any)?.assistantIdeasKey===resultKey))throw fail('Эта выборка идей уже добавлена в проект. Повторная заметка не создаётся.');
 const id=resultKey.slice(0,8)+'-'+resultKey.slice(8,12)+'-4'+resultKey.slice(13,16)+'-a'+resultKey.slice(17,20)+'-'+resultKey.slice(20,32),sha256=crypto.createHash('sha256').update(text).digest('hex');
 const artifact={id,kind:'note' as const,title:d.title,version:snap.project.artifacts.filter(x=>x.kind==='note').length+1,data:{source:'assistant-audience-ideas',assistantIdeasKey:resultKey,sha256,text}};
 return {input:d,runHash:digest(run),snap,artifact,hash:digest({input:d,runHash:digest(run),projectSnapshot:snap.snapshot,artifact})};
}
export async function previewIdeasProject(input:z.infer<typeof IdeasProjectAsk>){const p=await plan(input);return {input:p.input,hash:p.hash,project:{id:p.snap.project.id,title:p.snap.project.title},artifact:p.artifact,notice:'Создаётся отдельная заметка с показанной копией выбранных идей и цитат, без полной переписки и остальных комментариев. Она попадёт в проект и приватный backup. Дословное совпадение не подтверждает смысл, происхождение или спрос. AI и YouTube не запускаются.'};}
export async function saveIdeasProject(input:z.infer<typeof IdeasProjectSend>){const {previewHash,confirmed,...ask}=IdeasProjectSend.parse(input);return withProjectMutation(async()=>{
 checkCancelled();const p=await plan(ask);if(p.hash!==previewHash)throw fail('Диалог, проект или выбор изменились после просмотра. Повторите просмотр.');
 const artifact={...p.artifact,createdAt:new Date().toISOString()},project={...p.snap.project,updatedAt:new Date().toISOString(),artifacts:[...p.snap.project.artifacts,artifact]},bytes=JSON.stringify(project,null,2);if(Buffer.byteLength(bytes)>10*1024*1024)throw fail('После добавления проект превысит 10 МиБ. Ничего не записано.',413);
 const tmp=p.snap.target+'.'+crypto.randomUUID()+'.tmp';try{checkCancelled();await fs.writeFile(tmp,bytes,{flag:'wx',mode:0o600});const current=await assistantProjectSnapshot(ask.projectId),run=await loadAssistant(ask.runId);if(current.snapshot!==p.snap.snapshot||digest(run)!==p.runHash)throw fail('Проект или диалог изменились. Повторите просмотр.');checkCancelled();await fs.rename(tmp,p.snap.target);}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}return {projectId:project.id,artifact};
 });}
