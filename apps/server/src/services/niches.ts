import crypto from "node:crypto";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import type { JobCtx } from "../lib/jobs.js";
import { dataPath, writeJson } from "../lib/storage.js";
import { checkCancelled, rethrowCancelled, withTaskSignal } from "../lib/taskContext.js";
import { LANG_NAME } from "./llm.js";
import { getSettings } from "./settings.js";
import { getChannelsFull, latestUploads, resolveChannel, searchChannels, type Channel, type Video } from "./youtube.js";

export const NicheInput = z.object({
  mode: z.enum(["topic", "channel"]).default("topic"),
  q: z.string().trim().max(200).default(""),
  channel: z.string().trim().max(300).default(""),
  language: z.string().refine(v => Object.hasOwn(LANG_NAME, v), "Неизвестный язык").optional(),
  limit: z.number().int().min(1).max(20).default(10),
  sample: z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(50)]).default(20),
  type: z.enum(["all", "long", "shorts"]).default("all"),
  rpmNiche: z.string().max(120).optional(),
  force: z.boolean().default(false),
}).strict().superRefine((v, ctx) => {
  if (v.mode === "topic" && v.q.length < 2) ctx.addIssue({ code: "custom", path: ["q"], message: "Введите тему от 2 символов" });
  if (v.mode === "channel" && v.channel.length < 3) ctx.addIssue({ code: "custom", path: ["channel"], message: "Укажите ссылку, @handle или ID канала" });
});
export type NicheInputT = z.infer<typeof NicheInput>;
type Rpm = { niche: string; min: number; max: number };
export type NicheEvidence = {
  evaluatedAt: string; source: "fresh" | "cache-possible"; uploadsState: "available" | "failed";
  channelPublishedAt: string; channelDescription: string; subscriberStatus: "known" | "hidden" | "missing";
  uploads: { id: string; title: string; channelId: string; publishedAt: string; durationSec: number | null; views: number | null }[];
};
export type NicheBasis = { entries: { position: number; id: string; viewsIncluded: boolean; frequencyIncluded: boolean; reasons: string[] }[]; frequency: { count: number; first: string | null; last: string | null; spanDays: number | null }; };
export type NicheRow = {
  id: string; title: string; url: string; seed: boolean; subscribers: number | null;
  ageDays: number | null; lastUploadDays: number | null; sampled: number; selected: number; mature: number;
  averageViews: number | null; medianViews: number | null; uploadsPerWeek: number | null;
  textMatchPct: number; monetization: "unknown";
  revenuePerVideo: { min: number; max: number } | null; warnings: string[];
  evidence?: NicheEvidence; basis?: NicheBasis;
};
export type NicheRun = {
  version: 1 | 2; id: string; createdAt: string; input: NicheInputT; query: string; language: string;
  seed: { id: string; title: string } | null; rows: NicheRow[]; warnings: string[];
  searchIds?: string[]; quotaEstimate: number; rpm: { long: Rpm; shorts: Rpm };
  summary: { candidates: number; knownSubscribers: number; establishedPct: number | null; label: string };
};
const DAY = 86400000;
const round = (n: number) => Math.round(n * 100) / 100;
const timestamp = (s: string, now: number) => { const t = Date.parse(s); return Number.isFinite(t) && t <= now ? t : null; };
const avg = (ns: number[]) => ns.reduce((s, n) => s + n, 0) / ns.length;
const median = (ns: number[]) => { const s = [...ns].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const nicheQuotaEstimate = (limit: number, seed: boolean) => 101 + limit * 2 + (seed ? 104 : 0);
const normalizeRpm = (r: Rpm): Rpm => ({ ...r, min: Math.min(r.min, r.max), max: Math.max(r.min, r.max) });

/** No LLM/semantic similarity: literal normalized token coverage, explicitly labelled in the UI. */
export function textMatch(query: string, text: string): number {
  const tokens = [...new Set(query.toLocaleLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [])];
  const haystack = text.toLocaleLowerCase().normalize("NFKC");
  return tokens.length ? Math.round(100 * tokens.filter(t => haystack.includes(t)).length / tokens.length) : 0;
}
export function buildNicheRow(ch: Channel, videos: Video[], input: NicheInputT, query: string, rpm: NicheRun["rpm"], now = Date.now(), seed = false): NicheRow {
  // Freeze only the public fields used by the formulas. Never turn unknowns into zero.
  const counter = (n: number, known?: boolean) => known === true && Number.isSafeInteger(n) && n >= 0 ? n : null;
  const evidence: NicheEvidence = {
    evaluatedAt: new Date(now).toISOString(), source: input.force ? "fresh" : "cache-possible", uploadsState: "available",
    channelPublishedAt: ch.publishedAt, channelDescription: ch.description,
    subscriberStatus: ch.hiddenSubscribers ? "hidden" : counter(ch.subscribers, ch.subscriberCountKnown) === null ? "missing" : "known",
    uploads: videos.map(v => ({ id: v.id, title: v.title, channelId: v.channelId, publishedAt: v.publishedAt,
      durationSec: v.durationKnown !== false && Number.isFinite(v.durationSec) && v.durationSec > 0 ? v.durationSec : null,
      views: counter(v.views, v.viewsKnown) })),
  };
  const seen = new Set<string>();
  const entries = evidence.uploads.map((v, i) => {
    const duplicate = seen.has(v.id); seen.add(v.id);
    const t = timestamp(v.publishedAt, now), format = input.type === "all" || (v.durationSec !== null && (input.type === "shorts" ? v.durationSec <= 180 : v.durationSec > 180));
    const eligible = !duplicate && v.channelId === ch.id && t !== null && format;
    const reasons: string[] = [];
    if (duplicate) reasons.push("Повтор ID");
    if (v.channelId !== ch.id) reasons.push("Другой канал");
    if (t === null) reasons.push("Некорректная или будущая дата");
    if (!format) reasons.push(v.durationSec === null ? "Длительность неизвестна для фильтра" : "Не выбранная группа длительности");
    if (t !== null && now - t < 2 * DAY) reasons.push("Младше 48 часов");
    if (v.views === null) reasons.push("Просмотры неизвестны");
    return { position: i + 1, id: v.id, viewsIncluded: eligible && now - t! >= 2 * DAY && v.views !== null, frequencyIncluded: eligible, reasons };
  });
  const relevant = evidence.uploads.filter((v, i) => v.channelId === ch.id && !entries[i].reasons.includes("Повтор ID"));
  const valid = relevant.filter(v => timestamp(v.publishedAt, now) !== null);
  const selected = evidence.uploads.filter((_, i) => entries[i].frequencyIncluded);
  const mature = evidence.uploads.filter((_, i) => entries[i].viewsIncluded);
  const dates = selected.map(v => Date.parse(v.publishedAt));
  const span = dates.length >= 2 ? (Math.max(...dates) - Math.min(...dates)) / DAY : 0;
  const age = timestamp(ch.publishedAt, now);
  const warnings: string[] = [];
  if (!videos.length) warnings.push("Публичные загрузки не найдены.");
  if (entries.some(e => e.reasons.includes("Повтор ID") || e.reasons.includes("Другой канал"))) warnings.push("Повторные ID и видео другого канала исключены из расчётов.");
  if (valid.length !== relevant.length) warnings.push("Видео с неверной или будущей датой исключены.");
  if (!mature.length) warnings.push("Нет подходящих видео с известными просмотрами старше 48 часов: показатели просмотров неизвестны.");
  if (selected.some(v => v.views === null)) warnings.push("У части видео просмотры недоступны; они исключены из среднего и медианы. Для старого кеша включите обновление данных.");
  if (span < 1) warnings.push("Для частоты публикаций нужен интервал не менее суток между двумя видео.");
  const revenues = mature.filter(v => v.durationSec !== null).map(v => ({ min: v.views! * (v.durationSec! <= 180 ? rpm.shorts.min : rpm.long.min) / 1000, max: v.views! * (v.durationSec! <= 180 ? rpm.shorts.max : rpm.long.max) / 1000 }));
  return {
    id: ch.id, title: ch.title, url: `https://www.youtube.com/channel/${encodeURIComponent(ch.id)}`, seed,
    subscribers: evidence.subscriberStatus === "known" ? ch.subscribers : null,
    ageDays: age === null ? null : Math.floor((now - age) / DAY),
    lastUploadDays: valid.length ? Math.floor((now - Math.max(...valid.map(v => Date.parse(v.publishedAt)))) / DAY) : null,
    sampled: videos.length, selected: selected.length, mature: mature.length,
    averageViews: mature.length ? round(avg(mature.map(v => v.views!))) : null,
    medianViews: mature.length ? round(median(mature.map(v => v.views!))) : null,
    uploadsPerWeek: dates.length >= 2 && span >= 1 ? round((dates.length - 1) * 7 / span) : null,
    textMatchPct: textMatch(query, [ch.title, ch.description, ...relevant.map(v => v.title)].join(" ")),
    monetization: "unknown",
    revenuePerVideo: mature.length && revenues.length === mature.length ? { min: round(avg(revenues.map(v => v.min))), max: round(avg(revenues.map(v => v.max))) } : null,
    warnings, evidence,
    basis: { entries, frequency: { count: dates.length, first: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
      last: dates.length ? new Date(Math.max(...dates)).toISOString() : null, spanDays: dates.length >= 2 ? span : null } },
  };
}
export function summarizeNiche(rows: NicheRow[]): NicheRun["summary"] {
  const candidates = rows.filter(r => !r.seed), known = candidates.filter(r => r.subscribers !== null);
  const pct = known.length >= 5 && known.length >= candidates.length * .7 ? Math.round(100 * known.filter(r => r.subscribers! >= 100000).length / known.length) : null;
  return { candidates: candidates.length, knownSubscribers: known.length, establishedPct: pct, label: pct === null ? "Недостаточно известных подписчиков для описательной доли" : `Доля каналов от 100 тыс. подписчиков: ${pct}% (только выборка)` };
}

export async function runNicheSearch(input: NicheInputT, ctx: JobCtx): Promise<NicheRun> {
  return withTaskSignal(ctx.signal, async () => {
    input = NicheInput.parse(input);
    checkCancelled();
    const settings = await getSettings();
    const language = input.language ?? settings.contentLanguage;
    const long = input.rpmNiche ? settings.rpm.find(r => r.niche === input.rpmNiche && r.niche !== "Shorts") : settings.rpm.find(r => r.niche !== "Shorts");
    const shorts = settings.rpm.find(r => r.niche === "Shorts");
    if (!long || !shorts) throw new ApiError("VALIDATION", "Проверьте выбранную ставку RPM и строки длинных видео / Shorts в Настройках.");
    const rpm = { long: normalizeRpm(long), shorts: normalizeRpm(shorts) };
    ctx.progress("Определяю тему поиска", 5);
    const seed = input.mode === "channel" ? await resolveChannel(input.channel, input.force) : null;
    checkCancelled();
    // User-supplied topic wins. Quoted branding keywords are kept as phrases, bounded to three.
    const keywords = seed?.keywords?.match(/"[^"]+"|\S+/g)?.slice(0, 3).map(s => s.replaceAll('"', "")).join(" ");
    const query = (input.q || keywords || seed?.title || "").slice(0, 200);
    ctx.progress("Поиск каналов по текстовому запросу", 10);
    const ids = await searchChannels(query, input.limit, language, input.force);
    checkCancelled();
    const channels = await getChannelsFull(ids.filter(id => id !== seed?.id), input.force);
    const warnings: string[] = [];
    const missing = ids.filter(id => id !== seed?.id && !channels.has(id));
    if (missing.length) warnings.push(`Данные ${missing.length} каналов недоступны: они не включены в сравнение.`);
    const all = [...(seed ? [seed] : []), ...ids.filter(id => id !== seed?.id).map(id => channels.get(id)).filter((c): c is Channel => !!c)];
    const rows: NicheRow[] = [];
    for (const [i, ch] of all.entries()) {
      checkCancelled(); ctx.progress(`Загрузки ${i + 1}/${all.length}: ${ch.title.slice(0, 60)}`, 20 + Math.round(70 * i / Math.max(1, all.length)));
      try {
        const videos = await latestUploads(ch.uploadsPlaylistId, input.sample, input.force);
        checkCancelled(); rows.push(buildNicheRow(ch, videos, input, query, rpm, Date.now(), ch.id === seed?.id));
      } catch (e) {
        rethrowCancelled(e, ctx.signal);
        if (e instanceof ApiError && ["YT_QUOTA", "KEY_MISSING"].includes(e.code)) throw e;
        const row = buildNicheRow(ch, [], input, query, rpm, Date.now(), ch.id === seed?.id);
        row.evidence!.uploadsState = "failed";
        row.warnings = ["Не удалось получить загрузки. Показатели видео неизвестны; повторите поиск с обновлением кеша."];
        rows.push(row); warnings.push(`Не удалось получить загрузки: ${ch.title}.`);
      }
      ctx.partial({ rows: [...rows], query, saved: false });
    }
    checkCancelled();
    const run: NicheRun = { version: 2, id: crypto.randomUUID(), createdAt: new Date().toISOString(), input, query, language,
      seed: seed ? { id: seed.id, title: seed.title } : null, rows, warnings,
      searchIds: ids, quotaEstimate: nicheQuotaEstimate(input.limit, !!seed), rpm, summary: summarizeNiche(rows) };
    try {
      validateRun(run);
      await nicheDirectory(true);
      await writeJson(`niche-runs/${run.id}.json`, run);
      checkCancelled();
    } catch (e) {
      // A cancellation during atomic disk commit must not leave a completed history entry.
      if (ctx.signal.aborted) await fs.rm(dataPath(`niche-runs/${run.id}.json`), { force: true });
      throw e;
    }
    ctx.progress("Сравнение сохранено", 100); return run;
  }).catch(e => {
    rethrowCancelled(e, ctx.signal);
    if (e instanceof ApiError && e.code === "VALIDATION") throw e;
    if (e instanceof ApiError && ["KEY_MISSING", "YT_QUOTA"].includes(e.code)) throw new ApiError(e.code, e.code === "KEY_MISSING" ? "Укажите ключ YouTube в Настройках." : "Квота YouTube исчерпана.", e.status);
    throw new ApiError("UPSTREAM", "Не удалось получить или сохранить сравнение. Прежний результат не изменён; уже отправленные запросы расходуют квоту.", 502);
  });
}
// A bounded, schema-checked local history. Version 1 is a labelled legacy snapshot;
// version 2 metrics are recomputed from frozen inputs, not trusted cached aggregates.
const Count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const Metric = z.number().finite().nonnegative().nullable();
const ShortText = z.string().max(2000), Stamp = z.string().datetime();
const EvidenceSchema = z.object({ evaluatedAt: Stamp, source: z.enum(["fresh", "cache-possible"]), uploadsState: z.enum(["available", "failed"]),
  channelPublishedAt: z.string().max(100), channelDescription: z.string().max(20000), subscriberStatus: z.enum(["known", "hidden", "missing"]),
  uploads: z.array(z.object({ id: z.string().min(1).max(128), title: ShortText, channelId: z.string().max(128), publishedAt: z.string().max(100), durationSec: z.number().finite().positive().nullable(), views: Count }).strict()).max(50),
}).strict();
const RowSchema = z.object({ id: z.string().regex(/^UC[\w-]{22}$/), title: ShortText, url: ShortText, seed: z.boolean(), subscribers: Count,
  ageDays: Metric, lastUploadDays: Metric, sampled: z.number().int().min(0).max(50), selected: z.number().int().min(0).max(50), mature: z.number().int().min(0).max(50),
  averageViews: Metric, medianViews: Metric, uploadsPerWeek: Metric, textMatchPct: z.number().min(0).max(100), monetization: z.literal("unknown"),
  revenuePerVideo: z.object({ min: z.number().finite().nonnegative(), max: z.number().finite().nonnegative() }).nullable(), warnings: z.array(ShortText).max(100), evidence: EvidenceSchema.optional(), basis: z.unknown().optional(),
}).strict();
const RpmSchema = z.object({ niche: z.string().max(120), min: z.number().finite().nonnegative(), max: z.number().finite().nonnegative() }).strict();
const RunSchema = z.object({ version: z.union([z.literal(1), z.literal(2)]), id: z.string().uuid(), createdAt: Stamp, input: NicheInput, query: z.string().max(200), language: z.string().max(20),
  seed: z.object({ id: z.string().regex(/^UC[\w-]{22}$/), title: ShortText }).nullable(), rows: z.array(RowSchema).max(21), warnings: z.array(ShortText).max(100),
  searchIds: z.array(z.string().regex(/^UC[\w-]{22}$/)).max(20).optional(),
  quotaEstimate: z.number().finite().nonnegative(), rpm: z.object({ long: RpmSchema, shorts: RpmSchema }),
  summary: z.object({ candidates: z.number().int().min(0).max(20), knownSubscribers: z.number().int().min(0).max(20), establishedPct: Metric, label: ShortText }),
}).strict();
function validateRun(run: unknown): NicheRun {
  const r = RunSchema.parse(run) as NicheRun;
  if (r.version === 1) {
    if (r.rows.some(x => x.evidence !== undefined || x.basis !== undefined)) throw Error("Invalid niche evidence");
    return r;
  }
  if (!r.searchIds || new Set(r.searchIds).size !== r.searchIds.length || r.searchIds.length > r.input.limit || r.rows.some(x => !x.seed && !r.searchIds!.includes(x.id)) || new Set(r.rows.map(x => x.id)).size !== r.rows.length || r.rows.some(x => !x.evidence || x.evidence.source !== (r.input.force ? "fresh" : "cache-possible") || (x.evidence.subscriberStatus === "known") !== (x.subscribers !== null) || x.evidence.uploads.length > r.input.sample || (x.evidence.uploadsState === "failed" && x.evidence.uploads.length)) || r.rows.filter(x => x.seed).length !== (r.seed ? 1 : 0) || r.rows.some(x => x.seed !== (x.id === r.seed?.id))) throw Error("Invalid niche evidence");
  r.rows = r.rows.map(row => {
    const e = row.evidence!;
    const ch: Channel = { id: row.id, title: row.title, description: e.channelDescription, publishedAt: e.channelPublishedAt, subscribers: row.subscribers ?? 0,
      subscriberCountKnown: e.subscriberStatus === "known", hiddenSubscribers: e.subscriberStatus === "hidden", totalViews: 0, videoCount: 0, uploadsPlaylistId: "" };
    const videos: Video[] = e.uploads.map(v => ({ ...v, views: v.views ?? 0, viewsKnown: v.views !== null, durationSec: v.durationSec ?? 0, durationKnown: v.durationSec !== null, isShort: v.durationSec !== null && v.durationSec <= 180, description: "", likes: 0, comments: 0, tags: [], channelTitle: row.title }));
    const result = buildNicheRow(ch, videos, r.input, r.query, r.rpm, Date.parse(e.evaluatedAt), row.seed);
    result.evidence = e;
    if (e.uploadsState === "failed") result.warnings = ["Не удалось получить загрузки. Показатели видео неизвестны; повторите поиск с обновлением кеша."];
    return result;
  });
  r.summary = summarizeNiche(r.rows); return r;
}
const MAX_BYTES = 4 * 1024 * 1024;
async function nicheDirectory(create = false) {
  const dir = dataPath("niche-runs"); if (create) await fs.mkdir(dir, { recursive: true });
  try { const st = await fs.lstat(dir); if (!st.isDirectory() || st.isSymbolicLink()) throw new ApiError("VALIDATION", "Каталог сравнений недоступен"); return dir; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
}
export async function loadNicheRun(id: string): Promise<NicheRun | null> {
  if (!z.string().uuid().safeParse(id).success || !await nicheDirectory()) return null;
  let file;
  try {
    const p = dataPath("niche-runs", id + ".json"), st = await fs.lstat(p);
    if (!st.isFile() || st.isSymbolicLink() || st.size > MAX_BYTES) return null;
    file = await fs.open(p, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const b = Buffer.alloc(MAX_BYTES + 1); let n = 0;
    while (n < b.length) { const r = await file.read(b, n, b.length - n, null); if (!r.bytesRead) break; n += r.bytesRead; }
    if (n > MAX_BYTES) return null;
    const r = validateRun(JSON.parse(b.subarray(0, n).toString("utf8"))); return r.id === id ? r : null;
  } catch (e) {
    if (e instanceof SyntaxError || e instanceof z.ZodError || (e as Error).message === "Invalid niche evidence" || ["ENOENT", "ELOOP"].includes((e as NodeJS.ErrnoException).code ?? "")) return null;
    throw e;
  } finally { await file?.close(); }
}
export async function listNicheRuns() {
  const dir = await nicheDirectory(); if (!dir) return [];
  const files = await fs.readdir(dir);
  if (files.length > 5000) throw new ApiError("VALIDATION", "Более 5000 файлов сравнений: архивируйте часть при остановленном сервере");
  const rows = [];
  for (const name of files) {
    if (!name.endsWith(".json") || !z.string().uuid().safeParse(name.slice(0, -5)).success) continue;
    const r = await loadNicheRun(name.slice(0, -5));
    if (r) rows.push({ id: r.id, createdAt: r.createdAt, query: r.query, channels: r.rows.length, warnings: r.warnings.length });
  }
  return rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id)).slice(0, 50);
}
