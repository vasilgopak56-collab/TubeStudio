/** Public channel counters. Unknown/legacy values never become verified zeros or period deltas. */
import type { Channel } from "./youtube.js";
const HOUR = 3600_000, DAY = 24 * HOUR;
export type ChannelSnapshot = { d: string; t?: number; subs: number | null; views: number | null; videos: number | null; subsKnown?: boolean; viewsKnown?: boolean; videosKnown?: boolean; hiddenSubscribers?: boolean };
export type CounterChange = { before: number | null; after: number | null; delta: number | null; reason: string };
export type CounterComparison = { from: string | null; to: string | null; hours: number | null; subs: CounterChange; views: CounterChange };
export type SubscriberEvidence = { from: string; to: string; hours: number; before: number; after: number; delta: number; percent: number; threshold: number; source: "public-channel-counter" };
const safe = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
function dateOk(d: string) { return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10) === d; }
function stampOk(p: ChannelSnapshot, now: number): p is ChannelSnapshot & { t: number } { return safe(p.t) && p.t <= now && dateOk(p.d) && new Date(p.t).toISOString().slice(0,10) === p.d; }
function known(p: ChannelSnapshot, key: "subs" | "views" | "videos") { return p[`${key}Known`] === true && safe(p[key]) && (key !== "subs" || p.hiddenSubscribers !== true); }
function pointReason(p: ChannelSnapshot | undefined, now: number) {
  if (!p) return "Пока нет снимка счётчиков канала";
  if (p.t == null) return "Архивная запись без точного времени и подтверждения счётчиков";
  if (!stampOk(p,now)) return "Некорректная или будущая дата снимка счётчиков";
  if (now-p.t>48*HOUR) return "Снимок счётчиков старше 48 часов; обновите канал";
  return "";
}
export function channelSnapshot(ch: Channel, t: number): ChannelSnapshot {
  const subsKnown=ch.subscriberCountKnown === true && !ch.hiddenSubscribers && safe(ch.subscribers);
  const viewsKnown=ch.totalViewsKnown === true && safe(ch.totalViews), videosKnown=ch.videoCountKnown === true && safe(ch.videoCount);
  return { d:new Date(t).toISOString().slice(0,10),t,subs:subsKnown?ch.subscribers:null,views:viewsKnown?ch.totalViews:null,videos:videosKnown?ch.videoCount:null,subsKnown,viewsKnown,videosKnown,hiddenSubscribers:ch.hiddenSubscribers };
}
/** Keep one latest observation per UTC day. Never insert a late parallel response behind a newer one. */
export function recordChannelSnapshot(history: ChannelSnapshot[], row: ChannelSnapshot): ChannelSnapshot[] {
  const last=history.at(-1);
  if (last && (last.d>row.d || (last.t!=null && row.t!=null && last.t>row.t))) return history;
  return (last?.d===row.d?[...history.slice(0,-1),row]:[...history,row]).slice(-400);
}
export function compareChannelSnapshots(history: ChannelSnapshot[], days: 1 | 7, now=Date.now()): CounterComparison {
  const last=history.at(-1);
  const no=(reason:string):CounterComparison=>({from:null,to:last && stampOk(last,now)?new Date(last.t).toISOString():null,hours:null,subs:{before:null,after:null,delta:null,reason},views:{before:null,after:null,delta:null,reason}});
  const reason=pointReason(last,now);if(reason || !last || !stampOk(last,now))return no(reason);
  if(history.some((p,i)=>!dateOk(p.d)||(i>0 && p.d<=history[i-1].d)))return no("Нарушен порядок дат истории или есть повтор даты UTC");
  const expected=new Date(Date.parse(last.d)-days*DAY).toISOString().slice(0,10),base=history.find(p=>p.d===expected);
  if(!base)return no(`Нет снимка за ${expected}; короткая история или пропуск не заменяют период ${days} дн.`);
  if(!stampOk(base,now))return no("Базовый снимок архивный или не имеет корректного точного времени");
  const hours=(last.t-base.t)/HOUR;
  if(Math.abs(hours-days*24)>12)return no(`Границы дат есть, но фактический интервал вне ${days*24-12}–${days*24+12} часов`);
  const window=history.filter(p=>p.d>=base.d && p.d<=last.d);
  if(window.some((p,i)=>!stampOk(p,now)||(i>0 && p.t!<=window[i-1].t!)))return no("Неверное время внутри сравниваемого периода");
  const change=(key:"subs"|"views"):CounterChange=>{
    const unknown=window.find(p=>!known(p,key));
    if(unknown)return {before:null,after:null,delta:null,reason:key==="subs" && unknown.hiddenSubscribers?"Подписчики скрыты в одном из снимков периода":"Неизвестный или неподтверждённый счётчик внутри периода"};
    if(key==="views" && window.some((p,i)=>i>0 && p.views!<window[i-1].views!))return {before:base.views,after:last.views,delta:null,reason:"Внутри периода уменьшился накопительный счётчик просмотров: коррекция, не отрицательный трафик"};
    return {before:base[key],after:last[key],delta:last[key]!-base[key]!,reason:""};
  };
  return {from:new Date(base.t).toISOString(),to:new Date(last.t).toISOString(),hours,subs:change("subs"),views:change("views")};
}
export function channelCounterStats(history: ChannelSnapshot[], now=Date.now()) {
  const p=history.at(-1),reason=pointReason(p,now);
  const one=(key:"subs"|"views"|"videos")=>({value:!reason && p && known(p,key)?p[key]:null,reason:reason || (!p?"Нет снимка":known(p,key)?"":key==="subs"&&p.hiddenSubscribers?"Подписчики скрыты каналом":"API не вернул проверенный счётчик")});
  const subs=one("subs"),views=one("views"),videos=one("videos");
  return {subs:subs.value,totalViews:views.value,videoCount:videos.value,countersAsOf:p&&stampOk(p,now)?new Date(p.t).toISOString():null,counterReasons:{subs:subs.reason,views:views.reason,videos:videos.reason},week:compareChannelSnapshots(history,7,now)};
}
export function subscriberEvidence(history: ChannelSnapshot[], threshold:number, now=Date.now()):SubscriberEvidence|null {
  if(!Number.isFinite(threshold)||threshold<=0)return null;
  const c=compareChannelSnapshots(history,1,now),s=c.subs;
  if(!c.from||!c.to||c.hours==null||s.before==null||s.after==null||s.delta==null||s.before<=0||s.delta<=0)return null;
  const percent=s.delta/s.before*100;if(percent<threshold)return null;
  return {from:c.from,to:c.to,hours:c.hours,before:s.before,after:s.after,delta:s.delta,percent,threshold,source:"public-channel-counter"};
}
