import { ApiError } from "../lib/errors.js";
import { fetchRetry } from "../lib/http.js";
import { checkCancelled, rethrowCancelled } from "../lib/taskContext.js";
import { parseJson3 } from "./transcriptText.js";
const fail = (s: string): never => { throw new ApiError("UPSTREAM", s + " Можно вставить текст или загрузить TXT/SRT/VTT вручную.", 502); };
const HOSTS = new Set(["www.youtube.com", "youtube.com", "m.youtube.com"]);
export function parseVideoId(input: string): string {
  const s = input.trim(); if (/^[\w-]{11}$/.test(s)) return s;
  let u: URL; try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { throw new ApiError("VALIDATION", "Вставьте ссылку YouTube или ID видео из 11 символов."); }
  if (u.protocol !== "https:" || u.username || u.password || u.port) throw new ApiError("VALIDATION", "Нужна обычная HTTPS-ссылка YouTube без авторизации и порта.");
  let id: string | null = null;
  if (u.hostname === "youtu.be" || u.hostname === "www.youtu.be") id = u.pathname.split("/")[1];
  else if (HOSTS.has(u.hostname)) {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else if (/^\/(shorts|live|embed)\//.test(u.pathname)) id = u.pathname.split("/")[2];
  }
  if (!id || !/^[\w-]{11}$/.test(id)) throw new ApiError("VALIDATION", "Не удалось распознать ссылку на видео YouTube (watch, youtu.be, shorts, live или embed).");
  return id;
}
export function assertYoutubeUrl(url: string, kind: "watch" | "captions") {
  const u = new URL(url);
  if (u.protocol !== "https:" || !HOSTS.has(u.hostname) || u.port || u.username || u.password || (kind === "watch" ? u.pathname !== "/watch" : u.pathname !== "/api/timedtext")) throw new ApiError("VALIDATION", "Неподдерживаемый адрес ответа YouTube; внешний адрес не будет открыт.");
  return u;
}
async function boundedText(r: Response, limit: number) {
  if (Number(r.headers.get("content-length")) > limit) { await r.body?.cancel(); fail("Ответ YouTube слишком большой."); }
  if (!r.body) fail("YouTube вернул пустой ответ.");
  const reader = r.body!.getReader(); const decoder = new TextDecoder(); let text = "", total = 0;
  try {
    while (true) {
      checkCancelled(); const { value, done } = await reader.read(); checkCancelled();
      if (done) break; total += value.byteLength;
      if (total > limit) fail("Ответ YouTube слишком большой.");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (e) { await reader.cancel().catch(() => {}); rethrowCancelled(e); throw e; }
  finally { reader.releaseLock(); }
}
async function youtubeText(url: string, kind: "watch" | "captions", limit: number): Promise<string> {
  let current = assertYoutubeUrl(url, kind);
  for (let i = 0; i < 4; i++) {
    checkCancelled();
    const r = await fetchRetry(current.href, { redirect: "manual", headers: { accept: kind === "watch" ? "text/html" : "application/json" } }, { retries: 1, timeoutMs: 20000 });
    if (r.status >= 300 && r.status < 400) {
      const location = r.headers.get("location"); await r.body?.cancel();
      if (!location) fail("YouTube вернул перенаправление без адреса.");
      current = assertYoutubeUrl(new URL(location!, current).href, kind); continue;
    }
    if (!r.ok) { await r.body?.cancel(); fail(`Субтитры недоступны: ответ YouTube HTTP ${r.status}.`); }
    return boundedText(r, limit);
  }
  return fail("Слишком много перенаправлений YouTube.");
}
/** Extract a balanced JSON object without evaluating any remote JavaScript. */
export function extractPlayer(html: string): any {
  const marker = /(?:\bytInitialPlayerResponse\s*=|window\[\s*["']ytInitialPlayerResponse["']\s*\]\s*=)\s*/g;
  let m: RegExpExecArray | null;
  while ((m = marker.exec(html))) {
    const begin = marker.lastIndex; if (html[begin] !== "{") continue;
    let depth = 0, quoted = false, escape = false;
    for (let i = begin; i < html.length; i++) {
      const c = html[i];
      if (quoted) { if (escape) escape = false; else if (c === "\\") escape = true; else if (c === '"') quoted = false; continue; }
      if (c === '"') quoted = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) { try { return JSON.parse(html.slice(begin, i + 1)); } catch { break; } }
    }
  }
  return fail("На странице не найден доступный ответ проигрывателя: возможно, изменился YouTube или нужен вход/согласие.");
}
export async function fetchYoutubeTranscript(input: string, language: string) {
  const id = parseVideoId(input), url = `https://www.youtube.com/watch?v=${id}`;
  const player = extractPlayer(await youtubeText(url, "watch", 8 * 1024 * 1024));
  checkCancelled();
  if (player.videoDetails?.videoId && player.videoDetails.videoId !== id) fail("YouTube вернул данные другого видео.");
  if (player.playabilityStatus?.status && player.playabilityStatus.status !== "OK") fail("Видео ограничено или недоступно без входа. Обход ограничений не выполняется.");
  const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || !tracks.length) fail("Доступные субтитры не найдены.");
  const available = [...new Set<string>(tracks.map((t: any) => t?.languageCode).filter((s: unknown) => typeof s === "string" && /^[a-zA-Z-]{2,35}$/.test(s as string)))];
  const matching = tracks.filter((t: any) => typeof t?.languageCode === "string" && (t.languageCode.toLowerCase() === language.toLowerCase() || t.languageCode.toLowerCase().split("-")[0] === language.toLowerCase()));
  matching.sort((a: any, b: any) => Number(a.kind === "asr") - Number(b.kind === "asr"));
  const track = matching[0];
  if (!track) fail(`Субтитров на выбранном языке «${language}» нет. Доступны: ${available.join(", ") || "неизвестно"}. Автоперевод не включается.`);
  if (typeof track.baseUrl !== "string") fail("Не найден адрес дорожки субтитров.");
  const trackUrl = assertYoutubeUrl(track.baseUrl, "captions");
  // Only direct caption tracks. Do not add translation, cookies, access tokens or bypass mechanisms.
  trackUrl.searchParams.set("fmt", "json3");
  let json: unknown;
  try { json = JSON.parse(await youtubeText(trackUrl.href, "captions", 4 * 1024 * 1024)); }
  catch (e) { rethrowCancelled(e); if (e instanceof ApiError) throw e; return fail("YouTube вернул пустую или неподдерживаемую дорожку субтитров."); }
  const parsed = parseJson3(json);
  if (track.kind === "asr") parsed.warnings.push("Автоматические субтитры: возможны ошибки распознавания, имён, чисел и пунктуации.");
  parsed.warnings.push("Получение публичных субтитров неофициальное и может перестать работать при изменениях YouTube. Текст не проверен по аудио.");
  return { ...parsed, source: { kind: "youtube" as const, url, videoId: id, title: String(player.videoDetails?.title ?? id).slice(0, 300), channel: String(player.videoDetails?.author ?? "").slice(0, 300), language: String(track.languageCode), automatic: track.kind === "asr", availableLanguages: available } };
}
