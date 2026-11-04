import type { Channel, Video } from "./youtube.js";

export const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) || 1; };
const z = (a: number[]) => { const m = mean(a), s = std(a); return a.map((x) => (x - m) / s); };
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const DAY = 86400_000;

export type VideoRow = Video & { engagement: number; outlier: number; viewsPerDay: number; ageDays: number; bestScore: number };

export function videoRows(videos: Video[], now = Date.now()): VideoRow[] {
  const med = median(videos.map((v) => v.views)) || 1;
  const base = videos.map((v) => {
    const ageDays = Math.max(1, (now - +new Date(v.publishedAt)) / DAY);
    return { ...v, ageDays, engagement: v.views ? ((v.likes + v.comments) / v.views) * 100 : 0, outlier: v.views / med, viewsPerDay: v.views / ageDays, bestScore: 0 };
  });
  const zv = z(base.map((v) => Math.log10(v.views + 1))), ze = z(base.map((v) => v.engagement)), zd = z(base.map((v) => Math.log10(v.viewsPerDay + 1)));
  base.forEach((v, i) => { v.bestScore = +(0.6 * zv[i] + 0.25 * ze[i] + 0.15 * zd[i]).toFixed(3); });
  return base;
}

export const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export function localParts(iso: string, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hour12: false }).formatToParts(new Date(iso));
  const wd = f.find((p) => p.type === "weekday")!.value;
  const hour = Number(f.find((p) => p.type === "hour")!.value) % 24;
  return { weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd), hour };
}

export type Rpm = { niche: string; min: number; max: number };

export function computeReport(channel: Channel, all: Video[], opts: { count: number; type: "all" | "long" | "shorts"; tz: string; rpm: Rpm; shortsRpm: Rpm; now?: number }) {
  const now = opts.now ?? Date.now();
  const typed = all.filter((v) => opts.type === "all" || (opts.type === "shorts" ? v.isShort : !v.isShort));
  const sample = videoRows(typed.slice(0, opts.count), now);
  const views = sample.map((v) => v.views);
  const avgViews = Math.round(mean(views));
  const medViews = Math.round(median(views));
  const totLikes = sample.reduce((s, v) => s + v.likes + v.comments, 0);
  const totViews = views.reduce((s, x) => s + x, 0);
  const engagement = totViews ? (totLikes / totViews) * 100 : 0;
  const subs = channel.subscribers;
  const channelVirality = clamp(Math.round(2 * Math.log2(Math.max(avgViews, 1) / Math.max(subs * 0.1, 1)) + 5), 0, 10);
  const outlierShare = sample.length ? sample.filter((v) => v.outlier >= 2).length / sample.length : 0;

  // 30/30 — по всем загруженным видео (для полноты окон)
  const win = (from: number, to: number) => all.filter((v) => { const a = (now - +new Date(v.publishedAt)) / DAY; return a >= from && a < to; });
  const w1 = win(0, 30), w2 = win(30, 60);
  const last30 = w1.reduce((s, v) => s + v.views, 0), prev30 = w2.reduce((s, v) => s + v.views, 0);
  const growthPct = prev30 ? ((last30 - prev30) / prev30) * 100 : last30 ? 100 : 0;

  // Доход: длинные по RPM ниши, Shorts по RPM Shorts
  const longViews30 = w1.filter((v) => !v.isShort).reduce((s, v) => s + v.views, 0);
  const shortViews30 = last30 - longViews30;
  const income = {
    monthMin: Math.round((longViews30 / 1000) * opts.rpm.min + (shortViews30 / 1000) * opts.shortsRpm.min),
    monthMax: Math.round((longViews30 / 1000) * opts.rpm.max + (shortViews30 / 1000) * opts.shortsRpm.max),
    rpm: opts.rpm, shortsRpm: opts.shortsRpm, longViews30, shortViews30,
  };

  // Дни недели и часы: видео за 30 дней, если их < 5 — вся выборка
  const base = w1.length >= 5 ? videoRows(w1, now) : sample;
  const byDay = WEEKDAYS.map((label) => ({ label, total: 0, count: 0, avg: 0 }));
  const byHour = Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, "0"), total: 0, count: 0, avg: 0 }));
  for (const v of base) { const p = localParts(v.publishedAt, opts.tz); byDay[p.weekday].total += v.views; byDay[p.weekday].count++; byHour[p.hour].total += v.views; byHour[p.hour].count++; }
  for (const d of [...byDay, ...byHour]) d.avg = d.count ? Math.round(d.total / d.count) : 0;
  const bestDay = byDay.reduce((b, d, i) => (d.avg > byDay[b].avg ? i : b), 0);
  const bestHour = byHour.reduce((b, d, i) => (d.avg > byHour[b].avg ? i : b), 0);

  // Теги
  const tagMap = new Map<string, { tag: string; views: number[] }>();
  for (const v of sample) {
    const set = new Set([...v.tags, ...(v.title.match(/#[\p{L}\d_]+/gu) ?? []), ...(v.description.match(/#[\p{L}\d_]+/gu) ?? [])].map((t) => t.toLowerCase().trim()));
    for (const raw of set) { const k = raw.replace(/^#/, ""); if (!k) continue; const e = tagMap.get(k) ?? { tag: raw, views: [] }; e.views.push(v.views); tagMap.set(k, e); }
  }
  const tagStats = [...tagMap.entries()].filter(([, e]) => e.views.length >= 2).map(([k, e]) => ({ tag: k, hashtag: e.tag.startsWith("#"), count: e.views.length, avgViews: Math.round(mean(e.views)) }));
  const golden = tagStats.filter((t) => t.avgViews > avgViews).sort((a, b) => b.avgViews - a.avgViews).slice(0, 12);
  const icebox = tagStats.filter((t) => t.avgViews < avgViews).sort((a, b) => a.avgViews - b.avgViews).slice(0, 12);

  const top3 = [...sample].sort((a, b) => b.views - a.views).slice(0, 3);
  const shortsShare = sample.length ? sample.filter((v) => v.isShort).length / sample.length : 0;

  return {
    channel,
    params: { count: opts.count, type: opts.type, tz: opts.tz },
    stats: { sampleSize: sample.length, avgViews, medianViews: medViews, engagement: +engagement.toFixed(2), channelVirality, outlierShare: +outlierShare.toFixed(2), shortsShare: +shortsShare.toFixed(2), avgDurationSec: Math.round(mean(sample.map((v) => v.durationSec))) },
    windows: { last30, prev30, growthPct: +growthPct.toFixed(1), uploads30: w1.length, uploadsPrev30: w2.length },
    income,
    schedule: { byDay, byHour, bestDay, bestHour, basis: w1.length >= 5 ? "30d" : "sample" as "30d" | "sample" },
    tags: { golden, icebox },
    top3: top3.map((v) => v.id),
    videos: sample,
  };
}
export type ComputedReport = ReturnType<typeof computeReport>;
