// Вспомогательные расчёты выпуска 2.1. Только сохранённые наблюдения; без сети и ИИ.
import type { WebChannel, WebVideo } from './ytweb.js';
const numeric=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const isId=(id:string)=>/^[A-Za-z0-9_-]{11}$/.test(id);
function age(v:WebVideo, now:number):number|null {
 if(v.publishedAt){const t=Date.parse(v.publishedAt);if(Number.isFinite(t))return (now-t)/86400000;}
 return numeric(v.ageDays)?v.ageDays:null;
}
const median=(input:number[])=>{if(!input.length)return null;const a=[...input].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};
/** Ordered search sample, capped at the first 12 unique identifiable videos. */
export function topicSample(query:string,videos:WebVideo[]){
 const seen=new Set<string>(),rows=videos.filter(v=>isId(v.id)&&!v.live&&!v.short&&!seen.has(v.id)&&!!seen.add(v.id)).slice(0,12);
 const values=rows.flatMap(v=>numeric(v.views)?[v.views]:[]);
 return {query,found:rows.length,knownViews:values.length,topViews:values.length?Math.max(...values):null,over100k:values.filter(n=>n>=100000).length,incomplete:rows.length<12||values.length!==rows.length,
  sources:rows.map(v=>({title:v.title,url:`https://www.youtube.com/watch?v=${v.id}`,views:numeric(v.views)?v.views:null}))};
}
/** Sample of visible recent long videos, not the channel's actual creation date. */
export function channelSample(channel:WebChannel,observedAt:string){
 const now=Date.parse(observedAt);if(!Number.isFinite(now))throw Error('Invalid observation timestamp');
 const seen=new Set<string>(),videos=channel.longVideos.filter(v=>isId(v.id)&&!v.short&&!v.live&&!seen.has(v.id)&&!!seen.add(v.id)).slice(0,60);
 const views=videos.flatMap(v=>numeric(v.views)?[v.views]:[]);
 const dated=videos.map(v=>({v,days:age(v,now)})).filter((x):x is {v:WebVideo;days:number}=>x.days!==null&&x.days>=0);
 const oldest=dated.length?Math.max(...dated.map(x=>x.days)):null;
 const recent=dated.filter(x=>x.days<=16&&numeric(x.v.views)).sort((a,b)=>b.v.views!-a.v.views!);
 const top=recent[0]?.v;
 return {id:channel.id,name:channel.name,subscribers:numeric(channel.subs)?channel.subs:null,sampleSize:videos.length,knownViews:views.length,medianViews:median(views),oldestObservedVideoDays:oldest,
  oldestCoversVisibleList:!channel.hasMoreLong&&videos.length===channel.longVideos.length&&dated.length===videos.length&&videos.length>0,
  incomplete:channel.hasMoreLong||videos.length!==channel.longVideos.length||views.length!==videos.length||dated.length!==videos.length||!numeric(channel.subs),
  bestRecent:top?{title:top.title,url:`https://www.youtube.com/watch?v=${top.id}`,views:top.views!,ageDays:age(top,now),viewSubscriberRatio:numeric(channel.subs)&&channel.subs>0?top.views!/channel.subs:null}:null};
}
