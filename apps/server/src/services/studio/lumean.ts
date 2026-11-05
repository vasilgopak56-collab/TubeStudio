// Озвучка через Lumean (Выпуск 1, карточки 180 и 190).
// Голос канала → шаблон Lumean → один заказ на сценарий → файлы сразу в папку проекта.
// Защита денег: один и тот же текст не уходит дважды (реестр по sha256), создание заказа
// никогда не повторяется автоматически, перед отправкой — бесплатная оценка и остаток счёта.
// Lumean оплачивается отдельно и не входит в месячный лимит расходов TubeStudio на ИИ.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { config } from "../../config.js";
import { ApiError } from "../../lib/errors.js";
import { dataPath, readJson, writeJson } from "../../lib/storage.js";
import { checkCancelled, rethrowCancelled, taskSignal } from "../../lib/taskContext.js";
import { sleep } from "../../lib/http.js";
import type { JobCtx } from "../../lib/jobs.js";
import { log } from "../../lib/logging.js";
import { getChannel, updateChannel, type Channel } from "./channels.js";

export const LUMEAN_BASE = "https://api.lumean.app/api/public";
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (url, init) => fetch(url, init);
/** Только для тестов. */
export function setLumeanFetcher(f: Fetcher | null) { fetcher = f ?? ((url, init) => fetch(url, init)); }
export const LUMEAN_POLL = { ms: 5000, maxMinutes: 45 };

type Env = { success?: boolean; message?: string; data?: any; reason?: string; error_code?: string; errors?: Record<string, string[]>; [k: string]: any };
const key = () => { const k = config.keys.lumean; if (!k) throw new ApiError("KEY_MISSING", "Нет ключа Lumean. Создайте ключ в кабинете Lumean (раздел API, набор прав «full») и вставьте его в TubeStudio → Настройки → Ключи.", 400); return k; };

function toError(status: number, j: Env, retryAfter?: string | null): ApiError {
  const reason = j.reason ?? j.error_code ?? "";
  const msg = (j.message ?? "").slice(0, 300);
  if (status === 401) return new ApiError("KEY_MISSING", "Ключ Lumean не подходит или истёк. Вставьте новый ключ в Настройках.", 400);
  if (status === 403) return new ApiError("UPSTREAM", `Lumean: у ключа нет нужных прав (${reason || "permission"}). Создайте ключ с набором прав «full».${msg ? ` ${msg}` : ""}`, 403);
  // Запасной режим Lumean: доплата с баланса сверх квоты требует явного согласия (Рецепт G).
  if ((status === 402 && reason === "payg_topup_required") || (status === 409 && reason === "quote_mismatch")) {
    const lmc = Number(j.shortfall_lmc ?? (Number(j.actual_lmc_minor ?? j.shortfall_lmc_minor) / 1e8)) || 0;
    return new ApiError("LUMEAN_PAYG_REQUIRED", `Квоты подписки Lumean не хватает на этот текст: нужна доплата ${lmc.toFixed(2)} LMC с баланса Lumean. Нажмите «Разрешить доплату» — заказ будет создан один раз.`, 402, false, { reason, topupLmc: Math.round(lmc * 100) / 100, quoteToken: typeof j.quote_token === "string" ? j.quote_token : undefined, expiresAt: j.expires_at });
  }
  if (status === 402) return new ApiError("LUMEAN_PAYG_REQUIRED", `На счёте Lumean не хватает средств или тариф не разрешает доплату (${reason || "402"}). Пополните счёт в кабинете Lumean и запустите озвучку снова.`, 402);
  if (status === 404 && reason === "endpoint_not_found") return new ApiError("UPSTREAM", "Lumean изменил адреса API. Обновите TubeStudio; повторять запрос не нужно.", 502);
  if (status === 404) return new ApiError("NOT_FOUND", msg || "Lumean: не найдено", 404);
  if (status === 409) return new ApiError("VALIDATION", `Lumean: ${msg || reason}`, 409);
  if (status === 422) {
    const fields = j.errors ? Object.entries(j.errors).slice(0, 3).map(([k, v]) => `${k}: ${v.join(", ")}`).join("; ") : "";
    if (reason === "content_blocked") return new ApiError("VALIDATION", "Lumean: этот текст уже отклонён политикой сервиса озвучки. Перефразируйте спорное место.", 422);
    return new ApiError("VALIDATION", `Lumean отклонил запрос: ${msg || reason}${fields ? ` (${fields})` : ""}`, 422);
  }
  if (status === 429) {
    if (reason === "token_quota_exceeded" || reason === "limit_exceeded") return new ApiError("LUMEAN_QUOTA", "Квота Lumean на этот период исчерпана. Проверьте тариф в кабинете Lumean.", 429, false, { reason });
    if (reason === "ip_banned") return new ApiError("UPSTREAM", "Lumean временно заблокировал запросы с этого компьютера. Подождите 5–30 минут.", 429, true, { reason });
    return new ApiError("UPSTREAM", `Lumean просит подождать${retryAfter ? ` ${retryAfter} с` : ""} (${reason || "rate limit"}).`, 429, true, { reason, retryAfter: Number(retryAfter) || undefined });
  }
  return new ApiError("UPSTREAM", `Lumean ответил ошибкой ${status}${msg ? `: ${msg}` : ""}`, 502, true);
}

