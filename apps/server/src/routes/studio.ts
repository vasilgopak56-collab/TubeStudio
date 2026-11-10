// Выпуск 1 «Темы и сценарий»: каналы, Радар «Идеи для канала», сценарий с проверкой, озвучка Lumean.
// Выпуск 2 «Визуал через G-Labs»: сцены, промпты, картинки и клипы, эталоны персонажей, «Мой шаблон» Lumean.
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { ApiError, fail, ok } from "../lib/errors.js";
import { startJob } from "../lib/jobs.js";
import { activateChannel, archiveChannel, channelSpend, createChannel, getChannel, linkJobToChannel, listChannels, updateChannel } from "../services/studio/channels.js";
import { IdeaPeriod, IdeaSort, listIdeas, radarRunning, runRadar, setIdeaStatus, takeIdea } from "../services/studio/radar.js";
import { FactCheckJobInput, StudioScriptInput, lintForChannel, runFactCheck, runStudioScript } from "../services/studio/scriptFlow.js";
import { lintScript } from "../services/studio/scriptLint.js";
import { TemplateQuery, VoiceOrderInput, VoiceQuery, estimateVoice, getTemplate, listTemplates, listVoices, lumeanAccount, lumeanOrders, runVoice } from "../services/studio/lumean.js";
import { checkGlabs } from "../services/studio/glabs.js";
import { checkMontage } from "../services/studio/montageCheck.js";
import { burnMontage, montageBusy, montageState, renderMontage } from "../services/studio/montageRender.js";
import { chooseMusicFolder, musicState, saveMusicTracks } from "../services/studio/montageSound.js";
import { graphicsState, scanGraphics, setGraphicStatus } from "../services/studio/montageGraphics.js";
import { acceptMontage, exportMontage, exportState, montageExporting } from "../services/studio/montageExport.js";
import { publishState, removeThumbnail, saveCard, saveThumbnail, saveVideoLink } from "../services/studio/publishCard.js";
import { snapshotsState } from "../services/studio/publishSnapshots.js";
import { PublishTextInput, publishTextBusy, runPublishText } from "../services/studio/publishText.js";
import { ImportInput, PromptsInput, REDO_REASONS, RenderInput, buildScenes, editScene, exportBoard, generateCastImage, importPreview, listFolders, runImport, runRender, saveCastImage, saveImportFolders, syncCast, videoSpend, visualBusy, visualState, writePrompts, type ExportKind } from "../services/studio/visual.js";

export const studioRoute = new Hono();
const tooBig = (c: Context) => c.json({ ok: false, error: { code: "VALIDATION", message: "Слишком большой запрос" } }, 413);
const small = bodyLimit({ maxSize: 1024 * 1024, onError: tooBig });
/** Эталон персонажа — картинка до 12 МБ (в base64 ~16 МБ). */
const large = bodyLimit({ maxSize: 17 * 1024 * 1024, onError: (c) => c.json({ ok: false, error: { code: "VALIDATION", message: "Картинка больше 12 МБ — уменьшите её" } }, 413) });
studioRoute.use("/studio/*", (c, next) => (/\/cast\/[A-Za-z0-9]+\/image$|\/publish\/projects\/[\w-]+\/thumbnail$/.test(c.req.path) ? large(c, next) : small(c, next)));
const body = async (c: Context): Promise<unknown> => { try { return await c.req.json(); } catch { throw new ApiError("VALIDATION", "Некорректный JSON запроса"); } };
const handle = (fn: (c: Context) => Promise<unknown>) => async (c: Context) => { try { return ok(c, await fn(c)); } catch (e) { return fail(c, e); } };
const Id = z.string().uuid("Неверный номер канала");
const VideoId = z.string().regex(/^[\w-]{11}$/, "Неверный номер ролика");
/** Задача помечается каналом: расходы делятся между каналами. */
const job = async (channelId: string, kind: string, fn: Parameters<typeof startJob>[0], projectId?: string) => {
  const jobId = startJob(fn);
  await linkJobToChannel(jobId, channelId, kind, projectId).catch(() => {});
  return { jobId };
};

