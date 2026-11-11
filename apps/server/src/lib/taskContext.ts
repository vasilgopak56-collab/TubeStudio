import { AsyncLocalStorage } from "node:async_hooks";
import { ApiError } from "./errors.js";

import type { ConsentLaunch, PriceChallenge, ConsentResolution } from "./priceConsentTypes.js";

type TaskContext = { requireStoryboardConsent?: boolean; consentMessage?: string; verifyStoryboard?:()=>Promise<void>; launch?: ConsentLaunch; onPriceConsent?: (challenge: PriceChallenge) => void; onPriceConsentResolved?: (resolution: ConsentResolution) => void; signal?: AbortSignal; onQueue?: (kind: string) => void; jobId?: string; paidLimit?: PaidLimit };
/** Ограничитель платного запуска: сколько физических запросов подтверждено и какие модели/тарифы. Ключ — provider|model|kind, значение — версия тарифа. */
export type PaidLimit = { max: number; used: number; allowed: Map<string, string> };
const storage = new AsyncLocalStorage<TaskContext>();
export const taskContext = () => storage.getStore();
export function taskSignal(explicit?: AbortSignal | null): AbortSignal | undefined {
  const parent = storage.getStore()?.signal;
  return parent && explicit && parent !== explicit ? AbortSignal.any([parent, explicit]) : explicit ?? parent;
}
export const cancellation = () => new ApiError("CANCELLED", "Задача отменена. Уже отправленные провайдеру запросы могут быть оплачены.", 400);
export function checkCancelled(signal = taskSignal()) { if (signal?.aborted) throw cancellation(); }
export function rethrowCancelled(error: unknown, explicit?: AbortSignal) {
  if (taskSignal(explicit)?.aborted || (error instanceof ApiError && error.code === "CANCELLED") || (error instanceof Error && error.name === "AbortError")) throw cancellation();
}
export function runTask<T>(context: TaskContext, fn: () => T): T { return storage.run(context, fn); }
export function withTaskSignal<T>(signal: AbortSignal | undefined, fn: () => T): T {
  return storage.run({ ...storage.getStore(), signal: taskSignal(signal) }, fn);
}

/** Scope only the audio-storyboard generation path, including retries and fallback. */
export function withStoryboardConsent<T>(fn:()=>T):T { return storage.run({...storage.getStore(),requireStoryboardConsent:true},fn); }

/** То же отдельное согласие на каждую физическую отправку, но со своим текстом для автора. */
export function withPaidConsent<T>(consentMessage:string,fn:()=>T):T { return storage.run({...storage.getStore(),requireStoryboardConsent:true,consentMessage},fn); }

/** Recheck the audio generation snapshot at every physical dispatch, including retries. */
export function withStoryboardGuard<T>(verifyStoryboard:(()=>Promise<void>)|undefined, fn:()=>T):T { return storage.run({...storage.getStore(),verifyStoryboard},fn); }
