import crypto from "node:crypto";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import type { JobCtx } from "../lib/jobs.js";
import { cached } from "../lib/cache.js";
import { readJson, writeJson } from "../lib/storage.js";
import { config } from "../config.js";
import { generateJson, LANG_NAME } from "./llm.js";
import { getSettings } from "./settings.js";
import { listTopics } from "./topics.js";
import { fill, loadSplitPrompt, readPrompt, STYLES } from "./prompts.js";
import { getChannelsStats, getVideos, searchVideos } from "./youtube.js";
import { localParts, median, WEEKDAYS } from "./metrics.js";

export const TopicInput = z.object({
  keywords: z.string().min(2, "Укажите ключевые слова").max(500),
  nicheDescription: z.string().min(10, "Опишите нишу (от 10 символов)").max(2000),
  count: z.union([z.literal(5), z.literal(10), z.literal(15)]).default(10),
  format: z.enum(["long", "shorts"]).default("long"),
  minutes: z.number().int().min(3).max(120).default(12),
  language: z.string().default("ru"),
  style: z.string().default("custom"),
  customStyle: z.string().max(3000).optional(),
  useYouTube: z.boolean().default(true),
  force: z.boolean().optional(),
});
export type TopicInput = z.infer<typeof TopicInput>;

/** Скоринг-карта идеи KB YT-Genius (100 баллов): критерий 0–5 × вес */
export const SCORECARD = [["demand", "Спрос", 3], ["emotion", "Эмоциональная тяга", 3], ["gap", "Пробел и оригинальность", 3], ["packaging", "Ясность упаковки", 2], ["retention", "Двигатель удержания", 2], ["visual", "Визуальный потенциал", 2], ["evidence", "Доказательность", 2], ["evergreen", "Вечнозелёность", 1], ["feasibility", "Реализуемость", 2]] as const;
type ScKey = (typeof SCORECARD)[number][0];
export function scorecard100(sc: Partial<Record<ScKey, number>> | undefined): number | null {
  if (!sc || SCORECARD.filter(([k]) => typeof sc[k] === "number").length < 6) return null;
  return Math.round(SCORECARD.reduce((a, [k, , w]) => a + Math.max(0, Math.min(5, sc[k] ?? 2.5)) * w, 0));
}
const IdeaSchema = z.object({
  ideas: z.array(z.object({
    title: z.string().min(5),
    alt_titles: z.array(z.string()).default([]),
    core_question: z.string().default(""),
    hook: z.string(),
    angle: z.string().default(""),
    summary: z.string().default(""),
    why: z.string(),
    audience: z.string(),
    thumbnail: z.object({ visual: z.string(), text: z.string().default("") }),
    evidence_ids: z.array(z.string()).max(4).default([]),
    keyword_group: z.coerce.number().int().min(0).default(0),
    search_keywords: z.array(z.string()).default([]),
    fact_check: z.array(z.string()).default([]),
    scores: z.object({ curiosity: z.number(), demand: z.number(), visual: z.number(), evergreen: z.number(), factual_safety: z.number() }),
    lens: z.string().max(10).default(""),
    emotional_core: z.string().max(400).default(""),
    scorecard: z.object(Object.fromEntries(SCORECARD.map(([k]) => [k, z.coerce.number().min(0).max(5)])) as Record<ScKey, z.ZodNumber>).partial().optional(),
  })).min(1),
});

export type Evidence = { id: string; g: number; title: string; channelTitle: string; channelId: string; views: number; subs: number | null; outlier: number | null; ageDays: number; isShort: boolean; thumbnail?: string; publishedAt: string };
export type Group = { phrase: string; count: number; n10k: number; medianSubs: number; open: boolean; competition: "low" | "medium" | "high"; bestDay: string; bestHour: number };
export type FoundTopic = {
  n: number; title: string; altTitles: string[]; score: number; label: string; competition: Group["competition"] | null; bestDay: string | null; bestHour: number | null;
  why: string; hook: string; audience: string; thumbnail: { visual: string; text: string }; coreQuestion: string; angle: string; summary: string;
  evidence: Pick<Evidence, "id" | "title" | "channelTitle" | "views" | "outlier" | "thumbnail">[]; searchKeywords: string[]; factCheck: string[];
  lens?: string; emotionalCore?: string; scorecard?: { total: number; items: { id: string; name: string; weight: number; score: number }[] };
};
export type TopicRun = { id: string; createdAt: string; input: TopicInput; topics: FoundTopic[]; groups: Group[]; evidenceCount: number; model: string; warning?: string };

