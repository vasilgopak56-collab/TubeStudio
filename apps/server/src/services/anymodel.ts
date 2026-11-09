import { createHash } from "node:crypto";
import { paidDispatch, storyboardConsent } from "./paidDispatch.js";
import { taskContext, checkCancelled, taskSignal } from "../lib/taskContext.js";
import { queued } from "../lib/queue.js";
/** AnyModel (anymodel.org) — OpenAI-совместимый шлюз: один ключ на тексты, поиск, картинки и озвучку */
import {capturePrice,operationCost,type OperationVolume} from "./usagePricing.js";
import {recordOperation} from "./usage.js";
import { config } from "../config.js";
import { ApiError } from "../lib/errors.js";
import { fetchRetry, sleep } from "../lib/http.js";

export type AmBilling = { unit: string; base_tokens?: number; scales?: Record<string, Record<string, number>>; coefficient: { input: number; output: number } };
export type AmModel = { id: string; kind?: string; owned_by?: string; billing?: AmBilling; context_length?: number; capabilities?: { vision?: boolean; search?: boolean; reasoning?: boolean; audioInput?: boolean } };

const base = () => config.anymodelBase;
const auth = () => ({ authorization: `Bearer ${config.keys.anymodel}` });
export const hasAnymodel = () => !!config.keys.anymodel;

/** Ошибка AnyModel → ApiError (402/401 → KEY_MISSING, чтобы сработал резерв на прямые ключи) */
function amError(status: number, j: any, what: string): ApiError {
  const msg: string = j?.error?.message ?? `HTTP ${status}`;
  const code: string = j?.error?.code ?? "";
  if (status === 402) return new ApiError("KEY_MISSING", `AnyModel: закончился баланс — пополните на anymodel.org`, 402);
  if (status === 401) return new ApiError("KEY_MISSING", "AnyModel: ключ недействителен", 401);
  if (status === 403) return new ApiError("KEY_MISSING", `AnyModel: аккаунт не активен (${msg})`, 403);
  if (status === 429) return new ApiError("LLM_RATE_LIMIT", `AnyModel: слишком много запросов (${what})`, 429, true);
  if (status === 404 || code === "model_not_found") return new ApiError("UPSTREAM", `AnyModel: модель ${what} не найдена — проверьте имя в Настройках → AnyModel`, 400);
  if (code === "output_budget_exhausted") return new ApiError("UPSTREAM", `AnyModel: ${what} израсходовала лимит ответа на размышления`, 502, true);
  return new ApiError("UPSTREAM", `AnyModel (${what}): ${msg}`, status >= 500 ? 503 : 502, status >= 500);
}

// ───────── каталог (кэш 30 мин) ─────────
let catalog: { at: number; models: AmModel[] } | null = null;
let catalogGeneration = 0;
export const resetAmCatalog = () => { catalog = null; catalogGeneration++; };
export async function amCatalog(force = false): Promise<AmModel[]> {
  if (!hasAnymodel()) return [];
  if (!force && catalog && Date.now() - catalog.at < 30 * 60_000) return catalog.models;
  const generation = catalogGeneration;
  const r = await fetchRetry(`${base()}/models`, { headers: auth() }, { timeoutMs: 20_000, retries: 1 });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw amError(r.status, j, "каталог");
  const models: AmModel[] = j.data ?? [];
  if (catalogGeneration === generation) catalog = { at: Date.now(), models };
  return models;
}
/** Синхронный доступ к кэшу (для расчёта стоимости) */
export const amCached = (id: string) => catalog?.models.find((m) => m.id === id);
export const amCatalogFresh = () => !!catalog && Date.now()-catalog.at<30*60_000;
/** Age of the in-memory price catalog (Infinity when not loaded). */
export const amCatalogAge = () => catalog ? Date.now() - catalog.at : Infinity;

/**
 * Installed program only (not tests): keeps the price catalog warm with a free
 * metadata request, so the spending limit can check AnyModel tariffs instead of
 * stopping the first request after a launch, a key change or a sleep.
 * The paid dispatch itself still never fetches metadata.
 */
