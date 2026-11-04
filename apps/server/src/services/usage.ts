import {z} from "zod";
import fs from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {log} from "../lib/logging.js";
import {operationCost,PriceSnapshotSchema,OperationVolumeSchema,type PriceSnapshot,type OperationVolume} from "./usagePricing.js";
import { dataPath, readJson, writeJson } from "../lib/storage.js";
import { ApiError } from "../lib/errors.js";
import { getSettings, type Settings } from "./settings.js";

export type CostOperation={id:string;completedAt:string;month:string;price:PriceSnapshot;volume:OperationVolume;usd:number|null;balanceTokens:number|null;jobId?:string};
type Counters={llm:Usage["llm"];images?:Record<string,number>;am?:Record<string,number>};
type Usage = {
  pricingV1?:{legacy:Counters;operations:CostOperation[]};
  month: string;
  youtubeUnits: Record<string, number>;
  /** день → слот ключа → единицы */
  youtubeByKey?: Record<string, Record<string, number>>;
  llm: Record<string, { in: number; out: number; calls: number }>;
  images?: Record<string, number>;
  /** AnyModel: списано балансовых токенов по моделям (+ "web-search") */
  am?: Record<string, number>;
};
const FILE = "usage.json";
const month = () => new Date().toISOString().slice(0, 7);
// день квоты YouTube — по тихоокеанскому времени (сброс в 10:00 МСК)
const ytDay = () => new Date(Date.now() - 7 * 3600_000).toISOString().slice(0, 10);
const empty = (): Usage => ({ month: month(), youtubeUnits: {}, llm: {}, images: {} });

let q: Promise<void> = Promise.resolve();
const mutate = (fn: (u: Usage) => void) => (q = q.then(async () => {
  let u = await readLedger();
  if (u.month !== month()) u = empty();
  fn(u); await writeJson(FILE, u);
}).catch(() => {}));

export const addYoutubeUnits = (n: number, slot = "youtube") => mutate((u) => { const d = ytDay(); u.youtubeUnits[d] = (u.youtubeUnits[d] ?? 0) + n; const k = ((u.youtubeByKey ??= {})[d] ??= {}); k[slot] = (k[slot] ?? 0) + n; });
export { ytDay };
// Compatibility counters remain estimates; never fold a new captured operation back into this baseline.
function legacyTargets(u:Usage):Counters[]{return u.pricingV1?[u,u.pricingV1.legacy]:[u];}
export const addLlmUsage = (model: string, input: number, output: number) => mutate((u) => {
 for(const t of legacyTargets(u)){const r=(t.llm[model]??={in:0,out:0,calls:0});r.in+=input;r.out+=output;r.calls++;}
});
export const addImageUsage = (model: string, n = 1, amTokens?: number) => mutate((u) => {
 for(const t of legacyTargets(u)){(t.images??={})[model]=(t.images?.[model]??0)+n;if(amTokens)(t.am??={})[model]=(t.am?.[model]??0)+amTokens;}
});
export const addAmTokens = (model: string, tokens: number) => mutate((u) => {for(const t of legacyTargets(u))(t.am??={})[model]=(t.am?.[model]??0)+tokens;});
/** Legacy built-in web-search estimate. */
export const addSearchUsage = (n: number) => addAmTokens("web-search", n * 40_000);

