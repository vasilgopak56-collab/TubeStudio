import { Hono } from "hono";
import type { z } from "zod";
import { ok, fail, ApiError } from "../lib/errors.js";
import { startJob, type JobCtx } from "../lib/jobs.js";
import { DetectorInput, runDetector } from "../services/detector.js";
import { RaterInput, runRater } from "../services/rater.js";
import { PackagingInput, runPackaging } from "../services/packaging.js";
import { HumanizerInput, runHumanizer } from "../services/humanizer.js";
import { RULES, THRESHOLD, voiceReport } from "../services/humanVoice.js";
import { z as zz } from "zod";

export const checksRoute = new Hono();
function jobRoute<T>(path: string, schema: z.ZodType<T, unknown>, run: (i: T, ctx: JobCtx) => Promise<unknown>) {
  checksRoute.post(path, async (c) => {
    try {
      const r = schema.safeParse(await c.req.json());
      if (!r.success) throw new ApiError("VALIDATION", r.error.issues.map((i) => i.message).join("; "), 400);
      return ok(c, { jobId: startJob((ctx) => run(r.data, ctx)) });
    } catch (e) { return fail(c, e); }
  });
}
jobRoute("/check/ai-detector", DetectorInput, runDetector);
jobRoute("/check/script-rater", RaterInput, runRater);
jobRoute("/check/packaging", PackagingInput, runPackaging);
jobRoute("/check/humanizer", HumanizerInput, runHumanizer);

/** Быстрая детерминированная проверка без LLM — для живой подсветки */
const ScanInput = zz.object({ text: zz.string().min(1).max(60000), language: zz.string().default("ru"), title: zz.string().max(300).optional() });
checksRoute.post("/check/humanizer/scan", async (c) => {
  try {
    const r = ScanInput.safeParse(await c.req.json());
    if (!r.success) throw new ApiError("VALIDATION", r.error.issues.map((i) => i.message).join("; "), 400);
    return ok(c, voiceReport(r.data.text, r.data.language, r.data.title));
  } catch (e) { return fail(c, e); }
});
checksRoute.get("/check/humanizer/rules", (c) => ok(c, { rules: RULES, threshold: THRESHOLD }));
