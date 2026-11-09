// G-Labs Webhook (Выпуск 2, карточка 270): картинки и анимация программой G-Labs на этом компьютере.
// Порядок работы G-Labs: отправить задание → опрашивать статус каждые 3–5 с → сразу скачать файл.
// Задания G-Labs живут в памяти программы: после её перезапуска статус отвечает 404 — задание отправляется заново.
// Webhook работает только на тарифе MAX; ключ — во вкладке Webhook программы G-Labs.
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
import { ApiError } from "../../lib/errors.js";
import { checkCancelled, rethrowCancelled, taskSignal } from "../../lib/taskContext.js";
import { sleep } from "../../lib/http.js";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (url, init) => fetch(url, init);
/** Только для тестов. */
export function setGlabsFetcher(f: Fetcher | null) { fetcher = f ?? ((url, init) => fetch(url, init)); }
/** Интервал опроса статуса (G-Labs советует 3–5 с). */
export const GLABS_POLL = { ms: 4000 };

export const DEFAULT_GLABS_URL = "http://127.0.0.1:8765";
export async function glabsBase(): Promise<string> {
  const { getSettings } = await import("../settings.js");
  return ((await getSettings()).glabs?.url || DEFAULT_GLABS_URL).replace(/\/+$/, "");
}
/** G-Labs на этом же компьютере: эталоны передаются путём к файлу, без пересылки картинки. */
export function isLocalBase(base: string): boolean {
  try { const h = new URL(base).hostname.replace(/^\[|\]$/g, ""); return h === "127.0.0.1" || h === "localhost" || h === "::1"; } catch { return false; }
}
const key = () => {
  const k = config.keys.glabs;
  if (!k) throw new ApiError("KEY_MISSING", "Нет ключа G-Labs. Откройте G-Labs → вкладка Webhook, скопируйте API key и вставьте его в TubeStudio → Настройки → Ключи → G-Labs.", 400);
  return k;
};
const offline = (base: string) => new ApiError("GLABS_OFFLINE", `G-Labs не отвечает по адресу ${base}. Запустите G-Labs, откройте вкладку Webhook и нажмите Start (или включите Auto-start). Адрес меняется в Настройках → G-Labs.`, 502, true);

type Body = { error?: string; error_code?: string | number; [k: string]: unknown };
function toError(status: number, j: Body, what: string): ApiError {
  const msg = String(j.error ?? "").slice(0, 300);
  if (status === 401) return new ApiError("KEY_MISSING", "Ключ G-Labs не подходит. Скопируйте ключ заново во вкладке Webhook программы G-Labs и вставьте в Настройках → Ключи → G-Labs.", 400);
  if (status === 403) return /MAX/i.test(msg)
    ? new ApiError("GLABS_PLAN", "Webhook G-Labs работает только на тарифе MAX. Проверьте тариф в G-Labs.", 403)
    : new ApiError("UPSTREAM", `G-Labs: нет доступа (${msg || "403"})`, 403);
  if (status === 404 && /task/i.test(msg)) return new ApiError("GLABS_TASK_LOST", "G-Labs не помнит это задание — программа перезапускалась.", 404);
  if (status === 404) return new ApiError("NOT_FOUND", `G-Labs: ${msg || "не найдено"} (${what})`, 404);
  if (status === 413) return new ApiError("VALIDATION", "G-Labs: запрос больше 50 МБ — уменьшите эталоны.", 413);
  if (status === 400 || status === 409 || status === 422) return new ApiError("VALIDATION", `G-Labs отклонил запрос: ${msg || status}${j.error_code ? ` (${j.error_code})` : ""}`, status === 409 ? 409 : 400, false, { glabsCode: j.error_code });
  return new ApiError("UPSTREAM", `G-Labs ответил ошибкой ${status}${msg ? `: ${msg}` : ""}`, 502, status >= 500);
}

