// Выпуск 1.1: проверка фактов готового сценария — разбор на предложения, вердикты, исправления кодом,
// источники только из выдачи поиска, переход на проверку моделью, отпечаток текста, маршрут с проектом.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ts-studio-facts-"));
process.env.DATA_DIR = dir;
const { config } = await import("../src/config.js");
config.dataDir = dir;
const { ApiError } = await import("../src/lib/errors.js");
const F = await import("../src/services/studio/factCheck.js");
const { lintScript } = await import("../src/services/studio/scriptLint.js");
const web = await import("../../web/src/features/studio/factHash.js");
const { StudioScriptInput } = await import("../src/services/studio/scriptFlow.js");
after(async () => { F.setFactAi(null); await fs.rm(dir, { recursive: true, force: true }); });

const SHIELDS = await fs.readFile(path.join(import.meta.dirname, "fixtures/scripts/shields-v1.txt"), "utf8");
const ctx = () => { const stages: number[] = []; return { stages, c: { progress: (_: string, pct: number) => { stages.push(pct); }, partial: () => {}, signal: new AbortController().signal } }; };
const { createChannel } = await import("../src/services/studio/channels.js");
const CH = await createChannel({ name: "Facts", language: "en" });
type Ai = Parameters<typeof F.setFactAi>[0];
const fake = (o: Partial<NonNullable<Ai>>): NonNullable<Ai> => ({
  extract: async () => ({ items: [], model: "fake-extract" }),
  verifyWeb: async () => ({ items: [], model: "fake-web", sources: [] }),
  verifyModel: async () => ({ items: [], model: "fake-model", sources: [] }),
  ...o,
});

const TEXT = [
  "The Great Wall of China is visible from space with the naked eye. It was built over many centuries.",
  "In 1969, Neil Armstrong walked on the Moon. Imagine you are standing next to him. Dr. Smith claims that 90 percent of people never look up.",
  "What would you do? Tell me in the comments.",
].join("\n\n");

test("разбор на предложения: текст собирается обратно без изменений, нумерация абзацев как у проверки кодом", () => {
  for (const t of [SHIELDS, TEXT, "\n\nOne. Two.\n\n\nThree!\n", "Line one. Still one.\nLine two.\nLine three?", "He said \"Go.\" Then he left. «Да.» Потом ушёл.", "A\r\n\r\nB. C."]) {
    const doc = F.splitScript(t);
    assert.equal(F.joinScript(doc), t.replace(/\r\n?/g, "\n"));
  }
  const doc = F.splitScript(SHIELDS), lint = lintScript(SHIELDS, { language: "en" });
  assert.equal(doc.blocks.filter((b) => b.n).length, lint.paragraphs);
  const d2 = F.splitScript(TEXT);
  assert.deepEqual(d2.blocks[1].sents.map((s) => s.id), ["2.1", "2.2", "2.3"], "«Dr. Smith» не режет предложение");
  assert.equal(d2.blocks[1].sents[2].text, "Dr. Smith claims that 90 percent of people never look up.");
});

test("отпечаток текста: одинаковый на сервере и в интерфейсе, не зависит от пробелов, меняется от правки", () => {
  for (const t of [SHIELDS, TEXT, "", "Привет, мир.  Ещё\r\nстрока"]) assert.equal(F.textHash(t), web.textHash(t));
  assert.equal(F.textHash("A  b.\n\nC."), F.textHash("A b. C."));
  assert.notEqual(F.textHash(TEXT), F.textHash(TEXT.replace("1969", "1970")));
  const r = { hash: F.textHash(TEXT), passed: true };
  assert.equal(F.factStatus(TEXT, r), "passed");
  assert.equal(web.factStatus(TEXT, r), "passed");
  assert.equal(F.factStatus(TEXT + " New.", r), "stale");
  assert.equal(F.factStatus(TEXT, { ...r, passed: false }), "issues");
  assert.equal(F.factStatus(TEXT, null), "none");
  assert.equal(StudioScriptInput.parse({ channelId: CH.id, topic: "Тема ролика" }).factCheck, true, "проверка фактов включена по умолчанию");
});

