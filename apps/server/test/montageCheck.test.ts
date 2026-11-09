// Выпуск 3, шаг 2: проверка файлов перед сборкой. Файлы подменяются, FFmpeg и внешние сервисы не нужны.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_SOURCE_SIDE, assessMontage, ffprobeFor, parseProbe, type Inspected, type MontageInput } from "../src/services/studio/montageCheck.js";

const HD = { seconds: 8, width: 1920, height: 1080, video: true, audio: false };
const VOICE = { seconds: 12, width: null, height: null, video: false, audio: true };
const row = (n: number, media: { picture?: object; clip?: object } = {}) => ({
  n, start: (n - 1) * 4, end: n * 4,
  picture: { file: `visual/${n}.jpg` }, clip: { file: `visual/${n}.mp4` }, ...media,
});
const board = (over: Partial<NonNullable<MontageInput["board"]>> = {}): NonNullable<MontageInput["board"]> => ({ timing: "audio", stale: false, audioFile: "voice.mp3", rows: [row(1), row(2), row(3)], ...over });
const inspector = (over: Record<string, Inspected> = {}) => async (f: string): Promise<Inspected> => over[f] ?? (f === "voice.mp3" ? VOICE : HD);
const run = (b: MontageInput["board"], over?: Record<string, Inspected>, facts: MontageInput["facts"] = "passed") => assessMontage({ board: b, facts }, inspector(over));
const codes = (l: { code: string }[]) => l.map((x) => x.code);

test("всё на месте: сборка разрешена, замечаний нет", async () => {
  const r = await run(board());
  assert.equal(r.ready, true);
  assert.deepEqual(r.blockers, []);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.summary, { scenes: 3, clips: 3, pictures: 3, files: 7, audioSeconds: 12 });
});

test("нет раскадровки: блокировка", async () => {
  const r = await run(null);
  assert.equal(r.ready, false);
  assert.deepEqual(codes(r.blockers), ["no-board"]);
});

test("примерные тайминги и устаревшая раскадровка блокируют сборку", async () => {
  assert.deepEqual(codes((await run(board({ timing: "estimate" }))).blockers), ["estimated-timing"]);
  assert.deepEqual(codes((await run(board({ stale: true }))).blockers), ["stale-board"]);
});

test("озвучка: не указана, нет файла, не открывается, нет звуковой дорожки", async () => {
  assert.deepEqual(codes((await run(board({ audioFile: undefined }))).blockers), ["no-audio"]);
  assert.deepEqual(codes((await run(board(), { "voice.mp3": "missing" })).blockers), ["no-audio"]);
  assert.deepEqual(codes((await run(board(), { "voice.mp3": "broken" })).blockers), ["broken-audio"]);
  assert.deepEqual(codes((await run(board(), { "voice.mp3": { ...VOICE, audio: false } })).blockers), ["broken-audio"]);
});

test("сцена без клипа и картинки блокирует и называется по номеру", async () => {
  const r = await run(board({ rows: [row(1), row(2, { picture: {}, clip: {} }), row(3)] }));
  assert.equal(r.ready, false);
  assert.deepEqual(r.blockers, [{ code: "no-media", message: "У этих сцен нет ни клипа, ни картинки.", scenes: [2] }]);
});

test("файла нет на диске или он повреждён: блокировка с номером сцены", async () => {
  const missing = await run(board(), { "visual/2.mp4": "missing" });
  assert.deepEqual(missing.blockers.map((x) => [x.code, x.scenes]), [["missing-file", [2]]]);
  const broken = await run(board(), { "visual/3.jpg": "broken" });
  assert.deepEqual(broken.blockers.map((x) => [x.code, x.scenes]), [["broken-file", [3]]]);
});

test("клип без длины или без видеодорожки считается повреждённым", async () => {
  assert.deepEqual(codes((await run(board(), { "visual/1.mp4": { ...HD, seconds: null } })).blockers), ["broken-file"]);
  assert.deepEqual(codes((await run(board(), { "visual/1.mp4": { ...HD, video: false } })).blockers), ["broken-file"]);
});

test("пометка «переделать» на картинке или клипе блокирует", async () => {
  const r = await run(board({ rows: [row(1, { clip: { file: "visual/1.mp4", verdict: "redo" } }), row(2, { picture: { file: "visual/2.jpg", verdict: "redo" } }), row(3)] }));
  assert.deepEqual(r.blockers.map((x) => [x.code, x.scenes]), [["redo", [1, 2]]]);
});

