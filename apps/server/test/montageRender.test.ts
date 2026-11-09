// Выпуск 3, шаг 3: сборка видеоряда. Расчёт кадров и команды — без FFmpeg; короткая настоящая сборка — если FFmpeg есть.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ffmpegPath } from "../src/services/audioFx.js";
import { buildMontagePlan, type MontagePlan, type MontageSegment } from "../src/services/studio/montagePlan.js";
import { FPS, IMAGE_ZOOM, frameArgs, frameAt, partArgs, partsOf, renderVideo } from "../src/services/studio/montageRender.js";

const plan = (segments: MontageSegment[], duration: number): MontagePlan => ({ duration, segments, problems: [], ready: true });
const clip = (scene: number, start: number, end: number): MontageSegment => ({ scene, start, end, seconds: end - start, kind: "clip", file: `${scene}.mp4`, clipTo: end - start });
const value = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

test("кадры считаются от начала: сумма равна длине ролика без накопления ошибки", () => {
  const segments: MontageSegment[] = [];
  for (let i = 0; i < 500; i++) segments.push(clip(i + 1, i * 2.021, (i + 1) * 2.021));
  const total = 500 * 2.021;
  const parts = partsOf(plan(segments, total));
  assert.equal(parts.reduce((sum, p) => sum + p.frames, 0), frameAt(total));
  assert.notEqual(500 * Math.round(2.021 * FPS), frameAt(total), "по-кусочное округление дало бы расхождение");
});

test("кусок короче половины кадра не создаёт пустой файл", () => {
  const parts = partsOf(plan([clip(1, 0, 2), clip(2, 2, 2.001), clip(3, 2.001, 4)], 4));
  assert.deepEqual(parts.map((p) => p.segment.scene), [1, 3]);
});

test("сцена без материалов до кодирования не доходит", () => {
  assert.throws(() => partsOf(plan([{ scene: 7, start: 0, end: 1, seconds: 1, kind: "missing" }], 1)), /Сцена 7/);
});

test("клип: без своего звука, ровно нужное число кадров, 1920×1080, 24 кадра", () => {
  const args = partArgs({ scene: 1, start: 0, end: 5, seconds: 5, kind: "clip", file: "c.mp4", clipTo: 5 }, 120, "in.mp4", "out.mp4");
  assert.ok(args.includes("-an"), "звук клипа не используется");
  assert.equal(value(args, "-frames:v"), "120");
  const vf = value(args, "-vf");
  assert.match(vf, /^fps=24,/);
  assert.match(vf, /scale=1920:1080:force_original_aspect_ratio=increase/);
  assert.match(vf, /crop=1920:1080/);
  assert.match(vf, /tpad=stop=-1:stop_mode=clone/);
  assert.equal(args.at(-1), "out.mp4");
});

test("остаток фразы после клипа — статичный кадр без приближения", () => {
  const args = partArgs({ scene: 1, start: 5, end: 6, seconds: 1, kind: "still", source: "clip", file: "c.mp4", clipTime: 5 }, 24, "frame.png", "out.mp4");
  assert.equal(value(args, "-loop"), "1");
  assert.doesNotMatch(value(args, "-vf"), /zoompan/);
  assert.equal(value(args, "-frames:v"), "24");
});

test("картинка без анимации идёт с медленным приближением на всю длину куска", () => {
  const args = partArgs({ scene: 197, start: 0, end: 3, seconds: 3, kind: "still", source: "image", file: "p.jpg", clipTime: null }, 72, "p.jpg", "out.mp4");
  const vf = value(args, "-vf");
  assert.match(vf, /zoompan=/);
  assert.ok(vf.includes(`z='1+${IMAGE_ZOOM}*on/71'`));
  assert.match(vf, /:d=72:s=1920x1080:fps=24/);
  assert.equal(args.includes("-loop"), false);
});

test("кадр для остатка берётся с конца клипа даже при нулевом времени", () => {
  assert.equal(value(frameArgs("c.mp4", 7.833, "f.png"), "-t"), "7.833");
  assert.equal(Number(value(frameArgs("c.mp4", 0, "f.png"), "-t")), 1 / FPS);
  assert.ok(frameArgs("c.mp4", 1, "f.png").includes("-update"));
});

test("настоящая сборка: размер, длина, голос, повторная сборка берёт готовые куски", { skip: !ffmpegPath() }, async () => {
  const bin = ffmpegPath()!;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "montage-render-"));
  try {
    const run = (...a: string[]) => assert.equal(spawnSync(bin, ["-hide_banner", "-loglevel", "error", "-y", ...a]).status, 0);
    const file = (n: string) => path.join(root, n);
    run("-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=2", "-f", "lavfi", "-i", "sine=frequency=200:duration=2", "-c:v", "libx264", "-c:a", "aac", "-shortest", file("clip.mp4"));
    run("-f", "lavfi", "-i", "color=c=blue:size=1376x768", "-frames:v", "1", file("pic.png"));
    run("-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-c:a", "libmp3lame", file("voice.mp3"));
    const made = buildMontagePlan([
      { n: 1, start: 0, end: 3, image: null, clip: "clip.mp4", clipSeconds: 2 },
      { n: 2, start: 3, end: 5, image: "pic.png", clip: null, clipSeconds: null },
    ], 5);
    assert.deepEqual(made.segments.map((s) => s.kind), ["clip", "still", "still"]);
    const o = { plan: made, voice: file("voice.mp3"), resolve: file, dir: path.join(root, "out"), ffmpeg: bin };
    const first = await renderVideo(o);
    assert.equal(first.width, 1920);
    assert.equal(first.height, 1080);
    assert.ok(Math.abs(first.seconds - 5) < 0.05, `длина ${first.seconds}`);
    assert.equal(first.parts, 3);
    assert.equal(first.reused, 0);
    const second = await renderVideo(o);
    assert.equal(second.reused, 3, "готовые куски не кодируются заново");
    assert.equal((await fs.readdir(path.join(root, "out", "parts"))).filter((f) => f.includes(".tmp.")).length, 0, "временные файлы убраны");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
