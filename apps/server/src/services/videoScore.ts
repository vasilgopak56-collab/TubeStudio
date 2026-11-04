/** Public metadata snapshot. No AI score, private Analytics, scraping or rank prediction. */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { dataPath } from "../lib/storage.js";
import { checkCancelled, rethrowCancelled, withTaskSignal } from "../lib/taskContext.js";
import type { JobCtx } from "../lib/jobs.js";
import { getVideos, getChannelsFull, videoScoreUploadPage, type Video } from "./youtube.js";
import { parseVideoId } from "./youtubeCaptions.js";
import { median } from "./metrics.js";

const Id = z.string().uuid(), VideoId = z.string().regex(/^[\w-]{11}$/);
export const VideoScoreInput = z.object({ video: z.string().trim().min(1).max(2048), baseline: z.boolean().default(true) }).strict().transform(d => ({ videoId: parseVideoId(d.video), baseline: d.baseline }));
const Counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const Source = z.object({ id: VideoId, title: z.string().max(1000), description: z.string().max(20000), channelId: z.string().max(100), channelTitle: z.string().max(1000), publishedAt: z.string().max(100), durationSec: Counter, views: Counter, likes: Counter, comments: Counter, tags: z.array(z.string().max(500)).max(100) }).strict();
type SourceT = z.infer<typeof Source>;
const Sample = Source.pick({id:true,title:true,publishedAt:true,durationSec:true,views:true,channelId:true}).strip();
const SnapshotV1 = z.object({ version:z.literal(1),id:Id,createdAt:z.string().datetime(), requestedBaseline:z.boolean(), source:Source, sample:z.array(Sample).max(50), baselineStatus:z.enum(["loaded","disabled","unavailable"]), baselineNote:z.string().max(500) }).strict();
const Stamp=z.string().datetime();
const Duration=Counter.refine(n=>n===null||n>0);
const SampleV2=Sample.extend({durationSec:Duration,metadata:z.enum(["returned","missing"])}).strict();
const SnapshotV2=SnapshotV1.extend({version:z.literal(2),source:Source.extend({channelId:z.string().regex(/^UC[\w-]{22}$/),durationSec:Duration}),sample:z.array(SampleV2).max(50),observations:z.object({targetAt:Stamp,channelAt:Stamp.nullable(),pageAt:Stamp.nullable(),sampleAt:Stamp.nullable()}).strict(),page:z.object({ids:z.array(VideoId).max(50),hasMore:z.boolean()}).strict().nullable()}).strict();
const Snapshot=z.discriminatedUnion("version",[SnapshotV1,SnapshotV2]);
type SnapshotT = z.infer<typeof Snapshot>;
function validSnapshot(s:SnapshotT){
 if(s.version===1)return true;const o=s.observations,stamps=[o.targetAt,o.channelAt,o.pageAt,o.sampleAt].filter((x):x is string=>x!==null).map(Date.parse);
 if(stamps.some((x,i)=>x>Date.parse(s.createdAt)||i>0&&x<stamps[i-1]))return false;
 if(!s.requestedBaseline)return s.baselineStatus==="disabled"&&s.sample.length===0&&s.page===null&&o.channelAt===null&&o.pageAt===null&&o.sampleAt===null;
 if(s.baselineStatus!=="loaded")return s.baselineStatus==="unavailable"&&s.sample.length===0&&s.page===null&&o.pageAt===null&&o.sampleAt===null;
 const ids=s.page?.ids;
 return !!ids&&o.channelAt!==null&&o.pageAt!==null&&(ids.length===0?o.sampleAt===null:o.sampleAt!==null)&&new Set(ids).size===ids.length&&s.sample.length===ids.length&&s.sample.every((x,i)=>x.id===ids[i]&&(x.metadata==="returned"?x.channelId===s.source.channelId:x.title===""&&x.channelId===""&&x.publishedAt===""&&x.durationSec===null&&x.views===null));
}
const counter=(n:number,known?:boolean)=>known===true && Number.isSafeInteger(n) && n>=0 ? n : null;
export function scoreSource(v:Video):SourceT {
  return Source.parse({ id:v.id,title:v.title,description:v.description,channelId:v.channelId,channelTitle:v.channelTitle,publishedAt:v.publishedAt,
    durationSec:v.durationKnown===true && Number.isSafeInteger(v.durationSec) && v.durationSec>0 ? v.durationSec:null,
    views:counter(v.views,v.viewsKnown),likes:counter(v.likes,v.likesKnown),comments:counter(v.comments,v.commentsKnown),tags:v.tags });
}
const bucket=(n:number|null)=>n===null?null:n<=180?"≤180 с":">180 с";
function ageHours(date:string,now:number) { const t=Date.parse(date); return Number.isFinite(t) && t<=now ? (now-t)/3600000 : null; }
const rounded=(n:number)=>Number.isFinite(n)?Math.round(n*100)/100:null;
export function videoScoreReport(s:SnapshotT) {
  const v=s.source,now=Date.parse(s.version===2?s.observations.targetAt:s.createdAt),sampleNow=Date.parse(s.version===2?(s.observations.sampleAt??s.observations.pageAt??s.createdAt):s.createdAt),age=ageHours(v.publishedAt,now),seen=new Set<string>();
  const rows=s.sample.map(x=>{
    const h=ageHours(x.publishedAt,sampleNow); let reason="В базе";
    if("metadata" in x && x.metadata==="missing")reason="Метаданные не получены";
    else if(seen.has(x.id))reason="Повтор ID";
    else if(x.id===v.id)reason="Само видео";
    else if(x.channelId!==v.channelId)reason="Другой канал";
    else if(bucket(x.durationSec)===null || bucket(v.durationSec)===null)reason="Неизвестная длительность";
    else if(bucket(x.durationSec)!==bucket(v.durationSec))reason="Другая группа длительности";
    else if(x.views===null)reason="Просмотры недоступны";
    else if(h===null)reason="Неверная или будущая дата";
    else if(h<48)reason="Моложе 48 часов";
    seen.add(x.id); return {...x,eligible:reason==="В базе",reason};
  });
  const eligible=rows.filter(x=>x.eligible),base=eligible.length>=3 ? median(eligible.map(x=>x.views!)):null;
  const outlier=s.baselineStatus==="loaded" && base!==null && base>0 && v.views!==null && age!==null && age>=48 ? rounded(v.views/base):null;
  const checks=[
    {label:"Заголовок",value:`${[...v.title].length} символов`,note:v.title.trim()?"Заголовок получен. Ясность и соответствие ролику проверьте вручную.":"Заголовок пуст."},
    {label:"Описание",value:`${[...v.description].length} символов`,note:v.description.trim()?"Описание получено. Проверьте первые строки, ссылки и факты.":"Описание отсутствует."},
    {label:"Теги",value:`${v.tags.length}`,note:v.tags.length?"Список получен из API; наличие тегов не гарантирует показы.":"API не вернул теги. Это не ошибка и не прогноз эффективности."},
  ];
  const outlierReason=outlier!==null?"":s.baselineStatus==="disabled"?"Сравнение отключено":s.baselineStatus==="unavailable"?"База недоступна":v.views===null?"Просмотры цели неизвестны":age===null?"Дата публикации цели некорректна":age<48?"Цель моложе 48 часов":bucket(v.durationSec)===null?"Длительность цели неизвестна":eligible.length<3?"Нужны минимум 3 других подходящих видео":base===0?"Медиана базы равна нулю":"Нет корректной базы";
  return {...s,legacy:s.version===1,metrics:{outlierReason,ageHours:age,views:v.views,likes:v.likes,comments:v.comments,
    vph:age!==null && age>0 && v.views!==null ? rounded(v.views/Math.max(1,age)):null,
    engagement:v.views!==null && v.views>0 && v.likes!==null && v.comments!==null ? rounded((v.likes+v.comments)/v.views*100):null,
    outlier,formatGroup:bucket(v.durationSec)},baseline:{median:base,sampleSize:eligible.length,rows},checks,
    notices:[
      "VPH — просмотры / часы с публикации до наблюдения цели, минимум 1 час в знаменателе. Это средняя за всё время, не скорость сейчас.",
      s.version===1?"Архив v1: отдельные даты наблюдений и исходный порядок IDs страницы не сохранены. Происхождение не дописывается; расчёт по прежней дате завершения.":"Снимок v2: даты получения цели, канала, страницы и метаданных сохранены отдельно. Ответы последовательные, не одновременные. Возраст цели/базы считается на дату их наблюдения; ожидание и повторное открытие не меняют метрики.",
      "Вовлечение — (лайки + комментарии) / просмотры × 100. Это не доля уникальных зрителей; если любой счётчик недоступен, результата нет.",
      "Outlier — просмотры / медиана базы (минимум 3 ролика, медиана > 0). Сам ролик и база должны быть не моложе 48 часов. Возраст роликов не выравнивается: это не сравнение за одинаковый период и не прогноз.",
      "База — одна страница до 50 последних загрузок того же канала. Группы ≤180 с и >180 с определены только по длительности, не по реальному статусу Shorts. Разные правила подсчёта просмотров и возраст могут искажать сравнение.",
      "CTR, показы, удержание, доход, поисковые позиции и dislikes здесь недоступны. Локальные проверки — наблюдения об оформлении, не SEO-рейтинг, не AI-разбор содержания и не гарантия роста."
    ]};
}
export type VideoScoreReport = ReturnType<typeof videoScoreReport>;
const folder=()=>dataPath("video-score-runs");
async function safeFolder(create=false) {
  if(create)await fs.mkdir(folder(),{recursive:true,mode:0o700});
  try {const st=await fs.lstat(folder());if(st.isSymbolicLink()||!st.isDirectory())throw new ApiError("VALIDATION","Каталог снимков недоступен",400);return true;}
  catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return false;throw e;}
}
export async function loadVideoScore(id:string):Promise<VideoScoreReport|null> {
  if(!Id.safeParse(id).success)throw new ApiError("VALIDATION","Неверный ID снимка");
  if(!await safeFolder())return null;
  let file;try {
    const name=dataPath("video-score-runs",id+".json"),st=await fs.lstat(name);
    if(!st.isFile()||st.isSymbolicLink()||st.size>256*1024)return null;
    file=await fs.open(name,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    const opened=await file.stat();if(!opened.isFile()||opened.ino!==st.ino||opened.dev!==st.dev||opened.size>256*1024)return null;
    const bytes=Buffer.alloc(256*1024+1);let n=0;while(n<bytes.length){const r=await file.read(bytes,n,bytes.length-n,null);if(!r.bytesRead)break;n+=r.bytesRead;}if(n>256*1024)return null;
    const p=Snapshot.safeParse(JSON.parse(bytes.subarray(0,n).toString("utf8")));
    return p.success && p.data.id===id && validSnapshot(p.data) ? videoScoreReport(p.data):null;
  }catch(e){if(["ENOENT","ELOOP"].includes((e as NodeJS.ErrnoException).code??"")||e instanceof SyntaxError)return null;throw e;}finally{await file?.close();}
}
export async function listVideoScores() {
  if(!await safeFolder())return {items:[],skipped:0};
  const names=await fs.readdir(folder()),items=[];let skipped=0;
  if(names.length>5000)throw new ApiError("VALIDATION","В каталоге больше 5000 записей. Архивируйте часть снимков при остановленной программе.");
  for(const name of names){if(!name.endsWith(".json")||!Id.safeParse(name.slice(0,-5)).success)continue;const r=await loadVideoScore(name.slice(0,-5));if(r)items.push({id:r.id,createdAt:r.createdAt,title:r.source.title,videoId:r.source.id});else skipped++;}
  return {items:items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)).slice(0,50),skipped};
}
function providerError(e:unknown):never {
  rethrowCancelled(e);
  if(e instanceof ApiError && ["KEY_MISSING","YT_QUOTA","YT_NOT_FOUND"].includes(e.code))throw new ApiError(e.code,e.code==="KEY_MISSING"?"Укажите ключ YouTube в настройках.":e.code==="YT_QUOTA"?"Квота YouTube исчерпана. Попробуйте позже.":"Видео недоступно в YouTube API.",e.status);
  throw new ApiError("UPSTREAM","Не удалось получить метаданные YouTube. Предыдущие снимки не изменены.",502);
}
export async function runVideoScore(input:z.infer<typeof VideoScoreInput>,ctx:JobCtx) {return withTaskSignal(ctx.signal,async()=>{
  checkCancelled(ctx.signal);let v:Video|undefined;ctx.progress("Метаданные видео",10);
  try{const result=await getVideos([input.videoId]);if(result.length>1||result.some(x=>x.id!==input.videoId))throw new Error("Inconsistent target metadata");v=result[0];}catch(e){providerError(e);}
  checkCancelled(ctx.signal);if(!v)throw new ApiError("YT_NOT_FOUND","Видео не найдено: возможно, оно закрыто, удалено или недоступно в API.",404);
  const targetAt=new Date().toISOString();
  let source:SourceT;try{source=scoreSource(v);if(!/^UC[\w-]{22}$/.test(source.channelId))throw Error("Invalid channel");}catch{throw new ApiError("UPSTREAM","YouTube вернул некорректные метаданные",502);}
  let sample:z.infer<typeof SampleV2>[]=[],page:z.infer<typeof SnapshotV2>["page"]=null;
  const observations:z.infer<typeof SnapshotV2>["observations"]={targetAt,channelAt:null,pageAt:null,sampleAt:null};
  let baselineStatus:SnapshotT["baselineStatus"]=input.baseline?"unavailable":"disabled",baselineNote=input.baseline?"База недоступна.":"Сравнение отключено: запрошено только видео.";
  if(input.baseline){
    ctx.progress("До 50 загрузок канала для базы",40);
    try{
      if(!/^UC[\w-]{22}$/.test(v.channelId))throw new Error("Invalid channel");
      const ch=(await getChannelsFull([v.channelId],true)).get(v.channelId);observations.channelAt=new Date().toISOString();checkCancelled(ctx.signal);
      if(!ch || !/^UU[\w-]{22}$/.test(ch.uploadsPlaylistId))throw new Error("Invalid playlist");
      const uploads=await videoScoreUploadPage(ch.uploadsPlaylistId);checkCancelled(ctx.signal);
      if(uploads.videos.some(x=>x.channelId!==source.channelId))throw new Error("Foreign source channel");
      const meta=new Map(uploads.videos.map(x=>[x.id,x]));
      sample=uploads.ids.map(id=>{const x=meta.get(id);return x?SampleV2.parse({...Sample.parse(scoreSource(x)),metadata:"returned"}):SampleV2.parse({id,title:"",publishedAt:"",channelId:"",durationSec:null,views:null,metadata:"missing"});});
      page={ids:uploads.ids,hasMore:uploads.hasMore};observations.pageAt=uploads.pageAt;observations.sampleAt=uploads.sampleAt;
      baselineStatus="loaded";baselineNote=`Получена одна свежая страница: ${uploads.ids.length} ID, метаданные ${uploads.videos.length}. ${uploads.hasMore?"API сообщил о следующей странице; она не загружалась.":"Следующая страница API не указана."} Ответы собраны последовательно, не одновременно.`;
    }catch(e){rethrowCancelled(e,ctx.signal);sample=[];page=null;observations.pageAt=null;observations.sampleAt=null;baselineNote="Не удалось получить базу канала. Сохранены только метаданные видео; Outlier недоступен. Повторный запрос — по кнопке.";}
  }
  checkCancelled(ctx.signal);const snap=Snapshot.parse({version:2,observations,page,id:crypto.randomUUID(),createdAt:new Date().toISOString(),requestedBaseline:input.baseline,source,sample,baselineStatus,baselineNote});
  if(!validSnapshot(snap))throw new ApiError("UPSTREAM","Несогласованные исходники снимка",502);
  await safeFolder(true);checkCancelled(ctx.signal);
  const dest=dataPath("video-score-runs",snap.id+".json"),temp=dest+".tmp";
  try{
    const json=JSON.stringify(snap,null,2);if(Buffer.byteLength(json)>256*1024)throw new ApiError("UPSTREAM","Метаданные снимка слишком велики",502);
    await fs.writeFile(temp,json,{flag:"wx",mode:0o600});checkCancelled(ctx.signal);
    await fs.rename(temp,dest);checkCancelled(ctx.signal);
  }catch(e){await fs.rm(temp,{force:true});await fs.rm(dest,{force:true});throw e;}
  ctx.progress("Снимок сохранён локально",100);return videoScoreReport(snap);
});}
