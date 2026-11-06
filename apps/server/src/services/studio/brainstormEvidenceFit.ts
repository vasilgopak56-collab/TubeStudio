// Fit a bounded, explicitly partial evidence sample into a project without
// inventing metrics. This module does not perform network requests or writes.
import {checkCancelled} from '../../lib/taskContext.js';
import {ApiError} from '../../lib/errors.js';
import type {ScanResult} from './brainstormScan.js';
import type {TopicResult} from './brainstormTopics.js';

export type Evidence={format:'tubestudio-brainstorm-evidence';version:1;runId:string;task:string;research:ScanResult;topics:TopicResult[];notice:string};
type Direction=ScanResult['directions'][number];
const size=(x:unknown,pretty=false)=>Buffer.byteLength(JSON.stringify(x,null,pretty?2:undefined));
const known=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
function recount(d:Direction,sources:Direction['sources']):Direction{
 const views=sources.flatMap(x=>known(x.views)?[x.views]:[]).sort((a,b)=>a-b),m=Math.floor(views.length/2);
 return {...d,videoCount:sources.length,channelCount:new Set(sources.map(x=>x.channelId).filter(Boolean)).size,knownViewCount:views.length,
  medianViews:views.length?(views.length%2?views[m]:(views[m-1]+views[m])/2):null,
  smallChannelHits:sources.filter(x=>known(x.views)&&x.views>=100000&&known(x.subscribers)&&x.subscribers<100000).length,
  unknownSubscriberVideos:sources.filter(x=>!known(x.subscribers)).length,incomplete:true,sources};
}
/** Approximate a sample evenly across directions, preferring earlier observations.
 * Metrics are recalculated only from retained sources; no omitted detail is called saved. */
function sample(e:Evidence,ratio:number):Evidence{
 const research=e.research,sourceTotal=research.directions.reduce((n,d)=>n+d.sources.length,0),channelTotal=research.channels.length;
 const channels=research.channels.slice(0,Math.floor(channelTotal*ratio));
 let keptSources=0;
 const directions=research.directions.map(d=>{
  const n=d.sources.length?Math.max(1,Math.floor(d.sources.length*ratio)):0,sources=d.sources.slice(0,n);keptSources+=sources.length;
  return recount(d,sources);
 });
 const coverage={...research.coverage,storageTruncated:true,storedSources:keptSources,omittedSources:sourceTotal-keptSources,storedChannels:channels.length,omittedChannels:channelTotal-channels.length};
 return {...e,research:{...research,coverage,directions,channels},notice:'Размер исследования ограничен: часть найденных источников или каналов не сохранена. Направления пересчитаны по сохранённым источникам; выборка неполная и отдаёт предпочтение первым найденным данным.'};
}
/** Fits both raw evidence and the final on-disk project, leaving 2 MiB for later work. */
export function fitBrainstormEvidence(e:Evidence,projectWithArtifact:(e:Evidence)=>unknown){
 const fits=(v:Evidence)=>size(v)<=4*1024*1024&&size(projectWithArtifact(v),true)<=8*1024*1024;
 if(fits(e))return e;
 let lo=0,hi=1,best:Evidence|null=null;
 for(let i=0;i<15;i++){
  checkCancelled();const mid=(lo+hi)/2,candidate=sample(e,mid);
  if(fits(candidate)){best=candidate;lo=mid;}else hi=mid;
 }
 if(!best){const minimal=sample(e,0);if(fits(minimal))return minimal;throw new ApiError('VALIDATION','Исследование не помещается в проект даже после сокращения. Создайте новый проект с меньшим объёмом данных.',413);}
 return best;
}
