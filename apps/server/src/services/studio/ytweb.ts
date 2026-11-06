// Бесплатный разбор публичных страниц YouTube: поиск, страница канала, RSS.
// Без ключа API и без расхода квоты. Формат страниц YouTube меняется, поэтому
// разбор обходит всё дерево ytInitialData и понимает старые (videoRenderer)
// и новые (lockupViewModel) карточки.
import { ApiError } from "../../lib/errors.js";
import { checkCancelled, rethrowCancelled, taskSignal } from "../../lib/taskContext.js";
import { sleep } from "../../lib/http.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const HEADERS: Record<string, string> = { "user-agent": UA, "accept-language": "en-US,en;q=0.9", cookie: "SOCS=CAI; CONSENT=YES+1" };

/** Сортировка «по просмотрам» + только видео + период загрузки (protobuf в base64). */
export const SEARCH_SP = { week: "CAMSBAgDEAE%3D", month: "CAMSBAgEEAE%3D", year: "CAMSBAgFEAE%3D", any: "CAMSAhAB" } as const;
export type SearchPeriod = keyof typeof SEARCH_SP;

export type WebVideo = {
  id: string; title: string; channelId?: string; channelName?: string;
  views?: number; durationSec?: number; ageDays?: number; publishedText?: string;
  live?: boolean; short?: boolean; publishedAt?: string;
  /** Галочка «подтверждён»: YouTube даёт её от 100 тыс. подписчиков. */
  verified?: boolean;
};
export type WebChannel = {
  id: string; name: string; handle?: string; subs?: number; videoCount?: number;
  longVideos: WebVideo[]; hasMoreLong: boolean;
};

// ---------- разбор чисел и дат ----------
export function parseCount(text: string | undefined | null): number | undefined {
  if (!text) return undefined;
  const t = String(text).replace(/\u00a0/g, " ").trim();
  if (/^no\b/i.test(t)) return 0;
  const m = t.match(/(\d[\d,.\s]*)\s*([KMB]|тыс\.?|млн|млрд)?/i);
  if (!m) return undefined;
  const suffix = (m[2] ?? "").toLowerCase();
  let num = m[1].replace(/\s/g, "");
  if (suffix) num = num.replace(/,/g, ".");
  else num = num.replace(/[,.](?=\d{3}\b)/g, "").replace(/,/g, ".");
  const v = Number.parseFloat(num);
  if (!Number.isFinite(v)) return undefined;
  const mult = suffix === "k" || suffix.startsWith("тыс") ? 1e3 : suffix === "m" || suffix === "млн" ? 1e6 : suffix === "b" || suffix === "млрд" ? 1e9 : 1;
  return Math.round(v * mult);
}

const UNIT_DAYS: [RegExp, number][] = [
  [/^(s|sec|secs|second|seconds)$/, 1 / 86400], [/^(m|min|mins|minute|minutes)$/, 1 / 1440], [/^(h|hr|hrs|hour|hours)$/, 1 / 24],
  [/^(d|day|days)$/, 1], [/^(w|wk|wks|week|weeks)$/, 7], [/^(mo|mos|month|months)$/, 30.44], [/^(y|yr|yrs|year|years)$/, 365.25],
];
/** «9h ago», «3w ago», «1 month ago», «Streamed 2 weeks ago» → дни (приблизительно). */
export function parseAgeDays(text: string | undefined | null): number | undefined {
  if (!text) return undefined;
  const m = String(text).toLowerCase().match(/(\d+)\s*([a-z]+)\s+ago/);
  if (!m) return undefined;
  const n = Number(m[1]);
  for (const [re, days] of UNIT_DAYS) if (re.test(m[2])) return n * days;
  return undefined;
}
export function parseLength(text: string | undefined | null): number | undefined {
  if (!text) return undefined;
  const m = String(text).trim().match(/^(\d+)(?::(\d{1,2}))?(?::(\d{1,2}))?$/);
  if (!m) return undefined;
  const parts = [m[1], m[2], m[3]].filter((x) => x !== undefined).map(Number);
  return parts.reduce((a, b) => a * 60 + b, 0);
}

