import { ApiError } from "../lib/errors.js";
import { fetchRetry } from "../lib/http.js";
import { cached } from "../lib/cache.js";
import { addYoutubeUnits } from "./usage.js";
import { markYt, markYtOk, ytCandidates, ytConfigured } from "./ytKeys.js";

const BASE = "https://www.googleapis.com/youtube/v3";
const TTL = 6 * 3600_000;

export type Channel = {
  id: string; title: string; handle?: string; description: string; avatar?: string; country?: string; publishedAt: string;
  subscribers: number; hiddenSubscribers: boolean; totalViews: number; videoCount: number; uploadsPlaylistId: string; keywords?: string; subscriberCountKnown?: boolean; totalViewsKnown?: boolean; videoCountKnown?: boolean;
};
export type Video = {
  id: string; title: string; description: string; publishedAt: string; durationSec: number; isShort: boolean;
  views: number; viewsKnown?: boolean; likes: number; likesKnown?: boolean; comments: number; commentsKnown?: boolean; durationKnown?: boolean; tags: string[]; thumbnail?: string; channelId: string; channelTitle: string;
};

async function yt<T = any>(path: string, params: Record<string, string | number | undefined>, units: number): Promise<T> {
  if (!ytConfigured().length) throw new ApiError("KEY_MISSING", "Не задан ключ YouTube (YOUTUBE_API_KEY) — вставьте его в Настройках", 400);
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
  const cands = await ytCandidates();
  if (!cands.length) {
    const n = ytConfigured().length;
    throw new ApiError("YT_QUOTA", n > 1 ? `Квота YouTube исчерпана на всех ${n} ключах — сброс в 10:00 по Москве. Можно добавить ещё ключ в Настройках` : "Квота YouTube на сегодня исчерпана — сброс в 10:00 по Москве. Добавьте резервный ключ в Настройках (до 3 шт.)", 429);
  }
  let last: ApiError | null = null;
  for (const { slot, key } of cands) {
    qs.set("key", key);
    const r = await fetchRetry(`${BASE}/${path}?${qs}`, {}, { timeoutMs: 20_000, retries: 2 });
    await addYoutubeUnits(units, slot);
    const j: any = await r.json().catch(() => ({}));
    if (r.ok) { await markYtOk(slot); return j as T; }
    const reason = j?.error?.errors?.[0]?.reason;
    const msg = String(j?.error?.message ?? "");
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded" || reason === "rateLimitExceeded" && /quota/i.test(msg)) {
      await markYt(slot, "quota", "квота исчерпана");
      const n = ytConfigured().length;
      last = new ApiError("YT_QUOTA", n > 1 ? `Квота YouTube исчерпана на всех ${n} ключах — сброс в 10:00 по Москве` : "Квота YouTube на сегодня исчерпана — сброс в 10:00 по Москве. Добавьте резервный ключ в Настройках (до 3 шт.)", 429);
      continue;
    }
    if (reason === "keyInvalid" || reason === "keyExpired" || /API key (not valid|expired)/i.test(msg) || r.status === 403 && /has not been used|disabled|blocked/i.test(msg)) {
      const text = /expired/i.test(msg) ? "Ключ YouTube просрочен — создайте новый в Google Cloud Console и вставьте в Настройках" : /has not been used|disabled/i.test(msg) ? "Для ключа YouTube не включён YouTube Data API v3 в Google Cloud" : "Ключ YouTube недействителен";
      await markYt(slot, "bad", text);
      last = new ApiError("KEY_MISSING", text, 400);
      continue;
    }
    if (reason === "commentsDisabled") throw new ApiError("VALIDATION", "У этого видео отключены комментарии", 400);
    if (reason === "videoNotFound") throw new ApiError("YT_NOT_FOUND", "Видео не найдено", 404);
    if (reason === "playlistNotFound") throw new ApiError("YT_NOT_FOUND", "У канала нет публичных видео", 404);
    throw new ApiError("UPSTREAM", `YouTube: ${msg || `HTTP ${r.status}`}`, 502);
  }
  throw last ?? new ApiError("YT_QUOTA", "Квота YouTube исчерпана", 429);
}

