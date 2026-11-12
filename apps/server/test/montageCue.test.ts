// Выпуск 3.14: «Музыка по таблице». Разбор .xlsx, ошибки строк и схема сведения — без FFmpeg; настоящее сведение — на тестовых тонах, если FFmpeg есть.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ffmpegPath } from "../src/services/audioFx.js";
import { projectFile } from "../src/services/studio/montageCheck.js";
import { CUE_DECLICK_SEC, CUE_FADE_SEC, cueBlockers, cueErrors, cueLayout, cueState, cueTime, loadCueTable, parseCueSheet, saveMusicMode, type CueRow } from "../src/services/studio/montageCue.js";
import { LUFS_TOLERANCE, MAX_PEAK, MUSIC_PAUSE_LEVEL, TARGET_LUFS, buildSound, cueFilter, pieceArgs } from "../src/services/studio/montageSound.js";
import { createProject } from "../src/services/projects.js";

type Sheet = { addRow(v: unknown[]): { getCell(n: number): { numFmt: string } } };
type Book = { addWorksheet(name: string): Sheet; xlsx: { writeBuffer(): Promise<ArrayBuffer>; load(b: Buffer): Promise<unknown> }; worksheets: Parameters<typeof parseCueSheet>[0][] & { name: string }[] };
const ExcelJS = createRequire(import.meta.url)("exceljs") as { Workbook: new () => Book };

const HEAD = ["№", "Начало", "Конец", "Длительность", "Сцены", "Слой", "Роль", "Файл", "Вход в треке", "Выход из трека", "Заметка"];
/** Время так, как его хранит Excel: дата 30.12.1899 плюс время, формат m:ss. */
const t = (m: number, s: number) => new Date(Date.UTC(1899, 11, 30, 0, m, s));
type Line = [number, Date, Date, string, string, string, Date, Date, string, ...unknown[]];
/** Таблица в форме таблицы владельца: «Длительность» — формула, второй лист с заметками. */
async function book(lines: Line[], head = HEAD, extra: string[] = []) {
  const b = new ExcelJS.Workbook(), s = b.addWorksheet("Cue-sheet");
  s.addRow([...head, ...extra]);
  lines.forEach(([n, start, end, layer, role, file, from, to, note, ...rest], i) => {
    const row = s.addRow([n, start, end, { formula: `C${i + 2}-B${i + 2}`, result: new Date(end.getTime() - start.getTime() + Date.UTC(1899, 11, 30)) }, "1–2", layer, role, file, from, to, note, ...rest]);
    for (const c of [2, 3, 4, 9, 10]) row.getCell(c).numFmt = "m:ss";
  });
  b.addWorksheet("Запас и заметки").addRow(["Не читать", "ничего"]);
  return Buffer.from(await b.xlsx.writeBuffer());
}
async function sheetOf(buf: Buffer) {
  const b = new ExcelJS.Workbook();
  await b.xlsx.load(buf);
  return b.worksheets.find((w) => w.name === "Cue-sheet")!;
}

// Первые строки таблицы ролика про Наполеона: слои, повтор файла, перекрытие «Основы».
const NAPOLEON: Line[] = [
  [1, t(0, 0), t(1, 27), "Основа", "Frost Drone", "Bleak Winter Landscape.wav", t(0, 0), t(1, 27), "Дрон; кроссфейд в March на 1:20–1:30"],
  [2, t(0, 12), t(0, 40), "Поверх", "Fire Solo", "Fragile Hearth.wav", t(0, 0), t(0, 28), "Fade за 2 с до 0:40"],
  [3, t(1, 14), t(2, 27), "Основа", "March Pulse", "March in the Snow.wav", t(0, 0), t(1, 13), ""],
  [4, t(2, 27), t(3, 34), "Основа", "Fire Solo", "Fragile Hearth.wav", t(0, 0), t(1, 7), ""],
];
const TRACKS = [
  { name: "Bleak Winter Landscape.wav", seconds: 180, lufs: -20, path: "a.wav" },
  { name: "Fragile Hearth.wav", seconds: 170, lufs: -24, path: "b.wav" },
  { name: "March in the Snow.wav", seconds: 167, lufs: -18, path: "c.wav" },
];

