// Unit-тесты «Живого голоса» (Humanizer): детектор §/T, формула оценки, сверка фактов, разбивка на сцены
import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceReport, scanVoice, diffFacts, markersOf, THRESHOLD } from "../src/services/humanVoice.js";
import { splitScenes, formatReport } from "../src/services/humanizer.js";
import { scorecard100 } from "../src/services/topicFinder.js";
import { loadStructures, expectedActs } from "../src/services/script.js";
import { visualPresets } from "../src/services/storyboard.js";

const AI = `Добро пожаловать на канал! В этом видео мы погрузимся в удивительную историю. Это не просто химия. Это магия. Важно отметить, что хлорофилл играет ключевую роль в жизни растений — он поглощает свет — и превращает его в энергию. Учёные доказали, что фотосинтез является уникальным процессом. Давайте разберёмся. И это меняет всё.`;
const HUMAN = `В 1771 году Джозеф Пристли накрыл свечу стеклянным колпаком. Пламя погасло. Тогда он поставил под колпак веточку мяты и оставил её на несколько дней. Свеча снова загорелась.

Пристли не знал, что увидел работу хлорофилла. Зелёный пигмент ловит красный и синий свет, а зелёный отражает. Поэтому листья кажутся нам зелёными.`;

test("живой голос: ИИ-текст < 65, человеческий ≥ 85", () => {
  const a = voiceReport(AI, "ru"), h = voiceReport(HUMAN, "ru");
  assert.ok(a.score < 65, `ai ${a.score}`); assert.equal(a.verdict, "rewrite");
  assert.ok(h.score >= THRESHOLD, `human ${h.score}`); assert.equal(h.verdict, "human");
  const ids = new Set(a.hits.map((x) => x.rule));
  for (const r of ["§1", "§2", "§4", "§10", "§12", "§13", "§17", "§25", "§8"]) assert.ok(ids.has(r), `нет ${r}`);
  assert.ok(a.strong > 0);
});

test("живой голос: формула 100 − 5 × штраф на 100 слов", () => {
  const t = "Свеча погасла. " + "Мята росла под колпаком три дня. ".repeat(16) + "Давайте разберёмся.";
  const r = voiceReport(t, "ru");
  const exp = Math.round(100 - 5 * (r.penalty / r.words) * 100);
  assert.equal(r.score, Math.max(0, exp));
  assert.ok(r.hits.some((h) => h.rule === "§4" && h.strength === 3));
});

test("живой голос: цитаты «…» и служебные метки не правим", () => {
  const t = `Он записал: «Это не просто химия, а настоящая магия». [VISUAL CUE: Важно отметить крупный план] Свеча горела ровно.`;
  const hits = scanVoice(t, "ru");
  assert.ok(!hits.some((h) => h.rule === "§1" || h.rule === "§13" || h.rule === "§12"), JSON.stringify(hits));
  assert.deepEqual(markersOf("[[SCENE 1]] a [IMAGE 2] b [START][IMAGE 3]"), ["[[SCENE 1]]", "[IMAGE 2]", "[START][IMAGE 3]"]);
});

test("живой голос: TTS-правила и английский", () => {
  const t = "Цена выросла на 20% (это много)!!! Почему? Зачем? Как? Где? Что?… … … 😀 Диктор: пауза.";
  const ids = new Set(scanVoice(t, "ru").map((h) => h.rule));
  for (const r of ["T2", "T3", "T7", "T8", "T10"]) assert.ok(ids.has(r), `нет ${r}`);
  const en = new Set(scanVoice("It's not just a ship, it's a legend. Let's dive in. This pivotal moment serves as a testament.", "en").map((h) => h.rule));
  for (const r of ["§1", "§4", "§12", "§10"]) assert.ok(en.has(r), `en нет ${r}`);
  // первое «Представьте себе» разрешено, второе — §4b
  assert.equal(scanVoice("Представьте себе лес. Представьте себе поле.", "ru").filter((h) => h.rule === "§4b").length, 1);
});

test("сверка фактов: числа, цитаты, имена", () => {
  const d = diffFacts("В 1771 году Пристли сказал «свеча горит» и потратил 1 200 фунтов.", "Пристли в 1772 году потратил 1200 фунтов, а Лавуазье спорил.");
  assert.deepEqual(d.lostNumbers, ["1771"]); assert.deepEqual(d.addedNumbers, ["1772"]);
  assert.deepEqual(d.lostQuotes, ["свеча горит"]); assert.ok(d.addedNames.includes("лавуа")); assert.equal(d.lostNames.length, 0);
  assert.equal(d.ok, false);
  assert.equal(diffFacts("В 1771 году было 3 свечи.", "Три свечи? Нет: в 1771 году было 3 свечи.").ok, true);
});

test("сцены: метки [[SCENE n]] или абзацы по 120–280 слов", () => {
  assert.equal(splitScenes("[[SCENE 1]] Раз два.\n\n[[SCENE 2]] Три четыре.").length, 2);
  const p = (n: number) => Array.from({ length: n }, (_, i) => `слово${i}`).join(" ");
  const sc = splitScenes([p(70), p(70), p(200), p(30)].join("\n\n"));
  assert.equal(sc.length, 2); // 70+70 → сцена; 200 + хвост 30 приклеен к последней
  assert.ok(sc.every((s) => s.split(/\s+/).length >= 120));
});

test("отчёт в формате KB: ОЦЕНКА / НАЙДЕНО / СЦЕНА / ФАКТЫ / ОСТАВЛЕНО НАМЕРЕННО", () => {
  const before = voiceReport(AI, "ru"), after = voiceReport(HUMAN, "ru");
  const rep = formatReport({ before, after, threshold: 85, factsToCheck: ["Пристли 1771 — источник"], scenes: [{ i: 0, before: AI, after: HUMAN, status: "edited", scoreBefore: before.score, scoreAfter: after.score, hitsBefore: [], hitsAfter: [], edits: [{ before: "Это не просто химия. Это магия", rules: ["§1"], after: "Хлорофилл ловит свет" }], kept: [], facts: diffFacts(AI, HUMAN), factsToCheck: [], wordsBefore: 1, wordsAfter: 1 }] });
  for (const k of ["ОЦЕНКА:", "НАЙДЕНО:", "СЦЕНА 1: «Это не просто химия. Это магия» → §1 → «Хлорофилл ловит свет»", "ФАКТЫ:", "[FACT-CHECK]", "ОСТАВЛЕНО НАМЕРЕННО:"]) assert.ok(rep.includes(k), k);
});

test("KB: скоринг-карта идеи 100, структуры S1–S20, пресеты P1–P18, акты по объёму", () => {
  assert.equal(scorecard100({ demand: 5, emotion: 5, gap: 5, packaging: 5, retention: 5, visual: 5, evidence: 5, evergreen: 5, feasibility: 5 }), 100);
  assert.equal(scorecard100({ demand: 3, emotion: 3, gap: 3, packaging: 3, retention: 3, visual: 3, evidence: 3, evergreen: 3, feasibility: 3 }), 60);
  assert.equal(scorecard100({ demand: 5 }), null);
  return loadStructures().then((s) => {
    assert.equal(s.length, 20); assert.equal(s[0].id, "S1"); assert.ok(s.every((x) => x.body.length > 100));
    const p = visualPresets(); assert.equal(p.length, 18); assert.equal(p[17].id, "P18");
    assert.deepEqual([1200, 2000, 3200, 4500, 6000].map(expectedActs), [3, 4, 5, 6, 7]);
  });
});
