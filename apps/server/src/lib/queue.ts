import { cancellation, checkCancelled, taskContext, taskSignal, withTaskSignal } from "./taskContext.js";

export type QueueKind = "llm" | "image" | "tts";
type Waiter = { resolve: (release: () => void) => void; reject: (e: Error) => void; signal?: AbortSignal; abort: () => void };
/** One FIFO queue per provider workload, shared by all jobs and API routes in this process. */
export class RequestQueue {
  private active = 0;
  private waiters: Waiter[] = [];
  constructor(readonly limit: number) { if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid concurrency limit"); }
  snapshot() { return { limit: this.limit, active: this.active, waiting: this.waiters.length }; }
  private releaseOnce() {
    let released = false;
    return () => { if (released) return; released = true; this.active--; this.drain(); };
  }
  private drain() {
    while (this.active < this.limit && this.waiters.length) {
      const w = this.waiters.shift()!; w.signal?.removeEventListener("abort", w.abort);
      if (w.signal?.aborted) { w.reject(cancellation()); continue; }
      this.active++; w.resolve(this.releaseOnce());
    }
  }
  acquire(signal?: AbortSignal): Promise<() => void> {
    checkCancelled(signal);
    if (this.active < this.limit && !this.waiters.length) { this.active++; return Promise.resolve(this.releaseOnce()); }
    return new Promise((resolve, reject) => {
      const w: Waiter = { resolve, reject, signal, abort: () => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) { this.waiters.splice(i, 1); reject(cancellation()); }
      } };
      this.waiters.push(w); signal?.addEventListener("abort", w.abort, { once: true });
      if (signal?.aborted) w.abort();
    });
  }
  async run<T>(fn: () => Promise<T>, signal?: AbortSignal) {
    const release = await this.acquire(signal);
    try { checkCancelled(signal); const result = await fn(); checkCancelled(signal); return result; } finally { release(); }
  }
}
const queues = { llm: new RequestQueue(2), image: new RequestQueue(3), tts: new RequestQueue(1) };
export const queueStatus = () => Object.fromEntries(Object.entries(queues).map(([k, q]) => [k, q.snapshot()])) as Record<QueueKind, { limit: number; active: number; waiting: number }>;
/** Wrap only provider-level functions. Never wrap both a fallback dispatcher and its providers. */
export function queued<A extends unknown[], R>(kind: QueueKind, fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args) => {
    const explicit = (args[0] as { signal?: AbortSignal } | undefined)?.signal;
    const signal = taskSignal(explicit);
    const q = queues[kind];
    if (q.snapshot().active >= q.limit) taskContext()?.onQueue?.(kind);
    return withTaskSignal(signal, () => q.run(() => fn(...args), signal));
  };
}