/** Запрос к Lumean. Безопасные запросы (чтение, ссылки на файлы, повтор упавших частей) повторяются;
 *  создание заказа и шаблона — никогда: при обрыве связи заказ мог быть создан. */
async function call<T = any>(method: "GET" | "POST", p: string, body?: unknown, o: { safe?: boolean } = {}): Promise<T> {
  const k = key();
  const safe = o.safe ?? method === "GET";
  for (let attempt = 0; ; attempt++) {
    const signal = taskSignal();
    checkCancelled(signal);
    let res: Response;
    try {
      res = await fetcher(`${LUMEAN_BASE}${p}`, {
        method, headers: { "X-API-KEY": k, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]),
      });
    } catch (e) {
      rethrowCancelled(e, signal);
      if (safe && attempt < 2) { await sleep(2000 * (attempt + 1), signal); continue; }
      throw new ApiError("UPSTREAM", safe ? "Lumean не отвечает. Проверьте интернет." : "Связь с Lumean оборвалась во время отправки. Заказ мог быть создан — TubeStudio проверит это перед новой отправкой.", 502, true, { uncertain: !safe });
    }
    const j: Env = await res.json().catch(() => ({}));
    if (res.ok && j.success !== false) return j.data as T;
    const err = toError(res.status, j, res.headers.get("retry-after"));
    if (safe && attempt < 2 && (res.status >= 500 || (res.status === 429 && err.retryable && (err.details as { reason?: string })?.reason !== "ip_banned"))) {
      await sleep(Math.min(30_000, ((err.details as { retryAfter?: number })?.retryAfter ?? 2) * 1000 * (attempt + 1)), signal);
      continue;
    }
    throw err;
  }
}

// ---------- счёт ----------
export async function lumeanAccount() {
  const part = async <T>(fn: () => Promise<T>) => { try { return await fn(); } catch (e) { rethrowCancelled(e); if (e instanceof ApiError && e.code === "KEY_MISSING") throw e; return null; } };
  const [subs, wallets, usage] = await Promise.all([
    part(() => call<any>("GET", "/subscriptions")),
    part(() => call<any>("GET", "/wallets")),
    part(() => call<any[]>("GET", "/usage")),
  ]);
  const items = (subs?.subscriptions ?? []).flatMap((x: any) => x.items ?? []).filter((x: any) => x.is_usable !== false);
  return {
    plan: items.map((x: any) => x.plan?.name ?? x.plan?.code).filter(Boolean).join(", ") || null,
    tokensRemaining: items.length ? items.reduce((a: number, x: any) => a + (Number(x.tokens_remaining) || 0), 0) : null,
    tokenAllowance: items.length ? items.reduce((a: number, x: any) => a + (Number(x.token_allowance) || 0), 0) : null,
    periodEnd: subs?.subscriptions?.[0]?.current_period_end ?? null,
    balance: (wallets?.items ?? []).map((w: any) => ({ value: Number(w.balance_formatted ?? 0), locked: Number(w.locked_balance_formatted ?? 0), asset: w.asset?.code ?? w.asset?.symbol ?? "LMC" })),
    usage: (Array.isArray(usage) ? usage : []).map((u: any) => ({ service: u.service_code, type: u.limit_type, used: u.used, limit: u.limit_value, remaining: u.remaining })),
  };
}

