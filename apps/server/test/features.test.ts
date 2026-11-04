// Бюджет, «Голос канала», календарь (.ics), Prompt Studio — без ключей и сети
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ts-unit-"));
const { costOf, priceFor } = await import("../src/services/usage.js");
const { DEFAULT_PRICES } = await import("../src/services/settings.js");
const { analyzeVoice, passportPrompt, saveVoiceProfile, activeVoicePrompt } = await import("../src/services/channelVoice.js");
const { calendarIcs, addCalendar, listCalendar } = await import("../src/services/calendar.js");
const { readPromptFile, listPrompts, varsOf } = await import("../src/services/promptStudio.js");

test("бюджет: цена по подстроке модели, flash-lite раньше flash", () => {
  assert.equal(priceFor("gemini-3.1-flash-lite", DEFAULT_PRICES)?.match, "flash-lite");
  assert.equal(priceFor("gemini-3.5-flash", DEFAULT_PRICES)?.match, "flash");
  assert.equal(priceFor("gemini-3.1-flash-image", DEFAULT_PRICES)?.match, "flash-image");
  const c = costOf({ llm: { "claude-opus-5-5": { in: 1_000_000, out: 100_000, calls: 3 }, "gemini-3.5-flash": { in: 2_000_000, out: 0, calls: 1 } }, images: { "gpt-image-2.5": 10 } }, DEFAULT_PRICES);
  assert.equal(c.total, 15 + 7.5 + 0.6 + 0.7);
  assert.equal(c.rows[0].model, "claude-opus-5-5");
});

test("бюджет: AnyModel — стоимость по балансовым токенам, поиск отдельной строкой", () => {
  const c = costOf({ llm: { "cc/claude-sonnet-5": { in: 10_000, out: 2_000, calls: 2 }, "gemini-3.5-flash": { in: 1_000_000, out: 0, calls: 1 } }, images: { "cx/gpt-image-2": 3 }, am: { "cc/claude-sonnet-5": 2_000_000, "cx/gpt-image-2": 400_000, "web-search": 80_000 } }, DEFAULT_PRICES, 0.05);
  const by = Object.fromEntries(c.rows.map((r) => [r.model, r]));
  assert.equal(by["cc/claude-sonnet-5"].via, "anymodel");
  assert.equal(by["cc/claude-sonnet-5"].usd, 0.1);
  assert.equal(by["cx/gpt-image-2"].kind, "image");
  assert.equal(by["web-search"].kind, "search");
  assert.equal(by["web-search"].calls, 2);
  assert.equal(by["gemini-3.5-flash"].via, "direct");
  assert.equal(c.balanceTokens, 2_480_000);
});

