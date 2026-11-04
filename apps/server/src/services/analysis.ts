import { rethrowFinancial } from "../lib/errors.js";
import { rethrowCancelled } from "../lib/taskContext.js";
import crypto from "node:crypto";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import type { JobCtx } from "../lib/jobs.js";
import { readJson, writeJson } from "../lib/storage.js";
import { computeReport, type ComputedReport, type VideoRow } from "./metrics.js";
import { generateJson, LANG_NAME } from "./llm.js";
import { getSettings } from "./settings.js";
import { getRecentUploads, resolveChannel } from "./youtube.js";

const Level = z.enum(["low", "moderate", "high", "extreme"]);
export const InsightsSchema = z.object({
  niche: z.object({
    name: z.string(),
    virality: z.number().min(0).max(10),
    demand: z.number().min(0).max(10),
    saturation: Level,
    trend: z.enum(["growing", "stable", "declining"]),
    monetization: z.enum(["low", "medium", "medium_high", "high"]),
    bullets: z.array(z.object({ text: z.string(), highlight: z.array(z.string()).max(3).default([]) })).min(3).max(7),
    entryVerdict: z.string(),
  }),
  diagnosis: z.object({
    whyGrowing: z.array(z.string()).min(1).max(6),
    hitsVsFlops: z.array(z.string()).min(1).max(6),
    mistakes: z.array(z.string()).min(1).max(6),
    angles: z.array(z.string()).min(1).max(8),
    plan: z.array(z.string()).min(3).max(10),
  }),
  top3: z.array(z.object({ videoId: z.string(), reasons: z.array(z.string()).min(2).max(5) })).max(3),
});
export type Insights = z.infer<typeof InsightsSchema>;

export const OutlierSchema = z.object({
  topics: z.array(z.object({
    technique: z.string(),
    type: z.enum(["replication", "counter", "format_shift"]),
    score: z.number().min(0).max(10),
    title: z.string(),
    basedOnVideoId: z.string(),
    why: z.string(),
    howTo: z.array(z.string()).min(3).max(4),
  })).length(7),
});
export type OutlierTopic = z.infer<typeof OutlierSchema>["topics"][number];

export type Report = ComputedReport & { id: string; createdAt: string; niche?: string; insights?: Insights; insightsError?: string; model?: string; outlierSets: OutlierTopic[][] };

const reportFile = (id: string) => `reports/${id}.json`;
export const loadReport = (id: string) => readJson<Report | null>(reportFile(id), null);

const brief = (v: VideoRow) => ({ id: v.id, title: v.title, views: v.views, outlier: +v.outlier.toFixed(2), engagement: +v.engagement.toFixed(2), ageDays: Math.round(v.ageDays), durMin: +(v.durationSec / 60).toFixed(1), short: v.isShort, tags: v.tags.slice(0, 8) });

function dossier(r: ComputedReport, niche?: string) {
  const sorted = [...r.videos].sort((a, b) => b.views - a.views);
  return {
    channel: { title: r.channel.title, subscribers: r.channel.subscribers, totalViews: r.channel.totalViews, videoCount: r.channel.videoCount, createdAt: r.channel.publishedAt.slice(0, 10), country: r.channel.country, description: r.channel.description.slice(0, 600) },
    userNicheHint: niche || null,
    stats: r.stats, windows: r.windows,
    bestWeekday: r.schedule.byDay[r.schedule.bestDay].label,
    goldenTags: r.tags.golden.slice(0, 10).map((t) => `${t.tag} (${t.avgViews})`),
    iceboxTags: r.tags.icebox.slice(0, 10).map((t) => `${t.tag} (${t.avgViews})`),
    top: sorted.slice(0, 15).map(brief),
    worst: sorted.slice(-5).map(brief),
    top3Ids: r.top3,
  };
}

const SYSTEM_ANALYSIS = `You are a senior YouTube strategist for faceless documentary channels. You receive a JSON dossier with REAL metrics computed from the YouTube Data API.
Rules:
- Never invent numbers; interpret only the provided metrics. You may cite them.
- Be specific: reference concrete video titles, formats, hooks, lengths and topics from the dossier.
- "niche.virality" = how easily videos in this niche break out beyond subscribers (0-10). "niche.demand" = audience demand (0-10).
- bullets: 4-6 sharp insights; "highlight" lists 1-3 exact substrings of "text" to emphasize.
- entryVerdict: one or two sentences: should a NEW channel enter this niche and under which condition.
- diagnosis.plan: 5-10 concrete next video actions.
- top3: for each id in top3Ids give 3-5 reasons why it worked.
- Write all human-readable text in {{LANG}}. Keep enum values in English exactly as in the schema.
JSON schema:
{"niche":{"name":string,"virality":0-10,"demand":0-10,"saturation":"low|moderate|high|extreme","trend":"growing|stable|declining","monetization":"low|medium|medium_high|high","bullets":[{"text":string,"highlight":[string]}],"entryVerdict":string},
 "diagnosis":{"whyGrowing":[string],"hitsVsFlops":[string],"mistakes":[string],"angles":[string],"plan":[string]},
 "top3":[{"videoId":string,"reasons":[string]}]}`;