test("время из ячейки: время Excel, число секунд и текст", () => {
  assert.equal(cueTime({ value: t(1, 27) }), 87);
  assert.equal(cueTime({ value: 87 / 86_400, numFmt: "m:ss" }), 87);
  assert.equal(cueTime({ value: 87 }), 87);
  assert.equal(cueTime({ value: "1:27" }), 87);
  assert.equal(cueTime({ value: "0:01:27" }), 87);
  assert.equal(cueTime({ value: "87,5" }), 87.5);
  assert.equal(cueTime({ value: { formula: "C2-B2", result: t(0, 28) } }), 28);
  assert.equal(cueTime({ value: "полторы минуты" }), null);
  assert.equal(cueTime({ value: null }), null);
});

test("таблица в настоящей форме: время-ячейки, слои, повтор файла, заметки только для показа", async () => {
  const { rows, problems } = parseCueSheet(await sheetOf(await book(NAPOLEON)));
  assert.deepEqual(problems, []);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { row: 2, n: "1", start: 0, end: 87, layer: "base", file: "Bleak Winter Landscape.wav", from: 0, to: 87, gainDb: 0, ending: "fade", note: "Дрон; кроссфейд в March на 1:20–1:30" });
  assert.equal(rows[1].layer, "over");
  assert.deepEqual(rows.filter((r) => r.file === "Fragile Hearth.wav").map((r) => r.row), [3, 5], "один файл стоит дважды");
  assert.deepEqual(cueErrors(rows, TRACKS, 16 * 60 + 12), []);
});

test("необязательные столбцы «Громкость, дБ» и «Окончание»", async () => {
  const lines: Line[] = [
    [1, t(0, 0), t(0, 30), "Основа", "", "Bleak Winter Landscape.wav", t(0, 0), t(0, 30), "", "−3,5", "обрыв"],
    [2, t(0, 30), t(1, 0), "основа", "", "march in the snow.wav", t(0, 0), t(0, 30), "", "", ""],
    [3, t(1, 0), t(1, 10), "Поверх", "", "Fragile Hearth.wav", t(0, 0), t(0, 10), "", "+2", "Плавно"],
  ];
  const { rows, problems } = parseCueSheet(await sheetOf(await book(lines, HEAD, ["Громкость, дБ", "Окончание"])));
  assert.deepEqual(problems, []);
  assert.deepEqual(rows.map((r) => [r.gainDb, r.ending]), [[-3.5, "cut"], [0, "fade"], [2, "fade"]]);
  assert.deepEqual(cueErrors(rows, TRACKS, 100), [], "имя файла и слой без учёта регистра");
});

test("ошибки разбора называют строку", async () => {
  const lines: Line[] = [
    [1, t(0, 0), t(0, 30), "Сверху", "", "a.wav", t(0, 0), t(0, 30), "", "громко", "резко"],
    [2, t(0, 30), t(1, 0), "Основа", "", "", t(0, 0), t(0, 30), ""],
  ];
  const { rows, problems } = parseCueSheet(await sheetOf(await book(lines, HEAD, ["Громкость, дБ", "Окончание"])));
  assert.equal(rows.length, 0);
  assert.equal(problems.length, 2);
  assert.match(problems[0].message, /^Строка 2 \(№ 1\): «Слой» — нужно «Основа» или «Поверх»; «Громкость, дБ» — нужно число .*; «Окончание» — нужно «плавно» или «обрыв»\.$/);
  assert.match(problems[1].message, /^Строка 3 \(№ 2\): не указан «Файл»\.$/);
  const none = parseCueSheet(await sheetOf(await book([], ["№", "Начало", "Слой"])));
  assert.match(none.problems[0].message, /нет столбцов: «Конец», «Файл», «Вход в треке», «Выход из трека»/);
});

