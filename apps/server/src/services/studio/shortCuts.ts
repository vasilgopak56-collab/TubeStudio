// Выпуск 4: Shorts нарезкой из принятого монтажа. Только FFmpeg на этом компьютере: платных запросов нет.
// Вертикальный кадр 1080×1920: весь кадр ролика по центру, сверху и снизу его размытая копия, крупные субтитры под кадром.
// Каждый Short автор смотрит и принимает сам, принятие привязано к конкретному файлу.
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ApiError } from "../../lib/errors.js";
import type { JobCtx } from "../../lib/jobs.js";
import { writeFileAtomic } from "../../lib/storage.js";
import { ffmpegPath } from "../audioFx.js";
import { ffprobeFor, probe, projectFile } from "./montageCheck.js";
import { copyFiles, exportState, safeName } from "./montageExport.js";
import { FPS, VIDEO_CODEC, lockMontage } from "./montageRender.js";
import { LOUDNORM, LUFS_TOLERANCE, MAX_PEAK, TARGET_LUFS, measure, parseLoudnorm, runFfmpeg } from "./montageSound.js";
import { SUB_FILES, toAss, type AssLayout } from "./montageSubtitles.js";
import { MAX_DESCRIPTION_BYTES, MAX_TITLE, currentChapters, parseVideoId, readCard, serial } from "./publishCard.js";
import { parseSubtitles, type Cue } from "./scenes.js";

