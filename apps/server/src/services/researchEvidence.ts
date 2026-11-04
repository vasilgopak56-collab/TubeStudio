/** One explicit public search page plus an opt-in bounded, inspectable Outlier basis. */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {z} from 'zod';
import {ApiError} from '../lib/errors.js';
import {dataPath} from '../lib/storage.js';
import {checkCancelled,rethrowCancelled,withTaskSignal} from '../lib/taskContext.js';
import type {JobCtx} from '../lib/jobs.js';
import {LANG_NAME} from './languages.js';
import {researchVideoPage,getVideos,getChannelsFull,researchUploadsPage,type Video} from './youtube.js';
import {videoScoreReport} from './videoScore.js';
const UUID=z.string().uuid(),VideoId=z.string().regex(/^[\w-]{11}$/),ChannelId=z.string().regex(/^UC[\w-]{22}$/),Stamp=z.string().datetime();
const Counter=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
export const ResearchEvidenceInput=z.object({query:z.string().trim().min(2).max(120),language:z.string().refine(x=>Object.hasOwn(LANG_NAME,x),'Неизвестный язык'),region:z.string().regex(/^(?:[A-Z]{2})?$/).default(''),order:z.enum(['relevance','viewCount','date']).default('relevance'),publishedDays:z.union([z.literal(0),z.literal(7),z.literal(30),z.literal(90),z.literal(365)]).default(0),baselineChannels:z.union([z.literal(0),z.literal(5),z.literal(10)]).default(5)}).strict();
const PageRow=z.object({position:z.number().int().min(1).max(50),id:VideoId,title:z.string().max(1000),channelId:ChannelId,channelTitle:z.string().max(1000),publishedAt:z.string().max(100)}).strict();
const Source=z.object({id:VideoId,title:z.string().max(1000),channelId:ChannelId,channelTitle:z.string().max(1000),publishedAt:z.string().max(100),durationSec:Counter.refine(n=>n===null||n>0),views:Counter,likes:Counter,comments:Counter}).strict();
export const ResearchVideoSource=Source;
const Sample=Source.pick({id:true,title:true,channelId:true,publishedAt:true,durationSec:true,views:true}).strip();
const Channel=z.object({id:ChannelId,subs:Counter,status:z.enum(['known','hidden','missing'])}).strict();
const Basis=z.object({channelId:ChannelId,status:z.enum(['loaded','unavailable']),sample:z.array(Sample).max(50)}).strict();
const Snapshot=z.object({version:z.literal(1),id:UUID,createdAt:Stamp,searchStartedAt:Stamp,input:ResearchEvidenceInput,rows:z.array(PageRow).max(50),sources:z.array(Source).max(50),channels:z.array(Channel).max(50),baselines:z.array(Basis).max(10),hasMore:z.boolean()}).strict();
export type ResearchEvidenceRun=z.infer<typeof Snapshot>;
const unique=(a:string[])=>[...new Set(a)];
const counter=(n:number,known?:boolean)=>known===true&&Number.isSafeInteger(n)&&n>=0?n:null;
export function researchSource(v:Video):z.infer<typeof Source>{return Source.parse({id:v.id,title:v.title,channelId:v.channelId,channelTitle:v.channelTitle,publishedAt:v.publishedAt,durationSec:v.durationKnown===true&&Number.isSafeInteger(v.durationSec)&&v.durationSec>0?v.durationSec:null,views:counter(v.views,v.viewsKnown),likes:counter(v.likes,v.likesKnown),comments:counter(v.comments,v.commentsKnown)});}
function valid(r:ResearchEvidenceRun){
 const ids=r.rows.map(x=>x.id),cids=unique(r.rows.map(x=>x.channelId)),planned=cids.slice(0,r.input.baselineChannels);
 return Date.parse(r.createdAt)>=Date.parse(r.searchStartedAt)&&unique(ids).length===ids.length&&r.rows.every((x,i)=>x.position===i+1)&&unique(r.sources.map(x=>x.id)).length===r.sources.length&&r.sources.every(x=>r.rows.some(p=>p.id===x.id&&p.channelId===x.channelId))&&unique(r.channels.map(x=>x.id)).length===r.channels.length&&r.channels.every(x=>cids.includes(x.id)&&(x.status==='known')===(x.subs!==null))&&r.baselines.length===planned.length&&r.baselines.every((x,i)=>x.channelId===planned[i]&&(x.status==='loaded'||x.sample.length===0));
}
export function researchEvidenceReport(r:ResearchEvidenceRun){
 const sources=new Map(r.sources.map(x=>[x.id,x])),channels=new Map(r.channels.map(x=>[x.id,x])),bases=new Map(r.baselines.map(x=>[x.channelId,x]));
 const rows=r.rows.map(p=>{const v=sources.get(p.id),ch=channels.get(p.channelId),b=bases.get(p.channelId);
   if(!v)return {...p,source:null,subs:ch?.subs??null,subscriberStatus:ch?.status??'missing' as const,metrics:null,baseline:null,baselineStatus:b?.status??'not-requested' as const};
   const report=videoScoreReport({version:1,id:r.id,createdAt:r.createdAt,requestedBaseline:!!b,source:{...v,description:'',tags:[]},sample:b?.sample??[],baselineStatus:b?.status==='loaded'?'loaded':b?'unavailable':'disabled',baselineNote:''});
   const ratio=v.views!==null&&ch?.subs!==null&&ch?.subs!==undefined&&ch.subs>0?v.views/ch.subs:null;
   return {...p,source:v,subs:ch?.subs??null,subscriberStatus:ch?.status??'missing' as const,metrics:{...report.metrics,ratio},baseline:report.baseline,baselineStatus:b?.status??'not-requested' as const};
 });
 return {...r,report:rows,summary:{searchRows:r.rows.length,metadata:r.sources.length,channels:unique(r.rows.map(x=>x.channelId)).length,plannedBaselines:r.baselines.length,loadedBaselines:r.baselines.filter(x=>x.status==='loaded').length,knownOutliers:rows.filter(x=>x.metrics?.outlier!==null&&x.metrics?.outlier!==undefined).length}};
}
export type ResearchEvidenceReport=ReturnType<typeof researchEvidenceReport>;
const DIR='research-evidence-runs',LIMIT=2*1024*1024;
async function directory(create=false){const p=dataPath(DIR);if(create)await fs.mkdir(p,{recursive:true,mode:0o700});try{const s=await fs.lstat(p);if(s.isSymbolicLink()||!s.isDirectory())throw new ApiError('VALIDATION','Каталог исследований недоступен');return p;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}}
export async function loadResearchEvidence(id:string):Promise<ResearchEvidenceReport|null>{
 if(!UUID.safeParse(id).success)throw new ApiError('VALIDATION','Неверный ID исследования');if(!await directory())return null;let f;
 try{const p=dataPath(DIR,id+'.json'),st=await fs.lstat(p);if(!st.isFile()||st.isSymbolicLink()||st.size>LIMIT)return null;f=await fs.open(p,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const b=Buffer.alloc(LIMIT+1);let n=0;while(n<b.length){const part=await f.read(b,n,b.length-n,null);if(!part.bytesRead)break;n+=part.bytesRead;}if(n>LIMIT)return null;const r=Snapshot.safeParse(JSON.parse(b.subarray(0,n).toString('utf8')));return r.success&&r.data.id===id&&valid(r.data)?researchEvidenceReport(r.data):null;}
 catch(e){if(e instanceof SyntaxError||['ENOENT','ELOOP'].includes((e as NodeJS.ErrnoException).code??''))return null;throw e;}finally{await f?.close();}
}
export async function listResearchEvidence(){const folder=await directory();if(!folder)return {items:[],skipped:0};const names=await fs.readdir(folder);if(names.length>5000)throw new ApiError('VALIDATION','Более 5000 файлов исследований: архивируйте часть при остановленном сервере');const rows=[];let skipped=0;for(const n of names){if(!n.endsWith('.json')||!UUID.safeParse(n.slice(0,-5)).success)continue;const r=await loadResearchEvidence(n.slice(0,-5));if(r)rows.push({id:r.id,createdAt:r.createdAt,query:r.input.query,count:r.rows.length});else skipped++;}return {items:rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)).slice(0,50),skipped};}
async function save(raw:ResearchEvidenceRun){const r=Snapshot.parse(raw);if(!valid(r))throw new ApiError('UPSTREAM','Несогласованная выборка исследования',502);const folder=await directory(true),dest=folder+'/'+r.id+'.json',tmp=dest+'.tmp';try{const text=JSON.stringify(r,null,2);if(Buffer.byteLength(text)>LIMIT)throw new ApiError('VALIDATION','Исследование превышает размер снимка');checkCancelled();await fs.writeFile(tmp,text,{flag:'wx',mode:0o600});checkCancelled();await fs.rename(tmp,dest);checkCancelled();}catch(e){await fs.rm(tmp,{force:true});await fs.rm(dest,{force:true});throw e;}return researchEvidenceReport(r);}
const Page=z.object({items:z.array(z.object({id:z.object({videoId:VideoId}),snippet:z.object({title:z.string().max(1000),channelId:ChannelId,channelTitle:z.string().max(1000),publishedAt:z.string().max(100)})})).max(50),nextPageToken:z.string().max(2000).optional()});
export async function runResearchEvidence(input:z.infer<typeof ResearchEvidenceInput>,ctx:JobCtx){return withTaskSignal(ctx.signal,async()=>{
 const d=ResearchEvidenceInput.parse(input);checkCancelled();const searchStartedAt=new Date().toISOString();ctx.progress('Одна свежая страница YouTube',5);
 try{
  const page=Page.parse(await researchVideoPage(d.query,{language:d.language,region:d.region||undefined,order:d.order,publishedAfter:d.publishedDays?new Date(Date.parse(searchStartedAt)-d.publishedDays*86400000).toISOString():undefined}));checkCancelled();
  const rows=page.items.map((x,i)=>({position:i+1,id:x.id.videoId,...x.snippet})),ids=rows.map(x=>x.id);if(unique(ids).length!==ids.length)throw Error('Duplicate search IDs');
  ctx.progress('Метаданные этой страницы и каналов',20);const sources=(ids.length?await getVideos(ids):[]).map(researchSource);checkCancelled();if(unique(sources.map(x=>x.id)).length!==sources.length||sources.some(x=>!rows.some(p=>p.id===x.id&&p.channelId===x.channelId)))throw Error("Inconsistent video metadata");
  const cids=unique(rows.map(x=>x.channelId)),cmap=cids.length?await getChannelsFull(cids,true):new Map();checkCancelled();if([...cmap.keys()].some(x=>!cids.includes(x)))throw Error('Foreign channels');
  const channels=[...cmap.values()].map(c=>{const subs=c.hiddenSubscribers?null:counter(c.subscribers,c.subscriberCountKnown);return {id:c.id,subs,status:c.hiddenSubscribers?'hidden' as const:subs===null?'missing' as const:'known' as const};});
  const baselines:z.infer<typeof Basis>[]=[];
  for(const [i,channelId] of cids.slice(0,d.baselineChannels).entries()){
   checkCancelled();ctx.progress(`База канала ${i+1}/${Math.min(cids.length,d.baselineChannels)}`,30+Math.round(60*i/Math.max(1,d.baselineChannels)));const ch=cmap.get(channelId);let b:z.infer<typeof Basis>={channelId,status:'unavailable',sample:[]};
   if(ch&&/^UU[\w-]{22}$/.test(ch.uploadsPlaylistId))try{const sample=(await researchUploadsPage(ch.uploadsPlaylistId)).map(v=>Sample.parse(researchSource(v)));if(sample.length>50)throw Error('Too many uploads');b={channelId,status:'loaded',sample};}
   catch(e){rethrowCancelled(e);if(e instanceof ApiError&&['KEY_MISSING','YT_QUOTA'].includes(e.code))throw e;}
   baselines.push(b);
  }
  checkCancelled();const r=await save({version:1,id:crypto.randomUUID(),createdAt:new Date().toISOString(),searchStartedAt,input:d,rows,sources,channels,baselines,hasMore:!!page.nextPageToken});ctx.progress('Исследование сохранено, AI не вызывался',100);return r;
 }catch(e){rethrowCancelled(e);if(e instanceof ApiError&&['KEY_MISSING','YT_QUOTA'].includes(e.code))throw new ApiError(e.code,e.code==='KEY_MISSING'?'Укажите ключ YouTube в Настройках.':'Квота YouTube исчерпана.',e.status);throw new ApiError('UPSTREAM','Не удалось получить или сохранить исследование. Прежний снимок не изменён; отправленные запросы расходуют квоту.',502);}
 });}
