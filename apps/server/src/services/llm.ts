import {PinnedModel,callCompatible,type Model} from './modelConnections.js';
import { rethrowFinancial } from "../lib/errors.js";
import { paidDispatch, storyboardConsent } from "./paidDispatch.js";
import { taskContext, rethrowCancelled } from "../lib/taskContext.js";
import { log } from "../lib/logging.js";
import { queued } from "../lib/queue.js";
import { z } from "zod";
import { config } from "../config.js";
import { ApiError } from "../lib/errors.js";
import { fetchRetry } from "../lib/http.js";
import { getSettings } from "./settings.js";
import {recordOperation} from "./usage.js";
import {capturePrice} from "./usagePricing.js";
import { assertBudget } from "./usage.js";
import { amCatalog, amChat, hasAnymodel } from "./anymodel.js";

export type LlmImage = { mime: string; b64: string };
export type LlmCall = { system: string; user: string; maxTokens?: number; temperature?: number; fast?: boolean; images?: LlmImage[]; role?: "script"; model?: string; singleAttempt?: boolean; /** Только указанная модель AnyModel: при сбое ошибка, резервная модель не запускается. */ noFallback?: boolean };
type Raw = { text: string; model: string };

const callAnthropic = queued("llm", async function callAnthropic(c: LlmCall, model: string): Promise<Raw> {
  const url="https://api.anthropic.com/v1/messages";
  const headers={"x-api-key":config.keys.anthropic,"anthropic-version":"2023-06-01","content-type":"application/json"};
  const body=JSON.stringify({model,max_tokens:c.maxTokens??8000,temperature:c.temperature??0.7,system:[{type:"text",text:c.system,cache_control:{type:"ephemeral"}}],messages:[{role:"user",content:c.images?.length?[...c.images.map(i=>({type:"image",source:{type:"base64",media_type:i.mime,data:i.b64}})),{type:"text",text:c.user}]:c.user}]});
  const dispatch=paidDispatch(()=>capturePrice("anthropic",model,"text"),storyboardConsent(url,headers,body));
  const r=await fetchRetry(url,{method:"POST",headers,body},{timeoutMs:180_000,retries:c.singleAttempt?0:2,beforeAttempt:dispatch.beforeAttempt});
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg: string = j?.error?.message ?? `HTTP ${r.status}`;
    if (/credit balance/i.test(msg)) throw new ApiError("KEY_MISSING", "Claude: на балансе нет кредитов", 402);
    if (r.status === 429) throw new ApiError("LLM_RATE_LIMIT", "Claude: превышен лимит запросов", 429, true);
    throw new ApiError("UPSTREAM", `Claude: ${msg}`, 502, r.status >= 500);
  }
  await recordOperation(dispatch.prices[0],{input:j.usage?.input_tokens??0,output:j.usage?.output_tokens??0,known:Number.isFinite(j.usage?.input_tokens)&&Number.isFinite(j.usage?.output_tokens)},taskContext()?.jobId);
  return { text: (j.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join(""), model };
});

