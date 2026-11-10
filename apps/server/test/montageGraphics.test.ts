// Выпуск 3, шаг 6: карты и таймлайн. Без FFmpeg и внешних сервисов, строки взяты из сценария первого ролика.
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { assessMontage, type Inspected } from "../src/services/studio/montageCheck.js";
import { PLACES, applyGraphics, findCandidates, mapSvg, mapView, placesIn, specLabel, timeIn, timelineModel, timelineSvg } from "../src/services/studio/montageGraphics.js";

const names = (t: string) => placesIn(t).map((p) => p.name);
const SCRIPT = [
  { n: 6, text: "The ledger opens on an imagined village in northern Europe," },
  { n: 9, text: "But even in the south of France, a chronicle from Montpellier records hard cold from late November into March." },
  { n: 21, text: "In early medieval northern Europe, between roughly the fifth and twelfth centuries, people sank some buildings into the ground." },
  { n: 22, text: "Archaeologists call them sunken-featured buildings, or in German, Grubenhäuser." },
  { n: 30, text: "No chimney." },
  { n: 48, text: "What we can test is the house itself. Researchers in Denmark and Germany have rebuilt early houses," },
  { n: 50, text: "In the Danish houses, people lived for weeks through the cold months with a central fire," },
  { n: 162, text: "So in some regions, as in the longhouses of Dartmoor in south-west England," },
];

test("сценарий первого ролика: предложены пять ожидаемых сцен", () => {
  const found = findCandidates(SCRIPT);
  assert.deepEqual(found.map((c) => [c.scene, specLabel(c.spec)]), [
    [6, "Карта: Northern Europe"],
    [9, "Карта: Montpellier"],
    [21, "Таймлайн: 5th – 12th centuries"],
    [48, "Карта: Germany, Denmark"],
    [162, "Карта: Dartmoor"],
  ]);
});

test("более точное место вытесняет общее, равные остаются вместе", () => {
  assert.deepEqual(names("in the south of France, at Montpellier"), ["Montpellier"]);
  assert.deepEqual(names("Dartmoor in south-west England"), ["Dartmoor"]);
  assert.deepEqual(names("across northern Europe"), ["Northern Europe"]);
  assert.deepEqual(names("in Europe and in Denmark"), ["Denmark"]);
});

test("прилагательные, месяцы и похожие слова не считаются местами", () => {
  assert.deepEqual(names("in German they say, the Danish houses, late November into March"), []);
  assert.deepEqual(names("the road to New York"), []);
  assert.deepEqual(names("the city of York"), ["York"]);
});

test("время: века словами и цифрами, диапазоны и годы", () => {
  assert.deepEqual(timeIn("between roughly the fifth and twelfth centuries"), { unit: "century", from: 5, to: 12 });
  assert.deepEqual(timeIn("from the 11th to the 13th century"), { unit: "century", from: 11, to: 13 });
  assert.deepEqual(timeIn("in the fourteenth century"), { unit: "century", from: 14, to: 14 });
  assert.deepEqual(timeIn("the famine from 1315 to 1322"), { unit: "year", from: 1315, to: 1322 });
  assert.deepEqual(timeIn("died in 1348"), { unit: "year", from: 1348, to: 1348 });
});

test("числа и обратный порядок не становятся датами", () => {
  assert.equal(timeIn("about 1200 people and 600 cows"), null);
  assert.equal(timeIn("twelfth and fifth centuries"), null);
  assert.equal(timeIn("a second helping"), null);
});

test("координаты всех мест правдоподобны, родители существуют", () => {
  const known = new Set(PLACES.map((p) => p.name));
  for (const p of PLACES) {
    assert.ok(p.lat > 30 && p.lat < 80 && p.lon > -60 && p.lon < 60, p.name);
    if (p.parent) assert.ok(known.has(p.parent), `${p.name}: ${p.parent}`);
  }
});

test("одно место точно в центре кадра, несколько помещаются", () => {
  const dartmoor = PLACES.find((p) => p.name === "Dartmoor")!;
  assert.deepEqual(mapView([dartmoor]), { lat: dartmoor.lat, lon: dartmoor.lon, span: dartmoor.span });
  const two = PLACES.filter((p) => p.name === "Spain" || p.name === "Norway");
  assert.ok(mapView(two).span > Math.max(...two.map((p) => p.span)));
});

