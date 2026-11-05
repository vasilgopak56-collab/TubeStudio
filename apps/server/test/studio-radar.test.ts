// Выпуск 1: Радар «Идеи для канала» на поддельном YouTube (без сети, без ИИ-провайдера).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fakeFetcher, uc, vid, type World, type FV, type FC } from "./helpers/fakeYoutube.js";
import type { RadarAi, RadarStore } from "../src/services/studio/radar.js";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ts-radar-"));
process.env.DATA_DIR = dir;
const { config } = await import("../src/config.js");
config.dataDir = dir;
for (const k of ["youtube", "youtube2", "youtube3"] as const) (config.keys as Record<string, string | undefined>)[k] = "";
const { setYtFetcher } = await import("../src/services/studio/ytweb.js");
const radar = await import("../src/services/studio/radar.js");
const channels = await import("../src/services/studio/channels.js");
const { getProject } = await import("../src/services/projects.js");
const storage = await import("../src/lib/storage.js");
radar.COOLDOWN.ms = 20;
after(async () => { setYtFetcher(null); await fs.rm(dir, { recursive: true, force: true }); });

const ctx = { progress: () => {}, partial: () => {} };
const fv = (tag: string, ch: string, chName: string, views: number, title: string, len = "20:00", age = "3 weeks ago", verified?: boolean): FV => ({ id: vid(tag), title, ch, chName, views, len, age, verified });
const OWN = uc("own");
const V = {
  small1: fv("small1", uc("small1"), "Quiet Mind", 250_000, "The Dark Psychology of Silent People"),
  small1b: fv("small1b", uc("small1"), "Quiet Mind", 9_000, "Why Silent People Win Arguments", "18:00", "2 weeks ago"),
  big: fv("big", uc("big"), "Mega Psych", 3_000_000, "Dark Psychology Tricks Everyone Uses", "15:00", "1 month ago", true),
  pod: fv("pod", uc("pod"), "Talk Room", 60_000, "Dark psychology with Dr. Smith, full conversation", "45:00", "1 month ago"),
  own: fv("own", OWN, "Our Channel", 100_000, "Dark Psychology Explained"),
  mid: fv("mid", uc("mid"), "Mid Psych", 30_000, "Dark Psychology Basics for Beginners"),
  hindi: fv("hindi", uc("hindi"), "Mann Ki Baat", 120_000, "डार्क साइकोलॉजी के सात नियम जो कोई नहीं बताता"),
  ambient: fv("amb", uc("amb"), "Calm Waves", 400_000, "Dark psychology sleep music for deep calm", "3:00:00", "2 weeks ago"),
  small2: fv("small2", uc("small2"), "Fresh Psych", 80_000, "How Quiet People Control a Room", "15:00", "2 months ago"),
  aiOnly: fv("aionly", uc("aionly"), "Mind Sketch", 50_000, "Silent People Psychology Explained", "14:00", "10 days ago"),
};
const ch = (id: string, name: string, subs: number | null, videos: FV[]): FC => ({ id, name, handle: name.replace(/\s/g, ""), subs, videos });
const world = (): World => ({
  search: {
    "dark psychology": [V.small1, V.big, V.pod, V.own, V.mid, V.hindi, V.ambient],
    "dark psychology tricks": [V.big],
    "dark psychology of silent people": [V.small1],
    "silent people psychology": [V.aiOnly],
  },
  channels: [
    ch(uc("small1"), "Quiet Mind", 1_500, [V.small1, V.small1b]),
    ch(uc("big"), "Mega Psych", 2_000_000, [V.big]),
    ch(uc("pod"), "Talk Room", 900, [V.pod]),
    ch(OWN, "Our Channel", 500, [V.own]),
    ch(uc("mid"), "Mid Psych", 20_000, [V.mid]),
    ch(uc("hindi"), "Mann Ki Baat", 700, [V.hindi]),
    ch(uc("amb"), "Calm Waves", 1_000, [V.ambient]),
    ch(uc("small2"), "Fresh Psych", 300, [V.small2]),
    ch(uc("aionly"), "Mind Sketch", 2_000, [V.aiOnly]),
  ],
  related: { [V.small1.id]: [V.small2, V.big] },
  suggest: { "dark psychology": ["dark psychology tricks", "dark psychology audiobook", "dark psychology of silent people"] },
  log: [],
});
const noAi: RadarAi = {
  ready: async () => false,
  queries: async () => { throw new Error("не должен вызываться"); },
  typeCheck: async () => { throw new Error("не должен вызываться"); },
  versions: async () => { throw new Error("не должен вызываться"); },
};
const profile = (name: string, extra: Record<string, unknown> = {}) => channels.createChannel({
  name, language: "en", niche: "dark psychology", lengthMin: 12, ownChannel: `https://www.youtube.com/channel/${OWN}`,
  radar: { seeds: ["dark psychology"], maxQueries: 12 }, ...extra,
});