const callGemini = queued("llm", async function callGemini(c: LlmCall, model: string, json: boolean): Promise<Raw> {
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const headers={"x-goog-api-key":config.keys.gemini,"content-type":"application/json"};
  const body=JSON.stringify({systemInstruction:{parts:[{text:c.system}]},contents:[{role:"user",parts:[...(c.images??[]).map(i=>({inline_data:{mime_type:i.mime,data:i.b64}})),{text:c.user}]}],generationConfig:{temperature:c.temperature??0.7,maxOutputTokens:c.maxTokens??8000,...(json?{responseMimeType:"application/json"}:{})}});
  const dispatch=paidDispatch(()=>capturePrice("gemini",model,"text"),storyboardConsent(url,headers,body));
  const r=await fetchRetry(url,{method:"POST",headers,body},{timeoutMs:180_000,retries:c.singleAttempt?0:1,beforeAttempt:dispatch.beforeAttempt});
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg: string = j?.error?.message ?? `HTTP ${r.status}`;
    if (r.status === 429) throw new ApiError("LLM_RATE_LIMIT", /limit: 0/.test(msg) ? `Gemini: модель ${model} недоступна на бесплатном тарифе` : "Gemini: превышен лимит запросов, попробуйте через минуту", 429, true);
    if (r.status === 503) throw new ApiError("UPSTREAM", "Gemini: модель перегружена, попробуйте позже", 503, true);
    throw new ApiError("UPSTREAM", `Gemini: ${msg}`, 502);
  }
  await recordOperation(dispatch.prices[0],{input:j.usageMetadata?.promptTokenCount??0,output:j.usageMetadata?.candidatesTokenCount??0,known:Number.isFinite(j.usageMetadata?.promptTokenCount)&&Number.isFinite(j.usageMetadata?.candidatesTokenCount)},taskContext()?.jobId);
  const cand = j.candidates?.[0];
  if (!cand?.content) throw new ApiError("UPSTREAM", `Gemini: пустой ответ (${cand?.finishReason ?? j.promptFeedback?.blockReason ?? "?"})`, 502, true);
  return { text: cand.content.parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join(""), model };
});

async function callAnymodel(c: LlmCall, model: string): Promise<Raw> {
  const r = await amChat({ model, system: c.system, user: c.user, images: c.images, maxTokens: c.maxTokens, temperature: c.temperature, singleAttempt: c.singleAttempt });
  await amCatalog().catch(() => []);

  return { text: r.text, model };
}

/** Порядок провайдеров с учётом настроек; при ошибке баланса/лимита — переход к следующему */
async function plan(fast?: boolean, role?: "script", model?: string) {
  const s = await getSettings();
  const a = config.keys.anthropic ? [{ p: "anthropic" as const, m: s.models.anthropic }] : [];
  const g = config.keys.gemini ? [{ p: "gemini" as const, m: fast ? s.models.geminiFast : s.models.gemini }, ...(fast ? [] : [{ p: "gemini" as const, m: "gemini-flash-latest" }, { p: "gemini" as const, m: s.models.geminiFast }])] : [];
  const am = hasAnymodel() && s.anymodel.enabled
    ? (fast ? [s.anymodel.fast, s.anymodel.text] : [model ?? "", role === "script" ? s.anymodel.script : "", s.anymodel.text, s.anymodel.textAlt]).filter((m, i, arr) => m && arr.indexOf(m) === i).map((m) => ({ p: "anymodel" as const, m }))
    : [];
  const direct = s.llmProvider === "gemini" ? [...g, ...a] : [...a, ...g];
  const order = s.anymodel.priority === "reserve" ? [...direct, ...am] : [...am, ...direct];
  if (!order.length) throw new ApiError("KEY_MISSING", "Нет ключа для генерации текста: задайте ANYMODEL_API_KEY (или резервные ANTHROPIC_API_KEY / GEMINI_API_KEY)", 400);
  return order;
}

/** Какая модель сработает первой для такого вызова (для окна цены). Резервные под ограничителем не запускаются. */
export async function firstModel(o: { fast?: boolean; role?: "script"; model?: string; noFallback?: boolean }): Promise<{ provider: string; model: string }> {
  const planned = await plan(o.fast, o.role, o.model);
  const steps = o.noFallback ? planned.filter((s) => s.p === "anymodel" && s.m === o.model) : planned;
  if (!steps.length) throw new ApiError("KEY_MISSING", `Модель ${o.model ?? ""} недоступна. Запрос не отправлен.`, 400);
  return { provider: steps[0].p, model: steps[0].m };
}
/** Модели веб-поиска Google: AnyModel с поиском или Gemini напрямую. */
export async function groundedModels(): Promise<{ provider: string; model: string; kind: "text" | "search" }[]> {
  const st = await getSettings();
  if (hasAnymodel() && st.anymodel.enabled && st.anymodel.search) return [{ provider: "anymodel", model: st.anymodel.search, kind: "text" }, { provider: "anymodel", model: "web-search", kind: "search" }];
  return config.keys.gemini ? [{ provider: "gemini", model: st.models.gemini, kind: "text" }, { provider: "gemini", model: st.models.gemini, kind: "search" }] : [];
}

