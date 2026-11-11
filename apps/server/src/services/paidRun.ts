// Ограничитель платного запуска: одно окно цены на весь запуск с верхней границей числа запросов.
// Сервер считает каждый физический запрос (paidDispatch → checkPaidLimit): больше подтверждённого,
// другая модель, другой тариф или повтор после сбоя — запрос не отправляется.
import { createHash } from "node:crypto";
import { ApiError } from "../lib/errors.js";
import { runTask, taskContext, type PaidLimit } from "../lib/taskContext.js";
import { amCached, amCatalog, amCatalogFresh } from "./anymodel.js";
import { priceConsents } from "./priceConsent.js";
import { capturePrice, operationCost, type PriceSnapshot } from "./usagePricing.js";

/** Один вид запроса в плане запуска: кто, сколько раз максимум и какой объём для ориентира. */
export type PlannedCall = { step: string; provider: string; model: string; kind: "text" | "search"; count: number; inputChars?: number; maxTokens?: number };

const key = (c: { provider: string; model: string; kind: string }) => `${c.provider}|${c.model}|${c.kind}`;
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

async function prices(calls: PlannedCall[]): Promise<Map<string, PriceSnapshot>> {
  if (calls.some((c) => c.provider === "anymodel")) await amCatalog().catch(() => []);
  const out = new Map<string, PriceSnapshot>();
  for (const c of calls) {
    const k = key(c);
    if (out.has(k)) continue;
    out.set(k, c.provider === "anymodel"
      ? await capturePrice("anymodel", c.model, c.kind, c.kind === "text" ? amCached(c.model)?.billing : undefined, { catalogFresh: amCatalogFresh() })
      : await capturePrice(c.provider, c.model, c.kind));
  }
  return out;
}

/** Ориентир за максимум: вход — 2 знака на токен, выход — верхняя граница ответа. null — цена хотя бы одного вида неизвестна. */
export function paidRunQuote(calls: PlannedCall[], price: Map<string, PriceSnapshot>): number | null {
  let total = 0;
  for (const c of calls) {
    if (!c.count) continue;
    const p = price.get(key(c));
    if (!p) return null;
    const usd = c.kind === "search"
      ? operationCost(p, { count: 1, known: true }).usd
      : operationCost(p, { input: Math.ceil((c.inputChars ?? 0) / 2), output: c.maxTokens ?? 0, known: true }).usd;
    if (usd === null) return null;
    total += usd * c.count;
  }
  return total;
}

export function paidRunMessage(title: string, calls: PlannedCall[], usd: number | null) {
  const max = calls.reduce((n, c) => n + (c.kind === "text" ? c.count : 0), 0);
  const models = [...new Set(calls.filter((c) => c.count && c.kind === "text").map((c) => c.model))].join(", ");
  const price = usd === null ? "Цена хотя бы одной модели неизвестна." : `Ориентир цены за максимум: примерно $${usd < 0.01 ? "0.01" : usd.toFixed(2)} или меньше.`;
  return `${title}: до ${max} запросов к моделям ${models}. Обычно запросов меньше: это верхняя граница. ${price} Точная сумма заранее неизвестна, согласие не ограничивает списание. Резервных моделей и повторов после сбоя не будет: при сбое работа остановится, готовые этапы сохранятся там, где успели закончиться.`;
}

/** Показывает окно, ждёт решения и возвращает ограничитель. Без «Подтвердить» ничего не отправляется. */
export async function requestPaidRun(title: string, calls: PlannedCall[], context: unknown): Promise<PaidLimit> {
  const used = calls.filter((c) => c.count > 0);
  if (!used.length) throw new ApiError("VALIDATION", "Нет платных шагов для запуска.", 400);
  const kinds = [...new Map(used.map((c) => [key(c), { provider: c.provider, model: c.model, kind: c.kind }])).values()];
  if (kinds.length > 8) throw new ApiError("VALIDATION", "Слишком много разных моделей для одного окна цены. Запрос не отправлен.", 400);
  const first = await prices(used);
  const spec = (p: Map<string, PriceSnapshot>) => ({ contextHash: sha({ context, calls: used.map((c) => [c.step, key(c), c.count]) }), tariffHash: sha(kinds.map((k) => p.get(key(k))!.priceVersion)), tasks: kinds });
  const permit = await priceConsents.request(spec(first), paidRunMessage(title, used, paidRunQuote(used, first)));
  const fresh = await prices(used);
  priceConsents.consume(permit, spec(fresh));
  // Поиск считается вместе со своим текстовым запросом, поэтому максимум — по текстовым запросам.
  return { max: used.reduce((n, c) => n + (c.kind === "text" ? c.count : 0), 0), used: 0, allowed: new Map(kinds.map((k) => [key(k), fresh.get(key(k))!.priceVersion])) };
}

/** Выполняет работу под ограничителем. */
export function withPaidLimit<T>(limit: PaidLimit, fn: () => Promise<T>): Promise<T> {
  return runTask({ ...taskContext(), paidLimit: limit }, fn);
}
