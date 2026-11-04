import { Hono } from "hono";
import { ok, fail, ApiError } from "../lib/errors.js";
import { startJob } from "../lib/jobs.js";
import { runSeo, SeoInput } from "../services/seo.js";

export const seoRoute = new Hono();
seoRoute.post("/seo", async (c) => {
  try {
    const r = SeoInput.safeParse(await c.req.json());
    if (!r.success) throw new ApiError("VALIDATION", r.error.issues.map((i) => i.message).join("; "), 400);
    return ok(c, { jobId: startJob((ctx) => runSeo(r.data, ctx)) });
  } catch (e) { return fail(c, e); }
});