/** Временно пропускаем модели без баланса / недоступные на тарифе, чтобы не терять время */
const skipUntil = new Map<string, number>();

async function raw(c: LlmCall, json: boolean): Promise<Raw> {
  let last: unknown;
  await assertBudget();
  const planned = await plan(c.fast, c.role, c.model);
  const steps = c.noFallback ? planned.filter((s) => s.p === "anymodel" && s.m === c.model).slice(0, 1) : planned;
  if (!steps.length) throw new ApiError("KEY_MISSING", `Модель ${c.model ?? ""} недоступна: проверьте ключ AnyModel и что он включён в Настройках. Другая модель не запускалась.`, 400);
  const live = steps.filter((s) => (skipUntil.get(`${s.p}:${s.m}`) ?? 0) < Date.now());
  for (const step of live.length ? live : steps) {
    try { return step.p === "anymodel" ? await callAnymodel(c, step.m) : step.p === "anthropic" ? await callAnthropic(c, step.m) : await callGemini(c, step.m, json); }
    catch (e) { rethrowCancelled(e); rethrowFinancial(e);
      last = e;
      if (!(e instanceof ApiError) || !["KEY_MISSING", "LLM_RATE_LIMIT", "UPSTREAM"].includes(e.code)) throw e;
      // A request that may already have been charged is never re-sent to another model.
      if ((e.details as { uncertain?: boolean } | undefined)?.uncertain) throw e;
      const k = `${step.p}:${step.m}`;
      if (e.code === "KEY_MISSING") skipUntil.set(k, Date.now() + 10 * 60_000);
      else if (/бесплатном тарифе/.test(e.message)) skipUntil.set(k, Date.now() + 60 * 60_000);
      else if (e.status === 503) skipUntil.set(k, Date.now() + 2 * 60_000);
      log.warn({ event: "llm_fallback", provider: step.p, model: step.m, code: e.code });
    }
  }
  throw last;
}

export const generateText = (c: LlmCall) => raw(c, false);

/** Assistant-only exact routing. Never enters plan(), skipUntil or automatic fallback. */
export async function generatePinnedText(c: LlmCall, selection: Model): Promise<Raw> {
  const chosen = PinnedModel.parse(selection);
  if(chosen.provider==='compatible')return callCompatible(c,chosen);
  if (!config.keys[chosen.provider]) throw new ApiError("KEY_MISSING", "Для выбранного провайдера нет ключа. Выберите подключённого провайдера; замена модели не выполнялась.");
  if (chosen.provider === "anymodel" && !(await getSettings()).anymodel.enabled) throw new ApiError("KEY_MISSING", "AnyModel выключен в Настройках. Другая модель не запускалась.");
  await assertBudget();
  const exact = {...c, singleAttempt:true};
  if (chosen.provider === "anthropic") return callAnthropic(exact,chosen.model);
  if (chosen.provider === "gemini") return callGemini(exact,chosen.model,false);
  const response = await amChat({model:chosen.model,system:c.system,user:c.user,maxTokens:c.maxTokens,temperature:c.temperature,singleAttempt:true});
  return {text:response.text,model:chosen.model};
}


export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(t); } catch {}
  const s = t.search(/[\[{]/); const e = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1));
  throw new Error("JSON не найден");
}

