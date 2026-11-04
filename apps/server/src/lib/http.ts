import { ApiError, rethrowFinancial } from "./errors.js";
import { checkCancelled, rethrowCancelled, taskSignal } from "./taskContext.js";

/** Abort-aware delay: cancelling also interrupts Retry-After / polling waits. */
export function sleep(ms: number, explicit?: AbortSignal | null): Promise<void> {
  const signal = taskSignal(explicit); checkCancelled(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); try { checkCancelled(signal); } catch (e) { reject(e); } };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}
export function retryDelay(value: string | null, attempt: number, now = Date.now()) {
  if (value) {
    const seconds = Number(value);
    const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Date.parse(value) - now;
    if (Number.isFinite(delay) && delay >= 0) return Math.min(delay, 24 * 3600_000);
  }
  return 1000 * 3 ** attempt;
}

/** Caller/job signal is combined with timeout, never replaced. Cancellation is not retried. */
export async function fetchRetry(url: string, init: RequestInit = {}, opts: { timeoutMs?: number; retries?: number; beforeAttempt?: () => Promise<void> | void } = {}) {
  const { timeoutMs = 30_000, retries = 3 } = opts;
  const signal = taskSignal(init.signal);
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    checkCancelled(signal);
    // Outside transport catch: a denied dispatch is neither retried nor wrapped.
    await opts.beforeAttempt?.();
    checkCancelled(signal);
    try {
      const attemptSignal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
      const res = await fetch(url, { ...init, signal: attemptSignal });
      checkCancelled(signal);
      if ((res.status === 429 || res.status >= 500) && i < retries) {
        // Release the old body/socket before another attempt.
        await res.body?.cancel();
        await sleep(retryDelay(res.headers.get("retry-after"), i), signal);
        continue;
      }
      return res;
    } catch (e) {
      rethrowCancelled(e, signal);
      rethrowFinancial(e);
      lastErr = e;
      if (i < retries) await sleep(1000 * 3 ** i, signal);
    }
  }
  throw new ApiError("UPSTREAM", `Сеть недоступна: ${String((lastErr as Error)?.message ?? lastErr)}`, 502, true);
}
