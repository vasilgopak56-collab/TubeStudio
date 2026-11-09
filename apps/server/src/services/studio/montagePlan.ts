// Выпуск 3, шаг 1: раскладка сцен по таймингам озвучки. Только расчёт: без диска, FFmpeg и платных сервисов.
// Клип длиннее фразы обрезается по её концу; клип короче — после него до конца фразы идёт статичный кадр той же сцены.
// Сцена без материалов ничем не подменяется: её место в плане помечено, а сборка считается неготовой.
import { ApiError } from "../../lib/errors.js";

export type MontageScene = {
  n: number;
  start: number;
  end: number;
  image: string | null;
  clip: string | null;
  /** Настоящая длина файла клипа в секундах. */
  clipSeconds: number | null;
};

type Span = { scene: number; start: number; end: number; seconds: number };
/** Клип всегда берётся с начала и до секунды clipTo. */
export type ClipSegment = Span & { kind: "clip"; file: string; clipTo: number };
/** Статичный кадр: из клипа на секунде clipTime или исходная картинка сцены (clipTime = null). */
export type StillSegment = Span & { kind: "still"; source: "clip" | "image"; file: string; clipTime: number | null };
export type MissingSegment = Span & { kind: "missing" };
export type MontageSegment = ClipSegment | StillSegment | MissingSegment;

export type MontageProblem = { scene: number; problem: "no-media" | "clip-length-unknown" };
export type MontagePlan = { duration: number; segments: MontageSegment[]; problems: MontageProblem[]; ready: boolean };

/** Кусок короче этого (примерно кадр) не становится отдельным: последний кадр соседнего куска держится чуть дольше. */
export const MIN_STILL_SEC = 0.05;
/** Допустимое расхождение границ соседних сцен: округление таймингов, а не настоящий разрыв. */
export const SCENE_GAP_TOLERANCE_SEC = 0.05;
/** Насколько конец последней сцены может заходить за конец звука. Больше — вероятно, тайминги от другой озвучки. */
export const AUDIO_OVERRUN_TOLERANCE_SEC = 0.5;

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const span = (scene: number, start: number, end: number): Span => ({ scene, start, end, seconds: r3(end - start) });

function validate(scenes: MontageScene[], audioSec: number) {
  if (!Number.isFinite(audioSec) || audioSec <= 0) throw new ApiError("VALIDATION", "Длина озвучки неизвестна или равна нулю.");
  if (!scenes.length) throw new ApiError("VALIDATION", "В раскадровке нет сцен.");
  scenes.forEach((s, i) => {
    if (!Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end < s.start) throw new ApiError("VALIDATION", `Сцена ${s.n}: неверные границы по времени.`);
    const prev = scenes[i - 1];
    if (prev && (s.start < prev.start || Math.abs(s.start - prev.end) > SCENE_GAP_TOLERANCE_SEC)) throw new ApiError("VALIDATION", `Сцены ${prev.n} и ${s.n}: между ними разрыв или наложение по времени.`);
  });
  if (scenes[scenes.length - 1].end > audioSec + AUDIO_OVERRUN_TOLERANCE_SEC) throw new ApiError("VALIDATION", "Сцены заканчиваются позже озвучки. Проверьте, что раскадровка сделана по этой озвучке.");
}

function problemOf(s: MontageScene): MontageProblem["problem"] | null {
  if (s.clip) return s.clipSeconds !== null && Number.isFinite(s.clipSeconds) && s.clipSeconds > 0 ? null : "clip-length-unknown";
  return s.image ? null : "no-media";
}

/** План монтажа: куски идут встык от нуля до конца озвучки, тишина по краям закрыта статичным кадром первой и последней сцены. */
export function buildMontagePlan(scenes: MontageScene[], audioSec: number): MontagePlan {
  validate(scenes, audioSec);
  const duration = r3(audioSec);
  const at = (t: number) => r3(Math.min(t, duration));
  const segments: MontageSegment[] = [];
  const problems: MontageProblem[] = [];

  scenes.forEach((s, i) => {
    const isLast = i === scenes.length - 1;
    const problem = problemOf(s);
    let from = at(s.start);
    const phraseEnd = at(isLast ? s.end : scenes[i + 1].start);
    const to = isLast ? duration : phraseEnd;

    if (i === 0) {
      if (from >= MIN_STILL_SEC && !problem) {
        segments.push(s.clip
          ? { ...span(s.n, 0, from), kind: "still", source: "clip", file: s.clip, clipTime: 0 }
          : { ...span(s.n, 0, from), kind: "still", source: "image", file: s.image as string, clipTime: null });
      } else from = 0;
    }
    if (to <= from) return;

    if (problem) {
      problems.push({ scene: s.n, problem });
      segments.push({ ...span(s.n, from, to), kind: "missing" });
      return;
    }
    if (!s.clip) {
      segments.push({ ...span(s.n, from, to), kind: "still", source: "image", file: s.image as string, clipTime: null });
      return;
    }
    const used = r3(Math.min(s.clipSeconds as number, Math.max(0, phraseEnd - from)));
    const stillFrom = r3(from + used);
    if (to - stillFrom < MIN_STILL_SEC) {
      segments.push({ ...span(s.n, from, to), kind: "clip", file: s.clip, clipTo: used });
      return;
    }
    if (used > 0) segments.push({ ...span(s.n, from, stillFrom), kind: "clip", file: s.clip, clipTo: used });
    segments.push({ ...span(s.n, stillFrom, to), kind: "still", source: "clip", file: s.clip, clipTime: used });
  });

  return { duration, segments, problems, ready: problems.length === 0 };
}