test("без ИИ: маленькие каналы с роликом «выше канала»; большой, свой, чужой язык и фон на 3 часа — нет", async () => {
  const w = world();
  setYtFetcher(fakeFetcher(w));
  const c = await profile("Без ИИ");
  const sum = await radar.runRadar(c.id, ctx, noAi);
  assert.ok(sum.notes.some((n) => n.startsWith("ИИ не подключён")));
  assert.equal(sum.stopped, undefined);
  assert.ok(sum.queries.includes("dark psychology tricks"));
  assert.ok(!sum.queries.some((q) => /audiobook/.test(q)), "подсказка про аудиокнигу должна быть отброшена");
  const list = await radar.listIdeas(c.id);
  const ids = list.ideas.map((x) => x.videoId);
  assert.ok(ids.includes(V.small1.id), "Quiet Mind");
  assert.ok(ids.includes(V.small2.id), "Fresh Psych (из «похожих»)");
  for (const bad of [V.big, V.own, V.mid, V.hindi, V.ambient]) assert.ok(!ids.includes(bad.id), bad.chName);
  const s1 = list.ideas.find((x) => x.videoId === V.small1.id)!;
  assert.equal(s1.channel.subs, 1500);
  assert.equal(s1.multiplier, 166.7);
  assert.equal(s1.channel.firstLongExact, true);
  assert.ok(Math.abs((s1.channel.firstLongAgeDays ?? 0) - 21) < 0.1);
  assert.ok(s1.foundBy.some((f) => f.startsWith("поиск")));
  // Большой канал с галочкой и ролик на хинди не открывали (экономия запросов)
  const store = await radar.loadRadar(c.id);
  assert.equal(store.channels[uc("big")].checkedAt, undefined);
  assert.equal(store.channels[uc("hindi")]?.checkedAt, undefined);
  assert.equal(store.runs.length, 1);
});

test("пороги меняются без нового прогона; сортировки и «за месяц»", async () => {
  const c = (await channels.listChannels()).channels.find((x) => x.name === "Без ИИ")!;
  const s = await radar.loadRadar(c.id);
  assert.ok(radar.rankIdeas(s, c).some((x) => x.videoId === V.small1.id));
  const strict = await channels.updateChannel(c.id, { radar: { maxSubs: 1000 } });
  assert.ok(!radar.rankIdeas(s, strict).some((x) => x.videoId === V.small1.id), "1 500 подписчиков > порога 1 000");
  const loose = await channels.updateChannel(c.id, { radar: { maxSubs: 60_000, minMultiplier: 1 } });
  assert.ok(radar.rankIdeas(s, loose).some((x) => x.videoId === V.mid.id), "множитель 1,5 проходит при пороге 1");
  await channels.updateChannel(c.id, { radar: { minMultiplier: 3 } });
  const byViews = radar.rankIdeas(s, c, { sort: "views" });
  assert.deepEqual(byViews.map((x) => x.views), [...byViews.map((x) => x.views)].sort((a, b) => b - a));
  const month = radar.rankIdeas(s, c, { period: "month" }).map((x) => x.videoId);
  assert.ok(month.includes(V.small1.id) && !month.includes(V.small2.id), "ролику Fresh Psych 2 месяца");
});

