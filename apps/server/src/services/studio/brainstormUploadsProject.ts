// Quota-consuming phase: preview and explicit approval are required before a request.
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ApiError} from '../../lib/errors.js';
import {checkCancelled,rethrowCancelled,withTaskSignal} from '../../lib/taskContext.js';
import type {JobCtx} from '../../lib/jobs.js';
import {brainstormUploadsAdapter} from '../youtube.js';
import {reserveBrainstormAttempt} from './brainstormCollection.js';
import {loadBrainstormProjectEvidence} from './brainstormProjectEvidence.js';
import {inspectFirstVisibleUploads,type UploadObservation} from './brainstormFirstUploads.js';
import {uploadsQuotaBound} from './brainstormUploadsAdapter.js';
import {stageBrainstormUploads,saveBrainstormUploads} from './brainstormUploadsStore.js';
const cid=z.string().regex(/^UC[A-Za-z0-9_-]{22}$/);
const Ask=z.object({projectId:z.string().uuid(),evidenceArtifactId:z.string().uuid(),attemptId:z.string().uuid(),channelIds:z.array(cid).min(1).max(50),maxPages:z.number().int().min(1).max(3)}).strict().refine(x=>new Set(x.channelIds).size===x.channelIds.length,'Каналы повторяются');
const Send=Ask.extend({previewHash:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)}).strict();
type AskT=z.infer<typeof Ask>;
type Adapter=Awaited<ReturnType<typeof brainstormUploadsAdapter>>;
type IO={adapter:()=>Promise<Adapter>;now:()=>Date;stage?:typeof stageBrainstormUploads;save?:typeof saveBrainstormUploads};
const defaults:IO={adapter:brainstormUploadsAdapter,now:()=>new Date()};
const digest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const stale=()=>new ApiError('VALIDATION','Проект или выбор каналов изменился. Обновите просмотр; проверка не начата.',409);
async function prepare(raw:AskT){
 const input=Ask.parse(raw),loaded=await loadBrainstormProjectEvidence(input.projectId,input.evidenceArtifactId);
 const channels=input.channelIds.map(id=>{const matches=loaded.scan.channels.filter(c=>c.id===id);if(matches.length!==1)throw new ApiError('VALIDATION','Канал отсутствует в сохранённом исследовании или указан неоднозначно. Проверка не начата.',409);return {id,name:matches[0].name};});
 const quota=uploadsQuotaBound(channels.length,input.maxPages);
 const hash=digest({version:1,input,evidenceHash:loaded.evidenceHash,projectSnapshot:loaded.projectSnapshot,quota});
 return {input,loaded,channels,quota,hash};
}
export async function previewBrainstormUploads(raw:AskT){
 const p=await prepare(raw);
 return {project:{id:p.loaded.project.id,title:p.loaded.project.title},channels:p.channels,quota:p.quota,hash:p.hash,notice:'Отдельная проверка YouTube Data API: максимум указанное число единиц квоты с учётом возможных повторов и резервных ключей. Фактический расход может отличаться от счётчика TubeStudio. Списки ограничены; удалённые и скрытые публикации не видны. Проверяется самая ранняя доступная публичная загрузка, а не гарантированно первая публикация канала.'};
}
type Row={channelId:string;status:'ok';observation:UploadObservation}|{channelId:string;status:'unavailable'|'error'|'not-requested';observation:null};
export async function runBrainstormUploads(raw:z.infer<typeof Send>,ctx:JobCtx,io:IO=defaults){
 const {previewHash,confirmed,...ask}=Send.parse(raw);
 return withTaskSignal(ctx.signal,async()=>{
  checkCancelled();const p=await prepare(ask);if(p.hash!==previewHash)throw stale();
  await reserveBrainstormAttempt(p.input.attemptId,p.input.projectId,p.hash,'brainstorm-uploads');
  checkCancelled();if((await prepare(ask)).hash!==p.hash)throw stale();
  const adapter=await io.adapter(),observedAt=io.now().toISOString();checkCancelled();if((await prepare(ask)).hash!==p.hash)throw stale();let logicalRequestsStarted=0;
  const rows:Row[]=p.input.channelIds.map(channelId=>({channelId,status:'not-requested',observation:null}));
  const partial=()=>ctx.partial({stage:'uploads',results:structuredClone(rows),logicalRequestsStarted});
  let playlists:Map<string,string|null>;
  try{checkCancelled();logicalRequestsStarted++;playlists=await adapter.playlists(p.input.channelIds);checkCancelled();}
  catch(e){rethrowCancelled(e,ctx.signal);partial();throw new ApiError('UPSTREAM','Не удалось получить списки загрузок YouTube. Повторная проверка автоматически не запускалась; квота могла быть использована.',502);}
  for(let i=0;i<rows.length;i++){
   checkCancelled();const id=rows[i].channelId,playlist=playlists.get(id);
   ctx.progress(`Проверяю загрузки: канал ${i+1} из ${rows.length}`,Math.floor(i*100/rows.length));
   if(!playlist){rows[i]={channelId:id,status:'unavailable',observation:null};partial();continue;}
   let pagesStarted=0;
   try{
    const observation=await inspectFirstVisibleUploads({channelId:id,playlistId:playlist,observedAt,maxPages:p.input.maxPages,signal:ctx.signal},async(actual,token,signal)=>{
     checkCancelled();if(actual!==playlist||pagesStarted>=p.input.maxPages||logicalRequestsStarted>=p.quota.logicalRequests)throw new ApiError('VALIDATION','Превышен лимит проверки загрузок.',409);
     pagesStarted++;logicalRequestsStarted++;return adapter.page(actual,token,signal);
    });
    rows[i]={channelId:id,status:'ok',observation};partial();
   }catch(e){rethrowCancelled(e,ctx.signal);rows[i]={channelId:id,status:'error',observation:null};partial();break;}
  }
  const recovery={projectId:p.input.projectId,evidenceArtifactId:p.input.evidenceArtifactId,evidenceHash:p.loaded.evidenceHash,attemptId:p.input.attemptId,observedAt,maxPages:p.input.maxPages,logicalRequestsStarted,results:rows};
  ctx.partial({stage:'uploads-save',recovery});
  try{checkCancelled();await (io.stage??stageBrainstormUploads)(recovery);}catch(e){rethrowCancelled(e,ctx.signal);return {status:'unsaved' as const,recovery,notice:'Результат пока только в памяти и исчезнет после закрытия программы. Не повторяйте запрос ради сохранения.'};}
  try{checkCancelled();ctx.progress('Сохраняю проверку загрузок в проект',98);const saved=await (io.save??saveBrainstormUploads)(recovery);ctx.progress('Проверка загрузок сохранена',100);return {status:'saved' as const,projectId:saved.projectId,artifactId:saved.artifact.id,attemptId:p.input.attemptId,notice:'Сохранены только доступные публичные загрузки. Счётчик запросов не учитывает все повторы; фактическую квоту проверяйте в Google Cloud.'};}
  catch(e){rethrowCancelled(e,ctx.signal);return {status:'recoverable' as const,attemptId:p.input.attemptId,notice:'Результат сохранён на диске, но не добавлен в проект. Его можно восстановить без повторного запроса к YouTube.'};}
 });
}
export {Ask as BrainstormUploadsAsk,Send as BrainstormUploadsSend};
