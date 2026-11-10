// Выпуск 4, шаг 1: карточка публикации. Только расчёты и картинки в памяти: сети и реальных данных нет.
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { CardInput, MAX_CHAPTERS, MAX_THUMBNAIL_BYTES, assessCard, inspectThumbnail, mergeChapters, proposeChapters, type CardFacts, type ChapterRow } from "../src/services/studio/publishCard.js";

/** Сцены по 5 секунд, новый абзац каждые 6 сцен. */
const board = (seconds: number): ChapterRow[] => Array.from({ length: Math.floor(seconds / 5) }, (_, i) => ({ n: i + 1, start: i * 5, paragraph: Math.floor(i / 6), text: `Scene ${i + 1} words here` }));

test("главы начинаются с 0:00, стоят на начале абзацев и идут не чаще 10 секунд", () => {
  const rows = board(1000), out = proposeChapters(rows, 1000);
  assert.equal(out.length, MAX_CHAPTERS);
  assert.equal(out[0].start, 0);
  for (const c of out.slice(1)) assert.equal(rows[c.scene - 1].paragraph, rows[c.scene - 2].paragraph + 1, `сцена ${c.scene} начинает абзац`);
  out.slice(1).forEach((c, i) => assert.ok(c.start - out[i].start >= 10));
  assert.ok(out.every((c) => c.title === ""), "названия программа не придумывает");
});

test("время главы берётся из тайминга сцены, а не из подсчёта слов", () => {
  const rows: ChapterRow[] = [{ n: 1, start: 1.4, paragraph: 0, text: "a" }, { n: 2, start: 61.9, paragraph: 1, text: "b" }, { n: 3, start: 120.2, paragraph: 2, text: "c" }];
  assert.deepEqual(proposeChapters(rows, 180).map((c) => c.start), [0, 61, 120]);
});

test("главы, которые YouTube не примет, не предлагаются", () => {
  assert.deepEqual(proposeChapters(board(20), 20), [], "слишком короткий ролик");
  assert.deepEqual(proposeChapters([{ n: 1, start: 0, paragraph: 0, text: "a" }, { n: 2, start: 100, paragraph: 0, text: "b" }], 300), [], "один абзац");
  assert.deepEqual(proposeChapters([], 300), []);
});

test("название возвращается только к той же сцене с тем же текстом", () => {
  const proposed = [{ scene: 1, start: 0, excerpt: "first", title: "" }, { scene: 9, start: 40, excerpt: "second", title: "" }];
  const merged = mergeChapters(proposed, [{ scene: 1, excerpt: "first", title: "Intro" }, { scene: 9, excerpt: "другой текст", title: "Old" }]);
  assert.deepEqual(merged.map((c) => c.title), ["Intro", ""]);
});

const ready: CardFacts = {
  hasMontage: true, busy: false, accepted: true, facts: "passed", boardChanged: false,
  card: { language: "en", categoryId: "27", madeForKids: false, syntheticMedia: true, thumbnail: { file: "publish/t.jpg", width: 1280, height: 720, bytes: 10 } },
  chapters: [{ scene: 1, start: 0, excerpt: "x", title: "Intro" }],
};
const levelOf = (o: CardFacts, code: string) => assessCard(o).checks.find((c) => c.code === code)?.level;

test("заполненная карточка готова", () => {
  const r = assessCard(ready);
  assert.equal(r.ready, true);
  assert.ok(r.checks.every((c) => c.level === "ok"));
});

test("без принятого ролика карточка не готова", () => {
  assert.equal(assessCard({ ...ready, accepted: false }).ready, false);
  assert.equal(assessCard({ ...ready, hasMontage: false, accepted: false }).ready, false);
  assert.equal(assessCard({ ...ready, busy: true }).ready, false);
});

test("ответы об аудитории и ИИ не подставляются: без них карточка не готова", () => {
  assert.equal(levelOf({ ...ready, card: { ...ready.card, madeForKids: null } }, "kids"), "block");
  assert.equal(levelOf({ ...ready, card: { ...ready.card, syntheticMedia: null } }, "synthetic"), "block");
  assert.equal(levelOf({ ...ready, card: { ...ready.card, categoryId: null } }, "category"), "block");
  assert.equal(levelOf({ ...ready, card: { ...ready.card, language: null } }, "language"), "block");
  assert.equal(levelOf({ ...ready, card: { ...ready.card, madeForKids: false } }, "kids"), "ok", "ответ «нет» — тоже ответ");
});

test("пустое название главы мешает, а отсутствие глав и обложки только предупреждает", () => {
  assert.equal(levelOf({ ...ready, chapters: [{ scene: 1, start: 0, excerpt: "x", title: "" }] }, "chapters"), "block");
  const none = assessCard({ ...ready, chapters: [], card: { ...ready.card, thumbnail: null } });
  assert.equal(none.ready, true);
  assert.equal(none.checks.find((c) => c.code === "chapters")?.level, "warn");
  assert.equal(none.checks.find((c) => c.code === "thumbnail")?.level, "warn");
});

test("непроверенные факты и изменённая раскадровка предупреждают, но не блокируют", () => {
  const r = assessCard({ ...ready, facts: "none", boardChanged: true });
  assert.equal(r.ready, true);
  assert.equal(r.checks.find((c) => c.code === "facts")?.level, "warn");
  assert.equal(r.checks.find((c) => c.code === "board-changed")?.level, "warn");
});

test("форма: неверные язык, категория и лишние поля отклоняются", () => {
  const ok = { language: "en", categoryId: "27", madeForKids: false, syntheticMedia: null, chapters: [{ scene: 1, title: "Intro" }] };
  assert.equal(CardInput.safeParse(ok).success, true);
  assert.equal(CardInput.safeParse({ ...ok, language: "english" }).success, false);
  assert.equal(CardInput.safeParse({ ...ok, categoryId: "999" }).success, false);
  assert.equal(CardInput.safeParse({ ...ok, privacy: "public" }).success, false);
  assert.equal(CardInput.safeParse({ ...ok, chapters: [{ scene: 1, title: "a < b" }] }).success, false);
  assert.equal(CardInput.safeParse({ ...ok, chapters: [{ scene: 1, title: "x".repeat(81) }] }).success, false);
});

const image = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#123456" } });

test("обложка проверяется по содержимому файла", async () => {
  assert.deepEqual(await inspectThumbnail(await image(1280, 720).jpeg().toBuffer()).then((i) => [i.ext, i.width, i.height]), ["jpg", 1280, 720]);
  assert.equal((await inspectThumbnail(await image(640, 360).png().toBuffer())).ext, "png");
  await assert.rejects(inspectThumbnail(await image(320, 180).jpeg().toBuffer()), /640/);
  await assert.rejects(inspectThumbnail(await image(1000, 1000).jpeg().toBuffer()), /16:9/);
  await assert.rejects(inspectThumbnail(await image(1280, 720).webp().toBuffer()), /JPG или PNG/);
  await assert.rejects(inspectThumbnail(Buffer.from("not an image")), /JPG или PNG/);
  await assert.rejects(inspectThumbnail(Buffer.alloc(MAX_THUMBNAIL_BYTES + 1)), /2 МБ/);
});
