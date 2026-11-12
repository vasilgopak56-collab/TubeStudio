// Выпуск 3, шаг 3: сборка видеоряда по плану шага 1. Только FFmpeg на этом компьютере, платных запросов нет.
// Черновик: видео 1920×1080, голос с музыкой сводит шаг 4. Субтитры — следующий шаг. Звук клипов не используется.
// Каждый кусок кодируется в свой файл: после остановки или сбоя готовые куски берутся снова, заново кодируется только остальное.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../../lib/errors.js";
import type { JobCtx } from "../../lib/jobs.js";
import { checkCancelled, taskContext, taskSignal } from "../../lib/taskContext.js";
import { ffmpegPath } from "../audioFx.js";
import { ffprobeFor, prepareMontage, probe, projectFile } from "./montageCheck.js";
import type { ClipSegment, MontagePlan, StillSegment } from "./montagePlan.js";
import { usedCue, type CueMix } from "./montageCue.js";
import { buildSound, runFfmpeg, usedMusic, type SoundTrack } from "./montageSound.js";
import { SUB_FILES, requireAss, writeSubtitles, type SubtitlesResult } from "./montageSubtitles.js";

export const FPS = 24;
const W = 1920, H = 1080;
/** Насколько увеличивается картинка без анимации за время показа. */
export const IMAGE_ZOOM = 0.08;
/** Меняется при смене способа кодирования, чтобы старые куски не попали в новую сборку. */
const RENDER_VERSION = 1;
/** Допустимое расхождение длины готового файла с планом, секунд. */
const LENGTH_TOLERANCE_SEC = 0.1;

type RenderSegment = ClipSegment | StillSegment;
export type RenderPart = { segment: RenderSegment; frames: number };

export const frameAt = (t: number) => Math.round(t * FPS);
/** Кадры считаются от начала ролика, а не по длине каждого куска: округления не накапливаются и звук не уезжает. */
export function partsOf(plan: MontagePlan): RenderPart[] {
  return plan.segments.flatMap((segment) => {
    if (segment.kind === "missing") throw new ApiError("VALIDATION", `Сцена ${segment.scene}: нет материалов для сборки.`);
    const frames = frameAt(segment.end) - frameAt(segment.start);
    return frames > 0 ? [{ segment, frames }] : [];
  });
}

const cover = (w: number, h: number) => `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}`;
const FIT = `${cover(W, H)},setsar=1,format=yuv420p`;
export const VIDEO_CODEC = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-video_track_timescale", "24000"];
const ENCODE = ["-an", "-sn", ...VIDEO_CODEC];

/** Входные данные и фильтр куска. Для статичного кадра из клипа input — заранее извлечённый кадр. */
export function partArgs(segment: RenderSegment, frames: number, input: string, output: string): string[] {
  const tail = [...ENCODE, "-frames:v", String(frames), output];
  if (segment.kind === "clip") return ["-i", input, "-vf", `fps=${FPS},${FIT},tpad=stop=-1:stop_mode=clone`, ...tail];
  if (segment.source === "clip") return ["-loop", "1", "-framerate", String(FPS), "-i", input, "-vf", FIT, ...tail];
  // Запас по размеру нужен, чтобы медленное приближение не дрожало.
  const zoom = `zoompan=z='1+${IMAGE_ZOOM}*on/${Math.max(frames - 1, 1)}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS}`;
  return ["-i", input, "-vf", `${cover(W * 2, H * 2)},${zoom},setsar=1,format=yuv420p`, ...tail];
}
/** Последний настоящий кадр клипа до секунды time: выход за конец клипа даёт его последний кадр, а не пустоту. */
export const frameArgs = (clip: string, time: number, output: string) => ["-i", clip, "-an", "-t", String(Math.max(time, 1 / FPS)), "-update", "1", output];

