// Визуал (Выпуск 2): озвучка → сцены 4–8 с → промпты → картинки и клипы в G-Labs → проверка → файлы для монтажа.
// Всё состояние — в материале «Раскадровка» проекта: номера заданий G-Labs сохраняются, поэтому после
// перезапуска TubeStudio или G-Labs работа продолжается с того же места, а готовое не делается второй раз.
// Файлы: data/files/<проект>/visual/001.png, 001_anim.mp4, prompts_images.txt, prompts_motion.txt, scenes.json.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ApiError } from "../../lib/errors.js";
import { dataPath } from "../../lib/storage.js";
import { checkCancelled, rethrowCancelled, runTask, taskContext, taskSignal } from "../../lib/taskContext.js";
import { sleep } from "../../lib/http.js";
import type { JobCtx } from "../../lib/jobs.js";
import { log } from "../../lib/logging.js";
import { getChannel, updateChannel, type CastItemT, type Channel } from "./channels.js";
import { voiceText } from "./lumean.js";
import { cutScenes, parseSubtitles, shotFor, timeScenes, wordsPerSecond, type Cue } from "./scenes.js";
import * as G from "./glabs.js";
import { draftScene, imagePrompt, modelPrompts, motionPrompt, normalizeTags, referencePrompt, shouldAnimate, styleKit, type StyleKit } from "./visualPrompts.js";

export type Gen = {
  state: "none" | "queued" | "running" | "done" | "failed" | "waiting";
  file?: string; taskId?: string; base?: string; at?: string; error?: string; attempts: number; resubmits?: number;
  /** Проверка (карточка 280): принято или переделать с одной причиной. */
  verdict?: "accepted" | "redo"; reason?: string; old?: string[]; rewritten?: string;
};
export type Scene = {
  n: number; text: string; start: number; end: number; seconds: number; words: number; paragraph: number; shot: string;
  /** Что в кадре (правится вручную) и движение; image/video — полные промпты, собранные кодом со стилевым ключом. */
  concept: string; motion: string; image: string; video: string; animate: boolean; key?: boolean; cast: string[]; draft?: boolean;
  picture: Gen; clip: Gen;
};
export type Board = {
  source: "studio-visual"; schema: 1; channelId: string; projectId: string; textHash: string; language: string;
  timing: "audio" | "estimate"; matched: number; mode: "rhythm" | "sentence"; maxSec: number;
  style: StyleKit; input: { imageModel: string; videoModel: string; clipSec: number; aspect: "16:9" | "9:16" };
  rows: Scene[]; prompts?: { model?: string; at: string; free?: boolean; notes?: string[] };
  audioArtifactId?: string; audioFile?: string; scriptArtifactId?: string; createdAt: string; updatedAt: string;
  /** Папки с исходниками этого ролика, заданные вручную. Пусто — папка ролика по умолчанию. */
  sources?: { images?: string; clips?: string };
};
const blank = (): Gen => ({ state: "none", attempts: 0 });
const pad = (n: number) => String(n).padStart(3, "0");
const safeId = (id: string) => id.replace(/[^\w-]/g, "");
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

// ---------- проект и раскадровка ----------
async function loadProject(projectId: string) {
  const { getProject } = await import("../projects.js");
  return getProject(projectId);
}
type P = Awaited<ReturnType<typeof loadProject>>;
const boardOf = (p: P) => [...p.artifacts].reverse().find((a) => a.kind === "storyboard" && (a.data as { source?: string } | undefined)?.source === "studio-visual");
function sourceText(p: P) {
  const script = [...p.artifacts].reverse().find((a) => a.kind === "script");
  const audio = [...p.artifacts].reverse().find((a) => a.kind === "audio" && (a.data as { source?: string } | undefined)?.source === "lumean");
  const ad = audio?.data as { text?: string; subtitles?: string[]; audio?: string; durationMs?: number | null } | undefined;
  return { script, audio, ad, scriptText: (script?.data as { script?: string } | undefined)?.script ?? "" };
}

/** Состояние раздела «Визуал» для проекта. */
export async function visualState(projectId: string) {
  const p = await loadProject(projectId);
  const { script, audio, ad, scriptText } = sourceText(p);
  const art = boardOf(p);
  const board = art ? (art.data as Board) : null;
  const words = scriptText ? (scriptText.match(/\S+/g) ?? []).length : 0;
  return {
    project: { id: p.id, title: p.title, channelId: p.channelId ?? null },
    script: script ? { artifactId: script.id, words } : null,
    audio: audio ? { artifactId: audio.id, file: ad?.audio ?? null, subtitles: !!ad?.subtitles?.length, seconds: ad?.durationMs ? Math.round(ad.durationMs / 100) / 10 : null } : null,
    board: board ? { artifactId: art!.id, ...board, stale: !!scriptText && board.textHash !== sha(narration(p)) } : null,
    running: running.get(p.id) ?? null,
  };
}
/** Текст, который звучит в озвучке: из заказа Lumean, иначе из сценария — с той же очисткой разметки, что и при озвучке. */
function narration(p: P): string {
  const { ad, scriptText } = sourceText(p);
  if (ad?.text?.trim()) return ad.text;
  return scriptText ? voiceText(scriptText) : "";
}

async function mutateBoard(projectId: string, artifactId: string, fn: (b: Board) => void): Promise<Board> {
  const { updateArtifactData } = await import("../projects.js");
  let out!: Board;
  await updateArtifactData(projectId, artifactId, (d: Board) => {
    if (!d || d.source !== "studio-visual") throw new ApiError("NOT_FOUND", "Раскадровка не найдена", 404);
    fn(d);
    d.updatedAt = new Date().toISOString();
    out = d;
    return d;
  });
  return out;
}

/** Занятые проекты: одна работа «Визуала» на проект одновременно. Номер задачи — чтобы страница
 *  после перезагрузки показала ход работы и могла её остановить. */
type Busy = { what: "prompts" | "images" | "clips" | "import"; jobId: string | null; since: string };
const running = new Map<string, Busy>();
function lock<T>(projectId: string, what: Busy["what"], fn: () => Promise<T>): Promise<T> {
  const cur = running.get(projectId);
  if (cur) throw new ApiError("VALIDATION", `В этом проекте уже идёт работа: ${cur.what === "prompts" ? "пишутся промпты" : cur.what === "images" ? "делаются картинки" : cur.what === "clips" ? "делаются клипы" : "подтягиваются файлы"}. Дождитесь окончания или остановите её.`, 409);
  running.set(projectId, { what, jobId: taskContext()?.jobId ?? null, since: new Date().toISOString() });
  return fn().finally(() => running.delete(projectId));
}
export const visualBusy = (projectId: string) => running.get(projectId) ?? null;

