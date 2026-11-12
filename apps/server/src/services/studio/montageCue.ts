// Выпуск 3.14: «Музыка по таблице». Таблица Excel из папки музыки ролика говорит, какой кусок какого трека где звучит.
// Только чтение таблицы и FFmpeg на этом компьютере, платных запросов нет. Заметки таблицы показываются, но не выполняются.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ApiError } from "../../lib/errors.js";
import { projectFile } from "./montageCheck.js";
import { MUSIC_PAUSE_LEVEL, musicState, type MusicTrack } from "./montageSound.js";

type ExcelCell = { value: unknown; numFmt?: string };
type ExcelSheet = { name: string; rowCount: number; getRow(n: number): { cellCount: number; getCell(n: number): ExcelCell } };
type ExcelBook = { worksheets: ExcelSheet[]; xlsx: { load(data: Buffer): Promise<unknown> } };
const ExcelJS = createRequire(import.meta.url)("exceljs") as { Workbook: new () => ExcelBook };

/** Расхождение времени в таблице, которое ещё считается совпадением, секунд. */
export const CUE_TOLERANCE_SEC = 0.5;
/** «Плавно» в столбце «Окончание»: затухание в конце куска. */
export const CUE_FADE_SEC = 2;
/** Короткое нарастание и спад там, где перехода нет: без щелчка на границе куска. */
export const CUE_DECLICK_SEC = 0.02;
export const CUE_GAIN_MIN = -30, CUE_GAIN_MAX = 12;
const MAX_ROWS = 500;
const SHEET = "cue-sheet";
const META = "montage/music-cue.json";

export type CueLayer = "base" | "over";
export type CueEnding = "fade" | "cut";
/** Строка таблицы. row — номер строки в Excel, n — значение столбца «№». */
export type CueRow = { row: number; n: string | null; start: number; end: number; layer: CueLayer; file: string; from: number; to: number; gainDb: number; ending: CueEnding; note: string };
export type CueProblem = { row: number | null; message: string };
export type CueTable = { name: string; at: string; rows: CueRow[]; problems: CueProblem[] };
export type MusicMode = "sequence" | "cue";
type CueStored = { mode: MusicMode; folder: string | null; table: CueTable | null };

// ---------- чтение таблицы ----------
const COLUMNS = {
  n: ["№"], start: ["начало"], end: ["конец"], layer: ["слой"], file: ["файл"], from: ["вход в треке"], to: ["выход из трека"],
  gain: ["громкость, дб", "громкость дб", "громкость"], ending: ["окончание"], note: ["заметка"],
} as const;
type Column = keyof typeof COLUMNS;
const REQUIRED: Column[] = ["start", "end", "layer", "file", "from", "to"];
const TITLE: Record<Column, string> = { n: "№", start: "Начало", end: "Конец", layer: "Слой", file: "Файл", from: "Вход в треке", to: "Выход из трека", gain: "Громкость, дБ", ending: "Окончание", note: "Заметка" };
const key = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase().replace(/ё/g, "е");

/** Ячейка как есть: у формулы — её результат, у форматированного текста — сам текст. */
function plain(v: unknown): unknown {
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown; error?: unknown };
    if ("result" in o) return plain(o.result);
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if ("text" in o) return plain(o.text);
    return null;
  }
  return v;
}
const text = (v: unknown) => { const p = plain(v); return p === null || p === undefined ? "" : p instanceof Date ? p.toISOString() : String(p).trim(); };
const EXCEL_ZERO = Date.UTC(1899, 11, 30);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Время из ячейки: время Excel (чч:мм:сс), число секунд или текст «1:27», «0:01:27», «87,5». */
export function cueTime(cell: ExcelCell): number | null {
  const v = plain(cell.value);
  if (v instanceof Date) return r3((v.getTime() - EXCEL_ZERO) / 1000);
  if (typeof v === "number" && Number.isFinite(v)) return r3(/[hms:]/i.test(cell.numFmt ?? "") ? v * 86_400 : v);
  if (typeof v !== "string") return null;
  const m = /^(?:(\d+):)?(?:(\d+):)?(\d+(?:[.,]\d+)?)$/.exec(v.trim());
  if (!m) return null;
  const [h, mm] = m[2] !== undefined ? [Number(m[1]), Number(m[2])] : [0, Number(m[1] ?? 0)];
  return r3(h * 3600 + mm * 60 + Number(m[3].replace(",", ".")));
}

