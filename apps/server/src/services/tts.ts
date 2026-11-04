import { rethrowFinancial } from "../lib/errors.js";
import { checkCancelled, rethrowCancelled, taskSignal } from "../lib/taskContext.js";
import { log } from "../lib/logging.js";
import { defaultTtsModel } from "./languages.js";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import type { JobCtx } from "../lib/jobs.js";
import { dataPath } from "../lib/storage.js";
import { amCached, amSpeech, amVoices, hasAnymodel } from "./anymodel.js";
import { addArtifact, getProject, safe } from "./projects.js";
import { spokenText } from "./scriptCheck.js";
import { getSettings } from "./settings.js";
import { applyVoiceFx } from "./audioFx.js";
import { assertBudget } from "./usage.js";

export const TtsInput = z.object({
  language: z.string().max(5).optional(),
  text: z.string().min(1, "Нет текста для озвучки").max(120_000),
  model: z.string().max(160).optional(), // edge-tts/<voice> | fish-farm/…
  title: z.string().max(200).optional(),
  projectId: z.string().optional(),
  headings: z.boolean().default(false),
  actNames: z.array(z.string()).default([]),
  sourceArtifactId: z.string().optional(),
  sourceTextExpected: z.string().max(120_000).optional(), // локальная копия выбранной версии для проверки перед запросом
  /** 0.5–2.0, 1 — как есть (локально, FFmpeg) */
  speed: z.number().min(0.5).max(2).default(1),
  /** тон в полутонах: −6…+6 (вниз — басовитее, вверх — тоньше) */
  pitch: z.number().int().min(-6).max(6).default(0),
});
export type TtsInput = z.infer<typeof TtsInput>;

/** Текст сценария → чистая речь: без [VISUAL CUE], [[SCENE n]], [IMAGE n], [FACT-CHECK], markdown */
export function cleanForTts(script: string, o: { headings?: boolean; actNames?: string[] } = {}) {
  return spokenText(script, o)
    .replace(/\[\[SCENE \d+\]\]|\[IMAGE \d+\]|\[FACT-CHECK[^\]]*\]/gi, " ")
    .replace(/^#+\s*/gm, "").replace(/\*\*|__|`/g, "")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Куски ≤ max символов по границам абзацев/предложений */
export function chunkText(text: string, max = 1800) {
  const out: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
  for (const para of text.split(/\n{2,}/)) {
    const sents = para.split(/(?<=[.!?…])\s+/);
    for (let s of sents) {
      while (s.length > max) { const cut = s.lastIndexOf(" ", max) > max / 2 ? s.lastIndexOf(" ", max) : max; if (cur) push(); out.push(s.slice(0, cut).trim()); s = s.slice(cut); }
      if ((cur + " " + s).length > max) push();
      cur = cur ? `${cur} ${s}` : s;
    }
    if (cur.length > max * 0.7) push(); else if (cur) cur += "\n\n";
  }
  push();
  return out;
}

const BITRATES: Record<string, number[]> = {
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
};
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
/** Длительность MP3 (MPEG-1/2/2.5 Layer III) по кадрам; пропускает ID3 */
export function mp3Duration(b: Buffer) {
  let i = 0, sec = 0, frames = 0;
  if (b.length > 10 && b.toString("latin1", 0, 3) === "ID3") i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, br = (b[i + 2] >> 4) & 15, sr = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
    if (ver === 1 || layer !== 1 || br === 0 || br === 15 || sr === 3) { i++; continue; }
    const kbps = (ver === 3 ? BITRATES.v1 : BITRATES.v2)[br], rate = RATES[ver][sr];
    const spf = ver === 3 ? 1152 : 576;
    const len = Math.floor((spf / 8) * kbps * 1000 / rate) + pad;
    if (len < 4) { i++; continue; }
    sec += spf / rate; frames++; i += len;
  }
  return { seconds: Math.round(sec * 100) / 100, frames };
}

/** Стоимость в балансовых токенах: 50 × символов × коэффициент модели */
export const ttsTokens = (model: string, chars: number) => { const b = amCached(model)?.billing as { base_tokens?: number; coefficient?: { output?: number } } | undefined; return Math.ceil(chars * (b?.base_tokens ?? 50) * (b?.coefficient?.output ?? 1)); };

async function store(projectId: string | undefined, buf: Buffer, ext: string, prefix: string) {
  const pid = projectId ? safe(projectId) : "_audio";
  const name = `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}.${ext}`;
  const dir = dataPath("files", pid); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(`${dir}/${name}`, buf);
  return { url: `/files/${pid}/${name}`, bytes: buf.length };
}

