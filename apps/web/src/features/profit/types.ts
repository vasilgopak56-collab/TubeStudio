export type ProfitInputT = { title: string; views: number; rpm: number; otherCosts: number } & ({ mode: "manual"; startDate: string; endDate: string; aiCosts: number } | { mode: "workspace-month"; month: string });
export type LegacyCostBasis = {
 version:1;ledgerMonth:string|null;
 amRows:{model:string;balanceTokens:number;usd:number;text:{in:number;out:number;calls:number}|null;images:number|null}[];
 directRows:{model:string;kind:"text"|"image";text:{in:number;out:number;calls:number}|null;images:number|null;price:{match:string;input:number;output:number;image:number}|null;usd:number|null}[];
};
export type CapturedOperation = {id:string;completedAt:string;month:string;price:{provider:string;model:string;kind:string;[key:string]:unknown};volume:{known:boolean;[key:string]:unknown};usd:number|null;balanceTokens:number|null};
export type CostBasis = LegacyCostBasis | (Omit<LegacyCostBasis,"version"> & {version:2;operations:CapturedOperation[];accountingComplete:boolean});
export function capturedSummary(w:WorkspaceCosts) {const b=w.costBasis;return b?.version===2?`По сохранённым тарифам: ${usd(b.operations.reduce((n,o)=>n+(o.usd??0),0))}; операций ${b.operations.length}; неизвестных ${b.operations.filter(o=>o.usd===null).length}; запись журнала ${b.accountingComplete?"без известной ошибки":"неполная"}.`:null;}
export type WorkspaceCosts = {
 costBasis?:CostBasis;reviewHash?:string;
  month: string; asOf: string; periodStart: string; periodEnd: string; coverage: "recorded" | "missing" | "stale";
  rateUsdPerMillion: number; amBalanceTokens: number | null; amUsd: number | null;
  directRows: { model: string; kind: "text" | "image"; usd: number | null }[];
  directKnownUsd: number; knownAiUsd: number | null; complete: boolean; warnings: string[];
};
export type ProfitRun = {
  version: 1 | 2; id: string; createdAt: string; title: string; currency: "USD"; input: ProfitInputT;
  period: { start: string; end: string; basis: "manual" | "UTC-month-to-date" };
  workspace: WorkspaceCosts | null;
  result: { revenueEstimate: number; knownAiCosts: number | null; otherCosts: number; knownTotalCosts: number; costsComplete: boolean; estimatedProfit: number | null; marginPct: number | null; breakEvenViews: number | null; breakEvenStatus: "known" | "zero-rpm" | "unknown-costs" | "out-of-range" };
  warnings: string[];
};
export type ProfitBrief = Pick<ProfitRun, "id" | "title" | "createdAt" | "period"> & { mode: ProfitInputT["mode"]; estimatedProfit: number | null };
export const usd = (n: number | null) => n === null ? "Неизвестно" : new Intl.NumberFormat("ru-RU", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n);
export function profitMarkdown(r: ProfitRun) {
  const n = r.result;
  return [`# ${r.title}`, `Сценарная оценка, USD. Сохранено ${r.createdAt}`, `Период: ${r.period.start} — ${r.period.end}; ${r.period.basis}`, `Режим: ${r.input.mode}`, `Просмотры: ${r.input.views}; RPM: ${r.input.rpm} USD / 1000 просмотров`, `Доход: ${usd(n.revenueEstimate)}`, `Учтённые AI-затраты: ${usd(n.knownAiCosts)}`, `Прочие затраты: ${usd(n.otherCosts)}`, `Известная часть затрат: ${usd(n.knownTotalCosts)}`, `Оценка прибыли: ${usd(n.estimatedProfit)}`, `Маржа: ${n.marginPct === null ? "не определена" : n.marginPct.toFixed(2) + "%"}`, `Просмотры до окупаемости: ${n.breakEvenViews ?? "не определены"} (${n.breakEvenStatus})`, ...(r.workspace ? [`Снимок учёта: ${r.workspace.asOf}; месяц UTC ${r.workspace.month}`, ...(r.workspace.costBasis?.version===2?[capturedSummary(r.workspace)!,"Ниже — только старые строки по ставкам на момент снимка; новые операции не переоценены."]:[]), `AnyModel: ${r.workspace.amBalanceTokens ?? "неизвестно"} балансовых токенов; ставка ${r.workspace.rateUsdPerMillion} USD / млн; ${usd(r.workspace.amUsd)}`, ...r.workspace.directRows.map(row => `Прямая модель: ${row.model} (${row.kind}) — ${usd(row.usd)}`)] : []), ...(r.workspace?.costBasis ? [`Основание расходов v${r.workspace.costBasis.version} (не счёт провайдера):`, jsonBlock(r.workspace.costBasis), `Хеш проверенных расходов: ${r.workspace.reviewHash}`] : r.workspace ? ["Подробное основание расходов не сохранено: архив v1. Текущие ставки не подставлены за исторические."] : []), ...r.warnings.map(w => `Ограничение: ${w}`)].join("\n\n");
}

function jsonBlock(value:unknown){const text=JSON.stringify(value,null,2),fence="`".repeat(Math.max(3,...[...text.matchAll(/`+/g)].map(x=>x[0].length+1)));return fence+"json\n"+text+"\n"+fence;}
