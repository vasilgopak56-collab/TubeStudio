import { rethrowFinancial } from "../lib/errors.js";
import {loadResearchEvidence,listResearchEvidence} from "./researchEvidence.js";
import {loadKeywordEvidence,listKeywordEvidence} from "./keywordEvidence.js";
/** Explicit AI ideation from a small, user-previewed projection of ONE saved source. */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { dataPath } from "../lib/storage.js";
import { checkCancelled, rethrowCancelled, withTaskSignal } from "../lib/taskContext.js";
import type { JobCtx } from "../lib/jobs.js";
import { generateText, extractJson } from "./llm.js";
import { readPrompt, fill } from "./prompts.js";
import { LANG_NAME } from "./languages.js";

const UUID=z.string().uuid(),Stamp=z.string().datetime(),Kind=z.enum(["analysis","research","keywords","competitor"]);
const SavedRunId=z.union([UUID,z.string().regex(/^[a-f0-9]{8}$/)]);
const SourceId=z.string().max(100);
export const DailySelection=z.object({kind:Kind,id:SourceId,language:z.string().refine(x=>Object.hasOwn(LANG_NAME,x),"Неизвестный язык"),angle:z.string().trim().max(500).default("")}).strict().superRefine((d,c)=>{if(!(d.kind==="competitor"?/^UC[\w-]{22}$/.test(d.id):(d.kind==="analysis"?UUID:SavedRunId).safeParse(d.id).success))c.addIssue({code:z.ZodIssueCode.custom,path:["id"],message:"Неверный ID источника"});});
export const DailyGenerate=z.object({selection:DailySelection,previewHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const Source=z.object({kind:Kind,id:SourceId,title:z.string().max(300),savedAt:Stamp});
const Evidence=z.object({ref:z.string().regex(/^E(?:[1-9]|10)$/),title:z.string().min(1).max(300),videoId:z.string().regex(/^[\w-]{11}$/).nullable(),publishedAt:z.string().max(100).nullable(),views:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),tags:z.array(z.string().max(80)).max(8)}).strict();
const Context=z.object({source:Source,evidence:z.array(Evidence).min(1).max(10),total:z.number().int().positive(),warnings:z.array(z.string().max(1000)).max(10)}).strict();
const Preview=z.object({selection:DailySelection,context:Context,system:z.string().max(20000),user:z.string().max(22000),hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const Idea=z.object({title:z.string().trim().min(3).max(140),angle:z.string().trim().min(3).max(600),hook:z.string().trim().min(3).max(400),why:z.string().trim().min(3).max(700),check:z.string().trim().min(3).max(500),evidenceRefs:z.array(z.string().regex(/^E(?:[1-9]|10)$/)).min(1).max(3)}).strict();
export const DailyOutput=z.object({ideas:z.array(Idea).length(5)}).strict().superRefine((d,c)=>{if(new Set(d.ideas.map(i=>i.title.normalize("NFKC").toLowerCase())).size!==5)c.addIssue({code:z.ZodIssueCode.custom,message:"Нужны пять разных заголовков"});});
const Run=z.object({version:z.literal(1),id:UUID,createdAt:Stamp,dayUTC:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),model:z.string().min(1).max(500),preview:Preview,ideas:z.array(Idea).length(5)}).strict();
export type DailyRun=z.infer<typeof Run>;
const titles={analysis:"Анализ канала",research:"Исследование",keywords:"Ключевые слова",competitor:"Трекер конкурентов"};
export const DAILY_SOURCE_LABELS=titles;
const digest=(x:string)=>crypto.createHash("sha256").update(x).digest("hex");
const hash=(p:{selection:unknown;context:unknown;system:string;user:string})=>digest(JSON.stringify([p.selection,p.context,p.system,p.user]));
async function directory(dir:string,create=false){const p=dataPath(dir);if(create)await fs.mkdir(p,{recursive:true,mode:0o700});try{const s=await fs.lstat(p);if(s.isSymbolicLink()||!s.isDirectory())throw new ApiError("VALIDATION","Каталог источников или идей недоступен");return p;}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return null;throw e;}}
async function read(dir:string,name:string,limit=2*1024*1024):Promise<unknown|null>{
  if(!await directory(dir))return null;let f;
  try{const p=dataPath(dir,name),s=await fs.lstat(p);if(!s.isFile()||s.isSymbolicLink()||s.size>limit)return null;f=await fs.open(p,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const opened=await f.stat();if(!opened.isFile()||opened.size>limit)return null;const b=Buffer.alloc(limit+1);let used=0;while(used<b.length){const n=await f.read(b,used,b.length-used,null);if(!n.bytesRead)break;used+=n.bytesRead;}if(used>limit)return null;return JSON.parse(b.subarray(0,used).toString("utf8"));}
  catch(e){if(e instanceof SyntaxError||["ENOENT","ELOOP"].includes((e as NodeJS.ErrnoException).code??""))return null;throw e;}finally{await f?.close();}
}
const string=z.string().max(2000),Video=z.object({id:z.string().regex(/^[\w-]{11}$/),title:string,publishedAt:z.string().max(100).optional(),views:z.number().optional(),viewsKnown:z.boolean().optional(),tags:z.array(z.string().max(500)).max(100).optional()});
const Report=z.object({id:UUID,createdAt:Stamp,channel:z.object({title:string}),videos:z.array(Video).max(5000)});
const Research=z.object({id:SavedRunId,createdAt:Stamp,input:z.object({q:string}),rows:z.array(Video).max(5000)});
const Keywords=z.object({id:SavedRunId,createdAt:Stamp,input:z.object({seed:string}),keywords:z.array(z.object({keyword:string})).max(5000)});
const Competitor=z.object({id:z.string().regex(/^UC[\w-]{22}$/),title:string,lastRefresh:Stamp.optional(),videos:z.array(z.object({id:Video.shape.id,title:string,publishedAt:z.string().max(100),points:z.array(z.object({t:z.number(),v:z.number(),viewsKnown:z.boolean().optional()})).max(1000)})).max(5000)});
const Store=z.object({channels:z.array(z.unknown()).max(50)});
const clip=(s:string,n=300)=>s.slice(0,n).replace(/[\uD800-\uDBFF]$/,"");
const view=(v:{views?:number;viewsKnown?:boolean})=>v.viewsKnown===true && Number.isSafeInteger(v.views) && v.views!>=0?v.views!:null;
export async function dailyContext(selection:z.infer<typeof DailySelection>){
  const {kind,id}=DailySelection.parse(selection);let title="",savedAt="",rows:z.infer<typeof Evidence>[]=[],total=0;
  const videos=(vv:z.infer<typeof Video>[])=>{total=vv.length;return vv.slice(0,10).map((v,i)=>({ref:`E${i+1}`,title:clip(v.title),videoId:v.id,publishedAt:v.publishedAt??null,views:view(v),tags:(v.tags??[]).slice(0,8).map(t=>clip(t,80))}));};
  if(kind==="analysis"){const r=Report.safeParse(await read("reports",id+".json"));if(r.success&&r.data.id===id){title=r.data.channel.title;savedAt=r.data.createdAt;rows=videos(r.data.videos);}}
  if(kind==="research"){const fresh=UUID.safeParse(id).success?await loadResearchEvidence(id):null;if(fresh){title=fresh.input.query;savedAt=fresh.createdAt;total=fresh.report.length;rows=fresh.report.slice(0,10).map((v,i)=>({ref:`E${i+1}`,title:clip(v.title),videoId:v.id,publishedAt:v.publishedAt,views:v.source?.views??null,tags:[]}));}else{const r=Research.safeParse(await read("research-runs",id+".json"));if(r.success&&r.data.id===id){title=r.data.input.q;savedAt=r.data.createdAt;rows=videos(r.data.rows);}}}
  if(kind==="keywords"){
    const fresh=UUID.safeParse(id).success?await loadKeywordEvidence(id):null;
    if(fresh){title=fresh.input.query;savedAt=fresh.createdAt;if(fresh.kind==="suggestions"){total=fresh.suggestions.length;rows=fresh.suggestions.slice(0,10).map((k,i)=>({ref:`E${i+1}`,title:clip(k),videoId:null,publishedAt:null,views:null,tags:[]}));}else{total=fresh.rows.length;rows=fresh.rows.slice(0,10).map((v,i)=>({ref:`E${i+1}`,title:clip(v.title),videoId:v.id,publishedAt:v.publishedAt,views:v.views,tags:[]}));}}
    else{const r=Keywords.safeParse(await read("keyword-runs",id+".json"));if(r.success&&r.data.id===id){title=r.data.input.seed;savedAt=r.data.createdAt;total=r.data.keywords.length;rows=r.data.keywords.slice(0,10).map((k,i)=>({ref:`E${i+1}`,title:clip(k.keyword),videoId:null,publishedAt:null,views:null,tags:[]}));}}
  }
  if(kind==="competitor"){
    const st=Store.safeParse(await read("","competitors.json",8*1024*1024));
    if(st.success){const r=st.data.channels.map(c=>Competitor.safeParse(c)).find(c=>c.success&&c.data.id===id);if(r?.success&&r.data.lastRefresh){title=r.data.title;savedAt=r.data.lastRefresh;rows=videos(r.data.videos.map(v=>{const p=[...v.points].filter(p=>Number.isFinite(p.t)&&p.t<=Date.parse(savedAt)).sort((a,b)=>b.t-a.t)[0];return {...v,views:p?.v,viewsKnown:p?.viewsKnown};}));}}
  }
  if(!savedAt)throw new ApiError("NOT_FOUND","Источник не найден, повреждён или ещё не имеет сохранённого обновления",404);
  if(!rows.length||rows.some(r=>!r.title.trim()))throw new ApiError("VALIDATION","В выбранном источнике нет подходящих непустых названий/ключей. Выберите другой снимок.");
  return Context.parse({source:{kind,id,title:clip(title),savedAt},evidence:rows,total,warnings:[
    `Сохранённые данные от ${savedAt}, не текущие тренды. Источник не обновляется из YouTube.`,
    `Переданы первые ${rows.length} из ${total} строк в порядке файла, без нового ранжирования. Названия — до 300 символов, до 8 тегов по 80 символов. Обрезание ограничено этими полями и явно раскрыто.`,
    "Счётчики в трекере — последние сохранённые точки, не обязательно снятые одновременно. Просмотры передаются только при явной отметке известности. В старых снимках она может отсутствовать: тогда null, не ноль. VPH, Outlier, спрос, конкуренция, доход, прежние AI-выводы и полные описания не передаются.",
    "Идеи и объяснения — гипотезы AI, не проверенные факты, не подтверждённый спрос и не прогноз просмотров. Ссылки E1–E10 показывают предоставленные материалы, но не доказывают вывод модели."
  ]});
}
export async function previewDaily(input:z.infer<typeof DailySelection>){
  const selection=DailySelection.parse(input),context=await dailyContext(selection);
  const system=fill(await readPrompt("daily-ideas/ideas.md"),{language:LANG_NAME[selection.language]});
  const user=JSON.stringify({context,authorAngle:selection.angle});
  if(system.length>20000 || user.length>22000)throw new ApiError("VALIDATION","Запрос превышает лимит предпросмотра; сократите промпт или выберите другой источник.");
  return Preview.parse({selection,context,system,user,hash:hash({selection,context,system,user})});
}
export async function dailySources(){
  const items:z.infer<typeof Source>[]=[],warnings:string[]=[];
  const dirs=[{dir:"reports",kind:"analysis",name:"title"},{dir:"research-runs",kind:"research",name:"q"},{dir:"keyword-runs",kind:"keywords",name:"seed"}] as const;
  for(const d of dirs){
    try{const index=await read(d.dir,"index.json",256*1024);if(index===null)continue;
      const p=z.array(z.object({id:d.kind==="analysis"?UUID:SavedRunId,createdAt:Stamp,title:string.optional(),q:string.optional(),seed:string.optional()})).max(200).safeParse(index);
      if(!p.success){warnings.push(`${titles[d.kind]}: индекс повреждён или неподдерживаемый.`);continue;}
      const seen=new Set<string>();for(const r of [...p.data].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,50)){if(seen.has(r.id))continue;seen.add(r.id);items.push({kind:d.kind,id:r.id,title:clip(r[d.name]??"Без названия"),savedAt:r.createdAt});}
    }catch{warnings.push(`${titles[d.kind]}: список недоступен.`);}
  }
  try{const fresh=await listResearchEvidence();for(const r of fresh.items)items.push({kind:"research",id:r.id,title:clip(r.query),savedAt:r.createdAt});if(fresh.skipped)warnings.push("Исследования: повреждённые новые снимки пропущены.");}catch{warnings.push("Исследования: новые снимки недоступны.");}
  try{const fresh=await listKeywordEvidence();for(const r of fresh.items)items.push({kind:"keywords",id:r.id,title:clip(r.query),savedAt:r.createdAt});if(fresh.skipped)warnings.push("Ключевые слова: повреждённые новые снимки пропущены.");}catch{warnings.push("Ключевые слова: новые снимки недоступны.");}
  try{const st=Store.safeParse(await read("","competitors.json",8*1024*1024));if(st.success){for(const row of st.data.channels){const c=Competitor.safeParse(row);if(c.success&&c.data.lastRefresh)items.push({kind:"competitor",id:c.data.id,title:clip(c.data.title),savedAt:c.data.lastRefresh});else warnings.push("Один канал трекера пропущен: нет сохранённого обновления или данные повреждены.");}}}
  catch{warnings.push("Трекер конкурентов: список недоступен.");}
  return {items,warnings};
}
function validRefs(r:{ideas:z.infer<typeof Idea>[];preview:z.infer<typeof Preview>}){const ids=new Set(r.preview.context.evidence.map(e=>e.ref));return r.ideas.every(i=>new Set(i.evidenceRefs).size===i.evidenceRefs.length && i.evidenceRefs.every(x=>ids.has(x)));}
export async function loadDaily(id:string){
  if(!UUID.safeParse(id).success)throw new ApiError("VALIDATION","Неверный ID подборки");
  const p=Run.safeParse(await read("daily-idea-runs",id+".json",256*1024));if(!p.success)return null;const r=p.data;
  if(r.preview.selection.kind!==r.preview.context.source.kind||r.preview.selection.id!==r.preview.context.source.id||r.preview.user!==JSON.stringify({context:r.preview.context,authorAngle:r.preview.selection.angle})||r.preview.context.total<r.preview.context.evidence.length||r.preview.context.evidence.some((e,i)=>e.ref!==`E${i+1}`))return null;
  if(r.id!==id||r.dayUTC!==r.createdAt.slice(0,10)||hash(r.preview)!==r.preview.hash||!DailyOutput.safeParse({ideas:r.ideas}).success||!validRefs(r))return null;
  return r;
}
export async function listDaily(){
  const dir=await directory("daily-idea-runs");if(!dir)return {items:[],skipped:0};const names=await fs.readdir(dir);if(names.length>5000)throw new ApiError("VALIDATION","Больше 5000 файлов подборок. Архивируйте часть при остановленной программе.");
  const items=[];let skipped=0;for(const n of names){if(!n.endsWith(".json")||!UUID.safeParse(n.slice(0,-5)).success)continue;const r=await loadDaily(n.slice(0,-5));if(r)items.push({id:r.id,createdAt:r.createdAt,dayUTC:r.dayUTC,source:r.preview.context.source,count:r.ideas.length});else skipped++;}
  return {items:items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)).slice(0,50),skipped};
}
export async function latestDaily(){const list=await listDaily();return list.items.length?loadDaily(list.items[0].id):null;}
function upstream(e:unknown):never {rethrowCancelled(e); rethrowFinancial(e);if(e instanceof ApiError && ["KEY_MISSING","BUDGET_LIMIT","LLM_RATE_LIMIT"].includes(e.code))throw new ApiError(e.code,e.code==="KEY_MISSING"?"Укажите ключ текстовой модели в Настройках.":e.code==="BUDGET_LIMIT"?"Бюджет генерации исчерпан.":"Модель ограничила запросы. Попробуйте позже.",e.status);throw new ApiError("UPSTREAM","Не удалось получить идеи от модели. Подборка не сохранена; уже выполненный запрос может быть оплачен.",502);}
export async function generateDaily(input:z.infer<typeof DailyGenerate>,ctx:JobCtx){return withTaskSignal(ctx.signal,async()=>{
  const d=DailyGenerate.parse(input);checkCancelled();const preview=await previewDaily(d.selection);
  if(preview.hash!==d.previewHash)throw new ApiError("VALIDATION","Источник, настройки формы или промпт изменились. Обновите предпросмотр перед отправкой в AI.",409);
  ctx.progress("Пять идей по выбранному сохранённому источнику (AI)",20);let response;
  try{response=await generateText({system:preview.system,user:preview.user,fast:true,temperature:.6,maxTokens:4000});}catch(e){upstream(e);}
  checkCancelled();let output:z.infer<typeof DailyOutput>;
  try{if(response.text.length>25000)throw Error("large");output=DailyOutput.parse(extractJson(response.text));if(!validRefs({...output,preview}))throw Error("refs");}
  catch{throw new ApiError("LLM_INVALID_JSON","Ответ не прошёл проверку пяти разных идей и ссылок на контекст. Подборка не сохранена; AI-запрос мог быть оплачен.",502);}
  const createdAt=new Date().toISOString(),run=Run.parse({version:1,id:crypto.randomUUID(),createdAt,dayUTC:createdAt.slice(0,10),model:response.model,preview,ideas:output.ideas});
  const folder=await directory("daily-idea-runs",true),dest=folder+"/"+run.id+".json",temp=dest+".tmp";
  try{const text=JSON.stringify(run,null,2);if(Buffer.byteLength(text)>256*1024)throw new ApiError("VALIDATION","Подборка превышает лимит файла");checkCancelled();await fs.writeFile(temp,text,{mode:0o600,flag:"wx"});checkCancelled();await fs.rename(temp,dest);checkCancelled();}
  catch(e){await fs.rm(temp,{force:true});await fs.rm(dest,{force:true});throw e;}
  ctx.progress("Подборка сохранена локально",100);return run;
});}
