// Выпуск 3, шаг 4: звук ролика. Голос и музыка сводятся на этом компьютере, платных запросов нет.
// Музыка тише под голосом и громче в паузах, итог −14 LUFS без перегруза. Треки берутся из папки ролика и копируются в проект.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ApiError } from "../../lib/errors.js";
import { cancellation, checkCancelled, taskSignal } from "../../lib/taskContext.js";
import { ffmpegPath } from "../audioFx.js";
import { ffprobeFor, probe, projectFile } from "./montageCheck.js";

export const TARGET_LUFS = -14;
/** С запасом к −1 dBTP: кодирование в AAC немного поднимает пики. */
const TARGET_PEAK = -1.5;
export const MAX_PEAK = -1;
export const LUFS_TOLERANCE = 0.5;
/** Уровни до итоговой нормализации: в паузах музыка на 9 дБ тише голоса, под голосом компрессор убирает ещё около 9 дБ. */
export const VOICE_LEVEL = -16;
export const MUSIC_PAUSE_LEVEL = -25;
const DUCK = "threshold=0.016:ratio=2:attack=20:release=400";
export const CROSSFADE_SEC = 2;
const FADE_IN_SEC = 2, FADE_OUT_SEC = 3;
const MIN_TRACK_SEC = 10;
const LOUDNORM = `I=${TARGET_LUFS}:TP=${TARGET_PEAK}:LRA=20`;
const FOLDER = "montage/music", META = "montage/music.json";
const AUDIO_FILE = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;

