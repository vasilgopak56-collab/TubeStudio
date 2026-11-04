import { rethrowCancelled } from "../lib/taskContext.js";
import crypto from "node:crypto";
import { z } from "zod";
import type { JobCtx } from "../lib/jobs.js";
import { fetchRetry } from "../lib/http.js";
import { cached } from "../lib/cache.js";
import { readJson, writeJson } from "../lib/storage.js";
import { getSettings } from "./settings.js";
import { getChannelsFull, getVideos, searchPaged } from "./youtube.js";
import { median } from "./metrics.js";
import { generateJson, LANG_NAME } from "./llm.js";

const DAY = 86400_000;
const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

export const KeywordInput = z.object({
  seed: z.string().trim().min(2, "Введите ключевое слово").max(120),
  language: z.string().max(5).optional(),
  region: z.string().max(2).optional(),
  depth: z.enum(["fast", "deep"]).optional(),
  analyzeTop: z.number().int().min(0).max(15).optional(),
});
export type KeywordInputT = z.infer<typeof KeywordInput>;
export type Level = "low" | "medium" | "high";
export type KwMetrics = { volume: number; volumeScore: number; competition: number; level: Level; overall: number; medianSubs: number; medianViews: number; titleMatch: number; smallChannels: number; top: { id: string; title: string; channelTitle: string; views: number; subs: number; thumbnail?: string; ageDays: number }[]; tags: string[] };
export type Keyword = { keyword: string; auto: number; sources: number; metrics?: KwMetrics };
export type KeywordRun = { id: string; createdAt: string; input: KeywordInputT & { language: string }; keywords: Keyword[]; related: { tag: string; count: number }[]; units: number };

const QWORDS: Record<string, string[]> = {
  ru: ["как", "почему", "что", "зачем", "кто", "лучшие", "топ", "история"],
  uk: ["як", "чому", "що", "найкращі", "топ"],
  sr: ["како", "зашто", "шта", "најбољи"], fr: ["comment", "pourquoi", "quoi", "meilleur"], pt: ["como", "por que", "o que", "melhor"], es: ["cómo", "por qué", "qué", "mejor"], it: ["come", "perché", "cosa", "migliore"], de: ["wie", "warum", "was", "beste"], he: ["איך", "למה", "מה"], ar: ["كيف", "لماذا", "ما"], vi: ["cách", "tại sao", "là gì"], ja: ["方法", "なぜ", "とは"], ko: ["방법", "왜", "무엇"], zh: ["如何", "为什么", "什么"], id: ["cara", "mengapa", "apa"], hi: ["कैसे", "क्यों", "क्या"], tr: ["nasıl", "neden", "nedir"], pl: ["jak", "dlaczego", "co", "najlepszy"],
  en: ["how", "why", "what", "best", "top", "who", "history of"],
};
const ALPHA: Record<string, string> = { ru: "абвгдежзиклмнопрстуфхцчшэюя", uk: "абвгдеєжзиіїклмнопрстуфхцчшщюя", en: "abcdefghijklmnopqrstuvwxyz" };

async function suggest(q: string, hl: string, gl?: string): Promise<string[]> {
  return cached(`sug:${hl}:${gl}:${q}`, 24 * 3600_000, async () => {
    const u = `https://suggestqueries.google.com/complete/search?${new URLSearchParams({ client: "firefox", ds: "yt", hl, oe: "utf8", q, ...(gl ? { gl } : {}) })}`;
    try { const r = await fetchRetry(u, { headers: { "User-Agent": "Mozilla/5.0" } }, { timeoutMs: 8000, retries: 1 }); if (!r.ok) return []; const j: any = await r.json(); return Array.isArray(j?.[1]) ? j[1].map(String) : []; }
    catch (e) { rethrowCancelled(e); return []; }
  });
}