export const scoreLabel = (s: number) => (s >= 90 ? "Почти гарантированный вирус" : s >= 80 ? "Высокий потенциал" : s >= 65 ? "Хороший потенциал" : "Нишевая");

/** §8.5: конкуренция по реальным видео за 90 дней */
export function groupStats(phrase: string, ev: Evidence[], tz: string): Group {
  const n10k = ev.filter((e) => e.views > 10_000).length;
  const subs = ev.map((e) => e.subs).filter((s): s is number => s != null);
  const medianSubs = Math.round(median(subs));
  const open = ev.filter((e) => e.subs != null && e.subs < 10_000 && (e.outlier ?? 0) >= 5).length >= 2;
  const competition = open ? "low" : n10k >= 20 && medianSubs >= 200_000 ? "high" : n10k < 10 || medianSubs < 20_000 ? "low" : "medium";
  const day = WEEKDAYS.map(() => ({ t: 0, c: 0 })), hour = Array.from({ length: 24 }, () => ({ t: 0, c: 0 }));
  for (const e of ev) { const p = localParts(e.publishedAt, tz); day[p.weekday].t += e.views; day[p.weekday].c++; hour[p.hour].t += e.views; hour[p.hour].c++; }
  const best = (a: { t: number; c: number }[]) => a.reduce((bi, x, i) => ((x.c ? x.t / x.c : 0) > (a[bi].c ? a[bi].t / a[bi].c : 0) ? i : bi), 0);
  return { phrase, count: ev.length, n10k, medianSubs, open, competition, bestDay: WEEKDAYS[best(day)], bestHour: best(hour) };
}

async function collectEvidence(phrases: string[], lang: string, format: "long" | "shorts", force?: boolean) {
  const after = new Date(Date.now() - 90 * 86400_000); after.setUTCHours(0, 0, 0, 0);
  const lists = await Promise.all(phrases.map((q) => cached(`yt-search:${q.toLowerCase()}:${lang}:${after.toISOString().slice(0, 10)}`, 6 * 3600_000,
    () => searchVideos(q, { publishedAfter: after.toISOString(), lang, max: 25, order: "viewCount" }), force)));
  const allIds = [...new Set(lists.flat())];
  const videos = await cached(`yt-videos:${crypto.createHash("md5").update(allIds.join(",")).digest("hex")}`, 6 * 3600_000, () => getVideos(allIds), force);
  const subs = await getChannelsStats(videos.map((v) => v.channelId));
  const byId = new Map(videos.map((v) => [v.id, v]));
  const now = Date.now();
  const ev: Evidence[] = [];
  const seen = new Set<string>();
  lists.forEach((ids, g) => ids.forEach((id) => {
    const v = byId.get(id); if (!v || seen.has(id)) return; seen.add(id);
    const s = subs.get(v.channelId) ?? null;
    ev.push({ id, g, title: v.title, channelTitle: v.channelTitle, channelId: v.channelId, views: v.views, subs: s || null, outlier: s ? +(v.views / s).toFixed(2) : null,
      ageDays: Math.max(1, Math.round((now - Date.parse(v.publishedAt)) / 86400_000)), isShort: v.isShort, thumbnail: v.thumbnail, publishedAt: v.publishedAt });
  }));
  // приоритет — видео нужного формата, но не выкидываем всё
  const fit = ev.filter((e) => (format === "shorts" ? e.isShort : !e.isShort));
  return fit.length >= 10 ? fit : ev;
}