export type RenderOptions = {
  plan: MontagePlan; voice: string; music?: SoundTrack[]; cue?: CueMix | null; resolve: (local: string) => string; dir: string; ffmpeg: string;
  onProgress?: (done: number, total: number) => void; onSound?: () => void; signal?: AbortSignal;
};
export type RenderOutput = { name: string; seconds: number; width: number; height: number; bytes: number; parts: number; reused: number; lufs: number; peak: number; music: number; cue?: number };

export async function renderVideo(o: RenderOptions): Promise<RenderOutput> {
  const parts = partsOf(o.plan);
  if (!parts.length) throw new ApiError("VALIDATION", "В плане монтажа нет кусков для сборки.");
  const dir = path.join(o.dir, "parts");
  await fs.mkdir(dir, { recursive: true });

  const named = await Promise.all(parts.map(async (part) => {
    const s = part.segment, input = o.resolve(s.file), stat = await fs.stat(input);
    const how = s.kind === "clip" ? ["clip", s.clipTo] : [s.source, s.clipTime];
    const hash = crypto.createHash("sha256").update(JSON.stringify([RENDER_VERSION, FPS, s.file, stat.size, stat.mtimeMs, how, part.frames])).digest("hex").slice(0, 24);
    return { ...part, input, hash };
  }));
  // Куски от прошлых вариантов сцен и оборванные файлы больше не нужны.
  const keep = new Set(named.map((p) => `${p.hash}.mp4`));
  for (const f of await fs.readdir(dir)) if (!keep.has(f)) await fs.rm(path.join(dir, f), { force: true }).catch(() => {});

  const totalFrames = named.reduce((sum, p) => sum + p.frames, 0);
  let doneFrames = 0, reused = 0;
  for (const p of named) {
    checkCancelled(taskSignal(o.signal));
    const final = path.join(dir, `${p.hash}.mp4`);
    if (await fs.stat(final).then((s) => s.size > 0, () => false)) reused++;
    else {
      const temp = path.join(dir, `${p.hash}.tmp.mp4`);
      let input = p.input, still: string | null = null;
      if (p.segment.kind === "still" && p.segment.source === "clip") {
        still = path.join(dir, `${p.hash}.tmp.png`);
        await runFfmpeg(o.ffmpeg, frameArgs(p.input, p.segment.clipTime ?? 0, still), o.signal);
        input = still;
      }
      await runFfmpeg(o.ffmpeg, partArgs(p.segment, p.frames, input, temp), o.signal);
      await fs.rename(temp, final);
      if (still) await fs.rm(still, { force: true }).catch(() => {});
    }
    doneFrames += p.frames;
    o.onProgress?.(doneFrames, totalFrames);
  }

  // Имя с отметкой времени: файл, открытый в плеере, не мешает новой сборке.
  const name = `draft-${Date.now()}.mp4`, output = path.join(o.dir, `${name}.tmp.mp4`), list = path.join(dir, "list.tmp.txt"), mixed = path.join(o.dir, `${name}.sound.m4a`);
  o.onSound?.();
  const music = o.music ?? [];
  const sound = await buildSound({ ffmpeg: o.ffmpeg, voice: o.voice, tracks: music, cue: o.cue, duration: o.plan.duration, output: mixed, signal: o.signal });
  await fs.writeFile(list, named.map((p) => `file '${p.hash}.mp4'`).join("\n") + "\n", "utf8");
  await runFfmpeg(o.ffmpeg, ["-f", "concat", "-safe", "0", "-i", list, "-i", mixed, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-movflags", "+faststart", output], o.signal);
  await fs.rm(list, { force: true }).catch(() => {});
  await fs.rm(mixed, { force: true }).catch(() => {});

  const made = await probe(ffprobeFor(o.ffmpeg), output);
  const expected = totalFrames / FPS;
  if (!made?.seconds || made.width !== W || made.height !== H || !made.audio || Math.abs(made.seconds - expected) > LENGTH_TOLERANCE_SEC) {
    await fs.rm(output, { force: true }).catch(() => {});
    throw new ApiError("UPSTREAM", `Готовый файл не совпал с планом: ${made ? `${made.width}×${made.height}, ${made.seconds} с` : "файл не открывается"}, ожидалось ${W}×${H}, ${expected.toFixed(2)} с.`, 502);
  }
  await fs.rename(output, path.join(o.dir, name));
  return { name, seconds: made.seconds, width: W, height: H, bytes: (await fs.stat(path.join(o.dir, name))).size, parts: named.length, reused, lufs: sound.lufs, peak: sound.peak, ...(o.cue ? { music: o.cue.files, cue: o.cue.rows } : { music: music.length }) };
}

/** Перекодирует всё видео с субтитрами в кадре. Звук копируется без изменений. Имя файла ASS простое: FFmpeg запускается из его папки. */
export async function burnVideo(o: { ffmpeg: string; input: string; dir: string; ass: string; name: string; onTime?: (seconds: number) => void; signal?: AbortSignal }) {
  const temp = path.join(o.dir, `${o.name}.tmp.mp4`), final = path.join(o.dir, o.name);
  const source = await probe(ffprobeFor(o.ffmpeg), o.input);
  if (!source?.seconds) throw new ApiError("VALIDATION", "Черновик видео не открывается. Соберите его заново.");
  await runFfmpeg(o.ffmpeg, ["-i", o.input, "-map", "0:v:0", "-map", "0:a:0", "-vf", `ass=${o.ass}`, ...VIDEO_CODEC, "-c:a", "copy", "-movflags", "+faststart", temp], o.signal, "error", { cwd: o.dir, onTime: o.onTime });
  const made = await probe(ffprobeFor(o.ffmpeg), temp);
  if (!made?.seconds || made.width !== W || made.height !== H || !made.audio || Math.abs(made.seconds - source.seconds) > LENGTH_TOLERANCE_SEC) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw new ApiError("UPSTREAM", "Видео со вшитыми субтитрами не совпало с черновиком по длине или размеру.", 502);
  }
  await fs.rename(temp, final);
  return { seconds: made.seconds, bytes: (await fs.stat(final)).size };
}

// ---------- сборка настоящего проекта ----------
type Running = { jobId: string | null; since: string; what: "render" | "burn" | "shorts" };
const running = new Map<string, Running>();
export const montageBusy = (projectId: string) => running.get(projectId) ?? null;
export function lockMontage<T>(projectId: string, what: Running["what"], fn: () => Promise<T>): Promise<T> {
  if (running.has(projectId)) throw new ApiError("VALIDATION", "Сборка этого ролика уже идёт.", 409);
  running.set(projectId, { jobId: taskContext()?.jobId ?? null, since: new Date().toISOString(), what });
  return fn().finally(() => running.delete(projectId));
}

export type MontageResult = Omit<RenderOutput, "name"> & { file: string; at: string; subtitles?: SubtitlesResult };
export type BurnResult = { file: string; at: string; seconds: number; bytes: number; source: string };
const FOLDER = "montage", META = "draft.json", BURN_META = "burned.json";

export function renderMontage(projectId: string, ctx: JobCtx): Promise<MontageResult> {
  return lockMontage(projectId, "render", async () => {
    ctx.progress("Проверка файлов", 1);
    const p = await prepareMontage(projectId);
    if (!p.ready || !p.plan || !p.audioFile) throw new ApiError("VALIDATION", `Сборку начинать нельзя. ${p.blockers.map((b) => b.message).join(" ")}`);
    const bin = ffmpegPath();
    if (!bin) throw new ApiError("VALIDATION", "Для сборки нужен FFmpeg. Установите его или укажите FFMPEG_PATH в .env и перезапустите TubeStudio.");
    const cue = await usedCue(projectId, p.plan.duration);
    const dir = projectFile(projectId, FOLDER);
    await fs.mkdir(dir, { recursive: true });
    const made = await renderVideo({
      plan: p.plan, voice: projectFile(projectId, p.audioFile), ...(cue ? { cue } : { music: await usedMusic(projectId) }), onSound: () => ctx.progress("Сведение звука", 96), resolve: (f) => projectFile(projectId, f), dir, ffmpeg: bin, signal: ctx.signal,
      onProgress: (done, total) => ctx.progress(`Кодирование: ${Math.floor(done / FPS / 60)}:${String(Math.floor(done / FPS) % 60).padStart(2, "0")} из ${Math.floor(total / FPS / 60)}:${String(Math.floor(total / FPS) % 60).padStart(2, "0")}`, Math.min(95, 2 + Math.floor(93 * done / total))),
    });
    ctx.progress("Субтитры", 98);
    const subtitles = await writeSubtitles(projectId, p.audioFile, p.plan.duration);
    const { name, ...rest } = made;
    const result: MontageResult = { ...rest, file: `${FOLDER}/${name}`, at: new Date().toISOString(), subtitles };
    const previous = await readResult(projectId);
    await fs.writeFile(path.join(dir, `${META}.tmp`), JSON.stringify(result), "utf8");
    await fs.rename(path.join(dir, `${META}.tmp`), path.join(dir, META));
    if (previous && previous.file !== result.file) await fs.rm(projectFile(projectId, previous.file), { force: true }).catch(() => {});
    return result;
  });
}

/** Отдельная сборка со вшитыми субтитрами из готового черновика: около того же времени, что и первое кодирование. */
export function burnMontage(projectId: string, ctx: JobCtx): Promise<BurnResult> {
  return lockMontage(projectId, "burn", async () => {
    ctx.progress("Подготовка", 1);
    const draft = await readResult(projectId);
    requireAss(draft);
    const bin = ffmpegPath();
    if (!bin) throw new ApiError("VALIDATION", "Для сборки нужен FFmpeg. Установите его или укажите FFMPEG_PATH в .env и перезапустите TubeStudio.");
    const dir = projectFile(projectId, FOLDER), name = `burned-${Date.now()}.mp4`;
    const made = await burnVideo({
      ffmpeg: bin, input: projectFile(projectId, draft!.file), dir, ass: path.basename(SUB_FILES.ass), name, signal: ctx.signal,
      onTime: (t) => ctx.progress(`Кодирование с субтитрами: ${Math.floor(t / 60)}:${String(Math.floor(t) % 60).padStart(2, "0")} из ${Math.floor(draft!.seconds / 60)}:${String(Math.floor(draft!.seconds) % 60).padStart(2, "0")}`, Math.min(98, 1 + Math.floor(97 * t / draft!.seconds))),
    });
    const result: BurnResult = { file: `${FOLDER}/${name}`, at: new Date().toISOString(), seconds: made.seconds, bytes: made.bytes, source: draft!.file };
    const previous = await readBurned(projectId);
    await fs.writeFile(path.join(dir, `${BURN_META}.tmp`), JSON.stringify(result), "utf8");
    await fs.rename(path.join(dir, `${BURN_META}.tmp`), path.join(dir, BURN_META));
    if (previous && previous.file !== result.file) await fs.rm(projectFile(projectId, previous.file), { force: true }).catch(() => {});
    return result;
  });
}

async function readMeta<T extends { file: string }>(projectId: string, meta: string): Promise<T | null> {
  const raw = await fs.readFile(projectFile(projectId, `${FOLDER}/${meta}`), "utf8").catch(() => null);
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as T;
    return await fs.stat(projectFile(projectId, r.file)).then(() => r, () => null);
  } catch { return null; }
}
const readResult = (projectId: string) => readMeta<MontageResult>(projectId, META);
const readBurned = (projectId: string) => readMeta<BurnResult>(projectId, BURN_META);
/** Состояние для страницы: идёт ли сборка, последний черновик и версия со вшитыми субтитрами. */
export async function montageState(projectId: string) {
  const { getProject } = await import("../projects.js");
  await getProject(projectId);
  const [result, burned] = await Promise.all([readResult(projectId), readBurned(projectId)]);
  return { running: montageBusy(projectId), result, burned: burned ? { ...burned, stale: burned.source !== result?.file } : null };
}
