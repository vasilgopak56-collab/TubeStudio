import { resolveVisualStyle } from "./visualStyles.js";
import { checkCancelled, rethrowCancelled, cancellation } from "../lib/taskContext.js";
/**
 * «Одна кнопка»: тема → сценарий (с живым голосом) → оценка → SEO → 3 обложки → раскадровка → озвучка → видео-черновик → Shorts.
 * Каждый этап — существующий сервис; результат сохраняется в проект. Паузы «проверь и продолжай» после выбранных этапов.
 * Состояние — data/pipelines/<id>.json: при ошибке или паузе конвейер можно продолжить с того же места.
 */
import crypto from "node:crypto";
import { z } from "zod";
import type { JobCtx } from "../lib/jobs.js";
import { readJson, writeJson } from "../lib/storage.js";
import { ApiError } from "../lib/errors.js";
import { getSettings } from "./settings.js";

export const STAGES = [
  ["script", "Сценарий"], ["rater", "Оценка сценария"], ["seo", "SEO"], ["thumbnail", "Обложки"],
  ["storyboard", "Раскадровка"], ["voice", "Озвучка"], ["video", "Видео-черновик"], ["shorts", "Shorts"],
] as const;
export type StageId = (typeof STAGES)[number][0];
const IDS = STAGES.map((s) => s[0]) as [StageId, ...StageId[]];

export const PipelineInput = z.object({
  topic: z.string().min(3, "Укажите тему").max(1000),
  hook: z.string().max(2000).optional(),
  niche: z.string().max(500).optional(),
  keywords: z.array(z.string().max(100)).max(20).default([]),
  language: z.string().max(5).optional(),
  words: z.number().int().min(60).max(8000).default(1500),
  style: z.string().max(60).default("universal"),
  visualStyleId: z.string().max(96).optional(),
  tone: z.enum(["serious", "ironic", "dramatic", "friendly"]).default("serious"),
  research: z.boolean().default(true),
  stages: z.array(z.enum(IDS)).min(1).default(["script", "rater", "seo", "thumbnail", "storyboard"]),
  pauseAfter: z.array(z.enum(IDS)).default(["script"]),
  voice: z.object({ model: z.string().max(160).optional(), speed: z.number().min(0.5).max(2).default(1), pitch: z.number().int().min(-6).max(6).default(0) }).prefault({}),
  video: z.object({ images: z.number().int().min(0).max(40).default(10), vertical: z.boolean().default(false), subtitles: z.boolean().default(true) }).prefault({}),
  projectId: z.string().optional(),
});
export type PipelineInputT = z.infer<typeof PipelineInput>;

export type StageState = { id: StageId; label: string; status: "pending" | "running" | "done" | "skipped" | "error"; startedAt?: string; endedAt?: string; summary?: string; error?: string; artifactId?: string };
export type Pipeline = {
  id: string; createdAt: string; updatedAt: string; input: PipelineInputT;
  status: "running" | "paused" | "done" | "error"; pausedAfter?: StageId;
  projectId?: string; title?: string; stages: StageState[];
  /** что нужно следующим этапам */
  data: { script?: string; scriptArtifactId?: string; title?: string; summary?: string; seoTitle?: string; audioUrl?: string; audioArtifactId?: string; storyboardArtifactId?: string; thumbUrls?: string[]; videoUrl?: string };
};

const file = (id: string) => `pipelines/${id.replace(/[^\w-]/g, "")}.json`;
export const loadPipeline = (id: string) => readJson<Pipeline | null>(file(id), null);
export const listPipelines = () => readJson<{ id: string; createdAt: string; title: string; status: Pipeline["status"]; projectId?: string }[]>("pipelines/index.json", []);
async function save(p: Pipeline) {
  p.updatedAt = new Date().toISOString();
  await writeJson(file(p.id), p);
  const idx = (await listPipelines()).filter((x) => x.id !== p.id);
  idx.unshift({ id: p.id, createdAt: p.createdAt, title: p.title ?? p.input.topic.slice(0, 120), status: p.status, projectId: p.projectId });
  await writeJson("pipelines/index.json", idx.slice(0, 50));
}

export async function createPipeline(input: PipelineInputT): Promise<Pipeline> {
  if (input.stages.includes("storyboard")) await resolveVisualStyle(input.visualStyleId);
  const st = await getSettings();
  const ordered = STAGES.filter(([id]) => input.stages.includes(id) || id === "script");
  const p: Pipeline = {
    id: crypto.randomUUID().slice(0, 8), createdAt: new Date().toISOString(), updatedAt: "", status: "running",
    input: { ...input, language: input.language || st.contentLanguage }, projectId: input.projectId,
    stages: ordered.map(([id, label]) => ({ id, label, status: "pending" })), data: {},
  };
  await save(p);
  return p;
}

