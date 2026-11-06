// Strictly load research produced by the collection stage; never trust arbitrary
// client-supplied observations. This validation is not a proof of YouTube facts.
import {createHash} from 'node:crypto';import {z} from 'zod';
import {ApiError} from '../../lib/errors.js';import {assistantProjectSnapshot} from '../assistant.js';
import type {ScanResult} from './brainstormScan.js';import type {TopicResult} from './brainstormTopics.js';
const n=z.number().finite().nonnegative(),nullable=n.nullable(),videoId=z.string().regex(/^[A-Za-z0-9_-]{11}$/),channelId=z.string().regex(/^UC[A-Za-z0-9_-]{22}$/),txt=z.string().max(5000);
const video=z.object({id:videoId,title:txt,channelId:channelId.optional(),channelName:txt.optional(),views:n.optional(),durationSec:n.optional(),ageDays:n.optional(),publishedText:txt.optional(),live:z.boolean().optional(),short:z.boolean().optional(),publishedAt:txt.optional(),verified:z.boolean().optional()}).passthrough();
const channel=z.object({id:channelId,name:txt,handle:txt.optional(),subs:n.optional(),videoCount:n.optional(),longVideos:z.array(video).max(500),hasMoreLong:z.boolean()}).passthrough();
const source=z.object({videoId,title:txt,url:z.string(),channelId:channelId.optional(),channelUrl:z.string().optional(),views:nullable,ageDays:nullable,subscribers:nullable,queries:z.array(txt).max(70)}).passthrough().refine(x=>x.url===`https://www.youtube.com/watch?v=${x.videoId}`&&(!x.channelUrl||(!!x.channelId&&x.channelUrl===`https://www.youtube.com/channel/${x.channelId}`)));
const direction=z.object({direction:txt,videoCount:n,channelCount:n,knownViewCount:n,medianViews:nullable,smallChannelHits:n,unknownSubscriberVideos:n,incomplete:z.boolean(),sources:z.array(source).max(14000)}).passthrough();
const coverage=z.object({plannedSearches:n,completedSearches:n,searchErrors:n,truncatedSearches:n,foundRows:n,candidates:n,channelsRequested:n,channelsRead:n,channelErrors:n,channelLimitReached:z.boolean(),stoppedByYoutube:z.boolean(),onePagePerQuery:z.literal(true),storageTruncated:z.boolean().optional(),storedSources:n.optional(),omittedSources:n.optional(),storedChannels:n.optional(),omittedChannels:n.optional()}).passthrough();
const Scan=z.object({observedAt:z.string().refine(s=>Number.isFinite(Date.parse(s))),region:z.string().regex(/^[A-Z]{2}$/),plan:z.array(z.object({direction:txt,query:txt}).passthrough()).max(70),coverage,directions:z.array(direction).max(70),channels:z.array(channel).max(400)}).passthrough();
const topicSource=z.object({title:txt,url:z.string().regex(/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/),views:nullable}).passthrough();
const sample=z.object({query:txt,found:n,knownViews:n,topViews:nullable,over100k:n,incomplete:z.boolean(),sources:z.array(topicSource).max(12)}).passthrough();
const Topic=z.object({query:txt,status:z.enum(['ok','failed','not-requested']),sample:sample.nullable()}).passthrough().refine(t=>t.status==='ok'?!!t.sample&&t.sample.query===t.query:t.sample===null);
const uuid=z.string().uuid();const digest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export async function loadBrainstormProjectEvidence(projectId:string,artifactId:string){
 uuid.parse(projectId);uuid.parse(artifactId);const snap=await assistantProjectSnapshot(projectId),found=snap.project.artifacts.filter(a=>a.id===artifactId&&(a.data as any)?.source==='brainstorm-evidence');
 if(found.length!==1)throw new ApiError('VALIDATION','Данные исследования отсутствуют или неоднозначны. Новый запрос не отправлен.',409);
 const data=found[0].data as any,e=data?.evidence;
 if(!e||e.format!=='tubestudio-brainstorm-evidence'||e.version!==1||data.hash!==digest(e)||!Scan.safeParse(e.research).success||!z.array(Topic).max(30).safeParse(e.topics).success)throw new ApiError('VALIDATION','Данные исследования повреждены или имеют неподдерживаемый формат. Новый запрос не отправлен.',409);
 const scan=e.research as ScanResult,topics=e.topics as TopicResult[];
 return {project:snap.project,projectSnapshot:snap.snapshot,artifactId,task:z.string().trim().min(2).max(10000).parse(e.task),scan,topics,evidenceHash:digest({scan,topics})};
}
