import { defaultTtsModel } from "../services/languages.js";
import { Hono } from "hono";
import { z } from "zod";
import { ok, fail } from "../lib/errors.js";
import { analyzeVoice, getVoiceProfile, passportPrompt, saveVoiceProfile } from "../services/channelVoice.js";

export const voiceRoute = new Hono();
voiceRoute.get("/voice-profile", async (c) => { try { const v = await getVoiceProfile(); return ok(c, { ...v, prompt: v.passport ? passportPrompt(v.passport) : "" }); } catch (e) { return fail(c, e); } });
voiceRoute.put("/voice-profile", async (c) => { try { const v = await saveVoiceProfile(await c.req.json()); return ok(c, { ...v, prompt: v.passport ? passportPrompt(v.passport) : "" }); } catch (e) { return fail(c, e); } });
/** Предпросмотр паспорта без сохранения */
voiceRoute.post("/voice-profile/analyze", async (c) => {
  try {
    const d = z.object({ samples: z.array(z.string().min(1).max(60000)).min(1).max(5), language: z.string().default("ru") }).parse(await c.req.json());
    const p = analyzeVoice(d.samples, d.language); return ok(c, { passport: p, prompt: passportPrompt(p) });
  } catch (e) { return fail(c, e); }
});

// ───── Озвучка (AnyModel TTS) и загрузка готового аудио ─────
import { startJob } from "../lib/jobs.js";
import { ApiError } from "../lib/errors.js";
import { TtsInput, runTts, previewVoice, uploadAudio, cleanForTts, chunkText, ttsTokens } from "../services/tts.js";
import { amVoices } from "../services/anymodel.js";
import { getSettings } from "../services/settings.js";

const TTS_MODELS = [{ model: "fish-farm/s2.1-pro-free", name: "Fish Audio S2.1 Pro — живой, эмоциональный", lang: "multi", gender: "—", provider: "fish-farm" }];
voiceRoute.get("/tts/voices", async (c) => {
  try {
    const lang = c.req.query("lang") || "ru";
    const edge = (await amVoices(lang)).map((v) => ({ model: v.model, name: v.name, lang: v.lang, gender: v.gender, provider: "edge-tts" }));
    return ok(c, { voices: [...TTS_MODELS, ...edge], selected: defaultTtsModel(lang, (await getSettings()).anymodel.tts, edge) });
  } catch (e) { return fail(c, e); }
});
/** Оценка без вызова: символы, куски, балансовые токены */
voiceRoute.post("/tts/estimate", async (c) => {
  try {
    const i = TtsInput.parse(await c.req.json());
    const model = i.model || (await getSettings()).anymodel.tts;
    const t = cleanForTts(i.text, i);
    const s = await getSettings();
    const tokens = ttsTokens(model, t.length);
    return ok(c, { chars: t.length, chunks: chunkText(t, model.startsWith("fish-farm/") ? 1200 : 1800).length, tokens, usd: tokens * s.anymodel.usdPerMillion / 1e6, text: t.slice(0, 400) });
  } catch (e) { return fail(c, e); }
});
voiceRoute.get("/tts/fx", async (c) => { const { ffmpegPath, resetFfmpeg } = await import("../services/audioFx.js"); if (!ffmpegPath()) resetFfmpeg(); return ok(c, { ffmpeg: !!ffmpegPath() }); });
voiceRoute.post("/tts/preview", async (c) => {
  try {
    const i = z.object({ model: z.string().min(3).max(160), text: z.string().min(1).max(300), speed: z.number().min(0.5).max(2).default(1), pitch: z.number().int().min(-6).max(6).default(0) }).parse(await c.req.json());
    const r = await previewVoice(i.model, i.text, i.speed, i.pitch);
    return new Response(new Uint8Array(r.audio), { headers: { "content-type": r.mime, "cache-control": "no-store" } });
  } catch (e) { return fail(c, e); }
});
voiceRoute.post("/tts", async (c) => {
  try { const i = TtsInput.parse(await c.req.json()); return ok(c, { jobId: startJob((ctx) => runTts(i, ctx)) }); } catch (e) { return fail(c, e); }
});
/** Готовая озвучка → проект. multipart: file, projectId, title?, seconds? */
voiceRoute.post("/tts/upload", async (c) => {
  try {
    const form = await c.req.formData();
    const file = form.get("file"), projectId = String(form.get("projectId") ?? "");
    if (!(file instanceof File)) throw new ApiError("VALIDATION", "Выберите аудиофайл", 400);
    if (!projectId) throw new ApiError("VALIDATION", "Выберите проект", 400);
    if (file.size > 300 * 1024 * 1024) throw new ApiError("VALIDATION", "Файл больше 300 МБ", 400);
    const r = await uploadAudio({ projectId, buf: Buffer.from(await file.arrayBuffer()), filename: file.name || "audio", mime: file.type || "", title: String(form.get("title") ?? "") || undefined, seconds: Number(form.get("seconds")) || undefined });
    return ok(c, r);
  } catch (e) { return fail(c, e); }
});
