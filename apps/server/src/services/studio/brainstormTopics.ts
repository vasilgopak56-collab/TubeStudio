// Проверка спроса по отдельным темам, бесплатно по публичному YouTube.
// Это выборка первой страницы, не измерение полного спроса и не рейтинг всех видео.
import {z} from 'zod';
import {ApiError} from '../../lib/errors.js';
import {checkCancelled,rethrowCancelled,withTaskSignal} from '../../lib/taskContext.js';
import type {JobCtx} from '../../lib/jobs.js';
import {webSearch} from './ytweb.js';
import {topicSample} from './brainstormMetrics.js';
export const TopicPlan=z.object({queries:z.array(z.string().trim().min(2).max(160)).min(1).max(30),region:z.string().regex(/^[A-Za-z]{2}$/).default('US')}).strict().refine(x=>new Set(x.queries.map(q=>q.toLowerCase())).size===x.queries.length,'Повторяются темы');
export type TopicResult={query:string;status:'ok'|'failed'|'not-requested';sample:ReturnType<typeof topicSample>|null};
export async function scanTopics(raw:z.input<typeof TopicPlan>,ctx:Pick<JobCtx,'progress'|'signal'>,search:typeof webSearch=webSearch){
 const p=TopicPlan.parse(raw);const results:TopicResult[]=[];let limited=false;
 return withTaskSignal(ctx.signal,async()=>{
  for(const query of p.queries){
   checkCancelled(ctx.signal);
   if(limited){results.push({query,status:'not-requested',sample:null});continue;}
   ctx.progress(`Проверка темы ${results.length+1} из ${p.queries.length}`,Math.floor(100*results.length/p.queries.length));
   try{const rows=await search(query,{period:'any',pages:1,gl:p.region.toUpperCase()});checkCancelled(ctx.signal);results.push({query,status:'ok',sample:topicSample(query,rows)});}
   catch(e){rethrowCancelled(e,ctx.signal);results.push({query,status:'failed',sample:null});if(e instanceof ApiError&&(e.status===429||(e.details as {ytLimited?:boolean}|undefined)?.ytLimited))limited=true;}
  }
  return {region:p.region.toUpperCase(),limited,results};
 });
}
