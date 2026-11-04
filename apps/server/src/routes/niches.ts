import { bodyLimit } from "hono/body-limit";
import { Hono } from "hono";
import { ApiError, fail, ok } from "../lib/errors.js";
import { startJob } from "../lib/jobs.js";
import { listNicheRuns, loadNicheRun, NicheInput, runNicheSearch } from "../services/niches.js";
export const nichesRoute = new Hono();
nichesRoute.post("/niches", bodyLimit({ maxSize: 8192, onError: c => c.json({ ok: false, error: { code: "VALIDATION", message: "Слишком большой запрос" } }, 413) }), async c => {
  try { const input = NicheInput.parse(await c.req.json().catch(() => { throw new ApiError("VALIDATION", "Некорректный JSON"); })); return ok(c, { jobId: startJob(ctx => runNicheSearch(input, ctx)) }); }
  catch (e) { return fail(c, e); }
});
nichesRoute.get("/niche-runs", async c => { try { return ok(c, await listNicheRuns()); } catch (e) { return fail(c, e); } });
nichesRoute.get("/niche-runs/:id", async c => {
  try { const r = await loadNicheRun(c.req.param("id")); if (!r) throw new ApiError("NOT_FOUND", "Сравнение не найдено", 404); return ok(c, r); }
  catch (e) { return fail(c, e); }
});
