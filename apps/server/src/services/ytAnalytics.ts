import { googleFailure } from "./googleDiagnostics.js";
import { fetchRetry } from "../lib/http.js";
/**
 * Моя аналитика: вход через Google (OAuth 2.0, клиент типа «Приложение для ПК» — loopback-redirect на 127.0.0.1),
 * YouTube Data API (mine) + YouTube Analytics API v2: просмотры, время просмотра, средний % просмотра, удержание по ходу ролика,
 * источники трафика, подписки. Доход — отдельный opt-in scope и явный запрос. Показы/CTR — отдельный Reach Basic Reporting API.
 * Токены: data/oauth.json (refresh_token), права файла 600.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { dataPath, readJson, writeJson } from "../lib/storage.js";
import { config } from "../config.js";
import { saveEnvVars } from "./envfile.js";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth", TOKEN = "https://oauth2.googleapis.com/token", REVOKE = "https://oauth2.googleapis.com/revoke";
const YT = "https://www.googleapis.com/youtube/v3", YTA = "https://youtubeanalytics.googleapis.com/v2/reports";
export const MONETARY_SCOPE = "https://www.googleapis.com/auth/yt-analytics-monetary.readonly";
export const SCOPES = ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/yt-analytics.readonly"];
/** Отдельное право загрузки: запрашивается только по кнопке на странице «Публикация». */
export const UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";

export type Tokens = { access_token: string; refresh_token: string; expires_at: number; scope?: string; channel?: { id: string; title: string; thumbnail?: string; uploads?: string }; connectedAt: string };
const OAUTH = "oauth.json";
const client = () => ({ id: (process.env.GOOGLE_CLIENT_ID ?? "").trim(), secret: (process.env.GOOGLE_CLIENT_SECRET ?? "").trim() });
export const redirectUri = () => `http://127.0.0.1:${config.port}/api/yt-oauth/callback`;
const states = new Map<string, number>();
const scopeKnown = (t: Tokens | null) => typeof t?.scope === "string" && !!t.scope.trim();
const monetaryGranted = (t: Tokens | null) => scopeKnown(t) && t!.scope!.split(/\s+/).includes(MONETARY_SCOPE);
const uploadGranted = (t: Tokens | null) => scopeKnown(t) && t!.scope!.split(/\s+/).includes(UPLOAD_SCOPE);
/** Для какого канала запрошено право загрузки и куда вернуть автора. */
const uploadIntents = new Map<string, { channelId: string; project?: string }>();
const connectionKey = (t: Tokens | null) => t ? JSON.stringify([t.refresh_token, t.channel?.id, t.connectedAt]) : "none";

// All in-process changes of the active token file are serialized and use private temporary files.
let tokenQueue:Promise<unknown>=Promise.resolve();
function tokenMutation<T>(fn:()=>Promise<T>):Promise<T>{const p=tokenQueue.then(fn,fn);tokenQueue=p.catch(()=>{});return p;}
async function saveTokens(t:Tokens){
 const full=dataPath(OAUTH),tmp=full+"."+crypto.randomUUID()+".tmp";
 await fs.mkdir(dataPath(),{recursive:true});
 try{
  const st=await fs.lstat(full).catch((e:NodeJS.ErrnoException)=>{if(e.code==="ENOENT")return null;throw e;});
  if(st&&(!st.isFile()||st.isSymbolicLink()))throw new ApiError("VALIDATION","Файл активного OAuth должен быть обычным файлом, не ссылкой",400);
  await fs.writeFile(tmp,JSON.stringify(t,null,2),{mode:0o600,flag:"wx"});await fs.rename(tmp,full);
 }finally{await fs.rm(tmp,{force:true});}
}
async function commitTokens(next:Tokens,before:Tokens|null){return tokenMutation(async()=>{
 if(connectionKey(await loadTokens())!==connectionKey(before))throw new ApiError("VALIDATION","Подключение изменилось. Повторите действие для нужного канала.",409);
 await saveTokens(next);
});}
export const currentOAuthConnection=()=>loadTokens();
export const oauthClientId=()=>client().id;

const loadTokens = () => readJson<Tokens | null>(OAUTH, null);

export async function oauthStatus() {
  const c = client(), t = await loadTokens();
  return { configured: !!(c.id && c.secret), clientId: c.id ? c.id.slice(0, 12) + "…" : "", connected: !!t?.refresh_token, channel: t?.channel ?? null, connectedAt: t?.connectedAt, redirectUri: redirectUri(), scopes: SCOPES, scopeKnown: scopeKnown(t), monetaryGranted: monetaryGranted(t), uploadGranted: uploadGranted(t) };
}
export async function saveClient(id: string, secret: string) {
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id.trim())) throw new ApiError("VALIDATION", "Client ID должен оканчиваться на .apps.googleusercontent.com", 400);
  if (secret.trim().length < 10) throw new ApiError("VALIDATION", "Укажите Client secret", 400);
  await saveEnvVars({ GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret });
}
export function authUrl(options: { monetary?: boolean; upload?: boolean; selectAccount?: boolean } = {}) {
  const c = client();
  if (!c.id || !c.secret) throw new ApiError("KEY_MISSING", "Сначала укажите Client ID и Client secret OAuth-клиента Google", 400);
  const state = crypto.randomBytes(12).toString("hex"); states.set(state, Date.now());
  for (const [k, v] of states) if (Date.now() - v > 15 * 60_000) states.delete(k);
  const q = new URLSearchParams({ client_id: c.id, redirect_uri: redirectUri(), response_type: "code", scope: [...SCOPES, ...(options.monetary ? [MONETARY_SCOPE] : []), ...(options.upload ? [UPLOAD_SCOPE] : [])].join(" "), access_type: "offline", prompt: options.selectAccount ? "consent select_account" : "consent", include_granted_scopes: "true", state });
  return `${AUTH}?${q}`;
}
/** Ссылка на право загрузки для уже подключённого канала. Выданные раньше права сохраняются. */
export async function uploadAuthUrl(project?: string) {
  const t = await loadTokens();
  if (!t?.refresh_token || !t.channel) throw new ApiError("KEY_MISSING", "Сначала подключите канал: Моя аналитика → «Подключить YouTube».", 400);
  const url = new URL(authUrl({ monetary: monetaryGranted(t), upload: true, selectAccount: true }));
  for (const k of uploadIntents.keys()) if (!states.has(k)) uploadIntents.delete(k);
  uploadIntents.set(url.searchParams.get("state")!, { channelId: t.channel.id, ...(project ? { project } : {}) });
  return url.toString();
}
export const uploadReturn = (state: string | undefined) => (state ? uploadIntents.get(state)?.project ?? null : null);