// ---------- голоса ----------
export const VoiceQuery = z.object({
  service: z.enum(["elevenlabs", "cartesia", "heygen", "fishaudio"]).default("elevenlabs"),
  search: z.string().trim().max(100).default(""), language: z.string().trim().max(5).default(""),
  gender: z.enum(["", "male", "female"]).default(""), page: z.number().int().min(0).max(200).default(0), clones: z.boolean().default(false),
}).strict();
export type VoiceItem = { service: string; voiceId: string; name: string; language?: string; gender?: string; accent?: string; description?: string; previewUrl?: string; clone?: boolean };
export async function listVoices(raw: z.input<typeof VoiceQuery>): Promise<{ voices: VoiceItem[]; hasMore: boolean }> {
  const q = VoiceQuery.parse(raw);
  const qs = (o: Record<string, string | number | undefined>) => "?" + new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();
  const str = (x: unknown) => (typeof x === "string" && x ? x : undefined);
  if (q.service === "elevenlabs") {
    const d = await call<any>("GET", `/voices/elevenlabs/library${qs({ search: q.search, required_languages: q.language, gender: q.gender, page: q.page, page_size: 30 })}`);
    return { voices: (d?.voices ?? []).map((v: any) => ({ service: "elevenlabs", voiceId: v.voice_id, name: v.name ?? v.voice_id, language: str(v.language) ?? str(v.labels?.language), gender: str(v.gender) ?? str(v.labels?.gender), accent: str(v.accent) ?? str(v.labels?.accent), description: str(v.description)?.slice(0, 300), previewUrl: str(v.preview_url) })).filter((v: VoiceItem) => v.voiceId), hasMore: !!d?.has_more };
  }
  if (q.service === "heygen") {
    const d = await call<any>("GET", `/voices/heygen${qs({ search: q.search, language: q.language, gender: q.gender, page: q.page, page_size: 50 })}`);
    return { voices: (d?.voices ?? []).map((v: any) => ({ service: "heygen", voiceId: v.voice_id, name: v.display_name ?? v.voice_name ?? v.voice_id, language: str(v.language), gender: str(v.gender), accent: str(v.accent), previewUrl: str(v.preview_url) })).filter((v: VoiceItem) => v.voiceId), hasMore: !!d?.has_more };
  }
  // Cartesia / Fish Audio: страницы с 1; свои клоны — отдельный список (в шаблон идёт voice_id клона).
  if (q.clones) {
    const d = await call<any>("GET", `/voices/${q.service}/clones${qs({ status: "ready", page: q.page + 1 })}`);
    return { voices: (d?.items ?? []).filter((v: any) => v.voice_id).map((v: any) => ({ service: q.service, voiceId: v.voice_id, name: v.name ?? v.voice_id, language: str(v.language), clone: true })), hasMore: (d?.current_page ?? 1) < (d?.last_page ?? 1) };
  }
  const gender = q.service === "cartesia" ? (q.gender === "male" ? "masculine" : q.gender === "female" ? "feminine" : "") : q.gender;
  const d = await call<any>("GET", `/voices/${q.service}${qs({ search: q.search, language: q.language, gender, page: q.page + 1, per_page: 50 })}`);
  return { voices: (d?.items ?? []).map((v: any) => ({ service: q.service, voiceId: v.voice_id ?? v.id, name: v.name ?? v.voice_id, language: str(v.language), gender: str(v.gender), description: str(v.description)?.slice(0, 300), previewUrl: str(v.preview_url) })).filter((v: VoiceItem) => v.voiceId), hasMore: (d?.current_page ?? 1) < (d?.last_page ?? 1) };
}

// ---------- шаблон голоса канала ----------
const EL_LANGS = new Set("en ja zh de hi fr ko pt it es id nl tr fil pl sv bg ro ar cs el fi hr ms sk da ta uk ru".split(" "));
export function templateConfig(ch: Pick<Channel, "language" | "voice">): Record<string, unknown> {
  const v = ch.voice, lang = ch.language.slice(0, 2);
  if (!v.voiceId) throw new ApiError("VALIDATION", "Выберите голос канала: Каналы → профиль → Озвучка.", 400);
  if (v.service === "elevenlabs") return { tts_settings: { mode: "mode_v1", model_id: v.modelId || "eleven_multilingual_v2", voice_id: v.voiceId, ...(EL_LANGS.has(lang) ? { language_code: lang } : {}), advanced_voice_settings: true, prev_next_text: true, voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: v.speed } } };
  if (v.service === "cartesia") return { tts_settings: { voice_id: v.voiceId, model_id: v.modelId || "sonic-3", language_code: lang, voice_settings: { speed: v.speed } } };
  if (v.service === "heygen") return { tts_settings: { voice_id: v.voiceId, voice_engine: "elevenLabs", model_id: v.modelId === "eleven_v3" ? "eleven_v3" : "eleven_multilingual_v2", voice_settings: { stability: 0.5, ...(v.modelId === "eleven_v3" ? {} : { similarity_boost: 0.75 }), speed: v.speed } } };
  return { tts_settings: { voice_id: v.voiceId } };
}
const templateKey = (ch: Pick<Channel, "language" | "voice">) => crypto.createHash("sha256").update(JSON.stringify([ch.voice.service, templateConfig(ch)])).digest("hex").slice(0, 32);
/** Шаблон Lumean под голос канала: создаётся один раз и пересоздаётся только при смене голоса.
 *  «Мой шаблон» (Выпуск 2): берётся готовый шаблон пользователя как есть — TubeStudio его не меняет. */
