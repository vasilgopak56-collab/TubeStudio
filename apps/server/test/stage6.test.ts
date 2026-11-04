// Конвейер «Одна кнопка», видео-черновик (субтитры, сцены)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ts-s6-"));
const { buildCues, toSrt, planScenes } = await import("../src/services/draft.js");
const { PipelineInput, createPipeline, patchPipeline, rerunStage, loadPipeline, listPipelines } = await import("../src/services/pipeline.js");

test("draft: субтитры по предложениям, время пропорционально длине", () => {
  const cues = buildCues([{ start: 0, end: 10, text: "Короткое. Это предложение заметно длиннее первого!" }, { start: 10, end: 12, text: "Конец." }]);
  assert.equal(cues.length, 3);
  assert.equal(cues[0].start, 0);
  assert.ok(Math.abs(cues[1].end - 10) < 1e-6);
  assert.ok(cues[1].end - cues[1].start > cues[0].end - cues[0].start);
  const long = buildCues([{ start: 0, end: 20, text: "слово ".repeat(60).trim() + "." }], 84);
  assert.ok(long.length >= 4 && long.every((c) => c.text.length <= 110));
  const srt = toSrt(cues);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:0\d,\d{3}\nКороткое\.\n/);
  assert.match(srt, /00:00:12,000/);
});

test("draft: сцены по раскадровке масштабируются к длине озвучки", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ start: i * 5, seconds: 5 })); // 100 с по оценке
  const pl = planScenes(200, 5, rows);
  assert.equal(pl.length, 5);
  assert.equal(pl[0].start, 0); assert.equal(pl[4].end, 200);
  assert.equal(pl[1].start, 40); // строка 4 → 20 с × 2
  for (let i = 1; i < pl.length; i++) assert.equal(pl[i].start, pl[i - 1].end);
  const even = planScenes(60, 3);
  assert.deepEqual(even.map((x) => x.end), [20, 40, 60]);
});

test("pipeline: создание, этапы по порядку, патч и перезапуск", async () => {
  const input = PipelineInput.parse({ topic: "Тестовая тема", stages: ["shorts", "seo"], pauseAfter: ["script"] });
  const p = await createPipeline(input);
  assert.deepEqual(p.stages.map((s) => s.id), ["script", "seo", "shorts"]); // сценарий всегда первый
  p.stages[0].status = "done"; p.stages[1].status = "done";
  const { writeJson } = await import("../src/lib/storage.js");
  await writeJson(`pipelines/${p.id}.json`, p);
  const q = await patchPipeline(p.id, { stages: ["rater", "voice"] });
  assert.deepEqual(q.stages.map((s) => s.id), ["script", "rater", "seo", "voice"]); // готовый SEO сохраняется
  const r = await rerunStage(p.id, "seo");
  assert.deepEqual(r.stages.map((s) => s.status), ["done", "pending", "pending", "pending"]);
  const all = await rerunStage(p.id, "script");
  assert.ok(all.stages.every((s) => s.status === "pending"));
  assert.equal((await loadPipeline(p.id))?.id, p.id);
  assert.equal((await listPipelines())[0].id, p.id);
  assert.throws(() => PipelineInput.parse({ topic: "x" }));
});

test("analytics: сравнение прогноза удержания с реальной кривой", async () => {
  const { compareCurves, rowsOf } = await import("../src/services/ytAnalytics.js");
  const pred = [{ t: 0, v: 100 }, { t: 30, v: 70 }, { t: 300, v: 50 }, { t: 600, v: 40 }];
  const actual = Array.from({ length: 11 }, (_, i) => ({ ratio: i / 10, watch: i === 0 ? 1 : 0.6 - i * 0.02, relative: 0.5 }));
  const c = compareCurves(pred, actual, 600)!;
  assert.equal(c.points.length, 11);
  assert.equal(c.points[5].sec, 300); assert.equal(c.points[5].predicted, 50); assert.equal(c.points[5].actual, 50);
  assert.ok(c.drops[0].sec === 60 && c.drops[0].drop > 30);
  assert.ok(typeof c.mae === "number" && c.verdict.length > 5);
  assert.equal(compareCurves([], actual, 600), null);
  assert.deepEqual(rowsOf({ columnHeaders: [{ name: "day" }, { name: "views" }], rows: [["2026-01-01", 5]] }), [{ day: "2026-01-01", views: 5 }]);
});

test("analytics: OAuth — ссылка входа, обмен кода, обновление токена", async () => {
  process.env.ENV_FILE = path.join(process.env.DATA_DIR!, ".env");
  const A = await import("../src/services/ytAnalytics.js");
  assert.throws(() => A.authUrl(), /Client ID/);
  await assert.rejects(A.saveClient("bad", "x".repeat(12)), /googleusercontent/);
  await A.saveClient("123-abc.apps.googleusercontent.com", "GOCSPX-secret123");
  const url = new URL(A.authUrl());
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.match(url.searchParams.get("scope")!, /yt-analytics\.readonly/);
  assert.equal(url.searchParams.get("redirect_uri"), A.redirectUri());
  const calls: string[] = []; const orig = globalThis.fetch;
  globalThis.fetch = (async (u: string, init?: RequestInit) => {
    calls.push(String(u));
    if (String(u).includes("oauth2.googleapis.com/token")) { const b = String(init?.body); return new Response(JSON.stringify(b.includes("refresh_token=") ? { access_token: "AT2", expires_in: 3600 } : { access_token: "AT1", refresh_token: "RT", expires_in: -100 })); }
    if (String(u).includes("/channels")) return new Response(JSON.stringify({ items: [{ id: "UC" + "1".repeat(22), snippet: { title: "Мой канал" }, contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] }));
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  try {
    await assert.rejects(A.handleCallback({ code: "c", state: "wrong" }), /устарела/);
    const ch = await A.handleCallback({ code: "c", state: url.searchParams.get("state")! });
    assert.equal(ch.title, "Мой канал");
    assert.ok(calls.filter((c) => c.includes("/token")).length === 2, "просроченный токен обновлён перед запросом канала");
    const st = await A.oauthStatus();
    assert.ok(st.connected && st.channel?.id === "UC" + "1".repeat(22));
    assert.equal((fs.statSync(path.join(process.env.DATA_DIR!, "oauth.json")).mode & 0o777).toString(8), "600");
    assert.match(fs.readFileSync(process.env.ENV_FILE!, "utf8"), /GOOGLE_CLIENT_ID=123-abc/);
  } finally { globalThis.fetch = orig; }
});
