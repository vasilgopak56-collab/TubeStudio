import { browserGuard } from "./lib/browserGuard.js";
import { assistantRoute } from "./routes/assistant.js";
import { priceConsentRoute, priceConsentScope } from "./routes/priceConsent.js";
import { directorRoute } from "./routes/director.js";
import { donorWorkflowRoute } from "./routes/donorWorkflow.js";
import { visualStylesRoute } from "./routes/visualStyles.js";
import {researchComparisonRoute} from './routes/researchComparison.js';
import { researchWorkflowRoute } from './routes/researchWorkflow.js';
import { researchEvidenceRoute } from './routes/researchEvidence.js';
import { keywordEvidenceRoute } from "./routes/keywordEvidence.js";
import { commentReviewRoute } from "./routes/commentReview.js";
import { seoAuditRoute } from "./routes/seoAudit.js";
import { dailyIdeasRoute } from "./routes/dailyIdeas.js";
import { videoScoreRoute } from "./routes/videoScore.js";
import { mcpRoute } from "./routes/mcp.js";
import { adBreaksRoute } from "./routes/adBreaks.js";
import { profitRoute } from "./routes/profit.js";
import { coachRoute } from "./routes/coach.js";
import { audioStoryboardRoute } from "./routes/audioStoryboard.js";
import { calendarRoute } from "./routes/calendar.js";
import { voiceRoute } from "./routes/voice.js";
import { promptsRoute } from "./routes/prompts.js";
import { anymodelRoute } from "./routes/anymodel.js";
import { transcriptsRoute } from "./routes/transcripts.js";
import { nichesRoute } from "./routes/niches.js";
import { exploreRoute } from "./routes/explore.js";
import { studioRoute } from "./routes/studio.js";
import { startCompetitorScheduler, stopCompetitorScheduler, activeCompetitorRefreshes } from "./services/competitors.js";
import { startSnapshotScheduler, stopSnapshotScheduler, activeSnapshotChecks } from "./services/studio/publishSnapshots.js";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { log, flushLogs } from "./lib/logging.js";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { ensureDataDirs } from "./lib/storage.js";
import { acquireDataLock } from "./lib/dataLock.js";
import { activeJobCount } from "./lib/jobs.js";
import { openSoftControl } from "./lib/softControl.js";
import { initPortableSecrets } from "./lib/startup.js";
import { issueLaunchToken } from "./lib/session.js";
import { startAmCatalogWarmup } from "./services/anymodel.js";
import { APP_VERSION } from "./lib/version.js";
import type { Socket } from "node:net";
import type { ServerResponse } from "node:http";
import { system } from "./routes/system.js";
import { auth, requireAuth } from "./routes/auth.js";
import { jobsRoute } from "./routes/jobs.js";
import { analysis } from "./routes/analysis.js";
import { content } from "./routes/content.js";
import { scriptRoute } from "./routes/script.js";
import { seoRoute } from "./routes/seo.js";
import { checksRoute } from "./routes/checks.js";
import { storyboardRoute } from "./routes/storyboard.js";
import { thumbnailRoute } from "./routes/thumbnail.js";
import { dataRoute } from "./routes/data.js";
import { produceRoute } from "./routes/produce.js";
import { myAnalyticsRoute } from "./routes/myAnalytics.js";

// Lock before initializing writable application folders or serving any requests.
const lease=await acquireDataLock(config.dataDir).catch((error:unknown)=>{
  console.error(`TubeStudio: ${error instanceof Error?error.message:'Не удалось занять папку данных.'} DATA_DIR: ${config.dataDir}`);
  process.exit(1);
});
try { await ensureDataDirs(); await initPortableSecrets(); }
catch (error) { await lease.release().catch(()=>{}); throw error; }

