// Выпуск 3, шаг 2: проверка файлов перед сборкой. Бесплатно: только чтение файлов и ffprobe, проект не меняется.
// Блокировка — сборку начинать нельзя. Предупреждение — собрать можно, но автор должен об этом знать.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { ApiError } from "../../lib/errors.js";
import { dataPath } from "../../lib/storage.js";
import { ffmpegPath } from "../audioFx.js";
import { factStatus, type FactCheckReport } from "./factCheck.js";
import { applyGraphics, graphicsState } from "./montageGraphics.js";
import { buildMontagePlan, type MontagePlan, type MontageScene } from "./montagePlan.js";
import { visualState } from "./visual.js";

/** Короткая сторона исходника, ниже которой показывается предупреждение. Итоговое видео всё равно 1920×1080. */
export const MIN_SOURCE_SIDE = 720;
const PROBE_PARALLEL = 6;
const PROBE_TIMEOUT_MS = 30_000;

export type MediaInfo = { seconds: number | null; width: number | null; height: number | null; video: boolean; audio: boolean };
/** Что удалось узнать о файле: "missing" — файла нет, "broken" — файл есть, но не открывается. */
export type Inspected = MediaInfo | "missing" | "broken";
export type Inspect = (localFile: string) => Promise<Inspected>;

export type MontageIssue = { code: string; message: string; scenes: number[] };
export type MontageCheck = {
  ready: boolean; blockers: MontageIssue[]; warnings: MontageIssue[];
  summary: { scenes: number; clips: number; pictures: number; files: number; audioSeconds: number | null };
};
/** Проверка плюс то, что нужно сборке. На страницу уходит только сама проверка. */
export type MontagePrepared = MontageCheck & { plan: MontagePlan | null; audioFile: string | null };
type Gen = { file?: string; verdict?: "accepted" | "redo" };
type Row = { n: number; start: number; end: number; picture: Gen; clip: Gen; graphic?: boolean };
export type MontageInput = {
  board: { timing: "audio" | "estimate"; stale: boolean; audioFile?: string; rows: Row[] } | null;
  facts: ReturnType<typeof factStatus>;
};

const num = (v: unknown) => { const n = Number(v); return v !== undefined && v !== null && v !== "" && Number.isFinite(n) ? n : null; };
/** Разбор ответа ffprobe. Длина берётся у видеодорожки, если она есть, иначе у файла целиком. */
export function parseProbe(json: string): MediaInfo | null {
  let d: { format?: { duration?: unknown }; streams?: { codec_type?: string; width?: unknown; height?: unknown; duration?: unknown }[] };
  try { d = JSON.parse(json); } catch { return null; }
  const streams = d.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const seconds = num(v?.duration) ?? num(d.format?.duration);
  return { seconds, width: num(v?.width), height: num(v?.height), video: !!v, audio: streams.some((s) => s.codec_type === "audio") };
}
/** ffprobe лежит рядом с ffmpeg и называется так же. */
export const ffprobeFor = (ffmpeg: string) => ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace(/ffmpeg/i, "ffprobe"));

export function probe(bin: string, file: string): Promise<MediaInfo | null> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ["-v", "error", "-print_format", "json", "-show_entries", "format=duration:stream=codec_type,width,height,duration", file], { windowsHide: true });
    let out = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), PROBE_TIMEOUT_MS);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.resume();
    // Не запустился сам ffprobe — это не повреждённый файл, а проблема программы.
    p.once("error", () => { clearTimeout(timer); reject(new ApiError("VALIDATION", "Не удалось запустить ffprobe. Он должен лежать рядом с ffmpeg.")); });
    p.once("close", (code) => { clearTimeout(timer); resolve(code === 0 ? parseProbe(out) : null); });
  });
}

/** Полный путь к файлу проекта по его записи в раскадровке. */
export const projectFile = (projectId: string, local: string) => dataPath("files", projectId.replace(/[^\w-]/g, ""), ...local.split("/"));

function diskInspector(projectId: string): Inspect {
  const ffmpeg = ffmpegPath();
  if (!ffmpeg) throw new ApiError("VALIDATION", "Для проверки файлов нужен FFmpeg. Установите его или укажите FFMPEG_PATH в .env и перезапустите TubeStudio.");
  const bin = ffprobeFor(ffmpeg);
  return async (local) => {
    const full = projectFile(projectId, local);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat?.isFile()) return "missing";
    return (await probe(bin, full)) ?? "broken";
  };
}

async function inspectAll(files: string[], inspect: Inspect) {
  const found = new Map<string, Inspected>();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PROBE_PARALLEL, files.length) }, async () => {
    while (next < files.length) { const f = files[next++]; found.set(f, await inspect(f)); }
  }));
  return found;
}

const FACTS: Partial<Record<MontageInput["facts"], string>> = {
  none: "Программа считает факты сценария непроверенными. Ручная проверка ей неизвестна.",
  stale: "Сценарий меняли после проверки фактов.",
  issues: "После проверки фактов остались неисправленные места.",
};
const usableVisual = (m: Inspected | undefined): m is MediaInfo => !!m && typeof m === "object" && m.video;

