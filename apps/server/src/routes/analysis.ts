import { Hono } from "hono";
import { z } from "zod";
import { ok, fail, ApiError } from "../lib/errors.js";
import { startJob } from "../lib/jobs.js";
import { listReports, loadReport, moreOutliers, runChannelAnalysis } from "../services/analysis.js";
import { addTopic, deleteTopic, listTopics, updateTopic } from "../services/topics.js";
import { getUsage, retryUsageAccounting } from "../services/usage.js";

const AnalysisInput = z.object({
  channel: z.string().min(2, "Укажите канал"),
  videos: z.union([z.literal(15), z.literal(30), z.literal(50), z.literal(100)]).default(30),
  type: z.enum(["all", "long", "shorts"]).default("all"),
  niche: z.string().max(200).optional(),
  force: z.boolean().optional(),
});

const parse = <T>(schema: z.ZodType<T, unknown>, body: unknown): T => {
  const r = schema.safeParse(body);
  if (!r.success) throw new ApiError("VALIDATION", r.error.issues.map((i) => i.message).join("; "), 400);
  return r.data;
};

export const analysis = new Hono();

analysis.post("/youtube/channel-analysis", async (c) => {
  try { const input = parse(AnalysisInput, await c.req.json()); return ok(c, { jobId: startJob((ctx) => runChannelAnalysis(input, ctx)) }); }
  catch (e) { return fail(c, e); }
});
analysis.get("/youtube/keys", async (c) => {
  try { const { ytPoolStatus } = await import("../services/ytKeys.js"); const { getUsage } = await import("../services/usage.js"); const u = await getUsage(); const bk = Object.keys(u.youtubeTodayByKey).length ? u.youtubeTodayByKey : { youtube: u.youtubeToday }; return ok(c, await ytPoolStatus(bk)); } catch (e) { return fail(c, e); }
});
analysis.get("/youtube/reports", async (c) => { try { return ok(c, await listReports()); } catch (e) { return fail(c, e); } });
analysis.get("/youtube/reports/:id", async (c) => {
  try { const r = await loadReport(c.req.param("id")); if (!r) throw new ApiError("NOT_FOUND", "Отчёт не найден", 404); return ok(c, r); }
  catch (e) { return fail(c, e); }
});
analysis.post("/youtube/outliers", async (c) => {
  try { const { reportId } = parse(z.object({ reportId: z.string() }), await c.req.json()); return ok(c, await moreOutliers(reportId)); }
  catch (e) { return fail(c, e); }
});

analysis.get("/saved-topics", async (c) => { try { return ok(c, await listTopics()); } catch (e) { return fail(c, e); } });
analysis.post("/saved-topics", async (c) => { try { return ok(c, await addTopic(await c.req.json())); } catch (e) { return fail(c, e instanceof z.ZodError ? new ApiError("VALIDATION", "Некорректная тема") : e); } });
analysis.patch("/saved-topics/:id", async (c) => { try { return ok(c, await updateTopic(c.req.param("id"), await c.req.json())); } catch (e) { return fail(c, e); } });
analysis.delete("/saved-topics/:id", async (c) => { try { await deleteTopic(c.req.param("id")); return ok(c, {}); } catch (e) { return fail(c, e); } });

analysis.get("/usage", async (c) => { try { return ok(c, await getUsage()); } catch (e) { return fail(c, e); } });

analysis.post("/usage/retry-accounting", async (c) => { try { const recovered=await retryUsageAccounting();return ok(c,{recovered,usage:await getUsage()}); } catch(e){return fail(c,e);} });