export async function ensureTemplate(channelId: string): Promise<string> {
  const ch = await getChannel(channelId);
  if (ch.voice.templateSource === "mine") {
    if (!ch.voice.ownTemplateId) throw new ApiError("VALIDATION", "Выберите свой шаблон Lumean: Студия → Озвучка → «Мой шаблон».", 400);
    return ch.voice.ownTemplateId;
  }
  const k = templateKey(ch);
  if (ch.voice.templateId && ch.voice.templateKey === k) return ch.voice.templateId;
  const t = await call<any>("POST", "/templates", { service_key: ch.voice.service, name: `TubeStudio · ${ch.name}`.slice(0, 255), config: templateConfig(ch) });
  if (!t?.id) throw new ApiError("UPSTREAM", "Lumean не вернул номер шаблона", 502);
  await updateChannel(ch.id, { voice: { templateId: String(t.id), templateKey: k } });
  return String(t.id);
}

// ---------- «Мой шаблон»: готовые шаблоны пользователя в Lumean ----------
export const TemplateQuery = z.object({
  search: z.string().trim().max(100).default(""), service: z.enum(["", "elevenlabs", "cartesia", "heygen", "fishaudio"]).default(""),
  folderId: z.string().trim().regex(/^[\w-]{0,64}$/).default(""), page: z.number().int().min(1).max(500).default(1),
}).strict();
export type TemplateItem = { type: "template" | "folder"; id: string; name: string; service?: string; voiceId?: string; model?: string; mode?: string; isPublic?: boolean; count?: number; updatedAt?: string };
function templateItem(t: any): TemplateItem {
  const s = (x: unknown) => (typeof x === "string" && x ? x : undefined);
  if (t?.type === "folder") return { type: "folder", id: String(t.id), name: s(t.name) ?? "Папка", count: Number(t.templates_count) || 0, updatedAt: s(t.updated_at) };
  const tts = t?.config?.tts_settings ?? {};
  return { type: "template", id: String(t?.id ?? ""), name: s(t?.name) ?? String(t?.id ?? ""), service: s(t?.service_key) ?? s(t?.service?.code), voiceId: s(tts.voice_id), model: s(tts.model_id), mode: s(tts.mode), isPublic: !!t?.is_public, updatedAt: s(t?.updated_at) };
}
/** Список шаблонов: по папкам (как в кабинете Lumean) или поиском по названию. */
export async function listTemplates(raw: z.input<typeof TemplateQuery>) {
  const q = TemplateQuery.parse(raw);
  const qs = (o: Record<string, string | number>) => "?" + new URLSearchParams(Object.entries(o).filter(([, v]) => v !== "").map(([k, v]) => [k, String(v)])).toString();
  const page = (d: any) => ({ hasMore: !Array.isArray(d) && Number(d?.current_page ?? 1) < Number(d?.last_page ?? 1), total: Array.isArray(d) ? d.length : Number(d?.total ?? 0) || null });
  if (q.search) {
    const d = await call<any>("GET", `/templates${qs({ page: q.page, per_page: 30, search: q.search, service: q.service, folder_id: q.folderId })}`);
    const items = (Array.isArray(d) ? d : d?.items ?? []).map(templateItem).filter((t: TemplateItem) => t.id);
    return { items, page: q.page, ...page(d), folder: null as { id: string; name: string } | null, breadcrumbs: [] as { id: string; name: string }[] };
  }
  const d = await call<any>("GET", `/templates/browse${qs({ page: q.page, per_page: 50, service: q.service, folder_id: q.folderId })}`);
  const items = (Array.isArray(d) ? d : d?.items ?? []).map(templateItem).filter((t: TemplateItem) => t.id);
  const crumb = (x: any) => ({ id: String(x?.id ?? ""), name: String(x?.name ?? "") });
  return { items, page: q.page, ...page(d), folder: d?.current_folder ? crumb(d.current_folder) : null, breadcrumbs: Array.isArray(d?.breadcrumbs) ? d.breadcrumbs.map(crumb) : [] };
}
/** Один шаблон по номеру — для проверки вставленного ID. */
export async function getTemplate(id: string): Promise<TemplateItem> {
  if (!/^[\w-]{1,80}$/.test(id)) throw new ApiError("VALIDATION", "Номер шаблона Lumean выглядит неверно: скопируйте его из кабинета Lumean.", 400);
  const t = templateItem(await call<any>("GET", `/templates/${encodeURIComponent(id)}`));
  if (!t.id) throw new ApiError("NOT_FOUND", "Шаблон Lumean не найден", 404);
  return t;
}