/** Токенов на сцену в промптах (вход и выход) и запас: реальное списание AnyModel бывает в несколько раз выше журнала. */
const PROMPT_TOKENS_PER_SCENE = 530, BALANCE_MARGIN = 4;
/** Расход по ролику, балансы и сколько нужно на оставшиеся промпты. Только чтение; недоступный баланс — null, а не ноль. */
export async function videoSpend(projectId: string) {
  const p = await loadProject(projectId);
  const { channelJobs } = await import("./channels.js");
  const { getUsage } = await import("../usage.js");
  const { getSettings } = await import("../settings.js");
  const { amBalance, amCatalog } = await import("../anymodel.js");
  const { lumeanAccount } = await import("./lumean.js");
  const [u, jobs, s] = await Promise.all([getUsage(), channelJobs(), getSettings()]);
  let usd = 0, operations = 0, unknown = 0;
  for (const op of u.pricingV1?.operations ?? []) {
    if (!op.jobId || jobs[op.jobId]?.projectId !== p.id) continue;
    operations++;
    if (op.usd === null) unknown++; else usd += op.usd;
  }
  const lumeanUnits = p.artifacts.filter((a) => a.kind === "audio" && (a.data as { source?: string } | undefined)?.source === "lumean").reduce((sum, a) => sum + (Number((a.data as { tokens?: number }).tokens) || 0), 0);
  const art = boardOf(p);
  const remainingScenes = art ? (art.data as Board).rows.filter((r) => !r.concept || r.draft).length : 0;
  const rate = s.anymodel.usdPerMillion;
  const [balance, catalog, account] = await Promise.all([amBalance().catch(() => null), amCatalog().catch(() => []), lumeanAccount().catch(() => null)]);
  const coefficient = catalog.find((m) => m.id === s.anymodel.script)?.billing?.coefficient?.output;
  const needUsd = typeof coefficient === "number" ? remainingScenes * PROMPT_TOKENS_PER_SCENE * coefficient * rate * BALANCE_MARGIN / 1e6 : null;
  return {
    anymodel: { spentUsd: Math.round(usd * 10_000) / 10_000, operations, unknown, balanceUsd: balance ? balance.balance * rate / 1e6 : null, needUsd, remainingScenes, model: s.anymodel.script },
    lumean: { units: lumeanUnits, balanceLmc: account ? account.balance.reduce((sum: number, w: { value: number; locked: number }) => sum + w.value - w.locked, 0) : null },
  };
}

// ---------- 1. сцены (бесплатно, кодом) ----------
export const ScenesInput = z.object({
  channelId: z.string().uuid(), mode: z.enum(["rhythm", "sentence"]).optional(), maxSec: z.number().min(3).max(10).optional(),
  /** Согласие нарезать заново, когда уже есть картинки: старые файлы переедут в папку visual-old-…. */
  replace: z.boolean().default(false),
}).strict();
export async function buildScenes(projectId: string, raw: z.input<typeof ScenesInput>) {
  const i = ScenesInput.parse(raw);
  if (running.has(projectId)) throw new ApiError("VALIDATION", "В проекте идёт работа «Визуала». Дождитесь окончания.", 409);
  const ch = await getChannel(i.channelId);
  const p = await loadProject(projectId);
  const { script, audio, ad } = sourceText(p);
  const text = narration(p);
  if (!text.trim()) throw new ApiError("VALIDATION", "В проекте нет сценария: сначала напишите его в разделе «Сценарий».", 400);
  const mode = i.mode ?? ch.visual.sceneMode, maxSec = i.maxSec ?? ch.visual.maxSceneSec;
  const cuts = cutScenes(text, { language: ch.language, mode, maxSec });
  if (!cuts.length) throw new ApiError("VALIDATION", "Не удалось разделить текст на сцены", 400);
  let cues: Cue[] | null = null;
  const srt = ad?.subtitles?.find((f) => /\.srt$/i.test(f)) ?? ad?.subtitles?.[0];
  if (srt) cues = parseSubtitles(await fs.readFile(dataPath("files", safeId(p.id), ...srt.split("/")), "utf8").catch(() => ""));
  const timed = timeScenes(cuts, { language: ch.language, cues, audioSec: ad?.durationMs ? ad.durationMs / 1000 : null });
  const kit = await styleKit(ch).catch(() => ({ id: "", name: "", anchor: "", motion: "", negative: "", palette: "" }));
  const now = new Date().toISOString();
  const rows: Scene[] = timed.scenes.map((s, k) => ({
    n: k + 1, text: s.text, start: s.start, end: s.end, seconds: s.seconds, words: s.words, paragraph: s.paragraph, shot: shotFor(k),
    concept: "", motion: "", image: "", video: "", animate: shouldAnimate(k + 1, ch.visual, null), cast: [], picture: blank(), clip: blank(),
  }));
  const board: Board = {
    source: "studio-visual", schema: 1, channelId: ch.id, projectId: p.id, textHash: sha(text), language: ch.language,
    timing: timed.timing, matched: timed.matched, mode, maxSec, style: kit,
    input: { imageModel: ch.visual.imageModel, videoModel: ch.visual.videoModel, clipSec: ch.visual.clipSec, aspect: ch.visual.aspect },
    rows, audioArtifactId: audio?.id, audioFile: ad?.audio, scriptArtifactId: script?.id, createdAt: now, updatedAt: now,
  };
  const { addArtifact, updateArtifactData } = await import("../projects.js");
  const old = boardOf(p);
  if (old) {
    const ob = old.data as Board;
    if (ob.sources) board.sources = ob.sources;
    const made = ob.rows.some((r) => r.picture.file || r.clip.file);
    if (made && !i.replace) throw new ApiError("VALIDATION", "Для этих сцен уже есть картинки. Нарезать заново? Готовые файлы переедут в папку visual-old, привязка к сценам начнётся заново.", 409, false, { needReplace: true });
    if (made) {
      const dir = dataPath("files", safeId(p.id), "visual");
      await fs.rename(dir, dataPath("files", safeId(p.id), `visual-old-${now.replace(/[:.]/g, "-")}`)).catch(() => {});
    }
    // Описания кадров переносятся, если текст сцены не изменился.
    const keep = new Map(ob.rows.filter((r) => r.concept).map((r) => [r.text, r]));
    for (const r of rows) { const o = keep.get(r.text); if (o) { r.concept = o.concept; r.motion = o.motion; r.cast = o.cast; r.key = o.key; r.draft = o.draft; r.animate = o.animate; } }
    if (kit.anchor) assemble(board, kit);
    await updateArtifactData(p.id, old.id, () => board);
    return { artifactId: old.id, ...board };
  }
  if (kit.anchor) assemble(board, kit);
  const art = await addArtifact(p.id, { kind: "storyboard", title: `Визуал · ${p.title}`.slice(0, 300), data: board });
  return { artifactId: art.id, ...board };
}
/** Полные промпты из описаний: стилевой ключ — дословно в каждом. */
function assemble(b: Board, kit: StyleKit) {
  b.style = kit;
  for (const r of b.rows) {
    r.image = r.concept ? imagePrompt(r.concept, kit, b.input.aspect) : "";
    r.video = r.animate ? motionPrompt(r.motion, kit) : "";
  }
}

