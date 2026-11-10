// Выпуск 4, шаг 2: платный запрос текстов. Сеть подменена: настоящих запросов и денег нет, данные во временной папке.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "publish-text-"));
process.env.DATA_DIR = dir; process.env.ENV_FILE = `${dir}/missing`; process.env.ANYMODEL_API_KEY = "fixture-only";
const { updateSettings } = await import("../src/services/settings.js");
const { runTask } = await import("../src/lib/taskContext.js");
const { priceConsents } = await import("../src/services/priceConsent.js");
const { resetAmCatalog } = await import("../src/services/anymodel.js");
const { createChannel } = await import("../src/services/studio/channels.js");
const { publishState, saveVideoLink } = await import("../src/services/studio/publishCard.js");
const { listLinks } = await import("../src/services/ytAnalytics.js");
const { chapterSegments, consentMessage, runPublishText } = await import("../src/services/studio/publishText.js");

const id = "11111111-2222-4333-8444-555555555555", old = "2026-01-01T00:00:00.000Z";
const rows = Array.from({ length: 60 }, (_, i) => ({ n: i + 1, text: `Scene ${i + 1} about the frost`, start: i * 5, end: (i + 1) * 5, seconds: 5, words: 5, paragraph: Math.floor(i / 6), shot: "", concept: "", motion: "", image: "", video: "", animate: false, cast: [], picture: { state: "none", attempts: 0 }, clip: { state: "none", attempts: 0 } }));
let channelId = "";
const ctx = { progress: () => {}, partial: () => {}, signal: new AbortController().signal };
const answer = {
  keyword: "frost", titles: [1, 2, 3, 4, 5].map((n) => ({ title: `Frost story number ${n}`, triggers: ["curiosity"], hookWord: "Frost", why: "w" })),
  description: { hook: ["Line one", "Line two"], body: ["Para one", "Para two"], cta: "Watch more" }, hashtags: ["#frost", "#history", "#winter"],
  primaryTags: ["frost", "winter", "river"], secondaryTags: ["ice", "cold", "history"], longTail: ["the great frost", "frozen river"],
  pinnedComments: ["controversial", "sensory", "challenge"].map((type) => ({ type, text: `Comment of ${type}` })),
  chapters: ["First part", "Second part", "Third part"],
};
const original = globalThis.fetch;
let posts: string[] = [], reply: () => Response | Promise<Response>;
const ok = (o: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(o) } }], usage: { prompt_tokens: 2, completion_tokens: 1 } });

async function seed(accepted = true) {
  const board = { source: "studio-visual", schema: 1, channelId, projectId: id, textHash: "x", language: "en", timing: "audio", matched: 60, mode: "sentence", maxSec: 8, rows, createdAt: old, updatedAt: old, style: {}, input: {} };
  const project = { id, title: "T", channelId, createdAt: old, updatedAt: old, artifacts: [{ id: "a1", kind: "script", title: "s", createdAt: old, data: { script: "Words of the script. ".repeat(40) } }, { id: "a2", kind: "storyboard", title: "b", createdAt: old, data: board }] };
  await fs.rm(path.join(dir, "files", id), { recursive: true, force: true });
  await fs.mkdir(path.join(dir, "projects"), { recursive: true });
  await fs.writeFile(path.join(dir, "projects", `${id}.json`), JSON.stringify(project));
  const m = path.join(dir, "files", id, "montage");
  await fs.mkdir(m, { recursive: true });
  await fs.writeFile(path.join(m, "a.mp4"), "x");
  await fs.writeFile(path.join(m, "draft.json"), JSON.stringify({ file: "montage/a.mp4", at: new Date().toISOString(), seconds: 300, width: 1920, height: 1080, bytes: 10, parts: 1, reused: 0, lufs: -14, peak: -1, music: 0 }));
  if (accepted) await fs.writeFile(path.join(m, "accepted.json"), JSON.stringify({ file: "montage/a.mp4", at: old }));
}
function run(decision: "approve" | "deny" | null, seen?: string[]) {
  const owner = randomUUID();
  const launch = decision ? { launch: { owner, requestId: randomUUID(), route: "/api/studio/publish/projects/x/seo" } } : {};
  return runTask({ ...launch, onPriceConsent: (c) => { seen?.push(c.message); priceConsents.decide(owner, c.id, c.scopeHash, decision!); } }, () => runPublishText(id, { channelId }, ctx));
}
const code = (c: string) => (e: { code?: string }) => e.code === c;

before(async () => {
  await updateSettings({ budget: { mode: "warn" }, anymodel: { enabled: true, priority: "first", text: "fixture-text", textAlt: "fixture-alt", script: "fixture-script" } } as never);
  channelId = (await createChannel({ name: "Test", niche: "history", language: "en" })).id;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (String(url).endsWith("/models")) return Response.json({ data: ["fixture-text", "fixture-alt"].map((m) => ({ id: m, billing: { unit: "token", coefficient: { input: 1, output: 1 } } })) });
    posts.push(JSON.parse(String(init?.body)).model);
    return reply();
  }) as typeof fetch;
});
beforeEach(async () => { posts = []; resetAmCatalog(); reply = () => ok(answer); await seed(); });
after(async () => {
  globalThis.fetch = original;
  const { flushLogs } = await import("../src/lib/logging.js"); await flushLogs();
  await fs.rm(dir, { recursive: true, force: true });
});