// ---------- извлечение JSON из страницы ----------
function matchBrace(s: string, start: number): number {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}
export function extractInitialData(html: string): any {
  for (const marker of ["var ytInitialData = ", 'window["ytInitialData"] = ', "ytInitialData = "]) {
    const at = html.indexOf(marker);
    if (at < 0) continue;
    const start = html.indexOf("{", at + marker.length - 1);
    const end = start >= 0 ? matchBrace(html, start) : -1;
    if (end > start) { try { return JSON.parse(html.slice(start, end + 1)); } catch { /* try next marker */ } }
  }
  return null;
}
export const clientVersion = (html: string) => html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? html.match(/"clientVersion":"(\d\.\d{8}\.\d{2}\.\d{2})"/)?.[1];
let lastClientVersion = "2.20261030.02.00";
const rememberVersion = (html: string) => { const v = clientVersion(html); if (v) lastClientVersion = v; return v ?? lastClientVersion; };

const text = (o: any): string | undefined => o == null ? undefined : typeof o === "string" ? o : o.simpleText ?? o.content ?? (Array.isArray(o.runs) ? o.runs.map((r: any) => r.text).join("") : undefined);
function findBrowseId(o: any, depth = 0): string | undefined {
  if (!o || typeof o !== "object" || depth > 30) return undefined;
  if (typeof o.browseId === "string" && o.browseId.startsWith("UC")) return o.browseId;
  for (const v of Object.values(o)) { const r = findBrowseId(v, depth + 1); if (r) return r; }
  return undefined;
}

function fromVideoRenderer(v: any): WebVideo | null {
  if (!v?.videoId) return null;
  const owner = v.ownerText?.runs?.[0] ?? v.longBylineText?.runs?.[0] ?? v.shortBylineText?.runs?.[0];
  const badges = JSON.stringify(v.badges ?? []) + JSON.stringify(v.thumbnailOverlays ?? []);
  const lenText = text(v.lengthText) ?? v.thumbnailOverlays?.find((x: any) => x.thumbnailOverlayTimeStatusRenderer)?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText;
  const published = text(v.publishedTimeText);
  return {
    id: v.videoId, title: text(v.title) ?? "",
    channelId: owner?.navigationEndpoint?.browseEndpoint?.browseId ?? findBrowseId(v.channelThumbnailSupportedRenderers) ?? findBrowseId(v.ownerText),
    channelName: owner?.text,
    views: parseCount(text(v.viewCountText)),
    durationSec: parseLength(lenText),
    ageDays: parseAgeDays(published), publishedText: published,
    live: /LIVE|BADGE_STYLE_TYPE_LIVE_NOW/.test(badges) && !lenText,
    short: /SHORTS/.test(badges),
    verified: /BADGE_STYLE_TYPE_VERIFIED/.test(JSON.stringify(v.ownerBadges ?? [])) || undefined,
  };
}
function fromLockup(l: any): WebVideo | null {
  if (!l?.contentId || (l.contentType && l.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO")) return null;
  const md = l.metadata?.lockupMetadataViewModel;
  const rows: any[] = md?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
  const parts: { t: string; icon?: string }[] = rows.flatMap((r) => (r.metadataParts ?? []).map((p: any) => ({ t: text(p.text) ?? "", icon: p.leadingIcon?.name })));
  const viewsPart = parts.find((p) => /views?\b/i.test(p.t) || p.icon === "PLAY_ARROW_OUTLINED" || /PLAY_ARROW/.test(p.icon ?? ""));
  const agePart = parts.find((p) => /\bago\b/i.test(p.t));
  const badge = JSON.stringify(l.contentImage ?? {}).match(/"thumbnailBadgeViewModel":\{"text":"([^"]+)"/)?.[1];
  const channelPart = rows[0]?.metadataParts?.[0] && !viewsPart?.t.includes(text(rows[0].metadataParts[0].text) ?? "\u0000") ? text(rows[0].metadataParts[0].text) : undefined;
  return {
    id: l.contentId, title: text(md?.title) ?? "",
    channelId: findBrowseId(md?.image) ?? findBrowseId(md?.metadata),
    channelName: channelPart && !/\bago\b|views?/i.test(channelPart) ? channelPart : undefined,
    views: parseCount(viewsPart?.t),
    durationSec: parseLength(badge),
    ageDays: parseAgeDays(agePart?.t), publishedText: agePart?.t,
    live: badge ? /LIVE/i.test(badge) : false,
    verified: /CHECK_CIRCLE|VERIFIED/.test(JSON.stringify(md?.metadata ?? {})) || undefined,
  };
}
/** Все видео-карточки из дерева (без повторов, в порядке появления). */
export function collectVideos(root: any): WebVideo[] {
  const out: WebVideo[] = []; const seen = new Set<string>();
  const push = (v: WebVideo | null) => { if (v && v.id && !seen.has(v.id)) { seen.add(v.id); out.push(v); } };
  const walk = (o: any, depth: number) => {
    if (!o || typeof o !== "object" || depth > 60) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
    if (o.videoRenderer) push(fromVideoRenderer(o.videoRenderer));
    else if (o.gridVideoRenderer) push(fromVideoRenderer(o.gridVideoRenderer));
    else if (o.lockupViewModel) push(fromLockup(o.lockupViewModel));
    else if (o.reelItemRenderer || o.shortsLockupViewModel) return; // Shorts не нужны Радару
    else for (const v of Object.values(o)) walk(v, depth + 1);
  };
  walk(root, 0);
  return out;
}
export function findContinuation(root: any, within?: string): string | undefined {
  let found: string | undefined;
  const walk = (o: any, inside: boolean, depth: number) => {
    if (found || !o || typeof o !== "object" || depth > 60) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, inside, depth + 1); return; }
    for (const [k, v] of Object.entries(o)) {
      if (k === "engagementPanels" || k === "header" || k === "showEngagementPanelEndpoint") continue;
      const nowInside = inside || !within || k === within;
      if (k === "continuationItemRenderer" && nowInside) {
        const token = (v as any)?.continuationEndpoint?.continuationCommand?.token;
        if (token) { found = token; return; }
      }
      walk(v, nowInside, depth + 1);
    }
  };
  walk(root, false, 0);
  return found;
}