export const MIN_SEC = 20, MAX_SEC = 55, MAX_PICK = 5;
const W = 1080, H = 1920;
/** Весь кадр 16:9 по ширине вертикального. */
const FRAME_H = 608;
const LENGTH_TOLERANCE_SEC = 0.1, END_TOLERANCE_SEC = 0.5, MIN_CUE_SEC = 0.2, FADE_SEC = 0.25;
/** Текст начинается сразу под кадром и растёт вниз, поэтому не закрывает картинку. */
const SHORT_SUBTITLES: AssLayout = { width: W, height: H, size: 68, outline: 6, align: 8, marginH: 80, marginV: 1290 };
const FOLDER = "shorts", STORE = `${FOLDER}/shorts.json`;
const SENTENCE_END = /[.!?…]["'»”)\]]*\s*$/;

export type FragmentRow = { n: number; start: number; end: number; paragraph: number; text: string };
export type Fragment = { id: string; fromScene: number; toScene: number; start: number; end: number; seconds: number; text: string };

/** Куски начинаются с нового абзаца и заканчиваются на конце фразы: одна мысль, поэтому берётся первый конец абзаца не короче 20 секунд. Куски не пересекаются. */
export function proposeFragments(rows: FragmentRow[], duration: number): Fragment[] {
  const out: Fragment[] = [];
  let i = 0;
  while (i < rows.length) {
    if (i > 0 && rows[i].paragraph === rows[i - 1].paragraph) { i++; continue; }
    let sentence = -1, paragraph = -1;
    for (let j = i; j < rows.length; j++) {
      const length = rows[j].end - rows[i].start;
      if (length > MAX_SEC || rows[j].end > duration + END_TOLERANCE_SEC) break;
      if (length < MIN_SEC || !SENTENCE_END.test(rows[j].text)) continue;
      sentence = j;
      if (j === rows.length - 1 || rows[j + 1].paragraph !== rows[j].paragraph) { paragraph = j; break; }
    }
    const last = paragraph >= 0 ? paragraph : sentence;
    if (last < 0) { i++; continue; }
    const start = rows[i].start, end = Math.min(rows[last].end, duration);
    out.push({ id: `${rows[i].n}-${rows[last].n}`, fromScene: rows[i].n, toScene: rows[last].n, start, end, seconds: Math.round((end - start) * 1000) / 1000, text: rows.slice(i, last + 1).map((r) => r.text.trim()).join(" ") });
    i = last + 1;
  }
  return out;
}

/** Фразы куска со временем от его начала. Хвосты соседних фраз короче 0,2 с не показываются. */
export function shortCues(cues: Cue[], start: number, end: number): Cue[] {
  return cues.flatMap((c) => {
    const from = Math.max(c.start, start), to = Math.min(c.end, end);
    const shift = (t: number) => Math.round((t - start) * 1000) / 1000;
    return to - from >= MIN_CUE_SEC ? [{ start: shift(from), end: shift(to), text: c.text }] : [];
  });
}

export const shortVideoFilter = (ass: string) =>
  `[0:v]split=2[bg][fg];[bg]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=12:2,scale=${W}:${H}:flags=bicubic,setsar=1[blur];` +
  `[fg]scale=${W}:${FRAME_H}:flags=lanczos,setsar=1[frame];[blur][frame]overlay=0:(H-h)/2,ass=${ass},format=yuv420p[v]`;
const fades = (seconds: number) => `afade=t=in:d=0.05,afade=t=out:st=${Math.max(seconds - FADE_SEC, 0).toFixed(3)}:d=${FADE_SEC}`;

export type CutOptions = { ffmpeg: string; input: string; dir: string; name: string; start: number; seconds: number; cues: Cue[]; onTime?: (seconds: number) => void; signal?: AbortSignal };
export type CutResult = { seconds: number; bytes: number; width: number; height: number; lufs: number; peak: number };

/** Один Short: звук нормализуется в два прохода, готовый файл проверяется по размеру, длине и громкости. */
export async function cutShort(o: CutOptions): Promise<CutResult> {
  await fs.mkdir(o.dir, { recursive: true });
  const ass = `${o.name}.ass`, temp = path.join(o.dir, `${o.name}.tmp.mp4`), final = path.join(o.dir, o.name);
  const span = ["-ss", o.start.toFixed(3), "-t", o.seconds.toFixed(3), "-i", o.input];
  try {
    const report = parseLoudnorm(await runFfmpeg(o.ffmpeg, [...span, "-map", "0:a:0", "-af", `${fades(o.seconds)},loudnorm=${LOUDNORM}:print_format=json`, "-f", "null", "-"], o.signal, "info"));
    if (!report || !Number.isFinite(Number(report.input_i))) throw new ApiError("UPSTREAM", "Не удалось измерить громкость этого куска.", 502);
    const exact = `loudnorm=${LOUDNORM}:measured_I=${report.input_i}:measured_TP=${report.input_tp}:measured_LRA=${report.input_lra}:measured_thresh=${report.input_thresh}:offset=${report.target_offset}:linear=true`;
    await fs.writeFile(path.join(o.dir, ass), toAss(o.cues, SHORT_SUBTITLES), "utf8");
    await runFfmpeg(o.ffmpeg, [...span, "-filter_complex", `${shortVideoFilter(ass)};[0:a]${fades(o.seconds)},${exact},aresample=48000[a]`, "-map", "[v]", "-map", "[a]", ...VIDEO_CODEC, "-frames:v", String(Math.round(o.seconds * FPS)), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", temp], o.signal, "error", { cwd: o.dir, onTime: o.onTime });
    const made = await probe(ffprobeFor(o.ffmpeg), temp);
    if (!made?.seconds || made.width !== W || made.height !== H || !made.audio || Math.abs(made.seconds - o.seconds) > LENGTH_TOLERANCE_SEC) throw new ApiError("UPSTREAM", `Готовый Short не совпал с планом: ${made ? `${made.width}×${made.height}, ${made.seconds} с` : "файл не открывается"}, ожидалось ${W}×${H}, ${o.seconds.toFixed(2)} с.`, 502);
    const sound = await measure(o.ffmpeg, temp, o.signal);
    if (sound.lufs === null || sound.peak === null || Math.abs(sound.lufs - TARGET_LUFS) > LUFS_TOLERANCE || sound.peak > MAX_PEAK) throw new ApiError("UPSTREAM", `Громкость Short вне нормы: ${sound.lufs} LUFS, пик ${sound.peak} dBTP.`, 502);
    await fs.rename(temp, final);
    return { seconds: made.seconds, bytes: (await fs.stat(final)).size, width: W, height: H, lufs: sound.lufs, peak: sound.peak };
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
    await fs.rm(path.join(o.dir, ass), { force: true }).catch(() => {});
  }
}

// ---------- проект ----------
export type ShortItem = CutResult & { id: string; fromScene: number; toScene: number; start: number; end: number; text: string; file: string; source: string; at: string; acceptedAt: string | null; title: string; description: string; videoId: string | null };
type Exported = { folder: string; at: string; files: string[] };
type Store = { items: ShortItem[]; exported: Exported | null };
const readStore = async (projectId: string): Promise<Store> => {
  const raw = await fs.readFile(projectFile(projectId, STORE), "utf8").catch(() => null);
  if (!raw) return { items: [], exported: null };
  try { return { items: [], exported: null, ...(JSON.parse(raw) as Partial<Store>) }; } catch { return { items: [], exported: null }; }
};
const writeStore = (projectId: string, store: Store) => writeFileAtomic(projectFile(projectId, STORE), JSON.stringify(store), { backup: true });

/** Из какого монтажа можно резать. Раскадровка должна совпадать со сборкой, иначе время кусков разойдётся с видео. */
async function basis(projectId: string) {
  const [{ visual, montage }, exported] = await Promise.all([currentChapters(projectId, []), exportState(projectId)]);
  const r = montage.result, board = visual.board;
  const blocker = !r ? "Сначала соберите ролик в разделе «Монтаж»."
    : !exported.accepted ? "Сначала посмотрите и примите ролик в разделе «Монтаж»."
    : !r.subtitles?.files ? "У этой сборки нет субтитров. Соберите ролик в разделе «Монтаж» заново."
    : !board || board.updatedAt > r.at ? "Раскадровку меняли после сборки: время кусков разойдётся с видео. Соберите и примите ролик заново."
    : null;
  return { blocker, result: r, fragments: blocker || !board ? [] : proposeFragments(board.rows as FragmentRow[], r!.seconds), language: board?.language ?? null, project: visual.project, running: montage.running };
}

/** Описание для загрузки: текст автора, ссылка на полный ролик, если она сохранена на «Публикации», и хештег. */
export function shortDescription(text: string, fullVideoId: string | null, language: string | null) {
  const label = /^(ru|uk)/.test(language ?? "") ? "Полный ролик:" : "Full video:", clean = text.trim();
  return [clean, fullVideoId ? `${label} https://youtu.be/${fullVideoId}` : "", /#shorts\b/i.test(clean) ? "" : "#Shorts"].filter(Boolean).join("\n\n");
}

export async function shortsState(projectId: string) {
  const [b, store, card] = await Promise.all([basis(projectId), readStore(projectId), readCard(projectId)]);
  const source = b.result?.file ?? null, current = store.items.filter((i) => i.source === source);
  const language = card.language ?? b.language, fullVideoId = card.video?.id ?? null;
  return {
    project: b.project, running: b.running, blocker: b.blocker, fragments: b.fragments, fullVideoId, exported: store.exported,
    outdated: store.items.length - current.length, limits: { title: MAX_TITLE, descriptionBytes: MAX_DESCRIPTION_BYTES, pick: MAX_PICK },
    items: current.map((i) => ({ ...i, finalDescription: shortDescription(i.description, fullVideoId, language) })),
  };
}

export const BuildInput = z.object({ ids: z.array(z.string().regex(/^\d+-\d+$/)).min(1, "Отметьте хотя бы один кусок").max(MAX_PICK, `Не больше ${MAX_PICK} кусков за раз`) }).strict();
export function buildShorts(projectId: string, raw: unknown, ctx: JobCtx) {
  const { ids } = BuildInput.parse(raw);
  if (new Set(ids).size !== ids.length) throw new ApiError("VALIDATION", "Один кусок отмечен дважды. Обновите страницу.");
  return lockMontage(projectId, "shorts", async () => {
    ctx.progress("Подготовка", 1);
    const b = await basis(projectId);
    if (b.blocker || !b.result) throw new ApiError("VALIDATION", b.blocker ?? "Сначала соберите ролик.");
    const source = b.result.file, chosen = ids.map((id) => b.fragments.find((f) => f.id === id));
    if (chosen.some((f) => !f)) throw new ApiError("VALIDATION", "Список кусков изменился. Обновите страницу.", 409);
    const bin = ffmpegPath();
    if (!bin) throw new ApiError("VALIDATION", "Для сборки нужен FFmpeg. Установите его или укажите FFMPEG_PATH в .env и перезапустите TubeStudio.");
    const srt = await fs.readFile(projectFile(projectId, SUB_FILES.srt), "utf8").catch(() => null);
    if (srt === null) throw new ApiError("VALIDATION", "Файл субтитров монтажа не открывается. Соберите ролик заново.");
    const cues = parseSubtitles(srt), dir = projectFile(projectId, FOLDER);
    // Shorts от прежней сборки монтажа больше не нужны: их нельзя принять и сохранить.
    await serial(projectId, async () => {
      const store = await readStore(projectId), old = store.items.filter((i) => i.source !== source);
      for (const i of old) await fs.rm(projectFile(projectId, i.file), { force: true }).catch(() => {});
      if (old.length) await writeStore(projectId, { ...store, items: store.items.filter((i) => i.source === source) });
    });
    const made: ShortItem[] = [];
    for (const [k, f] of (chosen as Fragment[]).entries()) {
      const label = `Short ${k + 1} из ${ids.length}`, share = 98 / ids.length;
      ctx.progress(label, Math.floor(1 + k * share));
      const name = `short-${f.id}-${Date.now()}.mp4`;
      const result = await cutShort({ ffmpeg: bin, input: projectFile(projectId, source), dir, name, start: f.start, seconds: f.seconds, cues: shortCues(cues, f.start, f.end), signal: ctx.signal, onTime: (t) => ctx.progress(label, Math.min(99, Math.floor(1 + (k + Math.min(t / f.seconds, 1)) * share))) });
      const item = await serial(projectId, async () => {
        const store = await readStore(projectId), previous = store.items.find((i) => i.id === f.id);
        const next: ShortItem = { ...f, ...result, file: `${FOLDER}/${name}`, source, at: new Date().toISOString(), acceptedAt: null, title: previous?.title ?? "", description: previous?.description ?? "", videoId: previous?.videoId ?? null };
        await writeStore(projectId, { ...store, items: [...store.items.filter((i) => i.id !== f.id), next].sort((a, b) => a.start - b.start) });
        if (previous) await fs.rm(projectFile(projectId, previous.file), { force: true }).catch(() => {});
        return next;
      });
      made.push(item);
    }
    ctx.progress("Готово", 100);
    return { items: made };
  });
}

export const AcceptShortInput = z.object({ id: z.string().regex(/^\d+-\d+$/), file: z.string().min(1).max(400) }).strict();
/** Принятие действует только для того файла, который автор посмотрел. */
export function acceptShort(projectId: string, raw: unknown) {
  const { id, file } = AcceptShortInput.parse(raw);
  return serial(projectId, async () => {
    const store = await readStore(projectId), item = store.items.find((i) => i.id === id);
    if (!item || item.file !== file) throw new ApiError("VALIDATION", "Этот Short уже изменился. Обновите страницу и посмотрите новый вариант.", 409);
    item.acceptedAt = new Date().toISOString();
    await writeStore(projectId, store);
    return shortsState(projectId);
  });
}

export const ShortTextInput = z.object({
  title: z.string().trim().max(400).refine((t) => [...t].length <= MAX_TITLE, `Название длиннее ${MAX_TITLE} знаков`).refine((t) => !/[<>]/.test(t), "YouTube не принимает знаки < и >"),
  description: z.string().trim().max(MAX_DESCRIPTION_BYTES, `Описание длиннее ${MAX_DESCRIPTION_BYTES} знаков`).refine((t) => !/[<>]/.test(t), "YouTube не принимает знаки < и >"),
  url: z.string().trim().max(300).nullable(),
}).strict();
/** Название, описание и ссылка на загруженный Short. Запросов в сеть нет. */
export function saveShortText(projectId: string, id: string, raw: unknown) {
  const { title, description, url } = ShortTextInput.parse(raw);
  const videoId = url ? parseVideoId(url) : null;
  if (url && !videoId) throw new ApiError("VALIDATION", "Это не похоже на ссылку на ролик YouTube. Вставьте адрес вида https://youtube.com/shorts/…");
  return serial(projectId, async () => {
    const store = await readStore(projectId), item = store.items.find((i) => i.id === id);
    if (!item) throw new ApiError("VALIDATION", "Этот Short уже изменился. Обновите страницу.", 409);
    const [card, b] = await Promise.all([readCard(projectId), basis(projectId)]);
    if (Buffer.byteLength(shortDescription(description, card.video?.id ?? null, card.language ?? b.language), "utf8") > MAX_DESCRIPTION_BYTES) throw new ApiError("VALIDATION", `Описание со ссылкой и хештегом длиннее ${MAX_DESCRIPTION_BYTES} байт.`);
    Object.assign(item, { title, description, videoId });
    await writeStore(projectId, store);
    return shortsState(projectId);
  });
}

/** В папку автора попадают только принятые Shorts. Существующие файлы не перезаписываются. */
export function exportShorts(projectId: string, folder: string, ctx: JobCtx) {
  return lockMontage(projectId, "shorts", async () => {
    if (!path.isAbsolute(folder) || !await fs.stat(folder).then((s) => s.isDirectory(), () => false)) throw new ApiError("VALIDATION", "Папка не открывается. Выберите другую.");
    const [b, store] = await Promise.all([basis(projectId), readStore(projectId)]);
    const accepted = store.items.filter((i) => i.source === b.result?.file && i.acceptedAt);
    if (!accepted.length) throw new ApiError("VALIDATION", "Сначала посмотрите Short и примите его.");
    ctx.progress("Копирование", 1);
    const files = await copyFiles({
      folder, signal: ctx.signal, items: accepted.map((i, k) => ({ from: projectFile(projectId, i.file), name: `${safeName(i.title || `${b.project.title} Short ${k + 1}`)}.mp4` })),
      onProgress: (done, total, name) => ctx.progress(`Копирование: ${name}`, Math.min(99, Math.floor((99 * done) / total))),
    });
    const exported = { folder, at: new Date().toISOString(), files };
    await serial(projectId, async () => writeStore(projectId, { ...(await readStore(projectId)), exported }));
    return exported;
  });
}