/** Оценка 0–100: 55% — экспертные баллы LLM (растянуты: 5→0, 10→100), 45% — реальные доказательства (outlier по лог-шкале), ± конкуренция */
function finalScore(s: z.infer<typeof IdeaSchema>["ideas"][number]["scores"], ev: Evidence[], comp: Group["competition"] | null, card: number | null = null) {
  const c = (n: number) => Math.max(0, Math.min(10, n));
  const legacy = Math.max(0, ((c(s.curiosity) * 0.3 + c(s.demand) * 0.3 + c(s.visual) * 0.15 + c(s.evergreen) * 0.1 + c(s.factual_safety) * 0.15) - 5) * 20);
  // скоринг-карта 100: 60 → 0, 100 → 100 (порог «делать» ≥85 по KB)
  const llm = card == null ? legacy : Math.max(0, (card - 60) * 2.5) * 0.7 + legacy * 0.3;
  const outs = ev.map((e) => e.outlier).filter((x): x is number => x != null);
  const evScore = outs.length ? Math.min(100, 35 + 25 * Math.log10(1 + outs.reduce((a, x) => a + x, 0) / outs.length)) : 50;
  const x = llm * 0.55 + evScore * 0.45 + (comp === "low" ? 3 : comp === "high" ? -6 : 0);
  return Math.round(Math.max(0, Math.min(99, x)));
}