const row = (r: Partial<CueRow> & { row: number }): CueRow => ({ n: String(r.row - 1), start: 0, end: 10, layer: "base", file: "Bleak Winter Landscape.wav", from: 0, to: 10, gainDb: 0, ending: "fade", note: "", ...r });

test("проверка строк до сборки", () => {
  const errors = cueErrors([
    row({ row: 2, file: "Нет такого.wav" }),
    row({ row: 3, start: 20, end: 20, from: 0, to: 0 }),
    row({ row: 4, start: 30, end: 40, from: 175, to: 185 }),
    row({ row: 5, start: 50, end: 60, from: 0, to: 12 }),
    row({ row: 6, start: 95, end: 105, from: 0, to: 10 }),
    row({ row: 7, start: 70, end: 80, from: 0, to: 10.4 }),
  ], TRACKS, 100);
  const by = (n: number) => errors.filter((e) => e.row === n).map((e) => e.message);
  assert.match(by(2)[0], /^Строка 2 \(№ 1\): файла «Нет такого\.wav» нет среди треков/);
  assert.ok(by(3).some((m) => /начало 0:20 не раньше конца 0:20/.test(m)));
  assert.ok(by(3).some((m) => /вход в треке 0:00 не раньше выхода/.test(m)));
  assert.ok(by(4).some((m) => /выход из трека 3:05 дальше конца трека \(3:00\)/.test(m)));
  assert.ok(by(5).some((m) => /кусок трека 0:12 не равен месту в ролике 0:10/.test(m)));
  assert.ok(by(6).some((m) => /конец 1:45 позже конца ролика \(1:40\)/.test(m)));
  assert.deepEqual(by(7), [], "расхождение до 0,5 с допустимо");
  assert.ok(!cueErrors([row({ row: 2, start: 95, end: 105, to: 10 })], TRACKS, null).length, "длина ролика ещё неизвестна");
});

test("«Основа»: перекрытие краями — переход, строка внутри другой или тройное перекрытие — ошибка", () => {
  assert.deepEqual(cueErrors([row({ row: 2, start: 0, end: 87, to: 87 }), row({ row: 3, start: 74, end: 147, to: 73 })], TRACKS, 200), []);
  const inside = cueErrors([row({ row: 2, start: 0, end: 60, to: 60 }), row({ row: 3, start: 10, end: 20 })], TRACKS, 200);
  assert.match(inside[0].message, /^Строка 3 \(№ 2\): в слое «Основа» лежит внутри строки 2/);
  const triple = cueErrors([row({ row: 2, start: 0, end: 30, to: 30 }), row({ row: 3, start: 20, end: 40, to: 20 }), row({ row: 4, start: 25, end: 50, to: 25 })], TRACKS, 200);
  assert.match(triple[0].message, /^Строка 4 \(№ 3\): в слое «Основа» перекрывает сразу строки 2 и 3/);
  assert.deepEqual(cueErrors([row({ row: 2, start: 0, end: 60, to: 60 }), row({ row: 3, start: 10, end: 20, layer: "over" })], TRACKS, 200), [], "«Поверх» может лежать где угодно");
});

test("раскладка: переход на всё перекрытие, «плавно» и «обрыв», громкость трека и столбца", () => {
  const rows = [
    row({ row: 2, start: 0, end: 87, to: 87 }),
    row({ row: 3, start: 12, end: 40, to: 28, layer: "over", file: "Fragile Hearth.wav", gainDb: -3 }),
    row({ row: 4, start: 74, end: 147, to: 73, file: "March in the Snow.wav" }),
    row({ row: 5, start: 150, end: 160, from: 30, to: 40, ending: "cut" }),
  ];
  const mix = cueLayout(rows, TRACKS, 155, MUSIC_PAUSE_LEVEL);
  assert.deepEqual([mix.files, mix.rows], [3, 4], "один файл стоит дважды");
  const [a, over, march, again] = mix.pieces;
  assert.deepEqual([a.fadeIn, a.fadeOut], [CUE_DECLICK_SEC, 13]);
  assert.deepEqual([march.fadeIn, march.fadeOut, march.at, march.length], [13, CUE_FADE_SEC, 74, 73]);
  assert.deepEqual([over.fadeIn, over.fadeOut, over.level], [CUE_DECLICK_SEC, CUE_FADE_SEC, MUSIC_PAUSE_LEVEL + 24 - 3]);
  assert.deepEqual([again.file, again.from, again.length, again.fadeOut], ["a.wav", 30, 5, CUE_DECLICK_SEC], "обрезано концом ролика, «обрыв»");
});