/** Ищем именно сетку видео, а не токен из заголовка или боковой панели. */
function findChannelGrid(contents: any): any {
  let grid: any = null;
  const walk = (o: any, depth: number) => {
    if (grid || !o || typeof o !== "object" || depth > 40) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
    if (o.richGridRenderer) { grid = o.richGridRenderer; return; }
    for (const v of Object.values(o)) walk(v, depth + 1);
  };
  walk(contents, 0); return grid;
}

/** Шапка канала: название, подписчики, число видео. */
export function parseChannelPage(data: any): Omit<WebChannel, "longVideos" | "hasMoreLong"> & { longVideos: WebVideo[]; hasMoreLong: boolean } | null {
  const meta = data?.metadata?.channelMetadataRenderer;
  const id: string | undefined = meta?.externalId ?? findBrowseId(data?.header);
  if (!id) return null;
  const headerTexts: string[] = [];
  const walk = (o: any, depth: number) => {
    if (!o || typeof o !== "object" || depth > 40) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
    for (const [k, v] of Object.entries(o)) {
      if (k === "onTap" || k === "commandContext" || k === "rendererContext") continue;
      if ((k === "content" || k === "simpleText") && typeof v === "string") headerTexts.push(v);
      else walk(v, depth + 1);
    }
  };
  walk(data?.header, 0);
  const subsText = headerTexts.find((t) => /subscriber/i.test(t)) ?? text(data?.header?.c4TabbedHeaderRenderer?.subscriberCountText);
  const countText = headerTexts.find((t) => /\bvideos?\b/i.test(t));
  // Видео только из сетки вкладки «Видео» (без полок и «популярного»)
  const grid = findChannelGrid(data?.contents);
  const longVideos = grid ? collectVideos(grid.contents ?? []).filter((v) => !v.short) : [];
  for (const v of longVideos) { v.channelId ??= id; v.channelName ??= meta?.title; }
  return {
    id, name: meta?.title ?? "", handle: (meta?.vanityChannelUrl ?? "").match(/@[\w.\-]+/)?.[0],
    subs: subsText === undefined ? undefined : /no subscribers/i.test(subsText) ? 0 : parseCount(subsText),
    videoCount: parseCount(countText),
    longVideos, hasMoreLong: !grid || !Array.isArray(grid.contents) || !!findContinuation(grid.contents),
  };
}