test("без подтверждения запрос не уходит", async () => {
  await assert.rejects(run("deny"), code("BUDGET_CONSENT_DENIED"));
  assert.deepEqual(posts, []);
  assert.equal((await publishState(id)).proposal, null);
});

test("без запуска из интерфейса запрос не уходит", async () => {
  await assert.rejects(run(null), code("BUDGET_CONSENT_REQUIRED"));
  assert.deepEqual(posts, []);
});

test("после подтверждения ровно один запрос к выбранной модели, ориентир цены виден заранее", async () => {
  const messages: string[] = [];
  await run("approve", messages);
  assert.deepEqual(posts, ["fixture-text"]);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /fixture-text/);
  assert.match(messages[0], /Ориентир цены: примерно \$/);
});

test("предложение сохраняется, а карточка автора не меняется", async () => {
  await run("approve");
  const s = await publishState(id);
  assert.equal(s.proposal?.titles.length, 5);
  assert.ok(s.proposal?.description.startsWith("Line one\nLine two"));
  assert.ok(!s.proposal?.description.includes("Chapters"), "главы добавляются по монтажу, а не из текста модели");
  assert.deepEqual(s.proposal?.chapters.map((c) => c.title), ["First part", "Second part", "Third part"]);
  assert.deepEqual(s.proposal?.chapters.map((c) => c.scene), s.chapters.map((c) => c.scene));
  assert.equal(s.card.title, null);
  assert.equal(s.card.description, null);
  assert.ok(s.chapters.every((c) => c.title === ""));
});

test("неверный ответ модели не повторяется автоматически", async () => {
  reply = () => ok({ wrong: true });
  await assert.rejects(run("approve"), code("LLM_INVALID_JSON"));
  assert.equal(posts.length, 1);
  assert.equal((await publishState(id)).proposal, null);
});

test("сбой сети не повторяется и не уходит на другую модель", async () => {
  reply = () => { throw new TypeError("socket hang up"); };
  await assert.rejects(run("approve"));
  assert.deepEqual(posts, ["fixture-text"]);
});

test("ошибка сервиса не запускает резервную модель", async () => {
  reply = () => Response.json({ error: { message: "synthetic" } }, { status: 500 });
  await assert.rejects(run("approve"));
  assert.deepEqual(posts, ["fixture-text"]);
});

test("без принятого ролика запрос не уходит", async () => {
  await seed(false);
  await assert.rejects(run("approve"), /примите ролик/);
  assert.deepEqual(posts, []);
});

test("ссылка на ролик связывает его с проектом, замена и удаление убирают прежнюю связь", async () => {
  const first = "aaaaaaaaaaa", second = "bbbbbbbbbbb";
  assert.equal((await saveVideoLink(id, { url: `https://youtu.be/${first}` })).card.video?.id, first);
  assert.equal((await listLinks())[first], id);
  const again = await saveVideoLink(id, { url: `https://www.youtube.com/watch?v=${second}` });
  assert.equal(again.card.video?.id, second);
  const links = await listLinks();
  assert.equal(links[first], undefined, "прежний ролик больше не связан");
  assert.equal(links[second], id);
  assert.equal((await saveVideoLink(id, { url: null })).card.video, null);
  assert.equal((await listLinks())[second], undefined);
  assert.deepEqual(posts, [], "сеть не используется");
});

test("неверная ссылка ничего не меняет", async () => {
  await saveVideoLink(id, { url: "ccccccccccc" });
  await assert.rejects(async () => saveVideoLink(id, { url: "https://example.com/video" }), /не похоже на ссылку/);
  assert.equal((await publishState(id)).card.video?.id, "ccccccccccc");
  assert.equal((await listLinks()).ccccccccccc, id);
  await saveVideoLink(id, { url: null });
});

test("текст подтверждения честно говорит о неизвестной цене", () => {
  assert.match(consentMessage("m", null), /Цена этой модели неизвестна/);
  assert.match(consentMessage("m", 0.1234), /\$0\.12/);
  assert.match(consentMessage("m", 0.001), /\$0\.01/);
});

test("текст главы берётся из её сцен", () => {
  const r = [{ n: 1, start: 0, paragraph: 0, text: "a" }, { n: 2, start: 30, paragraph: 0, text: "b" }, { n: 3, start: 70, paragraph: 1, text: "c" }];
  assert.deepEqual(chapterSegments(r, [{ scene: 1, start: 0, excerpt: "", title: "" }, { scene: 3, start: 70, excerpt: "", title: "" }]), [{ time: "00:00", text: "a b" }, { time: "01:10", text: "c" }]);
});
