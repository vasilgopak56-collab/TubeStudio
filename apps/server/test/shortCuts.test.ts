// Выпуск 4: Shorts из принятого монтажа. Сети и платных сервисов нет, данные во временной папке, сборка настоящим FFmpeg, если он есть.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "short-cuts-"));
process.env.DATA_DIR = dir; process.env.ENV_FILE = `${dir}/missing`;
const { ffmpegPath } = await import("../src/services/audioFx.js");
const { createChannel } = await import("../src/services/studio/channels.js");
const { ffprobeFor, probe } = await import("../src/services/studio/montageCheck.js");
const { toAss } = await import("../src/services/studio/montageSubtitles.js");
const S = await import("../src/services/studio/shortCuts.js");

const id = "11111111-2222-4333-8444-555555555555", old = "2026-01-01T00:00:00.000Z";
const row = (n: number, start: number, end: number, paragraph: number, text = `Sentence ${n}.`) => ({ n, start, end, paragraph, text });
const ctx = { progress: () => {}, partial: () => {}, signal: new AbortController().signal } as never;
const bin = ffmpegPath();
const rows = Array.from({ length: 8 }, (_, i) => ({ ...row(i + 1, i * 5, (i + 1) * 5, Math.floor(i / 4) + 1), shot: "", concept: "", motion: "", image: "", video: "", animate: false, cast: [], seconds: 5, words: 5, picture: { state: "none", attempts: 0 }, clip: { state: "none", attempts: 0 } }));
const srt = rows.map((r, i) => `${i + 1}\n00:00:${String(r.start).padStart(2, "0")},000 --> 00:00:${String(r.end).padStart(2, "0")},000\n${r.text}\n`).join("\n");
const m = () => path.join(dir, "files", id, "montage");
const draft = (file = "montage/a.mp4", at = new Date().toISOString()) => JSON.stringify({ file, at, seconds: 40, width: 1920, height: 1080, bytes: 10, parts: 1, reused: 0, lufs: -14, peak: -1, music: 0, subtitles: { files: { srt: "montage/draft.srt", vtt: "montage/draft.vtt" }, cues: 8, problem: null } });
let channelId = "", sample = "";

async function seed() {
  const board = { source: "studio-visual", schema: 1, channelId, projectId: id, textHash: "x", language: "en", timing: "audio", matched: 8, mode: "sentence", maxSec: 8, rows, createdAt: old, updatedAt: old, style: {}, input: {} };
  await fs.rm(path.join(dir, "files", id), { recursive: true, force: true });
  await fs.mkdir(path.join(dir, "projects"), { recursive: true });
  await fs.writeFile(path.join(dir, "projects", `${id}.json`), JSON.stringify({ id, title: "Frost story", channelId, createdAt: old, updatedAt: old, artifacts: [{ id: "a1", kind: "script", title: "s", createdAt: old, data: { script: "Words. ".repeat(40) } }, { id: "a2", kind: "storyboard", title: "b", createdAt: old, data: board }] }));
  await fs.mkdir(m(), { recursive: true });
  if (sample) await fs.copyFile(sample, path.join(m(), "a.mp4")); else await fs.writeFile(path.join(m(), "a.mp4"), "x");
  await fs.writeFile(path.join(m(), "draft.json"), draft());
  await fs.writeFile(path.join(m(), "draft.srt"), srt);
  await fs.writeFile(path.join(m(), "accepted.json"), JSON.stringify({ file: "montage/a.mp4", at: old }));
}

before(async () => {
  channelId = (await createChannel({ name: "Test", niche: "history", language: "en" })).id;
  if (bin) {
    sample = path.join(dir, "sample.mp4");
    assert.equal(spawnSync(bin, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=24:duration=40", "-f", "lavfi", "-i", "sine=frequency=300:sample_rate=48000:duration=40", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", sample]).status, 0);
  }
});
beforeEach(seed);
after(async () => { const { flushLogs } = await import("../src/lib/logging.js"); await flushLogs(); await fs.rm(dir, { recursive: true, force: true }); });

test("кусок начинается с абзаца, идёт до конца абзаца и укладывается в 20–55 секунд", () => {
  const list = S.proposeFragments([row(1, 0, 10, 1), row(2, 10, 25, 1), row(3, 25, 40, 2), row(4, 40, 62, 2)], 62);
  assert.deepEqual(list.map((f) => [f.id, f.start, f.end, f.seconds]), [["1-2", 0, 25, 25], ["3-4", 25, 62, 37]]);
  assert.equal(list[0].text, "Sentence 1. Sentence 2.");
});