// ---------- сеть ----------
export type Fetcher = (url: string, init?: RequestInit) => Promise<{ status: number; text: () => Promise<string>; arrayBuffer?: () => Promise<ArrayBuffer>; url?: string }>;
const defaultFetcher: Fetcher = (url, init) => fetch(url, init);
let fetcher: Fetcher = defaultFetcher;
/** Только для тестов: подмена сети фикстурами (без паузы между запросами). */
export function setYtFetcher(f: Fetcher | null) { fetcher = f ?? defaultFetcher; }

let active = 0;
const MAX_PARALLEL = 3;
const waiters: (() => void)[] = [];
/** Не чаще одного нового запроса в 300 мс: так YouTube реже включает ограничение. */
const PACE_MS = 300;
let nextStart = 0;
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((r) => waiters.push(r));
  active++;
  try {
    const wait = nextStart - Date.now();
    nextStart = Math.max(nextStart, Date.now()) + (fetcher === defaultFetcher ? PACE_MS : 0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return await fn();
  } finally { active--; waiters.shift()?.(); }
}

type Once = { ok: true; text: string } | { ok: false; retry: boolean; error: ApiError };
async function once(url: string, init: RequestInit, signal: AbortSignal | undefined): Promise<Once> {
  let res;
  try {
    res = await fetcher(url, { ...init, headers: { ...HEADERS, ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]) });
  } catch (e) {
    rethrowCancelled(e, signal);
    return { ok: false, retry: true, error: new ApiError("UPSTREAM", "YouTube не отвечает. Проверьте интернет и попробуйте ещё раз.", 502, true) };
  }
  if (res.status === 429 || (res.url ?? "").includes("/sorry/")) return { ok: false, retry: false, error: new ApiError("UPSTREAM", "YouTube временно ограничил поиск с вашего компьютера. Подождите 15–30 минут и запустите Радар снова: найденное уже сохранено.", 429, true, { ytLimited: true }) };
  if (res.status >= 500) return { ok: false, retry: true, error: new ApiError("UPSTREAM", `YouTube ответил ошибкой ${res.status}`, 502, true) };
  if (res.status === 404) return { ok: false, retry: false, error: new ApiError("NOT_FOUND", "Страница YouTube не найдена", 404) };
  if (res.status >= 400) return { ok: false, retry: false, error: new ApiError("UPSTREAM", `YouTube ответил ошибкой ${res.status}`, 502, true) };
  try { return { ok: true, text: await res.text() }; }
  catch (e) { rethrowCancelled(e, signal); return { ok: false, retry: true, error: new ApiError("UPSTREAM", "YouTube оборвал ответ. Попробуйте ещё раз.", 502, true) }; }
}
// Повтор ждёт вне очереди: иначе три одновременных повтора заняли бы все места и ждали друг друга.
async function get(url: string, init: RequestInit = {}): Promise<string> {
  const signal = taskSignal(init.signal);
  for (let attempt = 0; ; attempt++) {
    checkCancelled(signal);
    const r = await slot(() => once(url, init, signal));
    if (r.ok) return r.text;
    if (!r.retry || attempt >= 2) throw r.error;
    await sleep(1500 * (attempt + 1), signal);
  }
}