// ---------- 2. промпты (платно моделью или бесплатный черновик) ----------
export const PromptsInput = z.object({
  channelId: z.string().uuid(), scenes: z.array(z.number().int().min(1)).max(2000).optional(),
  free: z.boolean().default(false), note: z.string().trim().max(500).default(""),
  /** Только пустые сцены (без описания) — чтобы не переписывать правки. */
  onlyEmpty: z.boolean().default(false),
}).strict();
export async function writePrompts(projectId: string, raw: z.input<typeof PromptsInput>, ctx?: JobCtx) {
  const i = PromptsInput.parse(raw);
  return lock(projectId, "prompts", async () => {
    const ch = await getChannel(i.channelId);
    const kit = await styleKit(ch);
    const p = await loadProject(projectId);
    const art = boardOf(p);
    if (!art) throw new ApiError("VALIDATION", "Сначала нарежьте сценарий на сцены", 400);
    const b = art.data as Board;
    const want = new Set(i.scenes ?? b.rows.map((r) => r.n));
    // Продолжение платных промптов: черновики тоже считаются незаполненными, написанное моделью не трогаем.
    const resume = i.onlyEmpty && !i.free;
    const targets = b.rows.filter((r) => want.has(r.n) && (!i.onlyEmpty || !r.concept || (resume && r.draft)));
    if (!targets.length) throw new ApiError("VALIDATION", "Нет сцен для промптов", 400);
    const results = new Map<number, { concept: string; motion: string; key: boolean; cast: string[]; draft: boolean }>();
    const notes: string[] = [];
    let model: string | undefined;
    if (i.free) {
      for (const r of targets) { const d = draftScene(r.text, r.shot, ch.visual.cast); results.set(r.n, { ...d, key: false, draft: true }); }
    } else {
      const { assertChannelBudget } = await import("./channels.js");
      await assertChannelBudget(ch.id);
      const BATCH = 12;
      const batches: (typeof targets)[] = [];
      for (let k = 0; k < targets.length; k += BATCH) batches.push(targets.slice(k, k + BATCH));
      // Одно окно цены на весь запуск: без подтверждения ни один запрос не уходит.
      ctx?.progress(`Жду подтверждения цены: ${batches.length} ${batches.length === 1 ? "запрос" : "запросов"}`, 3);
      const { promptsConsent } = await import("./visualPromptsConsent.js");
      const consent = await promptsConsent({ projectId: p.id, ch, kit, note: i.note, batches: batches.map((part) => part.map((s) => ({ n: s.n, text: s.text, seconds: s.seconds, shot: s.shot }))) });
      for (const [index, part] of batches.entries()) {
        const k = index * BATCH;
        checkCancelled();
        await consent.beforeBatch();
        ctx?.progress(`Пишу промпты: сцены ${part[0].n}–${part[part.length - 1].n} из ${b.rows.length}`, 5 + Math.round((k / targets.length) * 90));
        const prev = b.rows.find((r) => r.n === part[0].n - 1);
        const r = await modelPrompts({ ch, kit, scenes: part.map((s) => ({ n: s.n, text: s.text, seconds: s.seconds, shot: s.shot })), previous: results.get(part[0].n - 1)?.concept ?? prev?.concept, note: i.note });
        model = r.model;
        for (const s of part) {
          const got = r.items.find((x) => x.n === s.n);
          if (!got) { const d = draftScene(s.text, s.shot, ch.visual.cast); results.set(s.n, { ...d, key: false, draft: true }); notes.push(`Сцена ${s.n}: модель пропустила — поставлен черновик, поправьте его.`); continue; }
          const t = normalizeTags(got.concept, ch.visual.cast);
          results.set(s.n, { concept: t.concept, motion: got.motion, key: got.key, cast: t.cast, draft: false });
        }
        // Часть оплачена: сохраняем сразу, чтобы сбой на следующей части не потерял её.
        await mutateBoard(p.id, art.id, (d) => {
          for (const r of d.rows) {
            const v = part.some((s) => s.n === r.n) ? results.get(r.n) : undefined;
            if (v) { r.concept = v.concept; r.motion = v.motion; r.cast = v.cast; r.key = v.key; r.draft = v.draft; }
          }
          assemble(d, kit);
        });
      }
    }
    const keys = new Set([...results].filter(([, v]) => v.key).map(([n]) => n));
    const cap = Math.max(2, Math.round(b.rows.length * 0.3));
    const earlierKeys = resume ? b.rows.filter((r) => r.key && !results.has(r.n)).length : 0;
    const keyList = [...keys].slice(0, Math.max(0, cap - earlierKeys));
    const board = await mutateBoard(p.id, art.id, (d) => {
      const animateKeys = new Set(keyList.concat(d.rows.filter((x) => x.key && !results.has(x.n)).map((x) => x.n)));
      for (const r of d.rows) {
        const v = results.get(r.n);
        if (!v) { if (resume && !r.draft) r.animate = shouldAnimate(r.n, ch.visual, animateKeys); continue; }
        r.concept = v.concept; r.motion = v.motion; r.cast = v.cast; r.key = keyList.includes(r.n); r.draft = v.draft;
        r.animate = shouldAnimate(r.n, ch.visual, i.free ? null : animateKeys);
      }
      assemble(d, kit);
      d.input = { imageModel: ch.visual.imageModel, videoModel: ch.visual.videoModel, clipSec: ch.visual.clipSec, aspect: ch.visual.aspect };
      d.prompts = { model, at: new Date().toISOString(), free: i.free, notes };
    });
    await writeExports(p.id, board).catch(() => {});
    ctx?.progress("Готово", 100);
    return { artifactId: art.id, written: results.size, model: model ?? null, free: i.free, notes };
  });
}

