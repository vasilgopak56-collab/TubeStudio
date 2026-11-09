// Выпуск 3, шаг 4: звук ролика. Схема и выбор треков — без FFmpeg; настоящее сведение — на тестовых звуках, если FFmpeg есть.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ffmpegPath } from "../src/services/audioFx.js";
import { CROSSFADE_SEC, LUFS_TOLERANCE, MAX_PEAK, TARGET_LUFS, buildSound, parseLoudnorm, playlist, soundFilter } from "../src/services/studio/montageSound.js";

const track = (seconds: number, lufs = -20) => ({ seconds, lufs });

test("треки идут подряд, а хватает их — лишние не берутся", () => {
  assert.equal(playlist([track(600), track(600), track(600)], 1002).length, 2);
});

test("треков мало: список повторяется по кругу с учётом переходов", () => {
  const a = track(100), b = track(50);
  const list = playlist([a, b], 300);
  assert.deepEqual(list, [a, b, a, b, a]);
  const length = list.reduce((s, t) => s + t.seconds, 0) - CROSSFADE_SEC * (list.length - 1);
  assert.ok(length >= 300);
});

test("ровно по длине и без треков", () => {
  assert.equal(playlist([track(100)], 100).length, 1);
  assert.deepEqual(playlist([], 100), []);
});

test("только голос: без музыки и приглушения", () => {
  const f = soundFilter(-11.9, [], 100);
  assert.match(f, /^\[0:a\].*volume=-4\.10dB\[mix\]$/);
  assert.doesNotMatch(f, /sidechain|amix/);
});

test("громкость каждого трека выравнивается, голос управляет приглушением", () => {
  const f = soundFilter(-16, [track(100, -10), track(100, -30)], 150);
  assert.match(f, /\[1:a\][^;]*volume=-15\.00dB\[t0\]/);
  assert.match(f, /\[2:a\][^;]*volume=5\.00dB\[t1\]/);
  assert.match(f, /\[t0\]\[t1\]acrossfade=d=2/);
  assert.match(f, /\[music\]\[key\]sidechaincompress=/);
  assert.match(f, /amix=inputs=2:normalize=0:duration=first/);
  assert.match(f, /afade=t=out:st=147\.000:d=3/);
});

test("отчёт loudnorm берётся из последнего JSON в сообщениях", () => {
  const log = `шум { "x": 1 }\n[Parsed_loudnorm_0 @ 0]\n{\n\t"input_i" : "-11.90",\n\t"input_tp" : "-0.60",\n\t"input_lra" : "2.30",\n\t"input_thresh" : "-22.00",\n\t"target_offset" : "0.10"\n}\n`;
  assert.equal(parseLoudnorm(log)?.input_i, "-11.90");
  assert.equal(parseLoudnorm(log)?.target_offset, "0.10");
  assert.equal(parseLoudnorm("ничего"), null);
});

test("настоящее сведение: −14 LUFS без перегруза, в паузе музыка громче, чем под голосом", { skip: !ffmpegPath() }, async () => {
  const bin = ffmpegPath()!;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "montage-sound-"));
  try {
    const file = (n: string) => path.join(root, n);
    const make = (...a: string[]) => assert.equal(spawnSync(bin, ["-hide_banner", "-loglevel", "error", "-y", ...a]).status, 0);
    // Голос: 8 секунд звучит, 6 секунд пауза, 8 секунд звучит.
    make("-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=22", "-af", "volume='if(between(t,8,14),0,1)':eval=frame", "-c:a", "libmp3lame", file("voice.mp3"));
    make("-f", "lavfi", "-i", "sine=frequency=200:sample_rate=44100:duration=30", "-c:a", "libmp3lame", file("music.mp3"));
    const out = file("out.m4a");
    const r = await buildSound({ ffmpeg: bin, voice: file("voice.mp3"), tracks: [{ seconds: 30, lufs: -21, path: file("music.mp3") }], duration: 22, output: out });
    assert.ok(Math.abs(r.lufs - TARGET_LUFS) <= LUFS_TOLERANCE, `громкость ${r.lufs}`);
    assert.ok(r.peak <= MAX_PEAK, `пик ${r.peak}`);
    const level = (from: number, length: number) => {
      const log = spawnSync(bin, ["-hide_banner", "-ss", String(from), "-t", String(length), "-i", out, "-af", "bandpass=f=200:width_type=h:w=30,volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr;
      return Number(/mean_volume: (-?[\d.]+)/.exec(log)?.[1]);
    };
    const under = level(3, 3), pause = level(10, 3);
    assert.ok(pause - under >= 5, `под голосом ${under} дБ, в паузе ${pause} дБ`);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("только голос тоже приводится к −14 LUFS", { skip: !ffmpegPath() }, async () => {
  const bin = ffmpegPath()!;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "montage-voice-"));
  try {
    const voice = path.join(root, "voice.mp3"), out = path.join(root, "out.m4a");
    assert.equal(spawnSync(bin, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=500:sample_rate=48000:duration=15", "-c:a", "libmp3lame", voice]).status, 0);
    const r = await buildSound({ ffmpeg: bin, voice, tracks: [], duration: 15, output: out });
    assert.ok(Math.abs(r.lufs - TARGET_LUFS) <= LUFS_TOLERANCE, `громкость ${r.lufs}`);
    assert.ok(r.peak <= MAX_PEAK, `пик ${r.peak}`);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
