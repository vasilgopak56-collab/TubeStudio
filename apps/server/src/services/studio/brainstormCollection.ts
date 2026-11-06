// Internal research-stage coordinator. Not exposed as a route until the complete
// release has paid preview and UI approval.
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {z} from 'zod';
import {ApiError} from '../../lib/errors.js';
import {checkCancelled,withTaskSignal} from '../../lib/taskContext.js';
import type {JobCtx} from '../../lib/jobs.js';
import {assistantProjectSnapshot,assistantSafeDir} from '../assistant.js';
import {dataPath} from '../../lib/storage.js';
import {ScanPlan,scanBrainstorm} from './brainstormScan.js';
import {TopicPlan,scanTopics,type TopicResult} from './brainstormTopics.js';
import {saveBrainstormEvidence} from './brainstormEvidence.js';
const Ask=z.object({projectId:z.string().uuid(),runId:z.string().uuid(),task:z.string().trim().min(2).max(10000),scan:ScanPlan,topics:TopicPlan}).strict().refine(x=>x.scan.region.toUpperCase()===x.topics.region.toUpperCase(),'Регионы исследования не совпадают');
const Send=Ask.extend({previewHash:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)}).strict();
const digest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const stale=()=>new ApiError('VALIDATION','План или проект изменились после просмотра. Обновите план; запросы не отправлены.',409);
type AskInput=z.input<typeof Ask>;
export async function previewBrainstormCollection(input:AskInput){
 const p=Ask.parse(input),snap=await assistantProjectSnapshot(p.projectId);
 if(snap.project.artifacts.some(a=>(a.data as any)?.source==='brainstorm-evidence'&&(a.data as any)?.runId===p.runId))throw new ApiError('VALIDATION','Для этого запуска данные уже сохранены. Новый поиск не начат.',409);
 const hash=digest({version:1,plan:p,projectSnapshot:snap.snapshot});
 return {plan:p,project:{id:snap.project.id,title:snap.project.title},hash,counts:{searches:p.scan.queries.length*2,topics:p.topics.queries.length,maxChannelReads:400,maxPagesPerChannel:3,maxVideosPerChannel:60},notice:'Будут запрошены публичные страницы YouTube, а собранные данные добавлены отдельным материалом в выбранный проект. Модель, G-Labs, профиль и календарь не запускаются и не изменяются на этом этапе. Для каждого канала — до трёх страниц вкладки «Видео» и 60 роликов без явных Shorts и эфиров; при ошибках возможны повторы запросов. Это не проверка самой первой публикации. Полученная выборка может быть неполной.'};
}
// Immutable claim is made before any external request. A crash leaves an unknown
// attempt, never an automatic replay. A fresh deliberate run needs a new UUID.
export async function reserveBrainstormAttempt(runId:string,projectId:string,hash:string,kind:'brainstorm-collection'|'brainstorm-ideas'|'brainstorm-brand-plan'|'brainstorm-planning'='brainstorm-collection'){
 const dir=dataPath('assistant-attempts');await assistantSafeDir(dir,true);checkCancelled();
 const names=await fs.readdir(dir);if(names.filter(n=>/^[0-9a-f-]{36}\.json$/i.test(n)).length>=500)throw new ApiError('VALIDATION','Лимит записей попыток достигнут. Новый сбор не начат.',409);
 const target=dataPath('assistant-attempts',runId+'.json'),tmp=target+'.'+randomUUID()+'.tmp';
 try{await fs.writeFile(tmp,JSON.stringify({id:runId,projectId,kind,hash,createdAt:new Date().toISOString(),status:'started-or-unknown'}),{flag:'wx',mode:0o600});checkCancelled();await fs.link(tmp,target);}
 catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new ApiError('VALIDATION','Этот запуск уже начат или его состояние неизвестно. Проверьте проект; для нового запуска нужен новый план.',409);throw e;}
 finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
}
type IO={scan:typeof scanBrainstorm;topics:typeof scanTopics;save:typeof saveBrainstormEvidence};
const defaults:IO={scan:scanBrainstorm,topics:scanTopics,save:saveBrainstormEvidence};
export async function runBrainstormCollection(input:z.input<typeof Send>,ctx:JobCtx,io:IO=defaults){
 const {previewHash,confirmed,...ask}=Send.parse(input);
 return withTaskSignal(ctx.signal,async()=>{
  checkCancelled();const p=await previewBrainstormCollection(ask);if(p.hash!==previewHash)throw stale();checkCancelled();
  await reserveBrainstormAttempt(p.plan.runId,p.plan.projectId,p.hash);checkCancelled();
  if((await previewBrainstormCollection(ask)).hash!==p.hash)throw stale();checkCancelled();
  const scan=await io.scan(p.plan.scan,{signal:ctx.signal,progress:(s,n)=>ctx.progress(s,Math.floor(n*.8)),partial:ctx.partial});checkCancelled();
  let topics:TopicResult[];
  if(scan.coverage.stoppedByYoutube){topics=p.plan.topics.queries.map(query=>({query,status:'not-requested',sample:null}));}
  else {const t=await io.topics(p.plan.topics,{signal:ctx.signal,progress:(s,n)=>ctx.progress(s,80+Math.floor(n*.15))});topics=t.results;}
  checkCancelled();ctx.progress('Сохраняю собранные данные в проект',96);
  const saved=await io.save({projectId:p.plan.projectId,runId:p.plan.runId,task:p.plan.task,research:scan,topics});checkCancelled();
  ctx.progress('Сбор данных завершён',100);
  return {projectId:saved.projectId,artifactId:saved.artifact.id,coverage:scan.coverage,topics:{planned:topics.length,completed:topics.filter(x=>x.status==='ok').length,failed:topics.filter(x=>x.status==='failed').length,notRequested:topics.filter(x=>x.status==='not-requested').length},notice:'Это сбор наблюдений, а не готовый отчёт и не создание канала.'};
 });
}