// ---------- правка сцены и проверка ----------
export const REDO_REASONS = {
  line: "Не про эту фразу",
  style: "Не тот стиль",
  artifacts: "Искажения: руки, лица, лишний текст",
  cast: "Персонаж не похож",
  framing: "Неудачный кадр или обрезка",
  motion: "Плохое движение в клипе",
} as const;
const FIX: Record<keyof typeof REDO_REASONS, string> = {
  line: "",
  style: "",
  artifacts: "Anatomically correct hands with five fingers, natural faces, no text, no letters, no extra limbs.",
  cast: "Each tagged character looks exactly like its reference image: same face, hair, clothing colours and distinctive detail.",
  framing: "Subject fully inside the frame with comfortable margins, nothing important cut off at the edges.",
  motion: "Subtle, restrained motion, feet planted with physical weight, preserve exact facial structure, no morphing.",
};
export const SceneEdit = z.object({
  concept: z.string().trim().max(1500).optional(), motion: z.string().trim().max(500).optional(), animate: z.boolean().optional(),
  picture: z.object({ verdict: z.enum(["accepted", "redo"]).nullable(), reason: z.enum(Object.keys(REDO_REASONS) as [keyof typeof REDO_REASONS]).optional() }).strict().optional(),
  clip: z.object({ verdict: z.enum(["accepted", "redo"]).nullable(), reason: z.enum(Object.keys(REDO_REASONS) as [keyof typeof REDO_REASONS]).optional() }).strict().optional(),
}).strict();
/** Правка сцены. «Переделать» с причиной меняет в промпте одну вещь (карточка 280) и ставит сцену в очередь. */
export async function editScene(projectId: string, n: number, raw: z.input<typeof SceneEdit>) {
  const e = SceneEdit.parse(raw);
  const p = await loadProject(projectId);
  const art = boardOf(p);
  if (!art) throw new ApiError("NOT_FOUND", "Раскадровка не найдена", 404);
  const ch = await getChannel((art.data as Board).channelId);
  const kit = await styleKit(ch).catch(() => (art.data as Board).style);
  return mutateBoard(p.id, art.id, (d) => {
    const r = d.rows.find((x) => x.n === n);
    if (!r) throw new ApiError("NOT_FOUND", `Сцены ${n} нет`, 404);
    if (e.concept !== undefined) { const t = normalizeTags(e.concept, ch.visual.cast); r.concept = t.concept; r.cast = t.cast; r.draft = false; }
    if (e.motion !== undefined) r.motion = e.motion;
    if (e.animate !== undefined) r.animate = e.animate;
    for (const k of ["picture", "clip"] as const) {
      const v = e[k];
      if (!v) continue;
      const g = r[k];
      if (v.verdict === "redo") {
        if (!g.file && g.state !== "failed") throw new ApiError("VALIDATION", "Переделать можно только готовый или неудавшийся файл", 400);
        g.verdict = "redo"; g.reason = v.reason;
        const fix = v.reason ? FIX[v.reason] : "";
        if (fix) { if (k === "picture" && !r.concept.includes(fix)) r.concept = `${r.concept.replace(/[.\s]+$/, "")}. ${fix}`; if (k === "clip" && !r.motion.includes(fix)) r.motion = `${r.motion.replace(/[.\s]+$/, "")}. ${fix}`.replace(/^\.\s*/, ""); }
        // Новая картинка — старый клип из неё больше не подходит.
        if (k === "picture" && r.clip.file) { r.clip.verdict = "redo"; r.clip.reason = "line"; }
      } else { g.verdict = v.verdict ?? undefined; g.reason = undefined; }
    }
    if (kit?.anchor) { r.image = r.concept ? imagePrompt(r.concept, kit, d.input.aspect) : ""; r.video = r.animate ? motionPrompt(r.motion, kit) : ""; }
  });
}

/** «Оживить все сцены»: отметка «Оживить» у каждой сцены. Без запросов к ИИ: описание движения модель уже написала, промпт клипа собирается кодом. */
export async function animateAll(projectId: string) {
  const p = await loadProject(projectId);
  const art = boardOf(p);
  if (!art) throw new ApiError("NOT_FOUND", "Раскадровка не найдена", 404);
  const ch = await getChannel((art.data as Board).channelId);
  const kit = await styleKit(ch).catch(() => (art.data as Board).style);
  return mutateBoard(p.id, art.id, (d) => {
    for (const r of d.rows) {
      r.animate = true;
      if (kit?.anchor) r.video = motionPrompt(r.motion, kit);
    }
  });
}

// ---------- 3–4. картинки и клипы в G-Labs ----------
export const RenderInput = z.object({
  channelId: z.string().uuid(), what: z.enum(["images", "clips"]), scenes: z.array(z.number().int().min(1)).max(2000).optional(),
}).strict();
type Track = { n: number; taskId: string; resubmits: number; retries: number; viaData: boolean };
export const RENDER_LIMIT = { images: 4, clips: 2 };
export type RenderSummary = { what: "images" | "clips"; total: number; done: number; failed: number; waiting: number; skipped: number; stop: string | null; message: string };

