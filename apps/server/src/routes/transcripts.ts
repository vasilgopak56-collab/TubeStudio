import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ApiError, fail, ok } from "../lib/errors.js";
import { startJob } from "../lib/jobs.js";
import { analyzeTranscript, importTranscript, listTranscriptRuns, loadTranscriptRun, TranscriptAnalyzeInput, TranscriptInput, TranscriptSelection, previewTranscript } from "../services/transcripts.js";
export const transcriptsRoute = new Hono();
const limit = bodyLimit({ maxSize: 1400000, onError: c => c.json({ ok: false, error: { code: "VALIDATION", message: "Запрос слишком большой. Лимит текста — 300 000 символов." } }, 413) });
transcriptsRoute.post("/transcripts", limit, async c => {
  try { const input = TranscriptInput.parse(await c.req.json()); return ok(c, { jobId: startJob(ctx => importTranscript(input, ctx)) }); } catch (e) { return fail(c, e); }
});
transcriptsRoute.post("/transcripts/preview",limit,async c=>{try{return ok(c,await previewTranscript(TranscriptSelection.parse(await c.req.json())));}catch(e){return fail(c,e);}});
transcriptsRoute.post("/transcripts/analyze", limit, async c => {
  try { const input = TranscriptAnalyzeInput.parse(await c.req.json()); return ok(c, { jobId: startJob(ctx => analyzeTranscript(input, ctx)) }); } catch (e) { return fail(c, e); }
});
transcriptsRoute.get("/transcript-runs", async c => { try { return ok(c, await listTranscriptRuns()); } catch (e) { return fail(c, e); } });
transcriptsRoute.get("/transcript-runs/:id", async c => { try { const r = await loadTranscriptRun(c.req.param("id")); if (!r) throw new ApiError("NOT_FOUND", "Транскрипт не найден", 404); return ok(c, r); } catch (e) { return fail(c, e); } });