async function tokenCall(body: Record<string, string>) {
  const r = await fetchRetry(TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }, { timeoutMs: 30_000, retries: 0 });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
  if (!r.ok || !j.access_token) {
    if (j.error === "invalid_grant") throw new ApiError("KEY_MISSING", "Доступ Google отозван или истёк — подключите канал заново", 400);
    throw new ApiError("UPSTREAM", `Google OAuth: ${j.error_description || j.error || r.status}`, 502);
  }
  if (typeof j.access_token !== "string" || typeof j.expires_in !== "number" || !Number.isFinite(j.expires_in) || j.scope !== undefined && typeof j.scope !== "string" || j.refresh_token !== undefined && typeof j.refresh_token !== "string") throw new ApiError("UPSTREAM", "Google OAuth вернул некорректные параметры токена", 502);
  return j as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
}

export async function handleCallback(q: { code?: string; state?: string; error?: string }) {
  const startedAt = q.state ? states.get(q.state) : undefined;
  const intent = q.state ? uploadIntents.get(q.state) : undefined;
  if (q.state) { states.delete(q.state); uploadIntents.delete(q.state); } // one-use even when consent is denied
  if (startedAt === undefined || Date.now() - startedAt > 15 * 60_000) throw new ApiError("KEY_MISSING", "Ссылка входа устарела — нажмите «Подключить» ещё раз", 400);
  if (q.error) throw new ApiError("KEY_MISSING", q.error === "access_denied" ? "Вы отменили доступ в окне Google" : "Google не завершил подключение", 400);
  if (!q.code) throw new ApiError("VALIDATION", "Google не вернул код подключения", 400);
  const before = await loadTokens(), c = client();
  const t = await tokenCall({ code: q.code, client_id: c.id, client_secret: c.secret, redirect_uri: redirectUri(), grant_type: "authorization_code" });
  if (!t.refresh_token) throw new ApiError("KEY_MISSING", "Google не выдал refresh-токен. Проверьте разрешения приложения Google и подключите снова; существующее подключение сохранено.", 400);
  let tok: Tokens = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in - 60) * 1000, scope: t.scope, connectedAt: new Date().toISOString() };
  // Validate the new connection entirely in memory. Failed upgrades never replace the old OAuth file.
  tok = await freshTokens(tok);
  const ch = await getWithAccess<{ items?: { id: string; snippet: { title: string; thumbnails?: { default?: { url: string } } }; contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] }>(`${YT}/channels`, { part: "snippet,contentDetails", mine: "true" }, tok.access_token);
  const it = ch.items?.[0];
  if (!it || !/^UC[\w-]{22}$/.test(it.id) || typeof it.snippet?.title !== "string") throw new ApiError("NOT_FOUND", "Google не вернул корректный канал YouTube. Существующее подключение сохранено.", 404);
  tok.channel = { id: it.id, title: it.snippet.title.slice(0, 300), thumbnail: it.snippet.thumbnails?.default?.url, uploads: it.contentDetails?.relatedPlaylists?.uploads };
  if (intent && it.id !== intent.channelId) throw new ApiError("VALIDATION", `В окне Google выбран другой канал («${tok.channel.title}»). Существующее подключение сохранено. Повторите и выберите тот же канал.`, 400);
  if (intent && !uploadGranted(tok)) throw new ApiError("KEY_MISSING", "Google не выдал право загрузки: в окне Google нужно отметить загрузку роликов. Существующее подключение сохранено.", 400);
  if (connectionKey(await loadTokens()) !== connectionKey(before)) throw new ApiError("VALIDATION", "Подключение изменилось во время проверки Google. Повторите вход для нужного канала.", 409);
  await commitTokens(tok,before);
  return tok.channel;
}
async function freshTokens(t: Tokens): Promise<Tokens> {
  if (Date.now() < t.expires_at) return t;
  const c = client();
  const r = await tokenCall({ refresh_token: t.refresh_token, client_id: c.id, client_secret: c.secret, grant_type: "refresh_token" });
  return { ...t, access_token: r.access_token, expires_at: Date.now() + (r.expires_in - 60) * 1000, ...(r.refresh_token !== undefined ? {refresh_token:r.refresh_token} : {}), ...(r.scope !== undefined ? { scope: r.scope } : {}) };
}
async function accessToken() {
  const t = await loadTokens();
  if (!t?.refresh_token) throw new ApiError("KEY_MISSING", "Канал не подключён: Моя аналитика → «Подключить YouTube»", 400);
  const refreshed = await freshTokens(t);
  if (refreshed !== t) {
    if (connectionKey(await loadTokens()) !== connectionKey(t)) throw new ApiError("VALIDATION", "Подключение изменилось во время обновления токена. Повторите запрос.", 409);
    await commitTokens(refreshed,t);
  }
  return refreshed.access_token;
}
async function gget<T>(url: string, q: Record<string, string>): Promise<T> {
  return getWithAccess<T>(url, q, await accessToken());
}
async function getWithAccess<T>(url: string, q: Record<string, string>, tok: string): Promise<T> {
  const r = await fetchRetry(`${url}?${new URLSearchParams(q)}`, { headers: { authorization: `Bearer ${tok}` } }, { timeoutMs: 30_000, retries: 1 });
  const j = (await r.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
  if (!r.ok) {
    const reason = j.error?.errors?.[0]?.reason ?? "";
    if (r.status === 403 && /accessNotConfigured|SERVICE_DISABLED/i.test(JSON.stringify(j))) throw new ApiError("UPSTREAM", "В Google Cloud не включён YouTube Analytics API или YouTube Data API v3 для этого проекта", 502);
    if (r.status === 401) throw new ApiError("KEY_MISSING", "Токен Google недействителен — подключите канал заново", 400);
    if (reason === "quotaExceeded") throw new ApiError("YT_QUOTA", "Квота YouTube API OAuth-проекта исчерпана — попробуйте завтра", 429);
    throw new ApiError("UPSTREAM", `YouTube API: ${j.error?.message ?? r.status}`.slice(0, 300), 502);
  }
  return j as T;
}
export async function disconnect() {
  const t = await loadTokens();
  if (t?.refresh_token) await fetchRetry(`${REVOKE}?token=${encodeURIComponent(t.refresh_token)}`, { method: "POST" }, { timeoutMs: 15_000, retries: 0 }).catch(() => {});
  await tokenMutation(async()=>{
    if(connectionKey(await loadTokens())!==connectionKey(t))throw new ApiError("VALIDATION","Подключение изменилось во время отключения. Новое активное подключение сохранено.",409);
    await fs.rm(dataPath(OAUTH), { force: true });
  });
}

/** Internal vault operation: force refresh (validates client binding), check the exact channel,
 * persist the verified slot, then atomically replace active OAuth. No raw tokens returned over HTTP. */
export async function verifySavedConnection(candidate:Tokens,persist:(verified:Tokens)=>Promise<void>,expectedCurrent?:Tokens){
 const before=await loadTokens();
 if(expectedCurrent&&connectionKey(before)!==connectionKey(expectedCurrent))throw new ApiError("VALIDATION","Активное подключение изменилось до проверки. Повторите сохранение.",409);
 let verified:Tokens;
 try{
  verified=await freshTokens({...candidate,expires_at:0});
  const ch=await getWithAccess<{items?:{id:string;snippet?:{title?:string;thumbnails?:{default?:{url?:string}}};contentDetails?:{relatedPlaylists?:{uploads?:string}}}[]}>(`${YT}/channels`,{part:"snippet,contentDetails",mine:"true"},verified.access_token);
  const it=ch.items?.find(x=>x.id===candidate.channel?.id);
  if(!it||typeof it.snippet?.title!=="string")throw new Error("Wrong channel");
  verified.channel={id:it.id,title:it.snippet.title.slice(0,300),thumbnail:it.snippet.thumbnails?.default?.url,uploads:it.contentDetails?.relatedPlaylists?.uploads};
 }catch{throw new ApiError("KEY_MISSING","Не удалось проверить сохранённое подключение Google для этого канала. Оно могло истечь, быть отозвано или не соответствовать OAuth-клиенту. Активное подключение не заменено; повторите вход в Google и сохранение.",400);}
 await tokenMutation(async()=>{
  if(connectionKey(await loadTokens())!==connectionKey(before))throw new ApiError("VALIDATION","Подключение изменилось во время проверки. Повторите действие.",409);
  await persist(verified);
  if(connectionKey(await loadTokens())!==connectionKey(before))throw new ApiError("VALIDATION","Подключение изменилось во время сохранения. Активное подключение не заменено.",409);
  await saveTokens(verified);
 });
 return oauthStatus();
}

// ───── отчёты ─────
type Report = { columnHeaders: { name: string }[]; rows?: (string | number)[][] };
export function rowsOf(r: Report): Record<string, string | number>[] { const h = r.columnHeaders.map((c) => c.name); return (r.rows ?? []).map((row) => Object.fromEntries(row.map((v, i) => [h[i], v]))); }
const day = (d: Date) => d.toISOString().slice(0, 10);
function range(days: number) { const end = new Date(Date.now() - 86400_000), start = new Date(end.getTime() - (days - 1) * 86400_000); return { startDate: day(start), endDate: day(end) }; }
const report = (q: Record<string, string>) => gget<Report>(YTA, { ids: "channel==MINE", ...q });
const BASE_M = "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares";

export const TRAFFIC_RU: Record<string, string> = { YT_SEARCH: "Поиск YouTube", SUGGESTED: "Рекомендуемые", BROWSE: "Главная и подписки", RELATED_VIDEO: "Похожие видео", EXT_URL: "Внешние сайты", NO_LINK_OTHER: "Прямые/неизвестно", PLAYLIST: "Плейлисты", YT_CHANNEL: "Страница канала", SUBSCRIBER: "Подписчики", NOTIFICATION: "Уведомления", SHORTS: "Лента Shorts", YT_OTHER_PAGE: "Другие страницы YouTube", END_SCREEN: "Конечные заставки", ANNOTATION: "Подсказки", CAMPAIGN_CARD: "Карточки", HASHTAGS: "Хэштеги", SOUND_PAGE: "Страница звука", ADVERTISING: "Реклама", LIVE_REDIRECT: "Перенаправление трансляции", PRODUCT_PAGE: "Страница товара", IMMERSIVE_LIVE: "Трансляции", VIDEO_REMIXES: "Ремиксы" };

export async function channelOverview(days = 28) {
  const r = range(days);
  const [totals, daily, top, traffic] = await Promise.all([
    report({ ...r, metrics: BASE_M }),
    report({ ...r, metrics: "views,estimatedMinutesWatched,subscribersGained", dimensions: "day", sort: "day" }),
    report({ ...r, metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained", dimensions: "video", sort: "-views", maxResults: "25" }),
    report({ ...r, metrics: "views,estimatedMinutesWatched", dimensions: "insightTrafficSourceType", sort: "-views" }),
  ]);
  const topRows = rowsOf(top);
  const meta = await videoMeta(topRows.map((x) => String(x.video)));
  return {
    range: r, days, channel: (await loadTokens())?.channel ?? null,
    totals: rowsOf(totals)[0] ?? {},
    daily: rowsOf(daily),
    traffic: rowsOf(traffic).map((x) => ({ source: String(x.insightTrafficSourceType), label: TRAFFIC_RU[String(x.insightTrafficSourceType)] ?? String(x.insightTrafficSourceType), views: Number(x.views), minutes: Number(x.estimatedMinutesWatched) })),
    videos: topRows.map((x) => ({ id: String(x.video), title: meta[String(x.video)]?.title ?? String(x.video), publishedAt: meta[String(x.video)]?.publishedAt, thumbnail: meta[String(x.video)]?.thumbnail, durationSec: meta[String(x.video)]?.durationSec ?? 0, views: Number(x.views), minutes: Number(x.estimatedMinutesWatched), avgDuration: Number(x.averageViewDuration), avgPct: Number(x.averageViewPercentage), subs: Number(x.subscribersGained) })),
    note: "В Обзоре показов и CTR нет. Отдельная вкладка «Показы и CTR» загружает суточные Reach Basic по кнопке; CTR пока показан исходным числом API. Доход требует отдельного финансового разрешения.",
  };
}

const iso = (s: string) => { const m = s.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + (+(m[4] ?? 0)) : 0; };
async function videoMeta(ids: string[]) {
  const out: Record<string, { title: string; publishedAt: string; thumbnail?: string; durationSec: number }> = {};
  for (let i = 0; i < ids.length; i += 50) {
    const r = await gget<{ items?: { id: string; snippet: { title: string; publishedAt: string; thumbnails?: { medium?: { url: string } } }; contentDetails: { duration: string } }[] }>(`${YT}/videos`, { part: "snippet,contentDetails", id: ids.slice(i, i + 50).join(",") });
    for (const v of r.items ?? []) out[v.id] = { title: v.snippet.title, publishedAt: v.snippet.publishedAt, thumbnail: v.snippet.thumbnails?.medium?.url, durationSec: iso(v.contentDetails.duration) };
  }
  return out;
}

/** Последние загрузки (для привязки к проектам) */
export async function myVideos(limit = 30) {
  const t = await loadTokens(); if (!t?.channel?.uploads) throw new ApiError("KEY_MISSING", "Канал не подключён", 400);
  const pl = await gget<{ items?: { contentDetails: { videoId: string } }[] }>(`${YT}/playlistItems`, { part: "contentDetails", playlistId: t.channel.uploads, maxResults: String(Math.min(50, limit)) });
  const ids = (pl.items ?? []).map((x) => x.contentDetails.videoId);
  const meta = await videoMeta(ids);
  return ids.map((id) => ({ id, ...meta[id] })).filter((v) => v.title);
}

export type Retention = { ratio: number; watch: number; relative: number }[];
export async function videoReport(id: string, days = 365) {
  if (!/^[\w-]{11}$/.test(id)) throw new ApiError("VALIDATION", "Неверный ID видео", 400);
  const meta = (await videoMeta([id]))[id];
  if (!meta) throw new ApiError("NOT_FOUND", "Видео не найдено на вашем канале", 404);
  const start = meta.publishedAt ? meta.publishedAt.slice(0, 10) : range(days).startDate, end = range(1).endDate;
  const f = { startDate: start < end ? start : end, endDate: end, filters: `video==${id}` };
  const [tot, ret, traffic, daily] = await Promise.all([
    report({ ...f, metrics: BASE_M }),
    report({ ...f, metrics: "audienceWatchRatio,relativeRetentionPerformance", dimensions: "elapsedVideoTimeRatio" }).catch(() => ({ columnHeaders: [], rows: [] }) as Report),
    report({ ...f, metrics: "views,estimatedMinutesWatched", dimensions: "insightTrafficSourceType", sort: "-views" }),
    report({ ...f, metrics: "views", dimensions: "day", sort: "day" }),
  ]);
  const retention: Retention = rowsOf(ret).map((x) => ({ ratio: Number(x.elapsedVideoTimeRatio), watch: Number(x.audienceWatchRatio), relative: Number(x.relativeRetentionPerformance) }));
  const link = (await loadLinks())[id];
  const out = {
    id, ...meta, totals: rowsOf(tot)[0] ?? {}, retention, daily: rowsOf(daily),
    traffic: rowsOf(traffic).map((x) => ({ source: String(x.insightTrafficSourceType), label: TRAFFIC_RU[String(x.insightTrafficSourceType)] ?? String(x.insightTrafficSourceType), views: Number(x.views), minutes: Number(x.estimatedMinutesWatched) })),
    projectId: link, compare: link ? await compareWithPrediction(link, retention, meta.durationSec) : null,
  };
  await cacheReport(out);
  return out;
}

/** Сведения о ролике для планового замера: чей он, открыт ли и свежий счётчик. null — YouTube ролик не отдал. */
export async function videoFacts(id: string) {
  if (!/^[\w-]{11}$/.test(id)) throw new ApiError("VALIDATION", "Неверный ID видео", 400);
  const r = await gget<{ items?: { snippet: { channelId: string; title: string; publishedAt: string }; contentDetails: { duration: string }; status?: { privacyStatus?: string }; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[] }>(`${YT}/videos`, { part: "snippet,contentDetails,statistics,status", id });
  const v = r.items?.[0];
  if (!v) return null;
  const count = (x?: string) => (x === undefined ? null : Number(x));
  return { channelId: v.snippet.channelId, title: v.snippet.title.slice(0, 300), publishedAt: v.snippet.publishedAt, durationSec: iso(v.contentDetails.duration), privacy: v.status?.privacyStatus ?? "unknown", counters: { views: count(v.statistics?.viewCount), likes: count(v.statistics?.likeCount), comments: count(v.statistics?.commentCount) } };
}

/** Данные одного замера. totals: null и пустое удержание значат «у YouTube данных ещё нет», а не ноль. */
export async function videoMilestoneReport(id: string, projectId: string) {
  const before = await loadTokens();
  if (!before?.refresh_token || !before.channel) throw new ApiError("KEY_MISSING", "Канал не подключён: Моя аналитика → «Подключить YouTube»", 400);
  const facts = await videoFacts(id);
  if (!facts || facts.channelId !== before.channel.id) throw new ApiError("VALIDATION", "Ролик не с подключённого канала. Замер не сохранён.", 409);
  const end = range(1).endDate, begin = facts.publishedAt.slice(0, 10);
  const f = { startDate: begin < end ? begin : end, endDate: end, filters: `video==${id}` };
  const [tot, traffic, ret] = await Promise.all([
    report({ ...f, metrics: BASE_M }),
    report({ ...f, metrics: "views,estimatedMinutesWatched", dimensions: "insightTrafficSourceType", sort: "-views" }),
    report({ ...f, metrics: "audienceWatchRatio,relativeRetentionPerformance", dimensions: "elapsedVideoTimeRatio" }).catch(() => null),
  ]);
  if (connectionKey(await loadTokens()) !== connectionKey(before)) throw new ApiError("VALIDATION", "Подключение изменилось во время замера. Замер не сохранён.", 409);
  const retention: Retention | null = ret && rowsOf(ret).map((x) => ({ ratio: Number(x.elapsedVideoTimeRatio), watch: Number(x.audienceWatchRatio), relative: Number(x.relativeRetentionPerformance) }));
  return {
    channel: { id: before.channel.id, title: before.channel.title.slice(0, 300) }, title: facts.title, durationSec: facts.durationSec,
    period: { startDate: f.startDate, endDate: f.endDate }, counters: facts.counters, totals: rowsOf(tot)[0] ?? null,
    traffic: rowsOf(traffic).map((x) => ({ source: String(x.insightTrafficSourceType), label: TRAFFIC_RU[String(x.insightTrafficSourceType)] ?? String(x.insightTrafficSourceType), views: Number(x.views), minutes: Number(x.estimatedMinutesWatched) })),
    retention, compare: retention?.length ? await compareWithPrediction(projectId, retention, facts.durationSec) : null,
  };
}

/** Fixed, read-only country report. Never persists OAuth data in a report. */
export async function geographySource(range: { startDate: string; endDate: string }) {
  const before = await loadTokens();
  if (!before?.refresh_token || !before.channel || !/^UC[\w-]{22}$/.test(before.channel.id))
    throw new ApiError("KEY_MISSING", "Подключите свой канал в «Моя аналитика»", 400);
  const result = await gget<Report>(YTA, {
    ids: `channel==${before.channel.id}`, ...range, dimensions: "country",
    metrics: "views,estimatedMinutesWatched", sort: "-views", maxResults: "250", startIndex: "1",
  });
  const after = await loadTokens();
  if (!after?.refresh_token || after.refresh_token !== before.refresh_token || after.channel?.id !== before.channel.id)
    throw new ApiError("VALIDATION", "Подключение канала изменилось во время запроса. Отчёт не сохранён; повторите для нужного канала.", 409);
  return { channel: { id: before.channel.id, title: before.channel.title.slice(0, 300) }, result };
}

/** Local identity for the active connection. No access-token refresh, Google call or secret output. */
export async function channelSnapshotConnection() {
 const t=await loadTokens();
 if(typeof t?.refresh_token!=="string"||!t.refresh_token||!t.channel||!/^UC[\w-]{22}$/.test(t.channel.id)||typeof t.channel.title!=="string")throw new ApiError("KEY_MISSING","Подключите свой канал в «Моя аналитика»",400);
 const connectionHash=crypto.createHmac("sha256",t.refresh_token).update(JSON.stringify([t.channel.id,t.connectedAt,client().id])).digest("hex");
 return {channel:{id:t.channel.id,title:t.channel.title.slice(0,300)},connectionHash};
}
/** Explicit basic daily snapshot for the currently connected channel, never financial. */
export async function channelSnapshotSource(range:{startDate:string;endDate:string},expectedConnection?:string){
 const before=await loadTokens();
 if(!before?.refresh_token||!before.channel||!/^UC[\w-]{22}$/.test(before.channel.id)||typeof before.channel.title!=="string")throw new ApiError("KEY_MISSING","Подключите свой канал в «Моя аналитика»",400);
 const reviewed=await channelSnapshotConnection();
 if(expectedConnection&&reviewed.connectionHash!==expectedConnection)throw new ApiError("VALIDATION","Подключение изменилось после предпросмотра. Обновите предпросмотр сводки.",409);
 const tok=await accessToken();
 if(expectedConnection&&(await channelSnapshotConnection()).connectionHash!==expectedConnection)throw new ApiError("VALIDATION","Подключение изменилось. Обновите предпросмотр.",409);
 if(connectionKey(await loadTokens())!==connectionKey(before))throw new ApiError("VALIDATION","Подключение изменилось до запроса сводки. Повторите для нужного канала.",409);
 const result=await getWithAccess<Report>(YTA,{ids:`channel==${before.channel.id}`,startDate:range.startDate,endDate:range.endDate,dimensions:"day",metrics:"views,estimatedMinutesWatched,subscribersGained,subscribersLost",sort:"day",maxResults:"366",startIndex:"1"},tok);
 if(connectionKey(await loadTokens())!==connectionKey(before))throw new ApiError("VALIDATION","Подключение изменилось во время запроса. Сводка канала не сохранена.",409);
 if(expectedConnection&&(await channelSnapshotConnection()).connectionHash!==expectedConnection)throw new ApiError("VALIDATION","Подключение изменилось во время запроса. Сводка не сохранена.",409);
 return {channel:{id:before.channel.id,title:before.channel.title.slice(0,300)},result};
}

/** Fixed monetary report, gated by an explicitly granted monetary scope. No fallback to public/RPM estimates. */
export async function revenueSource(range: { startDate: string; endDate: string }) {
  const before = await loadTokens();
  if (!before?.refresh_token || !before.channel || !/^UC[\w-]{22}$/.test(before.channel.id)) throw new ApiError("KEY_MISSING", "Подключите свой канал в «Моя аналитика»", 400);
  if (!monetaryGranted(before)) throw new ApiError("KEY_MISSING", scopeKnown(before) ? "Для дохода нужно отдельно разрешить финансовое чтение Google на вкладке «Доход». Обычная аналитика остаётся доступна." : "Разрешения сохранённого токена неизвестны. Для дохода подключите финансовое чтение Google на вкладке «Доход».", 400);
  const tok = await accessToken(), ready = await loadTokens();
  if (connectionKey(ready) !== connectionKey(before) || !monetaryGranted(ready)) throw new ApiError("VALIDATION", "Подключение или финансовое разрешение изменилось. Отчёт дохода не запрошен.", 409);
  const result = await getWithAccess<Report>(YTA, {
    ids: `channel==${before.channel.id}`, startDate: range.startDate, endDate: range.endDate,
    dimensions: "day", metrics: "views,estimatedRevenue,estimatedAdRevenue", sort: "day", currency: "USD", maxResults: "366", startIndex: "1",
  }, tok);
  const after = await loadTokens();
  if (connectionKey(after) !== connectionKey(before) || !monetaryGranted(after)) throw new ApiError("VALIDATION", "Подключение или финансовое разрешение изменилось во время запроса. Отчёт дохода не сохранён.", 409);
  return { channel: { id: before.channel.id, title: before.channel.title.slice(0, 300) }, result };
}

// ───── привязка видео ↔ проект и сравнение с прогнозом «Оценки сценария» ─────
const LINKS = "yt-links.json";
const loadLinks = () => readJson<Record<string, string>>(LINKS, {});
export async function linkVideo(videoId: string, projectId: string | null) {
  const l = await loadLinks(); if (projectId) l[videoId] = projectId; else delete l[videoId]; await writeJson(LINKS, l); return l;
}
export const listLinks = loadLinks;

/** Реальная кривая (доля длительности → % зрителей) против прогноза (секунды → %) */
export function compareCurves(pred: { t: number; v: number }[], actual: Retention, durationSec: number) {
  if (!pred.length || !actual.length || !durationSec) return null;
  const at = (sec: number) => { let a = pred[0]; for (const p of pred) { if (p.t > sec) { const k = (sec - a.t) / Math.max(1, p.t - a.t); return a.v + (p.v - a.v) * k; } a = p; } return a.v; };
  const pts = actual.map((x) => ({ ratio: x.ratio, sec: Math.round(x.ratio * durationSec), actual: Math.round(x.watch * 1000) / 10, predicted: Math.round(at(x.ratio * durationSec) * 10) / 10 }));
  const mae = pts.reduce((s, p) => s + Math.abs(p.actual - p.predicted), 0) / pts.length;
  const at30 = pts.find((p) => p.sec >= 30), mid = pts[Math.floor(pts.length / 2)], end = pts[pts.length - 1];
  // где реальная кривая проваливается сильнее прогноза: локальные спады > 3 п.п. за шаг
  const drops = pts.slice(1).map((p, i) => ({ sec: p.sec, drop: pts[i].actual - p.actual, gap: p.actual - p.predicted })).filter((d) => d.drop > 3 && d.sec > 15).sort((a, b) => b.drop - a.drop).slice(0, 5);
  return { points: pts, mae: Math.round(mae * 10) / 10, at30: at30 && { actual: at30.actual, predicted: at30.predicted }, mid: mid && { actual: mid.actual, predicted: mid.predicted }, end: end && { actual: end.actual, predicted: end.predicted }, drops, verdict: mae < 8 ? "Прогноз близок к реальности" : (pts.reduce((s, p) => s + p.actual - p.predicted, 0) / pts.length) > 0 ? "Реальное удержание лучше прогноза" : "Реальное удержание хуже прогноза" };
}
async function compareWithPrediction(projectId: string, actual: Retention, durationSec: number) {
  try {
    const { getProject } = await import("./projects.js");
    const p = await getProject(projectId);
    const rater = [...p.artifacts].reverse().find((a) => a.kind === "check" && (a.data as any)?.tool === "Оценка сценария");
    const pred = (rater?.data as { retention?: { t: number; v: number }[]; score?: number })?.retention;
    if (!pred) return { projectTitle: p.title, error: "В проекте нет «Оценки сценария» с прогнозом удержания" };
    return { projectTitle: p.title, score: (rater!.data as any).score as number, ...compareCurves(pred, actual, durationSec) };
  } catch { return null; }
}

// ───── уроки: ИИ сравнивает сильные и слабые ролики ─────
const REPORTS = "yt-reports.json";
async function cacheReport(r: { id: string; title: string }) { const all = await readJson<Record<string, unknown>>(REPORTS, {}); all[r.id] = { ...r, cachedAt: new Date().toISOString() }; await writeJson(REPORTS, all); }
const Lessons = z.object({
  summary: z.string(), working: z.array(z.object({ title: z.string(), evidence: z.string(), action: z.string() })).max(8),
  notWorking: z.array(z.object({ title: z.string(), evidence: z.string(), action: z.string() })).max(8),
  experiments: z.array(z.string()).max(6), forScript: z.array(z.string()).max(8),
});
export type LessonsT = z.infer<typeof Lessons> & { createdAt: string; model: string; videos: number; channel?:{id:string;title:string} };
export async function getLessons(){
 const current=await loadTokens(),saved=await readJson<LessonsT|null>("yt-lessons.json",null);
 return current?.channel?.id&&saved?.channel?.id===current.channel.id?saved:null;
}
export async function buildLessons(days = 90) {
  const connection=await loadTokens();
  const ov = await channelOverview(days);
  if(connectionKey(await loadTokens())!==connectionKey(connection))throw new ApiError("VALIDATION","Подключение изменилось при сборе уроков",409);
  if (ov.videos.length < 3) throw new ApiError("VALIDATION", "Нужно хотя бы 3 видео с просмотрами за период", 400);
  const reps = await readJson<Record<string, any>>(REPORTS, {});
  const fmt = (v: (typeof ov.videos)[number]) => {
    const r = reps[v.id]; const ret = r?.retention as Retention | undefined;
    const curve = ret?.length ? ` | retention@10%=${Math.round((ret.find((x) => x.ratio >= 0.1)?.watch ?? 0) * 100)}% @50%=${Math.round((ret.find((x) => x.ratio >= 0.5)?.watch ?? 0) * 100)}% @90%=${Math.round((ret.find((x) => x.ratio >= 0.9)?.watch ?? 0) * 100)}%` : "";
    const cmp = r?.compare?.mae != null ? ` | predicted vs actual MAE ${r.compare.mae} pp (${r.compare.verdict})` : "";
    return `- "${v.title}" | ${Math.round(v.durationSec / 60)} min | views ${v.views} | avg view ${Math.round(v.avgPct)}% (${Math.round(v.avgDuration)} s) | subs +${v.subs}${curve}${cmp}`;
  };
  const { generateJson } = await import("./llm.js");
  const { getSettings } = await import("./settings.js");
  const lang = (await getSettings()).contentLanguage;
  const { data, model } = await generateJson({
    system: "You are a YouTube growth analyst. You find concrete, evidence-based patterns in a channel's own analytics. Never invent numbers; cite the videos and metrics given.",
    user: `Language of all text: ${lang}.
Channel «${ov.channel?.title ?? ""}», last ${days} days. Totals: ${JSON.stringify(ov.totals)}.
Traffic sources: ${ov.traffic.slice(0, 8).map((t) => `${t.label} ${t.views}`).join(", ")}.
Videos (sorted by views):
${ov.videos.map(fmt).join("\n")}

Compare the strongest and weakest videos (titles/topics, length, average view %, retention points, subs gained, traffic). Return:
- "summary": 2–3 sentences on what drives this channel
- "working": patterns that work (title, evidence with video names and numbers, action)
- "notWorking": patterns that hurt (same fields)
- "experiments": 3–5 concrete tests for the next videos
- "forScript": 3–6 short rules for the scriptwriter (hook, length, pacing, topics) based on this data
JSON {"summary","working":[{"title","evidence","action"}],"notWorking":[...],"experiments":[],"forScript":[]}`,
    maxTokens: 4000, temperature: 0.4,
  }, Lessons);
  if(!connection?.channel||connectionKey(await loadTokens())!==connectionKey(connection))throw new ApiError("VALIDATION","Подключение изменилось во время AI-анализа. Уроки не сохранены; уже отправленный вызов может быть оплачен.",409);
  const res: LessonsT = { ...data, createdAt: new Date().toISOString(), model, videos: ov.videos.length,channel:{id:connection.channel.id,title:connection.channel.title} };
  await writeJson("yt-lessons.json", res);
  return res;
}

/** Internal bound Reporting API session. URLs and token stay server-side; no redirects or automatic write retries. */
export async function reportingSession<T>(fn:(s:{channel:{id:string;title:string};request:(path:string,method?:"GET"|"POST"|"DELETE",body?:unknown)=>Promise<unknown>;download:(url:string)=>Promise<string>;assertCurrent:()=>Promise<void>})=>Promise<T>):Promise<T>{
 const before=await loadTokens(),boundClient=client();
 if(!before?.refresh_token||!before.channel||!/^UC[\w-]{22}$/.test(before.channel.id))throw new ApiError("KEY_MISSING","Подключите свой канал Google на вкладке Обзор",400);
 let tok:string;try{tok=await accessToken();}catch(e){if(e instanceof ApiError&&e.status===409)throw e;throw new ApiError("KEY_MISSING","Не удалось обновить OAuth для Reporting API. Подключите нужный канал заново.",400);}const ready=await loadTokens();
 if(!ready||ready.channel?.id!==before.channel.id||ready.connectedAt!==before.connectedAt)throw new ApiError("VALIDATION","Подключение изменилось до запроса Reporting API",409);
 const assertCurrent=async()=>{if(client().id!==boundClient.id||client().secret!==boundClient.secret||connectionKey(await loadTokens())!==connectionKey(ready))throw new ApiError("VALIDATION","Подключение изменилось. Результат не сохранён; если выполнялась команда Google, проверьте список заданий перед повтором.",409);};
 const bounded=async(url:string,method:"GET"|"POST"|"DELETE",body:unknown,max:number)=>{
  await assertCurrent();let response:Response;
  try{response=await fetch(url,{method,headers:{authorization:`Bearer ${tok}`,...(body===undefined?{}:{"content-type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:"manual",signal:AbortSignal.timeout(30_000)});}catch{throw new ApiError("UPSTREAM",method==="GET"?"Не удалось прочитать YouTube Reporting API. Проверьте подключение и доступ.":"Ответ на команду Google не получен. Исход неизвестен: сначала обновите список заданий, не повторяйте команду вслепую.",502);}
  if(!response.ok)throw await googleFailure(response,url.startsWith(`${YT}/`)?"youtube-data":"youtube-reporting",method);
  const reader=response.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
  if(reader)try{while(true){const n=await reader.read();if(n.done)break;size+=n.value.byteLength;if(size>max)throw new ApiError("VALIDATION","Ответ Reporting API превышает допустимый размер; результат не сохранён",413);chunks.push(n.value);}}catch(e){await reader.cancel().catch(()=>{});if(e instanceof ApiError)throw e;throw new ApiError("UPSTREAM","Загрузка ответа Reporting API прервалась; результат не сохранён. Перед повтором команды проверьте список заданий.",502);}finally{reader.releaseLock();}
  await assertCurrent();try{return new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks));}catch{throw new ApiError("UPSTREAM","Reporting API вернул некорректный UTF-8",502);}
 };
 // Validate the exact channel with the same access token before any Reporting request or write.
 const identity=await bounded(`${YT}/channels?part=snippet&mine=true`,"GET",undefined,1024*1024);
 let items:{id?:string}[];try{items=JSON.parse(identity).items;if(!Array.isArray(items)||items.length!==1||items[0]?.id!==before.channel!.id)throw Error();}catch{throw new ApiError("KEY_MISSING","Не подтверждён точный канал Google для Reporting API",400);}
 const request=async(path:string,method:"GET"|"POST"|"DELETE"="GET",body?:unknown)=>{
  if(!/^\/(jobs(?:\/[A-Za-z0-9_-]{1,200})?(?:\/reports(?:\/[A-Za-z0-9_-]{1,200})?)?)(?:\?[^#]*)?$/.test(path))throw new ApiError("VALIDATION","Недопустимый путь Reporting API",400);
  const text=await bounded("https://youtubereporting.googleapis.com/v1"+path,method,body,1024*1024);if(method==="DELETE"&&!text)return {};
  try{return JSON.parse(text);}catch{throw new ApiError("UPSTREAM","Reporting API вернул некорректный JSON. Перед повтором команды проверьте список заданий.",502);}
 };
 const download=async(url:string)=>{let u:URL;try{u=new URL(url);}catch{throw new ApiError("UPSTREAM","Некорректный адрес отчёта",502);}
  if(u.origin!=="https://youtubereporting.googleapis.com"||u.username||u.password||u.hash||!u.pathname.startsWith("/v1/media/")||u.pathname.length<=10||url.length>1000)throw new ApiError("UPSTREAM","Небезопасный адрес отчёта: загрузка заблокирована",502);
  return bounded(u.href,"GET",undefined,8*1024*1024);
 };
 const result=await fn({channel:{id:before.channel.id,title:before.channel.title.slice(0,300)},request,download,assertCurrent});await assertCurrent();return result;
}