export async function runTopicFinder(input: TopicInput, ctx: JobCtx): Promise<TopicRun> {
  const s = await getSettings();
  const phrases = [...new Set(input.keywords.split(/[,;\n]/).map((x) => x.trim()).filter((x) => x.length >= 2))].slice(0, 3);
  if (!phrases.length) throw new ApiError("VALIDATION", "Укажите хотя бы одно ключевое слово", 400);
  let evidence: Evidence[] = [], groups: Group[] = [], warning: string | undefined;

  if (input.useYouTube) {
    if (!(config.keys.youtube || config.keys.youtube2 || config.keys.youtube3)) warning = "Ключ YouTube не задан — темы сгенерированы без реальных данных";
    else {
      ctx.progress(`Ищем видео на YouTube: ${phrases.join(", ")}`, 10);
      try {
        evidence = await collectEvidence(phrases, input.language, input.format, input.force);
        groups = phrases.map((p, g) => groupStats(p, evidence.filter((e) => e.g === g), s.timezone));
        ctx.partial({ groups, evidenceCount: evidence.length });
      } catch (e) { if (e instanceof ApiError && (e.code === "YT_QUOTA" || e.code === "KEY_MISSING")) warning = e.message + ". Темы сгенерированы без реальных данных YouTube"; else throw e; }
    }
  }
  if (ctx.signal.aborted) throw new ApiError("VALIDATION", "Отменено");

  ctx.progress("AI генерирует темы", 40);
  const [{ system }, userTpl] = await Promise.all([loadSplitPrompt("universal/1_ideas.md"), readPrompt("topic_finder_grounded.md")]);
  const style = STYLES.find((x) => x.id === input.style);
  const styleDesc = style ? (await readPrompt(`ideation/${style.id}.md`).catch(() => style.hint)).slice(0, 6000) : (input.customStyle || "Free style that matches the niche description");
  const saved = (await listTopics()).map((t) => t.title).slice(0, 80);
  const evForLlm = [...evidence].sort((a, b) => (b.outlier ?? 0) - (a.outlier ?? 0)).slice(0, 60)
    .map((e) => ({ id: e.id, g: e.g, t: e.title, v: e.views, subs: e.subs, x: e.outlier, d: e.ageDays, s: e.isShort || undefined }));
  const ids = new Set(evidence.map((e) => e.id));
  const user = fill(userTpl, {
    COUNT: input.count, KEYWORDS: phrases.map((p, i) => `[${i}] ${p}`).join("; "), NICHE: input.nicheDescription,
    LANGUAGE: LANG_NAME[input.language] ?? input.language, FORMAT: input.format === "shorts" ? "YouTube Shorts (≤ 60 s)" : `long-form ≈ ${input.minutes} min`,
    STYLE_NAME: style?.name ?? "Custom", STYLE_DESCRIPTION: styleDesc, EXCLUDE: saved.length ? saved.join(" | ") : "none",
    EVIDENCE: evForLlm.length ? JSON.stringify(evForLlm) : "[] (no data — rely on general knowledge, evidence_ids must be [])",
  });
  const { data, model } = await generateJson({ system, user, maxTokens: 4000 + input.count * 700, temperature: 0.85 },
    IdeaSchema.refine((d) => d.ideas.every((i) => i.evidence_ids.every((id) => ids.has(id))), { message: "evidence_ids must be ids from REAL YOUTUBE DATA list" }));

  const evById = new Map(evidence.map((e) => [e.id, e]));
  // страховка: если модель всё же сослалась на id — заменяем названием
  const deId = (txt: string) => txt.replace(/\(?\b([\w-]{11})\b\)?/g, (m, id) => { const e = evById.get(id); return e ? `«${e.title.length > 40 ? e.title.slice(0, 40) + "…" : e.title}»` : m; }).replace(/\s+([,.])/g, "$1");
  const savedLc = new Set(saved.map((t) => t.toLowerCase().trim()));
  const topics = data.ideas.filter((i) => !savedLc.has(i.title.toLowerCase().trim())).map((i) => {
    const ev = i.evidence_ids.map((id) => evById.get(id)!).filter(Boolean);
    const g = groups[Math.min(i.keyword_group, Math.max(0, groups.length - 1))] ?? null;
    const card = scorecard100(i.scorecard);
    const score = finalScore(i.scores, ev, g?.competition ?? null, card);
    return {
      n: 0, title: i.title, altTitles: i.alt_titles.slice(0, 3), score, label: scoreLabel(score), competition: g?.competition ?? null, bestDay: g?.bestDay ?? null, bestHour: g?.bestHour ?? null,
      why: deId(i.why), hook: i.hook, audience: i.audience, thumbnail: i.thumbnail, coreQuestion: i.core_question, angle: i.angle, summary: i.summary,
      evidence: ev.slice(0, 3).map((e) => ({ id: e.id, title: e.title, channelTitle: e.channelTitle, views: e.views, outlier: e.outlier, thumbnail: e.thumbnail })),
      searchKeywords: i.search_keywords, factCheck: i.fact_check,
      lens: i.lens || undefined, emotionalCore: i.emotional_core || undefined, scorecard: card == null ? undefined : { total: card, items: SCORECARD.map(([k, name, w]) => ({ id: k, name, weight: w, score: Math.max(0, Math.min(5, i.scorecard?.[k] ?? 0)) })) },
    } satisfies FoundTopic;
  }).sort((a, b) => b.score - a.score).slice(0, input.count).map((t, k) => ({ ...t, n: k + 1 }));

  ctx.progress("Сохраняем", 95);
  const run: TopicRun = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), input, topics, groups, evidenceCount: evidence.length, model, warning };
  await writeJson(`topic-runs/${run.id}.json`, run);
  const idx = await readJson<{ id: string; createdAt: string; keywords: string; count: number }[]>("topic-runs/index.json", []);
  await writeJson("topic-runs/index.json", [{ id: run.id, createdAt: run.createdAt, keywords: input.keywords, count: topics.length }, ...idx].slice(0, 50));
  return run;
}

export const listRuns = () => readJson<{ id: string; createdAt: string; keywords: string; count: number }[]>("topic-runs/index.json", []);
export const loadRun = (id: string) => readJson<TopicRun | null>(`topic-runs/${id.replace(/[^\w-]/g, "")}.json`, null);

// Шаблоны ключей/описания
export const TemplateInput = z.object({ name: z.string().min(1).max(80), keywords: z.string().max(500), nicheDescription: z.string().max(2000), style: z.string().optional(), customStyle: z.string().max(3000).optional() });
type Template = z.infer<typeof TemplateInput> & { id: string; createdAt: string };
export const listTemplates = () => readJson<Template[]>("topic-templates.json", []);
export async function saveTemplate(input: unknown) {
  const t = TemplateInput.parse(input);
  const all = (await listTemplates()).filter((x) => x.name !== t.name);
  const row = { ...t, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  await writeJson("topic-templates.json", [row, ...all]);
  return row;
}
export async function deleteTemplate(id: string) { await writeJson("topic-templates.json", (await listTemplates()).filter((x) => x.id !== id)); }