/** Генерация JSON по zod-схеме: до 2 повторов с текстом ошибки (generate → validate → fix) */
export async function generateJson<T>(c: LlmCall, schema: z.ZodType<T, unknown>, retries = 2): Promise<{ data: T; model: string }> {
  let user = c.user, lastErr = "";
  // Под ограничителем платного запуска неверный ответ не переспрашивается: каждый повтор — новый платный запрос.
  if (taskContext()?.paidLimit) retries = 0;
  for (let i = 0; i <= retries; i++) {
    const r = await raw({ ...c, user, system: `${c.system}\n\nReturn ONLY valid JSON. No markdown fences, no commentary.` }, true);
    try {
      const parsed = schema.safeParse(extractJson(r.text));
      if (parsed.success) return { data: parsed.data, model: r.model };
      lastErr = parsed.error.issues.slice(0, 8).map((x) => `${x.path.join(".")}: ${x.message}`).join("; ");
    } catch (e) { rethrowCancelled(e); rethrowFinancial(e); lastErr = (e as Error).message; }
    user = `${c.user}\n\nYour previous answer was invalid: ${lastErr}\nFix it and return the full corrected JSON.`;
  }
  throw new ApiError("LLM_INVALID_JSON", `Модель вернула некорректный ответ: ${lastErr}`, 502, true);
}

export { LANG_NAME } from "./languages.js";

/** Gemini + google_search grounding (на бесплатном тарифе обычно недоступно → бросает LLM_RATE_LIMIT) */
let groundingOffUntil = 0;
export async function geminiGrounded(system: string, user: string, maxTokens = 6000): Promise<{ text: string; model: string; sources: { title: string; url: string }[] }> {
  const st = await getSettings();
  if (hasAnymodel() && st.anymodel.enabled && st.anymodel.search) {
    try {
      await assertBudget();
      const r = await amChat({ model: st.anymodel.search, system, user, maxTokens, temperature: 0.3, tools: [{ google_search: {} }], timeoutMs: 150_000 });
      await amCatalog().catch(() => []);

      return { text: r.text, model: st.anymodel.search, sources: r.sources };
    } catch (e) { rethrowCancelled(e); rethrowFinancial(e);
      if (e instanceof ApiError && e.code === "BUDGET_LIMIT") throw e;
      log.warn({ event: "search_fallback", errorType: (e as Error).name });
    }
  }
  return directGrounded(system, user, maxTokens);
}
const directGrounded = queued("llm", async function directGrounded(system: string, user: string, maxTokens: number): Promise<{ text: string; model: string; sources: { title: string; url: string }[] }> {
  if (!config.keys.gemini) throw new ApiError("KEY_MISSING", "Нет GEMINI_API_KEY для веб-ресёрча", 400);
  if (groundingOffUntil > Date.now()) throw new ApiError("LLM_RATE_LIMIT", "Веб-поиск Gemini недоступен на текущем тарифе", 429);
  await assertBudget();
  const s = await getSettings();
  const model = s.models.gemini;
  const dispatch=paidDispatch(async()=>[await capturePrice("gemini",model,"text"),await capturePrice("gemini",model,"search")]);
  const r = await fetchRetry(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": config.keys.gemini, "content-type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens } }),
  }, { timeoutMs: 120_000, retries: 0, beforeAttempt: dispatch.beforeAttempt });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 429) { groundingOffUntil = Date.now() + 60 * 60_000; throw new ApiError("LLM_RATE_LIMIT", "Веб-поиск Gemini недоступен на текущем тарифе (нужен billing)", 429); }
    throw new ApiError("UPSTREAM", `Gemini search: ${j?.error?.message ?? r.status}`, 502);
  }
  const cand = j.candidates?.[0];
  await recordOperation(dispatch.prices[0],{input:j.usageMetadata?.promptTokenCount??0,output:j.usageMetadata?.candidatesTokenCount??0,known:Number.isFinite(j.usageMetadata?.promptTokenCount)&&Number.isFinite(j.usageMetadata?.candidatesTokenCount)},taskContext()?.jobId);
  await recordOperation(dispatch.prices[1],{count:1,known:false},taskContext()?.jobId);
  const sources = (cand?.groundingMetadata?.groundingChunks ?? []).map((c: any) => c.web).filter(Boolean).map((w: any) => ({ title: w.title ?? w.uri, url: w.uri }));
  return { text: (cand?.content?.parts ?? []).filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join(""), model, sources };
});