test("озвучка: очистка текста, нарезка, длительность MP3/WAV", async () => {
  const { cleanForTts, chunkText, mp3Duration, wavDuration } = await import("../src/services/tts.js");
  const t = cleanForTts("[[SCENE 1]] Привет, **мир**. [VISUAL CUE: город]\n\n[IMAGE 2] Второй абзац [FACT-CHECK].");
  assert.ok(!/\[|\*/.test(t), t);
  const long = Array.from({ length: 200 }, (_, i) => `Предложение номер ${i} про древний Египет.`).join(" ");
  const ch = chunkText(long, 500);
  assert.ok(ch.length > 10 && ch.every((c) => c.length <= 500));
  assert.equal(ch.join(" ").replace(/\s+/g, " "), long);
  // MPEG-1 Layer III 128 kbps 44.1 kHz: кадр 417 байт = 1152/44100 с
  const frame = Buffer.alloc(417); frame[0] = 0xff; frame[1] = 0xfb; frame[2] = 0x90; frame[3] = 0x64;
  const mp3 = Buffer.concat(Array.from({ length: 100 }, () => frame));
  assert.equal(mp3Duration(mp3).frames, 100);
  assert.ok(Math.abs(mp3Duration(mp3).seconds - 2.61) < 0.02);
  const wav = Buffer.alloc(44 + 32000); wav.write("RIFF", 0, "latin1"); wav.write("WAVE", 8, "latin1"); wav.write("fmt ", 12, "latin1"); wav.writeUInt32LE(16, 16); wav.writeUInt32LE(16000, 28); wav.write("data", 36, "latin1"); wav.writeUInt32LE(32000, 40);
  assert.equal(wavDuration(wav), 2);
});

const SAMPLE_A = `Мы привыкли думать, что древние люди жили недолго. Но это не совсем так. Если человек переживал детство, у него были неплохие шансы дожить до шестидесяти. Смотрите сами. Скелеты из неолита часто принадлежат людям среднего возраста. Почему же миф живёт? Всё дело в детской смертности. Она тянула среднюю цифру вниз.

И вот тут начинается самое интересное. Археологи находят зажившие переломы. Значит, о раненом кто-то заботился неделями. Кормил, носил воду, защищал. Мы называем это просто: забота. Без неё племя бы не выжило.`;
const SAMPLE_B = `Мы снова в каменном веке. Представьте холодную пещеру и запах дыма. Но давайте без романтики. Жизнь была тяжёлой, и каждый день решал всё. Смотрите, что говорят находки. Кости животных лежат слоями, и по ним видно, что охотились сезонно. А зимой голодали.

И вот что важно. Люди умели делиться. Мы видим это по стоянкам: еду приносили к общему очагу. Почему? Потому что в одиночку зиму не пережить. Забота была не добродетелью, а способом выжить.`;

test("голос канала: паспорт считается без нейросети", () => {
  const p = analyzeVoice([SAMPLE_A, SAMPLE_B], "ru");
  assert.equal(p.samples, 2);
  assert.ok(p.avgSentence > 4 && p.avgSentence < 14, String(p.avgSentence));
  assert.equal(p.address, "my", "автор говорит «мы»");
  assert.ok(p.questionPct > 5);
  assert.ok(p.openers.some((o) => o.w === "и" || o.w === "мы"));
  assert.ok(p.examples.length >= 2);
  const txt = passportPrompt(p);
  assert.match(txt, /CHANNEL VOICE PASSPORT/);
  assert.match(txt, /inclusive/);
});

test("голос канала: включается только при наличии образцов и для своего языка", async () => {
  const v = await saveVoiceProfile({ enabled: true, language: "ru", samples: [{ title: "A", text: SAMPLE_A }, { title: "B", text: SAMPLE_B }] });
  assert.equal(v.enabled, true);
  assert.match(await activeVoicePrompt("ru"), /PASSPORT/);
  assert.equal(await activeVoicePrompt("en"), "");
  await assert.rejects(saveVoiceProfile({ samples: [{ text: "коротко" }] }));
  const off = await saveVoiceProfile({ enabled: false });
  assert.equal(await activeVoicePrompt("ru"), ""); assert.equal(off.samples.length, 2);
});

test("календарь: запись и экспорт .ics с напоминанием", async () => {
  await addCalendar({ date: "2026-11-03", time: "17:00", title: "Римский бетон; часть 1, черновик", format: "long", remindDays: 2 });
  await addCalendar({ date: "2026-11-01", title: "Shorts: зубы викингов", format: "short", status: "published" });
  const all = await listCalendar();
  assert.equal(all[0].title, "Shorts: зубы викингов", "сортировка по дате");
  const ics = await calendarIcs();
  assert.match(ics, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;TZID=Europe\/Moscow:20261103T170000/);
  assert.match(ics, /SUMMARY:▶ Римский бетон\\; часть 1\\, черновик/);
  assert.match(ics, /TRIGGER:-P2D/);
  assert.equal((ics.match(/BEGIN:VALARM/g) ?? []).length, 1, "у опубликованного нет напоминания");
  assert.ok(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75), "строки свернуты по RFC 5545");
  await assert.rejects(addCalendar({ date: "03.11.2026", title: "x" }));
});

test("Prompt Studio: список, переменные, защита пути", async () => {
  const list = await listPrompts();
  assert.ok(list.length > 20);
  assert.ok(list.find((p) => p.path === "humanizer/rewrite.md")?.title.includes("Живой голос"));
  const f = await readPromptFile("seo/seo.md");
  assert.ok(f.content.length > 100);
  assert.deepEqual(varsOf("{{A}} x {{B}} {{A}}"), ["{{A}}", "{{B}}"]);
  await assert.rejects(readPromptFile("../../package.json"));
  await assert.rejects(readPromptFile("/etc/passwd"));
});
