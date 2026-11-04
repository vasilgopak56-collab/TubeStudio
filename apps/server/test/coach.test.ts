import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { JobCtx } from "../src/lib/jobs.js";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ts-coach-"));
process.env.DATA_DIR = dir; process.env.ANTHROPIC_API_KEY = "fake-coach-unit-key";
const { CoachCreate, CoachAsk, buildCoachContext, coachSources, createCoach, loadCoach, listCoach, askCoach: sendCoach, previewCoach, CoachSend, COACH_LIMITS } = await import("../src/services/coach.js");
async function askCoach(input: Parameters<typeof previewCoach>[0], job: JobCtx) {
  if (job.signal.aborted) return sendCoach({ ...input, previewHash: "a".repeat(64) }, job);
  const preview = await previewCoach(input);
  return sendCoach({ ...input, previewHash: preview.hash }, job);
}
const { coachRoute } = await import("../src/routes/coach.js");
const { createProject, addArtifact } = await import("../src/services/projects.js");
const { writeJson } = await import("../src/lib/storage.js");
const { PROMPTS_DIR } = await import("../src/services/prompts.js");
const ctx = (c = new AbortController()): JobCtx => ({ signal: c.signal, progress() {}, partial() {} });
const reportId = crypto.randomUUID();
const sourceReport = { id: reportId, createdAt: "2026-01-15T12:00:00Z", channel: { id: "UCfixture", title: "Канал-источник", subscribers: 1000, description: "История города", secretField: "NEVER_SEND_CHANNEL_SECRET" }, params: { type: "long" }, stats: { sampleSize: 7, avgViews: 150, medianViews: 100, engagement: 2 }, income: { private: "NEVER_SEND_INCOME" }, videos: Array.from({ length: 7 }, (_, i) => ({ id: `video${i}`, title: `Видео ${i}`, views: i * 100, outlier: i, publishedAt: "2026-01-10", description: "NEVER_SEND_VIDEO_DESCRIPTION" })), insights: { diagnosis: { plan: ["Проверить подачу"] } } };
async function mocked<T>(fn: (bodies: any[]) => Promise<T>, response = "Наблюдение по сохранённому отчёту. Гипотеза: проверьте ясность первого предложения. Внешняя проверка не выполнялась.", hook?: () => void) {
  const orig = globalThis.fetch, bodies: any[] = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    assert.equal(String(url), "https://api.anthropic.com/v1/messages"); bodies.push(JSON.parse(String(init?.body))); hook?.();
    return new Response(JSON.stringify({ content: [{ type: "text", text: response }], usage: { input_tokens: 100, output_tokens: 20 } }));
  }) as typeof fetch;
  try { return await fn(bodies); } finally { globalThis.fetch = orig; }
}
async function noNetwork<T>(fn: () => Promise<T>) {
  const orig = globalThis.fetch; globalThis.fetch = (async () => { throw new Error("Unexpected network"); }) as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = orig; }
}
after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

