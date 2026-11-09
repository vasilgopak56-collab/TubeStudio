// Подтягивание картинок и клипов из папки ролика. Внешних сервисов нет, папки временные.
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ts-import-"));
process.env.DATA_DIR = path.join(dir, "data");
process.env.ENV_FILE = path.join(dir, "absent.env");
const V = await import("../src/services/studio/visual.js");
const ch = await import("../src/services/studio/channels.js");
const projects = await import("../src/services/projects.js");
const { dataPath } = await import("../src/lib/storage.js");

const SCRIPT = ["## Hook", "In the winter of 1816 the snow never stopped falling on the mountain villages. Farmers watched their fields turn white in June. Nobody knew that a volcano on the other side of the world had caused it.", "Prices for bread doubled in a single month. Families sold their horses because there was no hay. The old king ordered the granaries to be opened, but the stores lasted only three weeks."].join("\n\n");
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(300, 7)]);
const MP4 = Buffer.concat([Buffer.from("000000206674797069736f6d", "hex"), Buffer.alloc(300, 9)]);
const ctx = { progress: () => {}, partial: () => {}, signal: new AbortController().signal } as any;
let channelId = "", projectId = "", clipDir = "", imageDir = "";
const board = async () => (await V.visualState(projectId)).board!;

before(async () => {
  const c = await ch.createChannel({ name: "The: Frost Ledger", language: "en" });
  channelId = c.id;
  const p = await projects.createProject({ title: "Peasants? Winter", channelId, artifact: { kind: "script", title: "Сценарий", data: { script: SCRIPT } } as any });
  projectId = p.id;
  await V.buildScenes(projectId, { channelId });
});
after(async () => {
  const { flushLogs } = await import("../src/lib/logging.js");
  await flushLogs();
  await fs.rm(dir, { recursive: true, force: true });
});

test("сопоставление: номер в начале имени, проблемные файлы называются", () => {
  const m = V.matchImportFiles([
    { name: "1_3_billion_years_s1_2K.mp4", bytes: 500 }, { name: "002.mp4", bytes: 500 }, { name: "3-x.mp4", bytes: 500 },
    { name: "cover.mp4", bytes: 500 }, { name: "2K_clip.mp4", bytes: 500 }, { name: "9_far.mp4", bytes: 500 },
    { name: "4_a.mp4", bytes: 500 }, { name: "4_b.mp4", bytes: 500 }, { name: "5_empty.mp4", bytes: 10 },
    { name: "6_x.mov", bytes: 500 }, { name: "Thumbs.db", bytes: 500 },
  ], /\.mp4$/i, 8);
  assert.deepEqual(m.ok.map((x) => x.n), [1, 2, 3]);
  assert.deepEqual(m.noNumber, ["cover.mp4", "2K_clip.mp4"]);
  assert.deepEqual(m.outOfRange, ["9_far.mp4"]);
  assert.deepEqual(m.duplicates, [{ n: 4, names: ["4_a.mp4", "4_b.mp4"] }]);
  assert.deepEqual(m.empty, ["5_empty.mp4"]);
  assert.deepEqual(m.otherType, ["6_x.mov"]);
});

test("пока папки не указаны, программа ничего не берёт и просит указать", async () => {
  await assert.rejects(V.importPreview(projectId), /Укажите папки/);
  await assert.rejects(V.runImport(projectId, ctx), /Укажите папки/);
  clipDir = path.join(dir, "main-clips");
  imageDir = path.join(dir, "main-images");
  await fs.mkdir(clipDir, { recursive: true });
  await fs.mkdir(imageDir, { recursive: true });
  await V.saveImportFolders(projectId, { images: imageDir, clips: "" });
  await assert.rejects(V.importPreview(projectId), /Укажите папки/);
  await V.saveImportFolders(projectId, { images: imageDir, clips: clipDir });
  const p = await V.importPreview(projectId);
  assert.equal(p.clips.found, 0);
  assert.equal(p.images.missing.length, p.total);
});

test("новый ролик не берёт папки предыдущего", async () => {
  const next = await projects.createProject({ title: "Следующий", channelId, artifact: { kind: "script", title: "Сценарий", data: { script: SCRIPT } } as any });
  await V.buildScenes(next.id, { channelId });
  assert.equal((await V.visualState(next.id)).board!.sources, undefined);
  await assert.rejects(V.importPreview(next.id), /Укажите папки/);
});

test("предпросмотр ничего не копирует; подтягивание заполняет сцены и не трогает исходники", async () => {
  await fs.writeFile(path.join(imageDir, "1_scene.png"), PNG);
  await fs.writeFile(path.join(clipDir, "1_scene_s1.mp4"), MP4);
  await fs.writeFile(path.join(clipDir, "2_scene_s1.mp4"), MP4);
  const p = await V.importPreview(projectId);
  assert.deepEqual(p.clips.willImport, [1, 2]);
  assert.deepEqual(p.images.willImport, [1]);
  assert.equal((await board()).rows[0].clip.state, "none");
  const r = await V.runImport(projectId, ctx);
  assert.deepEqual(r, { clips: { imported: 2, failed: [] }, images: { imported: 1, failed: [] } });
  const b = await board();
  assert.equal(b.rows[0].clip.state, "done");
  assert.equal(b.rows[0].clip.file, "visual/001_anim.mp4");
  assert.equal(b.rows[0].picture.file, "visual/001.png");
  assert.equal(b.rows[1].clip.file, "visual/002_anim.mp4");
  assert.equal(b.rows[2].clip.state, "none");
  assert.deepEqual(await fs.readFile(dataPath("files", projectId, "visual", "001_anim.mp4")), MP4);
  await fs.access(path.join(clipDir, "1_scene_s1.mp4"));
});

