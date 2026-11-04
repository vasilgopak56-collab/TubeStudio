import crypto from "node:crypto";
import fs from "node:fs/promises";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { dataPath, readJson, writeJson } from "../lib/storage.js";
const Id = z.string().uuid(), Seconds = z.number().finite().nonnegative().max(1800);
const Stamp = z.string().datetime();
const Fragment = z.object({ n:z.number().int().positive(), start:Seconds, end:Seconds, text:z.string().max(6000).default("") });
const Pause = z.object({ start:Seconds, end:Seconds });
const Source = z.object({ id:Id, name:z.string().max(1000), duration:Seconds.positive(), revision:z.number().int().nonnegative(), updatedAt:Stamp, fragments:z.array(Fragment).max(500), pauses:z.array(Pause).max(500) }).refine(d => d.fragments.every((f,i) => f.n===i+1 && f.end>f.start && f.end<=d.duration+.001 && (i===0 || f.start>=d.fragments[i-1].end)) && d.pauses.every(p=>p.end>=p.start && p.end<=d.duration+.001), "Неверные границы сегментов");
export const AdOptions = z.object({ minPause:z.number().finite().min(.01).max(60).default(.5), intro:Seconds.default(60), outro:Seconds.default(30), minGap:z.number().finite().min(.01).max(1800).default(120), targetCount:z.number().int().min(1).max(20).default(3) }).strict();
export const AdInput = z.object({ audioId:Id, revision:z.number().int().nonnegative(), title:z.string().trim().max(120).default(""), options:AdOptions }).strict();
export const AdSelection = z.object({ id:Id, selectedN:z.array(z.number().int().positive()).max(20) }).strict();
export type AdOptionsT = z.infer<typeof AdOptions>;
export type AdSource = z.infer<typeof Source>;
const Candidate = z.object({ n:z.number().int().positive(), at:Seconds, start:Seconds, end:Seconds, before:z.number().int().positive(), after:z.number().int().positive(), beforeText:z.string().max(160), afterText:z.string().max(160) });
const GapDecision = z.object({before:z.number().int().positive(),after:z.number().int().positive(),reason:z.enum(["candidate","no-positive-gap","no-minimum-overlap","outside-margin","rounding-boundary"]),candidateN:z.number().int().positive().nullable()});
const AutoDecision = z.object({n:z.number().int().positive(),status:z.enum(["selected","target-reached","too-close"]),conflicts:z.array(z.number().int().positive()).max(20)});
const Basis = z.object({algorithm:z.literal("saved-gap-midpoint-greedy-v1"),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),fragments:z.array(Fragment.extend({text:z.string().max(160)})).max(500),pauses:z.array(Pause).max(500),gaps:z.array(GapDecision).max(499),auto:z.array(AutoDecision).max(499),autoSelectedN:z.array(z.number().int().positive()).max(20)});
const Plan = z.object({ version:z.union([z.literal(1),z.literal(2)]),basis:Basis.optional(), id:Id, rootId:Id, parentId:Id.nullable(), createdAt:Stamp, title:z.string().max(120), source:z.object({ id:Id, name:z.string().max(1000), revision:z.number().int().nonnegative(), updatedAt:Stamp, duration:Seconds.positive() }), options:AdOptions, candidates:z.array(Candidate).max(499), selectedN:z.array(z.number().int().positive()).max(20), warnings:z.array(z.string()) });
export type AdBasis = z.infer<typeof Basis>;
export type AdPlan = z.infer<typeof Plan>;
export const AD_WARNINGS = [
  "Локальный план для ручного монтажа, не вставка рекламы. Аудио и YouTube не изменяются, нейросети не вызываются.",
  "Используются сохранённые интервалы между речевыми сегментами. После ручной правки они могут не совпадать с акустической тишиной. Прослушайте каждую точку; завершённость мысли не проверяется.",
  "Таймкоды относятся к оригинальной озвучке. После монтажа со сдвигами проверьте их заново. Доступность рекламы и требования монетизации проверяйте отдельно в YouTube Studio.",
  "Автовыбор — эвристика: сначала самые длинные подходящие интервалы, затем проверка расстояния. Это не оптимизация удержания; точек может быть меньше цели. Все ограничения в секундах — ваши настройки, не правила YouTube."
];
export function adCandidates(raw:AdSource, options:AdOptionsT) {
  const d=Source.parse(raw), o=AdOptions.parse(options), out:AdPlan["candidates"]=[];
  for (let i=1;i<d.fragments.length;i++) {
    const left=d.fragments[i-1],right=d.fragments[i];
    // Only the intersection of a saved pause AND an actual inter-fragment gap is eligible.
    const intervals=d.pauses.map(p=>({start:Math.max(p.start,left.end),end:Math.min(p.end,right.start)})).filter(p=>p.end-p.start+1e-9>=o.minPause).sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.start-b.start);
    const pause=intervals.find(p=>{ const at=Math.round((p.start+p.end)*500)/1000; return at>left.end && at<right.start && at>p.start && at<p.end && at>=o.intro && at<=d.duration-o.outro; });
    if (!pause) continue;
    out.push({n:out.length+1,at:Math.round((pause.start+pause.end)*500)/1000,start:pause.start,end:pause.end,before:left.n,after:right.n,beforeText:left.text.slice(0,160),afterText:right.text.slice(0,160)});
  }
  return out;
}
export function validateAdSelection(candidates:AdPlan["candidates"], selectedN:number[], minGap:number) {
  if (selectedN.length>20 || new Set(selectedN).size!==selectedN.length || selectedN.some(n=>!candidates.some(c=>c.n===n))) throw new ApiError("VALIDATION","Выберите до 20 разных точек из списка кандидатов");
  const points=candidates.filter(c=>selectedN.includes(c.n)).sort((a,b)=>a.at-b.at);
  if (points.some((c,i)=>i>0 && c.at-points[i-1].at+1e-9<minGap)) throw new ApiError("VALIDATION","Выбранные точки расположены ближе минимального интервала");
  return points.map(c=>c.n);
}
/** Saved boundary projection only: no audio bytes or full transcript. Hash is not a signature. */
export function adBasis(raw:AdSource, rawOptions:AdOptionsT):AdBasis {
  const d=Source.parse(raw),options=AdOptions.parse(rawOptions);
  const fragments=d.fragments.map(f=>({...f,text:f.text.slice(0,160)})),pauses=d.pauses;
  const projected=Source.parse({...d,fragments,pauses}),candidates=adCandidates(projected,options);
  const sourceHash=crypto.createHash("sha256").update(JSON.stringify({source:projected,options})).digest("hex");
  const gaps:AdBasis["gaps"]=[];
  for(let i=1;i<fragments.length;i++){
    const left=fragments[i-1],right=fragments[i],candidate=candidates.find(c=>c.before===left.n);
    const intervals=pauses.map(p=>({start:Math.max(p.start,left.end),end:Math.min(p.end,right.start)})).filter(p=>p.end-p.start+1e-9>=options.minPause);
    const interior=intervals.filter(p=>{const at=Math.round((p.start+p.end)*500)/1000;return at>left.end&&at<right.start&&at>p.start&&at<p.end;});
    const reason=candidate?"candidate":right.start<=left.end?"no-positive-gap":!intervals.length?"no-minimum-overlap":!interior.length?"rounding-boundary":"outside-margin";
    gaps.push({before:left.n,after:right.n,reason,candidateN:candidate?.n??null});
  }
  const chosen:typeof candidates=[],auto:AdBasis["auto"]=[];
  for(const c of [...candidates].sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.at-b.at)){
    if(chosen.length>=options.targetCount){auto.push({n:c.n,status:"target-reached",conflicts:[]});continue;}
    const conflicts=chosen.filter(x=>Math.abs(x.at-c.at)+1e-9<options.minGap).map(x=>x.n);
    auto.push({n:c.n,status:conflicts.length?"too-close":"selected",conflicts});
    if(!conflicts.length)chosen.push(c);
  }
  return {algorithm:"saved-gap-midpoint-greedy-v1",sourceHash,fragments,pauses,gaps,auto,autoSelectedN:validateAdSelection(candidates,chosen.map(c=>c.n),options.minGap)};
}
export function makeAdPlan(raw:AdSource, rawOptions:AdOptionsT, title=""):AdPlan {
  const d=Source.parse(raw),options=AdOptions.parse(rawOptions),candidates=adCandidates(d,options),basis=adBasis(d,options);
  const id=crypto.randomUUID();
  return {version:2,basis,id,rootId:id,parentId:null,createdAt:new Date().toISOString(),title:title.trim().slice(0,120)||"План рекламных пауз",source:{id:d.id,name:d.name,revision:d.revision,updatedAt:d.updatedAt,duration:d.duration},options,candidates,selectedN:basis.autoSelectedN,warnings:[...AD_WARNINGS]};
}
async function source(id:string) { if(!Id.safeParse(id).success)return null;const d=Source.safeParse(await readJson<unknown>(`audio-storyboards/${id}.json`,null));return d.success && d.data.id===id ? d.data : null; }
export async function listAdSources() {
  const names=await fs.readdir(dataPath("audio-storyboards")).catch((e:NodeJS.ErrnoException)=>{if(e.code==="ENOENT")return [];throw e;});const rows=[];
  for(const name of names){if(!name.endsWith(".json"))continue;const d=await source(name.slice(0,-5));if(d)rows.push({id:d.id,name:d.name,revision:d.revision,updatedAt:d.updatedAt,duration:d.duration,fragments:d.fragments.length});}
  return rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id)).slice(0,30);
}
export async function saveAdPlan(raw:z.input<typeof AdInput>) {
  const input=AdInput.parse(raw),d=await source(input.audioId);if(!d)throw new ApiError("NOT_FOUND","Аудио не найдено или сохранённые границы повреждены",404);
  if(d.revision!==input.revision)throw new ApiError("VALIDATION","Версия аудио изменилась. Обновите список и выберите файл заново",409);
  if(d.fragments.length<2)throw new ApiError("VALIDATION","Сначала найдите и сохраните хотя бы два речевых сегмента в разделе «Из озвучки»");
  const r=makeAdPlan(d,input.options,input.title);await writeJson(`ad-break-runs/${r.id}.json`,r);return r;
}
export async function loadAdPlan(id:string):Promise<AdPlan|null> {
  if(!Id.safeParse(id).success)return null;const p=Plan.safeParse(await readJson<unknown>(`ad-break-runs/${id}.json`,null));if(!p.success||p.data.id!==id)return null;
  const r=p.data;
  if(r.candidates.some((c,i)=>c.n!==i+1 || !(c.start<c.at && c.at<c.end) || c.end>r.source.duration+.001 || c.at<r.options.intro || c.at>r.source.duration-r.options.outro || c.end-c.start+1e-9<r.options.minPause || c.after!==c.before+1 || i>0 && c.at<=r.candidates[i-1].at))return null;
  try{
    validateAdSelection(r.candidates,r.selectedN,r.options.minGap);
    if(r.version===1&&r.basis)return null;
    if(r.version===2){
      if(!r.basis)return null;
      const projected=Source.parse({...r.source,fragments:r.basis.fragments,pauses:r.basis.pauses});
      if(JSON.stringify(adBasis(projected,r.options))!==JSON.stringify(r.basis)||JSON.stringify(adCandidates(projected,r.options))!==JSON.stringify(r.candidates))return null;
    }
  }catch{return null;}return r;
}
export async function saveAdSelection(raw:z.input<typeof AdSelection>) {
  const input=AdSelection.parse(raw),old=await loadAdPlan(input.id);if(!old)throw new ApiError("NOT_FOUND","План не найден",404);
  const r:AdPlan={...old,id:crypto.randomUUID(),parentId:old.id,createdAt:new Date().toISOString(),selectedN:validateAdSelection(old.candidates,input.selectedN,old.options.minGap)};await writeJson(`ad-break-runs/${r.id}.json`,r);return r;
}
export async function listAdPlans() {
  const names=await fs.readdir(dataPath("ad-break-runs")).catch((e:NodeJS.ErrnoException)=>{if(e.code==="ENOENT")return [];throw e;});const rows=[];
  for(const name of names){if(!name.endsWith(".json"))continue;const r=await loadAdPlan(name.slice(0,-5));if(r)rows.push({id:r.id,title:r.title,createdAt:r.createdAt,sourceName:r.source.name,selected:r.selectedN.length});}
  return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)).slice(0,50);
}