export async function runRender(projectId: string, raw: z.input<typeof RenderInput>, ctx: JobCtx): Promise<RenderSummary> {
  const i = RenderInput.parse(raw);
  return lock(projectId, i.what, async () => {
    const ch = await getChannel(i.channelId);
    const kit = await styleKit(ch);
    const p = await loadProject(projectId);
    const art = boardOf(p);
    if (!art) throw new ApiError("VALIDATION", "Сначала нарежьте сценарий на сцены", 400);
    const base = await G.glabsBase();
    ctx.progress("Проверяю связь с G-Labs", 2);
    const hc = await G.checkGlabs();
    if (!hc.ok) throw new ApiError(hc.code === "KEY_MISSING" ? "KEY_MISSING" : hc.code === "GLABS_PLAN" ? "GLABS_PLAN" : "GLABS_OFFLINE", hc.message, 502);
    const local = hc.local;
    const kind = i.what === "images" ? "picture" : "clip";
    // Свежие промпты со стилевым ключом канала и модели из профиля.
    let b = await mutateBoard(p.id, art.id, (d) => { d.input = { imageModel: ch.visual.imageModel, videoModel: ch.visual.videoModel, clipSec: ch.visual.clipSec, aspect: ch.visual.aspect }; assemble(d, kit); });
    const want = i.scenes ? new Set(i.scenes) : null;
    const pending = (g: Gen) => g.state !== "done" || g.verdict === "redo";
    const all = b.rows.filter((r) => !want || want.has(r.n));
    const targets = all.filter((r) => i.what === "images"
      ? !!r.concept && pending(r.picture)
      : r.animate && r.picture.state === "done" && !!r.picture.file && r.picture.verdict !== "redo" && pending(r.clip));
    const skipped = i.what === "images" ? all.filter((r) => !r.concept).length : all.filter((r) => r.animate && (r.picture.state !== "done" || r.picture.verdict === "redo")).length;
    const summary: RenderSummary = { what: i.what, total: targets.length, done: 0, failed: 0, waiting: 0, skipped, stop: null, message: "" };
    if (!targets.length) { summary.message = i.what === "images" ? (skipped ? "Нет сцен с описанием кадра: сначала напишите промпты." : "Все картинки готовы.") : (skipped ? "Сначала сделайте и примите картинки для сцен с анимацией." : "Все клипы готовы."); return summary; }

    const dir = dataPath("files", safeId(p.id), "visual");
    await fs.mkdir(dir, { recursive: true });
    const scene = (n: number) => b.rows.find((r) => r.n === n)!;
    const patch = async (n: number, fn: (g: Gen, r: Scene) => void) => { b = await mutateBoard(p.id, art.id, (d) => { const r = d.rows.find((x) => x.n === n); if (r) fn(r[kind], r); }); };
    const refsFor = async (r: Scene, viaData: boolean) => {
      if (i.what === "clips") return [await G.glabsRef(dataPath("files", safeId(p.id), ...r.picture.file!.split("/")), local && !viaData)];
      const items = ch.visual.cast.filter((c) => r.cast.includes(c.name) && c.image).sort((a, z2) => a.name.length - z2.name.length).slice(0, 10);
      const out: G.GlabsRef[] = [];
      for (const c of items) { const abs = dataPath("files", ...c.image.split("/")); if (await fs.stat(abs).then((s) => s.isFile(), () => false)) out.push(await G.glabsRef(abs, local && !viaData)); }
      return out;
    };
    const submit = async (r: Scene, viaData: boolean) => i.what === "images"
      ? G.submitImage({ prompt: r.image, model: ch.visual.imageModel, aspect_ratio: ch.visual.aspect, reference_images: await refsFor(r, viaData) }, base)
      : G.submitVideo({ prompt: r.video || motionPrompt(r.motion, kit), model: ch.visual.videoModel, aspect_ratio: ch.visual.aspect, mode: "start_image", reference_images: await refsFor(r, viaData), video_length: ch.visual.videoModel === "omni_flash" ? ch.visual.clipSec : Math.min(8, ch.visual.clipSec) }, base);
    const save = async (r: Scene, buf: Buffer, url: string): Promise<string> => {
      const ext = i.what === "clips" ? ".mp4" : (/\.(png|jpe?g|webp)(?:$|\?)/i.exec(url)?.[0].replace(/\?$/, "").toLowerCase() ?? ".png");
      const name = i.what === "clips" ? `${pad(r.n)}_anim.mp4` : `${pad(r.n)}${ext === ".jpeg" ? ".jpg" : ext}`;
      const prev = r[kind].file;
      const old: string[] = [];
      if (prev) {
        await fs.mkdir(path.join(dir, "old"), { recursive: true });
        const to = `old/${path.posix.basename(prev).replace(/(\.\w+)$/, `-${Date.now()}$1`)}`;
        if (await fs.rename(dataPath("files", safeId(p.id), ...prev.split("/")), path.join(dir, ...to.split("/"))).then(() => true, () => false)) old.push(`visual/${to}`);
      }
      await fs.writeFile(path.join(dir, name), buf);
      if (old.length) await patch(r.n, (g) => { g.old = [...(g.old ?? []), ...old].slice(-10); });
      return `visual/${name}`;
    };

    const queue: { n: number; resubmits: number; viaData: boolean; retries: number }[] = targets.map((r) => ({ n: r.n, resubmits: r[kind].resubmits ?? 0, viaData: false, retries: 0 }));
    const live = new Map<number, Track>();
    let stopMsg = "", offlineSince = 0;
    const limit = RENDER_LIMIT[i.what];
    const label = i.what === "images" ? "картинок" : "клипов";
    const report = () => ctx.progress(`G-Labs: готово ${summary.done} из ${summary.total} ${label}${live.size ? ` · в работе ${live.size}` : ""}${summary.failed ? ` · не удалось ${summary.failed}` : ""}`, 5 + Math.round(((summary.done + summary.failed) / summary.total) * 93));
    try {
      for (;;) {
        checkCancelled();
        while (!summary.stop && live.size < limit && queue.length) {
          const q = queue.shift()!;
          const r = scene(q.n), g = r[kind];
          // Продолжение: задание уже отправлено раньше — не платим второй раз, а спрашиваем его статус.
          if (g.taskId && (g.state === "queued" || g.state === "running") && g.base === base && !q.viaData && !q.retries && q.resubmits === (g.resubmits ?? 0)) { live.set(q.n, { n: q.n, taskId: g.taskId, resubmits: q.resubmits, retries: 0, viaData: false }); continue; }
          try {
            const taskId = await submit(r, q.viaData);
            live.set(q.n, { n: q.n, taskId, resubmits: q.resubmits, retries: q.retries, viaData: q.viaData });
            await patch(q.n, (x) => { x.state = "queued"; x.taskId = taskId; x.base = base; x.at = new Date().toISOString(); x.error = undefined; x.attempts = (x.attempts ?? 0) + 1; x.resubmits = q.resubmits; });
          } catch (e) {
            rethrowCancelled(e);
            const err = e as ApiError;
            if (err.code === "GLABS_OFFLINE" || err.code === "KEY_MISSING" || err.code === "GLABS_PLAN") { summary.stop = err.code === "GLABS_OFFLINE" ? "offline" : err.code; stopMsg = err.message; queue.unshift(q); break; }
            await patch(q.n, (x) => { x.state = "failed"; x.error = err.message ?? "G-Labs не принял задание"; x.taskId = undefined; });
            summary.failed++;
          }
        }
        if (!live.size) break;
        report();
        await sleep(G.GLABS_POLL.ms, taskSignal());
        for (const t of [...live.values()]) {
          let st: G.GlabsTask;
          try { st = await G.getTask(t.taskId, base); offlineSince = 0; }
          catch (e) {
            rethrowCancelled(e);
            const err = e as ApiError;
            if (err.code === "GLABS_TASK_LOST") {
              live.delete(t.n);
              if (t.resubmits < 2) { queue.unshift({ n: t.n, resubmits: t.resubmits + 1, viaData: t.viaData, retries: t.retries }); await patch(t.n, (x) => { x.state = "waiting"; x.taskId = undefined; x.error = "G-Labs перезапускался — задание отправляется заново"; }); }
              else { await patch(t.n, (x) => { x.state = "failed"; x.taskId = undefined; x.error = "G-Labs несколько раз терял задание. Сделайте сцену снова."; }); summary.failed++; }
              continue;
            }
            if (err.code === "GLABS_OFFLINE") {
              offlineSince ||= Date.now();
              if (Date.now() - offlineSince > 90_000) { summary.stop = "offline"; stopMsg = err.message; live.clear(); break; }
              continue;
            }
            // Ключ сменился или тариф: задания остаются в G-Labs, «Продолжить» заберёт их по сохранённым номерам.
            if (err.code === "KEY_MISSING" || err.code === "GLABS_PLAN") { summary.stop = err.code; stopMsg = err.message; live.clear(); break; }
            throw e;
          }
          if (st.status === "completed") {
            live.delete(t.n);
            const url = st.results?.[0];
            if (!url) { await patch(t.n, (x) => { x.state = "failed"; x.taskId = undefined; x.error = "G-Labs не вернул файл"; }); summary.failed++; continue; }
            let buf: Buffer;
            try { buf = await G.downloadResult(url, base); }
            catch (e) {
              rethrowCancelled(e);
              // Файл готов, но не скачался: сцена не теряется — её можно сделать снова одной кнопкой.
              await patch(t.n, (x) => { x.state = "failed"; x.taskId = undefined; x.error = (e as Error).message; });
              summary.failed++;
              continue;
            }
            const file = await save(scene(t.n), buf, url);
            await patch(t.n, (x) => { x.state = "done"; x.file = file; x.taskId = undefined; x.error = undefined; x.verdict = undefined; x.reason = undefined; x.at = new Date().toISOString(); x.rewritten = st.prompt_rewrites && st.final_prompt ? String(st.final_prompt).slice(0, 2000) : undefined; });
            summary.done++;
            ctx.partial({ scene: t.n, what: i.what, file });
          } else if (st.status === "failed") {
            live.delete(t.n);
            const k = G.failKind(st);
            if (k === "path" && !t.viaData) { queue.unshift({ n: t.n, resubmits: t.resubmits, viaData: true, retries: t.retries }); continue; }
            if (k === "upstream" && t.retries < 1) { queue.unshift({ n: t.n, resubmits: t.resubmits, viaData: t.viaData, retries: t.retries + 1 }); continue; }
            const msg = G.failText(st);
            if (k === "quota" || k === "accounts" || k === "session") {
              summary.stop = k; stopMsg = msg;
              await patch(t.n, (x) => { x.state = "waiting"; x.taskId = undefined; x.error = msg; });
            } else if (k === "stopped") await patch(t.n, (x) => { x.state = "waiting"; x.taskId = undefined; x.error = msg; });
            else { await patch(t.n, (x) => { x.state = "failed"; x.taskId = undefined; x.error = msg; }); summary.failed++; }
          } else if (st.status === "running" && scene(t.n)[kind].state !== "running") await patch(t.n, (x) => { x.state = "running"; });
        }
        if (summary.stop && summary.stop !== "offline" && !live.size) break;
        report();
      }
    } catch (e) {
      // «Остановить»: задания в G-Labs тоже останавливаются, чтобы не тратить квоту.
      const ids = [...live.values()].map((t) => t.taskId);
      if (ids.length) await runTask({}, () => G.stopTasks(ids, base)).catch(() => {});
      await runTask({}, async () => { for (const t of live.values()) await patch(t.n, (x) => { x.state = "waiting"; x.taskId = undefined; x.error = "Остановлено"; }); }).catch(() => {});
      throw e;
    }
    // Остановка по квоте или связи: остальные сцены ждут следующего запуска.
    for (const q of queue) await patch(q.n, (x) => { if (x.state !== "queued" && x.state !== "running") { x.state = "waiting"; x.error = stopMsg || x.error; } });
    summary.waiting = b.rows.filter((r) => targets.some((t) => t.n === r.n) && (r[kind].state === "waiting" || r[kind].state === "queued" || r[kind].state === "running")).length;
    await writeExports(p.id, b).catch(() => {});
    summary.message = summary.stop
      ? `${stopMsg} Готово ${summary.done} из ${summary.total}. Нажмите «Продолжить» — готовое не делается заново.`
      : `Готово ${summary.done} из ${summary.total}${summary.failed ? `, не удалось ${summary.failed} — поправьте описание и сделайте снова` : ""}.`;
    log.info({ event: "glabs_render", what: i.what, done: summary.done, failed: summary.failed, stop: summary.stop });
    ctx.progress("Готово", 100);
    return summary;
  });
}

