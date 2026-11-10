import * as Reach from "../services/reach.js";
// ───── Моя аналитика: OAuth Google + YouTube Analytics ─────
import { Hono } from "hono";
import { z } from "zod";
import { ok, fail } from "../lib/errors.js";
import { startJob } from "../lib/jobs.js";
import { bodyLimit } from "hono/body-limit";
import { ApiError } from "../lib/errors.js";
import { GeographyInput, saveGeography, loadGeography, listGeography } from "../services/geography.js";
import { AbInput, saveAb, loadAb, listAb } from "../services/abJournal.js";
import { RevenueInput, saveRevenue, loadRevenue, listRevenue } from "../services/revenue.js";
import { ChannelSnapshotInput, ChannelSnapshotSend, previewChannelSnapshot, ChannelPeriod, saveChannelSnapshot, loadChannelSnapshot, listChannelSnapshot, channelCatalog, channelBoard } from "../services/channelDashboard.js";
import * as A from "../services/ytAnalytics.js";
import * as Vault from "../services/oauthVault.js";

export const myAnalyticsRoute = new Hono();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

myAnalyticsRoute.get("/yt-oauth/status", async (c) => { try { return ok(c, await A.oauthStatus()); } catch (e) { return fail(c, e); } });
myAnalyticsRoute.put("/yt-oauth/client", async (c) => {
  try { const b = z.object({ clientId: z.string().min(10).max(200), clientSecret: z.string().min(10).max(200) }).parse(await c.req.json()); await A.saveClient(b.clientId, b.clientSecret); return ok(c, await A.oauthStatus()); } catch (e) { return fail(c, e); }
});
myAnalyticsRoute.get("/yt-oauth/start", async (c) => { try { return ok(c, { url: A.authUrl({selectAccount:c.req.query("selectAccount")==="1"}) }); } catch (e) { return fail(c, e); } });
/** Google возвращает сюда браузер пользователя → сохраняем токен и уводим на страницу аналитики */
myAnalyticsRoute.get("/yt-oauth/callback", async (c) => {
  const project = A.uploadReturn(c.req.query("state"));
  const back = project ? `/studio/publish?project=${encodeURIComponent(project)}` : "/my-analytics";
  try { await A.handleCallback({ code: c.req.query("code"), state: c.req.query("state"), error: c.req.query("error") }); return c.redirect(project ? back : "/my-analytics?connected=1"); }
  catch (e) { return c.html(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;background:#111;color:#eee"><h2>Не удалось подключить YouTube</h2><p>${esc((e as Error).message)}</p><p><a style="color:#8cf" href="${esc(back)}">Вернуться в TubeStudio</a></p>`, 400); }
});
myAnalyticsRoute.use("/yt-oauth/start-upload", bodyLimit({maxSize:2048,onError:c=>c.json({ok:false,error:{code:"VALIDATION",message:"Слишком большой запрос"}},413)}));
myAnalyticsRoute.post("/yt-oauth/start-upload",async c=>{try {
 const b=await c.req.json().catch(()=>{throw new ApiError("VALIDATION","Некорректный JSON согласия",400);});
 const {projectId}=z.object({consent:z.literal(true),projectId:z.string().uuid().optional()}).strict().parse(b);
 return ok(c,{url:await A.uploadAuthUrl(projectId)});
} catch(e){return fail(c,e);}});
myAnalyticsRoute.post("/yt-oauth/disconnect", async (c) => { try { await A.disconnect(); return ok(c, await A.oauthStatus()); } catch (e) { return fail(c, e); } });

myAnalyticsRoute.get("/my-analytics/overview", async (c) => { try { const d = Math.min(365, Math.max(7, Number(c.req.query("days")) || 28)); return ok(c, await A.channelOverview(d)); } catch (e) { return fail(c, e); } });
myAnalyticsRoute.get("/my-analytics/videos", async (c) => { try { return ok(c, { items: await A.myVideos(30), links: await A.listLinks() }); } catch (e) { return fail(c, e); } });
myAnalyticsRoute.get("/my-analytics/video/:id", async (c) => { try { return ok(c, await A.videoReport(c.req.param("id"))); } catch (e) { return fail(c, e); } });
myAnalyticsRoute.put("/my-analytics/link", async (c) => {
  try { const b = z.object({ videoId: z.string().regex(/^[\w-]{11}$/), projectId: z.string().max(80).nullable() }).parse(await c.req.json()); return ok(c, await A.linkVideo(b.videoId, b.projectId)); } catch (e) { return fail(c, e); }
});
myAnalyticsRoute.get("/my-analytics/lessons", async (c) => { try { return ok(c, await A.getLessons()); } catch (e) { return fail(c, e); } });
myAnalyticsRoute.post("/my-analytics/lessons", async (c) => {
  try { const b = z.object({ days: z.number().int().min(28).max(365).default(90) }).parse(await c.req.json().catch(() => ({}))); return ok(c, { jobId: startJob(async (ctx) => { ctx.progress("Собираем аналитику и ищем закономерности", 20); return A.buildLessons(b.days); }) }); } catch (e) { return fail(c, e); }
});

myAnalyticsRoute.use("/my-analytics/geography/*", bodyLimit({ maxSize: 10000, onError: c => c.json({ ok: false, error: { code: "VALIDATION", message: "Слишком большой запрос географии" } }, 413) }));
myAnalyticsRoute.post("/my-analytics/geography/runs", async c => { try { return ok(c, await saveGeography(GeographyInput.parse(await c.req.json()))); } catch(e) { return fail(c,e); } });
myAnalyticsRoute.get("/my-analytics/geography/runs", async c => { try { return ok(c, await listGeography()); } catch(e) { return fail(c,e); } });
myAnalyticsRoute.get("/my-analytics/geography/runs/:id", async c => { try { const r = await loadGeography(c.req.param("id")); if (!r) throw new ApiError("NOT_FOUND", "Отчёт географии не найден", 404); return ok(c,r); } catch(e) { return fail(c,e); } });

myAnalyticsRoute.use("/my-analytics/ab/*", bodyLimit({ maxSize: 30000, onError: c => c.json({ ok: false, error: { code: "VALIDATION", message: "Слишком большой запрос A/B" } }, 413) }));
myAnalyticsRoute.post("/my-analytics/ab/runs", async c => { try {
 const raw = await c.req.json().catch(() => { throw new ApiError("VALIDATION", "Некорректный JSON запроса A/B", 400); });
 return ok(c, await saveAb(AbInput.parse(raw)));
} catch(e) { return fail(c,e); } });
myAnalyticsRoute.get("/my-analytics/ab/runs", async c => { try { return ok(c, await listAb()); } catch(e) { return fail(c,e); } });
myAnalyticsRoute.get("/my-analytics/ab/runs/:id", async c => { try { const r = await loadAb(c.req.param("id")); if (!r) throw new ApiError("NOT_FOUND", "Снимок A/B не найден", 404); return ok(c,r); } catch(e) { return fail(c,e); } });

// Financial access is an explicit opt-in, never a query-string override of base OAuth.
myAnalyticsRoute.use("/yt-oauth/start-monetary", bodyLimit({maxSize:2048,onError:c=>c.json({ok:false,error:{code:"VALIDATION",message:"Слишком большой запрос"}},413)}));
myAnalyticsRoute.post("/yt-oauth/start-monetary",async c=>{try {
 const b=await c.req.json().catch(()=>{throw new ApiError("VALIDATION","Некорректный JSON согласия",400);});
 z.object({consent:z.literal(true)}).strict().parse(b);
 return ok(c,{url:A.authUrl({monetary:true})});
} catch(e){return fail(c,e);}});
myAnalyticsRoute.use("/my-analytics/revenue/*",bodyLimit({maxSize:10000,onError:c=>c.json({ok:false,error:{code:"VALIDATION",message:"Слишком большой запрос дохода"}},413)}));
myAnalyticsRoute.post("/my-analytics/revenue/runs",async c=>{try {
 const b=await c.req.json().catch(()=>{throw new ApiError("VALIDATION","Некорректный JSON дохода",400);});
 return ok(c,await saveRevenue(RevenueInput.parse(b)));
} catch(e){return fail(c,e);}});
myAnalyticsRoute.get("/my-analytics/revenue/runs",async c=>{try{return ok(c,await listRevenue());}catch(e){return fail(c,e);}});
myAnalyticsRoute.get("/my-analytics/revenue/runs/:id",async c=>{try{const r=await loadRevenue(c.req.param("id"));if(!r)throw new ApiError("NOT_FOUND","Отчёт дохода не найден",404);return ok(c,r);}catch(e){return fail(c,e);}});

myAnalyticsRoute.use("/my-analytics/channels/*",bodyLimit({maxSize:10000,onError:c=>c.json({ok:false,error:{code:"VALIDATION",message:"Слишком большой запрос сводки канала"}},413)}));
myAnalyticsRoute.post("/my-analytics/channels/preview",async c=>{try{return ok(c,await previewChannelSnapshot(ChannelSnapshotInput.parse(await c.req.json())));}catch(e){return fail(c,e);}});
myAnalyticsRoute.post("/my-analytics/channels/generate",async c=>{try{const d=ChannelSnapshotSend.parse(await c.req.json());return ok(c,{jobId:startJob(async ctx=>{ctx.progress("Запрашиваю одну страницу сводки канала",20);const r=await saveChannelSnapshot(d,ctx.signal);ctx.progress("Снимок сохранён",100);return r;})});}catch(e){return fail(c,e);}});
myAnalyticsRoute.post("/my-analytics/channels/runs",async c=>{try{const b=await c.req.json().catch(()=>{throw new ApiError("VALIDATION","Некорректный JSON сводки канала",400);});return ok(c,await saveChannelSnapshot(ChannelSnapshotSend.parse(b)));}catch(e){return fail(c,e);}});
myAnalyticsRoute.get("/my-analytics/channels/runs",async c=>{try{return ok(c,await listChannelSnapshot());}catch(e){return fail(c,e);}});
myAnalyticsRoute.get("/my-analytics/channels/runs/:id",async c=>{try{const r=await loadChannelSnapshot(c.req.param("id"));if(!r)throw new ApiError("NOT_FOUND","Сводка канала не найдена",404);return ok(c,r);}catch(e){return fail(c,e);}});
myAnalyticsRoute.get("/my-analytics/channels/catalog",async c=>{try{return ok(c,await channelCatalog());}catch(e){return fail(c,e);}});
myAnalyticsRoute.get("/my-analytics/channels/board",async c=>{try{return ok(c,await channelBoard(ChannelPeriod.parse(c.req.query())));}catch(e){return fail(c,e);}});

myAnalyticsRoute.use("/yt-oauth/connections/*",bodyLimit({maxSize:2048,onError:c=>c.json({ok:false,error:{code:"VALIDATION",message:"Слишком большой запрос подключения"}},413)}));
myAnalyticsRoute.get("/yt-oauth/connections",async c=>{try{return ok(c,await Vault.listConnections());}catch(e){return fail(c,e);}});
const consentBody=async(c:any)=>{const raw=await c.req.json().catch(()=>{throw new ApiError("VALIDATION","Некорректный JSON подтверждения",400);});z.object({consent:z.literal(true)}).strict().parse(raw);};
myAnalyticsRoute.post("/yt-oauth/connections/save",async c=>{try{await consentBody(c);return ok(c,await Vault.rememberCurrent());}catch(e){return fail(c,e);}});
myAnalyticsRoute.post("/yt-oauth/connections/:id/activate",async c=>{try{await consentBody(c);return ok(c,await Vault.activateConnection(c.req.param("id")));}catch(e){return fail(c,e);}});
myAnalyticsRoute.post("/yt-oauth/connections/:id/forget",async c=>{try{await consentBody(c);return ok(c,await Vault.forgetConnection(c.req.param("id")));}catch(e){return fail(c,e);}});

myAnalyticsRoute.use("/my-analytics/reach/*",bodyLimit({maxSize:4096,onError:c=>c.json({ok:false,error:{code:"VALIDATION",message:"Слишком большой запрос Reach"}},413)}));
const reachBody=async(c:any)=>c.req.json().catch(()=>{throw new ApiError("VALIDATION","Некорректный JSON Reach",400);});
myAnalyticsRoute.post("/my-analytics/reach/jobs/list",async c=>{try{z.object({}).strict().parse(await reachBody(c));return ok(c,await Reach.listReachJobs());}catch(e){return fail(c,e);}});
myAnalyticsRoute.post("/my-analytics/reach/jobs/create",async c=>{try{z.object({consent:z.literal(true)}).strict().parse(await reachBody(c));return ok(c,await Reach.createReachJob());}catch(e){return fail(c,e);}});
myAnalyticsRoute.post("/my-analytics/reach/jobs/:id/delete",async c=>{try{const b=z.object({consent:z.literal(true),confirmId:Reach.RemoteId}).strict().parse(await reachBody(c));if(b.confirmId!==c.req.param("id"))throw new ApiError("VALIDATION","ID подтверждения не совпадает",400);return ok(c,await Reach.deleteReachJob(b.confirmId));}catch(e){return fail(c,e);}});
myAnalyticsRoute.post("/my-analytics/reach/reports/list",async c=>{try{return ok(c,await Reach.listReachReports(Reach.ReportsInput.parse(await reachBody(c))));}catch(e){return fail(c,e);}});
myAnalyticsRoute.post("/my-analytics/reach/runs",async c=>{try{return ok(c,await Reach.saveReach(Reach.ReachInput.parse(await reachBody(c))));}catch(e){return fail(c,e);}});
myAnalyticsRoute.get("/my-analytics/reach/runs",async c=>{try{return ok(c,await Reach.listReach());}catch(e){return fail(c,e);}});
myAnalyticsRoute.get("/my-analytics/reach/runs/:id",async c=>{try{const r=await Reach.loadReach(c.req.param("id"));if(!r)throw new ApiError("NOT_FOUND","Снимок Reach не найден",404);return ok(c,r);}catch(e){return fail(c,e);}});
