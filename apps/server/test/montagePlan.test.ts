// Выпуск 3, шаг 1: раскладка сцен по таймингам озвучки. Чистый расчёт, FFmpeg и внешние сервисы не нужны.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMontagePlan, MIN_STILL_SEC, type MontageScene } from "../src/services/studio/montagePlan.js";

const scene = (n: number, start: number, end: number, media: Partial<MontageScene> = {}): MontageScene => ({ n, start, end, image: null, clip: null, clipSeconds: null, ...media });
const clip = (seconds: number | null, file = "c.mp4") => ({ clip: file, clipSeconds: seconds, image: "p.png" });

test("клип длиннее фразы обрезается по концу фразы", () => {
  const plan = buildMontagePlan([scene(1, 0, 5, clip(8))], 5);
  assert.deepEqual(plan.segments, [{ scene: 1, start: 0, end: 5, seconds: 5, kind: "clip", file: "c.mp4", clipTo: 5 }]);
  assert.equal(plan.ready, true);
});

test("клип точно по длине фразы идёт без статичного кадра", () => {
  const plan = buildMontagePlan([scene(1, 0, 6, clip(6))], 6);
  assert.deepEqual(plan.segments.map((s) => s.kind), ["clip"]);
});

test("клип короче фразы: после него до конца фразы статичный кадр той же сцены", () => {
  const plan = buildMontagePlan([scene(1, 0, 8, clip(5)), scene(2, 8, 10, clip(2, "d.mp4"))], 10);
  assert.deepEqual(plan.segments.slice(0, 2), [
    { scene: 1, start: 0, end: 5, seconds: 5, kind: "clip", file: "c.mp4", clipTo: 5 },
    { scene: 1, start: 5, end: 8, seconds: 3, kind: "still", source: "clip", file: "c.mp4", clipTime: 5 },
  ]);
  assert.equal(plan.segments[2].start, 8);
});

test("без клипа картинка сцены стоит всю фразу", () => {
  const plan = buildMontagePlan([scene(1, 0, 4, { image: "p.png" })], 4);
  assert.deepEqual(plan.segments, [{ scene: 1, start: 0, end: 4, seconds: 4, kind: "still", source: "image", file: "p.png", clipTime: null }]);
});

test("сцена без материалов помечается и ничем не подменяется", () => {
  const plan = buildMontagePlan([scene(1, 0, 3, { image: "p.png" }), scene(2, 3, 6), scene(3, 6, 9, { image: "q.png" })], 9);
  assert.equal(plan.segments[1].kind, "missing");
  assert.deepEqual(plan.problems, [{ scene: 2, problem: "no-media" }]);
  assert.equal(plan.ready, false);
});

for (const bad of [null, 0, -1, Number.NaN]) {
  test(`клип с неизвестной длиной (${bad}) — проблема, картинка его не заменяет`, () => {
    const plan = buildMontagePlan([scene(1, 0, 4, clip(bad))], 4);
    assert.deepEqual(plan.problems, [{ scene: 1, problem: "clip-length-unknown" }]);
    assert.equal(plan.segments[0].kind, "missing");
  });
}

test("тишина до первой фразы: первый кадр клипа", () => {
  const plan = buildMontagePlan([scene(1, 1.2, 4, clip(2.8))], 4);
  assert.deepEqual(plan.segments[0], { scene: 1, start: 0, end: 1.2, seconds: 1.2, kind: "still", source: "clip", file: "c.mp4", clipTime: 0 });
  assert.equal(plan.segments[1].start, 1.2);
  assert.equal(plan.segments[1].kind, "clip");
});

test("тишина до первой фразы без клипа: картинка сцены одним куском со своей фразой по времени", () => {
  const plan = buildMontagePlan([scene(1, 1, 3, { image: "p.png" })], 3);
  assert.deepEqual(plan.segments.map((s) => [s.kind, s.start, s.end]), [["still", 0, 1], ["still", 1, 3]]);
  assert.ok(plan.segments.every((s) => s.kind === "still" && s.source === "image"));
});

