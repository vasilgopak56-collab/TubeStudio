import { rethrowCancelled } from "../lib/taskContext.js";
import crypto from "node:crypto";
import { z } from "zod";
import type { JobCtx } from "../lib/jobs.js";
import { readJson, writeJson } from "../lib/storage.js";
import { getSettings, FiltersSchema, type Filters, type ResearchSettingsT } from "./settings.js";
import { getChannelsFull, getVideos, latestUploads, searchPaged, type Channel, type Video } from "./youtube.js";
import { median, mean } from "./metrics.js";
import { recentVph, recordViews } from "./vstats.js";

const DAY = 86400_000;
export const ANOMALY_FILTERS: Filters = { subsMax: 10000, viewsMin: 50000, ratioMin: 10, ageDays: 30, type: "all", viralOnly: false };
export const ResearchInput = z.object({
  mode: z.enum(["outliers", "anomalies"]).default("outliers"),
  q: z.string().trim().min(2, "Введите ключевое слово или тему").max(200),
  filters: FiltersSchema.prefault({}),
  sort: z.enum(["outlier", "vph", "views", "date", "ratio"]).default("outlier"),
  pages: z.number().int().min(1).max(4).optional(),
  order: z.enum(["relevance", "viewCount", "date"]).optional(),
  region: z.string().max(2).optional(),
  language: z.string().max(5).optional(),
  force: z.boolean().optional(),
}).superRefine((input, ctx) => {
  if (input.mode !== "anomalies") return;
  for (const [key, min, message] of [
    ["subsMax", 1, "Аномалии: укажите максимум подписчиков (от 1)"],
    ["viewsMin", 1, "Аномалии: укажите минимум просмотров (от 1)"],
    ["ageDays", 1, "Аномалии: выберите срок публикации"],
    ["ratioMin", 1, "Аномалии: просмотры / подписчики должны быть не меньше 1"],
  ] as const) {
    if (input.filters[key] == null || input.filters[key]! < min) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["filters", key], message });
  }
});
export type ResearchInputT = z.infer<typeof ResearchInput>;

export type ResearchRow = {
  id: string; title: string; thumbnail?: string; publishedAt: string; ageDays: number; durationSec: number; isShort: boolean;
  views: number; likes: number; comments: number; engagement: number; tags: string[];
  channelId: string; channelTitle: string; channelAvatar?: string; subs: number; hiddenSubs: boolean; channelVideos: number;
  vph: number; vphRecent: number | null; outlier: number | null; baseViews: number | null; ratio: number | null; viral: boolean; viralWhy: string;
};
export type ResearchRun = { id: string; createdAt: string; input: ResearchInputT; rows: ResearchRow[]; stats: { fetched: number; shown: number; channels: number; baselines: number; units: number }; base: "median" | "average" };

/** Оценка квоты до запуска */
export function estimateUnits(pages: number, base: "median" | "average", channelsGuess = 35) {
  return pages * 100 + pages + Math.ceil((pages * 50) / 50) + (base === "median" ? channelsGuess * pages * 2 : 0);
}

export function viralCheck(ageDays: number, outlier: number | null, vph: number, v: ResearchSettingsT["viral"]): { ok: boolean; why: string } {
  const rules = [...v.rules].sort((a, b) => (a.maxAgeDays || 1e9) - (b.maxAgeDays || 1e9));
  const rule = rules.find((r) => !r.maxAgeDays || ageDays <= r.maxAgeDays) ?? rules[rules.length - 1];
  const okO = outlier != null && outlier >= v.outlierMin, okV = vph >= rule.vphMin;
  const age = rule.maxAgeDays ? `до ${rule.maxAgeDays} дн.` : "любой возраст";
  return { ok: okO && okV, why: `Outlier ≥ ${v.outlierMin}× ${okO ? "✓" : "✗"} · VPH ≥ ${rule.vphMin} (${age}) ${okV ? "✓" : "✗"}` };
}