test("coach: schemas validate sources, languages, question and title limits", () => {
  assert.equal(CoachCreate.parse({}).title, "");
  for (const value of [{ reportId: "../../settings" }, { projectId: "bad" }, { title: "x".repeat(121) }]) assert.equal(CoachCreate.safeParse(value).success, false);
  for (const value of [{ id: reportId, question: " " }, { id: reportId, question: "x".repeat(4001) }, { id: reportId, question: "вопрос", language: "xx" }]) assert.equal(CoachAsk.safeParse(value).success, false);
  assert.equal(CoachAsk.safeParse({ id: reportId, question: "Тест", language: "he" }).success, true);
});
test("coach: no-source creation is local and explicitly has no channel facts", async () => noNetwork(async () => {
  const c = await createCoach(CoachCreate.parse({})); assert.equal(c.messages.length, 0); assert.equal(c.id, c.rootId); assert.deepEqual(c.context.sources, []); assert.match(c.context.warnings.join(" "), /не выбраны/); assert.deepEqual(await loadCoach(c.id), c);
}));
test("coach: whitelisted saved report context excludes secrets, earnings and arbitrary fields", async () => noNetwork(async () => {
  await writeJson(`reports/${reportId}.json`, sourceReport);
  const c = await buildCoachContext(CoachCreate.parse({ reportId })); const r = c.data.report as any;
  assert.equal(r.channel.subscribers, 1000); assert.equal(r.sample.medianViews, 100); assert.equal(r.topVideos.length, 5); assert.equal(r.topVideos[0].views, 600);
  assert.match(c.warnings.join(" "), /5 видео из 7/); assert.equal(c.sources[0].savedAt, sourceReport.createdAt); assert.doesNotMatch(JSON.stringify(c), /NEVER_SEND/);
}));
test("coach: hidden/missing numbers remain null, not zero; zero remains known zero", async () => {
  await writeJson(`reports/${reportId}.json`, { ...sourceReport, channel: { ...sourceReport.channel, hiddenSubscribers: true }, stats: { ...sourceReport.stats, avgViews: undefined, medianViews: 0 }, videos: [{ ...sourceReport.videos[0], viewsKnown: false }] });
  const r = (await buildCoachContext(CoachCreate.parse({ reportId }))).data.report as any;
  assert.equal(r.channel.subscribers, null); assert.equal(r.sample.averageViews, null); assert.equal(r.sample.medianViews, 0); assert.equal(r.topVideos[0].views, null);
  await writeJson(`reports/${reportId}.json`, sourceReport);
});
test("coach: only latest script is included, with explicit truncation; files/keys/notes excluded", async () => {
  const p = await createProject({ title: "Мой проект", niche: "История" });
  await addArtifact(p.id, { kind: "script", title: "Старая версия", data: { script: "NEVER_SEND_OLD_SCRIPT" } });
  const latest = await addArtifact(p.id, { kind: "script", title: "Новая версия", data: { script: "а".repeat(13000), apiKey: "NEVER_SEND_KEY" }, files: ["NEVER_SEND_FILE"] });
  await addArtifact(p.id, { kind: "note", title: "Заметка", data: "NEVER_SEND_NOTE" });
  const c = await buildCoachContext(CoachCreate.parse({ projectId: p.id, reportId })); const pr = c.data.project as any;
  assert.equal(pr.latestScript.id, latest.id); assert.equal(pr.latestScript.text.length, 12000); assert.match(c.warnings.join(" "), /12000 из 13000/); assert.doesNotMatch(JSON.stringify(c), /NEVER_SEND/); assert.equal(c.sources.length, 2);
});
test("coach: project without script or malformed script reports absent text honestly", async () => {
  const p = await createProject({ title: "Пустой проект" }); const c = await buildCoachContext(CoachCreate.parse({ projectId: p.id })); assert.equal((c.data.project as any).latestScript, null);
  await addArtifact(p.id, { kind: "script", title: "Не текст", data: { plan: "Only outline" } }); const b = await buildCoachContext(CoachCreate.parse({ projectId: p.id })); assert.match(b.warnings.join(" "), /текст не передан/);
});
test("coach: context and source list never fetch YouTube or LLM; missing sources fail clearly", async () => noNetwork(async () => {
  await writeJson("reports/index.json", [{ id: reportId, title: "Канал-источник", createdAt: sourceReport.createdAt }, { id: "../settings", title: "unsafe", createdAt: "2026-01-01" }]);
  const s = await coachSources(); assert.equal(s.reports.length, 1); assert.ok(s.projects.length >= 2);
  await assert.rejects(buildCoachContext(CoachCreate.parse({ reportId: crypto.randomUUID() })), /не найден/);
  await assert.rejects(buildCoachContext(CoachCreate.parse({ projectId: crypto.randomUUID() })), /не найден/);
}));
test("coach: saved context remains pinned when source changes; follow-up includes all messages", async () => {
  const c = await createCoach(CoachCreate.parse({ reportId, title: "План канала" }));
  await writeJson(`reports/${reportId}.json`, { ...sourceReport, channel: { ...sourceReport.channel, title: "CHANGED_SOURCE" } });
  await mocked(async bodies => {
    const a = await askCoach(CoachAsk.parse({ id: c.id, question: "Что улучшить?", language: "he" }), ctx());
    assert.notEqual(a.id, c.id); assert.equal(a.parentId, c.id); assert.equal(a.rootId, c.id); assert.equal(a.messages.length, 2); assert.equal(a.messages[1].language, "he"); assert.ok(a.messages[1].model); assert.deepEqual(a.context, c.context);
    assert.deepEqual(await loadCoach(c.id), c); assert.deepEqual(await loadCoach(a.id), a);
    const user = JSON.parse(bodies[0].messages[0].content); assert.equal(user.context.data.report.channel.title, "Канал-источник"); assert.equal(user.question, "Что улучшить?"); assert.match(bodies[0].system[0].text, /UNTRUSTED DATA/);
    const b = await askCoach(CoachAsk.parse({ id: a.id, question: "Как проверить гипотезу?", language: "ru" }), ctx()); assert.equal(b.messages.length, 4);
    const second = JSON.parse(bodies[1].messages[0].content); assert.equal(second.conversation.length, 2); assert.equal(second.conversation[1].text, a.messages[1].text); assert.equal(bodies.length, 2);
  });
  await writeJson(`reports/${reportId}.json`, sourceReport);
});
test("coach: answering old snapshot creates independent branches without losing newer replies", async () => {
  const c = await createCoach(CoachCreate.parse({}));
  await mocked(async () => { const a = await askCoach(CoachAsk.parse({ id: c.id, question: "Первый вариант" }), ctx()); const b = await askCoach(CoachAsk.parse({ id: c.id, question: "Другая ветка" }), ctx()); assert.notEqual(a.id, b.id); assert.equal(b.messages.length, 2); assert.deepEqual(await loadCoach(a.id), a); assert.deepEqual(await loadCoach(c.id), c); });
});
test("coach: turn and total request limits reject before LLM with no hidden history trimming", async () => {
  const c = await createCoach(CoachCreate.parse({}));
  const full = { ...c, id: crypto.randomUUID(), messages: Array.from({ length: 16 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "Текст", at: c.createdAt })) }; await writeJson(`coach-runs/${full.id}.json`, full);
  const huge = { ...c, id: crypto.randomUUID(), messages: Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "x".repeat(9000), at: c.createdAt })) }; await writeJson(`coach-runs/${huge.id}.json`, huge);
  await noNetwork(async () => { await assert.rejects(askCoach(CoachAsk.parse({ id: full.id, question: "Вопрос" }), ctx()), /8 ответов/); await assert.rejects(askCoach(CoachAsk.parse({ id: huge.id, question: "Вопрос" }), ctx()), /60 000/); });
  assert.equal(COACH_LIMITS.turns, 8);
});
test("coach: custom system prompt also counts toward total input size", async () => {
  const file = path.join(PROMPTS_DIR, "coach/chat.md"), original = await fs.readFile(file, "utf8"); const c = await createCoach(CoachCreate.parse({}));
  try { await fs.writeFile(file, "x".repeat(61000)); await noNetwork(() => assert.rejects(askCoach(CoachAsk.parse({ id: c.id, question: "Вопрос" }), ctx()), /60 000/)); }
  finally { await fs.writeFile(file, original); }
});
test("coach: empty and oversize model answers are errors and never overwrite conversation", async () => {
  const c = await createCoach(CoachCreate.parse({})); const before = (await fs.readdir(path.join(dir, "coach-runs"))).sort();
  for (const text of [" ", "x".repeat(10001)]) await mocked(async bodies => { await assert.rejects(askCoach(CoachAsk.parse({ id: c.id, question: "Вопрос" }), ctx()), /не сохранён/); assert.equal(bodies.length, 1); }, text);
  assert.deepEqual((await fs.readdir(path.join(dir, "coach-runs"))).sort(), before); assert.deepEqual(await loadCoach(c.id), c);
});
test("coach: cancellation before and during provider request saves no reply", async () => {
  const c = await createCoach(CoachCreate.parse({})), before = (await fs.readdir(path.join(dir, "coach-runs"))).sort(); const a = new AbortController(); a.abort();
  await noNetwork(() => assert.rejects(askCoach(CoachAsk.parse({ id: c.id, question: "Вопрос" }), ctx(a)), /отмен/i));
  const b = new AbortController(); await mocked(() => assert.rejects(askCoach(CoachAsk.parse({ id: c.id, question: "Вопрос" }), ctx(b)), /отмен/i), "Reply", () => b.abort());
  assert.deepEqual((await fs.readdir(path.join(dir, "coach-runs"))).sort(), before);
});
test("coach: cancellation during commit removes only new snapshot", async () => {
  const c = await createCoach(CoachCreate.parse({})), before = (await fs.readdir(path.join(dir, "coach-runs"))).sort(); const a = new AbortController(), rename = fs.rename;
  fs.rename = (async (from: any, to: any) => { await rename(from,to); if (String(to).includes(path.sep + "coach-runs" + path.sep)) a.abort(); }) as typeof fs.rename;
  try { await mocked(() => assert.rejects(askCoach(CoachAsk.parse({ id: c.id, question: "Вопрос" }), ctx(a)), /отмен/i)); } finally { fs.rename = rename; }
  assert.deepEqual((await fs.readdir(path.join(dir, "coach-runs"))).sort(), before);
});
test("coach: history sorts latest 50, skips unrelated/corrupt files, all snapshots remain", async () => {
  const c = await createCoach(CoachCreate.parse({}));
  for (let i = 0; i < 55; i++) { const id = crypto.randomUUID(); await writeJson(`coach-runs/${id}.json`, { ...c, id, updatedAt: new Date(Date.UTC(2099,0,i+1)).toISOString() }); }
  await writeJson("coach-runs/index.json", {}); const invalid = crypto.randomUUID(); await writeJson(`coach-runs/${invalid}.json`, { ...c, id: invalid, messages: [null] });
  const h = await listCoach(); assert.equal(h.length, 50); assert.ok(h[0].updatedAt > h[49].updatedAt); assert.ok((await fs.readdir(path.join(dir, "coach-runs"))).length > 55);
  assert.equal(await loadCoach("../../settings"), null); assert.equal(await loadCoach(invalid), null);
});
test("coach: API validates before enqueue, body limit and missing snapshots have explicit status", async () => {
  assert.equal((await coachRoute.request("/coach/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: reportId, question: " " }) })).status, 400);
  assert.equal((await coachRoute.request("/coach/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportId: "../x" }) })).status, 400);
  assert.equal((await coachRoute.request("/coach/runs/no-id")).status, 404);
  assert.equal((await coachRoute.request("/coach/ask", { method: "POST", body: "x".repeat(50001) })).status, 413);
});

test("coach: exact preview is local, deterministic and used unchanged by provider and exports", async () => {
  const c = await createCoach(CoachCreate.parse({})); const input = { id: c.id, question: "  Что проверить?  ", language: "he" };
  const before = (await fs.readdir(path.join(dir, "coach-runs"))).sort();
  const p = await noNetwork(() => previewCoach(input));
  assert.equal(p.selection.question, "Что проверить?"); assert.equal(p.hash, (await previewCoach(input)).hash);
  assert.deepEqual(JSON.parse(p.user), { context: c.context, conversation: [], question: p.selection.question });
  assert.deepEqual((await fs.readdir(path.join(dir, "coach-runs"))).sort(), before);
  await mocked(async bodies => {
    const a = await sendCoach({ ...input, previewHash: p.hash }, ctx());
    assert.equal(bodies[0].system[0].text, p.system); assert.equal(bodies[0].messages[0].content, p.user);
    assert.deepEqual(a.lastRequest, p); assert.deepEqual((await loadCoach(a.id))?.lastRequest, p);
    assert.equal((await loadCoach(c.id))?.lastRequest, undefined);
  });
});
test("coach: missing hash and changed question, language, prompt or stored context reject without network", async () => {
  const c = await createCoach(CoachCreate.parse({})), input = { id: c.id, question: "Что проверить?", language: "ru" };
  const p = await previewCoach(input); assert.equal(CoachSend.safeParse(input).success, false);
  await noNetwork(async () => {
    await assert.rejects(sendCoach({ ...input, question: "Другой вопрос", previewHash: p.hash }, ctx()), /предпросмотр/);
    await assert.rejects(sendCoach({ ...input, language: "he", previewHash: p.hash }, ctx()), /предпросмотр/);
    const file = path.join(PROMPTS_DIR, "coach/chat.md"), original = await fs.readFile(file, "utf8");
    try { await fs.writeFile(file, original + "\nNEW INSTRUCTION"); await assert.rejects(sendCoach({ ...input, previewHash: p.hash }, ctx()), /предпросмотр/); }
    finally { await fs.writeFile(file, original); }
    await writeJson(`coach-runs/${c.id}.json`, { ...c, context: { ...c.context, warnings: ["CHANGED"] } });
    await assert.rejects(sendCoach({ ...input, previewHash: p.hash }, ctx()), /предпросмотр/);
  });
});
test("coach: historical request survives prompt/source changes, legacy stays without invented request, tampering rejected", async () => {
  const c = await createCoach(CoachCreate.parse({})); assert.equal(c.lastRequest, undefined);
  await mocked(async () => {
    const a = await askCoach({ id: c.id, question: "Что проверить?" }, ctx()); const saved = a.lastRequest;
    const file = path.join(PROMPTS_DIR, "coach/chat.md"), original = await fs.readFile(file, "utf8");
    try { await fs.writeFile(file, original + "\nCHANGED"); assert.deepEqual((await loadCoach(a.id))?.lastRequest, saved); assert.equal((await loadCoach(c.id))?.lastRequest, undefined); }
    finally { await fs.writeFile(file, original); }
    await writeJson(`coach-runs/${a.id}.json`, { ...a, lastRequest: { ...saved, system: "TAMPERED" } }); assert.equal(await loadCoach(a.id), null);
  });
});
test("coach: preview endpoint validates locally and send endpoint requires review hash before enqueue", async () => noNetwork(async () => {
  const c = await createCoach(CoachCreate.parse({})); const d = { id: c.id, question: "Что проверить?", language: "ru" };
  const request = (url: string, body: unknown) => coachRoute.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const p = await request("/coach/preview", d); assert.equal(p.status, 200); assert.equal((await p.json()).data.hash.length, 64);
  assert.equal((await request("/coach/ask", d)).status, 400);
  assert.equal((await request("/coach/preview", { ...d, question: " " })).status, 400);
}));