/** Сама проверка: файлы приходят через inspect, поэтому в тестах FFmpeg не нужен. */
export async function assessMontage(input: MontageInput, inspect: Inspect): Promise<MontagePrepared> {
  const blockers: MontageIssue[] = [], warnings: MontageIssue[] = [];
  const add = (list: MontageIssue[], code: string, message: string, scenes: number[] = []) => { list.push({ code, message, scenes }); };
  const factsNote = FACTS[input.facts];
  if (factsNote) add(warnings, "facts", factsNote);
  const b = input.board;
  if (!b) {
    add(blockers, "no-board", "Раскадровки нет: сначала нарежьте сцены в разделе «Визуал».");
    return { ready: false, blockers, warnings, summary: { scenes: 0, clips: 0, pictures: 0, files: 0, audioSeconds: null }, plan: null, audioFile: null };
  }
  if (b.timing !== "audio") add(blockers, "estimated-timing", "Тайминги сцен примерные, а не из озвучки. Нарежьте сцены заново по готовой озвучке с субтитрами.");
  if (b.stale) add(blockers, "stale-board", "Текст изменился после нарезки на сцены. Нарежьте сцены заново.");

  const files = [...new Set([...(b.audioFile ? [b.audioFile] : []), ...b.rows.flatMap((r) => [r.picture.file, r.clip.file].filter((f): f is string => !!f))])];
  const found = await inspectAll(files, inspect);

  let audioSeconds: number | null = null;
  if (!b.audioFile) add(blockers, "no-audio", "В раскадровке не указан файл озвучки.");
  else {
    const a = found.get(b.audioFile);
    if (a === "missing") add(blockers, "no-audio", `Файл озвучки не найден: ${b.audioFile}.`);
    else if (!a || a === "broken" || !a.audio || !a.seconds || a.seconds <= 0) add(blockers, "broken-audio", `Файл озвучки не открывается: ${b.audioFile}.`);
    else audioSeconds = a.seconds;
  }

  const noMedia: number[] = [], missing: number[] = [], broken: number[] = [], redo: number[] = [], lowRes: number[] = [], noClip: number[] = [];
  const scenes: MontageScene[] = b.rows.map((r) => {
    if (!r.picture.file && !r.clip.file) noMedia.push(r.n);
    if (r.picture.verdict === "redo" || r.clip.verdict === "redo") redo.push(r.n);
    const pic = r.picture.file ? found.get(r.picture.file) : undefined, clip = r.clip.file ? found.get(r.clip.file) : undefined;
    if (pic === "missing" || clip === "missing") missing.push(r.n);
    const picOk = usableVisual(pic), clipOk = usableVisual(clip) && !!clip.seconds && clip.seconds > 0;
    if ((r.picture.file && pic !== "missing" && !picOk) || (r.clip.file && clip !== "missing" && !clipOk)) broken.push(r.n);
    if (!r.clip.file && r.picture.file && !r.graphic) noClip.push(r.n);
    // В кадр идёт клип, а картинка — только если клипа нет.
    const used = r.clip.file ? (clipOk ? clip : null) : picOk ? pic : null;
    if (used && used.width && used.height && Math.min(used.width, used.height) < MIN_SOURCE_SIDE) lowRes.push(r.n);
    return { n: r.n, start: r.start, end: r.end, image: picOk ? r.picture.file! : null, clip: clipOk ? r.clip.file! : null, clipSeconds: clipOk ? clip.seconds : null };
  });
  if (noMedia.length) add(blockers, "no-media", "У этих сцен нет ни клипа, ни картинки.", noMedia);
  if (missing.length) add(blockers, "missing-file", "Файл указан, но его нет на диске.", missing);
  if (broken.length) add(blockers, "broken-file", "Файл повреждён или не открывается.", broken);
  if (redo.length) add(blockers, "redo", "Сцена помечена «переделать».", redo);
  if (lowRes.length) add(warnings, "low-res", `Исходник ниже ${MIN_SOURCE_SIDE}p: будет увеличен до 1920×1080, картинка может стать мягче.`, lowRes);
  if (noClip.length) add(warnings, "no-clip", "Есть картинка, но нет клипа: сцена пойдёт с медленным приближением.", noClip);

  // Раскладка шага 1 находит разрывы между сценами и тайминги от другой озвучки.
  let plan: MontagePlan | null = null;
  if (audioSeconds !== null) {
    try { plan = buildMontagePlan(scenes, audioSeconds); }
    catch (e) { if (!(e instanceof ApiError)) throw e; add(blockers, "timeline", e.message); }
  }
  return {
    ready: blockers.length === 0, blockers, warnings,
    summary: { scenes: b.rows.length, clips: b.rows.filter((r) => r.clip.file).length, pictures: b.rows.filter((r) => r.picture.file).length, files: files.length, audioSeconds },
    plan, audioFile: b.audioFile ?? null,
  };
}

/** Проверка настоящего проекта: раскадровка из «Визуала», файлы с диска. */
export async function checkMontage(projectId: string): Promise<MontageCheck> {
  const { plan: _plan, audioFile: _audio, ...check } = await prepareMontage(projectId);
  return check;
}
export async function prepareMontage(projectId: string): Promise<MontagePrepared> {
  const state = await visualState(projectId);
  const { getProject } = await import("../projects.js");
  const p = await getProject(projectId);
  const sd = [...p.artifacts].reverse().find((a) => a.kind === "script")?.data as { script?: string; studio?: { factCheck?: FactCheckReport | null } } | undefined;
  const { items } = await graphicsState(projectId);
  const board = state.board && { ...state.board, rows: applyGraphics(state.board.rows, items) };
  return assessMontage({ board, facts: factStatus(sd?.script, sd?.studio?.factCheck) }, diskInspector(projectId));
}
