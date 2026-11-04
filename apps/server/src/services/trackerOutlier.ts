/** Per-target evidence from saved observations, never a channel-wide denominator. */
import type { TVideo } from './competitors.js';
import { median } from './metrics.js';
const H=3600_000;
export type OutlierBasis = { version:1; channelId:string; targetId:string; asOf:string; format:'long'|'short'|null; targetViews:number|null; median:number|null; ratio:number|null; reason:string; rows:{id:string;title:string;publishedAt:string;durationSec:number|null;observedAt:string|null;views:number|null;included:boolean;reason:string}[] };
export type OutlierEvidence = OutlierBasis & { threshold:number };
export function trackerOutlier(channelId:string, v:TVideo, videos:TVideo[], now=Date.now()):OutlierBasis {
 const no=(x:TVideo):string=>{
  const p=x.points.at(-1),pub=Date.parse(x.publishedAt);
  if(x.sourceChannelId!==channelId)return 'Канал источника не подтверждён';
  if(x.durationKnown!==true||!Number.isSafeInteger(x.durationSec)||x.durationSec<=0)return 'Длительность неизвестна';
  if(!p||p.viewsKnown!==true||!Number.isSafeInteger(p.v)||p.v<0)return 'Просмотры неизвестны';
  if(!Number.isFinite(p.t)||p.t<0||p.t>now||now-p.t>48*H)return 'Снимок устарел или дата некорректна';
  if(!Number.isFinite(pub)||pub<0||pub>p.t)return 'Дата публикации некорректна';
  return '';
 };
 const reason=no(v),format=v.durationKnown===true&&Number.isSafeInteger(v.durationSec)&&v.durationSec>0?(v.durationSec<=180?'short':'long'):null;
 const seen=new Set<string>();
 const rows=videos.map(x=>{
  const p=x.points.at(-1);let r='';
  if(x.id===v.id)r='Само видео исключено';
  else if(seen.has(x.id))r='Повтор ID';
  else r=no(x)||(format===null?'Группа цели неизвестна':(x.durationSec<=180)!==(v.durationSec<=180)?'Другая группа длительности':p!.t-Date.parse(x.publishedAt)<48*H?'Моложе 48 часов на дату снимка':'');
  seen.add(x.id);
  return {id:x.id,title:x.title,publishedAt:x.publishedAt,durationSec:x.durationKnown===true?x.durationSec:null,observedAt:p&&Number.isFinite(p.t)&&p.t>=0&&p.t<=8.64e15?new Date(p.t).toISOString():null,views:p?.viewsKnown===true&&Number.isSafeInteger(p.v)&&p.v>=0?p.v:null,included:!r,reason:r||'В базе'};
 });
 const values=rows.filter(r=>r.included).map(r=>r.views!),m=values.length>=3?median(values):null;
 const why=reason||(values.length<3?'Нужны минимум 3 других видео той же группы':!(m!>0)?'Медиана базы равна нулю':'');
 return {version:1,channelId,targetId:v.id,asOf:new Date(now).toISOString(),format,targetViews:reason?null:v.points.at(-1)!.v,median:m,ratio:why?null:v.points.at(-1)!.v/m!,reason:why,rows};
}