test("схема сведения по таблице", () => {
  const mix = cueLayout([
    row({ row: 2, start: 0, end: 10, to: 10 }),
    row({ row: 3, start: 8, end: 20, from: 5, to: 17, file: "March in the Snow.wav" }),
    row({ row: 4, start: 30, end: 40, from: 60, to: 70 }),
  ], TRACKS, 45, MUSIC_PAUSE_LEVEL);
  const args = mix.pieces.map(pieceArgs);
  assert.deepEqual(args.map((x) => x.slice(0, 6)), [["-ss", "0.000", "-t", "10.000", "-i", "a.wav"], ["-ss", "5.000", "-t", "12.000", "-i", "c.wav"], ["-ss", "60.000", "-t", "10.000", "-i", "a.wav"]], "каждый кусок читается отдельно, один файл может стоять дважды");
  assert.match(args[0][7], /^aresample=48000[^;]*,volume=-5\.00dB,afade=t=in:d=0\.020,afade=t=out:st=8\.000:d=2\.000$/);
  assert.match(args[1][7], /volume=-7\.00dB,afade=t=in:d=2\.000,afade=t=out:st=10\.000:d=2\.000$/);
  assert.deepEqual(args[0].slice(-9), ["-c:a", "pcm_f32le", "-ar", "48000", "-ac", "2", "-f", "f32le", "pipe:1"]);
  assert.deepEqual(mix.pieces.map((x) => x.at), [0, 8, 30]);
  const f = cueFilter(-16, mix);
  assert.match(f, /^\[1:a\]aresample=48000[^;]*\[music\];\[0:a\][^;]*volume=0\.00dB,asplit=2\[v\]\[key\]/, "музыка — одна готовая дорожка");
  assert.match(f, /\[music\]\[key\]sidechaincompress=/);
  assert.match(f, /amix=inputs=2:normalize=0:duration=first:dropout_transition=0\[mix\]$/);
  assert.doesNotMatch(f, /acrossfade|adelay|afade/, "нет общих переходов режима «Подряд», куски уже на местах");
  assert.match(cueFilter(-16, cueLayout([], TRACKS, 45, MUSIC_PAUSE_LEVEL)), /^\[0:a\].*volume=0\.00dB\[mix\]$/, "без кусков — только голос");
});