export type VoiceProvenance = {
  schema: 1; checkedAt: string; mode: "project-script" | "manual"; inputSha256: string; spokenSha256: string;
  source?: { projectId: string; artifactId: string; title: string; version: number | null; createdAt: string; sourceSha256: string; match: "exact" | "modified" };
};
const sha256Text = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
/** Фиксируем проверенный источник и точный текст запроса до первого обращения к провайдеру. */
export async function resolveVoiceProvenance(i: TtsInput): Promise<VoiceProvenance> {
  if (!i.sourceArtifactId && i.sourceTextExpected !== undefined) throw new ApiError("VALIDATION", "Снимок текста передан без выбранной версии сценария.", 409);
  if (i.sourceArtifactId && !i.projectId) throw new ApiError("VALIDATION", "Для выбранного сценария нужен исходный проект. Выберите версию заново.", 409);
  const project = i.projectId ? await getProject(i.projectId) : null;
  const base: VoiceProvenance = { schema: 1, checkedAt: new Date().toISOString(), mode: "manual", inputSha256: sha256Text(i.text), spokenSha256: sha256Text(cleanForTts(i.text, i)) };
  if (!i.sourceArtifactId) return base;
  const hits = project!.artifacts.filter(a => a.id === i.sourceArtifactId);
  if (hits.length !== 1 || hits[0].kind !== "script") throw new ApiError("VALIDATION", "Выбранная версия сценария не найдена в проекте или неоднозначна. Проверьте выбор до запуска озвучки.", 409);
  const a = hits[0], data = a.data as { script?: unknown } | string | undefined;
  const text = typeof data === "string" ? data : data?.script;
  if (typeof text !== "string" || !text.trim()) throw new ApiError("VALIDATION", "В выбранной версии нет доступного текста сценария. Озвучка не запущена.", 409);
  if (i.sourceTextExpected === undefined || i.sourceTextExpected !== text) throw new ApiError("VALIDATION", "Выбранный сценарий изменился или не был проверен в форме. Обновите проект и выберите версию заново; озвучка не запущена.", 409);
  return { ...base, mode: "project-script", source: { projectId: project!.id, artifactId: a.id, title: a.title, version: typeof a.version === "number" ? a.version : null, createdAt: a.createdAt, sourceSha256: sha256Text(text), match: text === i.text ? "exact" : "modified" } };
}
export type AudioResult = { url: string; bytes: number; seconds: number; model: string; chars: number; chunks: number; segments: { n: number; start: number; end: number; text: string }[]; artifactId?: string; projectId?: string; title: string; balanceTokens: number | null; uploaded?: boolean; provenance?: VoiceProvenance };

async function speakWithFallback(model: string, text: string, language: string) {
  try { return { ...(await amSpeech(model, text)), model }; }
  catch (e) { rethrowCancelled(e); rethrowFinancial(e);
    const alt = model.startsWith("fish-farm/") && language === "ru" ? "edge-tts/ru-RU-DmitryNeural" : "";
    if (!alt || !(e instanceof ApiError) || !["UPSTREAM", "LLM_RATE_LIMIT"].includes(e.code)) throw e;
    log.warn({ event: "tts_fallback", model, alternative: alt, code: e.code });
    return { ...(await amSpeech(alt, text)), model: alt };
  }
}