/** Запрос к G-Labs. Чтение повторяется при коротком сбое; отправка задания — нет (оно могло уйти). */
async function call<T = any>(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", p: string, body?: unknown, o: { auth?: boolean; safe?: boolean; base?: string; timeoutMs?: number } = {}): Promise<T> {
  const base = o.base ?? await glabsBase();
  const headers: Record<string, string> = { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(o.auth === false ? {} : { "X-API-Key": key() }) };
  const safe = o.safe ?? method === "GET";
  for (let attempt = 0; ; attempt++) {
    const signal = taskSignal();
    checkCancelled(signal);
    let res: Response;
    try {
      res = await fetcher(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(o.timeoutMs ?? 60_000), ...(signal ? [signal] : [])]) });
    } catch (e) {
      rethrowCancelled(e, signal);
      if (safe && attempt < 1) { await sleep(1500, signal); continue; }
      throw offline(base);
    }
    const j: Body = await res.json().catch(() => ({}));
    if (res.ok) return j as T;
    if (safe && attempt < 1 && res.status >= 500) { await sleep(1500, signal); continue; }
    throw toError(res.status, j, p);
  }
}

export type GlabsHealth = { status?: string; server?: string; uptime?: number; tasks_pending?: number; tasks_running?: number };
/** Проверка связи: адрес отвечает, ключ подходит, тариф MAX. Никогда не бросает ошибку. */
export async function checkGlabs(): Promise<{ ok: boolean; base: string; message: string; code?: string; health?: GlabsHealth; local: boolean }> {
  const base = await glabsBase();
  const local = isLocalBase(base);
  let health: GlabsHealth;
  try { health = await call<GlabsHealth>("GET", "/api/health", undefined, { auth: false, base, timeoutMs: 8000 }); }
  catch (e) { rethrowCancelled(e); return { ok: false, base, local, code: (e as ApiError).code ?? "GLABS_OFFLINE", message: (e as Error).message }; }
  if (!config.keys.glabs) return { ok: false, base, local, health, code: "KEY_MISSING", message: "G-Labs запущен, но в TubeStudio нет ключа: скопируйте API key во вкладке Webhook и вставьте в Настройках → Ключи → G-Labs." };
  try { await call("GET", "/api/tasks", undefined, { base, timeoutMs: 8000 }); }
  catch (e) { rethrowCancelled(e); return { ok: false, base, local, health, code: (e as ApiError).code, message: (e as Error).message }; }
  const busy = (health.tasks_pending ?? 0) + (health.tasks_running ?? 0);
  return { ok: true, base, local, health, message: `G-Labs на связи${busy ? ` · в работе заданий: ${busy}` : ""}${local ? "" : " · другой компьютер: эталоны отправляются картинкой"}` };
}

export type GlabsRef = { path: string } | { data: string; name: string };
/** Эталон для запроса: путь к файлу (G-Labs на этом ПК) или сама картинка (G-Labs на другом ПК).
 *  Имя файла = @имя в промпте: G-Labs привязывает эталон по совпадению имени. */
export async function glabsRef(absPath: string, local: boolean): Promise<GlabsRef> {
  if (local) return { path: path.resolve(absPath) };
  const buf = await fs.readFile(absPath);
  const ext = path.extname(absPath).slice(1).toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  return { data: `data:${mime};base64,${buf.toString("base64")}`, name: path.basename(absPath) };
}

export type ImageRequest = { prompt: string; model: string; aspect_ratio: string; reference_images?: GlabsRef[]; use_characters?: boolean; auto_fix_prompt?: boolean };
export type VideoRequest = { prompt: string; model: string; aspect_ratio: string; mode: "start_image" | "text_to_video"; reference_images?: GlabsRef[]; resolution?: string[]; video_length?: number; use_characters?: boolean; auto_fix_prompt?: boolean };
const taskIdOf = (j: { task_id?: unknown }) => {
  const id = String(j?.task_id ?? "");
  if (!/^[\w-]{4,64}$/.test(id)) throw new ApiError("UPSTREAM", "G-Labs не вернул номер задания", 502);
  return id;
};
export async function submitImage(r: ImageRequest, base?: string): Promise<string> {
  return taskIdOf(await call("POST", "/api/image/generate", { use_characters: false, auto_fix_prompt: true, ...r }, { base, timeoutMs: 120_000 }));
}
export async function submitVideo(r: VideoRequest, base?: string): Promise<string> {
  return taskIdOf(await call("POST", "/api/video/generate", { use_characters: false, auto_fix_prompt: true, resolution: ["1080p"], ...r }, { base, timeoutMs: 120_000 }));
}

