// Выпуск 3, шаг 5: субтитры по таймингам озвучки. Отдельный SRT для YouTube, VTT для плеера на странице, ASS для вшитого текста.
import fs from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../../lib/errors.js";
import { projectFile } from "./montageCheck.js";
import { parseSubtitles, type Cue } from "./scenes.js";

const OVERLAP_TOLERANCE_SEC = 0.001, END_TOLERANCE_SEC = 0.5;
const DIR = "montage";
export const SUB_FILES = { srt: `${DIR}/draft.srt`, vtt: `${DIR}/draft.vtt`, ass: `${DIR}/draft.ass` } as const;

/** Что не так с субтитрами; null — всё в порядке. */
export function checkCues(cues: Cue[], duration: number): string | null {
  if (!cues.length) return "В файле субтитров нет ни одной фразы.";
  for (let i = 1; i < cues.length; i++) if (cues[i].start < cues[i - 1].end - OVERLAP_TOLERANCE_SEC) return `Фразы субтитров ${i} и ${i + 1} накладываются по времени.`;
  if (cues[cues.length - 1].end > duration + END_TOLERANCE_SEC) return "Субтитры заканчиваются позже озвучки. Возможно, они от другой озвучки.";
  return null;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const parts = (t: number, scale: number) => { const units = Math.round(t * scale), whole = Math.floor(units / scale); return { h: Math.floor(whole / 3600), m: Math.floor(whole / 60) % 60, s: whole % 60, rest: units % scale }; };
const vttTime = (t: number) => { const p = parts(t, 1000); return `${pad(p.h)}:${pad(p.m)}:${pad(p.s)}.${pad(p.rest, 3)}`; };
const assTime = (t: number) => { const p = parts(t, 100); return `${p.h}:${pad(p.m)}:${pad(p.s)}.${pad(p.rest)}`; };

export const toVtt = (cues: Cue[]) => `WEBVTT\n\n${cues.map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}`).join("\n\n")}\n`;

/** Текст не должен стать командой оформления ASS. */
const assText = (s: string) => s.replace(/\\/g, "/").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\s*\n\s*/g, "\\N");
/** Белый Arial Bold с чёрной обводкой внизу кадра, размеры заданы для 1920×1080. */
export function toAss(cues: Cue[]) {
  return ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Arial,56,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,4,0,2,120,120,60,1", "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...cues.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${assText(c.text)}`), ""].join("\n");
}

async function put(projectId: string, local: string, text: string) {
  const file = projectFile(projectId, local);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, text, "utf8");
  await fs.rename(`${file}.tmp`, file);
}

export type SubtitlesResult = { files: { srt: string; vtt: string } | null; cues: number; problem: string | null };
/** Субтитры именно той озвучки, по которой нарезаны сцены. Проблема с ними не останавливает сборку видео, а показывается на странице. */
export async function writeSubtitles(projectId: string, audioFile: string, duration: number): Promise<SubtitlesResult> {
  const { getProject } = await import("../projects.js");
  const p = await getProject(projectId);
  const data = [...p.artifacts].reverse().find((a) => a.kind === "audio" && (a.data as { audio?: string } | undefined)?.audio === audioFile)?.data as { subtitles?: string[] } | undefined;
  const source = data?.subtitles?.find((f) => /\.srt$/i.test(f));
  if (!source) return { files: null, cues: 0, problem: "У этой озвучки нет файла субтитров." };
  const text = await fs.readFile(projectFile(projectId, source), "utf8").catch(() => null);
  if (text === null) return { files: null, cues: 0, problem: "Файл субтитров озвучки не открывается." };
  const cues = parseSubtitles(text), problem = checkCues(cues, duration);
  if (problem) return { files: null, cues: cues.length, problem };
  await put(projectId, SUB_FILES.srt, text);
  await put(projectId, SUB_FILES.vtt, toVtt(cues));
  await put(projectId, SUB_FILES.ass, toAss(cues));
  return { files: { srt: SUB_FILES.srt, vtt: SUB_FILES.vtt }, cues: cues.length, problem: null };
}

export function requireAss(result: { subtitles?: SubtitlesResult } | null) {
  if (!result) throw new ApiError("VALIDATION", "Сначала соберите черновик видео.");
  if (!result.subtitles?.files) throw new ApiError("VALIDATION", result.subtitles?.problem ?? "У этого черновика нет субтитров. Соберите его заново.");
}
