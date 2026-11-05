// Выпуск 1: профили каналов — у каждого своя ниша, язык, длина, образцы, голос, модели и бюджет.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ts-channels-"));
process.env.DATA_DIR = dir;
const { config } = await import("../src/config.js");
config.dataDir = dir;
const ch = await import("../src/services/studio/channels.js");
after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

test("создание: значения по умолчанию, первый канал становится активным", async () => {
  const a = await ch.createChannel({ name: "Психология", language: "en" });
  assert.equal(a.radar.maxSubs, 60_000);
  assert.equal(a.radar.minMultiplier, 3);
  assert.equal(a.radar.maxQueries, 40);
  assert.equal(a.voice.provider, "none");
  assert.equal(a.lengthMin, 10);
  assert.equal((await ch.activeChannel())?.id, a.id);
  const b = await ch.createChannel({ name: "История", language: "ru", lengthMin: 20 });
  assert.equal((await ch.activeChannel())?.id, a.id, "второй канал не перехватывает активный");
  await ch.activateChannel(b.id);
  assert.equal((await ch.activeChannel())?.id, b.id);
});

test("изменение: вложенные настройки сливаются, лишние поля и неверный язык отклоняются", async () => {
  const { channels } = await ch.listChannels();
  const a = channels.find((c) => c.name === "Психология")!;
  const u = await ch.updateChannel(a.id, { radar: { seeds: ["dark psychology"] }, voice: { voiceId: "v1" } });
  assert.deepEqual(u.radar.seeds, ["dark psychology"]);
  assert.equal(u.radar.maxSubs, 60_000, "остальные настройки Радара сохранились");
  assert.equal(u.voice.voiceId, "v1");
  assert.equal(u.createdAt, a.createdAt);
  await assert.rejects(ch.updateChannel(a.id, { language: "Русский" }));
  await assert.rejects(ch.updateChannel(a.id, { radar: { unknown: 1 } }));
  await assert.rejects(ch.createChannel({ name: "" }));
  await assert.rejects(ch.getChannel("nope"), { status: 404 });
});

test("архив: канал уходит из списка, активным становится другой; возврат из архива", async () => {
  const { channels } = await ch.listChannels();
  const b = channels.find((c) => c.name === "История")!;
  await ch.archiveChannel(b.id);
  assert.ok(!(await ch.listChannels()).channels.some((c) => c.id === b.id));
  assert.ok((await ch.listChannels({ archived: true })).channels.some((c) => c.id === b.id && c.archived));
  assert.notEqual((await ch.activeChannel())?.id, b.id);
  await assert.rejects(ch.activateChannel(b.id), { status: 404 });
  await ch.archiveChannel(b.id, false);
  assert.ok((await ch.listChannels()).channels.some((c) => c.id === b.id && !c.archived));
});

test("повреждённая запись канала пропускается, остальные читаются; файл с резервной копией", async () => {
  const file = path.join(dir, "studio", "channels.json");
  const raw = JSON.parse(await fs.readFile(file, "utf8"));
  raw.channels.push({ id: "broken", name: 42 });
  await fs.writeFile(file, JSON.stringify(raw));
  const { channels } = await ch.listChannels({ archived: true });
  assert.equal(channels.length, 2);
  await ch.createChannel({ name: "Третий" });
  await fs.access(`${file}.bak`);
});

test("расход по каналам и своя часть бюджета", async () => {
  const c = await ch.createChannel({ name: "С бюджетом", budgetUsd: 0.5 });
  await ch.assertChannelBudget(c.id); // ничего не потрачено
  await ch.linkJobToChannel("job-1", c.id, "script");
  const { capturePrice } = await import("../src/services/usagePricing.js");
  const { recordOperation } = await import("../src/services/usage.js");
  const { updateSettings } = await import("../src/services/settings.js");
  await updateSettings({ budget: { prices: [{ match: "same", input: 1, output: 2, image: 0.25 }] } });
  await recordOperation(await capturePrice("anthropic", "same", "text"), { input: 400_000, output: 0, known: true }, "job-1");
  assert.equal((await ch.channelSpend())[c.id].usd, 0.4);
  await ch.assertChannelBudget(c.id);
  await recordOperation(await capturePrice("anthropic", "same", "text"), { input: 200_000, output: 0, known: true }, "job-1");
  const spend = (await ch.channelSpend())[c.id];
  assert.equal(spend.operations, 2);
  await assert.rejects(ch.assertChannelBudget(c.id), (e: any) => e.code === "BUDGET_LIMIT" && /С бюджетом/.test(e.message));
  // Без своей части бюджета — без отдельного лимита
  const free = await ch.createChannel({ name: "Без лимита" });
  await ch.linkJobToChannel("job-2", free.id, "script");
  await ch.assertChannelBudget(free.id);
});