export async function webSearch(q: string, o: { period?: SearchPeriod; pages?: number; gl?: string } = {}): Promise<WebVideo[]> {
  const gl = (o.gl || "US").toUpperCase();
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=${SEARCH_SP[o.period ?? "month"]}&hl=en&gl=${gl}`;
  const html = await get(url);
  const data = extractInitialData(html);
  if (!data) throw new ApiError("UPSTREAM", "YouTube вернул страницу без результатов поиска (возможно, проверка «я не робот»).", 502, true, { ytLimited: true });
  const videos = collectVideos(data.contents ?? data);
  let token = findContinuation(data.contents ?? data);
  const version = rememberVersion(html);
  for (let page = 1; page < (o.pages ?? 1) && token; page++) {
    const body = JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: version, hl: "en", gl } }, continuation: token });
    let next: any;
    try { next = JSON.parse(await get("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", { method: "POST", body, headers: { "content-type": "application/json" } })); }
    catch (e) { rethrowCancelled(e); break; }
    const more = collectVideos(next?.onResponseReceivedCommands ?? next);
    const ids = new Set(videos.map((v) => v.id));
    for (const v of more) if (!ids.has(v.id)) videos.push(v);
    token = findContinuation(next?.onResponseReceivedCommands ?? next);
  }
  return videos;
}

/** Вкладка «Видео» в запросе browse. */
const VIDEOS_TAB = "EgZ2aWRlb3PyBgQKAjoA";
/** Канал по ID (UC…) или @handle: подписчики и длинные видео со вкладки «Видео».
 *  По ID — лёгкий JSON-запрос (≈240 КБ вместо 1 МБ страницы); если он не сработал — обычная страница. */
export async function webChannel(idOrHandle: string, options: { pages?: number; maxVideos?: number } = {}): Promise<WebChannel> {
  // Defaults preserve Radar's one-page behaviour. Brainstorm explicitly asks for
  // a bounded sample; limits apply even if callers pass abnormal values.
  const pages = Math.max(1, Math.min(3, Math.floor(options.pages ?? 1) || 1));
  const maxVideos = Math.max(1, Math.min(60, Math.floor(options.maxVideos ?? 60) || 60));
  async function finish(parsed: WebChannel, data: any, version: string): Promise<WebChannel> {
    if (pages === 1 && options.maxVideos === undefined) return parsed;
    const grid = findChannelGrid(data?.contents);
    if (!grid || !Array.isArray(grid.contents)) return { ...parsed, hasMoreLong: true };
    let token = findContinuation(grid.contents);
    const ids = new Set<string>(), videos: WebVideo[] = [];
    let truncated = false;
    const append = (rows: WebVideo[]) => {
      for (const v of rows) {
        if (!/^[A-Za-z0-9_-]{11}$/.test(v.id) || (v.channelId && v.channelId !== parsed.id)) { truncated = true; continue; }
        if (ids.has(v.id) || v.short || v.live) continue;
        ids.add(v.id);
        if (videos.length >= maxVideos) { truncated = true; continue; }
        v.channelId ??= parsed.id; v.channelName ??= parsed.name;
        videos.push(v);
      }
    };
    append(parsed.longVideos);
    const seenTokens = new Set<string>();
    let failed = false;
    for (let page = 1; page < pages && token && videos.length < maxVideos; page++) {
      checkCancelled();
      if (seenTokens.has(token)) { failed = true; break; }
      seenTokens.add(token);
      const body = JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: version, hl: "en", gl: "US" } }, continuation: token });
      try {
        const next = JSON.parse(await get("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", { method: "POST", body, headers: { "content-type": "application/json" } }));
        const actions = [...(Array.isArray(next?.onResponseReceivedActions) ? next.onResponseReceivedActions : []), ...(Array.isArray(next?.onResponseReceivedCommands) ? next.onResponseReceivedCommands : [])];
        const lists = actions.map((a: any) => a?.appendContinuationItemsAction?.continuationItems).filter(Array.isArray);
        if (lists.length !== 1) { failed = true; break; }
        const items = lists[0];
        append(collectVideos(items));
        token = findContinuation(items);
      } catch (e) {
        rethrowCancelled(e);
        if ((e as ApiError)?.status === 429 || ((e as ApiError)?.details as { ytLimited?: boolean } | undefined)?.ytLimited) throw e;
        failed = true; break;
      }
    }
    return { ...parsed, longVideos: videos, hasMoreLong: truncated || failed || !!token };
  }
  const key = idOrHandle.trim();
  if (/^UC[\w-]{22}$/.test(key)) {
    try {
      const body = JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: lastClientVersion, hl: "en", gl: "US" } }, browseId: key, params: VIDEOS_TAB });
      const data = JSON.parse(await get("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", { method: "POST", body, headers: { "content-type": "application/json" } }));
      const parsed = parseChannelPage(data);
      if (parsed && parsed.id === key) return await finish(parsed, data, lastClientVersion);
    } catch (e) { rethrowCancelled(e); if ((e as ApiError)?.status === 429 || ((e as ApiError)?.details as { ytLimited?: boolean } | undefined)?.ytLimited) throw e; }
  }
  const path = /^UC[\w-]{22}$/.test(key) ? `channel/${key}` : key.startsWith("@") ? encodeURI(key) : `@${encodeURIComponent(key)}`;
  const html = await get(`https://www.youtube.com/${path}/videos?hl=en&gl=US`);
  const version = rememberVersion(html);
  const data = extractInitialData(html);
  const parsed = data ? parseChannelPage(data) : null;
  if (!parsed) throw new ApiError("UPSTREAM", "Не удалось прочитать страницу канала YouTube", 502, true);
  return finish(parsed, data, version);
}