test("длинный абзац обрезается на конце фразы, а не на середине", () => {
  const list = S.proposeFragments([row(1, 0, 20, 1), row(2, 20, 40, 1, "Half of a phrase and"), row(3, 40, 50, 1), row(4, 50, 70, 1)], 70);
  assert.equal(list[0].id, "1-3", "последняя законченная фраза в пределах 55 секунд");
  assert.equal(list.length, 1, "следующий кусок обязан начинаться с нового абзаца");
});

test("слишком короткие абзацы, сцена длиннее 55 секунд и выход за конец видео не предлагаются", () => {
  assert.deepEqual(S.proposeFragments([row(1, 0, 19, 1)], 19), []);
  assert.deepEqual(S.proposeFragments([row(1, 0, 56, 1)], 56), []);
  assert.deepEqual(S.proposeFragments([row(1, 0, 30, 1)], 20), [], "сцена заканчивается позже монтажа");
});

test("субтитры куска считаются от его начала, крошечные хвосты соседей не показываются", () => {
  const cues = [{ start: 8, end: 10.1, text: "a" }, { start: 10.1, end: 12, text: "b" }, { start: 29.95, end: 31, text: "c" }];
  assert.deepEqual(S.shortCues(cues, 10, 30), [{ start: 0.1, end: 2, text: "b" }]);
  assert.deepEqual(S.shortCues([{ start: 9, end: 11, text: "x" }], 10, 30), [{ start: 0, end: 1, text: "x" }], "длинный хвост обрезается по границе куска");
});

test("вертикальный кадр: размытая копия на всю высоту, весь кадр по центру, субтитры под ним", () => {
  const vf = S.shortVideoFilter("s.ass");
  assert.match(vf, /boxblur/);
  assert.match(vf, /scale=1080:1920/);
  assert.match(vf, /scale=1080:608/);
  assert.match(vf, /overlay=0:\(H-h\)\/2/);
  assert.match(vf, /ass=s\.ass/);
  assert.doesNotMatch(vf, /\[fg\][^;]*crop/, "сам кадр не обрезается");
});

test("обычные субтитры монтажа не изменились", () => {
  const a = toAss([{ start: 1, end: 2, text: "Line" }]);
  assert.match(a, /PlayResX: 1920/);
  assert.match(a, /Style: Default,Arial,56,.*,1,4,0,2,120,120,60,1/);
});

test("описание: своя строка, ссылка на полный ролик, #Shorts без повтора", () => {
  assert.equal(S.shortDescription("Text", "abcdefghijk", "en"), "Text\n\nFull video: https://youtu.be/abcdefghijk\n\n#Shorts");
  assert.equal(S.shortDescription("Текст", "abcdefghijk", "ru"), "Текст\n\nПолный ролик: https://youtu.be/abcdefghijk\n\n#Shorts");
  assert.equal(S.shortDescription("", null, "en"), "#Shorts");
  assert.equal(S.shortDescription("Done #shorts", null, "en"), "Done #shorts");
});

test("без принятого монтажа, без субтитров или после смены раскадровки резать нельзя", async () => {
  assert.deepEqual((await S.shortsState(id)).fragments.map((f) => f.id), ["1-4", "5-8"]);
  await fs.rm(path.join(m(), "accepted.json"));
  assert.match((await S.shortsState(id)).blocker!, /примите ролик/);
  await assert.rejects(S.buildShorts(id, { ids: ["1-4"] }, ctx), /примите ролик/);
  await seed();
  await fs.writeFile(path.join(m(), "draft.json"), JSON.stringify({ ...JSON.parse(draft()), subtitles: { files: null, cues: 0, problem: "нет" } }));
  assert.match((await S.shortsState(id)).blocker!, /нет субтитров/);
  await seed();
  await fs.writeFile(path.join(m(), "draft.json"), draft("montage/a.mp4", "2025-12-31T00:00:00.000Z"));
  const s = await S.shortsState(id);
  assert.match(s.blocker!, /Раскадровку меняли/);
  assert.deepEqual(s.fragments, []);
});

test("выбор проверяется: от 1 до 5, без повторов, только из текущего списка", async () => {
  assert.throws(() => S.buildShorts(id, { ids: [] }, ctx));
  assert.throws(() => S.buildShorts(id, { ids: ["1-1", "2-2", "3-3", "4-4", "5-5", "6-6"] }, ctx));
  assert.throws(() => S.buildShorts(id, { ids: ["1-4", "1-4"] }, ctx), /дважды/);
  await assert.rejects(S.buildShorts(id, { ids: ["99-100"] }, ctx), /изменился/);
});