/** Цена модели: первая строка таблицы, чья подстрока входит в имя модели (порядок важен: flash-lite раньше flash) */
export function priceFor(model: string, prices: Settings["budget"]["prices"]) {
  const m = model.toLowerCase();
  return prices.find((p) => m.includes(p.match.toLowerCase()));
}
export function costOf(u: Pick<Usage, "llm" | "images" | "am">, prices: Settings["budget"]["prices"], usdPerMillion = 0.05) {
  const am = u.am ?? {};
  const amUsd = (m: string) => (am[m] ?? 0) * usdPerMillion / 1e6;
  const rows = [
    ...Object.entries(u.llm).map(([model, r]) => {
      if (model in am) return { model, kind: "text" as const, calls: r.calls, in: r.in, out: r.out, usd: amUsd(model), priced: true, balanceTokens: am[model], via: "anymodel" as const };
      const p = priceFor(model, prices);
      return { model, kind: "text" as const, calls: r.calls, in: r.in, out: r.out, usd: p ? (r.in * p.input + r.out * p.output) / 1e6 : null, priced: !!p, via: "direct" as const };
    }),
    ...Object.entries(u.images ?? {}).map(([model, n]) => {
      if (model in am) return { model, kind: "image" as const, calls: n, in: 0, out: 0, usd: amUsd(model), priced: true, balanceTokens: am[model], via: "anymodel" as const };
      const p = priceFor(model, prices);
      return { model, kind: "image" as const, calls: n, in: 0, out: 0, usd: p ? n * p.image : null, priced: !!p, via: "direct" as const };
    }),
    ...(am["web-search"] ? [{ model: "web-search", kind: "search" as const, calls: Math.round(am["web-search"] / 40_000), in: 0, out: 0, usd: amUsd("web-search"), priced: true, balanceTokens: am["web-search"], via: "anymodel" as const }] : []),
  ].sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  const balanceTokens = Object.values(am).reduce((s, n) => s + n, 0);
  const knownTotalRaw = rows.reduce((sum, row) => sum + (row.usd ?? 0), 0);
  const unknownRows = rows.filter(row => !row.priced).length;
  // Display rounding is never used to determine a budget boundary.
  const knownTotal = Math.round(knownTotalRaw * 10000) / 10000;
  return { rows, total: unknownRows ? null : knownTotal, knownTotal, knownTotalRaw,
    complete: unknownRows === 0, unknownRows, valuation: "current-rate-estimate" as const, balanceTokens };
}

const Counter=z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const CountersSchema=z.object({llm:z.record(z.string().max(300),z.object({in:Counter,out:Counter,calls:Counter})),images:z.record(z.string().max(300),Counter).optional(),am:z.record(z.string().max(300),Counter).optional()});
export const OperationSchema=z.object({id:z.string().uuid(),completedAt:z.string().datetime(),month:z.string().regex(/^\d{4}-\d{2}$/),price:PriceSnapshotSchema,volume:OperationVolumeSchema,usd:Counter.nullable(),balanceTokens:Counter.nullable(),jobId:z.string().max(300).optional()}).strict().refine(op=>op.month===op.completedAt.slice(0,7)&&op.price.capturedAt<=op.completedAt&&JSON.stringify(operationCost(op.price,op.volume))===JSON.stringify({usd:op.usd,balanceTokens:op.balanceTokens}),'Inconsistent captured cost');
const LedgerSchema=CountersSchema.extend({month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),youtubeUnits:z.record(z.string(),Counter),youtubeByKey:z.record(z.string(),z.record(z.string(),Counter)).optional(),pricingV1:z.object({legacy:CountersSchema,operations:z.array(OperationSchema).max(10000)}).strict().optional()});
export function validateLedger(raw:unknown):Usage{const u=LedgerSchema.parse(raw);if(u.pricingV1&&(u.pricingV1.operations.some(o=>o.month!==u.month)||new Set(u.pricingV1.operations.map(o=>o.id)).size!==u.pricingV1.operations.length))throw Error('Duplicate operation');return u;}
async function readLedger():Promise<Usage>{try{const file=dataPath(FILE);if((await fs.stat(file)).size>8*1024*1024)throw Error('Ledger capacity');return validateLedger(JSON.parse(await fs.readFile(file,'utf8')));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return empty();throw new ApiError('VALIDATION','Журнал расходов повреждён или превышает лимит. Данные не заменены нулём; восстановите копию и не повторяйте генерацию ради учёта.');}}