// ---------- выгрузка: TXT «1 строка = 1 промпт» и scenes.json для монтажа (Выпуск 3) ----------
export type ExportKind = "images.txt" | "motion.txt" | "scenes.json";
export function exportBody(b: Board, kind: ExportKind): string {
  const line = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  if (kind === "images.txt") return b.rows.filter((r) => r.image).map((r) => line(r.image)).join("\n") + "\n";
  if (kind === "motion.txt") return b.rows.filter((r) => r.animate && r.video).map((r) => line(r.video)).join("\n") + "\n";
  return JSON.stringify({
    schema: 1, kind: "tubestudio-visual", projectId: b.projectId, aspect: b.input.aspect, timing: b.timing, audio: b.audioFile ?? null,
    style: { name: b.style.name, anchor: b.style.anchor },
    scenes: b.rows.map((r) => ({ n: r.n, start: r.start, end: r.end, seconds: r.seconds, text: r.text, shot: r.shot, image: r.picture.state === "done" ? r.picture.file ?? null : null, clip: r.clip.state === "done" ? r.clip.file ?? null : null, animate: r.animate, accepted: r.picture.verdict === "accepted", prompt: r.image, motion: r.video })),
  }, null, 2);
}
async function writeExports(projectId: string, b: Board) {
  const dir = dataPath("files", safeId(projectId), "visual");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "prompts_images.txt"), exportBody(b, "images.txt"), "utf8");
  await fs.writeFile(path.join(dir, "prompts_motion.txt"), exportBody(b, "motion.txt"), "utf8");
  await fs.writeFile(path.join(dir, "scenes.json"), exportBody(b, "scenes.json"), "utf8");
}
export async function exportBoard(projectId: string, kind: ExportKind) {
  const p = await loadProject(projectId);
  const art = boardOf(p);
  if (!art) throw new ApiError("NOT_FOUND", "Раскадровка не найдена", 404);
  const b = art.data as Board;
  await writeExports(p.id, b).catch(() => {});
  return { body: exportBody(b, kind), name: kind === "images.txt" ? "prompts_images.txt" : kind === "motion.txt" ? "prompts_motion.txt" : "scenes.json" };
}

