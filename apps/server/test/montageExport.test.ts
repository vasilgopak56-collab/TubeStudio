// Выпуск 3, шаг 7: принятие и сохранение. Работает только с временной папкой теста.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acceptedFor, copyFiles, exportList, freeName, safeName } from "../src/services/studio/montageExport.js";

const temp = () => fs.mkdtemp(path.join(os.tmpdir(), "montage-export-"));

test("принятие действует только для того файла, который посмотрели", () => {
  const stored = { file: "montage/a.mp4", at: "t" };
  assert.deepEqual(acceptedFor(stored, "montage/a.mp4"), stored);
  assert.equal(acceptedFor(stored, "montage/b.mp4"), null, "после новой сборки принятие снято");
  assert.equal(acceptedFor(null, "montage/a.mp4"), null);
  assert.equal(acceptedFor(stored, null), null);
});

test("имя файла безопасно для Windows", () => {
  assert.equal(safeName("How Medieval Peasants Survived Winter"), "How Medieval Peasants Survived Winter");
  assert.equal(safeName('What: "Why"? A/B\\C|D*'), "What Why A B C D");
  assert.equal(safeName("Ending dots... "), "Ending dots");
  assert.equal(safeName("CON"), "video");
  assert.equal(safeName(" ?? "), "video");
  assert.equal(safeName("x".repeat(400)).length, 150);
});

test("что сохраняется: видео со вшитым текстом только из принятого черновика", () => {
  const base = { title: "Winter", draft: "montage/a.mp4", srt: "montage/draft.srt", hasSubtitles: true };
  assert.deepEqual(exportList({ ...base, burned: { file: "montage/b.mp4", source: "montage/a.mp4" } }).map((i) => i.name), ["Winter.mp4", "Winter.srt", "Winter (subtitles).mp4"]);
  assert.deepEqual(exportList({ ...base, burned: { file: "montage/b.mp4", source: "montage/old.mp4" } }).map((i) => i.name), ["Winter.mp4", "Winter.srt"], "устаревшая версия не сохраняется");
  assert.deepEqual(exportList({ ...base, burned: null, hasSubtitles: false }).map((i) => i.name), ["Winter.mp4"]);
});

test("занятое имя получает номер", async () => {
  const dir = await temp();
  try {
    assert.equal(await freeName(dir, "a.mp4"), "a.mp4");
    await fs.writeFile(path.join(dir, "a.mp4"), "1");
    assert.equal(await freeName(dir, "a.mp4"), "a (2).mp4");
    await fs.writeFile(path.join(dir, "a (2).mp4"), "2");
    assert.equal(await freeName(dir, "a.mp4"), "a (3).mp4");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("копирование: содержимое целое, старый файл не тронут, временных файлов нет", async () => {
  const dir = await temp(), from = path.join(dir, "src"), to = path.join(dir, "dst");
  try {
    await fs.mkdir(from); await fs.mkdir(to);
    await fs.writeFile(path.join(from, "v.mp4"), Buffer.alloc(300_000, 7));
    await fs.writeFile(path.join(from, "s.srt"), "subs");
    await fs.writeFile(path.join(to, "Winter.mp4"), "прежний файл");
    const seen: number[] = [];
    const out = await copyFiles({ folder: to, items: [{ from: path.join(from, "v.mp4"), name: "Winter.mp4" }, { from: path.join(from, "s.srt"), name: "Winter.srt" }], onProgress: (done) => seen.push(done) });
    assert.deepEqual(out.map((f) => path.basename(f)), ["Winter (2).mp4", "Winter.srt"]);
    assert.equal(await fs.readFile(path.join(to, "Winter.mp4"), "utf8"), "прежний файл");
    assert.equal((await fs.stat(out[0])).size, 300_000);
    assert.equal(await fs.readFile(out[1], "utf8"), "subs");
    assert.equal(seen.at(-1), 300_004, "ход копирования доходит до конца");
    assert.equal((await fs.readdir(to)).some((f) => f.endsWith(".part")), false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("отмена копирования не оставляет файлов", async () => {
  const dir = await temp(), to = path.join(dir, "dst");
  try {
    await fs.mkdir(to);
    await fs.writeFile(path.join(dir, "v.mp4"), Buffer.alloc(100_000, 1));
    const stop = new AbortController();
    stop.abort();
    await assert.rejects(copyFiles({ folder: to, items: [{ from: path.join(dir, "v.mp4"), name: "a.mp4" }], signal: stop.signal }), /отменена/);
    assert.deepEqual(await fs.readdir(to), []);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("нет исходного файла: понятная ошибка, ничего не создано", async () => {
  const dir = await temp();
  try {
    await assert.rejects(copyFiles({ folder: dir, items: [{ from: path.join(dir, "missing.mp4"), name: "a.mp4" }] }));
    assert.deepEqual(await fs.readdir(dir), []);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
