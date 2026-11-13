import { rethrowFinancial } from "../lib/errors.js";
import { paidDispatch } from "./paidDispatch.js";
import { taskContext, checkCancelled, rethrowCancelled } from "../lib/taskContext.js";
import { log } from "../lib/logging.js";
import { queued } from "../lib/queue.js";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { config } from "../config.js";
import { ApiError } from "../lib/errors.js";
import { fetchRetry, PAID_MODEL_TIMEOUT_MS } from "../lib/http.js";
import { dataPath } from "../lib/storage.js";
import { getSettings } from "./settings.js";
import {capturePrice} from "./usagePricing.js";
import {recordOperation, assertBudget } from "./usage.js";
import { safe } from "./projects.js";
import { amCatalog, amImage, hasAnymodel } from "./anymodel.js";

export type GenImage = { b64: string; mime: string; model: string; provider: "anymodel" | "openai" | "gemini" };

export type RefImage = { mime: string; b64: string };

const openai = queued("image", async function openai(prompt: string, model: string, size: string, refs: RefImage[] = []): Promise<GenImage> {
  const dispatch=paidDispatch(()=>capturePrice("openai",model,"image"));
  let r: Response;
  if (refs.length) { // правка / референс → /images/edits (multipart)
    const fd = new FormData(); fd.append("model", model); fd.append("prompt", prompt); fd.append("size", size); fd.append("n", "1");
    refs.forEach((im, i) => fd.append("image[]", new Blob([Buffer.from(im.b64, "base64")], { type: im.mime }), `ref${i}.${im.mime.includes("png") ? "png" : "jpg"}`));
    r = await fetchRetry("https://api.openai.com/v1/images/edits", { method: "POST", headers: { authorization: `Bearer ${config.keys.openai}` }, body: fd }, { timeoutMs: PAID_MODEL_TIMEOUT_MS, retries: 1, beforeAttempt: dispatch.beforeAttempt });
  } else r = await fetchRetry("https://api.openai.com/v1/images/generations", { method: "POST", headers: { authorization: `Bearer ${config.keys.openai}`, "content-type": "application/json" }, body: JSON.stringify({ model, prompt, size, n: 1 }) }, { timeoutMs: PAID_MODEL_TIMEOUT_MS, retries: 1, beforeAttempt: dispatch.beforeAttempt });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message ?? `HTTP ${r.status}`;
    if (r.status === 429 || /quota|billing/i.test(msg)) throw new ApiError("LLM_RATE_LIMIT", `OpenAI: ${msg}`, 429);
    if (r.status === 404 || /model/i.test(msg)) throw new ApiError("UPSTREAM", `OpenAI: модель ${model} недоступна — проверьте имя в Настройках (${msg})`, 400);
    throw new ApiError("UPSTREAM", `OpenAI: ${msg}`, 502);
  }
  await recordOperation(dispatch.prices[0],{count:1,known:!!(j.data?.[0]?.b64_json||j.data?.[0]?.url)},taskContext()?.jobId);
  const d = j.data?.[0];
  if (d?.b64_json) return { b64: d.b64_json, mime: "image/png", model, provider: "openai" };
  if (d?.url) { const img = await fetchRetry(d.url, {}, { timeoutMs: 60_000, retries: 1 }); return { b64: Buffer.from(await img.arrayBuffer()).toString("base64"), mime: img.headers.get("content-type") ?? "image/png", model, provider: "openai" }; }
  throw new ApiError("UPSTREAM", "OpenAI: пустой ответ", 502);
});