// ---------- папка ролика: картинки и клипы, сделанные вручную ----------
const CLIP_FILE = /\.mp4$/i, IMAGE_FILE = /\.(png|jpe?g|webp)$/i, SERVICE_FILE = /^(thumbs\.db|desktop\.ini)$/i;
export type ImportFile = { name: string; bytes: number };
export type ImportMatch = { ok: { n: number; name: string; bytes: number }[]; noNumber: string[]; outOfRange: string[]; duplicates: { n: number; names: string[] }[]; empty: string[]; otherType: string[] };
/** Номер сцены — число в начале имени (`12_…`, `012.jpg`). Файл с повторяющимся номером не берётся: неизвестно, какой из них верный. */
export function matchImportFiles(files: ImportFile[], type: RegExp, total: number): ImportMatch {
  const out: ImportMatch = { ok: [], noNumber: [], outOfRange: [], duplicates: [], empty: [], otherType: [] };
  const byN = new Map<number, ImportFile[]>();
  for (const f of files) {
    if (SERVICE_FILE.test(f.name)) continue;
    if (!type.test(f.name)) { out.otherType.push(f.name); continue; }
    const m = /^(\d+)(?=[\s_.\-])/.exec(f.name);
    if (!m) { out.noNumber.push(f.name); continue; }
    const n = Number(m[1]);
    if (n < 1 || n > total) { out.outOfRange.push(f.name); continue; }
    if (f.bytes < 100) { out.empty.push(f.name); continue; }
    byN.set(n, [...(byN.get(n) ?? []), f]);
  }
  for (const [n, list] of [...byN].sort((a, z) => a[0] - z[0])) {
    if (list.length > 1) out.duplicates.push({ n, names: list.map((f) => f.name) });
    else out.ok.push({ n, name: list[0].name, bytes: list[0].bytes });
  }
  return out;
}
async function listFiles(dir: string): Promise<ImportFile[]> {
  const out: ImportFile[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.isFile()) out.push({ name: e.name, bytes: (await fs.stat(path.join(dir, e.name))).size });
  }
  return out;
}
async function assertFolder(dir: string) {
  const ok = await fs.stat(dir).then((s) => s.isDirectory(), () => false);
  if (!ok) throw new ApiError("VALIDATION", `Папка не найдена: ${dir}. Проверьте адрес и что диск подключён.`, 400);
}
const HIDDEN_FOLDER = /^(\$recycle\.bin|system volume information|recovery|config\.msi)$/i;
export type FolderEntry = { name: string; path: string };
/** Дерево папок для выбора источника: только имена папок, файлы не показываются. Без адреса — список дисков. */
export async function listFolders(raw?: string): Promise<{ path: string; folders: FolderEntry[]; denied: boolean }> {
  const dir = cleanFolder(raw ?? "");
  if (!dir) {
    if (process.platform !== "win32") return { path: "", folders: [{ name: "/", path: "/" }], denied: false };
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => `${l}:\\`);
    const found = await Promise.all(letters.map((d) => fs.stat(d).then(() => d, () => null)));
    return { path: "", folders: found.filter((d): d is string => !!d).map((d) => ({ name: d.slice(0, 2), path: d })), denied: false };
  }
  if (!path.isAbsolute(dir)) throw new ApiError("VALIDATION", "Нужен полный адрес папки.", 400);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const folders = entries.filter((e) => e.isDirectory() && !HIDDEN_FOLDER.test(e.name)).map((e) => ({ name: e.name, path: path.join(dir, e.name) })).sort((a, z) => a.name.localeCompare(z.name, "ru"));
    return { path: dir, folders, denied: false };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") throw new ApiError("VALIDATION", `Папка не найдена: ${dir}`, 400);
    return { path: dir, folders: [], denied: true };
  }
}
/** Адрес из проводника: «Копировать как путь» даёт его в кавычках. */
const cleanFolder = (s: string) => s.trim().replace(/^["'«“]+|["'»”]+$/g, "").trim();
export const ImportFoldersInput = z.object({ images: z.string().max(1000), clips: z.string().max(1000) }).strict();
/** Сохраняет папки с исходниками этого ролика. Пустое поле очищает адрес: файлы не берутся, пока он не указан. */
export async function saveImportFolders(projectId: string, raw: z.input<typeof ImportFoldersInput>) {
  const i = ImportFoldersInput.parse(raw);
  if (running.has(projectId)) throw new ApiError("VALIDATION", "В проекте идёт работа «Визуала». Дождитесь окончания.", 409);
  const images = cleanFolder(i.images), clips = cleanFolder(i.clips);
  for (const dir of [images, clips].filter(Boolean)) {
    if (!path.isAbsolute(dir)) throw new ApiError("VALIDATION", `Укажите полный адрес папки, например D:\\Видео\\Клипы. Сейчас: ${dir}`, 400);
    await assertFolder(dir);
  }
  const art = boardOf(await loadProject(projectId));
  if (!art) throw new ApiError("VALIDATION", "Сначала нарежьте сценарий на сцены", 400);
  const sources = { ...(images ? { images } : {}), ...(clips ? { clips } : {}) };
  await mutateBoard(projectId, art.id, (d) => { d.sources = sources; });
  return { sources };
}
/** Исходные файлы программа только читает. Папки свои у каждого ролика и из других роликов не берутся. */
async function scanVideoFolder(projectId: string) {
  const p = await loadProject(projectId);
  const art = boardOf(p);
  if (!art) throw new ApiError("VALIDATION", "Сначала нарежьте сценарий на сцены", 400);
  const b = art.data as Board;
  const imageDir = b.sources?.images, clipDir = b.sources?.clips;
  if (!imageDir || !clipDir) throw new ApiError("VALIDATION", "Укажите папки картинок и анимаций этого ролика.", 400);
  await assertFolder(imageDir);
  await assertFolder(clipDir);
  const total = b.rows.length;
  return { p, art, b, imageDir, clipDir, clips: matchImportFiles(await listFiles(clipDir), CLIP_FILE, total), images: matchImportFiles(await listFiles(imageDir), IMAGE_FILE, total) };
}
const importSide = (b: Board, m: ImportMatch, kind: "clip" | "picture") => {
  const done = new Set(b.rows.filter((r) => r[kind].state === "done").map((r) => r.n)), found = new Set(m.ok.map((x) => x.n));
  return { found: m.ok.length, willImport: m.ok.filter((x) => !done.has(x.n)).map((x) => x.n), alreadyDone: m.ok.filter((x) => done.has(x.n)).map((x) => x.n), missing: b.rows.filter((r) => r[kind].state !== "done" && !found.has(r.n)).map((r) => r.n), noNumber: m.noNumber, outOfRange: m.outOfRange, duplicates: m.duplicates, empty: m.empty, otherType: m.otherType };
};
/** Что лежит в папке ролика и что будет подтянуто. Файлы проекта не меняются. */
export async function importPreview(projectId: string) {
  const s = await scanVideoFolder(projectId);
  return { imageDir: s.imageDir, clipDir: s.clipDir, total: s.b.rows.length, clips: importSide(s.b, s.clips, "clip"), images: importSide(s.b, s.images, "picture") };
}
async function mediaHeaderOk(file: string, kind: "clip" | "picture") {
  const h = await fs.open(file, "r");
  try {
    const b = Buffer.alloc(12);
    await h.read(b, 0, 12, 0);
    if (kind === "clip") return b.toString("latin1", 4, 8) === "ftyp";
    return (b[0] === 0xff && b[1] === 0xd8) || b.toString("latin1", 1, 4) === "PNG" || (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP");
  } finally { await h.close(); }
}
export const ImportInput = z.object({ channelId: z.string().uuid() }).strict();
/** Копирует файлы только в сцены, где ещё нет готового результата. Запросов к платным сервисам нет. */
export async function runImport(projectId: string, ctx: JobCtx) {
  return lock(projectId, "import", async () => {
    const s = await scanVideoFolder(projectId);
    const clipTodo = new Set(importSide(s.b, s.clips, "clip").willImport), imageTodo = new Set(importSide(s.b, s.images, "picture").willImport);
    const items = [
      ...s.images.ok.filter((x) => imageTodo.has(x.n)).map((x) => ({ ...x, kind: "picture" as const, src: path.join(s.imageDir, x.name) })),
      ...s.clips.ok.filter((x) => clipTodo.has(x.n)).map((x) => ({ ...x, kind: "clip" as const, src: path.join(s.clipDir, x.name) })),
    ];
    const dir = dataPath("files", safeId(s.p.id), "visual");
    await fs.mkdir(dir, { recursive: true });
    const result = { clips: { imported: 0, failed: [] as string[] }, images: { imported: 0, failed: [] as string[] } };
    for (const [k, item] of items.entries()) {
      checkCancelled();
      ctx.progress(`Подтягиваю файлы: ${k + 1} из ${items.length}`, Math.round((k / Math.max(1, items.length)) * 98));
      const side = item.kind === "clip" ? result.clips : result.images;
      const ext = path.extname(item.name).toLowerCase().replace(".jpeg", ".jpg");
      const name = item.kind === "clip" ? `${pad(item.n)}_anim.mp4` : `${pad(item.n)}${ext}`;
      const dest = path.join(dir, name), part = `${dest}.part`;
      try {
        await fs.copyFile(item.src, part);
        if ((await fs.stat(part)).size !== item.bytes || !(await mediaHeaderOk(part, item.kind))) throw new Error("bad file");
        await fs.rename(part, dest);
      } catch (e) {
        rethrowCancelled(e);
        await fs.rm(part, { force: true }).catch(() => {});
        side.failed.push(item.name);
        continue;
      }
      await mutateBoard(s.p.id, s.art.id, (d) => {
        const g = d.rows.find((r) => r.n === item.n)?.[item.kind];
        if (g) { g.state = "done"; g.file = `visual/${name}`; g.taskId = undefined; g.error = undefined; g.verdict = undefined; g.reason = undefined; g.at = new Date().toISOString(); }
      });
      side.imported++;
    }
    const latest = (await loadProject(projectId)).artifacts.find((a) => a.id === s.art.id);
    if (latest) await writeExports(s.p.id, latest.data as Board).catch(() => {});
    ctx.progress("Готово", 100);
    return result;
  });
}

// ---------- персонажи и локации канала: эталоны ----------
const castDir = (channelId: string) => dataPath("files", "_cast", safeId(channelId));
const castRel = (channelId: string, file: string) => `_cast/${safeId(channelId)}/${file}`;
function findCast(ch: Channel, name: string): CastItemT {
  const c = ch.visual.cast.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!c) throw new ApiError("NOT_FOUND", `@${name} нет в списке персонажей и локаций канала`, 404);
  return c;
}
async function storeCastImage(ch: Channel, c: CastItemT, buf: Buffer, ext: string) {
  const dir = castDir(ch.id);
  await fs.mkdir(dir, { recursive: true });
  if (c.image) {
    await fs.mkdir(path.join(dir, "old"), { recursive: true });
    await fs.rename(dataPath("files", ...c.image.split("/")), path.join(dir, "old", `${c.name}-${Date.now()}${path.extname(c.image) || ".png"}`)).catch(() => {});
  }
  // Имя файла = @имя: по нему G-Labs привязывает эталон к персонажу в промпте.
  const file = `${c.name}${ext}`;
  await fs.writeFile(path.join(dir, file), buf);
  const cast = (await getChannel(ch.id)).visual.cast.map((x) => x.name === c.name ? { ...x, image: castRel(ch.id, file), glabs: "" } : x);
  return updateChannel(ch.id, { visual: { cast } }, { internal: true });
}
const IMG = z.string().regex(/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/, "Нужна картинка PNG, JPG или WEBP");
export async function saveCastImage(channelId: string, name: string, dataUri: string) {
  const ch = await getChannel(channelId);
  const c = findCast(ch, name);
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,/.exec(IMG.parse(dataUri))!;
  const buf = Buffer.from(dataUri.slice(m[0].length), "base64");
  const kind = buf.subarray(0, 4).toString("hex");
  const ok = kind.startsWith("89504e47") || kind.startsWith("ffd8") || buf.subarray(8, 12).toString() === "WEBP";
  if (!ok || buf.length < 100) throw new ApiError("VALIDATION", "Файл не похож на картинку PNG, JPG или WEBP", 400);
  if (buf.length > 12 * 1024 * 1024) throw new ApiError("VALIDATION", "Эталон больше 12 МБ — уменьшите картинку", 413);
  return storeCastImage(ch, c, buf, m[1] === "png" ? ".png" : m[1] === "webp" ? ".webp" : ".jpg");
}
/** Эталон в G-Labs: лист персонажа, доска локации или предмета в стиле канала. */
export async function generateCastImage(channelId: string, name: string, ctx: JobCtx) {
  const ch = await getChannel(channelId);
  const c = findCast(ch, name);
  const kit = await styleKit(ch);
  ctx.progress("Проверяю связь с G-Labs", 3);
  const hc = await G.checkGlabs();
  if (!hc.ok) throw new ApiError(hc.code === "KEY_MISSING" ? "KEY_MISSING" : "GLABS_OFFLINE", hc.message, 502);
  const base = await G.glabsBase();
  const prompt = referencePrompt(c, kit);
  let taskId = await G.submitImage({ prompt, model: ch.visual.imageModel, aspect_ratio: "16:9" }, base);
  let lost = 0;
  const started = Date.now();
  try {
    for (;;) {
      await sleep(G.GLABS_POLL.ms, taskSignal());
      ctx.progress(`G-Labs рисует эталон @${c.name}`, Math.min(90, 10 + Math.round((Date.now() - started) / 3000)));
      let st: G.GlabsTask;
      try { st = await G.getTask(taskId, base); }
      catch (e) { rethrowCancelled(e); if ((e as ApiError).code === "GLABS_TASK_LOST" && lost++ < 2) { taskId = await G.submitImage({ prompt, model: ch.visual.imageModel, aspect_ratio: "16:9" }, base); continue; } if ((e as ApiError).code === "GLABS_OFFLINE" && Date.now() - started < 10 * 60_000) continue; throw e; }
      if (st.status === "failed") throw new ApiError(G.failKind(st) === "quota" ? "UPSTREAM" : "VALIDATION", G.failText(st), 502);
      if (st.status !== "completed") continue;
      const url = st.results?.[0];
      if (!url) throw new ApiError("UPSTREAM", "G-Labs не вернул файл", 502);
      const buf = await G.downloadResult(url, base);
      const ext = /\.(jpe?g|webp)(?:$|\?)/i.exec(url)?.[1]?.toLowerCase();
      const next = await storeCastImage(ch, c, buf, ext === "webp" ? ".webp" : ext ? ".jpg" : ".png");
      ctx.progress("Готово", 100);
      return { name: c.name, image: next.visual.cast.find((x) => x.name === c.name)?.image ?? "", prompt };
    }
  } catch (e) {
    if ((e as ApiError)?.code === "CANCELLED") await runTask({}, () => G.stopTasks([taskId], base)).catch(() => {});
    throw e;
  }
}
/** Отправить эталоны в библиотеку персонажей G-Labs — чтобы @имена работали и при ручной работе в G-Labs. */
export async function syncCast(channelId: string) {
  const ch = await getChannel(channelId);
  const base = await G.glabsBase();
  const local = G.isLocalBase(base);
  const out: { name: string; result: "created" | "updated" | "skipped" | "error"; error?: string }[] = [];
  const marks = new Map<string, string>();
  for (const c of ch.visual.cast) {
    if (!c.image) { out.push({ name: c.name, result: "skipped" }); continue; }
    const abs = dataPath("files", ...c.image.split("/"));
    try {
      const st = await fs.stat(abs);
      const mark = sha(`${c.image}:${st.size}:${st.mtimeMs}:${c.description}`).slice(0, 16);
      if (c.glabs === mark) { out.push({ name: c.name, result: "skipped" }); continue; }
      const result = await G.upsertCharacter(c.name, await G.glabsRef(abs, local), c.description, base);
      marks.set(c.name, mark);
      out.push({ name: c.name, result });
    } catch (e) {
      rethrowCancelled(e);
      const err = e as ApiError;
      if (err.code === "GLABS_OFFLINE" || err.code === "KEY_MISSING" || err.code === "GLABS_PLAN") throw e;
      out.push({ name: c.name, result: "error", error: err.message });
    }
  }
  if (marks.size) {
    const cast = (await getChannel(ch.id)).visual.cast.map((x) => marks.has(x.name) ? { ...x, glabs: marks.get(x.name)! } : x);
    await updateChannel(ch.id, { visual: { cast } }, { internal: true });
  }
  return { results: out };
}
/** Сколько слов в секунду и сцен выйдет — для подсказки до нарезки. */
export const sceneHint = (language: string, maxSec: number) => ({ wps: wordsPerSecond(language), maxWords: Math.floor(wordsPerSecond(language) * maxSec) });