/** Разбор листа: заголовок в первой строке. Строки без файла и времени пропускаются, остальные проверяются по одной. */
export function parseCueSheet(sheet: Pick<ExcelSheet, "rowCount" | "getRow">): { rows: CueRow[]; problems: CueProblem[] } {
  const head = sheet.getRow(1), at = new Map<Column, number>(), problems: CueProblem[] = [];
  for (let c = 1; c <= head.cellCount; c++) {
    const name = key(text(head.getCell(c).value));
    for (const [col, names] of Object.entries(COLUMNS) as [Column, readonly string[]][]) if (!at.has(col) && names.includes(name)) at.set(col, c);
  }
  const absent = REQUIRED.filter((c) => !at.has(c));
  if (absent.length) return { rows: [], problems: [{ row: 1, message: `В первой строке таблицы нет столбцов: ${absent.map((c) => `«${TITLE[c]}»`).join(", ")}.` }] };
  const rows: CueRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r), cell = (c: Column): ExcelCell => (at.has(c) ? row.getCell(at.get(c)!) : { value: null });
    if (REQUIRED.every((c) => text(cell(c).value) === "")) continue;
    if (rows.length >= MAX_ROWS) { problems.push({ row: r, message: `В таблице больше ${MAX_ROWS} строк.` }); break; }
    const wrong: string[] = [];
    const time = (c: Column) => { const t = cueTime(cell(c)); if (t === null || t < 0) wrong.push(`«${TITLE[c]}» — не время`); return t ?? 0; };
    const start = time("start"), end = time("end"), from = time("from"), to = time("to");
    const layerText = key(text(cell("layer").value));
    const layer: CueLayer | null = layerText === "основа" ? "base" : layerText === "поверх" ? "over" : null;
    if (!layer) wrong.push("«Слой» — нужно «Основа» или «Поверх»");
    const file = text(cell("file").value);
    if (!file) wrong.push("не указан «Файл»");
    const gainText = text(cell("gain").value).replace(/[−–]/g, "-").replace(",", ".").replace(/\s*(дб|db)$/i, "");
    const gainDb = gainText === "" ? 0 : Number(gainText);
    if (!Number.isFinite(gainDb) || gainDb < CUE_GAIN_MIN || gainDb > CUE_GAIN_MAX) wrong.push(`«${TITLE.gain}» — нужно число от ${CUE_GAIN_MIN} до ${CUE_GAIN_MAX}`);
    const endingText = key(text(cell("ending").value));
    const ending: CueEnding | null = endingText === "" || endingText === "плавно" ? "fade" : endingText === "обрыв" ? "cut" : null;
    if (!ending) wrong.push("«Окончание» — нужно «плавно» или «обрыв»");
    const n = text(cell("n").value) || null;
    if (wrong.length) { problems.push({ row: r, message: `${rowName({ row: r, n })}: ${wrong.join("; ")}.` }); continue; }
    rows.push({ row: r, n, start, end, layer: layer!, file, from, to, gainDb, ending: ending!, note: text(cell("note").value) });
  }
  if (!rows.length && !problems.length) problems.push({ row: null, message: "В таблице нет ни одной строки с музыкой." });
  return { rows, problems };
}