const gemini = queued("image", async function gemini(prompt: string, model: string, aspect: string, refs: RefImage[] = []): Promise<GenImage> {
  const dispatch=paidDispatch(()=>capturePrice("gemini",model,"image"));
  const r = await fetchRetry(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "x-goog-api-key": config.keys.gemini, "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [...refs.map((im) => ({ inlineData: { mimeType: im.mime, data: im.b64 } })), { text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: aspect } } }) }, { timeoutMs: PAID_MODEL_TIMEOUT_MS, retries: 1, beforeAttempt: dispatch.beforeAttempt });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg: string = j?.error?.message ?? `HTTP ${r.status}`;
    if (r.status === 429) throw new ApiError("LLM_RATE_LIMIT", /quota|billing|limit: 0/i.test(msg) ? `Gemini: генерация картинок (${model}) недоступна на бесплатном тарифе — подключите billing в Google AI Studio или выберите OpenAI в Настройках` : "Gemini: превышен лимит, попробуйте позже", 429);
    throw new ApiError("UPSTREAM", `Gemini: ${msg}`, 502);
  }
  await recordOperation(dispatch.prices[0],{count:1,known:!!j.candidates?.[0]?.content?.parts?.some((p:any)=>p.inlineData?.data||p.inline_data?.data)},taskContext()?.jobId);
  const part = j.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData || p.inline_data);
  const data = part?.inlineData ?? part?.inline_data;
  if (!data?.data) throw new ApiError("UPSTREAM", `Gemini: картинка не получена (${j.candidates?.[0]?.finishReason ?? "?"})`, 502);
  return { b64: data.data, mime: data.mimeType ?? data.mime_type ?? "image/png", model, provider: "gemini" };
});

/** Генерация изображения: AnyModel (основная + запасная модель) → прямые OpenAI / Gemini; 16:9 по умолчанию */
export async function generateImage(prompt: string, o: { aspect?: "16:9" | "1:1" | "9:16"; provider?: "openai" | "gemini"; refs?: RefImage[] } = {}): Promise<GenImage> {
  const s = await getSettings();
  const aspect = o.aspect ?? "16:9";
  await assertBudget();
  const clean = prompt.replace(/\s--\w+(\s+[\w.:]+)?/g, "").trim(); // параметры Midjourney не нужны
  const size = aspect === "16:9" ? "1536x1024" : aspect === "9:16" ? "1024x1536" : "1024x1024";

  const am = hasAnymodel() && s.anymodel.enabled ? [s.anymodel.image, s.anymodel.imageAlt].filter((m, i, a) => m && a.indexOf(m) === i) : [];
  const direct: ("openai" | "gemini")[] = [];
  const pref = o.provider ?? s.imageProvider;
  for (const p of [pref, pref === "openai" ? "gemini" : "openai"] as const) if (config.keys[p]) direct.push(p);
  type Step = { kind: "am"; model: string } | { kind: "openai" | "gemini" };
  const amSteps: Step[] = am.map((model) => ({ kind: "am", model }));
  const dSteps: Step[] = direct.map((kind) => ({ kind }));
  const steps = s.anymodel.priority === "reserve" ? [...dSteps, ...amSteps] : [...amSteps, ...dSteps];
  if (!steps.length) throw new ApiError("KEY_MISSING", "Для генерации картинок нужен ANYMODEL_API_KEY (или резервные OPENAI_API_KEY / GEMINI_API_KEY)", 400);

  let last: unknown;
  for (const st of steps) {
    try {
      if (st.kind === "am") {
        const r = await amImage({ model: st.model, prompt: clean, size, quality: s.anymodel.imageQuality, refs: o.refs });
        await amCatalog().catch(() => []);

        return { ...r, model: st.model, provider: "anymodel" };
      }
      const img = st.kind === "openai" ? await openai(clean, s.models.openaiImage, size, o.refs) : await gemini(clean, s.models.geminiImage, aspect, o.refs);

      return img;
    } catch (e) { rethrowCancelled(e); rethrowFinancial(e);
      last = e;
      if (!(e instanceof ApiError) || e.message === "Отменено") throw e;
      log.warn({ event: "image_fallback", provider: st.kind, code: e.code });
    }
  }
  throw last;
}

/** Сохраняет картинку в data/files/<projectId>/ и возвращает относительный путь /files/... */
export async function saveImage(projectId: string, img: GenImage, prefix = "img") {
  checkCancelled();
  const ext = img.mime.includes("jpeg") ? "jpg" : img.mime.includes("webp") ? "webp" : "png";
  const name = `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}.${ext}`;
  const dir = dataPath("files", safe(projectId)); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(`${dir}/${name}`, Buffer.from(img.b64, "base64"));
  return { name, url: `/files/${safe(projectId)}/${name}` };
}