test("тишина после последней фразы: кадр на месте обрезки клипа", () => {
  const plan = buildMontagePlan([scene(1, 0, 5, clip(8))], 7);
  assert.deepEqual(plan.segments, [
    { scene: 1, start: 0, end: 5, seconds: 5, kind: "clip", file: "c.mp4", clipTo: 5 },
    { scene: 1, start: 5, end: 7, seconds: 2, kind: "still", source: "clip", file: "c.mp4", clipTime: 5 },
  ]);
});

test("короткий клип и тишина в конце дают один статичный кусок до конца озвучки", () => {
  const plan = buildMontagePlan([scene(1, 0, 6, clip(4))], 9);
  assert.deepEqual(plan.segments.map((s) => [s.kind, s.start, s.end]), [["clip", 0, 4], ["still", 4, 9]]);
});

test("остаток короче одного кадра не становится отдельным куском", () => {
  const short = MIN_STILL_SEC / 2;
  const middle = buildMontagePlan([scene(1, 0, 8, clip(8 - short)), scene(2, 8, 9, { image: "p.png" })], 9);
  assert.equal(middle.segments[0].kind, "clip");
  assert.equal(middle.segments[0].end, 8);
  assert.equal(middle.segments[1].scene, 2);
  const edges = buildMontagePlan([scene(1, short, 5, clip(8))], 5 + short);
  assert.deepEqual(edges.segments.map((s) => [s.kind, s.start, s.end]), [["clip", 0, 5 + short]]);
});

test("сцена нулевой длины не попадает в план и не считается проблемой", () => {
  const plan = buildMontagePlan([scene(1, 0, 3, { image: "p.png" }), scene(2, 3, 3), scene(3, 3, 6, { image: "q.png" })], 6);
  assert.deepEqual(plan.segments.map((s) => s.scene), [1, 3]);
  assert.equal(plan.ready, true);
});

test("куски идут встык от нуля до конца озвучки", () => {
  const plan = buildMontagePlan([
    scene(1, 0.37, 4.21, clip(3)), scene(2, 4.21, 9.8, clip(8, "d.mp4")), scene(3, 9.8, 12.05, { image: "p.png" }),
    scene(4, 12.05, 12.05, { image: "z.png" }), scene(5, 12.05, 19.99, clip(5.5, "e.mp4")),
  ], 21.4);
  let cursor = 0;
  for (const s of plan.segments) {
    assert.equal(s.start, cursor);
    assert.ok(s.end > s.start);
    cursor = s.end;
  }
  assert.equal(cursor, 21.4);
});

test("расхождение границ в пределах округления закрывается, большой разрыв и наложение — ошибка", () => {
  const near = buildMontagePlan([scene(1, 0, 3.01, { image: "p.png" }), scene(2, 3, 6, { image: "q.png" })], 6);
  assert.equal(near.segments[0].end, 3);
  assert.throws(() => buildMontagePlan([scene(1, 0, 3), scene(2, 4, 6)], 6), /разрыв или наложение/);
  assert.throws(() => buildMontagePlan([scene(1, 0, 4), scene(2, 3, 6)], 6), /разрыв или наложение/);
});

test("конец сцен немного позже звука обрезается, сильно позже — ошибка", () => {
  const plan = buildMontagePlan([scene(1, 0, 5.3, { image: "p.png" })], 5);
  assert.equal(plan.segments[0].end, 5);
  assert.throws(() => buildMontagePlan([scene(1, 0, 6, { image: "p.png" })], 5), /позже озвучки/);
});

test("неверные входные данные отклоняются", () => {
  assert.throws(() => buildMontagePlan([], 5), /нет сцен/);
  assert.throws(() => buildMontagePlan([scene(1, 0, 5)], 0), /Длина озвучки/);
  assert.throws(() => buildMontagePlan([scene(1, 0, 5)], Number.NaN), /Длина озвучки/);
  assert.throws(() => buildMontagePlan([scene(1, 3, 2)], 5), /неверные границы/);
  assert.throws(() => buildMontagePlan([scene(1, -1, 2)], 5), /неверные границы/);
});
