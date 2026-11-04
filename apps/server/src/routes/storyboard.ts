import { Hono } from "hono";
import { z } from "zod";
import { ok, fail, ApiError } from "../lib/errors.js";
import { startJob } from "../lib/jobs.js";
import { runStoryboard, StoryboardInput, STORYBOARD_META, segment } from "../services/storyboard.js";
import { generateImage, saveImage } from "../services/imageGen.js";
import { getProject } from "../services/projects.js";

export const storyboardRoute = new Hono();
const parse = <T>(s: z.ZodType<T, unknown>, b: unknown): T => { const r = s.safeParse(b); if (!r.success) throw new ApiError("VALIDATION", r.error.issues.map((i) => i.message).join("; "), 400); return r.data; };

storyboardRoute.get("/storyboard/meta", (c) => ok(c, STORYBOARD_META()));
// предпросмотр сегментации без LLM
storyboardRoute.post("/storyboard/segment", async (c) => {
  try { const i = parse(z.object({ script: z.string().min(1).max(60000), style: z.string().default("universal") }), await c.req.json()); const s = segment(i.script, i.style); return ok(c, { units: s.units.length, batches: s.batches, totalSeconds: s.totalSeconds }); } catch (e) { return fail(c, e); }
});
storyboardRoute.post("/storyboard", async (c) => {
  try { const i = parse(StoryboardInput, await c.req.json()); return ok(c, { jobId: startJob((ctx) => runStoryboard(i, ctx)) }); } catch (e) { return fail(c, e); }
});
// «Сгенерировать кадр» — проверка стиля на 1–3 сценах
storyboardRoute.post("/storyboard/frame", async (c) => {
  try {
    const i = parse(z.object({ prompt: z.string().min(10).max(4000), projectId: z.string().optional() }), await c.req.json());
    const img = await generateImage(i.prompt, { aspect: "16:9" });
    let url: string | undefined;
    if (i.projectId) { try { await getProject(i.projectId); url = (await saveImage(i.projectId, img, "frame")).url; } catch { /* без проекта */ } }
    return ok(c, { url, dataUrl: url ? undefined : `data:${img.mime};base64,${img.b64}`, model: img.model, provider: img.provider });
  } catch (e) { return fail(c, e); }
});