export type GlabsTask = { task_id: string; status: "pending" | "running" | "completed" | "failed" | string; results?: string[]; error_code?: number; error?: string; error_detail?: string; final_prompt?: string; prompt_rewrites?: number };
export async function getTask(id: string, base?: string): Promise<GlabsTask> {
  return call<GlabsTask>("GET", `/api/status/${encodeURIComponent(id)}`, undefined, { base, timeoutMs: 20_000 });
}
/** Остановить задания в G-Labs (при «Остановить» в TubeStudio), ошибки не важны. */
export async function stopTasks(ids: string[], base?: string) {
  await Promise.all(ids.map((id) => call("POST", `/api/stop/${encodeURIComponent(id)}`, {}, { base, safe: true, timeoutMs: 8000 }).catch(() => null)));
}

/** Причина неудачи задания → что делать дальше. */
export type FailKind = "quota" | "accounts" | "session" | "stopped" | "policy" | "path" | "upstream" | "other";
export function failKind(t: Pick<GlabsTask, "error_code" | "error" | "error_detail">): FailKind {
  const code = Number(t.error_code ?? 0), text = `${t.error ?? ""} ${t.error_detail ?? ""}`;
  if (/reference path not found/i.test(text)) return "path";
  if (code === 429 || /quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(text)) return "quota";
  if (code === 499 || /STOPPED_BY_CLIENT/i.test(text)) return "stopped";
  if (/no (active|enabled|usable)? ?\w* ?accounts?|NO_\w*ACCOUNT|ALL_ACCOUNTS_FAILED/i.test(text)) return "accounts";
  if (code === 401 || code === 403 || /PERMISSION_DENIED|cookie|session/i.test(text)) return "session";
  if (code === 400 || /policy|INVALID_ARGUMENT|blocked|celebrity|sensitive/i.test(text)) return "policy";
  if (code >= 500 || /timeout|timed out|no result/i.test(text)) return "upstream";
  return "other";
}
export function failText(t: Pick<GlabsTask, "error_code" | "error" | "error_detail">): string {
  const k = failKind(t), why = String(t.error || t.error_detail || "").slice(0, 240);
  switch (k) {
    case "quota": return `Квота аккаунтов G-Labs на сегодня исчерпана${why ? ` (${why})` : ""}. Продолжите позже — готовое сохранено.`;
    case "accounts": return "В G-Labs нет включённых аккаунтов Google для этой работы. Включите аккаунт в G-Labs и нажмите «Продолжить».";
    case "session": return `G-Labs: аккаунт вышел из системы или нет доступа${why ? ` (${why})` : ""}. Войдите в аккаунт в G-Labs и нажмите «Продолжить».`;
    case "stopped": return "Задание остановлено.";
    case "policy": return `G-Labs отклонил промпт${why ? `: ${why}` : ""}. Измените описание кадра и сделайте снова.`;
    case "path": return "G-Labs не нашёл файл эталона на диске.";
    case "upstream": return `Сбой генерации в G-Labs${why ? `: ${why}` : ""}.`;
    default: return `G-Labs не сделал файл${why ? `: ${why}` : ""}.`;
  }
}

