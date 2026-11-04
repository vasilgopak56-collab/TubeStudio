import crypto from "node:crypto";
import fs from "node:fs/promises";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { dataPath } from "../lib/storage.js";
import { getSettings, type Settings } from "./settings.js";
import { priceFor, readUsageSnapshot, OperationSchema, validateLedger, usageAccountingComplete } from "./usage.js";
const Id = z.string().uuid();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(v + "T00:00:00Z"); return Number.isFinite(+d) && d.toISOString().slice(0, 10) === v; }, "Некорректная дата");
const Money = z.number().finite().min(0).max(1e9);
const base = { title: z.string().trim().max(120).default(""), views: z.number().int().min(0).max(1e12), rpm: z.number().finite().min(0).max(1e6), otherCosts: Money };
export const ProfitInput = z.discriminatedUnion("mode", [
  z.object({ ...base, mode: z.literal("manual"), startDate: Day, endDate: Day, aiCosts: Money }).strict(),
  z.object({ ...base, mode: z.literal("workspace-month"), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict(),
]).refine(v => v.mode !== "manual" || v.startDate <= v.endDate, "Начало периода позже конца");
export type ProfitInputT = z.infer<typeof ProfitInput>;
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const ProfitSaveInput = z.union([
 z.object({...base,mode:z.literal("manual"),startDate:Day,endDate:Day,aiCosts:Money}).strict(),
 z.object({...base,mode:z.literal("workspace-month"),month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),costsHash:Hash}).strict(),
]).refine(v=>v.mode!=="manual"||v.startDate<=v.endDate,"Начало периода позже конца");
export type ProfitSaveInputT=z.infer<typeof ProfitSaveInput>;
const Counter = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const UsageLedger = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), llm: z.record(z.string(), z.object({ in: Counter, out: Counter, calls: Counter })), images: z.record(z.string(), Counter).optional(), am: z.record(z.string(), Counter).optional() });
const Price=z.object({match:z.string().max(300),input:z.number().finite().nonnegative(),output:z.number().finite().nonnegative(),image:z.number().finite().nonnegative()}).strict();
const TextCount=z.object({in:Counter,out:Counter,calls:Counter}).strict();
const LegacyCostBasis=z.object({version:z.literal(1),ledgerMonth:z.string().nullable(),
 amRows:z.array(z.object({model:z.string().max(300),balanceTokens:Counter,usd:Counter,text:TextCount.nullable(),images:Counter.nullable()}).strict()).max(1000),
 directRows:z.array(z.object({model:z.string().max(300),kind:z.enum(["text","image"]),text:TextCount.nullable(),images:Counter.nullable(),price:Price.nullable(),usd:Counter.nullable()}).strict()).max(1000),
}).strict();
const CapturedCostBasis=LegacyCostBasis.extend({version:z.literal(2),operations:z.array(OperationSchema).max(10000),accountingComplete:z.boolean()}).strict().refine(b=>new Set(b.operations.map(o=>o.id)).size===b.operations.length&&b.operations.every(o=>o.month===b.ledgerMonth),"Invalid captured evidence");
const CostBasis=z.union([LegacyCostBasis,CapturedCostBasis]);
export type CostBasisT=z.infer<typeof CostBasis>;
export type WorkspaceCosts = {
  costBasis?: CostBasisT; reviewHash?:string;
  month: string; asOf: string; periodStart: string; periodEnd: string; coverage: "recorded" | "missing" | "stale";
  rateUsdPerMillion: number; amBalanceTokens: number | null; amUsd: number | null;
  directRows: { model: string; kind: "text" | "image"; usd: number | null }[];
  directKnownUsd: number; knownAiUsd: number | null; complete: boolean; warnings: string[];
};
function finishCosts(out:WorkspaceCosts):WorkspaceCosts {
 out.reviewHash=costsHash(out);return out;
}
function costsHash(w:WorkspaceCosts){return crypto.createHash("sha256").update(JSON.stringify([w.month,w.periodStart,w.periodEnd,w.coverage,w.rateUsdPerMillion,w.amBalanceTokens,w.amUsd,w.directRows,w.directKnownUsd,w.knownAiUsd,w.complete,w.warnings,w.costBasis?CostBasis.parse(w.costBasis):null])).digest("hex");}
const sum = (a: number[]) => a.reduce((s,n) => s+n, 0);
function bounded(n: number) { if (!Number.isFinite(n) || n > Number.MAX_SAFE_INTEGER || n < 0) throw new ApiError("VALIDATION", "Сумма расходов вне допустимого диапазона. Проверьте журнал и ставки."); return n; }
/** Pure accounting: every balance-token entry is counted once, including TTS/search/orphan entries. */
export function workspaceCosts(raw: unknown | null, s: Pick<Settings, "budget" | "anymodel">, now = new Date(), accountingComplete = true): WorkspaceCosts {
  const asOf = now.toISOString(), month = asOf.slice(0,7), rate = s.anymodel.usdPerMillion;
  if (!Number.isFinite(rate) || rate < 0) throw new ApiError("VALIDATION", "Некорректная цена балансовых токенов в Настройках");
  const out: WorkspaceCosts = { month, asOf, periodStart: month + "-01", periodEnd: asOf.slice(0,10), coverage: "recorded", rateUsdPerMillion: rate, amBalanceTokens: null, amUsd: null, directRows: [], directKnownUsd: 0, knownAiUsd: null, complete: false,
    costBasis:{version:1,ledgerMonth:null,amRows:[],directRows:[]}, warnings: ["Расходы относятся ко всей установке TubeStudio за текущий месяц UTC до момента снимка, не к отдельному ролику, каналу или проекту. Введите просмотры за тот же период и охват.", "Журнал содержит только записанные программой операции, а не счёт провайдера. Балансовые токены могут оцениваться локально по коэффициентам, а не подтверждать фактическое списание. Внешние траты, пропущенные списания и налоги добавьте вручную. Ставки берутся из текущих настроек, не исторических тарифов."] };
  if (raw === null) { out.coverage = "missing"; out.warnings.push("Журнал usage.json отсутствует: расходы неизвестны, не нулевые. Итог не рассчитывается; можно использовать ручной режим."); return finishCosts(out); }
  if ((typeof raw === "object" && raw !== null && Object.hasOwn(raw, "pricingV1")) || !accountingComplete) {
    let ledger;
    try { ledger=validateLedger(raw); } catch { throw new ApiError("VALIDATION","Журнал расходов содержит некорректные операции или суммы. Данные не изменены и не заменены нулём."); }
    const legacy=ledger.pricingV1?.legacy??{llm:ledger.llm,images:ledger.images,am:ledger.am};
    // Compatibility aggregates include new operations; only the frozen legacy baseline is valued here.
    const legacySettings=Object.keys(legacy.am??{}).length?s:{...s,anymodel:{...s.anymodel,usdPerMillion:0}};
    const result=workspaceCosts({month:ledger.month,...legacy},legacySettings,now);
    if(result.coverage!=="recorded")return result;
    const operations=structuredClone(ledger.pricingV1?.operations??[]).sort((a,b)=>a.completedAt.localeCompare(b.completedAt)||a.id.localeCompare(b.id));
    const capturedKnown=bounded(sum(operations.map(o=>o.usd??0))),unknown=operations.filter(o=>o.usd===null).length;
    result.costBasis={...result.costBasis!,version:2,operations,accountingComplete};
    result.knownAiUsd=bounded(result.knownAiUsd!+capturedKnown);
    result.complete=result.complete&&unknown===0&&accountingComplete;
    result.warnings=result.warnings.filter(w=>!w.startsWith("В журнале нет учтённой активности.")||operations.length===0);
    if(!result.costBasis.amRows.length&&!result.costBasis.directRows.length)result.warnings=result.warnings.filter(w=>!w.startsWith("Старый журнал")&&!w.includes("Ставки берутся из текущих настроек"));
    result.warnings.push("Новые операции оценены по тарифу, сохранённому до вызова. Текущие настройки их не переоценивают. Старые строки, если есть, остаются оценкой по ставкам на момент чтения. Это локальный учёт, не счёт провайдера.");
    if(unknown)result.warnings.push(`Операций с неизвестной стоимостью: ${unknown}. Неизвестное не равно нулю; прибыль не рассчитывается.`);
    if(!accountingComplete)result.warnings.push("Часть выполненных операций не записана. Итог расходов неизвестен; повторяйте только локальную запись журнала, не генерацию.");
    return finishCosts(result);
  }
  const parsed = UsageLedger.safeParse(raw);
  if (!parsed.success) throw new ApiError("VALIDATION", "Журнал расходов содержит некорректные значения. Используйте ручной режим; журнал не изменён.");
  const u = parsed.data;
  if(Object.keys(u.llm).length+Object.keys(u.images??{}).length+Object.keys(u.am??{}).length>1000||[...Object.keys(u.llm),...Object.keys(u.images??{}),...Object.keys(u.am??{})].some(x=>x.length>300))throw new ApiError("VALIDATION","Журнал содержит слишком много строк или слишком длинные ID. Используйте ручной режим; данные не усечены.");
  out.costBasis!.ledgerMonth=u.month;
  if (u.month !== month) { out.coverage = "stale"; out.warnings.push(`Журнал относится к ${u.month}, а не ${month}. Расходы текущего месяца неизвестны; журнал не сбрасывается. Используйте ручной режим.`); return finishCosts(out); }
  const am = u.am ?? {};
  for(const model of Object.keys(am).sort())out.costBasis!.amRows.push({model,balanceTokens:am[model],usd:bounded(am[model]*rate/1e6),text:u.llm[model]??null,images:u.images?.[model]??null});
  // Sum in the same canonical order used by saved evidence and validation.
  // Floating-point addition is not associative; insertion order must not invalidate our own snapshot.
  out.amBalanceTokens = bounded(sum(out.costBasis!.amRows.map(r=>r.balanceTokens))); out.amUsd = bounded(out.amBalanceTokens * rate / 1e6);
  for (const [model, r] of Object.entries(u.llm).sort(([a],[b])=>a.localeCompare(b))) {
    if (Object.hasOwn(am, model)) continue; // recorded balance-token estimates take precedence, no double counting
    const p = priceFor(model, s.budget.prices), hasActivity = r.in > 0 || r.out > 0 || r.calls > 0;
    const usd = !hasActivity ? 0 : p ? (r.in * p.input + r.out * p.output) / 1e6 : null;
    out.directRows.push({ model, kind: "text", usd: usd === null ? null : bounded(usd) });
    out.costBasis!.directRows.push({model,kind:"text",text:r,images:null,price:p?Price.parse(p):null,usd:usd===null?null:bounded(usd)});
  }
  for (const [model,n] of Object.entries(u.images ?? {}).sort(([a],[b])=>a.localeCompare(b))) {
    if (Object.hasOwn(am, model)) continue;
    const p = priceFor(model, s.budget.prices), usd = n === 0 ? 0 : p ? n * p.image : null;
    out.directRows.push({ model, kind: "image", usd: usd === null ? null : bounded(usd) });
    out.costBasis!.directRows.push({model,kind:"image",text:null,images:n,price:p?Price.parse(p):null,usd:usd===null?null:bounded(usd)});
  }
  out.directKnownUsd = bounded(sum(out.directRows.map(r => r.usd ?? 0))); out.knownAiUsd = bounded(out.amUsd + out.directKnownUsd);
  out.complete = out.directRows.every(r => r.usd !== null);
  if (!out.complete) out.warnings.push("У части прямых моделей нет ставки: " + out.directRows.filter(r => r.usd === null).map(r => `${r.model} (${r.kind})`).join(", ") + ". Неизвестные траты не подставлены как 0; итоговая прибыль и окупаемость не рассчитываются.");
  if (!out.amBalanceTokens && !out.directRows.some(r => r.usd !== 0)) out.warnings.push("В журнале нет учтённой активности. Это не доказательство отсутствия реальных затрат.");
  out.warnings.push("Старый журнал не разделяет прямые и AnyModel-вызовы одного ID модели. При смешанном использовании проверьте счета и используйте ручной режим; автоматическое распределение расходов по проектам отсутствует.");
  return finishCosts(out);
}
export async function getWorkspaceCosts() { const raw=await readUsageSnapshot(),settings=await getSettings(); return workspaceCosts(raw,settings,new Date(),usageAccountingComplete()); }
export type ProfitRun = {
  version: 1 | 2; id: string; createdAt: string; title: string; currency: "USD"; input: ProfitInputT;
  period: { start: string; end: string; basis: "manual" | "UTC-month-to-date" };
  workspace: WorkspaceCosts | null;
  result: { revenueEstimate: number; knownAiCosts: number | null; otherCosts: number; knownTotalCosts: number; costsComplete: boolean; estimatedProfit: number | null; marginPct: number | null; breakEvenViews: number | null; breakEvenStatus: "known" | "zero-rpm" | "unknown-costs" | "out-of-range" };
  warnings: string[];
};
export function calculateProfit(input: ProfitInputT, workspace: WorkspaceCosts | null, now = new Date()): ProfitRun {
  input = ProfitInput.parse(input);
  if (input.mode === "workspace-month" && (!workspace || input.month !== workspace.month || workspace.month !== now.toISOString().slice(0,7))) throw new ApiError("VALIDATION", "Месяц сменился или снимок расходов недоступен. Обновите расходы и повторите расчёт.");
  const w = input.mode === "workspace-month" ? workspace! : null;
  const ai = input.mode === "manual" ? input.aiCosts : w!.knownAiUsd, complete = input.mode === "manual" || w!.complete;
  const revenue = bounded(input.views * input.rpm / 1000), costs = bounded((ai ?? 0) + input.otherCosts);
  const profit = complete ? revenue - costs : null;
  let breakEvenViews = !complete ? null : costs === 0 ? 0 : input.rpm === 0 ? null : Math.ceil(costs * 1000 / input.rpm);
  const outOfRange = breakEvenViews !== null && (!Number.isSafeInteger(breakEvenViews) || breakEvenViews < 0);
  if (outOfRange) breakEvenViews = null;
  const rawMargin = profit !== null && revenue > 0 ? profit / revenue * 100 : null;
  const marginPct = rawMargin !== null && Number.isFinite(rawMargin) ? rawMargin : null;
  const warnings = ["Доход = введённые просмотры × введённый RPM / 1000. Это сценарная оценка USD, не реальные выплаты YouTube и не подтверждение монетизации. Просмотры и RPM вводятся пользователем, без OAuth и проверки YouTube.", "Результат учитывает только указанные и доступные затраты. Это не бухгалтерская чистая прибыль; налоги, комиссии, монтаж, подписки и прочие расходы включайте сами. Не добавляйте одну трату дважды.", ...(w?.warnings ?? ["Период, просмотры, RPM и все затраты введены вручную. Программа не проверяла их полноту и соответствие периоду."])];
  if (outOfRange) warnings.push("Окупаемость выходит за пределы точного целого числа JavaScript и не показана как достоверное число.");
  if (rawMargin !== null && !Number.isFinite(rawMargin)) warnings.push("Маржа выходит за пределы числового диапазона и не рассчитана.");
  return { version: 1, id: crypto.randomUUID(), createdAt: now.toISOString(), title: input.title || "Расчёт прибыли", currency: "USD", input, period: w ? { start: w.periodStart, end: w.periodEnd, basis: "UTC-month-to-date" } : { start: (input as Extract<ProfitInputT,{mode:"manual"}>).startDate, end: (input as Extract<ProfitInputT,{mode:"manual"}>).endDate, basis: "manual" }, workspace: w,
    result: { revenueEstimate: revenue, knownAiCosts: ai, otherCosts: input.otherCosts, knownTotalCosts: costs, costsComplete: complete, estimatedProfit: profit, marginPct, breakEvenViews, breakEvenStatus: !complete ? "unknown-costs" : outOfRange ? "out-of-range" : breakEvenViews === null ? "zero-rpm" : "known" }, warnings };
}
export async function saveProfit(raw: ProfitInputT | ProfitSaveInputT) {
  const sent=ProfitSaveInput.parse(raw),{costsHash:reviewed,...fields}=sent as ProfitSaveInputT&{costsHash?:string};
  const input=ProfitInput.parse(fields),w=input.mode==="workspace-month"?await getWorkspaceCosts():null;
  if(w&&reviewed!==w.reviewHash)throw new ApiError("VALIDATION","Журнал, ставки или день UTC изменились. Обновите расходы и проверьте детализацию перед сохранением.",409);
  const r:ProfitRun={...calculateProfit(input,w),version:2};
  const serialized=JSON.stringify(r,null,2);
  if(Buffer.byteLength(serialized,"utf8")>2*1024**2)throw new ApiError("VALIDATION","Снимок расчёта превышает 2 МиБ. Данные не усечены и расчёт не сохранён. Сохраните журнал отдельно; используйте ручной режим со сверенными расходами.",413);
  await checkProfitDir();await fs.mkdir(dataPath("profit-runs"),{recursive:true,mode:0o700});
  const file=dataPath("profit-runs",r.id+".json"),tmp=file+".tmp";
  try{await fs.writeFile(tmp,serialized,{flag:"wx",mode:0o600});await fs.rename(tmp,file);}finally{await fs.rm(tmp,{force:true});}
  return r;
}
const Finite = z.number().finite(), Nonnegative = Finite.nonnegative();
const Strings = z.array(z.string());
const StoredWorkspace = z.object({ month:z.string(), asOf:z.string(), periodStart:Day, periodEnd:Day, coverage:z.enum(["recorded","missing","stale"]), rateUsdPerMillion:Nonnegative, amBalanceTokens:Nonnegative.nullable(), amUsd:Nonnegative.nullable(), directRows:z.array(z.object({model:z.string(),kind:z.enum(["text","image"]),usd:Nonnegative.nullable()})), directKnownUsd:Nonnegative, knownAiUsd:Nonnegative.nullable(), complete:z.boolean(), warnings:Strings, costBasis:CostBasis.optional(), reviewHash:Hash.optional() });
const StoredProfit = z.object({ version:z.union([z.literal(1),z.literal(2)]), id:Id, createdAt:z.string().refine(v=>Number.isFinite(Date.parse(v))), title:z.string().max(120), currency:z.literal("USD"), input:ProfitInput, period:z.object({start:Day,end:Day,basis:z.enum(["manual","UTC-month-to-date"])}), workspace:StoredWorkspace.nullable(), result:z.object({revenueEstimate:Nonnegative,knownAiCosts:Nonnegative.nullable(),otherCosts:Nonnegative,knownTotalCosts:Nonnegative,costsComplete:z.boolean(),estimatedProfit:Finite.nullable(),marginPct:Finite.nullable(),breakEvenViews:Nonnegative.int().nullable(),breakEvenStatus:z.enum(["known","zero-rpm","unknown-costs","out-of-range"])}), warnings:Strings });
function validCosts(w:WorkspaceCosts){
 if(!w.costBasis||!w.reviewHash||w.reviewHash!==costsHash(w))return false;
 const b=w.costBasis;
 if(b.version===2){
  if(w.coverage!=="recorded"||b.ledgerMonth!==w.month)return false;
  const legacyBasis={version:1 as const,ledgerMonth:b.ledgerMonth,amRows:b.amRows,directRows:b.directRows};
  const legacyTotal=(w.amUsd??0)+w.directKnownUsd,legacyComplete=b.directRows.every(r=>r.usd!==null);
  const legacy:WorkspaceCosts={...w,costBasis:legacyBasis,knownAiUsd:legacyTotal,complete:legacyComplete};
  legacy.reviewHash=costsHash(legacy);
  if(!validCosts(legacy))return false;
  // OperationSchema validates tariff, volume and recomputed cost; the basis also rejects duplicate IDs/months.
  const captured=sum(b.operations.map(o=>o.usd??0));
  return w.knownAiUsd===legacyTotal+captured&&w.complete===(legacyComplete&&b.accountingComplete&&b.operations.every(o=>o.usd!==null));
 }
 const amIds=b.amRows.map(r=>r.model),directIds=b.directRows.map(r=>r.kind+":"+r.model);
 if(new Set(amIds).size!==amIds.length||new Set(directIds).size!==directIds.length||b.directRows.some(r=>amIds.includes(r.model)))return false;
 if(w.coverage!=="recorded")return b.amRows.length===0&&b.directRows.length===0&&w.amBalanceTokens===null&&w.amUsd===null&&w.knownAiUsd===null&&w.directKnownUsd===0&&!w.complete&&w.directRows.length===0&&(w.coverage==="missing"?b.ledgerMonth===null:b.ledgerMonth!==w.month);
 if(b.ledgerMonth!==w.month)return false;
 for(const r of b.amRows)if(r.usd!==r.balanceTokens*w.rateUsdPerMillion/1e6)return false;
 for(const r of b.directRows){
  if(r.kind==="text"?(!r.text||r.images!==null):(r.text!==null||r.images===null))return false;
  if(r.price&&!r.model.toLowerCase().includes(r.price.match.toLowerCase()))return false;
  const active=r.kind==="text"?r.text!.in>0||r.text!.out>0||r.text!.calls>0:r.images!==0;
  const usd=!active?0:!r.price?null:r.kind==="text"?(r.text!.in*r.price.input+r.text!.out*r.price.output)/1e6:r.images!*r.price.image;
  if(r.usd!==usd)return false;
 }
 const amTokens=sum(b.amRows.map(r=>r.balanceTokens)),amUsd=amTokens*w.rateUsdPerMillion/1e6,direct=sum(b.directRows.map(r=>r.usd??0));
 return w.amBalanceTokens===amTokens&&w.amUsd===amUsd&&w.directKnownUsd===direct&&w.knownAiUsd===amUsd+direct&&w.complete===b.directRows.every(r=>r.usd!==null)&&JSON.stringify(w.directRows)===JSON.stringify(b.directRows.map(({model,kind,usd})=>({model,kind,usd})));
}
async function checkProfitDir(){try{const st=await fs.lstat(dataPath("profit-runs"));if(!st.isDirectory()||st.isSymbolicLink())throw new ApiError("VALIDATION","Каталог расчётов должен быть обычной папкой, не ссылкой");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}}
export async function loadProfit(id: string) {
 if(!Id.safeParse(id).success)return null;await checkProfitDir();
 try{
  const file=dataPath("profit-runs",id+".json"),st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>2*1024**2)return null;
  const parsed=StoredProfit.safeParse(JSON.parse(await fs.readFile(file,"utf8")));if(!parsed.success||parsed.data.id!==id)return null;
  const r=parsed.data as ProfitRun;
  if(r.version===2){
   if(r.input.mode==="workspace-month"?(!r.workspace||!validCosts(r.workspace)):r.workspace!==null)return null;
   const computed=calculateProfit(r.input,r.workspace,new Date(r.createdAt));
   if(JSON.stringify(computed.result)!==JSON.stringify(r.result)||JSON.stringify(computed.period)!==JSON.stringify(r.period)||computed.title!==r.title)return null;
  }
  return r;
 }catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT"||e instanceof SyntaxError)return null;throw e;}
}
export async function listProfit() {
  await checkProfitDir();const names = await fs.readdir(dataPath("profit-runs")).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return []; throw e; }); const rows = [];
  if(names.filter(n=>/^[0-9a-f-]{36}\.json$/i.test(n)).length>5000)throw new ApiError("VALIDATION","Более 5000 расчётов: сохраните резервную копию и обслужите историю вручную.",413);
  for (const name of names) { if (!name.endsWith(".json")) continue; const r = await loadProfit(name.slice(0,-5)); if (r) rows.push({ id:r.id, title:r.title, createdAt:r.createdAt, mode:r.input.mode, period:r.period, estimatedProfit:r.result.estimatedProfit }); }
  return rows.sort((a,b) => Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,50);
}
