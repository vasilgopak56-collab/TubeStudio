// Выпуск 3, шаг 5: субтитры. Проверка и форматы — без FFmpeg; настоящее вшивание — короткий ролик, если FFmpeg есть.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ffmpegPath } from "../src/services/audioFx.js";
import { burnVideo } from "../src/services/studio/montageRender.js";
import { checkCues, requireAss, toAss, toVtt } from "../src/services/studio/montageSubtitles.js";

const cue = (start: number, end: number, text = "Текст") => ({ start, end, text });

test("хорошие субтитры проходят, стык встык не считается наложением", () => {
  assert.equal(checkCues([cue(0, 2), cue(2, 4)], 4), null);
  assert.equal(checkCues([cue(0, 2), cue(1.9995, 4)], 4), null, "округление таймингов");
});

test("пустые, с наложением и длиннее озвучки не проходят", () => {
  assert.match(checkCues([], 10)!, /нет ни одной/);
  assert.match(checkCues([cue(0, 2), cue(1, 3)], 10)!, /1 и 2 накладываются/);
  assert.match(checkCues([cue(0, 12)], 10)!, /позже озвучки/);
  assert.equal(checkCues([cue(0, 10.4)], 10), null, "небольшой запас по концу");
});

test("VTT для плеера: заголовок и точка в долях секунды", () => {
  assert.equal(toVtt([cue(1.5, 3661.25, "Привет")]), "WEBVTT\n\n00:00:01.500 --> 01:01:01.250\nПривет\n");
});

test("время не ломается при округлении сотых", () => {
  assert.match(toAss([cue(59.996, 60)]), /Dialogue: 0,0:01:00\.00,0:01:00\.00,/);
  assert.match(toVtt([cue(59.9996, 60)]), /00:01:00\.000 --> 00:01:00\.000/);
});

test("ASS: размер 1920×1080, белый Arial Bold с обводкой внизу кадра", () => {
  const a = toAss([cue(1, 2.5, "Line")]);
  assert.match(a, /PlayResX: 1920\nPlayResY: 1080/);
  assert.match(a, /Style: Default,Arial,56,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,/);
  assert.match(a, /Dialogue: 0,0:00:01\.00,0:00:02\.50,Default,,0,0,0,,Line\n/);
});

test("ASS: текст сценария не превращается в команды оформления", () => {
  const a = toAss([cue(0, 1, "a{\\b1}b\\c\nd")]);
  assert.match(a, /,,a\(\/b1\)b\/c\\Nd\n/);
});

test("вшивать можно только при готовом черновике с субтитрами", () => {
  assert.throws(() => requireAss(null), /Сначала соберите/);
  assert.throws(() => requireAss({}), /нет субтитров/);
  assert.throws(() => requireAss({ subtitles: { files: null, cues: 0, problem: "Нет файла." } }), /Нет файла/);
  assert.doesNotThrow(() => requireAss({ subtitles: { files: { srt: "a", vtt: "b" }, cues: 1, problem: null } }));
});

test("настоящее вшивание: текст виден только в своё время, длина и звук сохранены", { skip: !ffmpegPath() }, async () => {
  const bin = ffmpegPath()!;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "montage-burn-"));
  try {
    const input = path.join(dir, "in.mp4");
    assert.equal(spawnSync(bin, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:size=1920x1080:rate=24:duration=4", "-f", "lavfi", "-i", "sine=frequency=300:duration=4", "-c:v", "libx264", "-c:a", "aac", "-shortest", input]).status, 0);
    await fs.writeFile(path.join(dir, "subs.ass"), toAss([cue(1, 2, "Winter was long")]), "utf8");
    const times: number[] = [];
    const made = await burnVideo({ ffmpeg: bin, input, dir, ass: "subs.ass", name: "out.mp4", onTime: (t) => times.push(t) });
    assert.ok(Math.abs(made.seconds - 4) < 0.1, `длина ${made.seconds}`);
    assert.ok(times.length > 0, "ход работы приходит");
    const out = path.join(dir, "out.mp4");
    const brightest = (t: number) => {
      const log = spawnSync(bin, ["-hide_banner", "-ss", String(t), "-i", out, "-frames:v", "1", "-vf", "crop=1920:200:0:880,signalstats,metadata=print:key=lavfi.signalstats.YMAX", "-f", "null", "-"], { encoding: "utf8" }).stderr;
      return Number(/YMAX=(\d+)/.exec(log)?.[1]);
    };
    assert.ok(brightest(1.5) > 200, `в кадре с текстом яркость ${brightest(1.5)}`);
    assert.ok(brightest(3) < 40, `в кадре без текста яркость ${brightest(3)}`);
    const streams = spawnSync(bin.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace(/ffmpeg/i, "ffprobe")), ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", out], { encoding: "utf8" }).stdout;
    assert.match(streams, /audio/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