/** Последние 15 загрузок канала из RSS: точные даты и просмотры, бесплатно. */
export type RssVideo = { id: string; title: string; publishedAt: string; views?: number; short?: boolean };
export async function channelRss(channelId: string): Promise<RssVideo[]> {
  const xml = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`);
  const out: RssVideo[] = [];
  for (const entry of xml.split("<entry>").slice(1)) {
    const id = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const title = entry.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
    const publishedAt = entry.match(/<published>([^<]+)<\/published>/)?.[1] ?? "";
    const views = entry.match(/<media:statistics views="(\d+)"/)?.[1];
    const short = /<link rel="alternate" href="[^"]*\/shorts\//.test(entry) || undefined;
    if (id) out.push({ id, title: decodeXml(title), publishedAt, views: views ? Number(views) : undefined, short });
  }
  return out;
}
const decodeXml = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** «Похожие видео» справа от ролика: лучший бесплатный способ найти каналы того же типа. */
export async function webRelated(videoId: string): Promise<WebVideo[]> {
  const html = await get(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en&gl=US`);
  rememberVersion(html);
  const data = extractInitialData(html);
  const sec = data?.contents?.twoColumnWatchNextResults?.secondaryResults;
  return sec ? collectVideos(sec).filter((v) => v.id !== videoId) : [];
}

/** Подсказки поиска YouTube (бесплатно): расширяют запросы Радара. */
export async function ytSuggest(q: string, hl = "en", gl = ""): Promise<string[]> {
  const params = new URLSearchParams({ client: "firefox", ds: "yt", hl, oe: "utf8", q, ...(gl ? { gl: gl.toLowerCase() } : {}) });
  try {
    const raw = JSON.parse(await get(`https://suggestqueries.google.com/complete/search?${params}`));
    return Array.isArray(raw?.[1]) ? raw[1].filter((s: unknown): s is string => typeof s === "string").slice(0, 10) : [];
  } catch (e) { rethrowCancelled(e); return []; }
}

/** Превью ролика 320×180 для проверки «тот же тип» (без ключа, бесплатно). */
export async function ytThumb(videoId: string): Promise<{ mime: string; b64: string } | undefined> {
  if (!/^[\w-]{11}$/.test(videoId)) return undefined;
  try {
    return await slot(async () => {
      const res = await fetcher(`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, { signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(taskSignal() ? [taskSignal()!] : [])]) });
      if (res.status !== 200 || !res.arrayBuffer) return undefined;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length > 500 && buf.length < 400_000 ? { mime: "image/jpeg", b64: buf.toString("base64") } : undefined;
    });
  } catch (e) { rethrowCancelled(e); return undefined; }
}