const SYSTEM_OUTLIERS = `You are a YouTube ideation expert. From a channel's proven top performers, produce exactly 7 NEW video topics that can replicate their success.
Types: "replication" (same proven mechanic, new subject), "counter" (counter-intuitive reversal of a proven idea), "format_shift" (same idea, new format/angle).
For each topic: technique (short catchy name of the psychological/story mechanic, 2-4 words), type, score 0-10 (realistic potential), title (clickable, specific, <= 80 chars), basedOnVideoId (must be one of the provided ids), why (1-2 sentences referencing the source video's success), howTo (3-4 concrete execution steps: hook, visuals/thumbnail, narrative structure, payoff).
Do not repeat or paraphrase any title listed in "avoid". Write human text in {{LANG}}; keep enum values in English.
JSON: {"topics":[{"technique":string,"type":"replication|counter|format_shift","score":number,"title":string,"basedOnVideoId":string,"why":string,"howTo":[string]}]}`;

export async function generateOutliers(report: Report, lang: string): Promise<OutlierTopic[]> {
  const top = [...report.videos].sort((a, b) => b.outlier - a.outlier).slice(0, 12).map(brief);
  const avoid = [...report.outlierSets.flat().map((t) => t.title), ...report.videos.slice(0, 50).map((v) => v.title)];
  const ids = new Set(report.videos.map((v) => v.id));
  const { data } = await generateJson({
    system: SYSTEM_OUTLIERS.replace("{{LANG}}", LANG_NAME[lang] ?? "Russian"),
    user: JSON.stringify({ channel: report.channel.title, niche: report.insights?.niche.name ?? report.niche ?? null, medianViews: report.stats.medianViews, topPerformers: top, avoid, setNumber: report.outlierSets.length + 1 }),
    maxTokens: 6000, temperature: 0.9,
  }, OutlierSchema.refine((d) => d.topics.every((t) => ids.has(t.basedOnVideoId)), { message: "basedOnVideoId must be one of provided ids" }));
  return data.topics.sort((a, b) => b.score - a.score);
}

export async function generateInsights(computed: ComputedReport, niche: string | undefined, lang: string) {
  const ids = new Set(computed.top3);
  return generateJson({
    system: SYSTEM_ANALYSIS.replace("{{LANG}}", LANG_NAME[lang] ?? "Russian"),
    user: JSON.stringify(dossier(computed, niche)), maxTokens: 8000, temperature: 0.5,
  }, InsightsSchema.refine((d) => d.top3.every((t) => ids.has(t.videoId)), { message: "top3.videoId must be from top3Ids" }));
}

export async function runChannelAnalysis(input: { channel: string; videos: number; type: "all" | "long" | "shorts"; niche?: string; force?: boolean }, ctx: JobCtx): Promise<Report> {
  const s = await getSettings();
  ctx.progress("Ищем канал", 5);
  const channel = await resolveChannel(input.channel);
  ctx.progress(`Загружаем видео «${channel.title}»`, 15);
  const all = await getRecentUploads(channel, input.videos, input.type, 60, input.force);
  if (!all.length) throw new ApiError("YT_NOT_FOUND", "У канала нет публичных видео", 404);
  ctx.progress("Считаем метрики", 35);
  const pick = (name?: string) => (name && s.rpm.find((r) => r.niche.toLowerCase() === name.toLowerCase())) || undefined;
  const rpm = pick(input.niche) ?? s.rpm.find((r) => input.niche && r.niche.toLowerCase().includes(input.niche.toLowerCase())) ?? s.rpm[0];
  const shortsRpm = s.rpm.find((r) => /short/i.test(r.niche)) ?? { niche: "Shorts", min: 0.05, max: 0.1 };
  const computed = computeReport(channel, all, { count: input.videos, type: input.type, tz: s.timezone, rpm, shortsRpm });
  if (!computed.videos.length) throw new ApiError("YT_NOT_FOUND", input.type === "shorts" ? "У канала нет Shorts в последних загрузках" : "У канала нет длинных видео в последних загрузках", 404);

  const report: Report = { ...computed, id: crypto.randomUUID(), createdAt: new Date().toISOString(), niche: input.niche, outlierSets: [] };
  ctx.partial({ ...report, videos: report.videos });

  ctx.progress("AI анализирует нишу и канал", 55);
  try {
    const { data, model } = await generateInsights(computed, input.niche, s.contentLanguage);
    report.insights = data; report.model = model;
    ctx.partial({ insights: data });
  } catch (e) { rethrowCancelled(e); rethrowFinancial(e); report.insightsError = (e as Error).message; }

  if (report.insights) {
    ctx.progress("Генерируем outlier-темы", 80);
    try { report.outlierSets.push(await generateOutliers(report, s.contentLanguage)); }
    catch (e) { rethrowCancelled(e); rethrowFinancial(e); report.insightsError = `Outlier-темы: ${(e as Error).message}`; }
  }
  ctx.progress("Готово", 100);
  await writeJson(reportFile(report.id), report);
  await addToIndex(report);
  return report;
}

type IndexRow = { id: string; createdAt: string; channelId: string; title: string; avatar?: string; videos: number; type: string };
async function addToIndex(r: Report) {
  const idx = await readJson<IndexRow[]>("reports/index.json", []);
  idx.unshift({ id: r.id, createdAt: r.createdAt, channelId: r.channel.id, title: r.channel.title, avatar: r.channel.avatar, videos: r.stats.sampleSize, type: r.params.type });
  await writeJson("reports/index.json", idx.slice(0, 100));
}
export const listReports = () => readJson<IndexRow[]>("reports/index.json", []);

export async function moreOutliers(reportId: string) {
  const r = await loadReport(reportId);
  if (!r) throw new ApiError("NOT_FOUND", "Отчёт не найден", 404);
  const s = await getSettings();
  const set = await generateOutliers(r, s.contentLanguage);
  r.outlierSets.push(set);
  await writeJson(reportFile(r.id), r);
  return { set, index: r.outlierSets.length };
}
