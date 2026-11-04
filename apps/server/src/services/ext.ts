/** Explicit extension requests only. No LLM and no automatic refresh. */
import { z } from "zod";
import { cached } from "../lib/cache.js";
import { ApiError } from "../lib/errors.js";
import { rethrowCancelled } from "../lib/taskContext.js";
import { getSettings } from "./settings.js";
import { getChannelsFull, getVideos, latestUploads, resolveChannel, type Video, type Channel } from "./youtube.js";
import { viralCheck } from "./explore.js";
import { median } from "./metrics.js";
export const ExtensionIds=z.array(z.string().regex(/^[\w-]{11}$/)).min(1).max(50);
export function parseExtensionIds(ids:string[]) { const r=ExtensionIds.safeParse(ids);if(!r.success)throw new ApiError("VALIDATION","Укажите от 1 до 50 корректных ID видео",400);return [...new Set(r.data)]; }
export type ExtensionBase={value:number|null;kind:"median-long"|"median-shorts"|"channel-average"|"unavailable";sampleSize:number;note:string};
export function extensionBase(v:Video,ch:Channel|undefined,uploads:Video[]|undefined,mode:"median"|"average",now:number):ExtensionBase {
 if(mode==="average") {const value=ch&&Number.isFinite(ch.totalViews)&&ch.totalViews>=0&&ch.videoCount>0?ch.totalViews/ch.videoCount:null;return {value:value&&Number.isFinite(value)?value:null,kind:value?"channel-average":"unavailable",sampleSize:ch?.videoCount??0,note:"Средние просмотры всех видео канала; форматы смешаны, это не медиана и не доход"};}
 const eligible=(uploads??[]).filter(x=>x.id!==v.id&&x.isShort===v.isShort&&x.viewsKnown!==false&&Number.isFinite(x.views)&&x.views>=0&&now-Date.parse(x.publishedAt)>48*3600000);
 const value=eligible.length>=3?median(eligible.map(x=>x.views)):null;
 return {value:value&&Number.isFinite(value)?value:null,kind:value?(v.isShort?"median-shorts":"median-long"):"unavailable",sampleSize:eligible.length,note:uploads===undefined?"База не загружена: предел 20 каналов, ошибка или нет данных канала":"Медиана других последних видео того же формата старше 48 ч; нужно ≥3 и ненулевая база. Shorts определены приблизительно по длительности"};
}
export function extensionRow(v:Video,ch:Channel|undefined,uploads:Video[]|undefined,mode:"median"|"average",viral:Parameters<typeof viralCheck>[3],now=Date.now()) {
 const known=v.viewsKnown!==false&&Number.isFinite(v.views)&&v.views>=0,ageHours=(now-Date.parse(v.publishedAt))/3600000,validAge=Number.isFinite(ageHours)&&ageHours>=0;
 const base=extensionBase(v,ch,uploads,mode,now),views=known?v.views:null;
 const vph=known&&validAge?+(v.views/Math.max(1,ageHours)).toFixed(1):null;
 const outlier=known&&base.value!==null?+(v.views/base.value).toFixed(1):null;
 const subs=ch&&!ch.hiddenSubscribers&&ch.subscriberCountKnown!==false&&Number.isFinite(ch.subscribers)&&ch.subscribers>=0?ch.subscribers:null;
 const ratio=views!==null&&subs!==null&&subs>0?+(views/subs).toFixed(2):null;
 const check=vph!==null&&outlier!==null&&validAge?viralCheck(ageHours/24,outlier,vph,viral):{ok:false,why:"Недостаточно известных данных для правила вирусного потенциала"};
 return {id:v.id,title:v.title,channelId:v.channelId,channelTitle:v.channelTitle,views,vph,vphRecent:null,outlier,baseViews:base.value===null?null:Math.round(base.value),ratio,subs,viral:check.ok,viralWhy:check.why,engagement:known&&v.views>0&&Number.isFinite(v.likes)&&Number.isFinite(v.comments)?+((v.likes+v.comments)/v.views*100).toFixed(2):null,ageDays:validAge?+(ageHours/24).toFixed(2):null,isShort:v.isShort,baseline:base,computedAt:new Date(now).toISOString(),notice:"Сохранённые/кэшированные данные API, не живая статистика. VPH — просмотры / max(1 час, возраст), не скорость сейчас. Правило потенциала не прогноз успеха"};
}
export type ExtRow=ReturnType<typeof extensionRow>;
const pending=new Map<string,Promise<ExtRow[]>>();
export async function extVideos(idsIn:string[]):Promise<ExtRow[]> {
 const ids=parseExtensionIds(idsIn).sort(),s=await getSettings(),R=s.research;
 const key=`ext:v2:${ids.join(',')}:${R.outlierBase}:${R.baseVideos}:${JSON.stringify(R.viral)}`;
 const existing=pending.get(key);if(existing)return existing;
 const task=cached(key,30*60000,async()=>{
  const now=Date.now(),videos=await getVideos(ids),channels=await getChannelsFull(videos.map(v=>v.channelId)),up=new Map<string,Video[]>();
  if(R.outlierBase==="median")for(const cid of [...new Set(videos.map(v=>v.channelId))].slice(0,20)){
   const ch=channels.get(cid);if(!ch?.uploadsPlaylistId)continue;
   try{up.set(cid,await latestUploads(ch.uploadsPlaylistId,Math.min(50,R.baseVideos)));}catch(e){rethrowCancelled(e);}
  }
  return videos.map(v=>extensionRow(v,channels.get(v.channelId),up.get(v.channelId),R.outlierBase,R.viral,now));
 });pending.set(key,task);try{return await task;}finally{if(pending.get(key)===task)pending.delete(key);}
}
/** Legacy channel summary endpoint; never called automatically by the extension. */
export async function extChannel(input:string) {
 const s=await getSettings(),ch=await resolveChannel(input),up=await latestUploads(ch.uploadsPlaylistId,Math.min(50,s.research.baseVideos)),now=Date.now();
 return {id:ch.id,title:ch.title,handle:ch.handle,subs:ch.hiddenSubscribers||ch.subscriberCountKnown===false?null:ch.subscribers,top:up.map(v=>extensionRow(v,ch,up,s.research.outlierBase,s.research.viral,now)).sort((a,b)=>(b.outlier??-1)-(a.outlier??-1)).slice(0,5),notice:"Ограниченная кэшированная выборка, не живые данные или доход"};
}
