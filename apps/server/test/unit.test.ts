// Unit-тесты: формулы §8, парсеры, валидаторы. Запуск: npm test (node:test + tsx)
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { median, mean, videoRows, localParts } from "../src/services/metrics.js";
import { words, sentences, checkScript, spokenText } from "../src/services/scriptCheck.js";
import { heuristics, findMarkers } from "../src/services/aiHeuristics.js";
import { segment, cleanScript, checkImageBatch, checkVideoBatch } from "../src/services/storyboard.js";
import { extractJson } from "../src/services/llm.js";
import { normalize } from "../src/services/thumbnail.js";
import { seoToText } from "../src/services/seoText.js";

const DAY = 86400_000, NOW = Date.UTC(2026, 0, 31);
const vid = (id: string, views: number, likes: number, comments: number, daysAgo: number) => ({ id, title: id, publishedAt: new Date(NOW - daysAgo * DAY).toISOString(), views, likes, comments, durationSec: 600, isShort: false, thumbnail: "" }) as never;

test("median / mean", () => {
  assert.equal(median([]), 0); assert.equal(median([3, 1, 2]), 2); assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(mean([]), 0); assert.equal(mean([2, 4]), 3);
});

test("videoRows: engagement, outlier, views/day, bestScore", () => {
  const rows = videoRows([vid("a", 1000, 50, 50, 10), vid("b", 10000, 100, 0, 10), vid("c", 2000, 10, 10, 1)], NOW);
  const [a, b, c] = rows;
  assert.equal(a.engagement, 10); // (50+50)/1000*100
  assert.equal(b.outlier, 5); // 10000 / median(2000)
  assert.equal(a.viewsPerDay, 100);
  assert.equal(c.ageDays, 1);
  assert.ok(b.bestScore > a.bestScore, "больше просмотров → выше bestScore");
});

test("localParts учитывает часовой пояс", () => {
  const p = localParts("2026-01-05T23:30:00Z", "Europe/Moscow"); // пн 23:30 UTC = вт 02:30 МСК
  assert.deepEqual(p, { weekday: 1, hour: 2 });
});

test("words / sentences (RU)", () => {
  assert.equal(words("Привет, мир! Как дела — норм?"), 5);
  assert.equal(sentences("Раз. Два! Три? Четыре…").length, 4);
});

test("checkScript: отклонение длины и CTA", () => {
  const s = "Это тестовое предложение для проверки. ".repeat(50) + "Подпишитесь на канал.";
  const r = checkScript(s, { language: "ru", unit: "words", target: 250 });
  assert.equal(r.metrics.words, 253);
  assert.ok(Math.abs(r.metrics.deviationPct! - 1.2) < 0.01);
  assert.ok(r.metrics.ctaPos !== null && r.metrics.ctaPos > 90);
});

test("spokenText вырезает VISUAL CUE и заголовки актов", () => {
  const t = spokenText("Хук\nТекст [VISUAL CUE: карта] дальше", { headings: true, actNames: ["Хук"] });
  assert.ok(!t.includes("Хук") && !t.includes("VISUAL"));
});

test("AI-эвристики: шаблонный текст менее «человечный», чем живой", () => {
  const ai = "Важно отметить, что в современном мире это играет ключевую роль. Более того, стоит подчеркнуть значимость. Таким образом, можно сделать вывод. В заключение, это важно. ".repeat(4);
  const human = "Я проснулся в шесть. Кофе кончился — пришлось идти в ларёк, а там очередь из трёх бабушек и кота. Кот, кстати, был главным. Вернулся злой, но с булкой.";
  assert.ok(findMarkers(ai, "ru").length >= 4);
  assert.ok(heuristics(ai, "ru").score < heuristics(human, "ru").score, "score = «человечность»");
});

test("segment: склейка коротких предложений, батчи, тайминг", () => {
  const script = "Да. Это первое длинное предложение про королей. [VISUAL: замок]\n## Акт 2\nВторое предложение тоже вполне длинное. Ок. Третье длинное предложение завершает тест.";
  assert.ok(!cleanScript(script).includes("VISUAL") && !cleanScript(script).includes("Акт 2"));
  const s = segment(script, "weird_history");
  assert.equal(s.units.length, 3);
  assert.ok(s.units[0].text.startsWith("Да."));
  assert.equal(s.batches.length, 1);
  assert.equal(s.units[1].start, s.units[0].seconds);
  const many = segment(Array.from({ length: 45 }, (_, i) => `Предложение номер ${i} довольно длинное.`).join(" "), "weird_history");
  assert.deepEqual(many.batches.map((b) => [b.from, b.to]), [[1, 20], [21, 40], [41, 45]]);
});

test("валидаторы раскадровки", () => {
  const { units, cfg } = segment("Первое предложение достаточно длинное. Второе предложение тоже длинное.", "economics_of");
  const good = "A clean 2D illustration of a merchant counting coins at a wooden desk, full bleed 16:9, warm light";
  const r1 = checkImageBatch([{ n: 1, concept: "", image: good, video: "" }], units, cfg, "flux");
  assert.ok(r1.errors.some((e) => e.includes("2")), "пропущенная строка — ошибка");
  const r2 = checkImageBatch([{ n: 1, concept: "", image: good + ", photorealistic", video: "" }, { n: 2, concept: "", image: good + ", no photorealistic look", video: "" }], units, cfg, "flux");
  assert.equal(r2.errors.length, 1); // запрещённый термин только в #1; «no photorealistic» — не нарушение
  const v = checkVideoBatch([{ n: 1, concept: "", image: "", video: "Slow push-in on the coins while dust floats" }, { n: 2, concept: "", image: "", video: "Coins shimmer brightly in warm candlelight glow" }], cfg, "kling", 5);
  assert.equal(v.errors.length, 0); assert.equal(v.warnings.length, 1);
});

test("extractJson: code fences и мусор вокруг", () => {
  assert.deepEqual(extractJson("```json\n{\"a\":1}\n```"), { a: 1 });
  assert.deepEqual(extractJson("Вот ответ: [1,2] спасибо"), [1, 2]);
  assert.throws(() => extractJson("нет json"));
});

test("обложка: normalize → 1280×720 JPEG ≤ 2 МБ", async () => {
  const noise = Buffer.alloc(2400 * 1600 * 3); for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() * 255) | 0;
  const png = await sharp(noise, { raw: { width: 2400, height: 1600, channels: 3 } }).png().toBuffer();
  const out = await normalize(png.toString("base64"));
  const m = await sharp(out).metadata();
  assert.equal(m.width, 1280); assert.equal(m.height, 720); assert.equal(m.format, "jpeg");
  assert.ok(out.length <= 2 * 1024 * 1024, `размер ${out.length}`);
});

test("seoToText собирает пакет", () => {
  const t = seoToText({ titles: [{ title: "Заголовок" }], description: { full: "Описание" }, hashtags: ["#a"], tags: [{ tag: "тег", selected: true }], pinnedComments: [] });
  assert.ok(t.includes("Заголовок") && t.includes("Описание"));
});