test("скрыть / вернуть / взять идею в проект", async () => {
  const c = (await channels.listChannels()).channels.find((x) => x.name === "Без ИИ")!;
  await radar.setIdeaStatus(c.id, V.small1.id, "hidden");
  let list = await radar.listIdeas(c.id);
  assert.ok(!list.ideas.some((x) => x.videoId === V.small1.id));
  assert.equal(list.counts.hidden, 1);
  assert.ok((await radar.listIdeas(c.id, { show: "hidden" })).ideas.some((x) => x.videoId === V.small1.id));
  await radar.setIdeaStatus(c.id, V.small1.id, "new");
  const taken = await radar.takeIdea(c.id, V.small1.id);
  assert.equal(taken.existed, false);
  const p = await getProject(taken.projectId);
  assert.equal(p.channelId, c.id);
  const topic = p.artifacts.find((a) => a.kind === "topic")!;
  assert.equal((topic.data as { source: string }).source, "radar");
  assert.equal((topic.data as { url: string }).url, `https://www.youtube.com/watch?v=${V.small1.id}`);
  assert.deepEqual(await radar.takeIdea(c.id, V.small1.id), { projectId: taken.projectId, existed: true });
  await assert.rejects(radar.setIdeaStatus(c.id, V.small1.id, "hidden"), { status: 400 });
  list = await radar.listIdeas(c.id);
  assert.equal(list.counts.taken, 1);
  await assert.rejects(radar.setIdeaStatus(c.id, "nonexistent1", "hidden"), { status: 404 });
});

test("повторный прогон: RSS не отвечает → новые ролики найденных каналов берутся со страниц", async () => {
  const w = world();
  setYtFetcher(fakeFetcher(w));
  const c = (await channels.listChannels()).channels.find((x) => x.name === "Без ИИ")!;
  // Неделю спустя: каналы пора проверить снова
  const file = `studio/radar/${c.id}.json`;
  const s = await storage.readJson<RadarStore>(file, null as never);
  const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
  for (const x of Object.values(s.channels)) if (x.checkedAt) x.checkedAt = old;
  await storage.writeJson(file, s);
  const sum = await radar.runRadar(c.id, ctx, noAi);
  assert.ok(sum.notes.some((n) => n.startsWith("RSS-ленты YouTube не отвечают")), sum.notes.join(" | "));
  assert.ok(w.log.some((u) => u.includes("/feeds/videos.xml")));
  assert.equal((await radar.loadRadar(c.id)).runs.length, 2);
});

test("с ИИ: «тот же тип» отсеивает подкаст, «ваша версия» пишется, запросы ИИ используются", async () => {
  const w = world();
  setYtFetcher(fakeFetcher(w));
  const c = await profile("С ИИ", { samples: [] });
  const calls = { queries: 0, typeCheck: 0, versions: 0, thumbs: 0 };
  const ai: RadarAi = {
    ready: async () => true,
    queries: async () => { calls.queries++; return ["silent people psychology"]; },
    typeCheck: async (_ch, _sample, batch) => {
      calls.typeCheck++; calls.thumbs += batch.filter((b) => b.thumb).length;
      return batch.map((b) => ({ channelId: b.channelId, verdict: b.name === "Talk Room" ? "no" as const : "yes" as const, format: b.name === "Talk Room" ? "подкаст" : "объяснение с рисунками", reason: "тест", model: "fake" }));
    },
    versions: async (_ch, items) => { calls.versions++; return items.map((x) => ({ videoId: x.videoId, title: `Наша версия: ${x.title}`, angle: "Тот же вопрос, наш угол.", model: "fake" })); },
  };
  const sum = await radar.runRadar(c.id, ctx, ai);
  assert.ok(sum.queries.includes("silent people psychology"));
  assert.ok(calls.typeCheck >= 1 && calls.versions === 1 && calls.thumbs >= 1, JSON.stringify(calls));
  const list = await radar.listIdeas(c.id);
  assert.ok(!list.ideas.some((x) => x.channel.name === "Talk Room"), "подкаст не должен быть в активных");
  assert.ok((await radar.listIdeas(c.id, { show: "rejected" })).ideas.some((x) => x.channel.name === "Talk Room"));
  const s1 = list.ideas.find((x) => x.videoId === V.small1.id)!;
  assert.equal(s1.channel.type, "yes");
  assert.equal(s1.channel.format, "объяснение с рисунками");
  assert.match(s1.version?.title ?? "", /^Наша версия/);
  assert.ok(list.ideas.some((x) => x.videoId === V.aiOnly.id), "ролик из запроса ИИ");
  assert.ok(!list.ideas.some((x) => x.videoId === V.small1b.id), "9 тыс. просмотров — ниже порога 10 тыс.");
});

