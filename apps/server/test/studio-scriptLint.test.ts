// Выпуск 1: автопроверка сценария без ИИ. Критерий «готово»: на Shields ловит
// описательное вступление, лишние оговорки и повтор вывода; на чистом тексте — без ложных ошибок.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lintScript, detectLanguage } from "../src/services/studio/scriptLint.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => fs.readFileSync(path.join(here, "fixtures", "scripts", name), "utf8");
const rules = (r: ReturnType<typeof lintScript>) => new Map(r.issues.map((i) => [i.rule, i]));

test("Shields: описательное вступление, лишние оговорки и повтор вывода найдены", () => {
  const r = lintScript(fixture("shields-v1.txt"), { targetMinutes: 11 });
  assert.equal(r.language, "en");
  assert.ok(r.words > 1600 && r.words < 1750, `слов ${r.words}`);
  const m = rules(r);
  assert.equal(m.get("opening-descriptive")?.severity, "error");
  assert.ok((m.get("opening-descriptive")?.items ?? []).some((x) => /stands in front of/.test(x.quote)));
  assert.equal(m.get("hook")?.severity, "error");
  assert.equal(m.get("hedges")?.severity, "error");
  assert.ok(r.hedges.count > r.hedges.allowed, `оговорок ${r.hedges.count} при норме ${r.hedges.allowed}`);
  assert.ok((m.get("hedges")?.items ?? []).some((x) => /A word of caution/i.test(x.quote)));
  // Повтор вывода: два финала и одна и та же формулировка дважды
  const ending = m.get("double-ending");
  assert.ok(ending, "нет «двух финалов»");
  assert.ok(ending!.items!.some((x) => /So the real story is coexistence/.test(x.quote)));
  const repeat = r.issues.filter((i) => i.rule === "repeat");
  assert.ok(repeat.some((i) => /the word shield covered/.test(i.title)), "нет повтора «the word shield covered»");
  assert.ok(m.has("opening-meta"), "нет «We'll stay…» в первую минуту");
  assert.ok(m.has("false-ending"), "нет прощания «next time» в середине");
  // У каждой находки — абзац и время
  for (const i of r.issues) for (const x of i.items ?? []) { assert.ok(x.paragraph >= 1); assert.match(x.at, /^\d+:\d\d/); }
});

test("русский текст: правила работают на кириллице", () => {
  const r = lintScript(fixture("ru-bad.txt"));
  assert.equal(r.language, "ru");
  const m = rules(r);
  for (const rule of ["hook", "opening-descriptive", "hedges", "production"]) assert.equal(m.get(rule)?.severity, "error", rule);
  for (const rule of ["opening-meta", "hedges-cluster", "cta-early", "false-ending", "double-ending", "brackets", "repeat"]) assert.ok(m.has(rule), rule);
  assert.equal(r.hedges.count, 6);
  // Перекрывающиеся совпадения склеены в одну фразу
  const repeats = r.issues.filter((i) => i.rule === "repeat");
  assert.equal(repeats.length, 1);
  assert.match(repeats[0].title, /потому что город никогда не переставал за ними ухаживать/);
});

test("чистые тексты: без ошибок и предупреждений", () => {
  for (const name of ["ru-clean.txt", "en-clean.txt"]) {
    const r = lintScript(fixture(name));
    assert.equal(r.errors, 0, `${name}: ${r.issues.map((i) => i.rule).join(", ")}`);
    assert.equal(r.warnings, 0, `${name}: ${r.issues.map((i) => i.rule).join(", ")}`);
    assert.ok(r.passed.length >= 8);
  }
});

test("длина: ±10% от цели — ошибка, иначе в допуске", () => {
  const text = fixture("en-clean.txt"); // 196 слов ≈ 1:18 при 150 сл/мин
  assert.equal(rules(lintScript(text, { targetMinutes: 3 })).get("length")?.severity, "error");
  assert.notEqual(rules(lintScript(text, { targetMinutes: 1.35 })).get("length")?.severity, "error");
  assert.equal(lintScript(text, { wpm: 120 }).duration, "1:38");
});

test("язык определяется сам; скобки и метки диктора находятся", () => {
  assert.equal(detectLanguage("Почему город платил человеку?"), "ru");
  assert.equal(detectLanguage("Why would a king pay a man?"), "en");
  const r = lintScript("Why did it fail? Nobody knew. [music] The answer was money.\n\nNarrator: the end came fast.\n\nWhat would you do?");
  assert.ok(rules(r).has("brackets"));
  assert.equal(rules(r).get("production")?.severity, "error");
  // {{pause}} — разрешённая пауза озвучки, не скобки
  assert.ok(!rules(lintScript("Why did it fail? {{pause}} Nobody knew the answer. What would you do?")).has("brackets"));
});
