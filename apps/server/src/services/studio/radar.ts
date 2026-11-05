// Радар «Идеи для канала» (Выпуск 1, карточка знаний 45).
// Ищет маленькие каналы того же типа, у которых длинное видео обогнало канал:
// поиск YouTube «по просмотрам» за месяц и год, «похожие видео», проверка каналов,
// проверка «тот же тип» дешёвой моделью и «ваша версия». База копится в
// TubeStudioData/studio/radar/<канал>.json; скрытые идеи больше не показываются.
import crypto from "node:crypto";
import { z } from "zod";
import { readJson, writeJson } from "../../lib/storage.js";
import { ApiError, isFinancialError } from "../../lib/errors.js";
import { checkCancelled, rethrowCancelled } from "../../lib/taskContext.js";
import { sleep } from "../../lib/http.js";
import type { JobCtx } from "../../lib/jobs.js";
import { config } from "../../config.js";
import { log } from "../../lib/logging.js";
import { webSearch, webChannel, webRelated, ytSuggest, channelRss, ytThumb, type WebVideo } from "./ytweb.js";
import { assertChannelBudget, getChannel, type Channel } from "./channels.js";

// ---------- хранилище ----------
export type RVideo = {
  id: string; title: string; channelId: string;
  views?: number; durationSec?: number;
  /** Возраст ролика в днях на момент seenAt (YouTube даёт «2 weeks ago»); publishedAt — точная дата, если известна. */
  ageDays?: number; publishedAt?: string; seenAt: string;
  foundBy: string[];
};
export type TypeVerdict = { verdict: "yes" | "no" | "unsure"; format?: string; reason?: string; model?: string; at: string };
export type RChannel = {
  id: string; name: string; handle?: string; subs?: number; videoCount?: number; verified?: boolean;
  checkedAt?: string; longCount?: number; medianViews?: number;
  /** Самое старое длинное видео на вкладке «Видео»; exact=false — у канала больше роликов, чем видно (формат «давно»). */
  firstLong?: { ageDays: number; exact: boolean; at: string };
  type?: TypeVerdict;
  sample?: boolean;
};
export type Idea = {
  videoId: string; channelId: string; status: "new" | "hidden" | "taken";
  firstSeen: string; lastSeen: string; projectId?: string;
  version?: { title: string; angle: string; model?: string; at: string };
};
export type RadarRun = {
  id: string; startedAt: string; finishedAt?: string; queries: string[];
  stats: Record<string, number>; notes: string[]; stopped?: string;
};
export type Sample = { key: string; id: string; name: string; subs?: number; topTitles: string[]; topVideoIds: string[]; at: string };
export type RadarStore = {
  version: 1; channelId: string;
  videos: Record<string, RVideo>; channels: Record<string, RChannel>; ideas: Record<string, Idea>;
  samples: Sample[]; runs: RadarRun[];
};
const file = (channelId: string) => `studio/radar/${channelId.replace(/[^\w-]/g, "")}.json`;
const empty = (channelId: string): RadarStore => ({ version: 1, channelId, videos: {}, channels: {}, ideas: {}, samples: [], runs: [] });
export async function loadRadar(channelId: string): Promise<RadarStore> {
  const raw = await readJson<RadarStore | null>(file(channelId), null);
  if (!raw || typeof raw !== "object" || !raw.videos || !raw.channels || !raw.ideas) return empty(channelId);
  return { ...empty(channelId), ...raw, channelId };
}
const queues = new Map<string, Promise<unknown>>();
function withStore<T>(channelId: string, fn: (s: RadarStore) => T | Promise<T>): Promise<T> {
  const prev = queues.get(channelId) ?? Promise.resolve();
  const run = prev.then(async () => { const s = await loadRadar(channelId); const out = await fn(s); await saveStore(s); return out; });
  queues.set(channelId, run.catch(() => {}));
  return run;
}
async function saveStore(s: RadarStore) { prune(s); await writeJson(file(s.channelId), s, { backup: true }); }

