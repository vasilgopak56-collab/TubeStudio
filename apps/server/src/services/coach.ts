import crypto from "node:crypto";
import fs from "node:fs/promises";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import type { JobCtx } from "../lib/jobs.js";
import { dataPath, readJson, writeJson } from "../lib/storage.js";
import { checkCancelled, withTaskSignal } from "../lib/taskContext.js";
import { listReports, loadReport } from "./analysis.js";
import { getProject, listProjects } from "./projects.js";
import { generateText } from "./llm.js";
import { fill, readPrompt } from "./prompts.js";
import { LANG_NAME } from "./languages.js";
import { getSettings } from "./settings.js";
const ID = z.string().uuid();
const Language = z.string().refine(v => Object.hasOwn(LANG_NAME, v), "Неизвестный язык");
export const COACH_LIMITS = { turns: 8, questionChars: 4000, answerChars: 10000, requestChars: 60000, contextChars: 22000 };
export const CoachCreate = z.object({ title: z.string().trim().max(120).default(""), reportId: ID.optional(), projectId: ID.optional() });
export const CoachAsk = z.object({ id: ID, question: z.string().trim().min(3).max(COACH_LIMITS.questionChars), language: Language.optional() });
export const CoachSend = CoachAsk.extend({ previewHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type CoachRequest = { selection: z.infer<typeof CoachAsk> & { language: string }; system: string; user: string; hash: string };
const requestHash = (r: Omit<CoachRequest, "hash">) => crypto.createHash("sha256").update(JSON.stringify({ selection: r.selection, system: r.system, user: r.user })).digest("hex");
export type CoachContext = { capturedAt: string; sources: { kind: "report" | "project"; id: string; title: string; savedAt: string }[]; data: Record<string, unknown>; warnings: string[] };
export type CoachMessage = { role: "user" | "assistant"; text: string; at: string; language?: string; model?: string };
export type CoachConversation = { version: 1; id: string; rootId: string; parentId?: string; title: string; createdAt: string; updatedAt: string; context: CoachContext; messages: CoachMessage[]; lastRequest?: CoachRequest };
export async function coachSources() {
  const [reports, projects] = await Promise.all([listReports(), listProjects()]);
  return {
    reports: reports.filter(r => ID.safeParse(r.id).success).sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 50).map(r => ({ id: r.id, title: r.title, savedAt: r.createdAt })),
    projects: projects.filter(p => ID.safeParse(p.id).success).slice(0, 50).map(p => ({ id: p.id, title: p.title, savedAt: p.updatedAt })),
  };
}
const numeric = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
export async function buildCoachContext(input: z.infer<typeof CoachCreate>): Promise<CoachContext> {
  const context: CoachContext = { capturedAt: new Date().toISOString(), sources: [], data: {}, warnings: [] };
  function clip(value: unknown, max: number, label: string) {
    if (typeof value !== "string") return "";
    if (value.length > max) context.warnings.push(`${label}: переданы первые ${max} из ${value.length} символов.`);
    return value.slice(0, max);
  }
  if (input.reportId) {
    if (!ID.safeParse(input.reportId).success) throw new ApiError("VALIDATION", "Некорректный ID отчёта");
    const r = await loadReport(input.reportId);
    if (!r || r.id !== input.reportId || !r.channel || !Array.isArray(r.videos)) throw new ApiError("NOT_FOUND", "Сохранённый анализ не найден или повреждён", 404);
    const title = clip(r.channel.title, 300, "Название канала");
    context.sources.push({ kind: "report", id: r.id, title, savedAt: r.createdAt });
    const top = [...r.videos].sort((a,b) => (numeric(b.views) ?? -1) - (numeric(a.views) ?? -1)).slice(0, 5);
    context.data.report = {
      id: r.id, savedAt: r.createdAt, channel: { id: r.channel.id, title, subscribers: r.channel.hiddenSubscribers || r.channel.subscriberCountKnown === false ? null : numeric(r.channel.subscribers), description: clip(r.channel.description, 800, "Описание канала") },
      sample: { size: numeric(r.stats?.sampleSize), type: r.params?.type, averageViews: numeric(r.stats?.avgViews), medianViews: numeric(r.stats?.medianViews), engagementPct: numeric(r.stats?.engagement) },
      topVideos: top.map(v => ({ id: v.id, title: clip(v.title, 300, "Название видео"), publishedAt: v.publishedAt, views: v.viewsKnown === false ? null : numeric(v.views), outlier: v.viewsKnown === false ? null : numeric(v.outlier) })),
      previousAiPlan: (r.insights?.diagnosis?.plan ?? []).slice(0, 4).map(t => clip(t, 600, "Предыдущий AI-план")),
    };
    context.warnings.push(`Анализ — сохранённый снимок от ${r.createdAt}; не обновляется из YouTube. Переданы сводка, до 5 видео из ${r.videos.length} и до 4 пунктов прежнего AI-плана, а не весь отчёт. Показатели зависят от старой выборки; прежний AI-план не является проверенным фактом.`);
  }
  if (input.projectId) {
    if (!ID.safeParse(input.projectId).success) throw new ApiError("VALIDATION", "Некорректный ID проекта");
    const p = await getProject(input.projectId);
    if (p.id !== input.projectId || !Array.isArray(p.artifacts)) throw new ApiError("NOT_FOUND", "Проект повреждён", 404);
    const title = clip(p.title, 300, "Название проекта");
    context.sources.push({ kind: "project", id: p.id, title, savedAt: p.updatedAt });
    const latest = [...p.artifacts].reverse().find(a => a.kind === "script"); const d = latest?.data as any;
    const script = typeof d === "string" ? d : d?.script;
    context.data.project = { id: p.id, title, niche: clip(p.niche, 400, "Ниша проекта"), savedAt: p.updatedAt, artifactCount: p.artifacts.length, latestScript: latest ? { id: latest.id, savedAt: latest.createdAt, title: clip(latest.title, 300, "Название сценария"), text: clip(script, 12000, "Сценарий") } : null };
    context.warnings.push("Из проекта переданы название, ниша, количество артефактов и текст последней версии сценария (до 12 000 символов). Другие артефакты, файлы, аудио, картинки и их содержимое не передаются.");
    if (latest && typeof script !== "string") context.warnings.push("Последний сценарий не содержит распознаваемого текстового поля: его текст не передан.");
  }
  if (!context.sources.length) context.warnings.push("Источники не выбраны. Доступны только ваши сообщения и общие знания модели, без данных канала/проекта.");
  if (JSON.stringify(context).length > COACH_LIMITS.contextChars) throw new ApiError("VALIDATION", "Выбранный контекст превышает лимит 22 000 символов. Создайте диалог с одним источником.");
  return context;
}
async function save(c: CoachConversation, ctx?: JobCtx) {
  checkCancelled(ctx?.signal);
  try { await writeJson(`coach-runs/${c.id}.json`, c); checkCancelled(ctx?.signal); }
  catch(e) { if (ctx?.signal.aborted) await fs.rm(dataPath(`coach-runs/${c.id}.json`), { force: true }); throw e; }
  return c;
}
export async function createCoach(input: z.infer<typeof CoachCreate>) {
  const context = await buildCoachContext(input), id = crypto.randomUUID(), now = new Date().toISOString();
  return save({ version: 1, id, rootId: id, title: input.title || "Диалог с AI Coach", createdAt: now, updatedAt: now, context, messages: [] });
}
const StoredRequest = z.object({ selection: CoachAsk.extend({ language: Language }), system: z.string().max(COACH_LIMITS.requestChars), user: z.string().max(COACH_LIMITS.requestChars), hash: z.string().regex(/^[a-f0-9]{64}$/) });
const StoredCoach = z.object({
  version: z.literal(1), id: ID, rootId: ID, parentId: ID.optional(), title: z.string().max(120), createdAt: z.string(), updatedAt: z.string(),
  context: z.object({ capturedAt: z.string(), sources: z.array(z.object({ kind: z.enum(["report", "project"]), id: ID, title: z.string().max(300), savedAt: z.string() })).max(2), data: z.record(z.string(), z.unknown()), warnings: z.array(z.string()) }),
  lastRequest: StoredRequest.optional(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(COACH_LIMITS.answerChars), at: z.string(), language: z.string().optional(), model: z.string().optional() })).max(COACH_LIMITS.turns * 2),
});
export async function loadCoach(id: string) {
  if (!ID.safeParse(id).success) return null;
  const c = await readJson<CoachConversation | null>(`coach-runs/${id}.json`, null);
  const parsed = StoredCoach.safeParse(c);
  if (!parsed.success || parsed.data.id !== id || parsed.data.messages.length % 2 || parsed.data.messages.some((m,i) => m.role !== (i % 2 ? "assistant" : "user"))) return null;
  const r = parsed.data.lastRequest;
  if (r && (requestHash(r) !== r.hash || r.system.length + r.user.length > COACH_LIMITS.requestChars || r.selection.id !== parsed.data.parentId || r.selection.question !== parsed.data.messages.at(-2)?.text || r.selection.language !== parsed.data.messages.at(-1)?.language || r.user !== JSON.stringify({ context: parsed.data.context, conversation: parsed.data.messages.slice(0, -2).map(m => ({ role: m.role, text: m.text })), question: r.selection.question }))) return null;
  return parsed.data as CoachConversation;
}
export async function listCoach() {
  const names = await fs.readdir(dataPath("coach-runs")).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return []; throw e; });
  const rows = [];
  for (const name of names) {
    if (!name.endsWith(".json") || !ID.safeParse(name.slice(0, -5)).success) continue;
    const c = await loadCoach(name.slice(0, -5));
    if (c && Number.isFinite(Date.parse(c.updatedAt))) rows.push({ id: c.id, rootId: c.rootId, title: c.title, updatedAt: c.updatedAt, turns: c.messages.filter(m => m.role === "assistant").length, sources: c.context.sources.map(s => s.title) });
  }
  return rows.sort((a,b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 50);
}
/** Local preparation only. No provider call, writes, or live source reload. */
export async function previewCoach(input: z.infer<typeof CoachAsk>): Promise<CoachRequest> {
  const d = CoachAsk.parse(input), c = await loadCoach(d.id);
  if (!c) throw new ApiError("NOT_FOUND", "Диалог не найден", 404);
  if (c.messages.filter(m => m.role === "assistant").length >= COACH_LIMITS.turns) throw new ApiError("VALIDATION", "Достигнут лимит 8 ответов. Создайте новый диалог; старый остаётся в истории.");
  const language = d.language ?? (await getSettings()).contentLanguage;
  const selection = { id: d.id, question: d.question, language };
  const user = JSON.stringify({ context: c.context, conversation: c.messages.map(m => ({ role: m.role, text: m.text })), question: d.question });
  const system = fill(await readPrompt("coach/chat.md"), { language: LANG_NAME[language] ?? language });
  if (user.length + system.length > COACH_LIMITS.requestChars) throw new ApiError("VALIDATION", "Контекст и переписка превышают 60 000 символов. Создайте новый диалог; скрытое обрезание не выполняется.");
  return { selection, system, user, hash: requestHash({ selection, system, user }) };
}
export async function askCoach(input: z.infer<typeof CoachSend>, ctx: JobCtx) {
  return withTaskSignal(ctx.signal, async () => {
    checkCancelled(); const d = CoachSend.parse(input), request = await previewCoach(d);
    if (d.previewHash !== request.hash) throw new ApiError("VALIDATION", "Диалог, вопрос, язык или промпт изменились. Обновите предпросмотр перед отправкой в AI.", 409);
    const c = await loadCoach(d.id);
    if (!c) throw new ApiError("NOT_FOUND", "Диалог не найден", 404);
    // Prevent a changed on-disk snapshot from being paired with the reviewed request.
    if (request.user !== JSON.stringify({ context: c.context, conversation: c.messages.map(m => ({ role: m.role, text: m.text })), question: d.question })) throw new ApiError("VALIDATION", "Диалог изменился. Обновите предпросмотр.", 409);
    const { system, user } = request, { language, question } = request.selection;
    ctx.progress("Готовлю ответ по закреплённому контексту (AI)", 30); checkCancelled();
    const response = await generateText({ system, user, temperature: .4, maxTokens: 4500 }); checkCancelled();
    const text = response.text.trim();
    if (!text || text.length > COACH_LIMITS.answerChars) throw new ApiError("UPSTREAM", "Ответ модели пуст или длиннее 10 000 символов. Ответ не сохранён; исходный диалог не изменён. Уже выполненный запрос может быть оплачен.", 502);
    const now = new Date().toISOString();
    const next: CoachConversation = { ...c, id: crypto.randomUUID(), parentId: c.id, updatedAt: now, lastRequest: request, messages: [...c.messages, { role: "user", text: question, at: now, language }, { role: "assistant", text, at: now, language, model: response.model }] };
    ctx.progress("Сохраняю новый снимок диалога", 95);
    return save(next, ctx);
  });
}