export async function runTts(i: TtsInput, ctx?: JobCtx): Promise<AudioResult> {
  if (!hasAnymodel()) throw new ApiError("KEY_MISSING", "Для озвучки нужен ключ AnyModel (Настройки → Ключи API)", 400);
  const provenance = await resolveVoiceProvenance(i);
  await assertBudget();
  const s = await getSettings();
  const language = i.language || s.contentLanguage;
  let model = i.model || s.anymodel.tts;
  if (!i.model && model.startsWith("edge-tts/") && !model.toLowerCase().startsWith(`edge-tts/${language.toLowerCase()}-`)) {
    model = defaultTtsModel(language, model, await amVoices(language));
  }
  const text = cleanForTts(i.text, i);
  const chunks = chunkText(text, model.startsWith("fish-farm/") ? 1200 : 1800);
  if (!chunks.length) throw new ApiError("VALIDATION", "После очистки текст пуст", 400);
  const parts: Buffer[] = [];
  const segments: AudioResult["segments"] = [];
  let t = 0, used = model, tokens = 0;
  // Пачки по 3; общая очередь допускает только 1 TTS-запрос. Порядок сохраняется.
  const results: { audio: Buffer; model: string; balanceTokens:number|null }[] = new Array(chunks.length);
  let done = 0;
  for (let k = 0; k < chunks.length; k += 3) {
    checkCancelled(taskSignal(ctx?.signal));
    await Promise.all(chunks.slice(k, k + 3).map(async (c, j) => {
      const r = await speakWithFallback(model, c, language);
      results[k + j] = r; done++;
      ctx?.progress(`Озвучка: ${done} из ${chunks.length}`, Math.round((done / chunks.length) * 95));
    }));
  }
  results.forEach((r, n) => {
    const d = mp3Duration(r.audio).seconds;
    segments.push({ n: n + 1, start: Math.round(t * 100) / 100, end: Math.round((t + d) * 100) / 100, text: chunks[n] });
    t += d; parts.push(r.audio); used = r.model;
    const tk = r.balanceTokens; if(tk!==null)tokens += tk;
  });
  let buf: Buffer = Buffer.concat(parts);
  if (Math.abs(i.speed - 1) >= 0.01 || i.pitch) {
    ctx?.progress("Скорость и тон (FFmpeg)", 97);
    buf = await applyVoiceFx(buf, i.speed, i.pitch);
    const k = 1 / i.speed; t *= k; for (const sg of segments) { sg.start = Math.round(sg.start * k * 100) / 100; sg.end = Math.round(sg.end * k * 100) / 100; }
  }
  const title = i.title?.slice(0, 160) || text.slice(0, 60);
  checkCancelled(taskSignal(ctx?.signal));
  const f = await store(i.projectId, buf, "mp3", "voice");
  const res: AudioResult = { ...f, seconds: Math.round(t * 10) / 10, model: used, chars: text.length, chunks: chunks.length, segments, title, balanceTokens: results.every(r=>r.balanceTokens!==null) ? tokens : null, projectId: i.projectId, provenance };
  if (i.projectId) res.artifactId = (await addArtifact(i.projectId, { kind: "audio", title: `Озвучка · ${title}`.slice(0, 300), data: { ...res, sourceArtifactId: provenance.source?.match === "exact" ? provenance.source.artifactId : undefined }, files: [f.url.split("/").pop()!] })).id;
  ctx?.progress("Готово", 100);
  return res;
}

/** Короткий образец голоса (без сохранения) */
export async function previewVoice(model: string, text: string, speed = 1, pitch = 0) {
  if (!hasAnymodel()) throw new ApiError("KEY_MISSING", "Для озвучки нужен ключ AnyModel", 400);
  const t = text.slice(0, 300);
  const r = await amSpeech(model, t);

  if (Math.abs(speed - 1) >= 0.01 || pitch) return { ...r, audio: await applyVoiceFx(r.audio, speed, pitch), mime: "audio/mpeg" };
  return r;
}

const AUDIO_EXT: Record<string, string> = { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/ogg": "ogg", "audio/webm": "webm", "audio/flac": "flac", "audio/x-flac": "flac" };
/** Загрузка готовой озвучки (например, сделанной на anymodel.org или в другом сервисе) в проект */
export async function uploadAudio(o: { projectId: string; buf: Buffer; filename: string; mime: string; title?: string; seconds?: number }): Promise<AudioResult> {
  await getProject(o.projectId);
  const extFromName = (o.filename.match(/\.(mp3|wav|m4a|aac|ogg|webm|flac)$/i)?.[1] ?? "").toLowerCase();
  const ext = AUDIO_EXT[o.mime.split(";")[0].toLowerCase()] ?? extFromName;
  if (!ext) throw new ApiError("VALIDATION", "Поддерживаются аудиофайлы MP3, WAV, M4A, AAC, OGG, WEBM, FLAC", 400);
  if (o.buf.length < 1000) throw new ApiError("VALIDATION", "Файл пустой или повреждён", 400);
  const seconds = ext === "mp3" ? mp3Duration(o.buf).seconds : ext === "wav" ? wavDuration(o.buf) : (o.seconds ?? 0);
  const f = await store(o.projectId, o.buf, ext, "upload");
  const title = (o.title || o.filename.replace(/\.[^.]+$/, "")).slice(0, 160);
  const res: AudioResult = { ...f, seconds: Math.round(seconds * 10) / 10, model: "загружено", chars: 0, chunks: 1, segments: [], title, balanceTokens: 0, uploaded: true, projectId: o.projectId };
  res.artifactId = (await addArtifact(o.projectId, { kind: "audio", title: `Озвучка (файл) · ${title}`.slice(0, 300), data: { ...res, filename: o.filename }, files: [f.url.split("/").pop()!] })).id;
  return res;
}
export function wavDuration(b: Buffer) {
  if (b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WAVE") return 0;
  let i = 12, byteRate = 0;
  while (i + 8 <= b.length) {
    const id = b.toString("latin1", i, i + 4), size = b.readUInt32LE(i + 4);
    if (id === "fmt ") byteRate = b.readUInt32LE(i + 16);
    if (id === "data") return byteRate ? Math.round((Math.min(size, b.length - i - 8) / byteRate) * 100) / 100 : 0;
    i += 8 + size + (size & 1);
  }
  return 0;
}
