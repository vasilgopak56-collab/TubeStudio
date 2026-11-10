import { createHash } from "node:crypto";
import { taskContext } from "../lib/taskContext.js";
import { priceConsents } from "./priceConsent.js";
import { ApiError } from "../lib/errors.js";
import { getSettings } from "./settings.js";
import { getUsage, usageAccountingComplete } from "./usage.js";
import { PriceSnapshotSchema, operationCost, type PriceSnapshot, type OperationVolume } from "./usagePricing.js";

const probe = (p: PriceSnapshot): OperationVolume => p.kind === "text" || p.kind === "audio"
  ? { input: 1, output: 1, known: true } : p.kind === "tts" ? { chars: 1, known: true } : { count: 1, known: true };

/** Runs inside the provider queue and again before EACH transport attempt.
 * No provider requests, price refresh, reservation, or predicted final charge.
 * Consent is enabled only by explicitly opted-in call sites.
 */
export function paidDispatch(prepare: () => Promise<PriceSnapshot | PriceSnapshot[]>, consent?: {contextHash:string; message:string}) {
  let prices: PriceSnapshot[] = [];
  return {
    get prices() { return prices; },
    async beforeAttempt() {
      const captureAndCheck = async () => {
      const prepared = await prepare();
      let captured: PriceSnapshot[];
      try { captured = (Array.isArray(prepared) ? prepared : [prepared]).map(p => PriceSnapshotSchema.parse(structuredClone(p))); }
      catch { throw new ApiError("BUDGET_PRICE_UNKNOWN", "Платный запрос не отправлен: тариф не прошёл проверку. Исправьте тариф или обновите каталог.", 402); }
      const s = await getSettings();
      if (s.budget.mode === "block") {
        const unknown = captured.find(p => !p.known || operationCost(p, probe(p)).usd === null);
        if (!captured.length || unknown) throw new ApiError("BUDGET_PRICE_UNKNOWN",
          "Платный запрос не отправлен: тариф этой модели или одной из включённых задач неизвестен. Укажите полный тариф или обновите каталог; резервная модель автоматически не запускается.", 402, false,
          unknown ? { provider: unknown.provider, model: unknown.model, kind: unknown.kind } : undefined);
        let u: Awaited<ReturnType<typeof getUsage>>;
        try { u = await getUsage(); }
        catch { throw new ApiError("BUDGET_LIMIT", "Платный запрос не отправлен: журнал расходов недоступен или повреждён. Восстановите резервную копию; ошибка не считается нулевыми расходами.", 402); }
        // Операции без цены работу не останавливают: расход и баланс показываются по ролику. Незаписанный журнал — останавливает.
        if (!usageAccountingComplete()) throw new ApiError("BUDGET_LIMIT",
          "Платный запрос не отправлен: запись журнала расходов не завершена. Не повторяйте выполненную генерацию ради учёта.", 402);
        if (s.budget.monthlyUsd > 0 && u.cost.knownTotalRaw >= s.budget.monthlyUsd) throw new ApiError("BUDGET_LIMIT", "Платный запрос не отправлен: месячный лимит расходов достигнут.", 402);
      }
      return captured;
      };
      await taskContext()?.verifyStoryboard?.();
      let captured = await captureAndCheck();
      if (consent) {
        const spec = (p: PriceSnapshot[]) => ({ contextHash: consent.contextHash, tariffHash: createHash("sha256").update(JSON.stringify(p.map(x => x.priceVersion))).digest("hex"), tasks: p.map(x => ({provider:x.provider, model:x.model, kind:x.kind})) });
        const permit = await priceConsents.request(spec(captured), consent.message);
        captured = await captureAndCheck();
        priceConsents.consume(permit, spec(captured));
      }
      await taskContext()?.verifyStoryboard?.();
      // Record the tariff of the actual last attempt, not of an earlier failed attempt.
      prices = captured;
    },
  };
}

/** The exact request is immutable before consent; secrets are only hashed, never sent to the UI. */
export function storyboardConsent(url:string, headers:Record<string,string>, body:string) {
  if(!taskContext()?.requireStoryboardConsent)return undefined;
  return {contextHash:createHash("sha256").update(JSON.stringify({url,headers,body})).digest("hex"),message:taskContext()?.consentMessage??"Подтвердите один текстовый запрос для создания промптов раскадровки. Точная сумма неизвестна; согласие не ограничивает списание и не распространяется на другие запросы, повторы или резервные модели."};
}
