import { APP_VERSION } from "../lib/version.js";
import { bodyLimit } from "hono/body-limit";
import { Hono } from "hono";
import { z } from "zod";
import { ok, fail, ApiError } from "../lib/errors.js";
import { startJob } from "../lib/jobs.js";
import { estimateUnits, listResearch, loadResearch, ResearchInput, runResearch } from "../services/explore.js";
import { analyzeKeyword, ChannelDescInput, channelDescription, KeywordInput, listKeywordRuns, loadKeywordRun, runKeywords, saveKeywordRun, suggestions } from "../services/keywords.js";
import { addCompetitor, getCompetitor, listAlerts, listCompetitors, markAlertsRead, clearAlerts, refreshCompetitors, removeCompetitor } from "../services/competitors.js";
import { getSettings } from "../services/settings.js";
import { buildDigest, deleteDigest, DigestInput, getDigest, listDigests } from "../services/digest.js";
import { CommentsInput, listCommentRuns, loadCommentRun, runComments } from "../services/comments.js";
import { listScorecards, loadScorecard, runScorecard, ScorecardInput } from "../services/scorecard.js";
import { extChannel, extVideos } from "../services/ext.js";
import { extToken } from "./auth.js";

const parse = <T>(schema: z.ZodType<T, unknown>, body: unknown): T => {
  const r = schema.safeParse(body);
  if (!r.success) throw new ApiError("VALIDATION", r.error.issues.map((i) => i.message).join("; "), 400);
  return r.data;
};
const h = (fn: (c: any) => Promise<unknown>) => async (c: any) => { try { return ok(c, await fn(c)); } catch (e) { return fail(c, e); } };

export const exploreRoute = new Hono();

// 1. Research / Outliers
exploreRoute.post("/research/videos", h(async (c) => { const input = parse(ResearchInput, await c.req.json()); return { jobId: startJob((ctx) => runResearch(input, ctx)) }; }));
exploreRoute.get("/research/estimate", h(async (c) => { const s = await getSettings(); const pages = Number(c.req.query("pages") ?? s.research.pages) || 1; return { units: estimateUnits(pages, s.research.outlierBase), pages, base: s.research.outlierBase }; }));
exploreRoute.get("/research/runs", h(async (c) => { const rows = await listResearch(); const mode = c.req.query("mode"); return mode ? rows.filter((r) => (r.mode ?? "outliers") === mode) : rows; }));
exploreRoute.get("/research/runs/:id", h(async (c) => { const r = await loadResearch(c.req.param("id")); if (!r) throw new ApiError("NOT_FOUND", "Поиск не найден", 404); return r; }));

// 2. Keywords
exploreRoute.post("/research/keywords", h(async (c) => { const input = parse(KeywordInput, await c.req.json()); return { jobId: startJob((ctx) => runKeywords(input, ctx)) }; }));
exploreRoute.get("/research/suggest", h(async (c) => { const s = await getSettings(); const q = String(c.req.query("q") ?? "").trim(); if (q.length < 2) return []; return suggestions(q, c.req.query("lang") || s.research.language || s.contentLanguage, (c.req.query("region") ?? s.research.region) || undefined, "fast", 15); }));
exploreRoute.post("/research/keywords/analyze", h(async (c) => {
  const b = parse(z.object({ keyword: z.string().min(2).max(120), runId: z.string().optional(), language: z.string().optional(), region: z.string().optional() }), await c.req.json());
  const s = await getSettings();
  const run = b.runId ? await loadKeywordRun(b.runId) : null;
  const lang = b.language || run?.input.language || s.research.language || s.contentLanguage;
  const metrics = await analyzeKeyword(b.keyword, lang, (b.region ?? run?.input.region ?? s.research.region) || undefined);
  if (run) { const k = run.keywords.find((x) => x.keyword === b.keyword); if (k) k.metrics = metrics; else run.keywords.push({ keyword: b.keyword, auto: 0, sources: 0, metrics }); run.units += 102; await saveKeywordRun(run); }
  return { keyword: b.keyword, metrics };
}));
exploreRoute.get("/research/keyword-runs", h(() => listKeywordRuns()));
exploreRoute.get("/research/keyword-runs/:id", h(async (c) => { const r = await loadKeywordRun(c.req.param("id")); if (!r) throw new ApiError("NOT_FOUND", "Не найдено", 404); return r; }));
exploreRoute.post("/research/channel-description", h(async (c) => channelDescription(parse(ChannelDescInput, await c.req.json()))));