// ---------- оценка ----------
const DAY = 86_400_000;
const median = (xs: number[]) => { if (!xs.length) return undefined; const a = [...xs].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const LATIN = new Set("en de es fr pt it pl tr nl sv no nb da fi cs sk ro hu id ms vi hr sl lt lv et".split(" "));
const CYRILLIC = new Set("ru uk be bg sr kk mk".split(" "));
/** Название на алфавите языка канала: англоязычному каналу не нужны идеи с хинди или кириллицей. */
export function scriptMatches(title: string, language: string): boolean {
  // Смотрим само название (до «|» — после него часто английские теги).
  const head = title.split(/\s[|•–—-]\s|\|/)[0];
  const headLetters = head.match(/\p{L}/gu) ?? [];
  const letters = headLetters.length >= 4 ? headLetters : title.match(/\p{L}/gu) ?? [];
  if (letters.length < 4) return true;
  const code = language.slice(0, 2).toLowerCase();
  const share = (re: RegExp) => letters.filter((c) => re.test(c)).length / letters.length;
  if (LATIN.has(code)) return share(/\p{Script=Latin}/u) >= 0.6;
  if (CYRILLIC.has(code)) return share(/\p{Script=Cyrillic}/u) >= 0.5;
  return true;
}
/** Слишком длинные ролики (фон на 3 часа, трансляции, сборники) — другой формат. */
const maxIdeaSec = (lengthMin: number) => Math.max(4 * lengthMin, 90) * 60;
/** Возраст сейчас: замер + прошедшее время. */
export const ageNow = (ageDays: number | undefined, at: string | undefined, publishedAt?: string, now = Date.now()) =>
  publishedAt && Number.isFinite(Date.parse(publishedAt)) ? (now - Date.parse(publishedAt)) / DAY
    : isNum(ageDays) ? ageDays + Math.max(0, (now - Date.parse(at ?? new Date(now).toISOString())) / DAY) : undefined;

export type IdeaView = {
  videoId: string; title: string; url: string; thumb: string; views: number; durationSec?: number; ageDays?: number;
  channel: { id: string; name: string; handle?: string; url: string; subs: number; medianViews?: number; firstLongAgeDays?: number; firstLongExact?: boolean; format?: string; type?: TypeVerdict["verdict"]; typeReason?: string };
  multiplier: number; outlier?: number; score: number; relevance: number; status: Idea["status"]; projectId?: string;
  version?: Idea["version"]; foundBy: string[]; firstSeen?: string;
};
function evaluate(s: RadarStore, v: RVideo, ch: Channel, exclude: Set<string>, topic: Set<string>, now = Date.now()): IdeaView | null {
  const t = ch.radar;
  const c = s.channels[v.channelId];
  if (!c || !isNum(c.subs) || exclude.has(c.id)) return null;
  if (c.subs > t.maxSubs || !isNum(v.views) || v.views < t.minViews) return null;
  if (isNum(v.durationSec) && (v.durationSec < t.minDurationSec || v.durationSec > maxIdeaSec(ch.lengthMin))) return null;
  if (!scriptMatches(v.title, ch.language)) return null;
  const multiplier = v.views / Math.max(c.subs, 50);
  if (multiplier < t.minMultiplier) return null;
  const outlier = isNum(c.medianViews) && c.medianViews > 0 ? v.views / c.medianViews : undefined;
  const firstLongAgeDays = c.firstLong ? ageNow(c.firstLong.ageDays, c.firstLong.at, undefined, now) : undefined;
  const fresh = !c.firstLong?.exact || !isNum(firstLongAgeDays) ? 0 : firstLongAgeDays <= 45 ? 1.5 : firstLongAgeDays <= 120 ? 1 : firstLongAgeDays <= 365 ? 0.4 : 0;
  const typeAdj = c.type?.verdict === "yes" ? 0.5 : c.type?.verdict === "unsure" ? 0 : c.type?.verdict === "no" ? -3 : 0;
  const rel = relevance(v.title, topic);
  const score = 2 * Math.log10(multiplier) + Math.log10(v.views) + fresh + 0.5 * Math.log10(Math.max(outlier ?? 1, 1)) + typeAdj + (c.type ? 0 : 0.3 * Math.min(rel, 3));
  const idea = s.ideas[v.id];
  return {
    videoId: v.id, title: v.title, url: `https://www.youtube.com/watch?v=${v.id}`, thumb: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
    views: v.views, durationSec: v.durationSec, ageDays: ageNow(v.ageDays, v.seenAt, v.publishedAt, now),
    channel: { id: c.id, name: c.name, handle: c.handle, url: `https://www.youtube.com/channel/${c.id}`, subs: c.subs, medianViews: c.medianViews, firstLongAgeDays, firstLongExact: c.firstLong?.exact, format: c.type?.format, type: c.type?.verdict, typeReason: c.type?.reason },
    multiplier: Math.round(multiplier * 10) / 10, outlier: outlier === undefined ? undefined : Math.round(outlier * 10) / 10,
    score: Math.round(score * 100) / 100, relevance: rel, status: idea?.status ?? "new", projectId: idea?.projectId, version: idea?.version, foundBy: v.foundBy, firstSeen: idea?.firstSeen,
  };
}

export const IdeaSort = z.enum(["new", "multiplier", "views", "best"]);
export const IdeaPeriod = z.enum(["month", "year", "all"]);
export type IdeaListOpts = { sort?: z.infer<typeof IdeaSort>; show?: "active" | "hidden" | "taken" | "rejected" | "all"; period?: z.infer<typeof IdeaPeriod>; perChannel?: number; limit?: number };
function ownIds(ch: Channel) { const id = /UC[\w-]{22}/.exec(ch.ownChannel)?.[0]; return new Set(id ? [id] : []); }
export function rankIdeas(s: RadarStore, ch: Channel, o: IdeaListOpts = {}, now = Date.now()): IdeaView[] {
  const exclude = ownIds(ch), topic = topicTokens(ch, s);
  const all = Object.values(s.videos).map((v) => evaluate(s, v, ch, exclude, topic, now)).filter((x): x is IdeaView => !!x);
  const show = o.show ?? "active";
  const picked = all.filter((x) =>
    show === "all" ? true
      : show === "hidden" ? x.status === "hidden"
        : show === "taken" ? x.status === "taken"
          : show === "rejected" ? x.status === "new" && x.channel.type === "no"
            : x.status === "new" && x.channel.type !== "no");
  const maxAge = o.period === "month" ? 31 : o.period === "year" ? 366 : Infinity;
  const inPeriod = picked.filter((x) => !isNum(x.ageDays) || x.ageDays <= maxAge);
  const sort = o.sort ?? "new";
  const byScore = (a: IdeaView, b: IdeaView) => b.score - a.score;
  inPeriod.sort(sort === "multiplier" ? (a, b) => b.multiplier - a.multiplier : sort === "views" ? (a, b) => b.views - a.views : byScore);
  // Не больше perChannel идей с канала; номер идеи внутри канала (0, 1, 2) нужен сортировке «новые форматы».
  const per = new Map<string, number>(), kept: { x: IdeaView; nth: number }[] = [];
  for (const x of inPeriod) {
    const n = per.get(x.channel.id) ?? 0;
    if (n >= (o.perChannel ?? 3)) continue;
    per.set(x.channel.id, n + 1); kept.push({ x, nth: n });
  }
  if (sort === "new") {
    // «Сначала новые форматы»: тот же тип (или слова темы без ИИ) → канал моложе (шаг 2 недели) →
    // сначала по одной идее с канала → оценка.
    const group = (x: IdeaView) => x.channel.type === "yes" || (!x.channel.type && x.relevance >= 1) ? 0 : 1;
    const bucket = (x: IdeaView) => x.channel.firstLongExact && isNum(x.channel.firstLongAgeDays) ? Math.floor(x.channel.firstLongAgeDays / 14) : 1e6;
    kept.sort((a, b) => group(a.x) - group(b.x) || bucket(a.x) - bucket(b.x) || a.nth - b.nth || byScore(a.x, b.x));
  }
  return kept.slice(0, o.limit ?? 200).map((k) => k.x);
}

// ---------- помощь ИИ (подменяется в тестах) ----------
export type LlmImage = { mime: string; b64: string };
export type TypeCandidate = { channelId: string; name: string; titles: string[]; thumb?: LlmImage };
export type RadarAi = {
  ready: () => Promise<boolean>;
  queries: (ch: Channel, sampleTitles: string[]) => Promise<string[]>;
  typeCheck: (ch: Channel, sample: { titles: string[]; thumbs: LlmImage[] }, batch: TypeCandidate[]) => Promise<{ channelId: string; verdict: TypeVerdict["verdict"]; format?: string; reason?: string; model?: string }[]>;
  versions: (ch: Channel, items: { videoId: string; title: string; channelName: string; format?: string }[]) => Promise<{ videoId: string; title: string; angle: string; model?: string }[]>;
};
const LANG: Record<string, string> = { en: "English", ru: "Russian", de: "German", es: "Spanish", fr: "French", pt: "Portuguese", it: "Italian", uk: "Ukrainian", pl: "Polish", tr: "Turkish" };
const langName = (code: string) => LANG[code.slice(0, 2)] ?? code;
const profileText = (ch: Channel) => [
  `Channel: ${ch.name}`, ch.niche && `Niche: ${ch.niche}`, ch.format && `Format: ${ch.format}`, ch.audience && `Audience: ${ch.audience}`,
  `Language: ${langName(ch.language)}`, `Typical length: ${ch.lengthMin} min`,
].filter(Boolean).join("\n");

export const llmRadarAi: RadarAi = {
  async ready() {
    const { hasAnymodel } = await import("../anymodel.js");
    const { getSettings } = await import("../settings.js");
    const s = await getSettings();
    return !!(config.keys.anthropic || config.keys.gemini || (hasAnymodel() && s.anymodel.enabled));
  },
  async queries(ch, sampleTitles) {
    const { generateJson } = await import("../llm.js");
    const r = await generateJson({
      fast: true, maxTokens: 900, temperature: 0.8,
      system: "You help find small YouTube channels of the same type. Write short YouTube search queries (2–6 words) that such channels put into their video titles. Vary the subtopics. No channel names, no hashtags, no years.",
      user: `${profileText(ch)}\nTitles of successful sample videos:\n${sampleTitles.slice(0, 15).map((t) => `- ${t}`).join("\n") || "- (none)"}\n\nReturn {"queries": [10 queries in ${langName(ch.language)}]}`,
    }, z.object({ queries: z.array(z.string().trim().min(2).max(80)).min(1).max(15) }));
    return r.data.queries;
  },
  async typeCheck(ch, sample, batch) {
    const { generateJson } = await import("../llm.js");
    const images = [...sample.thumbs.slice(0, 4), ...batch.map((b) => b.thumb).filter((x): x is LlmImage => !!x)];
    let k = sample.thumbs.slice(0, 4).length;
    const lines = batch.map((b, i) => `${i}. ${b.name}${b.thumb ? ` [image ${++k}]` : ""}\n   ${b.titles.slice(0, 4).map((t) => `«${t}»`).join("; ")}`);
    const r = await generateJson({
      fast: true, maxTokens: 2500, temperature: 0.2, images,
      system: "You compare YouTube channels with a reference format. A candidate is the SAME TYPE only if it covers the same topic area AND uses a similar long-form format (for example narrated explainer or documentary with illustrations). Reactions, music, gaming, podcasts/interviews, clips of other shows, kids content and news are NOT the same type unless the reference is that. Answer verdict yes, no or unsure. format: 2–4 Russian words describing the candidate's format. reason: up to 12 Russian words.",
      user: `Reference:\n${profileText(ch)}\nSample titles: ${sample.titles.slice(0, 10).map((t) => `«${t}»`).join("; ") || "(none)"}\n${sample.thumbs.length ? `Images 1–${Math.min(4, sample.thumbs.length)} are sample thumbnails.\n` : ""}\nCandidates:\n${lines.join("\n")}\n\nReturn {"items":[{"i":0,"verdict":"yes","format":"…","reason":"…"}, …]} for every candidate.`,
    }, z.object({ items: z.array(z.object({ i: z.number().int().min(0), verdict: z.enum(["yes", "no", "unsure"]), format: z.string().trim().max(60).optional(), reason: z.string().trim().max(200).optional() })) }));
    return r.data.items.filter((x) => batch[x.i]).map((x) => ({ channelId: batch[x.i].channelId, verdict: x.verdict, format: x.format, reason: x.reason, model: r.model }));
  },
  async versions(ch, items) {
    const { generateJson } = await import("../llm.js");
    const r = await generateJson({
      fast: true, maxTokens: 3000, temperature: 0.7,
      system: `You adapt proven YouTube video ideas for another channel. For each source video write OUR version: a new title in ${langName(ch.language)} that keeps what made the source work (the promise, the curiosity gap) but fits our channel, and an angle in Russian (1–2 sentences: what our video shows and how it differs). Never copy the title, plot or thumbnail.`,
      user: `${profileText(ch)}${ch.style ? `\nStyle notes: ${ch.style.slice(0, 600)}` : ""}\n\nSource videos:\n${items.map((x, i) => `${i}. «${x.title}» — ${x.channelName}${x.format ? ` (${x.format})` : ""}`).join("\n")}\n\nReturn {"items":[{"i":0,"title":"…","angle":"…"}, …]}`,
    }, z.object({ items: z.array(z.object({ i: z.number().int().min(0), title: z.string().trim().min(3).max(120), angle: z.string().trim().min(5).max(400) })) }));
    return r.data.items.filter((x) => items[x.i]).map((x) => ({ videoId: items[x.i].videoId, title: x.title, angle: x.angle, model: r.model }));
  },
};

// ---------- прогон ----------
export const LIMITS = { channelChecks: 150, channelChecksNoKey: 240, relatedPages: 12, wave2Queries: 8, recheckDays: 7, typeBatch: 20, typeChannels: 60, versions: 12, tracked: 40, maxVideos: 20_000 };
export type RunSummary = { runId: string; queries: string[]; stats: Record<string, number>; notes: string[]; stopped?: string; ideas: number; top: IdeaView[] };

/** «https://www.youtube.com/@Name», «youtube.com/channel/UC…», «@Name», «UC…» → ключ для страницы канала. */
export function sampleKey(raw: string): string | null {
  const s = raw.trim();
  const uc = /UC[\w-]{22}/.exec(s)?.[0];
  if (uc) return uc;
  const h = /@([\w.\-]{2,100})/.exec(s)?.[1];
  if (h) return `@${h}`;
  if (/^[\w.\-]{2,100}$/.test(s)) return `@${s}`;
  return null;
}
/** Название ролика → поисковый запрос: без эмодзи, хэштегов и хвоста после «|». */
export function titleQuery(title: string): string | null {
  const head = title.split(/\s[|•–—-]\s|\|/)[0].replace(/#[\p{L}\p{N}_]+/gu, " ").replace(/[^\p{L}\p{N}'’\s]/gu, " ").replace(/\s+/g, " ").trim();
  const words = head.split(" ").filter(Boolean);
  if (words.length < 2) return null;
  return words.slice(0, 8).join(" ");
}
const norm = (q: string) => q.toLowerCase().replace(/\s+/g, " ").trim();
/** Подсказки про другой формат (аудиокниги, подкасты, песни…) — не наш тип роликов. */
const OFF_FORMAT = /(?<![\p{L}\p{N}])(audio ?books?|podcasts?|pdf|ted ?talks?|lyrics|songs?|remix|reaction|meme|cringe|tiktok|shorts|asmr|аудиокниг\p{L}*|подкаст\p{L}*|песн\p{L}*|тикток|шортс)(?![\p{L}\p{N}])/iu;

function upsertVideo(s: RadarStore, v: WebVideo, by: string, now: string, minDur: number) {
  if (!v.id || !v.channelId || v.short || v.live) return;
  if (isNum(v.durationSec) && v.durationSec < Math.min(minDur, 60)) return; // явно не длинный
  const cur = s.videos[v.id];
  const rec: RVideo = cur ?? { id: v.id, title: v.title, channelId: v.channelId, seenAt: now, foundBy: [] };
  if (v.title) rec.title = v.title;
  if (isNum(v.views)) rec.views = v.views;
  if (isNum(v.durationSec)) rec.durationSec = v.durationSec;
  if (isNum(v.ageDays)) { rec.ageDays = v.ageDays; rec.seenAt = now; }
  if (v.publishedAt) rec.publishedAt = v.publishedAt;
  if (by && !rec.foundBy.includes(by)) rec.foundBy = [...rec.foundBy, by].slice(-6);
  s.videos[v.id] = rec;
  const c = s.channels[v.channelId] ??= { id: v.channelId, name: v.channelName ?? "" };
  if (!c.name && v.channelName) c.name = v.channelName;
  if (v.verified) c.verified = true;
}

function prune(s: RadarStore) {
  s.runs = s.runs.slice(-20);
  const ids = Object.keys(s.videos);
  if (ids.length <= LIMITS.maxVideos) return;
  const keep = (v: RVideo) => !!s.ideas[v.id];
  const drop = ids.map((id) => s.videos[id]).filter((v) => !keep(v)).sort((a, b) => a.seenAt.localeCompare(b.seenAt));
  for (const v of drop.slice(0, ids.length - LIMITS.maxVideos)) delete s.videos[v.id];
}

type Net = { limited: boolean; errors: number; requests: number; pauses: number; coolUntil: number };
export const COOLDOWN = { ms: 75_000, pauses: 2 };
const isLimited = (e: unknown) => !!((e as ApiError)?.details && ((e as ApiError).details as { ytLimited?: boolean }).ytLimited);
/** Запрос к YouTube внутри прогона: ошибки не останавливают Радар; при ограничении YouTube — пауза
 *  (до двух раз), потом прогон заканчивается с тем, что уже найдено. */
async function guarded<T>(net: Net, fn: () => Promise<T>): Promise<T | undefined> {
  for (;;) {
    if (net.limited) return undefined;
    const wait = net.coolUntil - Date.now();
    if (wait > 0) await sleep(wait);
    if (net.limited) return undefined;
    net.requests++;
    try { return await fn(); }
    catch (e) {
      rethrowCancelled(e);
      if (!isLimited(e)) { net.errors++; return undefined; }
      if (net.coolUntil > Date.now()) continue; // пауза уже назначена другим запросом
      if (net.pauses >= COOLDOWN.pauses) { net.limited = true; return undefined; }
      net.pauses++;
      net.coolUntil = Date.now() + COOLDOWN.ms;
      log.warn({ event: "radar_yt_limited", pause: net.pauses });
    }
  }
}
async function inParallel<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { checkCancelled(); const i = next++; await fn(items[i], i); }
  }));
}

