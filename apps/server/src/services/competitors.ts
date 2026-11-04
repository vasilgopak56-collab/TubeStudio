import { log } from "../lib/logging.js";
import crypto from "node:crypto";
import { loadCompetitorStore, saveCompetitorStore, type CompetitorStore } from "./competitorStore.js";
import { trackerOutlier, type OutlierEvidence } from "./trackerOutlier.js";
import { ApiError } from "../lib/errors.js";
import { getSettings } from "./settings.js";
import { getChannelsFull, researchUploadsPage, resolveChannel, type Video } from "./youtube.js";
import { compBase, videoStats, spikeEvidence, type SpikeEvidence } from "./competitorMetrics.js";
export { compBase, videoStats } from "./competitorMetrics.js";

import { channelSnapshot, recordChannelSnapshot, channelCounterStats, subscriberEvidence, type ChannelSnapshot, type SubscriberEvidence } from "./channelCounters.js";

const DAY = 86400_000;
export type Pt = { t: number; v: number; l: number; c: number; viewsKnown?: boolean };
export type TVideo = { id: string; title: string; publishedAt: string; thumbnail?: string; durationSec: number; durationKnown?: boolean; sourceChannelId?: string; isShort: boolean; points: Pt[]; alerted: string[] };
export type Comp = { id: string; title: string; handle?: string; avatar?: string; uploadsPlaylistId: string; addedAt: string; lastRefresh?: string; lastError?: string; history: ChannelSnapshot[]; channelError?: string; videos: TVideo[] };
export type Alert = { id: string; t: string; channelId: string; channelTitle: string; kind: "new" | "outlier" | "spike" | "subs"; videoId?: string; title: string; text: string; read: boolean; evidence?: SpikeEvidence; subsEvidence?: SubscriberEvidence; outlierEvidence?: OutlierEvidence };
type Store = CompetitorStore;
const load = loadCompetitorStore;
let chain: Promise<unknown> = Promise.resolve();
/** Последовательные изменения стора */
function mutate<T>(fn: (s: Store) => Promise<T>): Promise<T> {
  const p = chain.then(async () => { const s = await load(); const r = await fn(s); s.alerts = s.alerts.slice(0, 500); await saveCompetitorStore(s); return r; });
  chain = p.catch(() => {});
  return p;
}


function summarize(c: Comp, now = Date.now()) {
  const h = c.history, counters = channelCounterStats(h, now);
  const videos = c.videos.map((v) => { const basis=trackerOutlier(c.id,v,c.videos,now); return ({ id: v.id, title: v.title, publishedAt: v.publishedAt, thumbnail: v.thumbnail, durationSec: v.durationSec, isShort: v.isShort, ...videoStats(v, 0, now), outlier: basis.ratio, outlierBasis: basis }); });
  return {
    id: c.id, title: c.title, handle: c.handle, avatar: c.avatar, addedAt: c.addedAt, lastRefresh: c.lastRefresh, lastError: c.lastError, channelError: c.channelError,
    ...counters, subsDelta7: counters.week.subs.delta, viewsDelta7: counters.week.views.delta,
    uploads30: c.videos.filter((v) => Number.isFinite(Date.parse(v.publishedAt)) && Date.parse(v.publishedAt) <= now && now - Date.parse(v.publishedAt) <= 30 * DAY).length,
    medianViews: null, medianViewsReason: "Общая медиана не используется: база рассчитывается отдельно для каждого видео", history: h.slice(-60), videos,
  };
}
export type CompSummary = ReturnType<typeof summarize>;

export async function listCompetitors() { const s = await load(); return { channels: s.channels.map((c) => summarize(c)), unread: s.alerts.filter((a) => !a.read).length, lastAuto: s.lastAuto }; }
export async function getCompetitor(id: string) { const c = (await load()).channels.find((x) => x.id === id); if (!c) throw new ApiError("NOT_FOUND", "Канал не найден в трекере", 404); return summarize(c); }
export async function listAlerts() { return (await load()).alerts; }
export const markAlertsRead = (ids?: string[]) => mutate(async (s) => { for (const a of s.alerts) if (!ids || ids.includes(a.id)) a.read = true; return {}; });
export const clearAlerts = () => mutate(async (s) => { s.alerts = []; return {}; });