// 4. Competitors + trend alerts
exploreRoute.use("/competitors", bodyLimit({maxSize:8192,onError:c=>fail(c,new ApiError("VALIDATION","Тело запроса слишком велико",413))}));
exploreRoute.use("/competitors/*", bodyLimit({maxSize:8192,onError:c=>fail(c,new ApiError("VALIDATION","Тело запроса слишком велико",413))}));
const trackerJson=async(c:any)=>{try{return await c.req.json();}catch{throw new ApiError("VALIDATION","Нужен корректный JSON",400);}};
const trackerIds=z.object({ids:z.array(z.string().regex(/^UC[\w-]{22}$/)).min(1).max(50).refine(v=>new Set(v).size===v.length,"Повтор ID").optional()}).strict();
exploreRoute.get("/competitors", h(() => listCompetitors()));
exploreRoute.post("/competitors", h(async (c) => addCompetitor(parse(z.object({ channel: z.string().trim().min(2, "Укажите канал").max(2048) }).strict(), await trackerJson(c)).channel)));
exploreRoute.get("/competitors/alerts", h(() => listAlerts()));
exploreRoute.post("/competitors/alerts/read", h(async (c) => markAlertsRead(parse(z.object({ ids: z.array(z.string().min(1).max(100)).max(500).optional() }).strict(), await trackerJson(c)).ids)));
exploreRoute.delete("/competitors/alerts", h(() => clearAlerts()));
exploreRoute.post("/competitors/refresh", h(async (c) => refreshCompetitors(parse(trackerIds, await trackerJson(c)).ids)));
// Недельный дайджест (ИИ-разбор хитов конкурентов)
exploreRoute.post("/competitors/digest", h(async (c) => { const input = parse(DigestInput, await c.req.json().catch(() => ({}))); return { jobId: startJob(async (ctx) => { ctx.progress("Собираю хиты конкурентов и разбираю (ИИ)", 30); return buildDigest(input); }) }; }));
exploreRoute.get("/competitors/digests", h(() => listDigests()));
exploreRoute.get("/competitors/digests/:id", h((c) => getDigest(c.req.param("id"))));
exploreRoute.delete("/competitors/digests/:id", h((c) => deleteDigest(c.req.param("id"))));
exploreRoute.get("/competitors/:id", h((c) => getCompetitor(c.req.param("id"))));
exploreRoute.delete("/competitors/:id", h((c) => removeCompetitor(c.req.param("id"))));

// 5. Анализ комментариев
exploreRoute.post("/comments", h(async (c) => { const input = parse(CommentsInput, await c.req.json()); return { jobId: startJob((ctx) => runComments(input, ctx)) }; }));
exploreRoute.get("/comment-runs", h(() => listCommentRuns()));
exploreRoute.get("/comment-runs/:id", h(async (c) => { const r = await loadCommentRun(c.req.param("id")); if (!r) throw new ApiError("NOT_FOUND", "Анализ не найден", 404); return r; }));

// 6. Оценка видео перед публикацией
exploreRoute.post("/scorecard", h(async (c) => { const input = parse(ScorecardInput, await c.req.json()); return { jobId: startJob((ctx) => runScorecard(input, ctx)) }; }));
exploreRoute.get("/scorecards", h(() => listScorecards()));
exploreRoute.get("/scorecards/:id", h(async (c) => { const r = await loadScorecard(c.req.param("id")); if (!r) throw new ApiError("NOT_FOUND", "Оценка не найдена", 404); return r; }));

// 7. Расширение Chrome
exploreRoute.get("/ext/ping", h(async () => ({ app: "TubeStudio", version: APP_VERSION, extensionVersion: "1.1.0", explicitMetrics: true })));
exploreRoute.get("/ext/token", h(async () => ({ token: extToken() })));
/** ZIP с расширением (папка extension/ в корне проекта) */
exploreRoute.get("/ext/download", async (c) => {
  try {
    const fs = await import("node:fs/promises"); const path = await import("node:path"); const { zipSync } = await import("fflate");
    const cands = [path.resolve(process.cwd(), "../../extension"), path.resolve(process.cwd(), "extension")];
    let dir = ""; for (const d of cands) { try { await fs.access(path.join(d, "manifest.json")); dir = d; break; } catch { /* */ } }
    if (!dir) throw new ApiError("NOT_FOUND", "Папка extension не найдена в проекте", 404);
    const files: Record<string, Uint8Array> = {};
    const allowed=["manifest.json","shared.js","background.js","content.js","content.css","popup.html","popup.js","README.md","icons/16.png","icons/48.png","icons/128.png"];
    const iconDir=await fs.lstat(path.join(dir,"icons"));if(!iconDir.isDirectory()||iconDir.isSymbolicLink())throw new ApiError("VALIDATION","Некорректная папка значков");
    for(const name of allowed){const full=path.join(dir,name),stat=await fs.lstat(full);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw new ApiError("VALIDATION","Некорректный файл расширения");files[`tubestudio-extension/${name}`]=new Uint8Array(await fs.readFile(full));}
    const zip = zipSync(files, { level: 6 });
    return new Response(zip, { headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="tubestudio-extension.zip"' } });
  } catch (e) { return fail(c, e); }
});
exploreRoute.get("/ext/videos", h(async (c) => extVideos(String(c.req.query("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean))));
exploreRoute.get("/ext/channel", h(async (c) => { const q = String(c.req.query("input") ?? "").trim(); if (q.length < 2) throw new ApiError("VALIDATION", "Укажите канал", 400); return extChannel(q); }));
