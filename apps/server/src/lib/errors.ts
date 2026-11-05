import { log } from "./logging.js";
import type { Context } from "hono";
import { ZodError } from "zod";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ErrorCode = "DONOR_STORE" | "PROJECT_STORE"
  | "CANCELLED" | "VALIDATION" | "KEY_MISSING" | "UNAUTHORIZED" | "NOT_FOUND"
  | "YT_QUOTA" | "YT_NOT_FOUND" | "LLM_INVALID_JSON" | "LLM_RATE_LIMIT"
  | "TTS_PART_FAILED" | "LUMEAN_PAYG_REQUIRED" | "LUMEAN_QUOTA" | "IMAGE_POLICY"
  | "UPSTREAM" | "INTERNAL" | "BUDGET_LIMIT" | "BUDGET_PRICE_UNKNOWN" | "BUDGET_CONSENT_REQUIRED" | "BUDGET_CONSENT_DENIED" | "BUDGET_CONSENT_EXPIRED" | "BUDGET_CONSENT_STALE" | "BUDGET_CONSENT_CAPACITY"
  | "STYLE_LIMIT" | "STYLE_STORE" | "STYLE_NOT_FOUND" | "STYLE_READ_ONLY" | "STYLE_CONFLICT"
  | "GLABS_OFFLINE" | "GLABS_PLAN" | "GLABS_TASK_LOST";

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status: ContentfulStatusCode = 400,
    public retryable = false,
    public details?: unknown,
  ) { super(message); }
}

export const ok = <T>(c: Context, data: T) => c.json({ ok: true as const, data });

export function fail(c: Context, e: unknown) {
  if (e instanceof ApiError)
    return c.json({ ok: false as const, error: { code: e.code, message: e.message, retryable: e.retryable, details: e.details } }, e.status);
  if (e instanceof ZodError)
    return c.json({ ok: false as const, error: { code: "VALIDATION", message: "Проверьте поля: " + e.issues.slice(0, 5).map((i) => `${i.path.join(".") || "тело"} — ${i.message}`).join("; "), retryable: false } }, 400);
  log.error({ event: "request_failed", errorType: e instanceof Error ? e.name : "unknown" });
  return c.json({ ok: false as const, error: { code: "INTERNAL", message: "Внутренняя ошибка сервера" } }, 500);
}

/** Financial denials are terminal, never a provider outage or fallback trigger. */
export function isFinancialError(e: unknown): e is ApiError {
  return e instanceof ApiError && (e.code === "BUDGET_LIMIT" || e.code === "BUDGET_PRICE_UNKNOWN" || e.code.startsWith("BUDGET_CONSENT_"));
}
export function rethrowFinancial(e: unknown): void { if (isFinancialError(e)) throw e; }