test("исправления: неверное заменено, непроверяемое убрано, два утверждения в предложении, выдуманный источник отброшен", async () => {
  let batches = 0;
  F.setFactAi(fake({
    extract: async () => ({ model: "fake-extract", items: [
      { id: "1.1", claims: [{ text: "Великую Китайскую стену видно из космоса невооружённым глазом", kind: "science" }] },
      { id: "1.2", claims: [{ text: "Стену строили много веков", kind: "history" }] },
      { id: "2.1", claims: [{ text: "Армстронг ступил на Луну в 1969 году", kind: "date" }, { text: "Армстронг ходил по Луне", kind: "name" }] },
      { id: "2.3", claims: [{ text: "90% людей никогда не смотрят вверх", kind: "number" }] },
      { id: "9.9", claims: [{ text: "несуществующее предложение", kind: "other" }] },
    ] }),
    verifyWeb: async ({ batch }) => {
      batches++;
      assert.deepEqual(batch.map((x) => x.id), ["1.1", "1.2", "2.1", "2.3"]);
      assert.equal(batch[1].context, "The Great Wall of China is visible from space with the naked eye.", "контекст — предыдущее предложение");
      return { model: "ag/gemini-3-flash", sources: [{ title: "nasa.gov", url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc" }, { title: "Great Wall — Britannica", url: "https://www.britannica.com/topic/Great-Wall-of-China" }], items: [
        { id: "1.1", claims: [{ verdict: "false", why: "Миф: стену не видно невооружённым глазом с орбиты." }], fix: "Despite the popular myth, the Great Wall of China is not visible from space with the naked eye.", sources: ["https://www.nasa.gov/image-article/great-wall/", "https://invented-source.example/fake"] },
        { id: "1.2", claims: [{ verdict: "true", why: "Строилась с VII века до н. э. по XVII век." }], fix: null, sources: ["https://www.britannica.com/topic/Great-Wall-of-China"] },
        { id: "2.1", claims: [{ verdict: "true", why: "20 июля 1969 года." }, { verdict: "true", why: "Подтверждено NASA." }], fix: null, sources: [] },
        { id: "2.3", claims: [{ verdict: "unverified", why: "Такого исследования не найдено." }], fix: "", sources: [] },
      ] };
    },
  }));
  const { c, stages } = ctx();
  const r = await F.checkFacts({ text: TEXT, channel: CH, topic: "Space myths", model: "cc/claude-sonnet-5" }, c);
  assert.equal(batches, 1);
  assert.equal(r.script, [
    "Despite the popular myth, the Great Wall of China is not visible from space with the naked eye. It was built over many centuries.",
    "In 1969, Neil Armstrong walked on the Moon. Imagine you are standing next to him.",
    "What would you do? Tell me in the comments.",
  ].join("\n\n"));
  const rep = r.report;
  assert.deepEqual(rep.summary, { total: 5, true: 3, false: 1, misleading: 0, unverified: 1 });
  assert.equal(rep.changed, 1); assert.equal(rep.removed, 1); assert.equal(rep.remaining, 0);
  assert.equal(rep.passed, true); assert.equal(rep.mode, "web"); assert.equal(rep.checked, 4);
  assert.deepEqual(rep.models, ["fake-extract", "ag/gemini-3-flash"]);
  const wall = rep.items.find((x) => x.id === "1.1")!;
  assert.equal(wall.verdict, "false"); assert.equal(wall.applied, true); assert.equal(wall.paragraph, 1); assert.equal(wall.at, "0:00");
  assert.equal(wall.quote, "The Great Wall of China is visible from space with the naked eye.");
  assert.deepEqual(wall.sources, [{ title: "nasa.gov", url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc" }], "ссылка не из выдачи поиска отброшена");
  assert.equal(rep.items.find((x) => x.id === "2.3")!.fix, "");
  assert.equal(rep.items.find((x) => x.id === "2.1")!.claims.length, 2);
  assert.ok(rep.notes.some((n) => /несуществующих предложений/.test(n)));
  assert.equal(rep.sources.length, 2);
  assert.equal(rep.hash, F.textHash(r.script));
  assert.equal(F.factStatus(r.script, rep), "passed");
  assert.equal(F.factStatus(TEXT, rep), "stale", "исходный текст считается изменённым");
  assert.ok(stages.every((p, i) => i === 0 || p >= stages[i - 1]), "ход работы только растёт");
});

test("поиск недоступен: проверка по знаниям модели, ссылки модели не показываются, отметка в отчёте", async () => {
  let web = 0, model = 0;
  F.setFactAi(fake({
    extract: async () => ({ model: "x", items: [{ id: "2.1", claims: [{ text: "1969", kind: "date" }] }] }),
    verifyWeb: async () => { web++; throw new ApiError("KEY_MISSING", "Нет GEMINI_API_KEY для веб-ресёрча", 400); },
    verifyModel: async ({ batch, model: m }) => { model++; assert.equal(m, "cx/gpt-5.6-terra"); return { model: "cx/gpt-5.6-terra", sources: [], items: batch.map((x) => ({ id: x.id, claims: [{ verdict: "true" as const, why: "Общеизвестно." }], fix: null, sources: ["https://made-up.example"] })) }; },
  }));
  const r = await F.checkFacts({ text: TEXT, channel: CH, topic: "Moon", model: "cx/gpt-5.6-terra" }, ctx().c);
  assert.equal(web, 1); assert.equal(model, 1);
  assert.equal(r.report.mode, "model");
  assert.equal(r.script, TEXT);
  assert.deepEqual(r.report.items[0].sources, []);
  assert.match(r.report.notes[0], /Поиск Google недоступен/);
  assert.equal(r.report.passed, true);
});

test("защита текста: правка не того предложения, слишком длинная правка и пропущенный вердикт не применяются", async () => {
  F.setFactAi(fake({
    extract: async () => ({ model: "x", items: [
      { id: "1.1", claims: [{ text: "стена видна", kind: "science" }] },
      { id: "1.2", claims: [{ text: "много веков", kind: "history" }] },
      { id: "2.3", claims: [{ text: "90%", kind: "number" }] },
    ] }),
    verifyWeb: async () => ({ model: "w", sources: [], items: [
      { id: "1.1", claims: [{ verdict: "misleading", why: "…" }], fix: "Neil Armstrong landed on the Moon together with Buzz Aldrin in July.", sources: [] },
      { id: "1.2", claims: [{ verdict: "false", why: "…" }], fix: "It was built over many centuries. ".repeat(12), sources: [] },
    ] }),
  }));
  const r = await F.checkFacts({ text: TEXT, channel: CH, topic: "t" }, ctx().c);
  assert.equal(r.script, TEXT, "текст не изменён");
  assert.equal(r.report.remaining, 3);
  assert.equal(r.report.passed, false);
  assert.equal(F.factStatus(r.script, r.report), "issues");
  const [a, b, c] = r.report.items;
  assert.match(a.note ?? "", /не похоже/); assert.match(b.note ?? "", /длиннее/);
  assert.equal(c.verdict, "unverified"); assert.equal(c.fix, null);
});

test("длинный сценарий: проверка партиями по 12 предложений, вердикты по своим предложениям", async () => {
  const long = Array.from({ length: 6 }, (_, p) => Array.from({ length: 5 }, (_, s) => `In ${1900 + p * 5 + s} event number ${p * 5 + s} happened in city ${s}.`).join(" ")).join("\n\n");
  const calls: string[][] = [];
  F.setFactAi(fake({
    extract: async () => ({ model: "x", items: F.splitScript(long).blocks.flatMap((b) => b.sents).map((s) => ({ id: s.id, claims: [{ text: s.text, kind: "date" }] })) }),
    verifyWeb: async ({ batch }) => { calls.push(batch.map((x) => x.id)); return { model: "w", sources: [], items: batch.map((x) => ({ id: x.id, claims: [{ verdict: "true" as const, why: "" }], fix: null, sources: [] })) }; },
  }));
  const r = await F.checkFacts({ text: long, channel: CH, topic: "t" }, ctx().c);
  assert.deepEqual(calls.map((x) => x.length), [12, 12, 6]);
  assert.equal(r.report.checked, 30); assert.equal(r.report.summary.true, 30); assert.equal(r.report.passed, true);
  assert.equal(r.report.items[29].paragraph, 6);
});

test("маршрут: проверка фактов сценария проекта сохраняет исправленный текст, отчёт и текст до проверки", async () => {
  const { studioRoute } = await import("../src/routes/studio.js");
  const { getJob } = await import("../src/lib/jobs.js");
  const { createProject, getProject, updateArtifactData } = await import("../src/services/projects.js");
  // Кнопка «Проверить факты» идёт через окно цены: запуск как из интерфейса, «Подтвердить» нажимается автоматически.
  const { Hono } = await import("hono");
  const { priceConsentScope } = await import("../src/routes/priceConsent.js");
  const { priceConsents } = await import("../src/services/priceConsent.js");
  config.keys.anthropic = "fake-factcheck-only";
  const app = new Hono(); app.use("*", priceConsentScope); app.route("/api", studioRoute);
  const owner = crypto.randomUUID(), windows: string[] = [];
  const call = async (method: string, url: string, body?: unknown) => {
    const r = await app.request("/api" + url, { method, headers: { "content-type": "application/json", "x-ts-launch-id": owner }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await r.json() as any;
    const jobId = json?.data?.jobId;
    if (jobId) void (async () => { for (let i = 0; i < 200; i++) { const e = getJob(jobId)?.events.find((x: any) => x.type === "price-consent") as any; if (e) { windows.push(e.consent.message); priceConsents.decide(owner, e.consent.id, e.consent.scopeHash, "approve"); return; } if (getJob(jobId)?.done) return; await new Promise((r) => setTimeout(r, 5)); } })();
    return { status: r.status, json };
  };
  const wait = async (id: string) => { for (let i = 0; i < 200; i++) { const j = getJob(id); if (j?.done) return j.events.at(-1) as any; await new Promise((r) => setTimeout(r, 20)); } throw new Error("задача не закончилась"); };
  const ch = (await call("POST", "/studio/channels", { name: "Space", language: "en" })).json.data;
  const p = await createProject({ title: "Space myths", channelId: ch.id, artifact: { kind: "script", title: "Space myths", data: { script: TEXT, input: { topic: "Space myths" }, studio: { channelId: ch.id, models: { author: "cc/claude-opus-5" } } } } });
  F.setFactAi(fake({
    extract: async () => ({ model: "x", items: [{ id: "2.3", claims: [{ text: "90%", kind: "number" }] }] }),
    verifyWeb: async () => ({ model: "w", sources: [], items: [{ id: "2.3", claims: [{ verdict: "unverified", why: "Нет данных." }], fix: "", sources: [] }] }),
  }));
  assert.equal((await call("POST", "/studio/script/factcheck", { channelId: ch.id })).status, 400, "нужен проект или текст");
  assert.equal((await call("POST", "/studio/script/factcheck", { channelId: ch.id, projectId: p.id, text: TEXT })).status, 400, "не оба сразу");
  assert.equal((await call("POST", "/studio/script/factcheck", { channelId: ch.id, projectId: "missing-project" })).status, 404);
  const start = await call("POST", "/studio/script/factcheck", { channelId: ch.id, projectId: p.id });
  assert.equal(start.status, 200);
  const done = await wait(start.json.data.jobId);
  assert.equal(done.type, "done", JSON.stringify(done));
  assert.equal(done.data.report.removed, 1);
  const saved = (await getProject(p.id)).artifacts[0].data as any;
  assert.ok(!saved.script.includes("90 percent"));
  assert.equal(saved.studio.beforeFacts, TEXT);
  assert.equal(saved.studio.factCheck.hash, F.textHash(saved.script));
  assert.equal(saved.studio.models.author, "cc/claude-opus-5", "прежние данные студии сохранены");
  assert.ok(saved.studio.lint.words > 10);

  // Вставленный текст: результат возвращается, проект не трогается.
  const own = await call("POST", "/studio/script/factcheck", { channelId: ch.id, text: TEXT });
  const ownDone = await wait(own.json.data.jobId);
  assert.equal(ownDone.type, "done");
  assert.ok(!ownDone.data.script.includes("90 percent"));
  assert.equal(ownDone.data.projectId, undefined);

  // Текст поменяли, пока шла проверка: исправления не затирают правку.
  F.setFactAi(fake({
    extract: async () => ({ model: "x", items: [{ id: "1.1", claims: [{ text: "стена", kind: "science" }] }] }),
    verifyWeb: async () => {
      await updateArtifactData(p.id, (await getProject(p.id)).artifacts[0].id, (d: any) => ({ ...d, script: "Совсем другой текст сценария, который автор успел сохранить." }));
      return { model: "w", sources: [], items: [{ id: "1.1", claims: [{ verdict: "false", why: "…" }], fix: "Despite the myth, the Great Wall of China is not visible from space.", sources: [] }] };
    },
  }));
  const race = await call("POST", "/studio/script/factcheck", { channelId: ch.id, projectId: p.id });
  const raceDone = await wait(race.json.data.jobId);
  assert.equal(raceDone.type, "error");
  assert.match(raceDone.error.message, /изменили во время проверки/);
  assert.equal(((await getProject(p.id)).artifacts[0].data as any).script, "Совсем другой текст сценария, который автор успел сохранить.");
  assert.equal(windows.length, 3, "одно окно цены на каждый запуск");
  assert.ok(windows.every((w) => /^Подтвердите проверку фактов: до \d+ запросов/.test(w)));
  config.keys.anthropic = "";
});