let warmTimer: NodeJS.Timeout | undefined, warming: Promise<unknown> | undefined;
export function refreshAmCatalogSoon() {
  if (!hasAnymodel() || warming) return;
  warming = amCatalog(true).catch(() => []).finally(() => { warming = undefined; });
}
export function startAmCatalogWarmup(checkEveryMs = 60_000, refreshAfterMs = 10 * 60_000) {
  if (warmTimer) return;
  const tick = () => { if (amCatalogAge() > refreshAfterMs) refreshAmCatalogSoon(); };
  setTimeout(tick, 1500).unref();
  warmTimer = setInterval(tick, checkEveryMs);
  warmTimer.unref();
}
const priceBefore=(model:string,kind:"text"|"image"|"tts"|"audio",o:{size?:string;quality?:string}={})=>capturePrice("anymodel",model,kind,amCached(model)?.billing,{...o,catalogFresh:amCatalogFresh()});

export async function amBalance(): Promise<{ balance: number; unlimited: boolean; status: string }> {
  const r = await fetchRetry(`${base()}/balance`, { headers: auth() }, { timeoutMs: 15_000, retries: 1 });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw amError(r.status, j, "баланс");
  return { balance: Number(j.balance ?? 0), unlimited: !!j.unlimited, status: String(j.status ?? "") };
}

/** Балансовые токены за текстовый вызов */
export function amTextTokens(model: string, input: number, output: number) {
  const c = amCached(model)?.billing?.coefficient ?? { input: 1, output: 1 };
  return Math.ceil(input * c.input + output * c.output);
}
/** Балансовые токены за картинку */
export function amImageTokens(model: string, size = "1024x1024", quality = "medium") {
  const b = amCached(model)?.billing;
  if (!b) return 100_000;
  const q = b.scales?.quality?.[quality] ?? 1, s = b.scales?.size?.[size] ?? 1;
  return Math.ceil((b.base_tokens ?? 100_000) * q * s * b.coefficient.output);
}

// ───────── текст ─────────
export type AmMsgImage = { mime: string; b64: string };
/** Объём текстового вызова. Ответ есть, а расход не сообщён: оценка с запасом (2 символа на токен), запись помечается как оценка.
 *  С картинками или без текста ответа оценить нельзя — операция остаётся неизвестной. */
