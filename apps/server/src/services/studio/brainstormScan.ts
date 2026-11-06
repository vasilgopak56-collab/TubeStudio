// Выпуск 2.1: ограниченный бесплатный сбор из публичного YouTube.
// Нет ИИ, платных вызовов, сохранения и изменений профиля/календаря/G-Labs.
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { checkCancelled, rethrowCancelled, withTaskSignal } from '../../lib/taskContext.js';
import type { JobCtx } from '../../lib/jobs.js';
import { webSearch, webChannel, type WebVideo, type WebChannel } from './ytweb.js';
import { summarizeDirections, type BrainstormObservation } from './brainstormResearch.js';

export const ScanPlan = z.object({
 queries: z.array(z.object({ direction:z.string().trim().min(1).max(100), query:z.string().trim().min(2).max(160) }).strict()).min(1).max(70),
 region:z.string().regex(/^[A-Za-z]{2}$/).default('US'),
}).strict().refine(x=>new Set(x.queries.map(q=>`${q.direction.toLowerCase()}\0${q.query.toLowerCase()}`)).size===x.queries.length,'Повторяется один и тот же запрос направления');
export type ScanPlanT = z.input<typeof ScanPlan>;
type IO = { search:typeof webSearch; channel:typeof webChannel; now:()=>Date };
const defaults:IO={search:webSearch,channel:webChannel,now:()=>new Date()};
const validChannel=(x:unknown):x is string=>typeof x==='string' && /^UC[A-Za-z0-9_-]{22}$/.test(x);
const candidateAge=(video:WebVideo,now:number):number|null=>{if(video.publishedAt){const t=Date.parse(video.publishedAt);if(Number.isFinite(t))return (now-t)/86400000;}return typeof video.ageDays==='number'&&Number.isFinite(video.ageDays)?video.ageDays:null;};
const limitError=(e:unknown)=>e instanceof ApiError && (e.status===429 || !!(e.details as {ytLimited?:boolean}|undefined)?.ytLimited);
export type ScanResult = {
 observedAt:string; region:string; plan:ReturnType<typeof ScanPlan.parse>['queries'];
 coverage:{ plannedSearches:number; completedSearches:number; searchErrors:number; truncatedSearches:number; foundRows:number; candidates:number; channelsRequested:number; channelsRead:number; channelErrors:number; channelLimitReached:boolean; stoppedByYoutube:boolean; onePagePerQuery:true };
 directions:ReturnType<typeof summarizeDirections>; channels:WebChannel[];
};
export async function scanBrainstorm(raw:ScanPlanT,ctx:Pick<JobCtx,'progress'|'partial'|'signal'>,io:IO=defaults):Promise<ScanResult> {
 const plan=ScanPlan.parse(raw), observations:BrainstormObservation[]=[], candidates=new Map<string,number>(), channels:WebChannel[]=[];
 const coverage:ScanResult['coverage']={plannedSearches:plan.queries.length*2,completedSearches:0,searchErrors:0,truncatedSearches:0,foundRows:0,candidates:0,channelsRequested:0,channelsRead:0,channelErrors:0,channelLimitReached:false,stoppedByYoutube:false,onePagePerQuery:true};
 return withTaskSignal(ctx.signal,async()=>{
  const stamp=io.now().toISOString();
  const periods=['week','month'] as const;
  const partialDirections=new Set<string>();
  outer: for(const q of plan.queries) for(const period of periods){
   checkCancelled(ctx.signal);ctx.progress(`YouTube: ${coverage.completedSearches+coverage.searchErrors+1} из ${coverage.plannedSearches} поисков`,Math.floor(50*(coverage.completedSearches+coverage.searchErrors)/coverage.plannedSearches));
   let rows:WebVideo[];
   try{ rows=await io.search(q.query,{period,pages:1,gl:plan.region.toUpperCase()}); }
   catch(e){rethrowCancelled(e,ctx.signal);coverage.searchErrors++;partialDirections.add(q.direction);if(limitError(e)){coverage.stoppedByYoutube=true;break outer;}continue;}
   checkCancelled(ctx.signal);coverage.completedSearches++;coverage.foundRows+=rows.length;
   if(rows.length>100){coverage.truncatedSearches++;partialDirections.add(q.direction);}
   // Bound memory even if a provider returns abnormally many cards.
   for(const video of rows.slice(0,100)){
    observations.push({direction:q.direction,query:q.query,period,video});
    const days=candidateAge(video,Date.parse(stamp));
    if(/^[A-Za-z0-9_-]{11}$/.test(video.id)&&!video.short&&!video.live&&days!==null&&days>=0&&days<=(period==='week'?7:31)&&validChannel(video.channelId)&&typeof video.views==='number'&&Number.isFinite(video.views)&&video.views >= (period==='week'?30_000:80_000)) candidates.set(video.channelId,Math.max(candidates.get(video.channelId)??0,video.views));
   }
   ctx.partial({stage:'search',completed:coverage.completedSearches,planned:coverage.plannedSearches});
  }
  coverage.candidates=candidates.size;
  const all=[...candidates.entries()].sort((a,b)=>b[1]-a[1]);
  coverage.channelLimitReached=all.length>400;
  const selected=all.slice(0,400);
  if(!coverage.stoppedByYoutube)for(const [id] of selected){
   checkCancelled(ctx.signal);coverage.channelsRequested++;ctx.progress(`YouTube: канал ${coverage.channelsRequested} из ${selected.length}`,50+Math.floor(45*(coverage.channelsRequested-1)/Math.max(1,selected.length)));
   try{const ch=await io.channel(id,{pages:3,maxVideos:60});checkCancelled(ctx.signal);if(ch.id!==id)throw new Error('Mismatched channel');channels.push(ch);coverage.channelsRead++;}
   catch(e){rethrowCancelled(e,ctx.signal);coverage.channelErrors++;if(limitError(e)){coverage.stoppedByYoutube=true;break;}}
   ctx.partial({stage:'channels',completed:coverage.channelsRequested,planned:selected.length});
  }
  const directions=summarizeDirections(observations,channels,stamp);
  // A direction with no qualifying dated videos is still visible, never silently omitted.
  for(const direction of [...new Set(plan.queries.map(q=>q.direction))]) if(!directions.some(d=>d.direction===direction)) directions.push({direction,videoCount:0,channelCount:0,knownViewCount:0,medianViews:null,smallChannelHits:0,unknownSubscriberVideos:0,incomplete:true,sources:[]});
  for(const direction of directions) if(coverage.stoppedByYoutube || partialDirections.has(direction.direction)) direction.incomplete=true;
  ctx.progress('Сбор наблюдений завершён',96);
  return {observedAt:stamp,region:plan.region.toUpperCase(),plan:plan.queries,coverage,directions,channels};
 });
}