const app = new Hono();
app.use("*", browserGuard);
app.use("*", async (c, next) => {
  const at = Date.now();
  try { await next(); }
  finally {
    // No URL query, headers or request/response body: OAuth callback codes stay out of logs.
    log.info({ event: "http", method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - at });
  }
});
app.use("/api/*", requireAuth);
app.use("/api/*", priceConsentScope);
app.use("/files/*", requireAuth);
// Кнопка «Выход»: мягкая остановка из интерфейса. Занятый сервер не останавливается без явного force.
app.post("/api/system/exit", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { force?: unknown };
  const busy = busyReasons(1);
  if (busy.length && body.force !== true)
    return c.json({ ok: false, error: { code: "BUSY", message: `Сейчас выполняется: ${busy.join(", ")}. Дождитесь окончания или закройте принудительно.`, details: { busy } } }, 409);
  setTimeout(() => { void exitFromUi(body.force === true); }, 150);
  return c.json({ ok: true, data: { stopping: true } });
});
app.route("/api", researchEvidenceRoute);
app.route("/api", researchWorkflowRoute);
app.route("/api", researchComparisonRoute);
app.route("/api", auth);
app.route("/api", system);
app.route("/api", jobsRoute);
app.route("/api", priceConsentRoute);
app.route("/api", analysis);
app.route("/api", content);
app.route("/api", scriptRoute);
app.route("/api", donorWorkflowRoute);
app.route("/api", directorRoute);
app.route("/api", seoRoute);
app.route("/api", checksRoute);
app.route("/api", storyboardRoute);
app.route("/api", visualStylesRoute);
app.route("/api", audioStoryboardRoute);
app.route("/api", thumbnailRoute);
app.route("/api", dataRoute);
app.route("/api", produceRoute);
app.route("/api", myAnalyticsRoute);
app.route("/api", calendarRoute);
app.route("/api", voiceRoute);
app.route("/api", promptsRoute);
app.route("/api", anymodelRoute);
app.route("/api", exploreRoute);
app.route("/api", nichesRoute);
app.route("/api", videoScoreRoute);
app.route("/api", dailyIdeasRoute);
app.route("/api", seoAuditRoute);
app.route("/api", commentReviewRoute);
app.route("/api", keywordEvidenceRoute);
app.route("/api", transcriptsRoute);
app.route("/api", coachRoute);
app.route("/api", assistantRoute);
app.route("/api", mcpRoute);
app.route("/api", adBreaksRoute);
app.route("/api", profitRoute);
app.route("/api", studioRoute);
// Файлы проектов: /files/<projectId>/<name> → data/files/…
app.use("/files/*", serveStatic({ root: path.relative(process.cwd(), config.dataDir) }));
app.notFound((c) => c.req.path.startsWith("/api/")
  ? c.json({ ok: false, error: { code: "NOT_FOUND", message: "Маршрут не найден" } }, 404)
  : c.text("Not found", 404));

// Продакшен: отдаём собранный фронтенд
const webDist = path.resolve(process.cwd(), "../web/dist");
if (fs.existsSync(webDist)) {
  const rel = path.relative(process.cwd(), webDist);
  app.use("/*", serveStatic({ root: rel }));
  app.get("*", serveStatic({ path: path.join(rel, "index.html") }));
}