type Runner = (p: Pipeline, ctx: JobCtx) => Promise<{ summary: string; artifactId?: string }>;
const need = (v: string | undefined, what: string) => { if (!v) throw new ApiError("VALIDATION", `Нет данных этапа «${what}» — запустите его заново`, 400); return v; };

const RUNNERS: Record<StageId, Runner> = {
  async script(p, ctx) {
    const { runScript } = await import("./script.js");
    const r = await runScript({ topic: p.input.topic, hook: p.input.hook, language: p.input.language!, unit: "words", value: p.input.words, style: p.input.style, tone: p.input.tone, research: p.input.research, headings: false, cta: true, visualCues: false, structure: "auto", humanize: true, channelVoice: true, projectId: p.projectId }, ctx);
    p.projectId = r.projectId; p.title = r.title;
    Object.assign(p.data, { script: r.script, scriptArtifactId: r.artifactId, title: r.title, summary: r.plan.core_question });
    return { summary: `«${r.title}» · ${r.check.metrics.words} слов · ≈ ${r.check.metrics.minutes} мин`, artifactId: r.artifactId };
  },
  async rater(p, ctx) {
    const { runRater } = await import("./rater.js");
    const r = await runRater({ script: need(p.data.script, "Сценарий"), niche: p.input.niche, language: p.input.language!, projectId: p.projectId }, ctx);
    return { summary: `${r.score}/100 — ${r.label}. Хук ${r.hook.score}/10` };
  },
  async seo(p, ctx) {
    const { runSeo } = await import("./seo.js");
    const r = await runSeo({ script: need(p.data.script, "Сценарий").slice(0, 20000), niche: p.input.niche, language: p.input.language!, projectId: p.projectId, keywords: p.input.keywords.length ? p.input.keywords : undefined }, ctx);
    p.data.seoTitle = r.titles[0]?.title;
    return { summary: `Ключ «${r.keyword}» · ${r.titles.length} заголовков · ${r.tags.length} тегов. Лучший: «${r.titles[0]?.title ?? "—"}»` };
  },
  async thumbnail(p, ctx) {
    const { runThumbnail } = await import("./thumbnail.js");
    const r = await runThumbnail({ title: (p.data.seoTitle || p.data.title || p.input.topic).slice(0, 200), summary: p.data.summary, language: p.input.language!, steps: {}, projectId: p.projectId } as any, ctx);
    const ok = r.variants.filter((v) => v.status === "done");
    p.data.thumbUrls = ok.map((v) => v.url!).filter(Boolean);
    if (!ok.length) throw new ApiError("UPSTREAM", r.variants.find((v) => v.error)?.error ?? "Обложки не сгенерировались", 502);
    return { summary: `${ok.length} из ${r.variants.length} обложек готовы`, artifactId: r.artifactId };
  },
  async storyboard(p, ctx) {
    const { runStoryboard } = await import("./storyboard.js");
    const r = await runStoryboard({ script: need(p.data.script, "Сценарий"), style: "universal", visualStyleId: p.input.visualStyleId, imageModel: "midjourney", videoModel: "kling", clip: 5, projectId: p.projectId } as any, ctx);
    p.data.storyboardArtifactId = r.artifactId;
    return { summary: `${r.rows.length} сцен · ≈ ${Math.round(r.totalSeconds / 60)} мин`, artifactId: r.artifactId };
  },
  async voice(p, ctx) {
    const { runTts } = await import("./tts.js");
    const r = await runTts({ language: p.input.language, text: need(p.data.script, "Сценарий"), model: p.input.voice.model, title: p.data.title, projectId: p.projectId, headings: false, actNames: [], sourceArtifactId: p.data.scriptArtifactId, speed: p.input.voice.speed, pitch: p.input.voice.pitch }, ctx);
    Object.assign(p.data, { audioUrl: r.url, audioArtifactId: r.artifactId });
    return { summary: `${Math.floor(r.seconds / 60)}:${String(Math.round(r.seconds % 60)).padStart(2, "0")} · ${r.model}`, artifactId: r.artifactId };
  },
  async video(p, ctx) {
    const { runDraft } = await import("./draft.js");
    const r = await runDraft({ projectId: need(p.projectId, "Сценарий"), images: p.input.video.images, vertical: p.input.video.vertical, subtitles: p.input.video.subtitles }, ctx);
    p.data.videoUrl = r.url;
    return { summary: `MP4 ${r.width}×${r.height} · ${Math.round(r.seconds)} с · ${r.scenes} сцен`, artifactId: r.artifactId };
  },
  async shorts(p, ctx) {
    const { runShorts } = await import("./shorts.js");
    const r = await runShorts({ projectId: need(p.projectId, "Сценарий"), count: 3, language: p.input.language }, ctx);
    return { summary: `${r.shorts.length} Shorts: ${r.shorts.map((s) => `«${s.title}»`).join(", ")}`.slice(0, 400), artifactId: r.artifactId };
  },
};