// ---------- каналы ----------
studioRoute.get("/studio/channels", handle(async (c) => {
  const [{ activeId, channels }, spend] = await Promise.all([listChannels({ archived: c.req.query("archived") === "1" }), channelSpend().catch(() => ({}))]);
  return { activeId, channels, spend };
}));
studioRoute.post("/studio/channels", handle(async (c) => createChannel(await body(c))));
studioRoute.get("/studio/channels/:id", handle(async (c) => getChannel(Id.parse(c.req.param("id")))));
studioRoute.patch("/studio/channels/:id", handle(async (c) => updateChannel(Id.parse(c.req.param("id")), await body(c))));
studioRoute.post("/studio/channels/:id/activate", handle(async (c) => activateChannel(Id.parse(c.req.param("id")))));
studioRoute.post("/studio/channels/:id/archive", handle(async (c) => {
  const { archived } = z.object({ archived: z.boolean().default(true) }).strict().parse(await body(c));
  return archiveChannel(Id.parse(c.req.param("id")), archived);
}));

// ---------- Радар «Идеи для канала» ----------
const Show = z.enum(["active", "hidden", "taken", "rejected", "all"]);
studioRoute.get("/studio/channels/:id/ideas", handle(async (c) => listIdeas(Id.parse(c.req.param("id")), {
  sort: IdeaSort.catch("new").parse(c.req.query("sort") ?? "new"),
  show: Show.catch("active").parse(c.req.query("show") ?? "active"),
  period: IdeaPeriod.catch("all").parse(c.req.query("period") ?? "all"),
  limit: Math.min(300, Math.max(1, Number(c.req.query("limit")) || 120)),
})));
studioRoute.post("/studio/channels/:id/radar", handle(async (c) => {
  const id = Id.parse(c.req.param("id"));
  await getChannel(id);
  if (radarRunning(id)) throw new ApiError("VALIDATION", "Радар этого канала уже ищет идеи. Дождитесь окончания.", 409);
  return job(id, "radar", (ctx) => runRadar(id, ctx));
}));
studioRoute.post("/studio/channels/:id/ideas/:videoId/:action", handle(async (c) => {
  const id = Id.parse(c.req.param("id")), videoId = VideoId.parse(c.req.param("videoId"));
  const action = z.enum(["hide", "unhide", "take"]).parse(c.req.param("action"));
  if (action === "take") return takeIdea(id, videoId);
  return setIdeaStatus(id, videoId, action === "hide" ? "hidden" : "new");
}));

// ---------- сценарий ----------
const LintInput = z.object({
  text: z.string().min(1, "Вставьте текст сценария").max(200_000),
  channelId: z.string().uuid().optional(), language: z.string().trim().max(5).optional(), minutes: z.number().min(1).max(120).optional(),
}).strict();
/** Бесплатная проверка кодом: ошибки и предупреждения с номером абзаца и временем. */
studioRoute.post("/studio/script/lint", handle(async (c) => {
  const i = LintInput.parse(await body(c));
  if (i.channelId) return lintForChannel(i.text, await getChannel(i.channelId), i.minutes);
  return lintScript(i.text, { language: i.language, targetMinutes: i.minutes });
}));
const SaveInput = z.object({ projectId: z.string().trim().min(1).max(80), artifactId: z.string().trim().min(1).max(80), script: z.string().min(20, "Сценарий слишком короткий").max(200_000) }).strict();
/** Правка сценария вручную: сохраняется в проект и сразу проверяется заново. */
studioRoute.post("/studio/script/save", handle(async (c) => {
  const i = SaveInput.parse(await body(c));
  const { getProject, updateArtifactData } = await import("../services/projects.js");
  const p = await getProject(i.projectId);
  const a = p.artifacts.find((x) => x.id === i.artifactId && x.kind === "script");
  if (!a) throw new ApiError("NOT_FOUND", "Сценарий в проекте не найден", 404);
  const chId = p.channelId ?? ((a.data as { studio?: { channelId?: string } } | undefined)?.studio?.channelId);
  const ch = chId ? await getChannel(chId).catch(() => null) : null;
  const lint = ch ? lintForChannel(i.script, ch) : lintScript(i.script);
  await updateArtifactData(p.id, a.id, (d: Record<string, any> | undefined) => ({ ...(d ?? {}), script: i.script, studio: { ...(d?.studio ?? {}), lint, editedAt: new Date().toISOString() } }));
  return { lint };
}));
/** Проверка фактов (платно): сценарий проекта — исправленный текст сохраняется в проект; вставленный текст — возвращается. */
studioRoute.post("/studio/script/factcheck", handle(async (c) => {
  const i = FactCheckJobInput.parse(await body(c));
  await getChannel(i.channelId);
  if (i.projectId) {
    const { getProject } = await import("../services/projects.js");
    const p = await getProject(i.projectId);
    if (!p.artifacts.some((a) => a.kind === "script" && (!i.artifactId || a.id === i.artifactId))) throw new ApiError("NOT_FOUND", "Сценарий в проекте не найден", 404);
  }
  return job(i.channelId, "factcheck", (ctx) => runFactCheck(i, ctx), i.projectId);
}));
studioRoute.post("/studio/script", handle(async (c) => {
  const i = StudioScriptInput.parse(await body(c));
  await getChannel(i.channelId);
  return job(i.channelId, "script", (ctx) => runStudioScript(i, ctx));
}));