// ---------- близость к теме (без ИИ) ----------
const STOP = new Set("the and for you your with that this what why how when who are was were will from into about than then they them their there have has had can could would should just like make makes made more most very every everyone people person thing things life world best ever never always things video videos part full new real true secret secrets truth facts fact why how что как это все для или про без они его она мне тебя тебе себя чтобы когда если только очень".split(" "));
const stem = (w: string) => w.length > 5 ? w.replace(/(ies|es|s|ing|ed|ly|ов|ев|ами|ями|ах|ях|ой|ей|ый|ий|ая|ое|ые|ам|ям|ом|ем|а|я|ы|и|у|ю|е|о)$/u, "") : w;
const tokens = (t: string) => new Set((t.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((w) => !STOP.has(w)).map(stem));
export function topicTokens(ch: Channel, s: RadarStore): Set<string> {
  const out = new Set<string>();
  for (const t of [...ch.radar.seeds, ch.niche, ...s.samples.flatMap((x) => x.topTitles)]) for (const w of tokens(t)) out.add(w);
  return out;
}
export const relevance = (title: string, topic: Set<string>) => { let n = 0; for (const w of tokens(title)) if (topic.has(w)) n++; return n; };

const running = new Set<string>();
export const radarRunning = (channelId: string) => running.has(channelId);

export async function runRadar(channelId: string, ctx: Pick<JobCtx, "progress" | "partial">, ai: RadarAi = llmRadarAi): Promise<RunSummary> {
  if (running.has(channelId)) throw new ApiError("VALIDATION", "Радар для этого канала уже идёт — дождитесь окончания", 409);
  running.add(channelId);
  try { return await runUnlocked(channelId, ctx, ai); } finally { running.delete(channelId); }
}

async function runUnlocked(channelId: string, ctx: Pick<JobCtx, "progress" | "partial">, ai: RadarAi): Promise<RunSummary> {
  const ch = await getChannel(channelId);
  const r = ch.radar;
  const gl = r.region || "US";
  const now = () => new Date().toISOString();
  const s = await loadRadar(channelId);
  const run: RadarRun = { id: crypto.randomUUID(), startedAt: now(), queries: [], stats: {}, notes: [] };
  const net: Net = { limited: false, errors: 0, requests: 0, pauses: 0, coolUntil: 0 };
  const stat = (k: string, n = 1) => { run.stats[k] = (run.stats[k] ?? 0) + n; };
  const exclude = ownIds(ch);
  let aiOk = false;
  try { aiOk = await ai.ready(); } catch { aiOk = false; }
  if (!aiOk) run.notes.push("ИИ не подключён: проверка «тот же тип» и «ваша версия» пропущены, идеи отсортированы по цифрам и словам темы. Подключите AnyModel в Настройках и запустите Радар снова.");
  else {
    try { await assertChannelBudget(channelId); }
    catch (e) { aiOk = false; run.notes.push(`Шаги ИИ пропущены: ${(e as Error).message}`); }
  }
  const aiStep = async <T>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (!aiOk) return undefined;
    try { return await fn(); }
    catch (e) {
      rethrowCancelled(e);
      if (isFinancialError(e)) { aiOk = false; run.notes.push(`${label}: пропущено — ${(e as ApiError).message}`); }
      else if ((e as ApiError)?.code === "KEY_MISSING") { aiOk = false; run.notes.push(`${label}: пропущено — нет ключа ИИ.`); }
      else run.notes.push(`${label}: ошибка ИИ (${(e as Error).message.slice(0, 160)}). Остальное готово.`);
      log.warn({ event: "radar_ai_failed", step: label, error: (e as Error).message.slice(0, 300) });
      return undefined;
    }
  };
  const save = () => saveStore(s);
  const checkedRecently = (id: string) => { const c = s.channels[id]; return !!c?.checkedAt && Date.now() - Date.parse(c.checkedAt) < LIMITS.recheckDays * DAY; };
  const ytKey = !!(config.keys.youtube || config.keys.youtube2 || config.keys.youtube3);
  let checksLeft = ytKey ? LIMITS.channelChecks : LIMITS.channelChecksNoKey;

  async function checkChannel(key: string, by: string) {
    const c = await guarded(net, () => webChannel(key));
    if (!c) return null;
    stat("channelsChecked");
    const rec = s.channels[c.id] ??= { id: c.id, name: c.name };
    rec.name = c.name || rec.name; rec.handle = c.handle ?? rec.handle;
    if (isNum(c.subs)) rec.subs = c.subs;
    if (isNum(c.videoCount)) rec.videoCount = c.videoCount;
    rec.checkedAt = now();
    const longs = c.longVideos.filter((v) => !v.live && (!isNum(v.durationSec) || v.durationSec >= r.minDurationSec));
    rec.longCount = longs.length;
    rec.medianViews = median(longs.map((v) => v.views).filter(isNum));
    const ages = longs.map((v) => v.ageDays).filter(isNum);
    rec.firstLong = ages.length ? { ageDays: Math.max(...ages), exact: !c.hasMoreLong, at: now() } : undefined;
    for (const v of longs) upsertVideo(s, { ...v, channelId: c.id, channelName: c.name }, by, now(), r.minDurationSec);
    return rec;
  }
  /** Какие каналы открыть: с ключом YouTube — только маленькие (подписчики за 1 единицу квоты на 50 каналов);
   *  без ключа — без галочки «подтверждён» (≥100 тыс.), по близости к теме и вперемешку по размеру просмотров. */
  async function pickChannels(found: Map<string, { views: number; rel: number }>, cap: number): Promise<string[]> {
    let list = [...found.entries()].filter(([id, f]) => f.views >= r.minViews && !checkedRecently(id) && !s.channels[id]?.sample && !exclude.has(id));
    if (ytKey && list.length) {
      try {
        const { getChannelsStats } = await import("../youtube.js");
        const subs = await getChannelsStats(list.map(([id]) => id));
        for (const [id, n] of subs) { const c = s.channels[id]; if (c) c.subs = n; }
        stat("apiSubsChecked", subs.size);
        list = list.filter(([id]) => !subs.has(id) || subs.get(id)! <= r.maxSubs);
        list.sort((a, b) => b[1].rel - a[1].rel || b[1].views / Math.max(subs.get(b[0]) ?? 1e9, 50) - a[1].views / Math.max(subs.get(a[0]) ?? 1e9, 50));
        return list.slice(0, cap).map(([id]) => id);
      } catch (e) { rethrowCancelled(e); if (!run.notes.some((n) => n.startsWith("Ключ YouTube"))) run.notes.push("Ключ YouTube не ответил — подписчики проверены по страницам каналов."); }
    }
    if (r.maxSubs < 100_000) list = list.filter(([id]) => !s.channels[id]?.verified);
    const bucketOf = (v: number) => v < 50_000 ? 0 : v < 250_000 ? 1 : v < 1_000_000 ? 2 : 3;
    const buckets: [string, { views: number; rel: number }][][] = [[], [], [], []];
    for (const x of list) buckets[bucketOf(x[1].views)].push(x);
    for (const b of buckets) b.sort((a, c) => c[1].rel - a[1].rel || c[1].views - a[1].views);
    const out: string[] = [];
    for (let i = 0; out.length < cap && buckets.some((b) => i < b.length); i++) for (const b of buckets) if (i < b.length && out.length < cap) out.push(b[i][0]);
    return out;
  }
  async function checkMany(ids: string[], by: string, from: number, to: number, label: string) {
    const take = ids.slice(0, Math.max(0, checksLeft));
    checksLeft -= take.length;
    let n = 0;
    await inParallel(take, 3, async (id) => {
      await checkChannel(id, by);
      n++;
      if (n % 5 === 0 || n === take.length) ctx.progress(`${label}: ${n} из ${take.length}`, from + Math.round((n / Math.max(1, take.length)) * (to - from)));
    });
  }
  type Plan = readonly (readonly ["month" | "year", number])[];
  async function search(qs: string[], planFor: (q: string) => Plan, from: number, to: number) {
    const found = new Map<string, { views: number; rel: number }>();
    let done = 0;
    await inParallel(qs, 2, async (q) => {
      for (const [period, pages] of planFor(q)) {
        const vids = await guarded(net, () => webSearch(q, { period, pages, gl }));
        if (vids) stat("searches");
        for (const v of vids ?? []) {
          if (!v.channelId || v.short || v.live) continue;
          if (isNum(v.durationSec) && v.durationSec < r.minDurationSec) continue;
          stat("videosFound");
          upsertVideo(s, v, `поиск: ${q}`, now(), r.minDurationSec);
          if (!scriptMatches(v.title, ch.language)) continue;
          const f = found.get(v.channelId) ?? { views: 0, rel: 0 };
          found.set(v.channelId, { views: Math.max(f.views, v.views ?? 0), rel: Math.max(f.rel, relevance(v.title, topic)) });
        }
      }
      done++;
      ctx.progress(`Ищу на YouTube: ${done} из ${qs.length} запросов`, from + Math.round((done / qs.length) * (to - from)));
    });
    return found;
  }
  async function typeCheck(ids: string[], from: number) {
    const pending = ids.filter((id) => !s.channels[id]?.type).slice(0, LIMITS.typeChannels);
    if (!pending.length || !aiOk) return;
    ctx.progress(`Проверяю «тот же тип» у ${pending.length} каналов`, from);
    sampleThumbs ??= (await Promise.all(s.samples.flatMap((x) => x.topVideoIds.slice(0, 2)).slice(0, 4).map((id) => ytThumb(id)))).filter((x): x is LlmImage => !!x);
    for (let i = 0; i < pending.length && aiOk; i += LIMITS.typeBatch) {
      const batch: TypeCandidate[] = [];
      for (const id of pending.slice(i, i + LIMITS.typeBatch)) {
        const vids = Object.values(s.videos).filter((v) => v.channelId === id && isNum(v.views)).sort((a, b) => b.views! - a.views!);
        batch.push({ channelId: id, name: s.channels[id]?.name ?? id, titles: vids.slice(0, 4).map((v) => v.title), thumb: vids[0] ? await ytThumb(vids[0].id) : undefined });
      }
      const res = await aiStep("Проверка «тот же тип»", () => ai.typeCheck(ch, { titles: sampleTitles, thumbs: sampleThumbs ?? [] }, batch));
      for (const x of res ?? []) { const c = s.channels[x.channelId]; if (c) { c.type = { verdict: x.verdict, format: x.format, reason: x.reason, model: x.model, at: now() }; stat(`type:${x.verdict}`); } }
    }
    stat("typeChecked", pending.length);
    await save();
  }
  /** Лучшие идеи «того же типа»: по проверке ИИ, а без неё — по словам темы. */
  const sameType = (limit: number) => rankIdeas(s, ch, { sort: "best", perChannel: 1, limit: 400 })
    .filter((x) => x.channel.type ? x.channel.type === "yes" : !aiOk && relevance(x.title, topic) >= 1)
    .slice(0, limit);
  let sampleThumbs: LlmImage[] | undefined;

  // 1. Образцы: отпечаток формата и запросы из их лучших роликов.
  ctx.progress("Читаю каналы-образцы", 2);
  const samples: Sample[] = [];
  for (const raw of ch.samples) {
    const key = sampleKey(raw);
    if (!key) { run.notes.push(`Образец «${raw}» не похож на ссылку на канал YouTube — пропущен.`); continue; }
    const rec = await checkChannel(key, "образец");
    if (!rec) { run.notes.push(`Образец «${raw}» не открылся.`); continue; }
    rec.sample = true;
    const vids = Object.values(s.videos).filter((v) => v.channelId === rec.id && isNum(v.views)).sort((a, b) => b.views! - a.views!);
    samples.push({ key, id: rec.id, name: rec.name, subs: rec.subs, topTitles: vids.slice(0, 8).map((v) => v.title), topVideoIds: vids.slice(0, 4).map((v) => v.id), at: now() });
  }
  if (samples.length) s.samples = samples;
  const sampleTitles = s.samples.flatMap((x) => x.topTitles);
  const topic = topicTokens(ch, s);

  // 2. Слежение за уже найденными каналами: новые ролики (RSS, если YouTube его отдаёт; иначе страница канала).
  ctx.progress("Проверяю новые ролики найденных каналов", 6);
  const tracked = [...new Set(rankIdeas(s, ch, { show: "all", perChannel: 1, limit: 400 }).filter((x) => x.channel.type !== "no").map((x) => x.channel.id))].slice(0, LIMITS.tracked);
  let rssBroken = false;
  await inParallel(tracked, 3, async (id) => {
    if (checkedRecently(id) || net.limited) return;
    if (!rssBroken) {
      try {
        const feed = await channelRss(id);
        stat("rssFeeds");
        for (const v of feed) if (!v.short && Date.now() - Date.parse(v.publishedAt) < 45 * DAY) upsertVideo(s, { id: v.id, title: v.title, channelId: id, views: v.views, publishedAt: v.publishedAt }, "слежение", now(), r.minDurationSec);
        return;
      } catch (e) { rethrowCancelled(e); rssBroken = true; }
    }
    await checkChannel(id, "слежение");
  });
  if (rssBroken) run.notes.push("RSS-ленты YouTube не отвечают — новые ролики найденных каналов проверены по их страницам.");

  // 3. Запросы: свои темы → названия роликов образца → подсказки YouTube → запросы от ИИ.
  ctx.progress("Собираю поисковые запросы", 10);
  const queries: string[] = []; const seen = new Set<string>();
  const add = (q: string | null | undefined, src: string) => { if (!q) return false; const k = norm(q); if (k.length < 2 || seen.has(k)) return false; seen.add(k); queries.push(q.trim()); stat(`queries:${src}`); return true; };
  for (const q of r.seeds) add(q, "свои");
  for (const t of sampleTitles.slice(0, 10)) add(titleQuery(t), "образец");
  // Подсказки YouTube — по кругу: сначала по одной на каждую тему, потом по второй… (до 4 на тему).
  const hl = ch.language.slice(0, 2);
  const sugLists = await Promise.all(r.seeds.slice(0, 10).map(async (q) => ((await guarded(net, () => ytSuggest(q, hl, r.region))) ?? []).filter((x) => norm(x) !== norm(q) && !OFF_FORMAT.test(x))));
  for (let k = 0; k < 4; k++) for (const list of sugLists) if (list[k]) add(list[k], "подсказки");
  const aiQueries = await aiStep("Запросы от ИИ", () => ai.queries(ch, sampleTitles));
  for (const q of aiQueries ?? []) add(q, "ии");
  const wave1 = queries.slice(0, Math.max(1, r.maxQueries - LIMITS.wave2Queries));
  if (!wave1.length) throw new ApiError("VALIDATION", "Радару не с чего начать: добавьте в профиль канала темы для поиска или канал-образец", 400);

  // 4. Поиск «по просмотрам» за месяц (2 страницы) и за год (1 страница) → проверка каналов.
  // Свои темы — глубже (2 страницы за месяц), остальные запросы — по странице за месяц и за год.
  const deep = new Set(r.seeds.map(norm));
  const found1 = await search(wave1, (q) => deep.has(norm(q)) ? [["month", 2], ["year", 1]] : [["month", 1], ["year", 1]], 12, 40);
  run.stats.channelsFound = found1.size;
  await save();
  await checkMany(await pickChannels(found1, Math.round(checksLeft * 0.55)), "канал", 40, 58, "Проверяю каналы");
  await save();
  ctx.partial({ ideas: rankIdeas(s, ch, { limit: 50 }).length });

  // 5. «Тот же тип» у лучших находок: от них пойдёт «снежный ком».
  await typeCheck(rankIdeas(s, ch, { show: "all", sort: "best", perChannel: 1, limit: 400 }).map((x) => x.channel.id).slice(0, 30), 60);

  // 6. «Похожие видео» от роликов образца и лучших находок того же типа → новые каналы.
  ctx.progress("Смотрю «похожие видео»", 64);
  const relSeeds = [...new Set([...s.samples.flatMap((x) => x.topVideoIds.slice(0, 3)), ...sameType(LIMITS.relatedPages).map((x) => x.videoId)])].slice(0, LIMITS.relatedPages);
  const found2 = new Map<string, { views: number; rel: number }>();
  await inParallel(relSeeds, 3, async (vid) => {
    const vids = await guarded(net, () => webRelated(vid));
    if (vids) stat("relatedPages");
    for (const v of vids ?? []) {
      if (!v.channelId || v.short || v.live || exclude.has(v.channelId)) continue;
      if (isNum(v.durationSec) && v.durationSec < r.minDurationSec) continue;
      upsertVideo(s, v, `похожие: ${vid}`, now(), r.minDurationSec);
      if (!scriptMatches(v.title, ch.language)) continue;
      const f = found2.get(v.channelId) ?? { views: 0, rel: 0 };
      found2.set(v.channelId, { views: Math.max(f.views, v.views ?? 0), rel: Math.max(f.rel, relevance(v.title, topic)) });
    }
  });
  run.stats.relatedChannels = found2.size;
  await checkMany(await pickChannels(found2, Math.round(checksLeft * 0.6)), "похожие", 66, 76, "Проверяю каналы из «похожих»");
  await save();

  // 7. Вторая волна: запросы из названий лучших роликов того же типа (так находятся свежие форматы).
  const wave2: string[] = [];
  for (const x of sameType(20)) { if (wave2.length >= LIMITS.wave2Queries) break; const q = titleQuery(x.title); if (q && add(q, "находки")) wave2.push(q); }
  if (wave2.length && !net.limited) {
    const found3 = await search(wave2, () => [["month", 1], ["year", 1]], 76, 84);
    await checkMany(await pickChannels(found3, checksLeft), "находки", 84, 88, "Проверяю новые каналы");
    await save();
  }
  run.queries = [...wave1, ...wave2];

  // 8. «Тот же тип» у остальных и «ваша версия» для лучших идей.
  await typeCheck(rankIdeas(s, ch, { show: "all", sort: "best", perChannel: 1, limit: 400 }).map((x) => x.channel.id), 89);
  const top = rankIdeas(s, ch, { sort: "best", perChannel: 1, limit: 40 }).filter((x) => !s.ideas[x.videoId]?.version).slice(0, LIMITS.versions);
  if (top.length && aiOk) {
    ctx.progress("Пишу «вашу версию» для лучших идей", 94);
    const res = await aiStep("«Ваша версия»", () => ai.versions(ch, top.map((x) => ({ videoId: x.videoId, title: x.title, channelName: x.channel.name, format: x.channel.format }))));
    for (const x of res ?? []) { const idea = touchIdea(s, x.videoId); if (idea) idea.version = { title: x.title, angle: x.angle, model: x.model, at: now() }; }
  }

  // 9. Итог.
  for (const x of rankIdeas(s, ch, { show: "all", perChannel: 99, limit: 5000 })) touchIdea(s, x.videoId);
  if (net.limited) run.stopped = "YouTube временно ограничил запросы с вашего компьютера. Найденное сохранено; запустите Радар снова через 15–30 минут.";
  if (net.errors) run.notes.push(`Не ответили ${net.errors} из ${net.requests} запросов к YouTube — Радар продолжил без них.`);
  run.stats.requests = net.requests; run.stats.errors = net.errors; if (net.pauses) run.stats.pauses = net.pauses;
  if (net.pauses && !net.limited) run.notes.push(`YouTube ${net.pauses === 1 ? "один раз" : "дважды"} притормозил запросы — Радар подождал и продолжил.`);
  run.finishedAt = now();
  s.runs.push(run);
  await save();
  const active = rankIdeas(s, ch);
  ctx.progress("Готово", 100);
  return { runId: run.id, queries: run.queries, stats: run.stats, notes: run.notes, stopped: run.stopped, ideas: active.length, top: active.slice(0, 12) };
}
function touchIdea(s: RadarStore, videoId: string): Idea | null {
  const v = s.videos[videoId];
  if (!v) return null;
  const t = new Date().toISOString();
  const idea = s.ideas[videoId] ??= { videoId, channelId: v.channelId, status: "new", firstSeen: t, lastSeen: t };
  idea.lastSeen = t;
  return idea;
}