/** Запуск FFmpeg. Возвращает его сообщения: по ним читается измеренная громкость. */
export function runFfmpeg(bin: string, args: string[], signal?: AbortSignal, loglevel = "error") {
  const active = taskSignal(signal);
  checkCancelled(active);
  return new Promise<string>((resolve, reject) => {
    const p = spawn(bin, ["-hide_banner", "-nostats", "-loglevel", loglevel, "-y", ...args], { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => { err = (err + d).slice(-20_000); });
    const stop = () => p.kill("SIGKILL");
    active?.addEventListener("abort", stop, { once: true });
    p.once("error", () => { active?.removeEventListener("abort", stop); reject(new ApiError("VALIDATION", "Не удалось запустить FFmpeg.")); });
    p.once("close", (code) => {
      active?.removeEventListener("abort", stop);
      if (active?.aborted) reject(cancellation());
      else if (code === 0) resolve(err);
      else reject(new ApiError("UPSTREAM", `FFmpeg: ${err.slice(-400) || `код ${code}`}`, 502));
    });
  });
}

export type Loudness = { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string };
/** Отчёт фильтра loudnorm — последний JSON в сообщениях FFmpeg. */
export function parseLoudnorm(log: string): Loudness | null {
  const at = log.lastIndexOf('"input_i"');
  if (at < 0) return null;
  const from = log.lastIndexOf("{", at), to = log.indexOf("}", at);
  try { return JSON.parse(log.slice(from, to + 1)) as Loudness; } catch { return null; }
}
const finite = (s: string | undefined) => { const n = Number(s); return s !== undefined && Number.isFinite(n) ? n : null; };
async function measure(bin: string, file: string, signal?: AbortSignal) {
  const report = parseLoudnorm(await runFfmpeg(bin, ["-i", file, "-map", "0:a:0", "-af", `loudnorm=${LOUDNORM}:print_format=json`, "-f", "null", "-"], signal, "info"));
  return { lufs: finite(report?.input_i), peak: finite(report?.input_tp) };
}

export type SoundTrack = { seconds: number; lufs: number; path: string };
/** Какие треки звучат подряд: повторяются по кругу, пока не закроют ролик с учётом переходов. */
export function playlist<T extends { seconds: number }>(tracks: T[], duration: number, cross = CROSSFADE_SEC): T[] {
  const out: T[] = [];
  for (let length = 0, i = 0; tracks.length && length < duration; i++) {
    const t = tracks[i % tracks.length];
    length += out.length ? t.seconds - cross : t.seconds;
    out.push(t);
  }
  return out;
}
const dB = (x: number) => `${(Math.round(x * 100) / 100).toFixed(2)}dB`;
const FORMAT = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
/** Схема сведения. Вход 0 — голос, дальше треки по порядку; итог выходит на метку [mix]. */
export function soundFilter(voiceLufs: number, tracks: { lufs: number }[], duration: number): string {
  const voice = `[0:a]${FORMAT},volume=${dB(VOICE_LEVEL - voiceLufs)}`;
  if (!tracks.length) return `${voice}[mix]`;
  const parts = tracks.map((t, i) => `[${i + 1}:a]${FORMAT},volume=${dB(MUSIC_PAUSE_LEVEL - t.lufs)}[t${i}]`);
  let last = "t0";
  for (let i = 1; i < tracks.length; i++) { parts.push(`[${last}][t${i}]acrossfade=d=${CROSSFADE_SEC}:c1=tri:c2=tri[x${i}]`); last = `x${i}`; }
  const fadeOutAt = Math.max(duration - FADE_OUT_SEC, 0).toFixed(3);
  parts.push(`[${last}]atrim=0:${duration.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=${FADE_IN_SEC},afade=t=out:st=${fadeOutAt}:d=${FADE_OUT_SEC}[music]`);
  parts.push(`${voice},asplit=2[v][key]`);
  parts.push(`[music][key]sidechaincompress=${DUCK}[ducked]`);
  parts.push("[v][ducked]amix=inputs=2:normalize=0:duration=first:dropout_transition=0[mix]");
  return parts.join(";");
}

export type SoundResult = { lufs: number; peak: number };
/** Два прохода: сначала замер всей смеси, затем точная нормализация. Готовый файл измеряется ещё раз, уже после кодирования. */
export async function buildSound(o: { ffmpeg: string; voice: string; tracks: SoundTrack[]; duration: number; output: string; signal?: AbortSignal }): Promise<SoundResult> {
  const voice = await measure(o.ffmpeg, o.voice, o.signal);
  if (voice.lufs === null) throw new ApiError("VALIDATION", "Не удалось измерить громкость озвучки: возможно, в файле тишина.");
  const list = playlist(o.tracks, o.duration);
  const inputs = ["-i", o.voice, ...list.flatMap((t) => ["-i", t.path])];
  const graph = soundFilter(voice.lufs, list, o.duration);
  const first = parseLoudnorm(await runFfmpeg(o.ffmpeg, [...inputs, "-filter_complex", `${graph};[mix]loudnorm=${LOUDNORM}:print_format=json[out]`, "-map", "[out]", "-f", "null", "-"], o.signal, "info"));
  if (!first || finite(first.input_i) === null) throw new ApiError("UPSTREAM", "Не удалось измерить громкость смеси.", 502);
  const exact = `loudnorm=${LOUDNORM}:measured_I=${first.input_i}:measured_TP=${first.input_tp}:measured_LRA=${first.input_lra}:measured_thresh=${first.input_thresh}:offset=${first.target_offset}:linear=true`;
  await runFfmpeg(o.ffmpeg, [...inputs, "-filter_complex", `${graph};[mix]${exact},aresample=48000[out]`, "-map", "[out]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", o.output], o.signal);
  const made = await measure(o.ffmpeg, o.output, o.signal);
  if (made.lufs === null || made.peak === null || Math.abs(made.lufs - TARGET_LUFS) > LUFS_TOLERANCE || made.peak > MAX_PEAK) {
    await fs.rm(o.output, { force: true }).catch(() => {});
    throw new ApiError("UPSTREAM", `Громкость готового звука вне нормы: ${made.lufs} LUFS, пик ${made.peak} dBTP. Нужно ${TARGET_LUFS} LUFS (±${LUFS_TOLERANCE}), пик не выше ${MAX_PEAK} dBTP.`, 502);
  }
  return { lufs: made.lufs, peak: made.peak };
}

// ---------- музыка проекта ----------
export type MusicTrack = { name: string; file: string; seconds: number; lufs: number; use: boolean };
export type MusicState = { folder: string | null; tracks: MusicTrack[] };
export const MusicFolderInput = z.object({ folder: z.string().min(1).max(1000) }).strict();
export const MusicTracksInput = z.object({ tracks: z.array(z.object({ name: z.string().max(400), use: z.boolean() }).strict()).max(200) }).strict();

export async function musicState(projectId: string): Promise<MusicState> {
  const raw = await fs.readFile(projectFile(projectId, META), "utf8").catch(() => null);
  if (!raw) return { folder: null, tracks: [] };
  try { return JSON.parse(raw) as MusicState; } catch { return { folder: null, tracks: [] }; }
}
async function saveState(projectId: string, state: MusicState) {
  const file = projectFile(projectId, META);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(state), "utf8");
  await fs.rename(`${file}.tmp`, file);
}