/** Подсказки YouTube (бесплатно) + балл спроса по позициям */
export async function suggestions(seed: string, lang: string, region: string | undefined, depth: "fast" | "deep", max = 80): Promise<Keyword[]> {
  const L = lang;
  const qs = [seed, ...(QWORDS[L] ?? []).map((w) => `${w} ${seed}`), ...[...(ALPHA[L] ?? (/[a-z]/.test(seed) ? ALPHA.en : ""))].slice(0, depth === "deep" ? 99 : 6).map((ch) => `${seed} ${ch}`)];
  const lists: { q: string; items: string[] }[] = [];
  for (let i = 0; i < qs.length; i += 6) lists.push(...await Promise.all(qs.slice(i, i + 6).map(async (q) => ({ q, items: await suggest(q, lang, region) }))));
  const m = new Map<string, { s: number; n: number }>();
  for (const l of lists) l.items.forEach((k, rank) => {
    const key = k.toLowerCase().trim(); if (!key || key.length > 100) return;
    const e = m.get(key) ?? { s: 0, n: 0 };
    e.s += (1 - rank / Math.max(10, l.items.length)) * (l.q === seed ? 2.5 : 1); e.n++; m.set(key, e);
  });
  if (!m.has(seed.toLowerCase())) m.set(seed.toLowerCase(), { s: 3, n: 1 });
  const top = Math.max(...[...m.values()].map((e) => e.s), 1);
  const out = [...m.entries()].map(([keyword, e]) => ({ keyword, auto: Math.round((e.s / top) * 100), sources: e.n })).sort((a, b) => b.auto - a.auto);
  const i = out.findIndex((k) => k.keyword === seed.toLowerCase()); if (i > 0) out.unshift(...out.splice(i, 1)); // исходный ключ — первым
  return out.slice(0, max);
}

export function scoreKeyword(keyword: string, rows: { title: string; views: number; ageDays: number; subs: number }[]): Omit<KwMetrics, "top" | "tags"> {
  const top = rows.slice(0, 10);
  const monthly = top.reduce((s, r) => s + Math.min(r.views, (r.views / Math.max(1, r.ageDays)) * 30), 0);
  const volume = Math.round(monthly * 0.5); // ≈ доля поискового трафика ~30% ÷ CTR топ-10 ~60%
  const words = keyword.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const titleMatch = top.length ? top.filter((r) => words.every((w) => r.title.toLowerCase().includes(w))).length / top.length : 0;
  const medianSubs = median(top.map((r) => r.subs)), medianViews = median(top.map((r) => r.views));
  const smallChannels = top.length ? top.filter((r) => r.subs < 10_000).length / top.length : 0;
  const competition = Math.round(clamp(0.4 * clamp((Math.log10(medianSubs + 1) / 7) * 100) + 0.3 * clamp((Math.log10(medianViews + 1) / 7.5) * 100) + 0.3 * titleMatch * 100 - 25 * smallChannels));
  const volumeScore = Math.round(clamp((Math.log10(volume + 1) / 7) * 100));
  return { volume, volumeScore, competition, level: competition < 35 ? "low" : competition < 65 ? "medium" : "high", overall: Math.round(clamp(0.55 * volumeScore + 0.45 * (100 - competition))), medianSubs, medianViews, titleMatch: +titleMatch.toFixed(2), smallChannels: +smallChannels.toFixed(2) };
}

/** Анализ одного ключа: search (100) + videos (1) + channels (1) */
export async function analyzeKeyword(keyword: string, lang: string, region?: string): Promise<KwMetrics> {
  const ids = (await searchPaged(keyword, { pages: 1, order: "relevance", lang, region })).slice(0, 25);
  const vids = await getVideos(ids);
  const ch = await getChannelsFull(vids.map((v) => v.channelId));
  const now = Date.now();
  const rows = vids.map((v) => ({ id: v.id, title: v.title, channelTitle: v.channelTitle, views: v.views, subs: ch.get(v.channelId)?.subscribers ?? 0, thumbnail: v.thumbnail, ageDays: Math.max(1, Math.round((now - +new Date(v.publishedAt)) / DAY)), tags: v.tags }));
  const tagCount = new Map<string, number>();
  for (const r of rows) for (const t of new Set(r.tags.map((x) => x.toLowerCase().trim()))) if (t && t.length <= 60) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  const tags = [...tagCount.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([t]) => t);
  return { ...scoreKeyword(keyword, rows), top: rows.slice(0, 5).map(({ tags: _t, ...r }) => r), tags };
}