// ---------- озвучка Lumean ----------
studioRoute.get("/studio/voice/account", handle(async () => lumeanAccount()));
studioRoute.get("/studio/voice/voices", handle(async (c) => listVoices({
  service: c.req.query("service") as z.input<typeof VoiceQuery>["service"], search: c.req.query("search") ?? "", language: c.req.query("language") ?? "",
  gender: (c.req.query("gender") ?? "") as z.input<typeof VoiceQuery>["gender"], page: Number(c.req.query("page")) || 0, clones: c.req.query("clones") === "1",
})));
const EstimateInput = z.object({ channelId: z.string().uuid(), projectId: z.string().trim().max(80).optional(), text: z.string().max(200_000).optional(), mode: z.enum(["whole", "paragraph"]).optional() }).strict();
/** Бесплатная оценка: части, стоимость, остаток счёта и не отправлялся ли уже этот текст. */
studioRoute.post("/studio/voice/estimate", handle(async (c) => {
  const i = EstimateInput.parse(await body(c));
  let text = i.text;
  if (!text && i.projectId) {
    const { getProject } = await import("../services/projects.js");
    const p = await getProject(i.projectId);
    text = ([...p.artifacts].reverse().find((a) => a.kind === "script")?.data as { script?: string } | undefined)?.script;
  }
  if (!text?.trim()) throw new ApiError("VALIDATION", "Нет текста для озвучки: выберите проект со сценарием или вставьте текст", 400);
  return estimateVoice(i.channelId, text, i.mode);
}));
studioRoute.post("/studio/voice", handle(async (c) => {
  const i = VoiceOrderInput.parse(await body(c));
  await getChannel(i.channelId);
  return job(i.channelId, "voice", (ctx) => runVoice(i, ctx), i.projectId);
}));
studioRoute.get("/studio/voice/orders", handle(async () => ({ orders: (await lumeanOrders()).slice(0, 100) })));
studioRoute.get("/studio/voice/templates", handle(async (c) => listTemplates({
  search: c.req.query("search") ?? "", service: (c.req.query("service") ?? "") as z.input<typeof TemplateQuery>["service"],
  folderId: c.req.query("folderId") ?? "", page: Math.max(1, Number(c.req.query("page")) || 1),
})));
studioRoute.get("/studio/voice/templates/:tid", handle(async (c) => getTemplate(c.req.param("tid") ?? "")));