test("шкала веков: запас с краёв и выделенный диапазон", () => {
  const m = timelineModel({ unit: "century", from: 5, to: 12 });
  assert.equal(m.min, 300);
  assert.equal(m.max, 1300);
  assert.equal(m.start, 400);
  assert.equal(m.end, 1200);
  assert.equal(m.title, "5th – 12th centuries");
  assert.equal(m.tickLabels[0].text, "4th");
  assert.equal(m.tickLabels.at(-1)!.text, "13th");
  assert.equal(timelineModel({ unit: "century", from: 1, to: 1 }).min, 0, "века не уходят в минус");
  assert.equal(timelineModel({ unit: "century", from: 21, to: 22 }).title, "21st – 22nd centuries");
  assert.equal(timelineModel({ unit: "century", from: 11, to: 11 }).title, "11th century");
});

test("шкала лет: круглые отметки вокруг диапазона", () => {
  const m = timelineModel({ unit: "year", from: 1315, to: 1322 });
  assert.ok(m.min <= 1310 && m.max >= 1327);
  assert.equal(m.ticks.every((t) => t % 5 === 0), true);
  assert.equal(m.title, "1315 – 1322");
});

test("карта и таймлайн рисуются в файл 3840×2160", async () => {
  for (const svg of [await mapSvg(["Dartmoor"]), await mapSvg(["Germany", "Denmark"]), await mapSvg(["Northern Europe"]), timelineSvg({ unit: "century", from: 5, to: 12 })]) {
    const meta = await sharp(await sharp(Buffer.from(svg)).png().toBuffer()).metadata();
    assert.equal(meta.width, 3840);
    assert.equal(meta.height, 2160);
  }
});

test("на карте есть маркер с подписью и нет линий границ стран", async () => {
  const svg = await mapSvg(["Montpellier"]);
  assert.match(svg, />Montpellier<\/text>/);
  assert.equal((svg.match(/<path /g) ?? []).length, 1, "один контур суши");
});

const row = (n: number) => ({ n, start: (n - 1) * 4, end: n * 4, picture: { file: `${n}.jpg` }, clip: { file: `${n}.mp4` } });

test("в ролик идёт только подтверждённая графика", () => {
  const out = applyGraphics([row(1), row(2), row(3)], [{ scene: 1, file: "g1.png", status: "accepted" }, { scene: 2, file: "g2.png", status: "pending" }, { scene: 3, file: "g3.png", status: "rejected" }]);
  assert.deepEqual(out[0], { ...row(1), picture: { file: "g1.png" }, clip: {}, graphic: true });
  assert.deepEqual(out[1], row(2));
  assert.deepEqual(out[2], row(3));
});

test("пометка «переделать» у заменённой сцены больше не блокирует, а файлы графики проверяются", async () => {
  const HD = { seconds: 8, width: 1920, height: 1080, video: true, audio: false };
  const VOICE = { seconds: 8, width: null, height: null, video: false, audio: true };
  const rows = applyGraphics([{ ...row(1), clip: { file: "1.mp4", verdict: "redo" as const } }, row(2)], [{ scene: 1, file: "g1.png", status: "accepted" }]);
  const board = { timing: "audio" as const, stale: false, audioFile: "v.mp3", rows };
  const inspect = (over: Record<string, Inspected> = {}) => async (f: string): Promise<Inspected> => over[f] ?? (f === "v.mp3" ? VOICE : HD);
  const ok = await assessMontage({ board, facts: "passed" }, inspect());
  assert.equal(ok.ready, true);
  assert.deepEqual(ok.warnings, [], "графика не считается сценой без клипа");
  const still = ok.plan!.segments.filter((s) => s.kind === "still" && s.source === "image");
  assert.deepEqual(still.map((s) => (s as { file: string }).file), ["g1.png"], "идёт как картинка с приближением");
  const missing = await assessMontage({ board, facts: "passed" }, inspect({ "g1.png": "missing" }));
  assert.deepEqual(missing.blockers.map((b) => [b.code, b.scenes]), [["missing-file", [1]]]);
});
