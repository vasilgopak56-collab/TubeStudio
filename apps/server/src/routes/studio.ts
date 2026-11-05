// Выпуск 1 «Темы и сценарий»: каналы, Радар «Идеи для канала», сценарий с проверкой, озвучка Lumean.
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { ApiError, fail, ok } from "../lib/errors.js";
import { startJob } from "../lib/jobs.js";
import { activateChannel, archiveChannel, channelSpend, createChannel, getChannel, linkJobToChannel, listChannels, updateChannel } from "../services/studio/channels.js";
import { IdeaPeriod, IdeaSort, listIdeas, radarRunning, runRadar, setIdeaStatus, takeIdea } from "../services/studio/radar.js";
import { StudioScriptInput, lintForChannel, runStudioScript } from "../services/studio/scriptFlow.js";
import { lintScript } from "../services/studio/scriptLint.js";
import { VoiceOrderInput, VoiceQuery, estimateVoice, listVoices, lumeanAccount, lumeanOrders, runVoice } from "../services/studio/lumean.js";

export const studioRoute = new Hono();
studioRoute.use("/studio/*", bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ ok: false, error: { code: "VALIDATION", message: "Слишком большой запрос" } }, 413) }));
const body = async (c: Context): Promise<unknown> => { try { return await c.req.json(); } catch { throw new ApiError("VALIDATION", "Некорректный JSON запроса"); } };
const handle = (fn: (c: Context) => Promise<unknown>) => async (c: Context) => { try { return ok(c, await fn(c)); } catch (e) { return fail(c, e); } };
const Id = z.string().uuid("Неверный номер канала");
const VideoId = z.string().regex(/^[\w-]{11}$/, "Неверный номер ролика");
/** Задача помечается каналом: расходы делятся между каналами. */
const job = async (channelId: string, kind: string, fn: Parameters<typeof startJob>[0]) => {
  const jobId = startJob(fn);
  await linkJobToChannel(jobId, channelId, kind).catch(() => {});
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
  return job(i.channelId, "voice", (ctx) => runVoice(i, ctx));
}));
studioRoute.get("/studio/voice/orders", handle(async () => ({ orders: (await lumeanOrders()).slice(0, 100) })));