// Completed successful calls are recorded independently of their aggregated model ID.
// Pending writes are retried ONLY as filesystem accounting, never by repeating generation.
const pendingOperations:CostOperation[]=[];
let accountingFailure=false;
let unretainedAccountingFailure=false;
export async function recordOperation(price:PriceSnapshot,volume:OperationVolume,jobId?:string):Promise<boolean>{
 const completedAt=new Date().toISOString();let captured:PriceSnapshot,units:OperationVolume;
 try{captured=PriceSnapshotSchema.parse(structuredClone(price));units=OperationVolumeSchema.parse(structuredClone(volume));}catch{accountingFailure=true;unretainedAccountingFailure=true;log.warn({event:'usage_accounting_invalid'});return false;}
 const op:CostOperation={id:randomUUID(),completedAt,month:completedAt.slice(0,7),price:captured,volume:units,...operationCost(captured,units),...(jobId?{jobId}:{})};
 if(pendingOperations.length>=10000){accountingFailure=true;unretainedAccountingFailure=true;log.warn({event:"usage_pending_capacity"});return false;}
 pendingOperations.push(op);
 await retryUsageAccounting();
 return !pendingOperations.some(p=>p.id===op.id);
}
/** Local filesystem retry only. Never dispatches a provider request. */
export async function retryUsageAccounting():Promise<boolean>{
 const write=q.then(async()=>{
  const due=pendingOperations.filter(p=>p.month===month());if(!due.length){accountingFailure=unretainedAccountingFailure||pendingOperations.length>0;return;}
  let u=await readLedger();
  if(u.month!==month())u=empty();
  u.pricingV1??={legacy:structuredClone({llm:u.llm,images:u.images??{},am:u.am??{}}),operations:[]};
  if(!Array.isArray(u.pricingV1.operations)||!u.pricingV1.legacy)throw Error('Invalid priced ledger');
  if(u.pricingV1.operations.length+due.length>10000)throw Error('Priced ledger capacity');
  const ids=new Set(u.pricingV1.operations.map(p=>p.id));
  for(const entry of due){if(ids.has(entry.id))continue;ids.add(entry.id);u.pricingV1.operations.push(entry);const m=entry.price.model,v=entry.volume;
   if(entry.price.kind==='text'||entry.price.kind==='audio'){const row=(u.llm[m]??={in:0,out:0,calls:0});row.in+=v.input??0;row.out+=v.output??0;row.calls++;}
   if(entry.price.kind==='image')(u.images??={})[m]=(u.images?.[m]??0)+(v.count??1);
   if(entry.balanceTokens!==null)(u.am??={})[m]=(u.am?.[m]??0)+entry.balanceTokens;
  }
  if(Buffer.byteLength(JSON.stringify(u,null,2))>8*1024*1024)throw Error('Priced ledger byte capacity');
  await writeJson(FILE,u);
  for(const entry of due){const i=pendingOperations.findIndex(p=>p.id===entry.id);if(i>=0)pendingOperations.splice(i,1);}
  accountingFailure=unretainedAccountingFailure||pendingOperations.length>0;
 });
 q=write.catch(()=>{});
 try{await write;return !accountingFailure;}catch{accountingFailure=true;log.warn({event:'usage_accounting_failed',pending:pendingOperations.length});return false;}
}
export function operationTotals(u:Usage,prices:Settings["budget"]["prices"],usdPerMillion:number){
 const old=costOf(u.pricingV1?.legacy??u,prices,usdPerMillion);
 const fixed=u.pricingV1?.operations??[];
 const rows=[...old.rows.map(r=>({...r,valuation:'current-rate-estimate' as const})),...fixed.map(op=>({model:op.price.model,kind:op.price.kind,calls:op.volume.count??1,in:op.volume.input??0,out:op.volume.output??0,usd:op.usd,priced:op.usd!==null,via:op.price.provider==='anymodel'?'anymodel' as const:'direct' as const,provider:op.price.provider,operationId:op.id,balanceTokens:op.balanceTokens??undefined,valuation:'captured-tariff' as const}))].sort((a,b)=>(b.usd??-1)-(a.usd??-1));
 const knownTotalRaw=rows.reduce((sum,r)=>sum+(r.usd??0),0),knownTotal=Math.round(knownTotalRaw*10000)/10000;
 const unknownRows=rows.filter(r=>r.usd===null).length,complete=unknownRows===0&&!accountingFailure;
 return {rows,total:complete?knownTotal:null,knownTotal,knownTotalRaw,complete,unknownRows,valuation:fixed.length?(old.rows.length?'mixed-estimate-and-captured' as const:'captured-tariff' as const):'current-rate-estimate' as const,legacyRows:old.rows.length,recordedOperations:fixed.length,accountingWarning:accountingFailure?'Не удалось записать часть выполненных операций. Не повторяйте генерацию ради журнала. До перезапуска сохраните данные; незаписанные записи могут удерживаться только в памяти; при некорректных данных или переполнении нужна ручная сверка.':null,pendingOperations:pendingOperations.length,balanceTokens:Object.values(u.am??{}).reduce((sum,n)=>sum+n,0)};
}