function textVolume(usage: any, o: { system: string; user: string; images?: AmMsgImage[] }, reply: string): OperationVolume {
  // AnyModel иногда присылает нули при непустом ответе, хотя баланс списывается: это не бесплатный вызов.
  const known = Number.isFinite(usage?.prompt_tokens) && Number.isFinite(usage?.completion_tokens) && (usage.prompt_tokens + usage.completion_tokens > 0 || !reply.trim());
  if (known || o.images?.length || !reply.trim()) return { input: usage?.prompt_tokens ?? 0, output: usage?.completion_tokens ?? 0, known };
  return { input: Math.ceil((o.system.length + o.user.length) / 2), output: Math.ceil(reply.length / 2), known: true, estimated: true };
}
export const amChat = queued("llm", async function amChat(o: { model: string; system: string; user: string; images?: AmMsgImage[]; maxTokens?: number; temperature?: number; tools?: unknown[]; timeoutMs?: number; singleAttempt?: boolean }) {
  const content = o.images?.length
    ? [...o.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.b64}` } })), { type: "text", text: o.user }]
    : o.user;
  const url = `${base()}/chat/completions`;
  const headers={...auth(),"content-type":"application/json"};
  const body=JSON.stringify({model:o.model,max_tokens:o.maxTokens??8000,temperature:o.temperature??0.7,messages:[{role:"system",content:o.system},{role:"user",content}],...(o.tools?{tools:o.tools}:{})});
  const dispatch=paidDispatch(async()=>[await priceBefore(o.model,"text"),...(o.tools?.length?[await capturePrice("anymodel","web-search","search")]:[])],storyboardConsent(url,headers,body));
  const r = await fetchRetry(url,{method:"POST",headers,body}, { timeoutMs: o.timeoutMs ?? 240_000, retries: o.singleAttempt ? 0 : 1, beforeAttempt: dispatch.beforeAttempt });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw amError(r.ok ? 502 : r.status, j, o.model);
  const msg = j.choices?.[0]?.message;
  const text: string = typeof msg?.content === "string" ? msg.content : Array.isArray(msg?.content) ? msg.content.map((p: any) => p.text ?? "").join("") : "";
  await recordOperation(dispatch.prices[0],textVolume(j.usage,o,text),taskContext()?.jobId);
  if(dispatch.prices[1])await recordOperation(dispatch.prices[1],{count:j.usage?.web_search_requests??0,known:Number.isFinite(j.usage?.web_search_requests)},taskContext()?.jobId);
  if (!text.trim()) throw new ApiError("UPSTREAM", `AnyModel (${o.model}): пустой ответ (${j.choices?.[0]?.finish_reason ?? "?"})`, 502, true);
  const sources = (msg?.annotations ?? []).filter((a: any) => a.type === "url_citation").map((a: any) => ({ title: a.url_citation?.title ?? a.url_citation?.url, url: a.url_citation?.url }));
  return { text, usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0, searches: j.usage?.web_search_requests ?? 0 }, sources, finish: j.choices?.[0]?.finish_reason as string | undefined };
});

// ───────── картинки (асинхронно: background → опрос) ─────────
export const amImage = queued("image", async function amImage(o: { model: string; prompt: string; size: string; quality: string; refs?: AmMsgImage[]; signal?: AbortSignal }) {
  const dispatch=paidDispatch(()=>priceBefore(o.model,"image",o));
  const body = {
    model: o.model, prompt: o.prompt, n: 1, size: o.size, quality: o.quality, response_format: "b64_json", background: true,
    ...(o.refs?.length ? { images: o.refs.map((i) => `data:${i.mime};base64,${i.b64}`) } : {}),
  };
  const r = await fetchRetry(`${base()}/images/generations`, { method: "POST", headers: { ...auth(), "content-type": "application/json" }, body: JSON.stringify(body) }, { timeoutMs: 60_000, retries: 1, beforeAttempt: dispatch.beforeAttempt });
  let j: any = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 202) throw amError(r.status, j, o.model);
  const deadline = Date.now() + 330_000;
  while (!j.data) {
    if (!j.poll_url && !j.id) throw new ApiError("UPSTREAM", `AnyModel (${o.model}): неожиданный ответ`, 502);
    if (Date.now() > deadline) throw new ApiError("UPSTREAM", `AnyModel (${o.model}): картинка не готова за 5 минут`, 503, true);
    checkCancelled(taskSignal(o.signal));
    await sleep(4000);
    const url = j.poll_url ? new URL(j.poll_url, base().replace(/\/v1$/, "") + "/").toString() : `${base()}/images/generations/${j.id}`;
    const p = await fetchRetry(url, { headers: auth() }, { timeoutMs: 30_000, retries: 2 });
    const pj: any = await p.json().catch(() => ({}));
    if (p.status === 202) { j = { ...j, ...pj }; continue; }
    if (!p.ok) throw amError(p.status, pj, o.model);
    j = pj;
  }
  await recordOperation(dispatch.prices[0],{count:1,known:!!(j.data?.[0]?.b64_json||j.data?.[0]?.url)},taskContext()?.jobId);
  const d = j.data?.[0];
  if (d?.b64_json) return { b64: d.b64_json as string, mime: d.b64_json.startsWith("/9j/") ? "image/jpeg" : "image/png" };
  if (d?.url) { const img = await fetchRetry(d.url, {}, { timeoutMs: 60_000, retries: 1 }); return { b64: Buffer.from(await img.arrayBuffer()).toString("base64"), mime: img.headers.get("content-type") ?? "image/png" }; }
  throw new ApiError("UPSTREAM", `AnyModel (${o.model}): картинка не получена`, 502, true);
});

// ───────── озвучка ─────────
export type SpeechSafety = { beforeDispatch?: () => Promise<void>; singleAttempt?: boolean; maxAudioBytes?: number; onAudio?: (audio: Buffer, mime: string, balanceTokens: number|null) => Promise<void> };
export const amSpeech = queued("tts", async function amSpeech(model: string, input: string, safety: SpeechSafety = {}) {
  const dispatch=paidDispatch(()=>priceBefore(model,"tts"));
  const r = await fetchRetry(`${base()}/audio/speech`, { method: "POST", ...(safety.singleAttempt ? {redirect:"error" as const}:{}), headers: { ...auth(), "content-type": "application/json" }, body: JSON.stringify({ model, input }) }, { timeoutMs: 180_000, retries: safety.singleAttempt ? 0 : 1, beforeAttempt: async()=>{await dispatch.beforeAttempt();await safety.beforeDispatch?.();} });
  if (!r.ok) throw amError(r.status, await r.json().catch(() => ({})), model);
  let audio:Buffer;
  if(safety.maxAudioBytes){
    const max=safety.maxAudioBytes;
    if(Number(r.headers.get('content-length')||0)>max){await r.body?.cancel();throw new ApiError('UPSTREAM','Аудио превышает допустимый размер.',502);}
    const reader=r.body?.getReader();if(!reader)throw new ApiError('UPSTREAM','Нет аудиопотока.',502);
    const parts:Buffer[]=[];let size=0;
    try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>max)throw new ApiError('UPSTREAM','Аудио превышает допустимый размер.',502);parts.push(Buffer.from(next.value));}audio=Buffer.concat(parts);}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  }else audio=Buffer.from(await r.arrayBuffer());
  const volume={chars:input.length,known:true},balanceTokens=operationCost(dispatch.prices[0],volume).balanceTokens,mime=r.headers.get("content-type") ?? "audio/mpeg";
  // Save a fully received result before bookkeeping; accounting failure must not lose audio.
  let captureError:unknown;try{await safety.onAudio?.(audio,mime,balanceTokens);}catch(e){captureError=e;}
  const accountingRecorded=await recordOperation(dispatch.prices[0],volume,taskContext()?.jobId);
  if(captureError)throw captureError;
  return { audio, mime, balanceTokens, accountingRecorded };
});
export async function amVoices(lang?: string) {
  const r = await fetchRetry(`${base()}/audio/voices?provider=edge-tts${lang ? `&lang=${encodeURIComponent(lang)}` : ""}`, { headers: auth() }, { timeoutMs: 20_000, retries: 1 });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw amError(r.status, j, "голоса");
  return (j.data ?? []) as { id: string; name: string; lang: string; gender: string; model: string }[];
}

/** Audio input is sent only to catalog models that explicitly advertise audioInput. No automatic retry of a paid POST. */
export const amAudioChat = queued("llm", async function amAudioChat(o: { model: string; system: string; clips: { n: number; wav: Buffer }[]; signal?: AbortSignal }) {
  if (!hasAnymodel()) throw new ApiError("KEY_MISSING", "Для распознавания нужен ключ AnyModel в Настройках.", 400);
  const url = `${base()}/chat/completions`;
  const headers = { ...auth(), "content-type": "application/json" };
  const body = JSON.stringify({ model: o.model, temperature: 0, max_tokens: 6000, messages: [
      { role: "system", content: o.system },
      { role: "user", content: o.clips.flatMap(c => [{type:"text",text:`Audio fragment n=${c.n}:`}, {type:"input_audio",input_audio:{data:c.wav.toString("base64"),format:"wav"}}]) },
  ] });
  // Hash only; the provider key and audio bytes never enter the challenge or logs.
  const binding = createHash("sha256").update(JSON.stringify({url,headers,body})).digest("hex");
  const dispatch=paidDispatch(()=>priceBefore(o.model,"audio"),{contextHash:binding,message:`Подтвердите один запрос распознавания фрагмента №${o.clips.map(c=>c.n).join(", ")}. Точная сумма заранее неизвестна; согласие не ограничивает списание и не действует для других запросов или повторов.`});
  const r = await fetchRetry(url, {method:"POST", headers, signal:o.signal, body}, { timeoutMs: 180_000, retries: 0, beforeAttempt: dispatch.beforeAttempt });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw amError(r.status, j, o.model);
  await recordOperation(dispatch.prices[0],{input:j.usage?.prompt_tokens??0,output:j.usage?.completion_tokens??0,known:Number.isFinite(j.usage?.prompt_tokens)&&Number.isFinite(j.usage?.completion_tokens)},taskContext()?.jobId);
  const text = j.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new ApiError("UPSTREAM", "Пустой ответ аудиомодели.", 502);
  return { text, input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0 };
});