// ---------- текст для озвучки (карточка 180: слова сценария не меняются, только разметка) ----------
export function voiceText(script: string, o: { paragraphPause?: string } = {}): string {
  const paras = script.replace(/\r\n?/g, "\n").split(/\n\s*\n+/).map((p) => p
    .replace(/\{\{\s*pause(?:\s*=\s*[\d.]+m?s)?\s*\}\}/gi, (m) => `\u0000${m.replace(/\s+/g, "")}\u0001`)
    .replace(/\[[^\]]{0,200}\]|<[^>]{0,200}>/g, " ")
    .replace(/\((?:[^()]{0,80})\)/g, " ")
    .replace(/^\s*(?:#{1,6}\s+|[-*•]\s+|\d{1,2}[.)]\s+)/gm, "")
    .replace(/^\s*\p{Lu}[\p{L}-]{1,15}(?: [\p{L}-]{1,15})?\s*:\s+/u, "")
    .replace(/[*_~`#|]+/g, " ")
    .replace(/\u0000/g, "").replace(/\u0001/g, "")
    .replace(/[ \t]+/g, " ").replace(/ +([,.!?…:;])/g, "$1").trim()).filter(Boolean);
  return paras.join(o.paragraphPause ? `\n\n${o.paragraphPause}\n\n` : "\n\n");
}
export const textHash = (text: string, templateId: string, mode: string) => crypto.createHash("sha256").update(`${templateId}\n${mode}\n${text}`).digest("hex");

// ---------- реестр заказов ----------
const REG = "studio/lumean-orders.json";
export type OrderRec = {
  hash: string; orderId?: string; templateId: string; mode: "whole" | "paragraph"; channelId: string; projectId?: string;
  name: string; chars: number; createdAt: string; status: string; uncertain?: boolean;
  files?: { path: string; local: string; bytes: number }[]; artifactId?: string; tokens?: number | null; durationMs?: number | null; error?: string;
};
type Registry = { version: 1; orders: Record<string, OrderRec> };
let regQueue: Promise<unknown> = Promise.resolve();
function withRegistry<T>(fn: (r: Registry) => T | Promise<T>): Promise<T> {
  const run = regQueue.then(async () => { const r = await readJson<Registry>(REG, { version: 1, orders: {} }); const out = await fn(r); await writeJson(REG, r, { backup: true }); return out; });
  regQueue = run.catch(() => {});
  return run;
}
export const lumeanOrders = async () => Object.values((await readJson<Registry>(REG, { version: 1, orders: {} })).orders).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
const terminal = new Set(["completed", "result_delivered", "failed", "compensated", "cancelled"]);
const dead = new Set(["failed", "compensated", "cancelled"]);

/** Бесплатная оценка: разбиение на части и стоимость без создания заказа. */
export async function estimateVoice(channelId: string, script: string, mode?: "whole" | "paragraph") {
  const ch = await getChannel(channelId);
  const templateId = await ensureTemplate(channelId);
  const m = mode ?? ch.voice.mode;
  const text = voiceText(script);
  const hash = textHash(text, templateId, m);
  const [preview, account, existing] = await Promise.all([
    call<any>("POST", "/orders/chunks/preview", { template_id: templateId, input_text: text, ...(m === "paragraph" ? { generation_mode: "paragraph" } : {}) }, { safe: true }).catch((e) => { rethrowCancelled(e); return { error: (e as Error).message }; }),
    lumeanAccount().catch((e) => { rethrowCancelled(e); return null; }),
    readJson<Registry>(REG, { version: 1, orders: {} }).then((r) => r.orders[hash] ?? null),
  ]);
  return { chars: text.length, paragraphs: text.split(/\n\n+/).length, mode: m, preview, account, existing, textPreview: text.slice(0, 600) };
}

export const VoiceOrderInput = z.object({
  channelId: z.string().uuid(), projectId: z.string().trim().max(80), artifactId: z.string().trim().max(80).optional(),
  text: z.string().max(200_000).optional(), mode: z.enum(["whole", "paragraph"]).optional(),
  /** Явное согласие на новый заказ того же текста (например, после смены голоса или неудачи). */
  again: z.boolean().default(false),
  /** Согласие на доплату с баланса Lumean сверх квоты — не больше этой суммы, LMC (запасной режим Lumean). */
  topupMaxLmc: z.number().min(0).max(100_000).optional(),
}).strict();

/** Озвучка сценария проекта: заказ → ожидание → скачивание → материал «audio» в проекте. */
export async function runVoice(raw: z.input<typeof VoiceOrderInput>, ctx: JobCtx) {
  const input = VoiceOrderInput.parse(raw);
  const ch = await getChannel(input.channelId);
  const { getProject, addArtifact } = await import("../projects.js");
  const p = await getProject(input.projectId);
  let script = input.text;
  if (!script) {
    const art = input.artifactId ? p.artifacts.find((a) => a.id === input.artifactId) : [...p.artifacts].reverse().find((a) => a.kind === "script");
    script = (art?.data as { script?: string } | undefined)?.script;
  }
  if (!script?.trim()) throw new ApiError("VALIDATION", "В проекте нет сценария для озвучки", 400);
  ctx.progress("Готовлю шаблон голоса в Lumean", 3);
  const templateId = await ensureTemplate(ch.id);
  const mode = input.mode ?? ch.voice.mode;
  const text = voiceText(script);
  if (text.length < 20) throw new ApiError("VALIDATION", "Текст для озвучки слишком короткий", 400);
  const hash = textHash(text, templateId, mode);
  const name = `TS-${hash.slice(0, 10)} ${p.title}`.slice(0, 120);

  // Защита от двойного заказа: тот же текст + голос + режим уже отправлялся.
  let rec = await withRegistry((r) => r.orders[hash] ?? null);
  if (rec?.uncertain && !rec.orderId) rec = await findLostOrder(rec);
  if (rec?.orderId && !(dead.has(rec.status) && input.again)) {
    if (rec.status === "completed" && rec.files?.length && rec.projectId === p.id) return { orderId: rec.orderId, reused: true, status: rec.status, files: rec.files, artifactId: rec.artifactId };
    ctx.progress("Этот текст уже отправлен в Lumean — продолжаю тот же заказ", 8);
  } else if (rec?.uncertain && !input.again) {
    throw new ApiError("VALIDATION", "Прошлая отправка этого текста оборвалась, и заказ в Lumean не найден. Проверьте раздел «Заказы» в кабинете Lumean; если заказа нет — нажмите «Озвучить ещё раз».", 409);
  } else {
    ctx.progress("Отправляю текст в Lumean одним заказом", 10);
    const base: OrderRec = { hash, templateId, mode, channelId: ch.id, projectId: p.id, name, chars: text.length, createdAt: new Date().toISOString(), status: "sending", uncertain: true };
    await withRegistry((r) => { r.orders[hash] = base; });
    let order: any;
    const orderBody = { template_id: templateId, input_text: text, name, ...(mode === "paragraph" ? { config_override: { generation_mode: "paragraph" } } : {}) };
    try {
      try { order = await call<any>("POST", "/orders", orderBody); }
      catch (e) {
        // Доплата подтверждается только в пределах суммы, которую пользователь уже видел и разрешил.
        const d = e instanceof ApiError && e.code === "LUMEAN_PAYG_REQUIRED" ? e.details as { quoteToken?: string; topupLmc?: number } | undefined : undefined;
        if (!d?.quoteToken || input.topupMaxLmc === undefined || (d.topupLmc ?? Infinity) > input.topupMaxLmc + 1e-9) throw e;
        ctx.progress(`Подтверждаю доплату ${d.topupLmc?.toFixed(2)} LMC и создаю заказ`, 11);
        order = await call<any>("POST", "/orders", { ...orderBody, confirm_payg_topup: true, quote_token: d.quoteToken });
      }
    }
    catch (e) {
      const uncertain = !!(e as ApiError)?.details && ((e as ApiError).details as { uncertain?: boolean }).uncertain;
      await withRegistry((r) => { if (uncertain) r.orders[hash] = { ...base, status: "unknown" }; else delete r.orders[hash]; });
      // Котировка Lumean остаётся на сервере: интерфейсу нужна только сумма доплаты.
      if (e instanceof ApiError && e.code === "LUMEAN_PAYG_REQUIRED" && e.details) { const { quoteToken: _q, ...rest } = e.details as Record<string, unknown>; throw new ApiError(e.code, e.message, e.status, e.retryable, rest); }
      throw e;
    }
    rec = { ...base, orderId: String(order.id), status: String(order.status ?? "created"), uncertain: false };
    await withRegistry((r) => { r.orders[hash] = rec!; });
    log.info({ event: "lumean_order_created", orderId: rec.orderId, chars: text.length, mode });
  }

  // Ожидание: опрос раз в 5 с; упавшие части — один повтор (бесплатно, из заблокированной суммы).
  // Короткие сбои связи во время ожидания не обрывают работу: заказ уже оплачен и идёт у Lumean.
  const orderId = rec!.orderId!;
  let retriedAt = 0, o: any, misses = 0;
  const until = Date.now() + LUMEAN_POLL.maxMinutes * 60_000;
  const busyItem = (x: any) => ["created", "pending", "in_progress", "queued", "processing"].includes(String(x?.status ?? ""));
  for (;;) {
    try { o = await call<any>("GET", `/orders/${encodeURIComponent(orderId)}`); misses = 0; }
    catch (e) {
      rethrowCancelled(e);
      if (!(e instanceof ApiError) || !e.retryable || ++misses > 6 || Date.now() > until) throw e;
      ctx.progress("Lumean временно не отвечает — жду и проверяю заказ снова", 12);
      await sleep(LUMEAN_POLL.ms * 2, taskSignal());
      continue;
    }
    const st = String(o?.status ?? "");
    await withRegistry((r) => { const x = r.orders[hash]; if (x) { x.status = st; x.tokens = o.tokens_spent ?? o.total_tokens ?? null; x.durationMs = o.total_duration_ms ?? null; } });
    ctx.progress(`Lumean озвучивает: ${o?.completed_chunks ?? 0} из ${o?.total_chunks ?? "?"} частей${o?.eta_seconds ? ` · ещё ≈${Math.ceil(o.eta_seconds / 60)} мин` : ""}`, 12 + Math.round(Math.min(100, Number(o?.progress_percent) || 0) * 0.7));
    if (terminal.has(st)) break;
    if (st === "partially_completed") {
      if (!retriedAt) {
        retriedAt = Date.now();
        ctx.progress("Часть фрагментов не удалась — отправляю их на повтор (бесплатно)", 50);
        await call("POST", `/orders/${encodeURIComponent(orderId)}/items/retry-failed`, {}, { safe: true }).catch((e) => { rethrowCancelled(e); log.warn({ event: "lumean_retry_failed", error: (e as Error).message }); });
      } else if (Date.now() - retriedAt > 30_000 && !(o?.items ?? []).some(busyItem)) break;
    }
    if (Date.now() > until) throw new ApiError("UPSTREAM", `Lumean ещё озвучивает (заказ ${orderId}). Нажмите «Озвучить» позже — TubeStudio продолжит этот же заказ, без повторной оплаты.`, 504, true);
    await sleep(LUMEAN_POLL.ms, taskSignal());
  }
  const st = String(o.status);
  if (dead.has(st)) {
    await withRegistry((r) => { const x = r.orders[hash]; if (x) x.error = o?.result?.user_message ?? st; });
    throw new ApiError("UPSTREAM", `Lumean не смог озвучить текст (${st}).${o?.result?.user_message ? ` ${o.result.user_message}` : ""} Деньги за несостоявшиеся части Lumean возвращает сам. Чтобы отправить текст заново, нажмите «Озвучить ещё раз».`, 502);
  }
  const failedItems = (o?.items ?? []).filter((x: any) => ["failed", "policy_flagged"].includes(String(x?.status ?? "")));

  // Скачиваем сразу: Lumean хранит файлы 7 дней.
  ctx.progress("Скачиваю аудио, субтитры и тайминги в папку проекта", 86);
  const paths: string[] = [...(o.result?.files ?? []), ...(o.result?.service_files ?? [])].filter((x: unknown): x is string => typeof x === "string");
  if (!paths.length && st === "partially_completed") {
    const why = failedItems.map((x: any) => x?.failure_reason).filter(Boolean).slice(0, 2).join("; ");
    await withRegistry((r) => { const x = r.orders[hash]; if (x) x.error = why || "partially_completed"; });
    throw new ApiError("UPSTREAM", `Lumean озвучил не весь текст: ${failedItems.length || "несколько"} фрагм. не прошли${why ? ` (${why})` : ""}. Обычно это спорная формулировка — перефразируйте её в сценарии и нажмите «Озвучить ещё раз». Готовые части уже оплачены.`, 502, false, { orderId, failed: failedItems.length });
  }
  if (!paths.length) throw new ApiError("UPSTREAM", "Lumean не отдал файлы озвучки", 502);
  const dirRel = path.posix.join("voice", orderId.replace(/[^\w-]/g, ""));
  const dir = dataPath("files", p.id.replace(/[^\w-]/g, ""), ...dirRel.split("/"));
  await fs.mkdir(dir, { recursive: true });
  const files: OrderRec["files"] = [];
  for (const fp of paths) {
    const { url } = await call<{ url: string }>("POST", "/storage/url", { path: fp }, { safe: true });
    const res = await fetcher(url, { signal: AbortSignal.any([AbortSignal.timeout(300_000), ...(taskSignal() ? [taskSignal()!] : [])]) });
    if (!res.ok) throw new ApiError("UPSTREAM", `Файл озвучки не скачался (HTTP ${res.status}). Нажмите «Озвучить» ещё раз — заказ не повторится.`, 502, true);
    const buf = Buffer.from(await res.arrayBuffer());
    const base = path.posix.basename(fp).replace(/[^\w.\-]/g, "_") || "file";
    await fs.writeFile(path.join(dir, base), buf);
    files.push({ path: fp, local: `${dirRel}/${base}`, bytes: buf.length });
  }
  const audio = files.find((f) => /\.(mp3|wav|ogg|m4a)$/i.test(f.local));
  const mine = ch.voice.templateSource === "mine" && templateId === ch.voice.ownTemplateId;
  const art = await addArtifact(p.id, {
    kind: "audio", title: `Озвучка Lumean · ${mine ? `шаблон «${ch.voice.ownTemplateName || ch.voice.ownTemplateId}»` : ch.voice.voiceName || ch.voice.voiceId}`.slice(0, 300), files: files.map((f) => f.local),
    data: { source: "lumean", orderId, status: st, mode, voice: mine ? { service: ch.voice.service, voiceId: "", name: ch.voice.ownTemplateName || "Мой шаблон", templateId: ch.voice.ownTemplateId, own: true } : { service: ch.voice.service, voiceId: ch.voice.voiceId, name: ch.voice.voiceName }, chars: text.length, tokens: o.tokens_spent ?? o.total_tokens ?? null, tokensFromQuota: o.tokens_from_quota ?? null, tokensFromPayg: o.tokens_from_payg ?? null, durationMs: o.total_duration_ms ?? null, audio: audio?.local, subtitles: files.filter((f) => /\.(srt|vtt)$/i.test(f.local)).map((f) => f.local), timings: files.find((f) => /result\.json$|alignment/i.test(f.local))?.local ?? null, text, partial: st === "partially_completed", failedParts: failedItems.length },
  });
  await withRegistry((r) => { const x = r.orders[hash]; if (x) { x.files = files; x.artifactId = art.id; x.projectId = p.id; } });
  ctx.progress("Готово", 100);
  return { orderId, reused: false, status: st, files, artifactId: art.id, partial: st === "partially_completed" };
}

/** Отправка оборвалась: ищем заказ по имени среди последних, чтобы не заплатить дважды. */
async function findLostOrder(rec: OrderRec): Promise<OrderRec> {
  try {
    const list = await call<any>("GET", `/orders?per_page=50&page=1`);
    const hit = (list?.items ?? list?.data ?? []).find((x: any) => x?.name === rec.name);
    if (!hit?.id) return rec;
    const found: OrderRec = { ...rec, orderId: String(hit.id), status: String(hit.status ?? "created"), uncertain: false };
    await withRegistry((r) => { r.orders[rec.hash] = found; });
    return found;
  } catch (e) { rethrowCancelled(e); return rec; }
}