/** Скачать результат: ссылка G-Labs переписывается на настроенный адрес (G-Labs может назвать другой IP). */
export async function downloadResult(url: string, base?: string): Promise<Buffer> {
  const b = base ?? await glabsBase();
  let target = url;
  try { const u = new URL(url, b); target = u.pathname.startsWith("/api/files/") ? `${b}${u.pathname}${u.search}` : u.toString(); } catch { /* относительная ссылка */ }
  if (!target.startsWith(b)) throw new ApiError("UPSTREAM", "G-Labs вернул ссылку на файл вне своего адреса", 502);
  const signal = taskSignal();
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try { res = await fetcher(target, { headers: config.keys.glabs ? { "X-API-Key": config.keys.glabs } : {}, signal: AbortSignal.any([AbortSignal.timeout(300_000), ...(signal ? [signal] : [])]) }); }
    catch (e) { rethrowCancelled(e, signal); if (attempt < 2) { await sleep(2000, signal); continue; } throw offline(b); }
    if (!res.ok) { if (attempt < 2 && res.status >= 500) { await sleep(2000, signal); continue; } throw new ApiError("UPSTREAM", `Файл из G-Labs не скачался (HTTP ${res.status}). Сделайте сцену снова.`, 502, true); }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) throw new ApiError("UPSTREAM", "G-Labs отдал пустой файл", 502, true);
    return buf;
  }
}

// ---------- библиотека персонажей G-Labs (§5.8) ----------
export type GlabsCharacter = { name: string; character_id?: string; has_image?: boolean; personality_notes?: string };
export async function listCharacters(base?: string): Promise<GlabsCharacter[]> {
  const j = await call<{ characters?: GlabsCharacter[] }>("GET", "/api/characters", undefined, { base });
  return Array.isArray(j.characters) ? j.characters : [];
}
/** Добавить или обновить персонажа: имя = @тег в G-Labs. */
export async function upsertCharacter(name: string, image: GlabsRef, notes: string, base?: string): Promise<"created" | "updated"> {
  const img = "path" in image ? { path: image.path } : { data: image.data, name: image.name };
  try { await call("POST", "/api/characters", { name, image: img, personality_notes: notes.slice(0, 4000) }, { base }); return "created"; }
  catch (e) {
    if (!(e instanceof ApiError) || e.status !== 409) throw e;
    await call("PATCH", `/api/characters/${encodeURIComponent(name)}`, { image: img, personality_notes: notes.slice(0, 4000) }, { base });
    return "updated";
  }
}

/** Download a generated image only from G-Labs' file route, without redirects.
 * This read-only operation can be retried; generation is never repeated here. */
export async function downloadBrandImage(url:string,base:string):Promise<Buffer>{
  let u:URL,b:URL;try{b=new URL(base);u=new URL(url,b);}catch{throw new ApiError('UPSTREAM','G-Labs вернул некорректный адрес картинки.',502);}
  if(!/^https?:$/.test(b.protocol)||b.username||b.password||!u.pathname.startsWith('/api/files/')||u.username||u.password||u.hash)throw new ApiError('UPSTREAM','G-Labs вернул неподдерживаемый адрес картинки.',502);
  // Some G-Labs installations return a different LAN host; only its file path is used.
  const target=new URL(u.pathname+u.search,b.origin),signal=taskSignal(),limit=25*1024*1024;checkCancelled(signal);
  let res:Response;try{res=await fetcher(target.toString(),{headers:config.keys.glabs?{'X-API-Key':config.keys.glabs}:{},redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(120_000),...(signal?[signal]:[])])});}catch(e){rethrowCancelled(e,signal);throw offline(base);}
  if(!res.ok)throw new ApiError('UPSTREAM',`Не удалось скачать картинку G-Labs (HTTP ${res.status}). Можно повторить скачивание без повторной генерации.`,502,true);
  const announced=Number(res.headers.get('content-length'));if(Number.isFinite(announced)&&announced>limit){await res.body?.cancel().catch(()=>{});throw new ApiError('VALIDATION','Картинка превышает 25 МиБ; она не сохранена.',413);}
  if(!res.body)throw new ApiError('UPSTREAM','G-Labs вернул пустую картинку.',502);const reader=res.body.getReader(),chunks:Buffer[]=[];let size=0;
  try{for(;;){checkCancelled(signal);const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel().catch(()=>{});throw new ApiError('VALIDATION','Картинка превышает 25 МиБ; она не сохранена.',413);}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  if(size<100)throw new ApiError('UPSTREAM','G-Labs вернул пустую картинку.',502);return Buffer.concat(chunks,size);
}