let started=false,stopping=false;
let control: Awaited<ReturnType<typeof openSoftControl>> | undefined;
const activeResponses=new Set<ServerResponse>();
// A disconnected response is not proof that its route handler has stopped.
// Count until the fetch promise settles, including rejected/synchronous handlers.
let activeHandlers=0;
const trackedFetch: typeof app.fetch = async (...args) => {
  activeHandlers++;
  try { return await app.fetch(...args); }
  finally { activeHandlers--; }
};
const server = serve({ fetch: trackedFetch, port: config.port, hostname: config.host }, (i) => {
  started=true;startCompetitorScheduler();startSnapshotScheduler();if(process.env.TUBESTUDIO_PORTABLE==="1"&&process.env.TS_NO_SCHEDULER!=="1")startAmCatalogWarmup();log.info({ event: "server_started", host: config.host, port: i.port }, "TubeStudio server started");
  void openSoftControl(i.port,softStop,{version:APP_VERSION,link:()=>`http://127.0.0.1:${i.port}/?launch=${issueLaunchToken()}`}).then(async c=>{if(stopping)await c.close();else control=c;}).catch(()=>console.error("TubeStudio: мягкая остановка недоступна; не используйте принудительное завершение без проверки. См. инструкцию."));
});
server.prependListener("request",(_req,res)=>{activeResponses.add(res);const done=()=>activeResponses.delete(res);res.once("finish",done);res.once("close",done);});
server.on("error", (error) => {
  console.error(`TubeStudio: ошибка сервера (${(error as NodeJS.ErrnoException).code??"неизвестная"}).`);
  void (started?Promise.resolve():lease.release().catch(()=>{})).finally(()=>process.exit(1));
});
const stopSchedulers=()=>Promise.all([stopCompetitorScheduler(),stopSnapshotScheduler()]);
/** What keeps the server busy, excluding `self` requests (the exit request itself). */
function busyReasons(self=0):string[] {
  const out:string[]=[];
  const jobs=activeJobCount();if(jobs)out.push(`задачи: ${jobs}`);
  if(activeCompetitorRefreshes())out.push("обновление конкурентов");
  if(activeSnapshotChecks())out.push("замер ролика");
  if(Math.max(0,activeHandlers-self)>0||Math.max(0,activeResponses.size-self)>0)out.push("запросы");
  return out;
}
async function exitFromUi(force:boolean){
  if(stopping)return;
  if(!force&&busyReasons().length)return; // something started in the meantime: keep running
  stopping=true;
  const scheduler=stopSchedulers();
  server.close();if("closeIdleConnections" in server)server.closeIdleConnections();
  await Promise.race([scheduler,new Promise(r=>setTimeout(r,3000))]).catch(()=>{});
  await flushLogs().catch(()=>{});
  try{await control?.close();}catch{/* descriptor already gone */}
  try{await lease.release();}catch{console.error("TubeStudio: блокировку папки данных снять не удалось; следующий запуск проверит её сам.");}
  process.exit(0);
}
function softStop(socket:Socket):boolean {
  if(stopping||!control||activeResponses.size||activeHandlers||activeJobCount()||activeCompetitorRefreshes()||activeSnapshotChecks())return false;
  stopping=true;
  // No automatic force on the soft path. If anything goes wrong the lock stays in place.
  const scheduler=stopSchedulers();server.close(()=>{void (async()=>{
    await scheduler;if(activeJobCount()||activeResponses.size||activeHandlers)throw Error("BUSY");await flushLogs();
    await control!.close();await lease.release();
    const finish=()=>process.exit(0);socket.once("close",finish);socket.end("STOPPED\n",finish);setTimeout(finish,1000).unref();
  })().catch(()=>{socket.end("UNCERTAIN\n");console.error("TubeStudio: мягкая остановка не подтверждена; блокировка оставлена.");});});
  if("closeIdleConnections" in server)server.closeIdleConnections();return true;
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
  if (stopping) return; stopping = true;
  const force = setTimeout(() => { console.error("TubeStudio: остановка не подтверждена; блокировка оставлена. Проверьте задачи и инструкцию восстановления.");process.exit(1); }, 3000); force.unref();
  const scheduler=stopSchedulers();
  server.close(() => { void (async()=>{
    await scheduler;
    if(activeJobCount()>0||activeHandlers>0) { console.error("TubeStudio: есть незавершённые задачи или обработчики; блокировка оставлена. Проверьте задачи и инструкцию восстановления.");await flushLogs();process.exit(1); }
    await flushLogs();
    try { if(control)await control.close();await lease.release(); } catch { console.error("TubeStudio: не удалось безопасно снять блокировку. Проверьте инструкцию восстановления.");process.exit(1); }
    clearTimeout(force);process.exit(0);
  })().catch(()=>{console.error("TubeStudio: остановка не подтверждена; блокировка оставлена.");process.exit(1);}); });
});