test("готовая сцена не заменяется", async () => {
  const other = Buffer.concat([MP4, Buffer.alloc(50, 1)]);
  await fs.writeFile(path.join(clipDir, "1_scene_s1.mp4"), other);
  const p = await V.importPreview(projectId);
  assert.deepEqual(p.clips.willImport, []);
  assert.deepEqual(p.clips.alreadyDone, [1, 2]);
  const r = await V.runImport(projectId, ctx);
  assert.equal(r.clips.imported, 0);
  assert.deepEqual(await fs.readFile(dataPath("files", projectId, "visual", "001_anim.mp4")), MP4);
});

test("свои папки ролика: адрес в кавычках принимается, файлы берутся оттуда, адреса переживают новую нарезку", async () => {
  const p = await projects.createProject({ title: "Свои папки", channelId, artifact: { kind: "script", title: "Сценарий", data: { script: SCRIPT } } as any });
  await V.buildScenes(p.id, { channelId });
  const own = path.join(dir, "свои"), ownImages = path.join(own, "кадры"), ownClips = path.join(own, "клипы");
  await fs.mkdir(ownImages, { recursive: true });
  await fs.mkdir(ownClips, { recursive: true });
  await fs.writeFile(path.join(ownClips, "1_scene.mp4"), MP4);
  await V.saveImportFolders(p.id, { images: ownImages, clips: `  "${ownClips}"  ` });
  const saved = await V.importPreview(p.id);
  assert.equal(saved.imageDir, ownImages);
  assert.equal(saved.clipDir, ownClips);
  assert.deepEqual(saved.clips.willImport, [1]);
  const r = await V.runImport(p.id, ctx);
  assert.equal(r.clips.imported, 1);
  await V.buildScenes(p.id, { channelId, replace: true });
  const after = (await V.visualState(p.id)).board!;
  assert.deepEqual(after.sources, { images: ownImages, clips: ownClips });
});

test("неверный адрес не сохраняется, пустые поля снова требуют папки", async () => {
  const p = await projects.createProject({ title: "Адреса", channelId, artifact: { kind: "script", title: "Сценарий", data: { script: SCRIPT } } as any });
  await V.buildScenes(p.id, { channelId });
  await assert.rejects(V.saveImportFolders(p.id, { images: path.join(dir, "нет-такой"), clips: "" }), /Папка не найдена/);
  await assert.rejects(V.saveImportFolders(p.id, { images: "относительная\\папка", clips: "" }), /полный адрес/);
  assert.equal((await V.visualState(p.id)).board!.sources, undefined);
  const file = path.join(dir, "файл.txt");
  await fs.writeFile(file, "x");
  await assert.rejects(V.saveImportFolders(p.id, { images: file, clips: "" }), /Папка не найдена/);
  const own = path.join(dir, "вторая");
  await fs.mkdir(own, { recursive: true });
  await V.saveImportFolders(p.id, { images: own, clips: own });
  await fs.rm(own, { recursive: true });
  await assert.rejects(V.importPreview(p.id), /Папка не найдена/);
  await V.saveImportFolders(p.id, { images: "", clips: "" });
  await assert.rejects(V.importPreview(p.id), /Укажите папки/);
});

test("дерево папок: только папки, по алфавиту, без файлов и служебных папок", async () => {
  const base = path.join(dir, "дерево");
  await fs.mkdir(path.join(base, "Яблоки"), { recursive: true });
  await fs.mkdir(path.join(base, "Апельсины"), { recursive: true });
  await fs.mkdir(path.join(base, "System Volume Information"), { recursive: true });
  await fs.writeFile(path.join(base, "файл.mp4"), MP4);
  const r = await V.listFolders(base);
  assert.equal(r.denied, false);
  assert.deepEqual(r.folders, [{ name: "Апельсины", path: path.join(base, "Апельсины") }, { name: "Яблоки", path: path.join(base, "Яблоки") }]);
});

test("дерево папок: диски без адреса, неверный адрес понятно отклоняется", async () => {
  const drives = await V.listFolders();
  assert.equal(drives.path, "");
  assert.ok(drives.folders.length > 0);
  assert.ok(drives.folders.every((d) => path.isAbsolute(d.path)));
  await assert.rejects(V.listFolders("относительная\\папка"), /полный адрес/);
  await assert.rejects(V.listFolders(path.join(dir, "нет-такой")), /Папка не найдена/);
  const file = path.join(dir, "просто-файл.txt");
  await fs.writeFile(file, "x");
  await assert.rejects(V.listFolders(file), /Папка не найдена/);
});

test("файл не того содержимого не подтягивается и называется в итоге", async () => {
  await fs.writeFile(path.join(clipDir, "3_broken.mp4"), Buffer.alloc(300, 1));
  const r = await V.runImport(projectId, ctx);
  assert.deepEqual(r.clips, { imported: 0, failed: ["3_broken.mp4"] });
  const b = await board();
  assert.equal(b.rows[2].clip.state, "none");
  await assert.rejects(fs.access(dataPath("files", projectId, "visual", "003_anim.mp4.part")));
});
