/** Saved observations, not realtime telemetry. Legacy points remain readable but cannot trigger spikes. */
import type { Comp, TVideo, Pt } from "./competitors.js";
import { median } from "./metrics.js";
const HOUR = 3600_000;
const MAX_HOURS = 48;
export type RateInterval = { from: string; to: string; hours: number; deltaViews: number; verified: boolean };
export type SpikeEvidence = RateInterval & { rate: number; median: number; ratio: number; threshold: number; format: "long" | "short"; peers: { id: string; rate: number; from: string; to: string }[] };
const valid = (p: Pt | undefined): p is Pt => !!p && Number.isFinite(p.t) && p.t >= 0 && p.t <= 8.64e15 && Number.isSafeInteger(p.v) && p.v >= 0 && p.viewsKnown !== false;

export function recentRate(v: TVideo, now = Date.now()): { rate: number | null; interval: RateInterval | null; reason: string } {
  const pts = v.points, p = pts.at(-1);
  const no = (reason: string) => ({ rate: null, interval: null, reason });
  if (!valid(p)) return no("Нет известного счётчика просмотров");
  if (p.t > now || now - p.t > MAX_HOURS * HOUR) return no("Последний снимок устарел или его дата некорректна");
  if (pts.some((x, i) => i > 0 && x.t <= pts[i - 1].t)) return no("Нарушен порядок дат снимков");
  let index = -1;
  for (let i = pts.length - 2; i >= 0; i--) if (p.t - pts[i].t >= HOUR) { index = i; break; }
  if (index < 0) return no("Нужны два снимка с интервалом от 1 до 48 часов");
  const first = pts[index], hours = (p.t - first.t) / HOUR;
  if (hours > MAX_HOURS) return no("Интервал между снимками больше 48 часов");
  const window = pts.slice(index);
  if (window.some((x, i) => !valid(x) || (i > 0 && x.v < window[i - 1].v))) return no("Пропуск счётчика или коррекция просмотров внутри интервала");
  const interval = { from: new Date(first.t).toISOString(), to: new Date(p.t).toISOString(), hours, deltaViews: p.v - first.v, verified: window.every(x => x.viewsKnown === true) };
  return { rate: interval.deltaViews / hours, interval, reason: interval.verified ? "" : "Архивные снимки: происхождение счётчиков не подтверждено; алерт отключён" };
}

/** Same format, >=3 known videos older than 48h, no cross-format or mean fallback. */
export function compBase(c: Pick<Comp, "videos">, now = Date.now()) {
  const base = (short: boolean) => {
    const values = c.videos.filter(v => v.isShort === short && Number.isFinite(Date.parse(v.publishedAt)) && now - Date.parse(v.publishedAt) >= 48 * HOUR)
      .map(v => v.points.at(-1)).filter((p): p is Pt => valid(p) && p.viewsKnown === true && p.t <= now && now - p.t <= MAX_HOURS * HOUR).map(p => p.v);
    return values.length >= 3 ? median(values) : 0;
  };
  return { long: base(false), short: base(true) };
}

export function videoStats(v: TVideo, baseIn: number | { long: number; short: number }, now = Date.now()) {
  const base = typeof baseIn === "number" ? baseIn : v.isShort ? baseIn.short : baseIn.long;
  const p = v.points.at(-1), published = Date.parse(v.publishedAt);
  const viewsKnown = valid(p) && p.t <= now && Number.isFinite(published) && published <= p.t;
  const views = viewsKnown ? p.v : 0;
  const ageH = viewsKnown ? Math.max(1, (p.t - published) / HOUR) : null;
  const recent = recentRate(v, now);
  return { views, viewsKnown, likes: p?.l ?? 0, comments: p?.c ?? 0, vph: ageH == null ? null : +(views / ageH).toFixed(1),
    vphRecent: viewsKnown && recent.rate != null ? +recent.rate.toFixed(1) : null,
    interval: viewsKnown ? recent.interval : null, rateReason: viewsKnown ? recent.reason : "Нет корректного снимка просмотров и даты публикации",
    outlier: viewsKnown && base > 0 ? +(views / base).toFixed(1) : null, ageDays: Number.isFinite(published) ? +((now - published) / (24 * HOUR)).toFixed(1) : 0 };
}

/** Require >=3 OTHER same-format videos observed over the same endpoints (10min tolerance). */
export function spikeEvidence(v: TVideo, videos: TVideo[], threshold: number, now = Date.now()): SpikeEvidence | null {
  if (v.durationKnown === false || !(threshold > 0) || !Number.isFinite(threshold) || !Number.isFinite(Date.parse(v.publishedAt)) || now - Date.parse(v.publishedAt) <= 48 * HOUR) return null;
  const r = recentRate(v, now), i = r.interval;
  if (!i?.verified || r.rate == null || r.rate < 10 || Date.parse(v.publishedAt) > Date.parse(i.from)) return null;
  const seen = new Set([v.id]);
  const peers: SpikeEvidence["peers"] = [];
  for (const other of videos) {
    if (other.durationKnown === false || seen.has(other.id) || other.isShort !== v.isShort) continue;
    seen.add(other.id);
    const q = recentRate(other, now), j = q.interval;
    if (!j?.verified || q.rate == null || !Number.isFinite(Date.parse(other.publishedAt)) || Date.parse(other.publishedAt) > Date.parse(j.from)) continue;
    if (Math.abs(Date.parse(j.from) - Date.parse(i.from)) > 600_000 || Math.abs(Date.parse(j.to) - Date.parse(i.to)) > 600_000) continue;
    peers.push({ id: other.id, rate: q.rate, from: j.from, to: j.to });
  }
  if (peers.length < 3) return null;
  const norm = median(peers.map(p => p.rate));
  if (!(norm > 0) || r.rate < threshold * norm) return null;
  return { ...i, rate: r.rate, median: norm, ratio: r.rate / norm, threshold, format: v.isShort ? "short" : "long", peers };
}