/** Выполнить этапы с первого незавершённого; пауза после этапов из pauseAfter */
export async function runPipeline(id: string, ctx: JobCtx, o: { skipCurrent?: boolean } = {}): Promise<Pipeline> {
  const p = await loadPipeline(id);
  if (!p) throw new ApiError("NOT_FOUND", "Конвейер не найден", 404);
  p.status = "running"; p.pausedAfter = undefined;
  if (o.skipCurrent) { const cur = p.stages.find((s) => s.status === "error" || s.status === "pending"); if (cur && cur.id !== "script") { cur.status = "skipped"; cur.error = undefined; } }
  await save(p); ctx.partial(p);
  const todo = p.stages.filter((s) => s.status === "pending" || s.status === "error" || s.status === "running");
  const total = p.stages.length;
  for (const s of todo) {
    if (ctx.signal.aborted) { s.status = s.status === "running" ? "pending" : s.status; p.status = "paused"; await save(p); throw cancellation(); }
    const idx = p.stages.indexOf(s);
    s.status = "running"; s.startedAt = new Date().toISOString(); s.error = undefined; await save(p); ctx.partial(p);
    const sub: JobCtx = { signal: ctx.signal, partial: () => {}, progress: (stage, pct) => ctx.progress(`${s.label}: ${stage}`, Math.round(((idx + Math.min(100, pct) / 100) / total) * 100)) };
    try {
      const r = await RUNNERS[s.id](p, sub);
      checkCancelled(ctx.signal);
      Object.assign(s, { status: "done", endedAt: new Date().toISOString(), summary: r.summary, artifactId: r.artifactId });
    } catch (e) {
      if (ctx.signal.aborted) { s.status = "pending"; p.status = "paused"; await save(p); throw cancellation(); }
      rethrowCancelled(e);
      Object.assign(s, { status: "error", endedAt: new Date().toISOString(), error: (e as Error).message?.slice(0, 500) || "Ошибка" });
      p.status = "error"; await save(p); ctx.partial(p);
      return p;
    }
    const last = p.stages.every((x) => x.status === "done" || x.status === "skipped");
    if (!last && p.input.pauseAfter.includes(s.id)) { p.status = "paused"; p.pausedAfter = s.id; await save(p); ctx.partial(p); return p; }
    await save(p); ctx.partial(p);
  }
  p.status = "done"; await save(p); ctx.progress("Готово", 100);
  return p;
}

/** Изменить параметры перед продолжением (например, выключить озвучку) */
export async function patchPipeline(id: string, patch: { stages?: StageId[]; pauseAfter?: StageId[] }) {
  const p = await loadPipeline(id); if (!p) throw new ApiError("NOT_FOUND", "Конвейер не найден", 404);
  if (patch.pauseAfter) p.input.pauseAfter = patch.pauseAfter;
  if (patch.stages) {
    const want = new Set<StageId>(["script", ...patch.stages]);
    const keep = p.stages.filter((s) => want.has(s.id) || s.status === "done");
    for (const [sid, label] of STAGES) if (want.has(sid) && !keep.some((k) => k.id === sid)) keep.push({ id: sid, label, status: "pending" });
    p.stages = STAGES.map(([sid]) => keep.find((k) => k.id === sid)).filter(Boolean) as StageState[];
    p.input.stages = [...want];
  }
  await save(p); return p;
}
/** Перезапустить этап (сценарий — заново всё, остальные — только сам этап) */
export async function rerunStage(id: string, stage: StageId) {
  const p = await loadPipeline(id); if (!p) throw new ApiError("NOT_FOUND", "Конвейер не найден", 404);
  const i = p.stages.findIndex((s) => s.id === stage); if (i < 0) throw new ApiError("VALIDATION", "Этапа нет в конвейере", 400);
  for (const s of stage === "script" ? p.stages : [p.stages[i]]) Object.assign(s, { status: "pending", summary: undefined, error: undefined, artifactId: undefined, startedAt: undefined, endedAt: undefined });
  await save(p); return p;
}