test("ошибка ИИ не останавливает Радар; бюджет канала исчерпан — шаги ИИ пропущены", async () => {
  setYtFetcher(fakeFetcher(world()));
  const c = await profile("ИИ падает");
  const broken: RadarAi = {
    ready: async () => true,
    queries: async () => { throw new Error("сеть недоступна"); },
    typeCheck: async () => { throw new Error("сеть недоступна"); },
    versions: async () => { throw new Error("сеть недоступна"); },
  };
  const sum = await radar.runRadar(c.id, ctx, broken);
  assert.ok(sum.notes.some((n) => n.startsWith("Запросы от ИИ: ошибка ИИ")), sum.notes.join(" | "));
  assert.ok(sum.ideas >= 2);
  // Своя часть бюджета канала: $1 из $1 уже потрачен
  const b = await profile("Бюджет", { budgetUsd: 1 });
  await channels.linkJobToChannel("job-budget", b.id, "radar");
  const { capturePrice } = await import("../src/services/usagePricing.js");
  const { recordOperation } = await import("../src/services/usage.js");
  const { updateSettings } = await import("../src/services/settings.js");
  await updateSettings({ budget: { prices: [{ match: "same", input: 1, output: 2, image: 0.25 }] } });
  assert.equal(await recordOperation(await capturePrice("anthropic", "same", "text"), { input: 1e6, output: 100, known: true }, "job-budget"), true);
  assert.ok(((await channels.channelSpend())[b.id]?.usd ?? 0) >= 1);
  await assert.rejects(channels.assertChannelBudget(b.id), { code: "BUDGET_LIMIT" });
  const sum2 = await radar.runRadar(b.id, ctx, broken);
  assert.ok(sum2.notes.some((n) => n.startsWith("Шаги ИИ пропущены")), sum2.notes.join(" | "));
  assert.ok(!sum2.notes.some((n) => n.includes("ошибка ИИ")), "шаги ИИ не должны были запускаться");
});

test("YouTube ограничил запросы: две паузы, потом остановка с сохранением найденного", async () => {
  const w = world();
  w.limited = (u) => u.includes("/results");
  setYtFetcher(fakeFetcher(w));
  const c = await profile("Лимит");
  const sum = await radar.runRadar(c.id, ctx, noAi);
  assert.match(sum.stopped ?? "", /временно ограничил/);
  assert.equal(sum.stats.pauses, 2);
  assert.equal((await radar.loadRadar(c.id)).runs.length, 1);
});

test("второй прогон того же канала, пока идёт первый, — отказ; пустой профиль — понятная ошибка", async () => {
  setYtFetcher(fakeFetcher(world()));
  const c = await profile("Параллельно");
  const first = radar.runRadar(c.id, ctx, noAi);
  await assert.rejects(radar.runRadar(c.id, ctx, noAi), { status: 409 });
  await first;
  const emptyProfile = await channels.createChannel({ name: "Пусто", language: "en" });
  await assert.rejects(radar.runRadar(emptyProfile.id, ctx, noAi), (e: any) => e.status === 400 && /темы для поиска/.test(e.message));
});

test("ключ образца и запрос из названия", () => {
  assert.equal(radar.sampleKey("https://www.youtube.com/@SquireExplains/videos"), "@SquireExplains");
  assert.equal(radar.sampleKey(`youtube.com/channel/${uc("abc")}`), uc("abc"));
  assert.equal(radar.sampleKey("SquireExplains"), "@SquireExplains");
  assert.equal(radar.sampleKey("https://example.com/a b"), null);
  assert.equal(radar.titleQuery("The Psychology of Becoming Untouchable | Chase Hughes"), "The Psychology of Becoming Untouchable");
  assert.equal(radar.titleQuery("🔥 #shorts"), null);
  assert.equal(radar.scriptMatches("डार्क साइकोलॉजी | dark psychology facts and tips", "en"), false);
  assert.equal(radar.scriptMatches("Тёмная психология | dark psychology", "ru"), true);
  assert.equal(radar.scriptMatches("Dark psychology", "ru"), false);
});