// ---------- действия с идеями ----------
export async function listIdeas(channelId: string, o: IdeaListOpts = {}) {
  const ch = await getChannel(channelId);
  const s = await loadRadar(channelId);
  const ideas = rankIdeas(s, ch, o);
  const counts = { active: rankIdeas(s, ch, { show: "active", limit: 10_000 }).length, hidden: Object.values(s.ideas).filter((x) => x.status === "hidden").length, taken: Object.values(s.ideas).filter((x) => x.status === "taken").length, rejected: rankIdeas(s, ch, { show: "rejected", limit: 10_000 }).length };
  const last = s.runs.at(-1);
  return { ideas, counts, lastRun: last ? { ...last, queries: last.queries } : null, samples: s.samples, running: radarRunning(channelId), videos: Object.keys(s.videos).length, channels: Object.values(s.channels).filter((c) => c.checkedAt).length };
}
export function setIdeaStatus(channelId: string, videoId: string, status: "new" | "hidden") {
  return withStore(channelId, (s) => {
    const idea = touchIdea(s, videoId);
    if (!idea) throw new ApiError("NOT_FOUND", "Идея не найдена", 404);
    if (idea.status === "taken" && status === "hidden") throw new ApiError("VALIDATION", "Идея уже взята в проект", 400);
    idea.status = status;
    return idea;
  });
}
/** «Взять идею →»: проект ролика с идеей, ссылкой на образец и вашей версией. */
export async function takeIdea(channelId: string, videoId: string) {
  const ch = await getChannel(channelId);
  return withStore(channelId, async (s) => {
    const view = rankIdeas(s, ch, { show: "all", perChannel: 999, limit: 100_000 }).find((x) => x.videoId === videoId);
    if (!view) throw new ApiError("NOT_FOUND", "Идея не найдена", 404);
    const idea = touchIdea(s, videoId)!;
    if (idea.status === "taken" && idea.projectId) return { projectId: idea.projectId, existed: true };
    const { createProject } = await import("../projects.js");
    const title = view.version?.title ?? view.title;
    const p = await createProject({
      title, niche: ch.niche || undefined, channelId: ch.id,
      artifact: {
        kind: "topic", title: `Идея из Радара: ${title}`.slice(0, 300),
        data: {
          source: "radar", channelId: ch.id, url: view.url, videoId, sourceTitle: view.title, sourceChannel: view.channel.name, sourceChannelUrl: view.channel.url,
          views: view.views, subs: view.channel.subs, multiplier: view.multiplier, outlier: view.outlier, format: view.channel.format,
          firstLongAgeDays: view.channel.firstLongAgeDays, version: view.version ?? null,
          note: "Названия, сюжеты и картинки образца не копируются: берётся формат и обещание ролика.",
        },
      },
    });
    idea.status = "taken"; idea.projectId = p.id;
    return { projectId: p.id, existed: false };
  });
}
