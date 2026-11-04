// ───── Производство: «Одна кнопка», видео-черновик, Shorts ─────
import { Hono } from "hono";
import { z } from "zod";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { ok, fail, ApiError } from "../lib/errors.js";
import { startJob } from "../lib/jobs.js";
import { dataPath } from "../lib/storage.js";
import { PipelineInput, STAGES, createPipeline, runPipeline, patchPipeline, rerunStage, loadPipeline, listPipelines } from "../services/pipeline.js";
import { DraftInput, runDraft } from "../services/draft.js";
import { ShortsInput, runShorts } from "../services/shorts.js";
import { getProject, safe } from "../services/projects.js";
import { ffmpegPath, resetFfmpeg } from "../services/audioFx.js";

export const produceRoute = new Hono();
const Stage = z.enum(STAGES.map((s) => s[0]) as [string, ...string[]]);

produceRoute.get("/pipeline/meta", (c) => { if (!ffmpegPath()) resetFfmpeg(); return ok(c, { stages: STAGES.map(([id, label]) => ({ id, label })), ffmpeg: !!ffmpegPath() }); });
produceRoute.get("/pipelines", async (c) => { try { return ok(c, { items: await listPipelines() }); } catch (e) { return fail(c, e); } });
produceRoute.get("/pipeline/:id", async (c) => { try { const p = await loadPipeline(c.req.param("id")); if (!p) throw new ApiError("NOT_FOUND", "Конвейер не найден", 404); return ok(c, p); } catch (e) { return fail(c, e); } });
produceRoute.post("/pipeline", async (c) => {
  try { const i = PipelineInput.parse(await c.req.json()); const p = await createPipeline(i); return ok(c, { id: p.id, jobId: startJob((ctx) => runPipeline(p.id, ctx)) }); } catch (e) { return fail(c, e); }
});
produceRoute.post("/pipeline/:id/resume", async (c) => {
  try {
    const b = z.object({ skip: z.boolean().default(false) }).parse(await c.req.json().catch(() => ({})));
    const id = c.req.param("id"); if (!(await loadPipeline(id))) throw new ApiError("NOT_FOUND", "Конвейер не найден", 404);
    return ok(c, { id, jobId: startJob((ctx) => runPipeline(id, ctx, { skipCurrent: b.skip })) });
  } catch (e) { return fail(c, e); }
});
produceRoute.patch("/pipeline/:id", async (c) => {
  try { const b = z.object({ stages: z.array(Stage).optional(), pauseAfter: z.array(Stage).optional() }).parse(await c.req.json()); return ok(c, await patchPipeline(c.req.param("id"), b as any)); } catch (e) { return fail(c, e); }
});
produceRoute.post("/pipeline/:id/rerun", async (c) => {
  try {
    const b = z.object({ stage: Stage }).parse(await c.req.json()); const id = c.req.param("id");
    await rerunStage(id, b.stage as any);
    return ok(c, { id, jobId: startJob((ctx) => runPipeline(id, ctx)) });
  } catch (e) { return fail(c, e); }
});

produceRoute.post("/draft", async (c) => { try { const i = DraftInput.parse(await c.req.json()); await getProject(i.projectId); return ok(c, { jobId: startJob((ctx) => runDraft(i, ctx)) }); } catch (e) { return fail(c, e); } });
/** Фоновая музыка для черновика. multipart: file, projectId → { name } */
produceRoute.post("/draft/music", async (c) => {
  try {
    const form = await c.req.formData();
    const file = form.get("file"), projectId = String(form.get("projectId") ?? "");
    if (!(file instanceof File)) throw new ApiError("VALIDATION", "Выберите аудиофайл", 400);
    if (file.size > 60 * 1024 * 1024) throw new ApiError("VALIDATION", "Файл больше 60 МБ", 400);
    const p = await getProject(projectId);
    const ext = (file.name.match(/\.(mp3|wav|m4a|aac|ogg|flac)$/i)?.[1] ?? "mp3").toLowerCase();
    const name = `music_${Date.now()}_${crypto.randomBytes(3).toString("hex")}.${ext}`;
    const dir = dataPath("files", safe(p.id)); await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(`${dir}/${name}`, Buffer.from(await file.arrayBuffer()));
    return ok(c, { name, url: `/files/${safe(p.id)}/${name}` });
  } catch (e) { return fail(c, e); }
});
produceRoute.post("/shorts", async (c) => { try { const i = ShortsInput.parse(await c.req.json()); await getProject(i.projectId); return ok(c, { jobId: startJob((ctx) => runShorts(i, ctx)) }); } catch (e) { return fail(c, e); } });
