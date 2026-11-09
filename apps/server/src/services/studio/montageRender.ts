// Выпуск 3, шаг 3: сборка видеоряда по плану шага 1. Только FFmpeg на этом компьютере, платных запросов нет.
// Черновик: видео 1920×1080 с озвучкой как есть. Музыка, громкость и субтитры — следующие шаги. Звук клипов не используется.
// Каждый кусок кодируется в свой файл: после остановки или сбоя готовые куски берутся снова, заново кодируется только остальное.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../../lib/errors.js";
import type { JobCtx } from "../../lib/jobs.js";
import { cancellation, checkCancelled, taskContext, taskSignal } from "../../lib/taskContext.js";
import { ffmpegPath } from "../audioFx.js";
import { ffprobeFor, prepareMontage, probe, projectFile } from "./montageCheck.js";
import type { ClipSegment, MontagePlan, StillSegment } from "./montagePlan.js";

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
const ENCODE = ["-an", "-sn", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-video_track_timescale", "24000"];

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

function ffmpeg(bin: string, args: string[], signal?: AbortSignal) {
  const active = taskSignal(signal);
  checkCancelled(active);
  return new Promise<void>((resolve, reject) => {
    const p = spawn(bin, ["-hide_banner", "-loglevel", "error", "-y", ...args], { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => { err = (err + d).slice(-400); });
    const stop = () => p.kill("SIGKILL");
    active?.addEventListener("abort", stop, { once: true });
    p.once("error", () => { active?.removeEventListener("abort", stop); reject(new ApiError("VALIDATION", "Не удалось запустить FFmpeg.")); });
    p.once("close", (code) => {
      active?.removeEventListener("abort", stop);
      if (active?.aborted) reject(cancellation());
      else if (code === 0) resolve();
      else reject(new ApiError("UPSTREAM", `FFmpeg: ${err || `код ${code}`}`, 502));
    });
  });
}

export type RenderOptions = {
  plan: MontagePlan; voice: string; resolve: (local: string) => string; dir: string; ffmpeg: string;
  onProgress?: (done: number, total: number) => void; signal?: AbortSignal;
};
export type RenderOutput = { name: string; seconds: number; width: number; height: number; bytes: number; parts: number; reused: number };

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
        await ffmpeg(o.ffmpeg, frameArgs(p.input, p.segment.clipTime ?? 0, still), o.signal);
        input = still;
      }
      await ffmpeg(o.ffmpeg, partArgs(p.segment, p.frames, input, temp), o.signal);
      await fs.rename(temp, final);
      if (still) await fs.rm(still, { force: true }).catch(() => {});
    }
    doneFrames += p.frames;
    o.onProgress?.(doneFrames, totalFrames);
  }

  // Имя с отметкой времени: файл, открытый в плеере, не мешает новой сборке.
  const name = `draft-${Date.now()}.mp4`, output = path.join(o.dir, `${name}.tmp.mp4`), list = path.join(dir, "list.tmp.txt");
  await fs.writeFile(list, named.map((p) => `file '${p.hash}.mp4'`).join("\n") + "\n", "utf8");
  await ffmpeg(o.ffmpeg, ["-f", "concat", "-safe", "0", "-i", list, "-i", o.voice, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output], o.signal);
  await fs.rm(list, { force: true }).catch(() => {});

  const made = await probe(ffprobeFor(o.ffmpeg), output);
  const expected = totalFrames / FPS;
  if (!made?.seconds || made.width !== W || made.height !== H || !made.audio || Math.abs(made.seconds - expected) > LENGTH_TOLERANCE_SEC) {
    await fs.rm(output, { force: true }).catch(() => {});
    throw new ApiError("UPSTREAM", `Готовый файл не совпал с планом: ${made ? `${made.width}×${made.height}, ${made.seconds} с` : "файл не открывается"}, ожидалось ${W}×${H}, ${expected.toFixed(2)} с.`, 502);
  }
  await fs.rename(output, path.join(o.dir, name));
  return { name, seconds: made.seconds, width: W, height: H, bytes: (await fs.stat(path.join(o.dir, name))).size, parts: named.length, reused };
}

// ---------- сборка настоящего проекта ----------
type Running = { jobId: string | null; since: string };
const running = new Map<string, Running>();
export const montageBusy = (projectId: string) => running.get(projectId) ?? null;

export type MontageResult = Omit<RenderOutput, "name"> & { file: string; at: string };
const FOLDER = "montage", META = "draft.json";

export async function renderMontage(projectId: string, ctx: JobCtx): Promise<MontageResult> {
  if (running.has(projectId)) throw new ApiError("VALIDATION", "Сборка этого ролика уже идёт.", 409);
  running.set(projectId, { jobId: taskContext()?.jobId ?? null, since: new Date().toISOString() });
  try {
    ctx.progress("Проверка файлов", 1);
    const p = await prepareMontage(projectId);
    if (!p.ready || !p.plan || !p.audioFile) throw new ApiError("VALIDATION", `Сборку начинать нельзя. ${p.blockers.map((b) => b.message).join(" ")}`);
    const bin = ffmpegPath();
    if (!bin) throw new ApiError("VALIDATION", "Для сборки нужен FFmpeg. Установите его или укажите FFMPEG_PATH в .env и перезапустите TubeStudio.");
    const dir = projectFile(projectId, FOLDER);
    await fs.mkdir(dir, { recursive: true });
    const made = await renderVideo({
      plan: p.plan, voice: projectFile(projectId, p.audioFile), resolve: (f) => projectFile(projectId, f), dir, ffmpeg: bin, signal: ctx.signal,
      onProgress: (done, total) => ctx.progress(`Кодирование: ${Math.floor(done / FPS / 60)}:${String(Math.floor(done / FPS) % 60).padStart(2, "0")} из ${Math.floor(total / FPS / 60)}:${String(Math.floor(total / FPS) % 60).padStart(2, "0")}`, Math.min(95, 2 + Math.floor(93 * done / total))),
    });
    ctx.progress("Завершение", 98);
    const { name, ...rest } = made;
    const result: MontageResult = { ...rest, file: `${FOLDER}/${name}`, at: new Date().toISOString() };
    const previous = await readResult(projectId);
    await fs.writeFile(path.join(dir, `${META}.tmp`), JSON.stringify(result), "utf8");
    await fs.rename(path.join(dir, `${META}.tmp`), path.join(dir, META));
    if (previous && previous.file !== result.file) await fs.rm(projectFile(projectId, previous.file), { force: true }).catch(() => {});
    return result;
  } finally { running.delete(projectId); }
}

async function readResult(projectId: string): Promise<MontageResult | null> {
  const raw = await fs.readFile(projectFile(projectId, `${FOLDER}/${META}`), "utf8").catch(() => null);
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as MontageResult;
    return await fs.stat(projectFile(projectId, r.file)).then(() => r, () => null);
  } catch { return null; }
}
/** Состояние для страницы: идёт ли сборка и последний готовый черновик. */
export async function montageState(projectId: string) {
  const { getProject } = await import("../projects.js");
  await getProject(projectId);
  return { running: montageBusy(projectId), result: await readResult(projectId) };
}