export async function runKeywords(input: KeywordInputT, ctx: JobCtx): Promise<KeywordRun> {
  const s = await getSettings(); const K = s.research.keywords;
  const lang = input.language || s.research.language || s.contentLanguage;
  const region = (input.region ?? s.research.region) || undefined;
  ctx.progress("Подсказки поиска YouTube", 5);
  const kws = await suggestions(input.seed, lang, region, input.depth ?? K.depth);
  const n = input.analyzeTop ?? K.analyzeTop;
  const pick = kws.slice(0, n);
  let units = 0;
  const related = new Map<string, number>();
  for (let i = 0; i < pick.length; i++) {
    if (ctx.signal.aborted) throw new Error("cancelled");
    ctx.progress(`Анализ «${pick[i].keyword}» (${i + 1}/${pick.length})`, 15 + Math.round((i / Math.max(1, pick.length)) * 80));
    try { pick[i].metrics = await analyzeKeyword(pick[i].keyword, lang, region); units += 102; pick[i].metrics!.tags.forEach((t) => related.set(t, (related.get(t) ?? 0) + 1)); }
    catch (e) { if ((e as { code?: string }).code === "YT_QUOTA" || (e as { code?: string }).code === "KEY_MISSING") { if (i === 0) throw e; break; } }
    ctx.partial({ keywords: kws });
  }
  const known = new Set(kws.map((k) => k.keyword));
  const run: KeywordRun = { id: crypto.randomUUID().slice(0, 8), createdAt: new Date().toISOString(), input: { ...input, language: lang }, keywords: kws, related: [...related.entries()].filter(([t]) => !known.has(t)).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([tag, count]) => ({ tag, count })), units };
  await saveKeywordRun(run);
  return run;
}

export async function saveKeywordRun(run: KeywordRun) {
  await writeJson(`keyword-runs/${run.id}.json`, run);
  const idx = (await listKeywordRuns()).filter((x) => x.id !== run.id);
  idx.unshift({ id: run.id, createdAt: run.createdAt, seed: run.input.seed, count: run.keywords.length });
  await writeJson("keyword-runs/index.json", idx.slice(0, 50));
}
export const listKeywordRuns = () => readJson<{ id: string; createdAt: string; seed: string; count: number }[]>("keyword-runs/index.json", []);
export const loadKeywordRun = (id: string) => readJson<KeywordRun | null>(`keyword-runs/${id.replace(/[^\w-]/g, "")}.json`, null);

/** Автовыбор по правилу из настроек */
export function autoPick(kws: Keyword[], rule: { minVolume: number; maxCompetition: Level; highCompVolume: number; maxPick: number }) {
  const order: Level[] = ["low", "medium", "high"];
  return kws.filter((k) => k.metrics && ((k.metrics.volume >= rule.minVolume && order.indexOf(k.metrics.level) <= order.indexOf(rule.maxCompetition)) || k.metrics.volume >= rule.highCompVolume))
    .sort((a, b) => b.metrics!.overall - a.metrics!.overall).slice(0, rule.maxPick).map((k) => k.keyword);
}

/** Описание канала по ключам (как в видео: «расскажи алгоритму, о чём канал») */
export const ChannelDescInput = z.object({ keywords: z.array(z.string().max(100)).min(1).max(30), niche: z.string().max(300).optional(), channelName: z.string().max(100).optional(), language: z.string().default("ru") });
export async function channelDescription(input: z.infer<typeof ChannelDescInput>) {
  const L = LANG_NAME[input.language] ?? "Russian";
  const { data, model } = await generateJson({
    system: `You are a YouTube SEO expert. Write a channel "About" description in ${L} that tells the YouTube algorithm and viewers exactly what the channel is about. Use the given keywords naturally (no keyword stuffing), 600-1000 characters, first 150 characters must contain the main keyword and the value promise, add what viewers get, upload rhythm hint and a subscribe line. Also return channel keywords for YouTube Studio settings (max 500 chars total, multi-word phrases in quotes). JSON: {"description":string,"channelKeywords":string}`,
    user: JSON.stringify(input), maxTokens: 1500, temperature: 0.6,
  }, z.object({ description: z.string().min(100).max(2000), channelKeywords: z.string().max(600) }));
  return { ...data, model };
}