test("настоящая сборка: 9:16, длина, громкость, размытый фон, принятие и сохранение только принятого", { skip: !bin }, async () => {
  await S.buildShorts(id, { ids: ["1-4"] }, ctx);
  let s = await S.shortsState(id);
  assert.equal(s.items.length, 1);
  const item = s.items[0], full = path.join(dir, "files", id, ...item.file.split("/"));
  const info = await probe(ffprobeFor(bin!), full);
  assert.equal(info?.width, 1080);
  assert.equal(info?.height, 1920);
  assert.ok(info?.audio);
  assert.ok(Math.abs(info!.seconds! - 20) < 0.1, `длина ${info?.seconds}`);
  assert.ok(Math.abs(item.lufs + 14) <= 0.5, `громкость ${item.lufs}`);
  assert.ok(item.peak <= -1, `пик ${item.peak}`);
  assert.equal(item.acceptedAt, null, "сам программа не принимает");
  assert.deepEqual((await fs.readdir(path.join(dir, "files", id, "shorts"))).filter((f) => /\.(ass|tmp)/.test(f)), [], "временных файлов не осталось");

  const frame = path.join(dir, "frame.png");
  assert.equal(spawnSync(bin!, ["-hide_banner", "-loglevel", "error", "-y", "-ss", "3", "-i", full, "-frames:v", "1", frame]).status, 0);
  const band = async (top: number) => {
    const { data, info: raw } = await sharp(frame).extract({ left: 0, top, width: 1080, height: 300 }).greyscale().raw().toBuffer({ resolveWithObject: true });
    let edges = 0, sum = 0;
    for (let i = 0; i < data.length; i++) { sum += data[i]; if ((i + 1) % raw.width) edges += Math.abs(data[i + 1] - data[i]); }
    return { mean: sum / data.length, edges: edges / data.length };
  };
  const [blur, picture] = await Promise.all([band(100), band(800)]);
  assert.ok(blur.mean > 20, "сверху размытая копия, а не чёрная полоса");
  assert.ok(blur.edges < picture.edges, `фон мягче самого кадра: ${blur.edges} и ${picture.edges}`);

  const out = path.join(dir, "out");
  await fs.mkdir(out, { recursive: true });
  await assert.rejects(S.exportShorts(id, out, ctx), /примите/, "без принятия не сохраняется");
  await assert.rejects(S.acceptShort(id, { id: item.id, file: "shorts/other.mp4" }), /изменился/);
  await S.acceptShort(id, { id: item.id, file: item.file });
  assert.throws(() => S.saveShortText(id, item.id, { title: "T", description: "", url: "https://example.com/x" }), /не похоже/);
  s = await S.saveShortText(id, item.id, { title: "Frost: part/one", description: "Story", url: "https://youtube.com/shorts/abcdefghijk" });
  assert.equal(s.items[0].videoId, "abcdefghijk");
  assert.equal(s.items[0].finalDescription, "Story\n\n#Shorts");
  await S.exportShorts(id, out, ctx);
  await S.exportShorts(id, out, ctx);
  assert.deepEqual((await fs.readdir(out)).sort(), ["Frost part one (2).mp4", "Frost part one.mp4"], "существующий файл не перезаписан");

  // Пересборка того же куска сбрасывает принятие, но сохраняет тексты.
  await S.buildShorts(id, { ids: ["1-4"] }, ctx);
  s = await S.shortsState(id);
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].acceptedAt, null);
  assert.equal(s.items[0].title, "Frost: part/one");
  assert.notEqual(s.items[0].file, item.file);
  assert.equal(await fs.stat(full).then(() => true, () => false), false, "прежний файл удалён");

  // После новой сборки монтажа прежние Shorts не показываются и не сохраняются.
  await fs.copyFile(path.join(m(), "a.mp4"), path.join(m(), "b.mp4"));
  await fs.writeFile(path.join(m(), "draft.json"), draft("montage/b.mp4"));
  await fs.writeFile(path.join(m(), "accepted.json"), JSON.stringify({ file: "montage/b.mp4", at: old }));
  s = await S.shortsState(id);
  assert.equal(s.items.length, 0);
  assert.equal(s.outdated, 1);
  await assert.rejects(S.exportShorts(id, out, ctx), /примите/);
});