const inRange = (x: number | null | undefined, lo?: number, hi?: number) => (lo == null || (x != null && x >= lo)) && (hi == null || (x != null && x <= hi));

/** Фильтры без Outlier (не требуют базы канала) */
export function passCheap(r: Pick<ResearchRow, "views" | "subs" | "vph" | "ratio" | "engagement" | "ageDays" | "durationSec" | "isShort"> & { hiddenSubs?: boolean }, f: Filters) {
  // Hidden/unavailable subscribers are unknown, not a small channel with zero subscribers.
  if (r.hiddenSubs && (f.subsMin != null || f.subsMax != null || f.ratioMin != null)) return false;
  if (f.type === "long" && r.isShort) return false;
  if (f.type === "shorts" && !r.isShort) return false;
  return inRange(r.views, f.viewsMin, f.viewsMax) && inRange(r.subs, f.subsMin, f.subsMax) && inRange(r.vph, f.vphMin, f.vphMax)
    && inRange(r.ratio == null || r.subs <= 0 ? null : r.views / r.subs, f.ratioMin) && inRange(r.engagement, f.engagementMin) && (f.ageDays == null || f.ageDays === 0 || r.ageDays <= f.ageDays)
    && inRange(r.durationSec / 60, f.durationMin, f.durationMax);
}

/** База канала: медиана просмотров последних видео (без видео моложе 2 дней) */
export function baselineFrom(videos: Pick<Video, "publishedAt" | "views">[], now = Date.now()) {
  const v = videos.filter((x) => now - +new Date(x.publishedAt) > 2 * DAY).map((x) => x.views);
  return v.length >= 3 ? median(v) : v.length ? mean(v) : 0;
}

export function buildRow(v: Video, ch: Channel | undefined, now = Date.now()): ResearchRow {
  const ageDays = Math.max(1 / 24, (now - +new Date(v.publishedAt)) / DAY);
  const subs = ch?.subscribers ?? 0;
  return {
    id: v.id, title: v.title, thumbnail: v.thumbnail, publishedAt: v.publishedAt, ageDays: +ageDays.toFixed(2), durationSec: v.durationSec, isShort: v.isShort,
    views: v.views, likes: v.likes, comments: v.comments, engagement: v.views ? +(((v.likes + v.comments) / v.views) * 100).toFixed(2) : 0, tags: v.tags.slice(0, 30),
    channelId: v.channelId, channelTitle: v.channelTitle, channelAvatar: ch?.avatar, subs, hiddenSubs: !ch || ch.hiddenSubscribers, channelVideos: ch?.videoCount ?? 0,
    vph: +(v.views / Math.max(1, ageDays * 24)).toFixed(1), vphRecent: null, outlier: null, baseViews: null, ratio: ch && !ch.hiddenSubscribers && subs > 0 ? +(v.views / subs).toFixed(2) : null, viral: false, viralWhy: "",
  };
}