/** Папка ролика: треки копируются в проект и измеряются. Оригиналы только читаются. */
export async function chooseMusicFolder(projectId: string, raw: z.input<typeof MusicFolderInput>) {
  const { folder } = MusicFolderInput.parse(raw);
  const { getProject } = await import("../projects.js");
  await getProject(projectId);
  if (!path.isAbsolute(folder)) throw new ApiError("VALIDATION", "Выберите папку по дереву компьютера.");
  const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => null);
  if (!entries) throw new ApiError("VALIDATION", "Папка не открывается. Выберите другую.");
  const names = entries.filter((e) => e.isFile() && AUDIO_FILE.test(e.name)).map((e) => e.name).sort((a, b) => a.localeCompare(b));
  if (!names.length) throw new ApiError("VALIDATION", "В этой папке нет аудиофайлов (mp3, wav, m4a, aac, ogg, flac).");
  const bin = ffmpegPath();
  if (!bin) throw new ApiError("VALIDATION", "Для музыки нужен FFmpeg. Установите его или укажите FFMPEG_PATH в .env и перезапустите TubeStudio.");

  const target = projectFile(projectId, FOLDER), temp = `${target}.tmp`;
  await fs.rm(temp, { recursive: true, force: true });
  await fs.mkdir(temp, { recursive: true });
  const tracks: MusicTrack[] = [], skipped: string[] = [];
  try {
    for (const [i, name] of names.entries()) {
      const local = `${String(i + 1).padStart(2, "0")}${path.extname(name).toLowerCase()}`, copy = path.join(temp, local);
      await fs.copyFile(path.join(folder, name), copy);
      const info = await probe(ffprobeFor(bin), copy);
      const level = info?.audio && info.seconds && info.seconds >= MIN_TRACK_SEC ? (await measure(bin, copy).catch(() => ({ lufs: null }))).lufs : null;
      if (!info?.seconds || level === null) { skipped.push(name); await fs.rm(copy, { force: true }); continue; }
      tracks.push({ name, file: `${FOLDER}/${local}`, seconds: info.seconds, lufs: level, use: true });
    }
    if (!tracks.length) throw new ApiError("VALIDATION", `Ни один файл не подошёл: они не открываются, беззвучны или короче ${MIN_TRACK_SEC} секунд.`);
    await fs.rm(target, { recursive: true, force: true });
    await fs.rename(temp, target);
  } finally { await fs.rm(temp, { recursive: true, force: true }).catch(() => {}); }
  const state = { folder, tracks };
  await saveState(projectId, state);
  return { ...state, skipped };
}

/** Порядок и галочки. Набор треков меняется только выбором папки. */
export async function saveMusicTracks(projectId: string, raw: z.input<typeof MusicTracksInput>) {
  const { tracks } = MusicTracksInput.parse(raw);
  const state = await musicState(projectId);
  const known = new Map(state.tracks.map((t) => [t.name, t]));
  if (tracks.length !== known.size || new Set(tracks.map((t) => t.name)).size !== known.size || tracks.some((t) => !known.has(t.name))) throw new ApiError("VALIDATION", "Список треков устарел. Обновите страницу.", 409);
  const next = { folder: state.folder, tracks: tracks.map((t) => ({ ...known.get(t.name)!, use: t.use })) };
  await saveState(projectId, next);
  return next;
}

/** Отмеченные треки для сборки, в выбранном порядке. */
export async function usedMusic(projectId: string): Promise<SoundTrack[]> {
  const used = (await musicState(projectId)).tracks.filter((t) => t.use);
  return Promise.all(used.map(async (t) => {
    const full = projectFile(projectId, t.file);
    if (!await fs.stat(full).then((s) => s.isFile(), () => false)) throw new ApiError("VALIDATION", `Не найдена копия трека «${t.name}». Выберите папку с музыкой заново.`);
    return { seconds: t.seconds, lufs: t.lufs, path: full };
  }));
}
