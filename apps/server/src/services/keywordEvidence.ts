/** Bounded keyword evidence, never search volume, ranking difficulty or a demand score. */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {z} from 'zod';
import {ApiError} from '../lib/errors.js';
import {dataPath} from '../lib/storage.js';
import {fetchRetry} from '../lib/http.js';
import {checkCancelled,rethrowCancelled,withTaskSignal} from '../lib/taskContext.js';
import type {JobCtx} from '../lib/jobs.js';
import {LANG_NAME} from './languages.js';
import {searchVideoPage,getVideos,getChannelsFull} from './youtube.js';
const UUID=z.string().uuid(),Stamp=z.string().datetime(),VideoId=z.string().regex(/^[\w-]{11}$/),ChannelId=z.string().regex(/^UC[\w-]{22}$/);
const Counter=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
export const KeywordEvidenceInput=z.object({query:z.string().trim().min(2).max(120),language:z.string().refine(s=>Object.hasOwn(LANG_NAME,s),'Неизвестный язык'),region:z.string().regex(/^(?:[A-Z]{2})?$/).default('')}).strict();
const EvidenceRow=z.object({position:z.number().int().min(1).max(50),id:VideoId,title:z.string().max(1000),channelId:ChannelId,channelTitle:z.string().max(1000),publishedAt:z.string().max(100),metadata:z.boolean(),views:Counter,subs:Counter,subscriberStatus:z.enum(['known','hidden','missing'])}).strict();
const Run=z.discriminatedUnion('kind',[
 z.object({version:z.literal(1),kind:z.literal('suggestions'),id:UUID,createdAt:Stamp,input:KeywordEvidenceInput,suggestions:z.array(z.string().trim().min(1).max(120)).max(30),received:z.number().int().min(0).max(100),hasMore:z.boolean()}).strict(),
 z.object({version:z.literal(1),kind:z.literal('search'),id:UUID,createdAt:Stamp,input:KeywordEvidenceInput,rows:z.array(EvidenceRow).max(50),hasMore:z.boolean(),baseUnits:z.union([z.literal(100),z.literal(101),z.literal(102)])}).strict()
]);
export type KeywordEvidenceRun=z.infer<typeof Run>;
export const normalizeKeyword=(s:string)=>s.normalize('NFKC').toLowerCase().replaceAll('ё','е').replace(/\s+/g,' ').trim();
const median=(a:number[])=>{if(!a.length)return null;const x=[...a].sort((a,b)=>a-b),i=Math.floor(x.length/2);return x.length%2?x[i]:(x[i-1]/2+x[i]/2);};
export function keywordEvidenceReport(r:KeywordEvidenceRun){
 if(r.kind==='suggestions')return {...r,summary:null};
 const views=r.rows.flatMap(x=>x.views===null?[]:[x.views]);
 // Channels, not videos, are the subscriber denominator. Missing/hidden are not zeros.
 const channels=[...new Map(r.rows.map(x=>[x.channelId,x])).values()],known=channels.flatMap(x=>x.subs===null?[]:[x.subs]);
 return {...r,summary:{videos:r.rows.length,metadata:r.rows.filter(x=>x.metadata).length,knownViews:views.length,medianViews:median(views),channels:channels.length,knownSubscribers:known.length,hiddenChannels:channels.filter(x=>x.subscriberStatus==='hidden').length,medianSubscribers:median(known),smallChannels:known.filter(x=>x<10000).length,titleMatches:r.rows.filter(x=>normalizeKeyword(x.title).includes(normalizeKeyword(r.input.query))).length}};
}
export type KeywordEvidenceReport=ReturnType<typeof keywordEvidenceReport>;
function valid(r:KeywordEvidenceRun){if(r.kind==='suggestions')return r.received>=r.suggestions.length&&new Set(r.suggestions.map(normalizeKeyword)).size===r.suggestions.length;
 const channels=new Map<string,string>();return new Set(r.rows.map(x=>x.id)).size===r.rows.length&&r.rows.every((x,i)=>{const prior=channels.get(x.channelId),value=JSON.stringify([x.subs,x.subscriberStatus]);channels.set(x.channelId,value);return x.position===i+1&&(x.subscriberStatus==='known')===(x.subs!==null)&&(x.metadata||x.views===null)&&(!prior||prior===value);})&&r.baseUnits===(r.rows.length?102:100);
}
const DIR='keyword-evidence-runs',LIMIT=256*1024;
async function directory(create=false){const p=dataPath(DIR);if(create)await fs.mkdir(p,{recursive:true,mode:0o700});try{const st=await fs.lstat(p);if(!st.isDirectory()||st.isSymbolicLink())throw new ApiError('VALIDATION','Каталог ключевых фраз недоступен');return p;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}}
export async function loadKeywordEvidence(id:string):Promise<KeywordEvidenceReport|null>{
 if(!UUID.safeParse(id).success)throw new ApiError('VALIDATION','Неверный ID снимка');if(!await directory())return null;let f;
 try{const p=dataPath(DIR,id+'.json'),st=await fs.lstat(p);if(!st.isFile()||st.isSymbolicLink()||st.size>LIMIT)return null;f=await fs.open(p,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const bytes=Buffer.alloc(LIMIT+1);let n=0;while(n<bytes.length){const part=await f.read(bytes,n,bytes.length-n,null);if(!part.bytesRead)break;n+=part.bytesRead;}if(n>LIMIT)return null;const r=Run.safeParse(JSON.parse(bytes.subarray(0,n).toString('utf8')));return r.success&&r.data.id===id&&valid(r.data)?keywordEvidenceReport(r.data):null;}
 catch(e){if(e instanceof SyntaxError||['ENOENT','ELOOP'].includes((e as NodeJS.ErrnoException).code??''))return null;throw e;}finally{await f?.close();}
}
async function save(input:KeywordEvidenceRun){const r=Run.parse(input);if(!valid(r))throw new ApiError('UPSTREAM','Несогласованный снимок: сохранение отменено',502);const folder=await directory(true),dest=folder+'/'+r.id+'.json',tmp=dest+'.tmp';try{const text=JSON.stringify(r,null,2);if(Buffer.byteLength(text)>LIMIT)throw new ApiError('VALIDATION','Снимок слишком большой');checkCancelled();await fs.writeFile(tmp,text,{flag:'wx',mode:0o600});checkCancelled();await fs.rename(tmp,dest);checkCancelled();}catch(e){await fs.rm(tmp,{force:true});await fs.rm(dest,{force:true});throw e;}return keywordEvidenceReport(r);}
export async function listKeywordEvidence(){const folder=await directory();if(!folder)return {items:[],skipped:0};const names=await fs.readdir(folder);if(names.length>5000)throw new ApiError('VALIDATION','Более 5000 файлов: архивируйте часть при остановленном сервере');const rows:KeywordEvidenceReport[]=[];let skipped=0;for(const n of names){if(!n.endsWith('.json')||!UUID.safeParse(n.slice(0,-5)).success)continue;const r=await loadKeywordEvidence(n.slice(0,-5));if(r)rows.push(r);else skipped++;}return {items:rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)).slice(0,50).map(r=>({id:r.id,kind:r.kind,createdAt:r.createdAt,query:r.input.query,count:r.kind==='search'?r.rows.length:r.suggestions.length})),skipped};}
async function boundedJson(r:Response){if(!r.body)throw Error('empty');const reader=r.body.getReader(),chunks:Uint8Array[]=[];let n=0;try{for(;;){checkCancelled();const {value,done}=await reader.read();if(done)break;n+=value.byteLength;if(n>LIMIT)throw Error('large');chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
const Suggest=z.tuple([z.string().max(300),z.array(z.string().max(1000)).max(100)]).rest(z.unknown());
export async function runKeywordSuggestions(input:z.infer<typeof KeywordEvidenceInput>,ctx:JobCtx){return withTaskSignal(ctx.signal,async()=>{
 const d=KeywordEvidenceInput.parse(input);checkCancelled();ctx.progress('Одна страница подсказок, без Data API и AI',20);let parsed:z.infer<typeof Suggest>;
 try{const url=new URL('https://suggestqueries.google.com/complete/search');url.search=new URLSearchParams({client:'firefox',ds:'yt',hl:d.language,oe:'utf8',q:d.query,...(d.region?{gl:d.region}:{})}).toString();const r=await fetchRetry(url.href,{headers:{'User-Agent':'Mozilla/5.0'}},{timeoutMs:8000,retries:1});if(!r.ok)throw Error('status');parsed=Suggest.parse(await boundedJson(r));if(parsed[0]!==d.query)throw Error('query');}
 catch(e){rethrowCancelled(e);throw new ApiError('UPSTREAM','Подсказки недоступны или ответ некорректен. Прежний снимок не изменён.',502);}
 checkCancelled();const seen=new Set<string>(),all:string[]=[];for(const text of parsed[1]){const s=text.trim(),key=normalizeKeyword(s);if(!s||s.length>120||seen.has(key))continue;seen.add(key);all.push(s);}
 const r=await save({version:1,kind:'suggestions',id:crypto.randomUUID(),createdAt:new Date().toISOString(),input:d,suggestions:all.slice(0,30),received:parsed[1].length,hasMore:all.length>30});ctx.progress('Подсказки сохранены, поиск не запускался',100);return r;
 });}
const Search=z.object({items:z.array(z.object({id:z.object({videoId:VideoId}),snippet:z.object({title:z.string().max(1000),channelId:ChannelId,channelTitle:z.string().max(1000),publishedAt:z.string().max(100)})})).max(50),nextPageToken:z.string().max(2000).optional()});
const counter=(n:number,known?:boolean)=>known===true&&Number.isSafeInteger(n)&&n>=0?n:null;
export async function runKeywordSearch(input:z.infer<typeof KeywordEvidenceInput>,ctx:JobCtx){return withTaskSignal(ctx.signal,async()=>{
 const d=KeywordEvidenceInput.parse(input);checkCancelled();ctx.progress('Одна страница поиска YouTube',10);
 try{const raw=Search.parse(await searchVideoPage(d.query,{lang:d.language,region:d.region||undefined}));checkCancelled();const ids=raw.items.map(x=>x.id.videoId);if(new Set(ids).size!==ids.length)throw Error('duplicate');
 ctx.progress('Публичные счётчики этой страницы',45);const videos=ids.length?await getVideos(ids):[];checkCancelled();const vmap=new Map(videos.map(v=>[v.id,v]));if(videos.length!==vmap.size||videos.some(v=>!ids.includes(v.id)))throw Error('foreign');
 const cids=[...new Set(raw.items.map(x=>x.snippet.channelId))],channels=cids.length?await getChannelsFull(cids,true):new Map();checkCancelled();if([...channels.keys()].some(id=>!cids.includes(id)))throw Error('foreign');
 const rows=raw.items.map((s,i)=>{const v=vmap.get(s.id.videoId),c=channels.get(s.snippet.channelId);if(v&&v.channelId!==s.snippet.channelId)throw Error('mismatch');const subs=c?counter(c.subscribers,c.subscriberCountKnown):null;return {position:i+1,id:s.id.videoId,title:s.snippet.title,channelId:s.snippet.channelId,channelTitle:s.snippet.channelTitle,publishedAt:s.snippet.publishedAt,metadata:!!v,views:v?counter(v.views,v.viewsKnown):null,subs,subscriberStatus:c?.hiddenSubscribers?'hidden' as const:subs!==null?'known' as const:'missing' as const};});
 const r=await save({version:1,kind:'search',id:crypto.randomUUID(),createdAt:new Date().toISOString(),input:d,rows,hasMore:!!raw.nextPageToken,baseUnits:ids.length?102:100});ctx.progress('Поиск сохранён, AI не вызывался',100);return r;
 }catch(e){rethrowCancelled(e);if(e instanceof ApiError&&['KEY_MISSING','YT_QUOTA'].includes(e.code))throw new ApiError(e.code,e.code==='KEY_MISSING'?'Укажите ключ YouTube в Настройках.':'Квота YouTube исчерпана.',e.status);throw new ApiError('UPSTREAM','Не удалось получить согласованную выборку поиска и счётчиков. Прежний снимок не изменён; уже отправленные запросы расходуют квоту.',502);}
 });}
