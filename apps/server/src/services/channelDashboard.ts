import crypto from "node:crypto";
import fs from "node:fs/promises";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { dataPath } from "../lib/storage.js";
import { channelSnapshotSource, channelSnapshotConnection } from "./ytAnalytics.js";
import { checkCancelled, withTaskSignal } from "../lib/taskContext.js";
const DIR = "yt-channel-runs", MAX_ROWS = 366, MAX_FILE = 2 * 1024 ** 2;
const Id = z.string().uuid();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(s + "T00:00:00Z"); return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s;
}, "Некорректная календарная дата");
const SnapshotFields = z.object({ title: z.string().trim().max(120).default(""), startDate: Day, endDate: Day }).strict();
export const ChannelSnapshotInput = SnapshotFields.refine(
  v => v.startDate >= "2005-01-01" && v.startDate <= v.endDate && Date.parse(v.endDate) - Date.parse(v.startDate) <= 365 * 86400000,
  "Проверьте период: с 2005 года, начало не позже конца, до 366 дней включительно",
);
export type ChannelSnapshotInputT = z.infer<typeof ChannelSnapshotInput>;
const Hash=z.string().regex(/^[a-f0-9]{64}$/);
export const ChannelSnapshotSend=SnapshotFields.extend({previewHash:Hash}).strict().refine(v=>ChannelSnapshotInput.safeParse({title:v.title,startDate:v.startDate,endDate:v.endDate}).success,"Некорректный период сводки");
const SnapshotChannel=z.object({id:z.string().regex(/^UC[\w-]{22}$/),title:z.string().max(300)}).strict();
const Params=z.object({ids:z.string().regex(/^channel==UC[\w-]{22}$/),startDate:Day,endDate:Day,dimensions:z.literal("day"),metrics:z.literal("views,estimatedMinutesWatched,subscribersGained,subscribersLost"),sort:z.literal("day"),maxResults:z.literal("366"),startIndex:z.literal("1")}).strict();
const PreviewBody=z.object({selection:SnapshotFields,channel:SnapshotChannel,connectionHash:Hash,request:z.object({method:z.literal("GET"),url:z.literal("https://youtubeanalytics.googleapis.com/v2/reports"),params:Params}).strict()}).strict();
const Preview=PreviewBody.extend({hash:Hash}).strict();
export type ChannelSnapshotPreview=z.infer<typeof Preview>;
const previewHash=(p:z.infer<typeof PreviewBody>)=>crypto.createHash("sha256").update(JSON.stringify(PreviewBody.parse({selection:p.selection,channel:p.channel,connectionHash:p.connectionHash,request:p.request}))).digest("hex");
function paramsOf(input:ChannelSnapshotInputT,channelId:string):z.infer<typeof Params>{return {ids:`channel==${channelId}`,startDate:input.startDate,endDate:input.endDate,dimensions:"day",metrics:"views,estimatedMinutesWatched,subscribersGained,subscribersLost",sort:"day",maxResults:"366",startIndex:"1"};}
function validPreview(p:ChannelSnapshotPreview){return ChannelSnapshotInput.safeParse(p.selection).success&&p.hash===previewHash(p)&&JSON.stringify(p.request.params)===JSON.stringify(paramsOf(p.selection,p.channel.id));}
export async function previewChannelSnapshot(raw:ChannelSnapshotInputT):Promise<ChannelSnapshotPreview>{
 const selection=ChannelSnapshotInput.parse(raw),yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
 if(selection.endDate>yesterday)throw new ApiError("VALIDATION","Выберите период не позднее вчерашнего дня UTC. Недавние данные API всё равно могут быть неполными.",400);
 const {channel,connectionHash}=await channelSnapshotConnection();
 const body=PreviewBody.parse({selection,channel,connectionHash,request:{method:"GET",url:"https://youtubeanalytics.googleapis.com/v2/reports",params:paramsOf(selection,channel.id)}});
 return {...body,hash:previewHash(body)};
}
const Num = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Signed = z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).int();
const Row = z.object({ day: Day, views: Num.int().nullable(), minutes: Num.nullable(), gained: Num.int().nullable(), lost: Num.int().nullable() }).strict();
const Stored = z.object({
 version: z.union([z.literal(1),z.literal(2)]), request: Preview.optional(), id: Id, createdAt: z.string().datetime(), title: z.string().max(120),
 channel: z.object({ id: z.string().regex(/^UC[\w-]{22}$/), title: z.string().max(300) }).strict(),
 requested: z.object({ startDate: Day, endDate: Day }).strict(), source: z.literal("YouTube Analytics API"),
 dimensions: z.literal("day"), metrics: z.tuple([z.literal("views"),z.literal("estimatedMinutesWatched"),z.literal("subscribersGained"),z.literal("subscribersLost")]),
 rows: z.array(Row).max(MAX_ROWS), status: z.enum(["returned","empty"]), mayBeLimited: z.boolean(),
 totals: z.object({ returnedViews: Num.int().nullable(), returnedMinutes: Num.nullable(), returnedGained: Num.int().nullable(), returnedLost: Num.int().nullable(), returnedNet: Signed.nullable() }).strict(),
 warnings: z.array(z.string().max(1000)).max(20),
}).strict().superRefine((v,c) => {
 if(v.version===1&&v.request!==undefined||v.version===2&&!v.request)c.addIssue({code:"custom",message:"Версия и сохранённый запрос не согласованы"});
 if(v.request&&(!validPreview(v.request)||JSON.stringify(v.request.channel)!==JSON.stringify(v.channel)||v.request.selection.startDate!==v.requested.startDate||v.request.selection.endDate!==v.requested.endDate||(v.request.selection.title||"Сводка канала")!==v.title))c.addIssue({code:"custom",message:"Сохранённый запрос не совпадает со снимком"});
 if (!ChannelSnapshotInput.safeParse({title:v.title,...v.requested}).success) c.addIssue({code:"custom",message:"Некорректный период"});
 if (v.rows.some((x,i) => x.day<v.requested.startDate || x.day>v.requested.endDate || i>0 && x.day<=v.rows[i-1].day)) c.addIssue({code:"custom",message:"Некорректный порядок или дата строк"});
 if (v.status !== (v.rows.length ? "returned":"empty") || v.mayBeLimited !== (v.rows.length===MAX_ROWS)) c.addIssue({code:"custom",message:"Некорректный статус"});
 if (JSON.stringify(totalsOf(v.rows))!==JSON.stringify(v.totals)) c.addIssue({code:"custom",message:"Суммы не совпадают со строками"});
});
export type ChannelSnapshotRun = z.infer<typeof Stored>;
type RawReport = { columnHeaders?: { name: string }[]; rows?: unknown[][] };
function value(v:unknown,integer=false):number|null {
 if(typeof v!=="number"||!Number.isFinite(v)||v<0||v>Number.MAX_SAFE_INTEGER||integer&&!Number.isSafeInteger(v))return null;
 return v;
}
function sum(xs:(number|null)[],integer=false):number|null {return !xs.length||xs.some(x=>x===null)?null:value(xs.reduce<number>((a,b)=>a+b!,0),integer);}
function totalsOf(rows:z.infer<typeof Row>[]){
 const returnedGained=sum(rows.map(x=>x.gained),true),returnedLost=sum(rows.map(x=>x.lost),true);
 return {returnedViews:sum(rows.map(x=>x.views),true),returnedMinutes:sum(rows.map(x=>x.minutes)),returnedGained,returnedLost,returnedNet:returnedGained===null||returnedLost===null?null:returnedGained-returnedLost};
}
export function normalizeChannelSnapshot(input:ChannelSnapshotInputT,channel:ChannelSnapshotRun["channel"],raw:RawReport,now=new Date()):ChannelSnapshotRun {
 input=ChannelSnapshotInput.parse(input);
 const names=Array.isArray(raw?.columnHeaders)?raw.columnHeaders.map(x=>x?.name):undefined;
 const expected=["day","views","estimatedMinutesWatched","subscribersGained","subscribersLost"];
 if (!names || new Set(names).size!==names.length || !expected.every(n=>names.includes(n)) || raw.rows!==undefined&&!Array.isArray(raw.rows)) throw new ApiError("UPSTREAM","Неожиданные столбцы сводки канала YouTube. Отчёт не сохранён.",502);
 const rows=raw.rows??[];
 if(rows.length>MAX_ROWS) throw new ApiError("UPSTREAM","Ответ сводки канала превысил предел 366 строк. Отчёт не сохранён.",502);
 const seen=new Set<string>();
 const projected=rows.map(r=>{
  if(!Array.isArray(r)||r.length!==names.length) throw new ApiError("UPSTREAM","Повреждённая строка сводки канала. Отчёт не сохранён.",502);
  const day=r[names.indexOf("day")];
  if(!Day.safeParse(day).success || typeof day!=="string" || day<input.startDate || day>input.endDate || seen.has(day)) throw new ApiError("UPSTREAM","Некорректная, повторная или выходящая за период дата сводки канала. Отчёт не сохранён.",502);
  seen.add(day);
  return {day,views:value(r[names.indexOf("views")],true),minutes:value(r[names.indexOf("estimatedMinutesWatched")]),gained:value(r[names.indexOf("subscribersGained")],true),lost:value(r[names.indexOf("subscribersLost")],true)};
 }).sort((a,b)=>a.day.localeCompare(b.day));
 const warnings=[
  "Суммы относятся только к возвращённым дневным строкам. Отсутствующие дни и значения неизвестны, а не нулевые. Это не подтверждённый итог всего периода.",
  "Подписки: приобретённые минус потерянные за возвращённые дни, не текущее число подписчиков. Это не CTR, показы или результат A/B.",
  "Первые и последние возвращённые даты не гарантируют полноту или свежесть. YouTube может задерживать данные; часовой пояс Настроек не применяется.",
  "Панель использует один последний снимок на ID канала и точный запрошенный период. Даже одинаковые периоды могут иметь разное покрытие. Итоги каналов не складываются, победитель и рост не определяются.",
  "Приватная аналитика: экспорт и общий ZIP передавайте только доверенным получателям. Финансовые данные, токены и секреты не включены в этот снимок.",
 ];
 if(!projected.length) warnings.push("API не вернул строки. Это не означает нулевую активность канала.");
 if(projected.some(x=>x.views===null||x.minutes===null||x.gained===null||x.lost===null)) warnings.push("Часть чисел отсутствует или некорректна: соответствующие неполные суммы не вычислены.");
 const days=1+(Date.parse(input.endDate)-Date.parse(input.startDate))/86400000;
 if(projected.length<days) warnings.push("Не все запрошенные дни возвращены; пропуски не заполнялись нулями.");
 if(projected.length===MAX_ROWS) warnings.push("Достигнут предел 366 строк. Следующие страницы не загружались.");
 return Stored.parse({version:1,id:crypto.randomUUID(),createdAt:now.toISOString(),title:input.title||"Сводка канала",channel,
 requested:{startDate:input.startDate,endDate:input.endDate},source:"YouTube Analytics API",dimensions:"day",metrics:["views","estimatedMinutesWatched","subscribersGained","subscribersLost"],rows:projected,status:projected.length?"returned":"empty",mayBeLimited:projected.length===MAX_ROWS,
 totals:totalsOf(projected),warnings});
}
export async function saveChannelSnapshot(raw:z.infer<typeof ChannelSnapshotSend>,signal?:AbortSignal) {
 return withTaskSignal(signal,async()=>{
  checkCancelled();const d=ChannelSnapshotSend.parse(raw),input=ChannelSnapshotInput.parse({title:d.title,startDate:d.startDate,endDate:d.endDate}),preview=await previewChannelSnapshot(input);
  if(preview.hash!==d.previewHash)throw new ApiError("VALIDATION","Канал, подключение или параметры сводки изменились. Обновите предпросмотр перед запросом.",409);
  checkCancelled();const {channel,result}=await channelSnapshotSource(input,preview.connectionHash);checkCancelled();
  if(JSON.stringify(channel)!==JSON.stringify(preview.channel))throw new ApiError("VALIDATION","Канал изменился во время запроса. Обновите предпросмотр.",409);
  const run=Stored.parse({...normalizeChannelSnapshot(input,channel,result),version:2,request:preview});
  await checkDir();await fs.mkdir(dataPath(DIR),{recursive:true,mode:0o700});
  const dest=dataPath(DIR,`${run.id}.json`),tmp=dest+".tmp";let committed=false;
  try{checkCancelled();await fs.writeFile(tmp,JSON.stringify(run,null,2),{flag:"wx",mode:0o600});checkCancelled();await fs.rename(tmp,dest);committed=true;checkCancelled();}
  catch(e){if(committed)await fs.rm(dest,{force:true});throw e;}
  finally{await fs.rm(tmp,{force:true});}
  return run;
 });
}
async function checkDir() {
  try { const st = await fs.lstat(dataPath(DIR)); if (!st.isDirectory() || st.isSymbolicLink()) throw new ApiError("VALIDATION", "Папка сводки канала должна быть обычной папкой, не ссылкой"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
}
export async function loadChannelSnapshot(id: string) {
  Id.parse(id); await checkDir(); const file = dataPath(DIR, `${id}.json`);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE) throw new ApiError("VALIDATION", "Некорректный файл отчёта сводки канала");
    const parsed = Stored.safeParse(JSON.parse(await fs.readFile(file, "utf8")));
    if (!parsed.success || parsed.data.id !== id) throw new ApiError("VALIDATION", "Файл сводки канала повреждён или имеет другую версию");
    return parsed.data;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (e instanceof SyntaxError) throw new ApiError("VALIDATION", "Файл сводки канала содержит повреждённый JSON");
    throw e;
  }
}
export function channelBrief(r:ChannelSnapshotRun){return {id:r.id,title:r.title,createdAt:r.createdAt,channel:r.channel,requested:r.requested,status:r.status,mayBeLimited:r.mayBeLimited,totals:r.totals,coverage:{returnedDays:r.rows.length,requestedDays:1+(Date.parse(r.requested.endDate)-Date.parse(r.requested.startDate))/86400000,firstDay:r.rows[0]?.day??null,lastDay:r.rows.at(-1)?.day??null}};}
type Brief=ReturnType<typeof channelBrief>;
async function scan(){
 await checkDir();let files:string[];
 try{files=(await fs.readdir(dataPath(DIR))).filter(f=>/^[0-9a-f-]{36}\.json$/i.test(f));}
 catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return {items:[] as Brief[],warnings:[] as string[]};throw e;}
 if(files.length>5000)throw new ApiError("VALIDATION","История сводок каналов превышает предел сканирования 5000 файлов. Сохраните резервную копию и обслужите папку вручную.",413);
 const items:Brief[]=[];let skipped=0;
 for(const f of files){try{const r=await loadChannelSnapshot(f.slice(0,-5));if(r)items.push(channelBrief(r));else skipped++;}catch{skipped++;}}
 items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
 return {items,warnings:skipped?[`Пропущено недоступных или повреждённых файлов: ${skipped}. Они не удалены.`]:[]};
}
export async function listChannelSnapshot(){const all=await scan();return {items:all.items.slice(0,50),warnings:all.warnings};}
export async function channelCatalog(){
 const all=await scan(),periods=new Map<string,{startDate:string;endDate:string;channels:Set<string>}>();
 for(const r of all.items){const key=r.requested.startDate+":"+r.requested.endDate;if(!periods.has(key))periods.set(key,{...r.requested,channels:new Set()});periods.get(key)!.channels.add(r.channel.id);}
 const sorted=[...periods.values()].sort((a,b)=>b.endDate.localeCompare(a.endDate)||b.startDate.localeCompare(a.startDate));
 return {periods:sorted.slice(0,100).map(p=>({startDate:p.startDate,endDate:p.endDate,channelCount:p.channels.size})),totalPeriods:sorted.length,warnings:[...all.warnings,...(sorted.length>100?["Показаны последние 100 периодов. Другой точный период можно ввести вручную в панели."]:[])]};
}
export const ChannelPeriod=z.object({startDate:Day,endDate:Day}).strict().refine(v=>ChannelSnapshotInput.safeParse({...v,title:""}).success,"Некорректный период панели: до 366 дней");
export function buildChannelBoard(items:Brief[],requested:z.infer<typeof ChannelPeriod>,warnings:string[]=[],now=new Date()){
 requested=ChannelPeriod.parse(requested);
 const filtered=items.filter(r=>r.requested.startDate===requested.startDate&&r.requested.endDate===requested.endDate).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
 const channels=new Map<string,Brief>();for(const r of filtered)if(!channels.has(r.channel.id))channels.set(r.channel.id,r);
 const sorted=[...channels.values()].sort((a,b)=>a.channel.title.localeCompare(b.channel.title)||a.channel.id.localeCompare(b.channel.id));
 return {version:1 as const,readAt:now.toISOString(),requested,items:sorted.slice(0,50),totalChannels:sorted.length,warnings:[...warnings,"Показан один последний сохранённый снимок на ID канала за точный запрошенный период. Это локальное чтение, не обновление Google. Покрытие дней и даты сохранения могут различаться; итоги каналов не суммируются.",...(sorted.length>50?["Показаны первые 50 каналов по названию из "+sorted.length+". Панель неполная, старые файлы не удалены."]:[])]};
}
export async function channelBoard(requested:z.infer<typeof ChannelPeriod>){ChannelPeriod.parse(requested);const all=await scan();return buildChannelBoard(all.items,requested,all.warnings);}
