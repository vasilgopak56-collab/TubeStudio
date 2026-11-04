// Desktop overview rendering only: HTTP fixtures, not real Google measurements.
// e2e (Playwright, моки API): 1 сценарий на инструмент. Запуск: npm run build && npm run test:e2e
// Сервер поднимается на временной папке данных без ключей; задачи (/api/<job>) и SSE подменяются фикстурами из ./fixtures.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIX = path.join(ROOT, "tests/e2e/fixtures");
const PORT = 8799, BASE = `http://127.0.0.1:${PORT}`;
const fx = (n) => JSON.parse(fs.readFileSync(path.join(FIX, `${n}.json`), "utf8"));
const CHROME = process.env.CHROME_PATH ?? ["/usr/local/bin/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
const JOBS = { "/transcripts": "transcript-source", "/transcripts/analyze": "transcript-analysis", "/niches": "niches", "/tts": "tts", "/youtube/channel-analysis": "analysis", "/topics": "topics", "/script": "script", "/seo": "seo", "/check/ai-detector": "ai-detector", "/check/humanizer": "humanizer", "/check/script-rater": "script-rater", "/check/packaging": "packaging", "/storyboard": "storyboard", "/thumbnail/generate": "thumbnail", "/research/videos": "research", "/research/keywords": "keywords", "/comments": "comments", "/scorecard": "scorecard", "/competitors/digest": "digest", "/pipeline": "pipeline", "/pipeline/e2epipe/resume": "pipeline-done", "/draft": "draft", "/shorts": "shorts" };
const HEALTH = { version: "e2e", node: process.version, dataDir: "tmp", llm: "anymodel", keys: ["anymodel", "youtube", "gemini", "lumean", "anthropic", "openai"].map((p) => ({ provider: p, label: p, required: p !== "openai" && p !== "anthropic", configured: true, ok: true, message: "mock" })) };

let srv, browser, dataDir;
const posted = {};

before(async () => {
  assert.ok(fs.existsSync(path.join(ROOT, "apps/web/dist/index.html")) && fs.existsSync(path.join(ROOT, "apps/server/dist/index.js")), "Сначала npm run build");
  assert.ok(CHROME, "Не найден Chromium — задайте CHROME_PATH");
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-e2e-"));
  // промпты копируем во временную папку — редактор промптов не трогает настоящие файлы
  fs.cpSync(path.join(ROOT, "apps/server/prompts"), path.join(dataDir, "prompts"), { recursive: true });
  const env = { PATH: process.env.PATH, PORT: String(PORT), HOST: "127.0.0.1", DATA_DIR: dataDir, ENV_FILE: path.join(dataDir, ".env"), PROMPTS_DIR: path.join(dataDir, "prompts") };
  srv = spawn("node", ["dist/index.js"], { cwd: path.join(ROOT, "apps/server"), env, stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/auth/status`)).ok) break; } catch { /* ждём */ } await new Promise((r) => setTimeout(r, 250)); }
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); srv?.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const AM_BAL = { balance: 50_000_000, unlimited: false, status: "active", usd: 2.5, usdPerMillion: 0.05, monthTokens: 1_200_000, history: [{ at: "2025-01-01T00:00:00Z", balance: 52_000_000 }, { at: "2025-01-02T00:00:00Z", balance: 50_000_000 }] };
const amM = (id, kind, ci, co, extra = {}) => ({ id, kind, vendor: id.split("/")[0], unit: kind === "image" ? "image" : "token", coefIn: ci, coefOut: co, usdIn: ci * 0.05, usdOut: co * 0.05, unitTokens: kind === "image" ? 100_000 : null, unitUsd: kind === "image" ? 0.005 : null, scales: kind === "image" ? { quality: { low: 0.5, medium: 1, high: 4 } } : null, context: 200_000, vision: true, search: id.startsWith("ag/"), ...extra });
const AM_CAT = { rate: 0.05, models: [amM("cc/claude-sonnet-5", "text", 3, 15), amM("cx/gpt-5.6-terra", "text", 2, 8), amM("ag/gemini-3-flash", "text", 0.3, 2.5), amM("cx/gpt-image-2", "image", 1, 1), amM("ag/gemini-3.1-flash-image", "image", 1, 1)], selected: { enabled: true, priority: "first", text: "cc/claude-sonnet-5", textAlt: "cx/gpt-5.6-terra", fast: "ag/gemini-3-flash", search: "ag/gemini-3-flash", image: "cx/gpt-image-2", imageAlt: "ag/gemini-3.1-flash-image", imageQuality: "medium", tts: "edge-tts/ru-RU-DmitryNeural", usdPerMillion: 0.05 } };

async function page(viewport = { width: 1440, height: 1000 }) {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.route("**/*", async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.host !== `127.0.0.1:${PORT}`) return route.abort(); // никаких внешних запросов
    const api = u.pathname.replace(/^\/api/, "");
    if (u.pathname === "/api/health") return route.fulfill({ json: { ok: true, data: HEALTH } });
    if (u.pathname === "/api/anymodel/balance") return route.fulfill({ json: { ok: true, data: AM_BAL } });
    if (u.pathname === "/api/tts/voices") return route.fulfill({ json: { ok: true, data: { selected: "edge-tts/ru-RU-DmitryNeural", voices: [{ model: "fish-farm/s2.1-pro-free", name: "Fish Audio S2.1 Pro", lang: "multi", gender: "—", provider: "fish-farm" }, { model: "edge-tts/ru-RU-DmitryNeural", name: "Dmitry (Russian (Russia))", lang: "ru", gender: "Male", provider: "edge-tts" }, { model: "edge-tts/ru-RU-SvetlanaNeural", name: "Svetlana (Russian (Russia))", lang: "ru", gender: "Female", provider: "edge-tts" }] } } });
    if (u.pathname === "/api/tts/estimate") return route.fulfill({ json: { ok: true, data: { chars: 1234, chunks: 1, tokens: 61700, usd: 0.003 } } });
    if (u.pathname === "/api/anymodel/models") return route.fulfill({ json: { ok: true, data: AM_CAT } });
    if (api === "/research/keyword-runs/abcdef12") return route.fulfill({json:{ok:true,data:{...fx("keywords"),id:"abcdef12"}}});
    if (api === "/comment-runs/abcdef12") return route.fulfill({json:{ok:true,data:{...fx("comments"),id:"abcdef12"}}});
    if(api==="/transcripts/preview"&&req.method()==="POST"){const selection=req.postDataJSON();return route.fulfill({json:{ok:true,data:{selection,sourceCreatedAt:fx("transcript-source").createdAt,system:"Mock instructions",user:JSON.stringify({transcript:fx("transcript-source").text}),hash:"a".repeat(64)}}});}
    if (req.method() === "POST" && JOBS[api]) { posted[JOBS[api]] = req.postDataJSON(); const fixture = api === "/transcripts/analyze" ? `transcript-${posted[JOBS[api]].mode}` : api === "/research/videos" && posted[JOBS[api]].mode === "anomalies" ? "anomalies" : JOBS[api]; return route.fulfill({ json: { ok: true, data: { jobId: `mock-${fixture}` } } }); }
    const m = api.match(/^\/jobs\/mock-([\w-]+)\/stream$/);
    if (m) {
      const ev = (t, d) => `event: ${t}\ndata: ${JSON.stringify(d)}\n\n`;
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body: ev("progress", { type: "progress", stage: "Мок", pct: 50 }) + ev("done", { type: "done", data: fx(m[1]) }) });
    }
    return route.continue();
  });
  p.errors = errors;
  return p;
}
const visible = (p, text) => p.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 10_000 });
const ph = (p, start) => p.locator(`[placeholder^="${start}"]`).first();
test("Моя аналитика: инструкция подключения и отчёт канала", async () => {
  const p = await page(); await p.goto(`${BASE}/my-analytics`);
  await visible(p, "Как подключить");
  await p.getByLabel("Client ID").fill("bad-client-id-123");
  await p.getByLabel("Client secret").fill("GOCSPX-12345678");
  await p.getByRole("button", { name: "Сохранить" }).click();
  await visible(p, "googleusercontent.com");
  await p.close();
  const q = await page();
  await q.route("**/api/yt-oauth/status", (r) => r.fulfill({ json: { ok: true, data: { configured: true, clientId: "123…", connected: true, channel: { id: "UC1", title: "Мой канал" }, redirectUri: "x", scopes: [] } } }));
  await q.route("**/api/my-analytics/overview?*", (r) => r.fulfill({ json: { ok: true, data: fx("my-overview") } }));
  await q.route("**/api/my-analytics/video/*", (r) => r.fulfill({ json: { ok: true, data: fx("my-video") } }));
  await q.route("**/api/my-analytics/lessons", (r) => r.fulfill({ json: { ok: true, data: null } }));
  await q.goto(`${BASE}/my-analytics`);
  await q.locator('[data-testid="my-totals"]').waitFor();
  await visible(q, "+168"); await visible(q, "Мой канал");
  await q.getByText("Почему римляне не знали мыла").click();
  await q.locator('[data-testid="compare"]').waitFor();
  await visible(q, "Прогноз близок к реальности");
  assert.deepEqual(q.errors, []); await q.close();
});

test('Overview desktop: period chips request only overview window; video endpoint independent; local tabs do not trigger lessons',async()=>{
 const p=await page(),overview=[],videos=[],posts=[];
 await p.route('**/api/yt-oauth/status',r=>r.fulfill({json:{ok:true,data:{configured:true,connected:true,clientId:'test',channel:{id:'UC'+'a'.repeat(22),title:'Учебный OAuth-канал'},scopes:[]}}}));
 await p.route('**/api/my-analytics/overview?*',r=>{overview.push(new URL(r.request().url()).searchParams.get('days'));return r.fulfill({json:{ok:true,data:fx('my-overview')}});});
 await p.route('**/api/my-analytics/video/*',r=>{videos.push(new URL(r.request().url()).search);return r.fulfill({json:{ok:true,data:fx('my-video')}});});
 await p.route('**/api/my-analytics/lessons',r=>{if(r.request().method()==='POST')posts.push(r.request().postData());return r.fulfill({json:{ok:true,data:null}});});
 await p.goto(BASE+'/my-analytics');await p.getByTestId('my-totals').waitFor();assert.ok(overview.includes('28'));assert.equal(posts.length,0);
 const response=p.waitForResponse(r=>r.url().endsWith('/api/my-analytics/overview?days=7'));await p.getByRole('button',{name:'7 дней',exact:true}).click();await response;assert.ok(overview.includes('7'));
 await p.getByText('Почему римляне не знали мыла',{exact:true}).click();await p.getByTestId('compare').waitFor();assert.deepEqual(videos,['']);assert.match(await p.getByTestId('compare').innerText(),/средняя разница/);assert.match(await p.getByTestId('video-panel').innerText(),/9\s?000|9K|9\s?тыс/i);
 await p.getByRole('button',{name:'Журнал A/B',exact:true}).click();await p.getByTestId('ab-journal').waitFor();assert.equal(posts.length,0);
 await p.getByRole('button',{name:'Обзор',exact:true}).click();await p.getByTestId('video-panel').waitFor();assert.equal(posts.length,0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 fs.mkdirSync('/data/ts68-overview-qa',{recursive:true});await p.getByTestId('video-panel').scrollIntoViewIfNeeded();await p.screenshot({path:'/data/ts68-overview-qa/overview-retention-desktop.png'});assert.deepEqual(p.errors,[]);await p.close();
});