export type BudgetLevel = "off" | "ok" | "warn" | "over";
export async function getUsage() {
  await q;
  let u = await readLedger();
  if (u.month !== month()) u = empty();
  const s = await getSettings();
  const cost = operationTotals(u, s.budget.prices, s.anymodel.usdPerMillion);
  const limit = s.budget.monthlyUsd;
  const pct = limit > 0 ? (cost.knownTotalRaw / limit) * 100 : 0;
  const level: BudgetLevel = limit <= 0 ? "off" : cost.knownTotalRaw >= limit ? "over" : pct >= s.budget.warnPct ? "warn" : "ok";
  return { ...u, youtubeToday: u.youtubeUnits[ytDay()] ?? 0, youtubeTodayByKey: u.youtubeByKey?.[ytDay()] ?? {}, cost, budget: { limitUsd: limit, spentUsd: cost.total, knownSpentUsd: cost.knownTotal, complete: cost.complete, unknownRows: cost.unknownRows, pct, level, mode: s.budget.mode, warnPct: s.budget.warnPct } };
}

/** Early threshold check. Actual tariff/ledger dispatch guard lives in paidDispatch. */
export async function assertBudget() {
  const s = await getSettings();
  if (s.budget.monthlyUsd <= 0 || s.budget.mode !== "block") return;
  const checkAccounting=()=>{if(accountingFailure)throw new ApiError("BUDGET_LIMIT","Журнал расходов записан не полностью. Новый платный вызов в режиме блокировки остановлен; не повторяйте уже выполненную генерацию ради учёта.",402);};
  checkAccounting();
  let usage: Awaited<ReturnType<typeof getUsage>>;
  try { usage = await getUsage(); } catch { throw new ApiError("BUDGET_LIMIT", "Платный запрос не отправлен: журнал расходов недоступен или повреждён. Восстановите резервную копию; ошибка не считается нулевыми расходами.", 402); }
  const { budget } = usage;
  checkAccounting(); // a pending write may have failed while getUsage awaited the queue
  if (budget.level === "over")
    throw new ApiError("BUDGET_LIMIT", `Достигнут месячный лимит расходов $${budget.limitUsd} (потрачено ≈ $${budget.knownSpentUsd.toFixed(2)}). Увеличьте лимит или переключите режим на «только предупреждать» в Настройках → Бюджет.`, 402);
}

/** Strict read for financial scenarios: missing/corrupt ledger is not a known zero. No mutation or month reset. */
export function usageAccountingComplete():boolean { return !accountingFailure && pendingOperations.length===0; }
export async function readUsageSnapshot(): Promise<unknown | null> {
  await q;
  try { if((await fs.stat(dataPath(FILE))).size>8*1024**2)throw Error("Ledger capacity"); const raw: unknown = JSON.parse(await fs.readFile(dataPath(FILE), "utf8")); if (raw === null) throw new Error("Invalid ledger"); return raw; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw new ApiError("VALIDATION", "Журнал расходов не читается или повреждён. Используйте ручной режим; исходный журнал не изменён."); }
}
