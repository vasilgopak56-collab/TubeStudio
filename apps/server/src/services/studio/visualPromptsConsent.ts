// Одно окно цены на весь запуск платных промптов «Визуала»: число запросов, модель и общий ориентир.
// Без «Подтвердить» ничего не отправляется. Подтверждение действует только на этот запуск, эти сцены, эту модель и этот тариф.
// Перед каждой пачкой модель и тариф проверяются снова: если они изменились, работа останавливается, готовые части сохранены.
import { createHash } from "node:crypto";
import { ApiError } from "../../lib/errors.js";
import { amCached, amCatalog, amCatalogFresh } from "../anymodel.js";
import { priceConsents } from "../priceConsent.js";
import { getSettings } from "../settings.js";
import { capturePrice, operationCost, type PriceSnapshot } from "../usagePricing.js";
import type { Channel } from "./channels.js";
import { PROMPT_SYSTEM, promptMaxTokens, promptUser, type PromptScene, type StyleKit } from "./visualPrompts.js";

/** Добавка к тексту системы, которую дописывает generateJson, и запас на «предыдущую сцену», неизвестную заранее. */
const JSON_SUFFIX = "\n\nReturn ONLY valid JSON. No markdown fences, no commentary.".length, PREVIOUS_RESERVE = 600;
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

async function currentTariff(): Promise<{ model: string; price: PriceSnapshot }> {
  const model = (await getSettings()).anymodel.script;
  if (!model) throw new ApiError("KEY_MISSING", "В Настройках не выбрана модель сценариста AnyModel. Запрос не отправлен.", 400);
  await amCatalog().catch(() => []);
  const price = await capturePrice("anymodel", model, "text", amCached(model)?.billing, { catalogFresh: amCatalogFresh() });
  return { model, price };
}

type Ch = Pick<Channel, "name" | "language" | "niche" | "audience" | "format" | "visual">;
/** Ориентир: вход с запасом (2 знака на токен), выход — по верхней границе ответа каждой пачки. null — цена неизвестна. */
export function promptsQuote(price: PriceSnapshot, o: { ch: Ch; kit: StyleKit; batches: PromptScene[][]; note?: string }): number | null {
  let total = 0;
  for (const [i, scenes] of o.batches.entries()) {
    const chars = PROMPT_SYSTEM.length + JSON_SUFFIX + promptUser({ ch: o.ch, kit: o.kit, scenes, note: o.note }).length + (i > 0 ? PREVIOUS_RESERVE : 0);
    const usd = operationCost(price, { input: Math.ceil(chars / 2), output: promptMaxTokens(scenes.length), known: true }).usd;
    if (usd === null) return null;
    total += usd;
  }
  return total;
}

export function promptsMessage(o: { model: string; requests: number; scenes: number; usd: number | null }) {
  const price = o.usd === null ? "Цена этой модели неизвестна." : `Ориентир цены за все запросы: примерно $${o.usd < 0.01 ? "0.01" : o.usd.toFixed(2)} или меньше.`;
  return `Подтвердите ${o.requests} ${o.requests === 1 ? "запрос" : "запросов"} к модели ${o.model} для промптов ${o.scenes} сцен (до 12 сцен в запросе). ${price} Точная сумма заранее неизвестна, согласие не ограничивает списание. Автоматических повторов и резервных моделей не будет. Если запрос не удастся, работа остановится, готовые части сохранятся.`;
}

/**
 * Показывает окно и ждёт решения. Возвращает проверку, которую нужно вызвать перед каждой пачкой.
 * Число пачек задаёт вызывающий: больше подтверждённого не отправляется.
 */
export async function promptsConsent(o: { projectId: string; ch: Ch; kit: StyleKit; batches: PromptScene[][]; note?: string }): Promise<{ model: string; beforeBatch: () => Promise<void> }> {
  const first = await currentTariff();
  const scope = { projectId: o.projectId, kit: o.kit.id, note: o.note ?? "", scenes: o.batches.map((b) => b.map((s) => [s.n, s.text])) };
  const spec = (t: { model: string; price: PriceSnapshot }) => ({ contextHash: sha({ ...scope, model: t.model }), tariffHash: sha(t.price.priceVersion), tasks: [{ provider: "anymodel", model: t.model, kind: "text" as const }] });
  const usd = promptsQuote(first.price, o);
  const permit = await priceConsents.request(spec(first), promptsMessage({ model: first.model, requests: o.batches.length, scenes: o.batches.reduce((n, b) => n + b.length, 0), usd }));
  const fresh = await currentTariff();
  priceConsents.consume(permit, spec(fresh));
  let used = 0;
  return {
    model: fresh.model,
    async beforeBatch() {
      if (++used > o.batches.length) throw new ApiError("BUDGET_CONSENT_STALE", "Запросов больше, чем подтверждено. Новый запрос не отправлен.", 402);
      const now = await currentTariff();
      if (now.model !== fresh.model || now.price.priceVersion !== fresh.price.priceVersion)
        throw new ApiError("BUDGET_CONSENT_STALE", "Модель или тариф изменились во время работы. Готовые части сохранены, новый запрос не отправлен. Запустите заново с отметкой «Только пустые сцены».", 402);
    },
  };
}