export async function addCompetitor(input: string) {
  await load(); // Refuse damaged storage before spending external quota.
  const ch = await resolveChannel(input);
  await mutate(async (s) => {
    if (s.channels.some((c) => c.id === ch.id)) throw new ApiError("VALIDATION", `«${ch.title}» уже отслеживается`, 400);
    if (s.channels.length >= 50) throw new ApiError("VALIDATION", "Максимум 50 каналов в трекере", 400);
    s.channels.push({ id: ch.id, title: ch.title, handle: ch.handle, avatar: ch.avatar, uploadsPlaylistId: ch.uploadsPlaylistId, addedAt: new Date().toISOString(), history: [], videos: [] });
    return {};
  });
  await refreshCompetitors([ch.id], { silentNew: true });
  return getCompetitor(ch.id);
}
export const removeCompetitor = (id: string) => mutate(async (s) => { s.channels = s.channels.filter((c) => c.id !== id); s.alerts = s.alerts.filter((a) => a.channelId !== id); return {}; });

/** Обновление: channels (1 ед./50) + по 2 ед. на канал. Генерирует алерты */
export async function refreshCompetitors(ids?: string[], o: { silentNew?: boolean; auto?: boolean } = {}) {
  const st = await getSettings(); const C = st.research.competitors;
  const cur = await load();
  const targets = cur.channels.filter((c) => !ids || ids.includes(c.id));
  if (!targets.length) return { refreshed: 0, alerts: 0, units: 0, failed: 0 };
  let now = Date.now(), nowIso = new Date(now).toISOString(), today = nowIso.slice(0, 10);
  const chMap = await getChannelsFull(targets.map((c) => c.id), true);
  const channelObservedAt = Date.now();
  const uploads = new Map<string, Video[] | Error>();
  const observedAt = new Map<string, number>();
  for (const c of targets) { try { uploads.set(c.id, await researchUploadsPage(c.uploadsPlaylistId, C.videosPerChannel).then(videos => { if(videos.some(v => v.channelId !== c.id)) throw new ApiError("UPSTREAM", "Канал видео не совпал с запрошенным", 502); return videos; })); observedAt.set(c.id, Date.now()); } catch (e) { uploads.set(c.id, e as Error); } }
  now = Date.now(); nowIso = new Date(now).toISOString(); today = nowIso.slice(0, 10);
  let newAlerts = 0;
  await mutate(async (s) => {
    for (const c of s.channels) {
      if (!targets.some((t) => t.id === c.id)) continue;
      const info = chMap.get(c.id), up = uploads.get(c.id);
      const push = (a: Omit<Alert, "id" | "t" | "read" | "channelId" | "channelTitle">) => { s.alerts.unshift({ id: crypto.randomUUID().slice(0, 8), t: nowIso, read: false, channelId: c.id, channelTitle: c.title, ...a }); newAlerts++; };
      if (info) {
        Object.assign(c, { title: info.title, avatar: info.avatar, handle: info.handle });
        c.channelError = undefined;
        c.history = recordChannelSnapshot(c.history, channelSnapshot(info, channelObservedAt));
        const evidence = subscriberEvidence(c.history, C.alertSubsPct, now);
        if (evidence && !s.alerts.some(a => a.channelId === c.id && a.kind === "subs" && a.t.slice(0,10) === today)) {
          push({kind:"subs", title:c.title, subsEvidence:evidence, text:`Изменение публичного счётчика подписчиков ≈ +${evidence.percent.toFixed(1)}% между снимками (${evidence.before.toLocaleString("ru-RU")} → ${evidence.after.toLocaleString("ru-RU")}); интервал ${evidence.hours.toFixed(2)} ч. Это не точный прирост аудитории.`});
        }
      } else c.channelError = "API не вернул этот канал: новый снимок счётчиков не создан";
      if (up instanceof Error) { c.lastError = "Обновление загрузок недоступно: прежние наблюдения сохранены"; continue; }
      if (!up) continue;
      c.lastError = undefined;
      const known = new Map(c.videos.map((v) => [v.id, v]));
      const firstRun = !c.videos.length;
      for (const v of up) {
        let tv = known.get(v.id);
        if (!tv) {
          tv = { id: v.id, title: v.title, publishedAt: v.publishedAt, thumbnail: v.thumbnail, durationSec: v.durationSec, isShort: v.isShort, points: [], alerted: [] };
          c.videos.push(tv);
          if (C.alertNew && !firstRun && !o.silentNew && Number.isFinite(Date.parse(v.publishedAt)) && now >= Date.parse(v.publishedAt) && now - Date.parse(v.publishedAt) < 7 * DAY) { push({ kind: "new", videoId: v.id, title: v.title, text: `Новое видео${v.isShort ? " (до 180 с; не статус Shorts)" : ""}` }); tv.alerted.push("new"); }
        }
        if (tv.points.at(-1)?.t != null && tv.points.at(-1)!.t > observedAt.get(c.id)!) continue;
        Object.assign(tv, { title: v.title, thumbnail: v.thumbnail, publishedAt:v.publishedAt, durationSec:v.durationSec, isShort:v.isShort, durationKnown:v.durationKnown===true, sourceChannelId:v.channelId });
        const point: Pt = { t: observedAt.get(c.id)!, v: v.views, l: v.likes, c: v.comments, viewsKnown: v.viewsKnown === true };
        const lp = tv.points[tv.points.length - 1];
        if (lp?.t === point.t) tv.points[tv.points.length - 1] = point;
        else if (!lp || lp.t < point.t) tv.points.push(point);
        tv.points = tv.points.slice(-60);
      }
      const ids2 = new Set(up.map((v) => v.id));
      c.videos = c.videos.filter((v) => ids2.has(v.id) || now - +new Date(v.publishedAt) < 90 * DAY).sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt)).slice(0, Math.max(C.videosPerChannel, 15) + 10);
      const stats = c.videos.filter(v => ids2.has(v.id) && v.points.at(-1)?.t === observedAt.get(c.id)).map(tv => ({tv, basis:trackerOutlier(c.id,tv,c.videos,now)}));
      for (const { tv, basis } of stats) {
        if (C.alertOutlier > 0 && basis.ratio != null && basis.ratio >= C.alertOutlier && !tv.alerted.includes("outlier-v1")) {
          if (!firstRun && now-Date.parse(tv.publishedAt) <= 30*DAY) push({kind:"outlier",videoId:tv.id,title:tv.title,outlierEvidence:{...basis,threshold:C.alertOutlier},text:`Outlier ×${basis.ratio.toFixed(2)}: ${basis.targetViews} просмотров / медиана ${basis.median} по ${basis.rows.filter(r=>r.included).length} другим видео той же группы длительности. Не прогноз успеха.`});
          tv.alerted.push("outlier-v1");
        }
        // Только сравнимые интервалы того же формата, без lifetime-подмены.
        const evidence = spikeEvidence(tv, c.videos, C.alertVphX, now);
        if (evidence) {
          const tag = `spike:${today}`;
          if (!tv.alerted.includes(tag)) {
            push({ kind: "spike", videoId: tv.id, title: tv.title, evidence, text: `Всплеск: в среднем ${evidence.rate.toFixed(1)} просмотров/ч между снимками за ${evidence.hours.toFixed(2)} ч — ${evidence.ratio.toFixed(1)}× к медиане ${evidence.peers.length} других видео того же формата` });
            const spikes = tv.alerted.filter((x) => x.startsWith("spike:")).slice(-5);
            tv.alerted = [...tv.alerted.filter((x) => !x.startsWith("spike:")), ...spikes, tag];
          }
        }
      }
      c.lastRefresh = nowIso;
    }
    if (o.auto) s.lastAuto = nowIso;
    return {};
  });
  return { failed: targets.filter(c=>uploads.get(c.id) instanceof Error||!chMap.has(c.id)).length, refreshed: targets.length, alerts: newAlerts, units: Math.ceil(targets.length / 50) + targets.length * 2 };
}