export async function runResearch(input: ResearchInputT, ctx: JobCtx): Promise<ResearchRun> {
  const s = await getSettings();
  const R = s.research;
  const f = input.filters;
  const pages = input.pages ?? R.pages;
  const lang = input.language ?? (R.language || s.contentLanguage);
  const region = (input.region ?? R.region) || undefined;
  const now = Date.now();
  let units = 0;

  ctx.progress("Поиск на YouTube", 5);
  const ids = await searchPaged(input.q, {
    pages, order: input.order ?? R.order, lang, region,
    publishedAfter: f.ageDays ? new Date(now - f.ageDays * DAY).toISOString() : undefined,
    duration: f.type === "shorts" ? "short" : undefined,
  });
  units += pages * 100;
  if (ctx.signal.aborted) throw new Error("cancelled");

  ctx.progress(`Статистика ${ids.length} видео`, 30);
  const videos = await getVideos(ids);
  const chans = await getChannelsFull(videos.map((v) => v.channelId), input.force);
  units += Math.ceil(ids.length / 50) * 2;
  await recordViews(videos.map((v) => ({ id: v.id, views: v.views })), now);

  let rows = videos.map((v) => buildRow(v, chans.get(v.channelId), now))
    .filter((r) => passCheap(r, f) && (input.mode !== "anomalies" || (!r.hiddenSubs && r.subs > 0 && r.ratio != null)));

  // Outlier: база канала
  const need = [...new Set(rows.map((r) => r.channelId))];
  let baselines = 0;
  /** база по формату: длинные сравниваем с длинными, Shorts — с Shorts (если таких ≥ 3) */
  const base = new Map<string, { all: number; long: number; short: number }>();
  const split = (up: Video[]) => { const lo = up.filter((x) => !x.isShort), sh = up.filter((x) => x.isShort), all = baselineFrom(up, now); return { all, long: lo.length >= 3 ? baselineFrom(lo, now) : all, short: sh.length >= 3 ? baselineFrom(sh, now) : all }; };
  const avg = (ch?: Channel) => { const a = ch?.videoCount ? ch.totalViews / ch.videoCount : 0; return { all: a, long: a, short: a }; };
  if (R.outlierBase === "median") {
    let i = 0;
    for (const cid of need) {
      if (ctx.signal.aborted) throw new Error("cancelled");
      const ch = chans.get(cid);
      ctx.progress(`База каналов ${++i}/${need.length}`, 40 + Math.round((i / Math.max(1, need.length)) * 50));
      if (!ch) continue;
      try { const up = await latestUploads(ch.uploadsPlaylistId, R.baseVideos, input.force); base.set(cid, split(up)); baselines++; units += 2; }
      catch (e) { rethrowCancelled(e); base.set(cid, avg(ch)); }
    }
  } else for (const cid of need) base.set(cid, avg(chans.get(cid)));

  for (const r of rows) {
    const bb = base.get(r.channelId); const b = bb ? (r.isShort ? bb.short : bb.long) : 0;
    r.baseViews = b ? Math.round(b) : null;
    r.outlier = b ? +(r.views / b).toFixed(1) : null;
    r.vphRecent = (await recentVph(r.id, now))?.vph ?? null;
    const vc = viralCheck(r.ageDays, r.outlier, r.vphRecent ?? r.vph, R.viral);
    r.viral = vc.ok; r.viralWhy = vc.why;
  }
  rows = rows.filter((r) => inRange(r.outlier, f.outlierMin, f.outlierMax) && (!f.viralOnly || r.viral));
  const key: Record<ResearchInputT["sort"], (r: ResearchRow) => number> = { outlier: (r) => r.outlier ?? 0, vph: (r) => r.vphRecent ?? r.vph, views: (r) => r.views, date: (r) => -r.ageDays, ratio: (r) => r.ratio ?? 0 };
  rows.sort((a, b) => key[input.sort](b) - key[input.sort](a));

  const run: ResearchRun = { id: crypto.randomUUID().slice(0, 8), createdAt: new Date().toISOString(), input: { ...input, pages }, rows, stats: { fetched: videos.length, shown: rows.length, channels: chans.size, baselines, units }, base: R.outlierBase };
  await writeJson(`research-runs/${run.id}.json`, run);
  const idx = await listResearch();
  idx.unshift({ id: run.id, createdAt: run.createdAt, q: input.q, mode: input.mode, shown: rows.length, fetched: videos.length });
  await writeJson("research-runs/index.json", idx.slice(0, 50));
  ctx.progress("Готово", 100);
  return run;
}

export const listResearch = () => readJson<{ id: string; createdAt: string; q: string; mode?: "outliers" | "anomalies"; shown: number; fetched: number }[]>("research-runs/index.json", []);
export const loadResearch = (id: string) => readJson<ResearchRun | null>(`research-runs/${id.replace(/[^\w-]/g, "")}.json`, null);