test("картинка без клипа не блокирует, а предупреждает", async () => {
  const r = await run(board({ rows: [row(1), row(2, { clip: {} }), row(3)] }));
  assert.equal(r.ready, true);
  assert.deepEqual(r.warnings.map((x) => [x.code, x.scenes]), [["no-clip", [2]]]);
});

test("планка исходников 720p: ровно 720 проходит молча, ниже — предупреждение", async () => {
  assert.equal(MIN_SOURCE_SIDE, 720);
  const at720 = await run(board(), { "visual/1.mp4": { ...HD, width: 1280, height: 720 } });
  assert.deepEqual(at720.warnings, []);
  const low = await run(board(), { "visual/1.mp4": { ...HD, width: 854, height: 480 } });
  assert.equal(low.ready, true, "низкое разрешение сборку не останавливает");
  assert.deepEqual(low.warnings.map((x) => [x.code, x.scenes]), [["low-res", [1]]]);
});

test("вертикальный исходник меряется по короткой стороне", async () => {
  assert.deepEqual((await run(board(), { "visual/1.mp4": { ...HD, width: 720, height: 1280 } })).warnings, []);
  assert.deepEqual(codes((await run(board(), { "visual/1.mp4": { ...HD, width: 480, height: 854 } })).warnings), ["low-res"]);
});

test("маленькая картинка под готовым клипом в кадр не идёт и не предупреждает", async () => {
  const r = await run(board(), { "visual/1.jpg": { ...HD, width: 640, height: 360 } });
  assert.deepEqual(r.warnings, []);
});

test("маленькая картинка без клипа предупреждает и о размере", async () => {
  const r = await run(board({ rows: [row(1, { clip: {} }), row(2), row(3)] }), { "visual/1.jpg": { ...HD, width: 640, height: 360 } });
  assert.deepEqual(codes(r.warnings), ["low-res", "no-clip"]);
});

test("статус фактов только предупреждает", async () => {
  for (const facts of ["none", "stale", "issues"] as const) {
    const r = await run(board(), undefined, facts);
    assert.equal(r.ready, true);
    assert.deepEqual(codes(r.warnings), ["facts"]);
  }
});

test("разрыв между сценами и сцены длиннее озвучки ловит раскладка шага 1", async () => {
  const gap = await run(board({ rows: [row(1), { ...row(2), start: 6, end: 8 }] }));
  assert.deepEqual(codes(gap.blockers), ["timeline"]);
  const long = await run(board(), { "voice.mp3": { ...VOICE, seconds: 5 } });
  assert.deepEqual(codes(long.blockers), ["timeline"]);
});

test("один и тот же файл проверяется один раз", async () => {
  const asked: string[] = [];
  await assessMontage({ board: board({ rows: [row(1, { picture: { file: "same.jpg" }, clip: {} }), row(2, { picture: { file: "same.jpg" }, clip: {} }), row(3)] }), facts: "passed" }, async (f) => { asked.push(f); return f === "voice.mp3" ? VOICE : HD; });
  assert.equal(asked.filter((f) => f === "same.jpg").length, 1);
});

test("ошибка запуска ffprobe не выдаётся за повреждённые файлы", async () => {
  await assert.rejects(assessMontage({ board: board(), facts: "passed" }, async () => { throw new Error("нет ffprobe"); }), /нет ffprobe/);
});

test("разбор ответа ffprobe", () => {
  assert.deepEqual(parseProbe(JSON.stringify({ format: { duration: "8.0" }, streams: [{ codec_type: "video", width: 1920, height: 1080, duration: "7.96" }, { codec_type: "audio", duration: "8.0" }] })), { seconds: 7.96, width: 1920, height: 1080, video: true, audio: true });
  assert.deepEqual(parseProbe(JSON.stringify({ format: { duration: "1002.2" }, streams: [{ codec_type: "audio" }] })), { seconds: 1002.2, width: null, height: null, video: false, audio: true });
  assert.deepEqual(parseProbe(JSON.stringify({ format: {}, streams: [{ codec_type: "video", width: 1280, height: 720, duration: "N/A" }] })), { seconds: null, width: 1280, height: 720, video: true, audio: false });
  assert.equal(parseProbe("не json"), null);
});

test("путь к ffprobe получается из пути к ffmpeg, папка не портится", () => {
  assert.equal(ffprobeFor("C:\\ffmpeg\\bin\\ffmpeg.exe"), "C:\\ffmpeg\\bin\\ffprobe.exe");
  assert.equal(ffprobeFor("ffmpeg"), "ffprobe");
});