// ---------- Визуал: G-Labs (Выпуск 2) ----------
const ProjectId = z.string().regex(/^[\w-]{1,80}$/, "Неверный номер проекта");
const CastName = z.string().regex(/^[A-Za-z][A-Za-z0-9]{2,31}$/, "Неверное имя персонажа");
const pid = (c: Context) => ProjectId.parse(c.req.param("projectId"));
studioRoute.get("/studio/visual/glabs", handle(async () => checkGlabs()));
studioRoute.get("/studio/visual/projects/:projectId", handle(async (c) => ({ ...(await visualState(pid(c))), reasons: REDO_REASONS })));
/** Папка ролика: что найдено; подтягивание — задачей, без платных запросов. */
studioRoute.get("/studio/visual/projects/:projectId/import", handle(async (c) => importPreview(pid(c))));
/** Дерево папок компьютера для выбора источников: только имена папок. */
studioRoute.get("/studio/folders", handle(async (c) => listFolders(c.req.query("path"))));
studioRoute.put("/studio/visual/projects/:projectId/import/folders", handle(async (c) => saveImportFolders(pid(c), (await body(c)) as never)));
studioRoute.post("/studio/visual/projects/:projectId/import", handle(async (c) => {
  const id = pid(c), i = ImportInput.parse(await body(c));
  await getChannel(i.channelId);
  if (visualBusy(id)) throw new ApiError("VALIDATION", "В этом проекте уже идёт работа «Визуала». Дождитесь окончания.", 409);
  return job(i.channelId, "visual-import", (ctx) => runImport(id, ctx), id);
}));
/** Расход по ролику и балансы: только чтение, платных запросов нет. */
studioRoute.get("/studio/visual/projects/:projectId/spend", handle(async (c) => videoSpend(pid(c))));
/** Нарезка на сцены — бесплатно, кодом. */
studioRoute.post("/studio/visual/projects/:projectId/scenes", handle(async (c) => buildScenes(pid(c), (await body(c)) as never)));
/** Промпты: черновик бесплатно и сразу; моделью — платно, задачей с подтверждением цены. */
studioRoute.post("/studio/visual/projects/:projectId/prompts", handle(async (c) => {
  const id = pid(c), i = PromptsInput.parse(await body(c));
  await getChannel(i.channelId);
  if (i.free) return { result: await writePrompts(id, i) };
  if (visualBusy(id)) throw new ApiError("VALIDATION", "В этом проекте уже идёт работа «Визуала». Дождитесь окончания.", 409);
  return job(i.channelId, "visual-prompts", (ctx) => writePrompts(id, i, ctx), id);
}));
studioRoute.patch("/studio/visual/projects/:projectId/scenes/:n", handle(async (c) => {
  const n = z.coerce.number().int().min(1).max(5000).parse(c.req.param("n"));
  return editScene(pid(c), n, (await body(c)) as never);
}));
/** Картинки или клипы в G-Labs: квота аккаунтов G-Labs, деньги TubeStudio не тратятся. */
studioRoute.post("/studio/visual/projects/:projectId/render", handle(async (c) => {
  const id = pid(c), i = RenderInput.parse(await body(c));
  await getChannel(i.channelId);
  if (visualBusy(id)) throw new ApiError("VALIDATION", "В этом проекте уже идёт работа «Визуала». Дождитесь окончания или остановите её.", 409);
  return job(i.channelId, i.what === "images" ? "visual-images" : "visual-clips", (ctx) => runRender(id, i, ctx), id);
}));
studioRoute.get("/studio/visual/projects/:projectId/export/:kind", async (c) => {
  try {
    const kind = z.enum(["images.txt", "motion.txt", "scenes.json"]).parse(c.req.param("kind")) as ExportKind;
    const { body: text, name } = await exportBoard(pid(c), kind);
    return c.body(text, 200, { "content-type": kind === "scenes.json" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${name}"` });
  } catch (e) { return fail(c, e); }
});

/** Автомонтаж: проверка файлов перед сборкой. Только чтение, платных запросов нет. */
// ---------- публикация (Выпуск 4) ----------
studioRoute.get("/studio/publish/projects/:projectId", handle(async (c) => publishState(pid(c))));
studioRoute.put("/studio/publish/projects/:projectId", handle(async (c) => saveCard(pid(c), await body(c))));
/** Платный текстовый запрос: задача ждёт отдельного подтверждения автора. */
studioRoute.post("/studio/publish/projects/:projectId/seo", handle(async (c) => {
  const id = pid(c), raw = await body(c), i = PublishTextInput.parse(raw);
  await getChannel(i.channelId);
  if (publishTextBusy(id)) throw new ApiError("VALIDATION", "Тексты для этого ролика уже готовятся.", 409);
  return job(i.channelId, "publish-seo", (ctx) => runPublishText(id, raw, ctx), id);
}));
studioRoute.put("/studio/publish/projects/:projectId/thumbnail", handle(async (c) => saveThumbnail(pid(c), await body(c))));
studioRoute.delete("/studio/publish/projects/:projectId/thumbnail", handle(async (c) => removeThumbnail(pid(c))));
studioRoute.put("/studio/publish/projects/:projectId/video", handle(async (c) => saveVideoLink(pid(c), await body(c))));
studioRoute.get("/studio/publish/projects/:projectId/snapshots", handle(async (c) => snapshotsState(pid(c))));

studioRoute.get("/studio/montage/projects/:projectId/check", handle(async (c) => checkMontage(pid(c))));
studioRoute.get("/studio/montage/projects/:projectId", handle(async (c) => { const id = pid(c); return { ...(await montageState(id)), ...(await exportState(id)) }; }));
/** Ручное принятие именно того файла, который автор посмотрел. */
studioRoute.post("/studio/montage/projects/:projectId/accept", handle(async (c) => { const id = pid(c); musicIdle(id); return acceptMontage(id, (await body(c)) as never); }));
/** Сохранение принятого ролика в папку автора. */
studioRoute.post("/studio/montage/projects/:projectId/export", handle(async (c) => {
  const id = pid(c), i = z.object({ channelId: Id, folder: z.string().min(1).max(1000) }).strict().parse(await body(c));
  await getChannel(i.channelId);
  musicIdle(id);
  if (montageExporting(id)) throw new ApiError("VALIDATION", "Файлы этого ролика уже сохраняются.", 409);
  return job(i.channelId, "montage-export", (ctx) => exportMontage(id, i.folder, ctx), id);
}));
/** Музыка ролика: своя папка у каждого проекта, треки копируются в проект. */
const musicIdle = (id: string) => { if (montageBusy(id)) throw new ApiError("VALIDATION", "Идёт сборка этого ролика. Дождитесь окончания.", 409); };
studioRoute.get("/studio/montage/projects/:projectId/music", handle(async (c) => musicState(pid(c))));
studioRoute.put("/studio/montage/projects/:projectId/music/folder", handle(async (c) => { const id = pid(c); musicIdle(id); return chooseMusicFolder(id, (await body(c)) as never); }));
studioRoute.put("/studio/montage/projects/:projectId/music/tracks", handle(async (c) => { const id = pid(c); musicIdle(id); return saveMusicTracks(id, (await body(c)) as never); }));
/** Карты и таймлайн: программа предлагает, автор подтверждает. Платных запросов нет. */
studioRoute.get("/studio/montage/projects/:projectId/graphics", handle(async (c) => graphicsState(pid(c))));
studioRoute.post("/studio/montage/projects/:projectId/graphics/scan", handle(async (c) => { const id = pid(c); musicIdle(id); return scanGraphics(id); }));
studioRoute.patch("/studio/montage/projects/:projectId/graphics/:n", handle(async (c) => {
  const id = pid(c); musicIdle(id);
  return setGraphicStatus(id, z.coerce.number().int().min(1).max(5000).parse(c.req.param("n")), (await body(c)) as never);
}));
/** Сборка черновика: долгая задача на этом компьютере, платных запросов нет. */
studioRoute.post("/studio/montage/projects/:projectId/render", handle(async (c) => {
  const id = pid(c), { channelId } = z.object({ channelId: Id }).strict().parse(await body(c));
  await getChannel(channelId);
  if (visualBusy(id)) throw new ApiError("VALIDATION", "В этом проекте идёт работа «Визуала». Дождитесь окончания.", 409);
  if (montageBusy(id)) throw new ApiError("VALIDATION", "Сборка этого ролика уже идёт.", 409);
  if (montageExporting(id)) throw new ApiError("VALIDATION", "Идёт сохранение файлов этого ролика. Дождитесь окончания.", 409);
  return job(channelId, "montage-render", (ctx) => renderMontage(id, ctx), id);
}));
/** Вшивание субтитров в готовый черновик: долгая задача, платных запросов нет. */
studioRoute.post("/studio/montage/projects/:projectId/burn", handle(async (c) => {
  const id = pid(c), { channelId } = z.object({ channelId: Id }).strict().parse(await body(c));
  await getChannel(channelId);
  if (montageBusy(id)) throw new ApiError("VALIDATION", "Сборка этого ролика уже идёт.", 409);
  if (montageExporting(id)) throw new ApiError("VALIDATION", "Идёт сохранение файлов этого ролика. Дождитесь окончания.", 409);
  return job(channelId, "montage-burn", (ctx) => burnMontage(id, ctx), id);
}));

// ---------- персонажи и локации канала: эталоны ----------
studioRoute.post("/studio/channels/:id/cast/:name/image", handle(async (c) => {
  const { image } = z.object({ image: z.string().min(100).max(17 * 1024 * 1024) }).strict().parse(await body(c));
  return saveCastImage(Id.parse(c.req.param("id")), CastName.parse(c.req.param("name")), image);
}));
studioRoute.post("/studio/channels/:id/cast/:name/generate", handle(async (c) => {
  const id = Id.parse(c.req.param("id")), name = CastName.parse(c.req.param("name"));
  await getChannel(id);
  return job(id, "visual-cast", (ctx) => generateCastImage(id, name, ctx));
}));
studioRoute.post("/studio/channels/:id/cast/sync", handle(async (c) => syncCast(Id.parse(c.req.param("id")))));
