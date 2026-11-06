// Выпуск 2.1: вычисления по наблюдениям публичного YouTube.
// Этот модуль сам не делает запросов, не вызывает ИИ и ничего не сохраняет.
// Одинаковый ролик может быть найден несколькими запросами, но считается один раз
// в каждом направлении. Неизвестные подписчики и просмотры — не нули.
import type { WebVideo, WebChannel } from './ytweb.js';

export type BrainstormObservation = { direction: string; query: string; period: 'week' | 'month'; video: WebVideo };
export type BrainstormDirection = {
  direction: string; videoCount: number; channelCount: number; knownViewCount: number;
  medianViews: number | null; smallChannelHits: number; unknownSubscriberVideos: number;
  incomplete: boolean; sources: { videoId: string; title: string; url: string; channelId?: string; channelUrl?: string; views: number | null; ageDays: number | null; subscribers: number | null; queries: string[] }[];
};
const count = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const videoId = (s: string) => /^[A-Za-z0-9_-]{11}$/.test(s);
const channelId = (s: string | undefined): s is string => !!s && /^UC[A-Za-z0-9_-]{22}$/.test(s);
const median = (v: number[]) => {
  if (!v.length) return null;
  const a = [...v].sort((x,y) => x-y), i = Math.floor(a.length/2);
  return a.length % 2 ? a[i] : (a[i-1]+a[i])/2;
};
/** Age in days is approximate for values derived from YouTube's relative timestamps. */
function age(v: WebVideo, now: number): number | null {
  if (v.publishedAt) {
    const at=Date.parse(v.publishedAt);
    if (Number.isFinite(at)) return (now-at)/86_400_000;
  }
  return count(v.ageDays) ? v.ageDays : null;
}
/** Each input is a single search snapshot, taken at the supplied timestamp. */
export function summarizeDirections(observations: BrainstormObservation[], channels: WebChannel[], observedAt: string): BrainstormDirection[] {
  const now=Date.parse(observedAt);
  if (!Number.isFinite(now)) throw new Error('Invalid observation timestamp');
  const subscribers = new Map(channels.filter(c => channelId(c.id)).map(c => [c.id, count(c.subs) ? c.subs : null]));
  const groups = new Map<string, Map<string, { video: WebVideo; queries: Set<string> }>>();
  for (const o of observations) {
    const d=o.direction.trim(), q=o.query.trim(), v=o.video;
    if (!d || !q || !videoId(v.id) || v.short || v.live) continue;
    const days=age(v,now);
    // Without a date, this video cannot safely be claimed as part of the 31-day sample.
    if (days===null || days<0 || days>31) continue;
    if (!groups.has(d)) groups.set(d,new Map());
    const group=groups.get(d)!, previous=group.get(v.id);
    if (previous) {
      previous.queries.add(q);
      // Fill omissions; never sum the same video's views across queries.
      if (!count(previous.video.views) && count(v.views)) previous.video.views=v.views;
      if (!channelId(previous.video.channelId) && channelId(v.channelId)) previous.video.channelId=v.channelId;
    } else group.set(v.id,{video:{...v},queries:new Set([q])});
  }
  return [...groups.entries()].map(([direction,rows])=>{
    const sources=[...rows.values()].map(({video:v,queries})=>{
      const cid=channelId(v.channelId)?v.channelId:undefined;
      return {videoId:v.id,title:v.title,url:`https://www.youtube.com/watch?v=${v.id}`,...(cid?{channelId:cid,channelUrl:`https://www.youtube.com/channel/${cid}`}:{ }),views:count(v.views)?v.views:null,ageDays:age(v,now),subscribers:cid?(subscribers.get(cid)??null):null,queries:[...queries]};
    });
    const known=sources.flatMap(s=>s.views===null?[]:[s.views]);
    return {direction,videoCount:sources.length,channelCount:new Set(sources.map(s=>s.channelId).filter(Boolean)).size,knownViewCount:known.length,medianViews:median(known),smallChannelHits:sources.filter(s=>s.views!==null && s.views>=100_000 && s.subscribers!==null && s.subscribers<100_000).length,unknownSubscriberVideos:sources.filter(s=>s.subscribers===null).length,incomplete:sources.length<20 || known.length!==sources.length || sources.some(s=>s.subscribers===null),sources};
  });
}
