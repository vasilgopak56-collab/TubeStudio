import type { PriceChallenge, ConsentResolution } from "./priceConsentTypes.js";
import crypto from "node:crypto";
import { ApiError } from "./errors.js";
import { log } from "./logging.js";
import { cancellation, checkCancelled, runTask, taskContext } from "./taskContext.js";

export type JobEvent = { type: "price-consent"; consent: PriceChallenge } | { type: "price-consent-resolved"; resolution: ConsentResolution } | { type: "progress"; stage: string; pct: number } | { type: "partial"; data: unknown } | { type: "done"; data: unknown } | { type: "error"; error: { code: string; message: string; details?: unknown } };
type Job = { id: string; events: JobEvent[]; listeners: Set<(e: JobEvent) => void>; done: boolean; createdAt: number; abort: AbortController };
export type JobCtx = { progress: (stage: string, pct: number) => void; partial: (d: unknown) => void; signal: AbortSignal };
const jobs = new Map<string, Job>();
setInterval(() => { for (const [k, j] of jobs) if (j.done && Date.now() - j.createdAt > 3600_000) jobs.delete(k); }, 600_000).unref();
export const activeJobCount = () => [...jobs.values()].filter(j => !j.done).length;

/** Коды, для которых интерфейсу нужны подробности ошибки (например, сумма доплаты Lumean). */
const JOB_DETAIL_CODES = new Set(["LUMEAN_PAYG_REQUIRED"]);
export function startJob(fn: (ctx: JobCtx) => Promise<unknown>): string {
  const id = crypto.randomUUID();
  const job: Job = { id, events: [], listeners: new Set(), done: false, createdAt: Date.now(), abort: new AbortController() };
  jobs.set(id, job);
  const emit = (e: JobEvent) => { job.events.push(e); for (const l of job.listeners) { try { l(e); } catch { /* a disconnected subscriber must not fail a job */ } } };
  let pct = 0;
  const ctx: JobCtx = {
    signal: job.abort.signal,
    progress: (stage, value) => { if (!job.abort.signal.aborted) { pct = value; emit({ type: "progress", stage, pct }); } },
    partial: data => { if (!job.abort.signal.aborted) emit({ type: "partial", data }); },
  };
  log.info({ event: "job_started", jobId: id });
  // AsyncLocalStorage carries cancellation through every nested service/provider call.
  const launch = taskContext()?.launch;
  void runTask({ launch, onPriceConsent: consent => emit({ type: "price-consent", consent }), onPriceConsentResolved: resolution => emit({ type: "price-consent-resolved", resolution }), signal: job.abort.signal, jobId: id, onQueue: kind => ctx.progress(`Ожидание в очереди: ${kind === "llm" ? "текст / распознавание" : kind === "image" ? "изображения" : "озвучка"}`, pct) }, async () => {
    try {
      checkCancelled(); const data = await fn(ctx); checkCancelled();
      emit({ type: "done", data }); log.info({ event: "job_done", jobId: id });
    } catch (e) {
      const err = job.abort.signal.aborted ? cancellation() : e;
      if (!(err instanceof ApiError)) log.error({ event: "job_failed", jobId: id, errorType: err instanceof Error ? err.name : "unknown" });
      emit({ type: "error", error: err instanceof ApiError ? { code: err.code, message: err.message, ...(JOB_DETAIL_CODES.has(err.code) && err.details && typeof err.details === "object" ? { details: err.details } : {}) } : { code: "INTERNAL", message: (err as Error)?.message ?? "Ошибка" } });
      log.info({ event: err instanceof ApiError && err.code === "CANCELLED" ? "job_cancelled" : "job_error", jobId: id, code: err instanceof ApiError ? err.code : "INTERNAL" });
    } finally { job.done = true; }
  });
  return id;
}
export const getJob = (id: string) => jobs.get(id);
export const cancelJob = (id: string) => { const j = jobs.get(id); if (!j || j.done) return false; j.abort.abort(); return true; };