/** Принимает: ссылку любого вида, @handle, channelId (UC…), ссылку на видео */
export function parseChannelInput(input: string): { kind: "id" | "handle" | "username" | "custom" | "video"; value: string } {
  const s = input.trim();
  if (/^UC[\w-]{22}$/.test(s)) return { kind: "id", value: s };
  if (/^@[\w.\-·]+$/u.test(s)) return { kind: "handle", value: s };
  let url: URL | null = null;
  try { url = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`); } catch {}
  if (url && /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(url.hostname)) {
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (url.hostname.endsWith("youtu.be") && parts[0]) return { kind: "video", value: parts[0] };
    if (parts[0]?.startsWith("@")) return { kind: "handle", value: parts[0] };
    if (parts[0] === "channel" && parts[1]) return { kind: "id", value: parts[1] };
    if (parts[0] === "user" && parts[1]) return { kind: "username", value: parts[1] };
    if (parts[0] === "c" && parts[1]) return { kind: "custom", value: parts[1] };
    if (parts[0] === "watch" && url.searchParams.get("v")) return { kind: "video", value: url.searchParams.get("v")! };
    if (parts[0] === "shorts" && parts[1]) return { kind: "video", value: parts[1] };
    if (parts[0] && !["watch", "results", "feed"].includes(parts[0])) return { kind: "custom", value: parts[0] };
  }
  if (/^[\w.\-]{3,}$/.test(s)) return { kind: "handle", value: `@${s}` };
  throw new ApiError("VALIDATION", "Не удалось распознать канал. Вставьте ссылку, @handle или ID канала (UC…)", 400);
}

const num = (x: unknown) => Number(x ?? 0) || 0;
const knownCounter = (x: unknown) => (typeof x === "number" || typeof x === "string" && /^\d+$/.test(x)) && Number.isSafeInteger(Number(x)) && Number(x) >= 0;
const toChannel = (c: any): Channel => ({
  id: c.id, title: c.snippet.title, handle: c.snippet.customUrl, description: c.snippet.description ?? "",
  avatar: c.snippet.thumbnails?.medium?.url ?? c.snippet.thumbnails?.default?.url, country: c.snippet.country,
  publishedAt: c.snippet.publishedAt, subscribers: num(c.statistics?.subscriberCount), hiddenSubscribers: c.statistics?.hiddenSubscriberCount === true,
  subscriberCountKnown: c.statistics?.hiddenSubscriberCount !== true && knownCounter(c.statistics?.subscriberCount),
  totalViewsKnown: knownCounter(c.statistics?.viewCount), videoCountKnown: knownCounter(c.statistics?.videoCount),
  totalViews: num(c.statistics?.viewCount), videoCount: num(c.statistics?.videoCount),
  uploadsPlaylistId: c.contentDetails?.relatedPlaylists?.uploads ?? `UU${c.id.slice(2)}`, keywords: c.brandingSettings?.channel?.keywords,
});

export async function resolveChannel(input: string, force = false): Promise<Channel> {
  const p = parseChannelInput(input);
  return cached(`ch:${p.kind}:${p.value.toLowerCase()}`, TTL, async () => {
    const part = "snippet,statistics,contentDetails,brandingSettings";
    let id: string | undefined;
    if (p.kind === "video") {
      const v = await yt("videos", { part: "snippet", id: p.value }, 1);
      id = v.items?.[0]?.snippet?.channelId;
    } else if (p.kind === "custom") {
      const h = await yt("channels", { part, forHandle: `@${p.value}` }, 1);
      if (h.items?.[0]) return toChannel(h.items[0]);
      const sr = await yt("search", { part: "snippet", type: "channel", q: p.value, maxResults: 1 }, 100);
      id = sr.items?.[0]?.snippet?.channelId;
    }
    const params = p.kind === "id" ? { id: p.value } : p.kind === "handle" ? { forHandle: p.value } : p.kind === "username" ? { forUsername: p.value } : { id };
    if (!Object.values(params)[0]) throw new ApiError("YT_NOT_FOUND", "Канал не найден", 404);
    const r = await yt("channels", { part, ...params }, 1);
    if (!r.items?.[0]) throw new ApiError("YT_NOT_FOUND", `Канал «${p.value}» не найден`, 404);
    return toChannel(r.items[0]);
  }, force);
}

export function parseDuration(iso: string): number {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso ?? "");
  if (!m) return 0;
  return (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + (+(m[4] ?? 0));
}

const toVideo = (v: any): Video => {
  const durationSec = parseDuration(v.contentDetails?.duration);
  return {
    id: v.id, title: v.snippet.title, description: v.snippet.description ?? "", publishedAt: v.snippet.publishedAt,
    durationSec, durationKnown: typeof v.contentDetails?.duration === "string" && /^P(?=.+)(?:\d+D)?(?:T(?=.+)(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/.test(v.contentDetails.duration) && Number.isSafeInteger(durationSec) && durationSec > 0, isShort: durationSec > 0 && durationSec <= 180,
    views: num(v.statistics?.viewCount), viewsKnown: knownCounter(v.statistics?.viewCount), likes: num(v.statistics?.likeCount), likesKnown: knownCounter(v.statistics?.likeCount), comments: num(v.statistics?.commentCount), commentsKnown: knownCounter(v.statistics?.commentCount),
    tags: v.snippet.tags ?? [], thumbnail: v.snippet.thumbnails?.medium?.url ?? v.snippet.thumbnails?.high?.url ?? v.snippet.thumbnails?.default?.url,
    channelId: v.snippet.channelId, channelTitle: v.snippet.channelTitle,
  };
};

export async function getVideos(ids: string[]): Promise<Video[]> {
  const out: Video[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const r = await yt("videos", { part: "snippet,statistics,contentDetails", id: chunk.join(","), maxResults: 50 }, 1);
    out.push(...(r.items ?? []).map(toVideo));
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Последние загрузки: минимум `want` видео нужного типа и все видео за `days` дней (с лимитом страниц) */
export async function getRecentUploads(ch: Channel, want: number, type: "all" | "long" | "shorts", days = 60, force = false): Promise<Video[]> {
  return cached(`up:${ch.id}:${want}:${type}:${days}`, TTL, async () => {
    const since = Date.now() - days * 86400_000;
    const maxPages = Math.min(10, Math.ceil((type === "all" ? want : want * 3) / 50) + 2);
    const videos: Video[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const r = await yt("playlistItems", { part: "contentDetails", playlistId: ch.uploadsPlaylistId, maxResults: 50, pageToken }, 1);
      const ids: string[] = (r.items ?? []).map((i: any) => i.contentDetails.videoId);
      if (!ids.length) break;
      videos.push(...(await getVideos(ids)));
      const typed = videos.filter((v) => type === "all" || (type === "shorts" ? v.isShort : !v.isShort));
      const oldest = videos[videos.length - 1];
      if (typed.length >= want && new Date(oldest.publishedAt).getTime() < since) break;
      pageToken = r.nextPageToken;
      if (!pageToken) break;
    }
    return videos.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
  }, force);
}

export async function searchVideos(q: string, opts: { publishedAfter?: string; lang?: string; max?: number; order?: string } = {}): Promise<string[]> {
  const r = await yt("search", { part: "snippet", type: "video", q, order: opts.order ?? "viewCount", maxResults: opts.max ?? 25, publishedAfter: opts.publishedAfter, relevanceLanguage: opts.lang }, 100);
  return (r.items ?? []).map((i: any) => i.id.videoId as string).filter(Boolean);
}

export async function getChannelsStats(ids: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 50) {
    const r = await yt("channels", { part: "statistics", id: uniq.slice(i, i + 50).join(","), maxResults: 50 }, 1);
    for (const c of r.items ?? []) m.set(c.id, num(c.statistics.subscriberCount));
  }
  return m;
}

/** Поиск с пагинацией (каждая страница — 100 ед.) */
export async function searchPaged(q: string, o: { pages: number; order?: string; publishedAfter?: string; lang?: string; region?: string; duration?: "short" | "medium" | "long"; type?: "video" | "channel" }): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let p = 0; p < o.pages; p++) {
    const r = await cached(`sp:${q}:${o.order}:${o.publishedAfter?.slice(0, 10)}:${o.lang}:${o.region}:${o.duration}:${o.type}:${p}`, TTL, () => yt("search", {
      part: "snippet", type: o.type ?? "video", q, order: o.order ?? "relevance", maxResults: 50, pageToken, publishedAfter: o.publishedAfter,
      relevanceLanguage: o.lang, regionCode: o.region, videoDuration: o.duration,
    }, 100));
    ids.push(...(r.items ?? []).map((i: any) => (o.type === "channel" ? i.id.channelId : i.id.videoId) as string).filter(Boolean));
    pageToken = r.nextPageToken;
    if (!pageToken) break;
  }
  return [...new Set(ids)];
}

/** Полные данные каналов (1 ед. на 50 каналов) */
export async function getChannelsFull(ids: string[], force = false): Promise<Map<string, Channel>> {
  const m = new Map<string, Channel>();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 50) {
    const chunk = uniq.slice(i, i + 50);
    const r = await cached(`chf:${chunk.join(",")}`, force ? 0 : TTL, () => yt("channels", { part: "snippet,statistics,contentDetails", id: chunk.join(","), maxResults: 50 }, 1), force);
    for (const c of r.items ?? []) m.set(c.id, toChannel(c));
  }
  return m;
}

/** Последние n загрузок плейлиста (2 ед.) */
export async function latestUploads(playlistId: string, n: number, force = false): Promise<Video[]> {
  return cached(`lu:${playlistId}:${n}`, force ? 0 : 12 * 3600_000, async () => {
    const r = await yt("playlistItems", { part: "contentDetails", playlistId, maxResults: Math.min(50, n) }, 1).catch((e) => { if ((e as ApiError).code === "YT_NOT_FOUND") return { items: [] }; throw e; });
    const ids: string[] = (r.items ?? []).map((i: any) => i.contentDetails.videoId);
    return ids.length ? getVideos(ids) : [];
  }, force);
}

export type YtComment = { id: string; text: string; likes: number; replies: number; author: string; publishedAt: string };
/** Топ-комментарии видео: commentThreads.list, 1 ед. за 100 шт. */
export async function getComments(videoId: string, max = 200, order: "relevance" | "time" = "relevance"): Promise<YtComment[]> {
  return cached(`cm:${videoId}:${max}:${order}`, 6 * 3600_000, async () => {
    const out: YtComment[] = []; let pageToken: string | undefined;
    while (out.length < max) {
      const r = await yt("commentThreads", { part: "snippet", videoId, maxResults: 100, order, textFormat: "plainText", pageToken }, 1);
      for (const it of r.items ?? []) {
        const s = it.snippet?.topLevelComment?.snippet; if (!s) continue;
        out.push({ id: it.id, text: String(s.textDisplay ?? "").slice(0, 600), likes: num(s.likeCount), replies: num(it.snippet.totalReplyCount), author: s.authorDisplayName ?? "", publishedAt: s.publishedAt });
      }
      pageToken = r.nextPageToken; if (!pageToken) break;
    }
    return out.slice(0, max);
  });
}

/** One bounded channel-search page; force bypasses the entire search cache. */
export async function searchChannels(q: string, max: number, lang: string, force = false): Promise<string[]> {
  return cached(`niche-search:${q}:${max}:${lang}`, TTL, async () => {
    const r = await yt("search", { part: "snippet", type: "channel", q, maxResults: max, relevanceLanguage: lang }, 100);
    return [...new Set<string>((r.items ?? []).map((i: any) => i.id?.channelId).filter((id: unknown) => typeof id === "string" && /^UC[\w-]+$/.test(id)))].slice(0, max);
  }, force);
}

/** One fresh search page, no cache/dedup/metadata calls: preserves this API response order. */
export async function searchVideoPage(q:string,o:{lang:string;region?:string}):Promise<unknown>{
  return yt("search",{part:"snippet",type:"video",q,order:"relevance",maxResults:50,relevanceLanguage:o.lang,regionCode:o.region,safeSearch:"moderate"},100);
}

/** Explicit comment review: exactly one fresh page, no cache, replies or metadata requests. */
export async function commentThreadPage(videoId:string,max:20|50,order:'relevance'|'time'):Promise<unknown>{
 return yt('commentThreads',{part:'snippet',videoId,maxResults:max,order,textFormat:'plainText'},1);
}

/** Explicit Research evidence: one fresh page, exact recorded search parameters. */
export async function researchVideoPage(q:string,o:{language:string;region?:string;order:'relevance'|'viewCount'|'date';publishedAfter?:string}):Promise<unknown>{
  return yt('search',{part:'snippet',type:'video',q,maxResults:50,order:o.order,relevanceLanguage:o.language,regionCode:o.region,publishedAfter:o.publishedAfter,safeSearch:'moderate'},100);
}

/** Fresh bounded basis, no cache and no 404-to-empty substitution. */
export async function researchUploadsPage(playlistId:string,maxResults=50):Promise<Video[]> {
 const page=await yt('playlistItems',{part:'contentDetails',playlistId,maxResults},1);
 if(!Array.isArray(page.items)||page.items.length>maxResults)throw new ApiError('UPSTREAM','Некорректная страница загрузок',502);
 const ids=page.items.map((x:any)=>x?.contentDetails?.videoId);
 if(new Set(ids).size!==ids.length||ids.some((id:unknown)=>typeof id!=='string'||! /^[\w-]{11}$/.test(id)))throw new ApiError('UPSTREAM','Некорректные ID загрузок',502);
 const videos=ids.length?await getVideos(ids):[];
 if(new Set(videos.map(v=>v.id)).size!==videos.length||videos.length>maxResults||videos.some(v=>!ids.includes(v.id)))throw new ApiError('UPSTREAM','Несогласованные метаданные загрузок',502);
 return videos;
}

/** Scorecard evidence: preserve page IDs/order and missing metadata, never cache or follow pagination. */
export async function videoScoreUploadPage(playlistId:string) {
 const page=await yt('playlistItems',{part:'contentDetails',playlistId,maxResults:50},1),pageAt=new Date().toISOString();
 if(!Array.isArray(page.items)||page.items.length>50||page.nextPageToken!==undefined&&(typeof page.nextPageToken!=='string'||page.nextPageToken.length>2000))throw new ApiError('UPSTREAM','Некорректная страница загрузок',502);
 const ids:string[]=page.items.map((x:any)=>x?.contentDetails?.videoId);
 if(new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[\w-]{11}$/.test(id)))throw new ApiError('UPSTREAM','Некорректные ID загрузок',502);
 const videos=ids.length?await getVideos(ids):[],sampleAt=ids.length?new Date().toISOString():null;
 if(new Set(videos.map(v=>v.id)).size!==videos.length||videos.length>ids.length||videos.some(v=>!ids.includes(v.id)))throw new ApiError('UPSTREAM','Несогласованные метаданные загрузок',502);
 return {ids,videos,hasMore:!!page.nextPageToken,pageAt,sampleAt};
}

/** Assistant-only, one bounded page. Preserve top-level comment ID and explicit clipping.
 * Existing research/comment consumers keep their original sampling behaviour. */
export async function assistantCommentPage(videoId:string,max:20|50,order:'relevance'|'time') {
 const r=await yt("commentThreads",{part:"snippet",videoId,maxResults:max,order,textFormat:"plainText"},1);
 let remaining=20000;
 const comments:(YtComment & {truncated:boolean})[]=[];
 for(const item of (r.items??[]).slice(0,max)) {
  const top=item.snippet?.topLevelComment,s=top?.snippet;
  if(!s||typeof top.id!=="string"||!top.id.match(/^[a-zA-Z0-9_-]{1,200}$/)||typeof s.textDisplay!=="string")continue;
  if(remaining<=0)break;
  const text=s.textDisplay.slice(0,Math.min(2000,remaining));remaining-=text.length;
  if(text)comments.push({id:top.id,text,likes:num(s.likeCount),replies:num(item.snippet.totalReplyCount),author:String(s.authorDisplayName??"").slice(0,200),publishedAt:String(s.publishedAt??"").slice(0,50),truncated:text.length<s.textDisplay.length});
 }
 return {comments,hasMore:!!r.nextPageToken||comments.length<(r.items??[]).length};
}

/** Explicit assistant discovery: one fresh bounded uploads page, never search by approximate name. */
export async function assistantChannelUploads(channel:{kind:'id'|'handle';value:string},continuation?:{token:string;expectedChannelId:string}){
 const query=channel.kind==='id'?{id:channel.value}:{forHandle:channel.value};
 const c=await yt('channels',{part:'snippet,contentDetails',...query},1);
 if(!Array.isArray(c.items)||c.items.length!==1)throw new ApiError('YT_NOT_FOUND','Канал не найден или недоступен.',404);
 const item=c.items[0],id=item?.id,title=item?.snippet?.title,playlist=item?.contentDetails?.relatedPlaylists?.uploads;
 if(typeof id!=='string'||!/^UC[\w-]{22}$/.test(id)||channel.kind==='id'&&id!==channel.value||typeof title!=='string'||!title.trim()||title.length>300||typeof playlist!=='string'||!/^UU[\w-]{22}$/.test(playlist))throw new ApiError('UPSTREAM','Некорректный ответ о канале; результаты не показаны.',502);
 if(continuation&&id!==continuation.expectedChannelId)throw new ApiError('UPSTREAM','Канал изменился с предыдущей страницы; загрузка остановлена до запроса списка.',409);
 const page=await yt('playlistItems',{part:'contentDetails',playlistId:playlist,maxResults:20,pageToken:continuation?.token},1);
 if(!Array.isArray(page.items)||page.items.length>20||page.nextPageToken!==undefined&&(typeof page.nextPageToken!=='string'||! /^[\x21-\x7e]{1,2000}$/.test(page.nextPageToken)||page.nextPageToken===continuation?.token))throw new ApiError('UPSTREAM','Некорректная страница загрузок.',502);
 const ids:string[]=page.items.map((x:any)=>x?.contentDetails?.videoId);
 if(ids.some(v=>typeof v!=='string'||! /^[\w-]{11}$/.test(v))||new Set(ids).size!==ids.length)throw new ApiError('UPSTREAM','Некорректный список ID роликов.',502);
 const videos=ids.length?await getVideos(ids):[];
 if(videos.length>ids.length||new Set(videos.map(v=>v.id)).size!==videos.length||videos.some(v=>!ids.includes(v.id)||v.channelId!==id||typeof v.title!=='string'||!v.title.trim()||v.title.length>300||typeof v.publishedAt!=='string'||v.publishedAt.length>50))throw new ApiError('UPSTREAM','Метаданные роликов не совпадают с каналом; результаты не показаны.',502);
 const byId=new Map(videos.map(v=>[v.id,v]));
 return {channel:{id,title},hasMore:!!page.nextPageToken,nextPageToken:page.nextPageToken??null,observedAt:new Date().toISOString(),videos:ids.map(videoId=>{const v=byId.get(videoId);return v?{id:videoId,status:'available' as const,title:v.title,publishedAt:v.publishedAt,views:v.viewsKnown===false?null:v.views,durationSec:v.durationKnown===false?null:v.durationSec}:{id:videoId,status:'unavailable' as const,title:'Метаданные недоступны',publishedAt:'',views:null,durationSec:null};})};
}

// Internal 2.1 adapter. Not exposed to clients: callers must first obtain
// explicit approval for the bounded API quota and reserve the attempt.
export async function brainstormUploadsAdapter() {
  const {createBrainstormUploadsAdapter} = await import('./studio/brainstormUploadsAdapter.js');
  return createBrainstormUploadsAdapter((path, params, units) => yt(path, params, units));
}