export const rowName = (r: { row: number; n: string | null }) => `Строка ${r.row}${r.n ? ` (№ ${r.n})` : ""}`;
const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(s % 1 ? 1 : 0).padStart(s % 1 ? 4 : 2, "0")}`;

// ---------- проверка до сборки ----------
/** Ошибки строк. Любая из них блокирует сборку. duration — длина ролика, если она уже известна. */
export function cueErrors(rows: CueRow[], tracks: { name: string; seconds: number }[], duration: number | null): CueProblem[] {
  const out: CueProblem[] = [], err = (r: CueRow, m: string) => out.push({ row: r.row, message: `${rowName(r)}: ${m}` });
  const byName = new Map(tracks.map((t) => [key(t.name), t]));
  const tol = CUE_TOLERANCE_SEC;
  for (const r of rows) {
    const t = byName.get(key(r.file));
    if (!t) err(r, `файла «${r.file}» нет среди треков папки музыки (или он не подошёл при копировании).`);
    if (r.start >= r.end) err(r, `начало ${clock(r.start)} не раньше конца ${clock(r.end)}.`);
    if (r.from >= r.to) err(r, `вход в треке ${clock(r.from)} не раньше выхода ${clock(r.to)}.`);
    if (t && r.to > t.seconds + tol) err(r, `выход из трека ${clock(r.to)} дальше конца трека (${clock(t.seconds)}).`);
    if (r.start < r.end && r.from < r.to && Math.abs((r.to - r.from) - (r.end - r.start)) > tol) err(r, `кусок трека ${clock(r.to - r.from)} не равен месту в ролике ${clock(r.end - r.start)} (допуск ±${tol} с).`);
    if (duration !== null && r.end > duration + tol) err(r, `конец ${clock(r.end)} позже конца ролика (${clock(duration)}).`);
  }
  // В «Основе» соседние строки могут перекрываться только краями: перекрытие становится плавным переходом.
  const base = rows.filter((r) => r.layer === "base" && r.start < r.end).sort((a, b) => a.start - b.start || a.row - b.row);
  for (let i = 1; i < base.length; i++) {
    const a = base[i - 1], b = base[i];
    if (b.start >= a.end) continue;
    if (b.start <= a.start || b.end <= a.end) err(b, `в слое «Основа» лежит внутри строки ${a.row}. Чтобы куски звучали вместе, поставьте одному из них «Поверх».`);
    else if (i > 1 && b.start < base[i - 2].end) err(b, `в слое «Основа» перекрывает сразу строки ${base[i - 2].row} и ${a.row}.`);
  }
  return out;
}

// ---------- раскладка для сведения ----------
/** Кусок для FFmpeg: file — копия трека, from — место в треке, at — место в ролике, секунды. Каждый кусок — свой вход FFmpeg. */
export type CuePiece = { row: number; file: string; from: number; length: number; at: number; level: number; fadeIn: number; fadeOut: number };
/** files — сколько разных треков звучит, rows — сколько строк в таблице. */
export type CueMix = { pieces: CuePiece[]; files: number; rows: number };

/** Каждая строка — кусок трека на своём месте. Перекрытие соседних строк «Основы» — переход на всё перекрытие. */
export function cueLayout(rows: CueRow[], tracks: { name: string; seconds: number; lufs: number; path: string }[], duration: number, pauseLevel: number): CueMix {
  const byName = new Map(tracks.map((t) => [key(t.name), t]));
  const base = rows.filter((r) => r.layer === "base").sort((a, b) => a.start - b.start || a.row - b.row);
  const overlapIn = new Map<CueRow, number>(), overlapOut = new Map<CueRow, number>();
  for (let i = 1; i < base.length; i++) {
    const shared = Math.min(base[i - 1].end, duration) - base[i].start;
    if (shared > 0) { overlapOut.set(base[i - 1], shared); overlapIn.set(base[i], shared); }
  }
  const pieces = rows.flatMap((r): CuePiece[] => {
    const t = byName.get(key(r.file));
    if (!t) throw new ApiError("VALIDATION", `${rowName(r)}: файла «${r.file}» нет среди треков папки музыки.`);
    const end = Math.min(r.end, duration);
    // Место в ролике главнее: кусок длиной «конец − начало», но не дальше конца трека.
    const length = r3(Math.min(end - r.start, t.seconds - r.from));
    if (length <= 0) return [];
    let fadeIn = overlapIn.get(r) ?? CUE_DECLICK_SEC;
    let fadeOut = overlapOut.get(r) ?? (r.ending === "fade" ? CUE_FADE_SEC : CUE_DECLICK_SEC);
    if (fadeIn + fadeOut > length) { const k = length / (fadeIn + fadeOut); fadeIn *= k; fadeOut *= k; }
    return [{ row: r.row, file: t.path, from: r.from, length, at: r.start, level: pauseLevel - t.lufs + r.gainDb, fadeIn: r3(fadeIn), fadeOut: r3(fadeOut) }];
  });
  return { pieces, files: new Set(pieces.map((p) => p.file)).size, rows: rows.length };
}

// ---------- состояние проекта ----------
export const MusicModeInput = z.object({ mode: z.enum(["sequence", "cue"]) }).strict();

async function readStored(projectId: string): Promise<CueStored> {
  const raw = await fs.readFile(projectFile(projectId, META), "utf8").catch(() => null);
  try { if (raw) return JSON.parse(raw) as CueStored; } catch { /* испорченный файл — как будто таблицы не было */ }
  return { mode: "sequence", folder: null, table: null };
}
async function writeStored(projectId: string, value: CueStored) {
  const file = projectFile(projectId, META);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(value), "utf8");
  await fs.rename(`${file}.tmp`, file);
}
/** Таблица относится к папке, из которой загружена: после выбора другой папки её нужно загрузить заново. */
async function current(projectId: string) {
  const [stored, music] = await Promise.all([readStored(projectId), musicState(projectId)]);
  const table = stored.table && stored.folder === music.folder ? stored.table : null;
  return { mode: stored.mode, table, music };
}

export type CueState = { mode: MusicMode; table: CueTable | null; errors: CueProblem[] };
/** Для страницы: режим, загруженная таблица и её ошибки по трекам папки. Длину ролика проверяет «Проверить» и сборка. */
export async function cueState(projectId: string): Promise<CueState> {
  const { mode, table, music } = await current(projectId);
  return { mode, table, errors: table ? [...table.problems, ...cueErrors(table.rows, music.tracks, null)] : [] };
}

export async function saveMusicMode(projectId: string, raw: z.input<typeof MusicModeInput>) {
  const { mode } = MusicModeInput.parse(raw);
  const { getProject } = await import("../projects.js");
  await getProject(projectId);
  const stored = await readStored(projectId);
  await writeStored(projectId, { ...stored, mode });
  return cueState(projectId);
}

/** Таблица .xlsx из выбранной папки музыки. Временные файлы Excel («~$…») не считаются. */
export async function loadCueTable(projectId: string): Promise<CueState> {
  const { getProject } = await import("../projects.js");
  await getProject(projectId);
  const music = await musicState(projectId);
  if (!music.folder) throw new ApiError("VALIDATION", "Сначала выберите папку с музыкой: таблица берётся из неё.");
  const entries = await fs.readdir(music.folder, { withFileTypes: true }).catch(() => null);
  if (!entries) throw new ApiError("VALIDATION", "Папка с музыкой не открывается. Выберите её заново.");
  const found = entries.filter((e) => e.isFile() && /\.xlsx$/i.test(e.name) && !e.name.startsWith("~$")).map((e) => e.name).sort((a, b) => a.localeCompare(b));
  if (!found.length) throw new ApiError("VALIDATION", "В папке с музыкой нет таблицы .xlsx.");
  const name = found.length === 1 ? found[0] : found.find((f) => key(f) === "music_cue_sheet.xlsx");
  if (!name) throw new ApiError("VALIDATION", `В папке с музыкой несколько таблиц: ${found.join(", ")}. Оставьте одну или назовите нужную music_cue_sheet.xlsx.`);
  const book = new ExcelJS.Workbook();
  try { await book.xlsx.load(await fs.readFile(path.join(music.folder, name))); }
  catch { throw new ApiError("VALIDATION", `Таблица «${name}» не открывается. Сохраните её в Excel как .xlsx и загрузите снова.`); }
  const sheet = book.worksheets.find((w) => key(w.name) === SHEET) ?? book.worksheets[0];
  if (!sheet) throw new ApiError("VALIDATION", `В таблице «${name}» нет листов.`);
  const { rows, problems } = parseCueSheet(sheet);
  const stored = await readStored(projectId);
  await writeStored(projectId, { mode: stored.mode, folder: music.folder, table: { name, at: new Date().toISOString(), rows, problems } });
  return cueState(projectId);
}

/** Ошибки музыки по таблице перед сборкой. Пусто, если режим «Подряд». */
export async function cueBlockers(projectId: string, duration: number | null): Promise<string[]> {
  const { mode, table, music } = await current(projectId);
  if (mode !== "cue") return [];
  if (!table) return ["Музыка «По таблице», но таблица не загружена. Нажмите «Загрузить таблицу» в блоке «Музыка»."];
  return [...table.problems, ...cueErrors(table.rows, music.tracks, duration)].map((p) => p.message);
}

/** Раскладка для сборки, если режим «По таблице». Копии треков должны быть на месте. */
export async function usedCue(projectId: string, duration: number): Promise<CueMix | null> {
  const blockers = await cueBlockers(projectId, duration);
  if (blockers.length) throw new ApiError("VALIDATION", `Музыка по таблице: ${blockers.join(" ")}`);
  const { mode, table, music } = await current(projectId);
  if (mode !== "cue" || !table) return null;
  const named = new Set(table.rows.map((r) => key(r.file)));
  const tracks = await Promise.all(music.tracks.filter((t) => named.has(key(t.name))).map(async (t: MusicTrack) => {
    const full = projectFile(projectId, t.file);
    if (!await fs.stat(full).then((s) => s.isFile(), () => false)) throw new ApiError("VALIDATION", `Не найдена копия трека «${t.name}». Выберите папку с музыкой заново.`);
    return { name: t.name, seconds: t.seconds, lufs: t.lufs, path: full };
  }));
  return cueLayout(table.rows, tracks, duration, MUSIC_PAUSE_LEVEL);
}
