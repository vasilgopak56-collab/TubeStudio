/** Deterministic editorial checklist and an explicitly requested single search.list page. No AI/ranking score. */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {z} from 'zod';
import {ApiError} from '../lib/errors.js';
import {dataPath} from '../lib/storage.js';
import {checkCancelled,rethrowCancelled,withTaskSignal} from '../lib/taskContext.js';
import type {JobCtx} from '../lib/jobs.js';
import {parseVideoId} from './youtubeCaptions.js';
import {searchVideoPage} from './youtube.js';
import {LANG_NAME} from './languages.js';
const Id=z.string().uuid(),Stamp=z.string().datetime(),VideoId=z.string().regex(/^[\w-]{11}$/);
export const SeoAuditInput=z.object({title:z.string().trim().min(1).max(300),description:z.string().max(10000).default(''),tags:z.array(z.string().trim().min(1).max(100)).max(60).default([]),keyword:z.string().trim().max(120).default('')}).strict();
const SearchFields=z.object({auditId:Id,query:z.string().trim().min(2).max(200),video:z.string().trim().max(2048).default(''),language:z.string().refine(x=>Object.hasOwn(LANG_NAME,x),'Неизвестный язык').default('ru'),region:z.string().regex(/^(?:[A-Z]{2})?$/).default('')}).strict();
const target=(d:z.infer<typeof SearchFields>)=>({...d,targetId:d.video?parseVideoId(d.video):null});
export const SeoSearchInput=SearchFields.transform(target);
const Hash=z.string().regex(/^[a-f0-9]{64}$/);
export const SeoSearchGenerate=SearchFields.extend({previewHash:Hash}).strict().transform(d=>({...target(d),previewHash:d.previewHash}));
const Row=z.object({id:VideoId,title:z.string().max(1000),channelTitle:z.string().max(1000),publishedAt:z.string().max(100).nullable()}).strict();
const Search=z.object({query:z.string().min(2).max(200),language:z.string().refine(x=>Object.hasOwn(LANG_NAME,x)),region:z.string().regex(/^[A-Z]{2}$/).nullable(),targetId:VideoId.nullable(),capturedAt:Stamp,rows:z.array(Row).max(50),hasMore:z.boolean(),order:z.literal('relevance'),safeSearch:z.literal('moderate'),maxResults:z.literal(50)}).strict();
const PublicRequest=z.object({method:z.literal('GET'),endpoint:z.literal('https://www.googleapis.com/youtube/v3/search'),params:z.object({part:z.literal('snippet'),type:z.literal('video'),q:z.string().min(2).max(200),order:z.literal('relevance'),maxResults:z.literal(50),relevanceLanguage:z.string().refine(x=>Object.hasOwn(LANG_NAME,x)),regionCode:z.string().regex(/^[A-Z]{2}$/).optional(),safeSearch:z.literal('moderate')}).strict()}).strict();
const PreviewBody=z.object({auditId:Id,auditCreatedAt:Stamp,inputHash:Hash,targetId:VideoId.nullable(),request:PublicRequest}).strict();
const Preview=PreviewBody.extend({hash:Hash}).strict();
const StoredFields={id:Id,createdAt:Stamp,parentId:Id.nullable(),input:SeoAuditInput,search:Search.nullable()};
const Stored=z.discriminatedUnion('version',[
 z.object({version:z.literal(1),...StoredFields}).strict(),
 z.object({version:z.literal(2),...StoredFields,request:Preview.nullable()}).strict()
]);
type StoredT=z.infer<typeof Stored>;
const digest=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function previewHash(p:z.infer<typeof Preview>){const {hash:_hash,...body}=p;return digest(PreviewBody.parse(body));}
function validStored(s:StoredT){
 if(s.parentId===s.id||!!s.parentId!==!!s.search||s.search&&new Set(s.search.rows.map(r=>r.id)).size!==s.search.rows.length)return false;
 if(s.version===1)return true;
 if(!s.search)return s.request===null;
 if(!s.request)return false;
 const p=s.request,q=p.request.params,r=s.search;
 return p.hash===previewHash(p)&&p.auditId===s.parentId&&p.inputHash===digest(s.input)&&p.targetId===r.targetId&&q.q===r.query&&q.relevanceLanguage===r.language&&(q.regionCode??null)===r.region&&q.order===r.order&&q.safeSearch===r.safeSearch&&q.maxResults===r.maxResults&&s.createdAt===r.capturedAt;
}
export const SEO_REVIEW_PHRASES=['100%','без риска','гарантирован','мгновенно','guaranteed','risk-free','miracle cure'] as const;
const norm=(s:string)=>s.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е');
export function seoChecklist(i:z.infer<typeof SeoAuditInput>){
 const n=norm(i.keyword),contains=(s:string)=>!!n&&norm(s).includes(n),tagChars=i.tags.join(',').length,unique=new Set(i.tags.map(norm));
 const flags=SEO_REVIEW_PHRASES.flatMap(term=>[{field:'title',value:i.title},{field:'description',value:i.description},{field:'tags',value:i.tags.join('\n')}].filter(f=>norm(f.value).includes(norm(term))).map(f=>({term,field:f.field})));
 const check=(key:string,title:string,state:'observed'|'attention'|'manual',detail:string)=>({key,title,state,detail});
 return {methodVersion:1 as const,counts:{title:i.title.length,description:i.description.length,tags:i.tags.length,tagChars,duplicateTags:i.tags.length-unique.size},matches:{title:contains(i.title),description:contains(i.description),opening:contains(i.description.slice(0,200)),tags:i.tags.some(contains)},flags,checks:[
  check('title','Заголовок',i.title.length>100?'attention':'observed',`${i.title.length} единиц UTF-16. Контрольный порог этого списка — 100; ясность и соответствие видео проверяются вручную.`),
  check('description','Описание',!i.description.trim()||i.description.length>5000?'attention':'observed',i.description.trim()?`${i.description.length} единиц UTF-16. Контрольный порог — 5000; наличие текста не подтверждает качество SEO.`:'Описание не заполнено. Решите, какой контекст и ссылки действительно нужны зрителю.'),
  check('tags','Теги',unique.size<i.tags.length||tagChars>500?'attention':'observed',`${i.tags.length} тегов; повторов после нормализации: ${i.tags.length-unique.size}; ${tagChars} единиц UTF-16 с запятыми. Порог 500 — локальная подсказка, не точная проверка лимита Studio (там возможен другой учёт кавычек/пробелов). Отсутствие тегов не доказывает плохое продвижение.`),
  check('keyword','Целевая фраза',!n?'manual':contains(i.title)||contains(i.description)||i.tags.some(contains)?'observed':'attention',!n?'Фраза не указана. Без неё сопоставление не выполняется.':`Нормализованная подстрока: заголовок ${contains(i.title)?'да':'нет'}, описание ${contains(i.description)?'да':'нет'}, первые 200 знаков ${contains(i.description.slice(0,200))?'да':'нет'}, теги ${i.tags.some(contains)?'да':'нет'}. Это совпадение текста, не поисковый спрос и не рекомендация повторять ключи.`),
  check('wording','Формулировки для ручной проверки',flags.length?'attention':'manual',flags.length?`Найдено совпадений со словарём: ${flags.length}. Проверьте контекст, факты и обещания; это не список запрещённых YouTube слов.`:'Совпадений с небольшим словарём нет. Это не проверка всех языков, политики YouTube или безопасности публикации.'),
  check('truth','Смысл, факты и права','manual','Проверьте обещание заголовка, фактическую точность, права, ссылки и соответствие ролику. Балл SEO, CTR, монетизация и допуск к публикации не рассчитываются.')
 ]};
}
export function seoAuditReport(s:StoredT){const position=s.search?.targetId?s.search.rows.findIndex(r=>r.id===s.search!.targetId):-1;return {...s,request:s.version===2?s.request:null,local:seoChecklist(s.input),searchPosition:position>=0?position+1:null};}
export type SeoAuditReport=ReturnType<typeof seoAuditReport>;
const folder=()=>dataPath('seo-audit-runs');
async function safeFolder(create=false){if(create)await fs.mkdir(folder(),{recursive:true,mode:0o700});try{const st=await fs.lstat(folder());if(st.isSymbolicLink()||!st.isDirectory())throw new ApiError('VALIDATION','Каталог SEO-проверок недоступен');return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}}
export async function loadSeoAudit(id:string):Promise<SeoAuditReport|null>{
 if(!Id.safeParse(id).success)throw new ApiError('VALIDATION','Неверный ID проверки');if(!await safeFolder())return null;let f;
 try{const name=dataPath('seo-audit-runs',id+'.json'),st=await fs.lstat(name);if(st.isSymbolicLink()||!st.isFile()||st.size>256*1024)return null;f=await fs.open(name,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const opened=await f.stat();if(!opened.isFile()||opened.size>256*1024)return null;const bytes=Buffer.alloc(256*1024+1);let used=0;while(used<bytes.length){const n=await f.read(bytes,used,bytes.length-used,null);if(!n.bytesRead)break;used+=n.bytesRead;}if(used>256*1024)return null;const p=Stored.safeParse(JSON.parse(bytes.subarray(0,used).toString('utf8')));if(!p.success||p.data.id!==id||!validStored(p.data))return null;return seoAuditReport(p.data);}
 catch(e){if(e instanceof SyntaxError||['ENOENT','ELOOP'].includes((e as NodeJS.ErrnoException).code??''))return null;throw e;}finally{await f?.close();}
}
export async function listSeoAudits(){if(!await safeFolder())return {items:[],skipped:0};const names=await fs.readdir(folder());if(names.length>5000)throw new ApiError('VALIDATION','В каталоге больше 5000 файлов. Архивируйте часть при остановленном сервере.');const items=[];let skipped=0;for(const n of names){if(!n.endsWith('.json')||!Id.safeParse(n.slice(0,-5)).success)continue;const r=await loadSeoAudit(n.slice(0,-5));if(r)items.push({id:r.id,title:r.input.title,createdAt:r.createdAt,hasSearch:!!r.search});else skipped++;}return {items:items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)).slice(0,50),skipped};}
async function commit(s:StoredT){await safeFolder(true);const dest=dataPath('seo-audit-runs',s.id+'.json'),tmp=dest+'.tmp';try{const parsed=Stored.parse(s);if(!validStored(parsed))throw new ApiError('VALIDATION','Несогласованный снимок SEO-проверки');const text=JSON.stringify(parsed,null,2);if(Buffer.byteLength(text)>256*1024)throw new ApiError('VALIDATION','Слишком большой снимок');checkCancelled();await fs.writeFile(tmp,text,{flag:'wx',mode:0o600});checkCancelled();await fs.rename(tmp,dest);checkCancelled();}catch(e){await fs.rm(tmp,{force:true});await fs.rm(dest,{force:true});throw e;}return seoAuditReport(s);}
export async function createSeoAudit(input:z.infer<typeof SeoAuditInput>){return commit({version:2,id:crypto.randomUUID(),createdAt:new Date().toISOString(),parentId:null,input:SeoAuditInput.parse(input),search:null,request:null});}
const Upstream=z.object({items:z.array(z.object({id:z.object({videoId:VideoId}),snippet:z.object({title:z.string().max(1000),channelTitle:z.string().max(1000),publishedAt:z.string().max(100).optional()})})).max(50),nextPageToken:z.string().max(2000).optional()});
/** This endpoint reads local context only; no provider or quota call. Keys never enter the public preview. */
export async function previewSeoAudit(d:z.infer<typeof SeoSearchInput>){
 const selection=SeoSearchInput.parse({auditId:d.auditId,query:d.query,video:d.video,language:d.language,region:d.region});
 const base=await loadSeoAudit(selection.auditId);if(!base)throw new ApiError('NOT_FOUND','Сохранённая проверка не найдена или повреждена',404);
 const body=PreviewBody.parse({auditId:base.id,auditCreatedAt:base.createdAt,inputHash:digest(base.input),targetId:selection.targetId,request:{method:'GET',endpoint:'https://www.googleapis.com/youtube/v3/search',params:{part:'snippet',type:'video',q:selection.query,order:'relevance',maxResults:50,relevanceLanguage:selection.language,...(selection.region?{regionCode:selection.region}:{}),safeSearch:'moderate'}}});
 return Preview.parse({...body,hash:digest(body)});
}
export async function searchSeoAudit(d:z.infer<typeof SeoSearchGenerate>,ctx:JobCtx){return withTaskSignal(ctx.signal,async()=>{
 checkCancelled();const preview=await previewSeoAudit(d);if(preview.hash!==d.previewHash)throw new ApiError('VALIDATION','Сохранённый текст или параметры изменились. Обновите предпросмотр перед поиском.',409);
 const base=await loadSeoAudit(d.auditId);if(!base)throw new ApiError('NOT_FOUND','Сохранённая проверка не найдена или повреждена',404);
 // Recheck after the second read as the source can be edited on disk between reads.
 if(digest(base.input)!==preview.inputHash||base.createdAt!==preview.auditCreatedAt)throw new ApiError('VALIDATION','Источник изменился. Обновите предпросмотр.',409);
 checkCancelled();ctx.progress('Одна свежая страница search.list — до 50 видео',20);let raw;
 const q=preview.request.params;
 try{raw=await searchVideoPage(q.q,{lang:q.relevanceLanguage,region:q.regionCode});}catch(e){rethrowCancelled(e);if(e instanceof ApiError&&['KEY_MISSING','YT_QUOTA'].includes(e.code))throw new ApiError(e.code,e.code==='KEY_MISSING'?'Укажите ключ YouTube в настройках.':'Квота YouTube исчерпана. Попробуйте позже.',e.status);throw new ApiError('UPSTREAM','Не удалось получить выборку поиска YouTube. Прежняя проверка не изменена.',502);}
 checkCancelled();const parsed=Upstream.safeParse(raw);if(!parsed.success||new Set(parsed.data.items.map(x=>x.id.videoId)).size!==parsed.data.items.length)throw new ApiError('UPSTREAM','YouTube вернул некорректную выборку. Новая проверка не сохранена.',502);
 const at=new Date().toISOString(),search=Search.parse({query:q.q,language:q.relevanceLanguage,region:q.regionCode??null,targetId:preview.targetId,capturedAt:at,rows:parsed.data.items.map(x=>({id:x.id.videoId,title:x.snippet.title,channelTitle:x.snippet.channelTitle,publishedAt:x.snippet.publishedAt??null})),hasMore:!!parsed.data.nextPageToken,order:q.order,safeSearch:q.safeSearch,maxResults:q.maxResults});
 const result=await commit({version:2,id:crypto.randomUUID(),createdAt:at,parentId:base.id,input:base.input,search,request:preview});ctx.progress('Отдельный снимок поиска сохранён',100);return result;
});}