/** Планировщик: раз в 15 мин проверяем, не пора ли авто-обновиться */
let timer: NodeJS.Timeout | null = null;
let initialTimer: NodeJS.Timeout | null = null;
let schedulerStopping = false;
const schedulerTasks = new Set<Promise<void>>();
export function startCompetitorScheduler() {
  if (timer || schedulerStopping || process.env.TS_NO_SCHEDULER) return;
  const tick = async () => {
    try {
      const st = await getSettings(); const h = st.research.competitors.refreshHours;
      if (!h) return;
      const s = await load();
      const due = s.channels.filter((c) => !c.lastRefresh || Date.now() - +new Date(c.lastRefresh) >= h * 3600_000).map((c) => c.id);
      if (due.length) await refreshCompetitors(due, { auto: true });
      if (s.channels.length) { const { maybeAutoDigest } = await import("./digest.js"); await maybeAutoDigest(); }
    } catch (e) { log.warn({ event: "competitors_refresh_failed", errorType: (e as Error).name }); }
  };
  const launch = () => { if (schedulerStopping) return; const p=tick(); schedulerTasks.add(p); void p.finally(()=>schedulerTasks.delete(p)); };
  initialTimer=setTimeout(launch, 60_000); initialTimer.unref();
  timer = setInterval(launch, 15 * 60_000); timer.unref();
}
export const activeCompetitorRefreshes = () => schedulerTasks.size;
/** Stop future ticks and wait for already-running refreshes before releasing the data lock. */
export async function stopCompetitorScheduler() {
  schedulerStopping=true;
  if(initialTimer)clearTimeout(initialTimer);if(timer)clearInterval(timer);
  initialTimer=null;timer=null;
  await Promise.allSettled([...schedulerTasks]);
}