test("состояние проекта: режим, загрузка из папки, ошибки с длиной ролика, сброс при другой папке", async () => {
  const p = await createProject({ title: "Музыка по таблице" });
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "montage-cue-"));
  try {
    const writeMusic = (f: string) => fs.mkdir(path.dirname(projectFile(p.id, "montage/music.json")), { recursive: true }).then(() => fs.writeFile(projectFile(p.id, "montage/music.json"), JSON.stringify({ folder: f, tracks: TRACKS.map((x, i) => ({ name: x.name, file: `montage/music/0${i + 1}.wav`, seconds: x.seconds, lufs: x.lufs, use: true })) })));
    await writeMusic(folder);
    assert.deepEqual(await cueBlockers(p.id, 300), [], "режим «Подряд» ничего не проверяет");
    assert.equal((await saveMusicMode(p.id, { mode: "cue" })).mode, "cue");
    assert.match((await cueBlockers(p.id, 300))[0], /таблица не загружена/);
    await assert.rejects(loadCueTable(p.id), /нет таблицы \.xlsx/);
    await fs.writeFile(path.join(folder, "music_cue_sheet.xlsx"), await book(NAPOLEON));
    await fs.writeFile(path.join(folder, "~$music_cue_sheet.xlsx"), "временный файл Excel");
    await fs.writeFile(path.join(folder, "other.xlsx"), await book([]));
    const loaded = await loadCueTable(p.id);
    assert.equal(loaded.table?.name, "music_cue_sheet.xlsx");
    assert.equal(loaded.table?.rows.length, 4);
    assert.deepEqual(loaded.errors, []);
    assert.deepEqual(await cueBlockers(p.id, 300), []);
    assert.match((await cueBlockers(p.id, 200))[0], /^Строка 5 \(№ 4\): конец 3:34 позже конца ролика \(3:20\)/);
    await writeMusic(path.join(folder, "другая"));
    assert.equal((await cueState(p.id)).table, null, "таблица относится к прежней папке");
    assert.equal((await saveMusicMode(p.id, { mode: "sequence" })).mode, "sequence");
    assert.deepEqual(await cueBlockers(p.id, 300), []);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

test("настоящее сведение по таблице: куски на своих местах, тишина без строк, −14 LUFS", { skip: !ffmpegPath() }, async () => {
  const bin = ffmpegPath()!;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "montage-cue-sound-"));
  try {
    const file = (n: string) => path.join(root, n);
    const make = (...a: string[]) => assert.equal(spawnSync(bin, ["-hide_banner", "-loglevel", "error", "-y", ...a]).status, 0);
    make("-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=16", "-af", "volume='if(between(t,3,13),0,1)':eval=frame", "-c:a", "libmp3lame", file("voice.mp3"));
    make("-f", "lavfi", "-i", "sine=frequency=200:sample_rate=44100:duration=30", file("low.wav"));
    make("-f", "lavfi", "-i", "sine=frequency=600:sample_rate=44100:duration=30", file("high.wav"));
    const tracks = [{ name: "low.wav", seconds: 30, lufs: -21, path: file("low.wav") }, { name: "high.wav", seconds: 30, lufs: -21, path: file("high.wav") }];
    const rows = [
      row({ row: 2, start: 0, end: 6, from: 10, to: 16, file: "low.wav" }),
      row({ row: 3, start: 5, end: 10, from: 0, to: 5, file: "high.wav", ending: "cut" }),
      row({ row: 4, start: 7, end: 9, from: 0, to: 2, file: "low.wav", layer: "over" }),
    ];
    assert.deepEqual(cueErrors(rows, tracks, 16), []);
    const out = file("out.m4a");
    const r = await buildSound({ ffmpeg: bin, voice: file("voice.mp3"), tracks: [], cue: cueLayout(rows, tracks, 16, MUSIC_PAUSE_LEVEL), duration: 16, output: out });
    assert.ok(Math.abs(r.lufs - TARGET_LUFS) <= LUFS_TOLERANCE, `громкость ${r.lufs}`);
    assert.ok(r.peak <= MAX_PEAK, `пик ${r.peak}`);
    const level = (hz: number, from: number, length: number) => {
      const log = spawnSync(bin, ["-hide_banner", "-ss", String(from), "-t", String(length), "-i", out, "-af", `bandpass=f=${hz}:width_type=h:w=30,volumedetect`, "-f", "null", "-"], { encoding: "utf8" }).stderr;
      return Number(/mean_volume: (-?[\d.]+)/.exec(log)?.[1]);
    };
    // 3–5 с: только низкий тон; 7,2–8,8: высокий и «Поверх» низкий; 10,5–12,5: строк нет — тишина.
    assert.ok(level(200, 3.5, 1) - level(600, 3.5, 1) > 20, "до перехода звучит только первый кусок");
    assert.ok(level(600, 7.2, 1.5) > -60 && level(200, 7.2, 1.5) > -60, "«Поверх» звучит вместе с основой");
    assert.ok(level(200, 10.5, 2) < -70 && level(600, 10.5, 2) < -70, `без строк тишина: ${level(200, 10.5, 2)} / ${level(600, 10.5, 2)}`);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
