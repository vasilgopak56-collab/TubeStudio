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
const LONG = fx("script").script;

test("Анализ канала", async () => {
  const p = await page(); await p.goto(`${BASE}/analysis`);
  await ph(p, "https://youtube.com/@channel").fill("@kurzgesagt");
  await p.getByRole("button", { name: /Анализировать/ }).click();
  await visible(p, fx("analysis").channel.title);
  assert.equal(posted.analysis.channel, "@kurzgesagt"); assert.deepEqual(p.errors, []); await p.close();
});
test("Поиск тем", async () => {
  const p = await page(); await p.goto(`${BASE}/topics`);
  await ph(p, "древние люди").fill("средневековье, гигиена");
  await ph(p, "Например: документальный").fill("Странная история быта для взрослых");
  await p.getByRole("button", { name: /Найти темы/ }).click();
  await visible(p, fx("topics").topics[0].title.slice(0, 40));
  assert.deepEqual(p.errors, []); await p.close();
});
test("Сценарист", async () => {
  const p = await page(); await p.goto(`${BASE}/script`);
  await ph(p, "Как люди каменного века").fill("Почему средневековые люди боялись купаться");
  await p.locator('button[type="submit"]').click();
  await visible(p, LONG.split(/\s+/).slice(0, 6).join(" "));
  assert.ok(posted.script.topic.includes("купаться")); assert.deepEqual(p.errors, []); await p.close();
});
test("SEO", async () => {
  const p = await page(); await p.goto(`${BASE}/seo`);
  await ph(p, "Вставьте текст сценария").fill(LONG);
  await p.getByRole("button", { name: /Собрать SEO-пакет/ }).click();
  await visible(p, fx("seo").titles[0].title);
  await visible(p, "Комментарии для закрепа");
  assert.deepEqual(p.errors, []); await p.close();
});
test("AI-детектор", async () => {
  const p = await page(); await p.goto(`${BASE}/check/ai-detector`);
  await ph(p, "Вставьте текст").fill(LONG);
  await p.getByRole("button", { name: /^Проверить$/ }).click();
  await visible(p, `${fx("ai-detector").humanPct}`);
  assert.deepEqual(p.errors, []); await p.close();
});
test("Живой голос (Humanizer)", async () => {
  const p = await page(); await p.goto(`${BASE}/check/humanizer`);
  await ph(p, "Вставьте текст озвучки").fill("Добро пожаловать на канал! В этом видео мы погрузимся в удивительную историю. Это не просто химия. Это магия. Давайте разберёмся. " + LONG);
  await p.getByText(/штраф \d+/).first().waitFor({ state: "visible", timeout: 10_000 }); // мгновенная детерминированная оценка (реальный /check/humanizer/scan)
  await p.getByRole("button", { name: /Очеловечить/ }).click();
  const f = fx("humanizer");
  await visible(p, "Сцены: было → стало");
  await visible(p, "Отчёт проверки");
  assert.equal(posted.humanizer.maxPasses, 2);
  assert.ok(await p.getByText(`СЦЕНА ${f.scenes[0].i + 1}`, { exact: true }).first().isVisible());
  assert.deepEqual(p.errors, []); await p.close();
});
test("Оценка сценария", async () => {
  const p = await page(); await p.goto(`${BASE}/check/script-rater`);
  await ph(p, "Вставьте сценарий").fill(LONG);
  await p.getByRole("button", { name: /Оценить/ }).click();
  await visible(p, fx("script-rater").improvements[0].issue.slice(0, 25));
  assert.deepEqual(p.errors, []); await p.close();
});
test("Упаковка (Viral Alchemist)", async () => {
  const p = await page(); await p.goto(`${BASE}/check/packaging`);
  await ph(p, "Почему в Средневековье").fill("Почему средневековые люди боялись купаться");
  await p.locator('input[type="file"]').first().setInputFiles({ name: "t.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
  await p.getByRole("button", { name: /Проверить упаковку/ }).click();
  await visible(p, fx("packaging").improvements[0].slice(0, 30));
  assert.deepEqual(p.errors, []); await p.close();
});
test("Раскадровка", async () => {
  const p = await page(); await p.goto(`${BASE}/storyboard`);
  await ph(p, "Текст сценария").fill(LONG);
  await p.getByRole("button", { name: /Сделать раскадровку/ }).click();
  const sb = fx("storyboard");
  await visible(p, `${sb.rows.length} из ${sb.totalUnits} сцен`);
  await visible(p, sb.rows[0].concept.slice(0, 25));
  assert.equal(posted.storyboard.imageModel, "midjourney"); assert.deepEqual(p.errors, []); await p.close();
});
test("Обложки: 3 концепта", async () => {
  const p = await page(); await p.goto(`${BASE}/thumbnail`);
  await ph(p, "Почему средневековые").fill("Почему средневековые люди боялись купаться");
  await p.getByRole("button", { name: "Тёмная документалистика" }).click();
  await p.getByRole("button", { name: /Сгенерировать 3 варианта/ }).click();
  for (const v of fx("thumbnail").variants) await visible(p, v.idea);
  assert.equal(posted.thumbnail.steps.style, "darkdoc"); assert.deepEqual(p.errors, []); await p.close();
});
test("Polish Studio: пресет меняет картинку, экспорт ≤ 2 МБ", async () => {
  const p = await page(); await p.goto(`${BASE}/thumbnail?tab=polish`);
  await p.evaluate(() => localStorage.removeItem("ts:polish:adj"));
  const png = await p.evaluate(() => { const c = document.createElement("canvas"); c.width = 1600; c.height = 900; const g = c.getContext("2d"); const gr = g.createLinearGradient(0, 0, 1600, 900); gr.addColorStop(0, "#e11d48"); gr.addColorStop(1, "#2563eb"); g.fillStyle = gr; g.fillRect(0, 0, 1600, 900); return c.toDataURL("image/png").split(",")[1]; });
  await p.locator('input[type="file"]').first().setInputFiles({ name: "g.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await visible(p, "Заменить обложку");
  const px = () => p.evaluate(() => { const c = document.querySelector("canvas"); const g = c.getContext("webgl"); const a = new Uint8Array(4); g.readPixels(300, 300, 1, 1, g.RGBA, g.UNSIGNED_BYTE, a); return [...a].slice(0, 3); });
  const before = await px();
  await p.getByRole("button", { name: "Тёмная документалистика" }).click(); await p.waitForTimeout(800);
  const after = await px();
  assert.notDeepEqual(before, after, "пресет не изменил пиксели");
  const size = await p.evaluate(() => new Promise((r) => document.querySelector("canvas").toBlob((b) => r([b.size, b.type]), "image/jpeg", 0.92)));
  assert.ok(size[0] < 2 * 1024 * 1024 && size[1] === "image/jpeg");
  assert.deepEqual(await p.evaluate(() => [document.querySelector("canvas").width, document.querySelector("canvas").height]), [1280, 720]);
  assert.deepEqual(p.errors, []); await p.close();
});
test("Проекты: создание и таймлайн", async () => {
  const post = async (u, b) => (await fetch(`${BASE}/api${u}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })).json();
  const r = await post("/projects", { title: "E2E проект" });
  await post(`/projects/${r.data.id}/artifacts`, { kind: "script", title: "Сценарий", data: fx("script") });
  await post(`/projects/${r.data.id}/artifacts`, { kind: "seo", title: "SEO", data: fx("seo") });
  const p = await page(); await p.goto(`${BASE}/projects`);
  await p.getByText("E2E проект").first().click();
  await visible(p, "Таймлайн"); await visible(p, LONG.slice(0, 30)); await visible(p, fx("seo").titles[0].title);
  const zip = await fetch(`${BASE}/api/projects/${r.data.id}/export`); assert.equal(zip.headers.get("content-type"), "application/zip");
  assert.ok(r.ok); assert.deepEqual(p.errors, []); await p.close();
});
test("AnyModel: баланс, калькулятор, каталог", async () => {
  const p = await page();
  await p.goto(`${BASE}/anymodel`);
  await visible(p, "Калькулятор: сколько стоит видео");
  await visible(p, "Баланса хватит на");
  await p.locator("td", { hasText: "cx/gpt-5.6-terra" }).first().waitFor({ state: "visible", timeout: 10_000 });
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test("Озвучка: из проекта → MP3 (мок), загрузка готового файла в проект", async () => {
  const post = async (u, b) => (await fetch(`${BASE}/api${u}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })).json();
  const r = await post("/projects", { title: "E2E озвучка" });
  await post(`/projects/${r.data.id}/artifacts`, { kind: "script", title: "Сценарий", data: fx("script") });
  const p = await page(); await p.goto(`${BASE}/voice?projectId=${r.data.id}`);
  await visible(p, "1 234 симв.");
  await p.getByRole("button", { name: "Озвучить", exact: true }).click();
  await visible(p, "Готово: Мок озвучки"); await visible(p, "Вторая часть озвучки");
  assert.equal(posted.tts.projectId, r.data.id); assert.equal(posted.tts.model, "edge-tts/ru-RU-DmitryNeural"); assert.ok(posted.tts.text.length > 1000);
  const wav = Buffer.alloc(44 + 16000); wav.write("RIFF", 0, "latin1"); wav.write("WAVE", 8, "latin1"); wav.write("fmt ", 12, "latin1"); wav.writeUInt32LE(16, 16); wav.writeUInt32LE(16000, 28); wav.write("data", 36, "latin1"); wav.writeUInt32LE(16000, 40);
  await p.locator('[data-testid="audio-file"]').setInputFiles({ name: "voice.wav", mimeType: "audio/wav", buffer: wav });
  await p.getByRole("button", { name: "Загрузить" }).click();
  await visible(p, "Озвучки проекта");
  const proj = await (await fetch(`${BASE}/api/projects/${r.data.id}`)).json();
  const a = proj.data.artifacts.find((x) => x.kind === "audio");
  assert.equal(a.data.seconds, 1); assert.ok(a.data.uploaded);
  assert.equal((await fetch(`${BASE}${a.data.url}`)).status, 200);
  assert.deepEqual(p.errors, []); await p.close();
});

test("Адаптив 360 px: нет горизонтального скролла", async () => {
  const p = await page({ width: 360, height: 780 });
  for (const route of ["/", "/topics", "/script", "/seo", "/thumbnail", "/storyboard", "/check/ai-detector", "/settings", "/help", "/calendar", "/voice-profile", "/prompts", "/anymodel", "/voice"]) {
    await p.goto(BASE + route); await p.waitForTimeout(400);
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 362, `${route}: ширина ${w}px > 360`);
  }
  assert.deepEqual(p.errors, []); await p.close();
});
test("Данные: экспорт всех данных → импорт", async () => {
  const exp = await fetch(`${BASE}/api/data/export`);
  assert.equal(exp.headers.get("content-type"), "application/zip");
  const zip = new Uint8Array(await exp.arrayBuffer());
  const imp = await (await fetch(`${BASE}/api/data/import`, { method: "POST", headers: { "content-type": "application/zip" }, body: zip })).json();
  assert.ok(imp.ok && imp.data.imported >= 1, JSON.stringify(imp));
  const bad = await (await fetch(`${BASE}/api/data/import`, { method: "POST", headers: { "content-type": "application/zip" }, body: "not a zip at all, definitely not" })).json();
  assert.equal(bad.ok, false);
  const p = await page(); await p.goto(`${BASE}/settings`); await visible(p, "Экспорт всех данных"); assert.deepEqual(p.errors, []); await p.close();
});

test("Данные: новые разделы и изменённый промпт восстанавливаются через API", async () => {
  const folders = ["audio-storyboards", "pipelines", "keyword-runs", "research-runs", "comment-runs", "scorecards", "prompt-versions"];
  const seeded = [];
  for (const dir of folders) {
    const file = path.join(dataDir, dir, "backup-test", "sample.json");
    fs.mkdirSync(path.dirname(file), {recursive:true});
    const body = JSON.stringify({section:dir, payload:"тест переноса"});
    fs.writeFileSync(file, body); seeded.push([file, body]);
  }
  const pcm = path.join(dataDir, "audio-storyboards", "backup-test.pcm");
  fs.writeFileSync(pcm, Buffer.from([0,255,0,128,33]));
  const prompt = path.join(dataDir, "prompts", "backup-test.md");
  fs.writeFileSync(prompt, "Edited prompt {{topic}} — резервная копия");
  const archive = Buffer.from(await (await fetch(`${BASE}/api/data/export`)).arrayBuffer());
  for (const [file] of seeded) fs.unlinkSync(file);
  fs.unlinkSync(pcm); fs.writeFileSync(prompt, "changed after backup");
  const result = await (await fetch(`${BASE}/api/data/import`, {method:"POST", headers:{"content-type":"application/zip"}, body:archive})).json();
  assert.ok(result.ok, JSON.stringify(result)); assert.deepEqual(result.data.skipped, []);
  for (const [file, body] of seeded) assert.equal(fs.readFileSync(file,"utf8"), body);
  assert.deepEqual([...fs.readFileSync(pcm)], [0,255,0,128,33]);
  assert.equal(fs.readFileSync(prompt,"utf8"), "Edited prompt {{topic}} — резервная копия");
  for (const [file] of seeded) fs.unlinkSync(file);
  fs.unlinkSync(pcm); fs.unlinkSync(prompt);
});
test("Данные: интерфейс показывает пропуски и предупреждения вместо полного успеха", async () => {
  const p = await page({width:390,height:1000});
  await p.route("**/api/data/import", r => r.fulfill({json:{ok:true,data:{imported:7,skipped:["unknown/test.json"],warnings:["Тестовое предупреждение"]}}}));
  await p.goto(`${BASE}/settings`);
  p.on("dialog", d => d.accept());
  await p.locator('input[type="file"][accept=".zip,application/zip"]').setInputFiles({name:"test.zip",mimeType:"application/zip",buffer:Buffer.from("test mock")});
  await visible(p, "Импортировано файлов: 7.");
  await visible(p, "unknown/test.json"); await visible(p, "Тестовое предупреждение");
  await visible(p, "OAuth-токены");
  assert.ok((await p.getByText(/Импортировано файлов: 7/).getAttribute("class")).includes("text-accent"));
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth), false);
  fs.mkdirSync("/data/stability-release/ui",{recursive:true});
  await p.getByRole("link",{name:"Экспорт всех данных",exact:true}).scrollIntoViewIfNeeded();
  await p.screenshot({path:"/data/stability-release/ui/backup-mobile.png"});
  assert.deepEqual(p.errors,[]); await p.close();
});

test("Справка: разделы, поиск, ссылка из инструмента", async () => {
  const p = await page(); await p.goto(`${BASE}/check/humanizer`);
  await p.getByRole("link", { name: "Справка", exact: true }).last().click();
  await p.waitForURL(/\/help#humanizer$/);
  await visible(p, "Простыми словами");
  assert.ok(await p.locator("#humanizer").isVisible());
  await p.getByPlaceholder("Поиск по справке").fill("квота");
  await p.waitForTimeout(200);
  assert.ok(await p.locator("#glossary").isVisible(), "словарик находится по слову «квота»");
  assert.equal(await p.locator("#seo").count(), 0, "лишние разделы скрыты");
  assert.deepEqual(p.errors, []); await p.close();
});
test("Ключи из Настроек пишутся в .env (временный)", async () => {
  const r = await (await fetch(`${BASE}/api/settings/keys`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ openai: "sk-e2e-test" }) })).json();
  assert.ok(r.ok, JSON.stringify(r));
  assert.match(fs.readFileSync(path.join(dataDir, ".env"), "utf8"), /^OPENAI_API_KEY=sk-e2e-test$/m);
  const bad = await (await fetch(`${BASE}/api/settings/keys`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ openai: "a b" }) })).json();
  assert.equal(bad.ok, false);
  await fetch(`${BASE}/api/settings/keys`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ openai: "" }) });
  const p = await page(); await p.goto(`${BASE}/settings`);
  await p.locator('button[title="Заменить ключ"]').first().click();
  await visible(p, "Сохранить и проверить");
  assert.deepEqual(p.errors, []); await p.close();
});

const api = async (u, method = "GET", b) => (await fetch(`${BASE}/api${u}`, { method, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined })).json();

test("Календарь: выпуск через UI, проект → «В календарь», .ics", async () => {
  const p = await page(); await p.goto(`${BASE}/calendar`);
  await p.getByRole("button", { name: "Запланировать" }).click();
  await p.getByPlaceholder("О чём видео").fill("E2E выпуск про бетон");
  await p.getByRole("button", { name: "Сохранить", exact: true }).click();
  await visible(p, "E2E выпуск про бетон");
  const list = await api("/calendar");
  assert.equal(list.data.length, 1); assert.equal(list.data[0].status, "plan");
  const ics = await (await fetch(`${BASE}/api/calendar.ics`)).text();
  assert.match(ics, /BEGIN:VCALENDAR/); assert.match(ics, /SUMMARY:.*E2E выпуск про бетон/); assert.match(ics, /BEGIN:VALARM/);
  const pr = await api("/projects", "POST", { title: "E2E календарный проект" });
  await p.goto(`${BASE}/projects/${pr.data.id}`);
  await p.getByRole("link", { name: "В календарь" }).click();
  await p.waitForURL(/\/calendar/);
  assert.equal(await p.getByPlaceholder("О чём видео").inputValue(), "E2E календарный проект");
  await p.getByRole("button", { name: "Сохранить", exact: true }).click();
  await p.waitForTimeout(300);
  const l2 = await api("/calendar");
  assert.equal(l2.data.length, 2); assert.ok(l2.data.some((x) => x.projectId === pr.data.id && x.status === "script"));
  assert.deepEqual(p.errors, []); await p.close();
});

test("Голос канала: паспорт по образцу и переключатель в Сценаристе", async () => {
  const p = await page(); await p.goto(`${BASE}/voice-profile`);
  await p.getByPlaceholder("Вставьте текст своего сценария").fill(LONG.slice(0, 4000));
  await p.getByRole("button", { name: "Составить паспорт" }).click();
  await visible(p, "Длина фразы");
  const v = await api("/voice-profile");
  assert.ok(v.data.passport && v.data.passport.sentences > 5, JSON.stringify(v.data.passport)?.slice(0, 200));
  assert.ok(v.data.enabled); assert.match(v.data.prompt, /ГОЛОС КАНАЛА|голос|Voice/i);
  await p.goto(`${BASE}/script`);
  await visible(p, "Ритм, длина фраз");
  assert.deepEqual(p.errors, []); await p.close();
});

test("Промпты: правка → версия → откат к заводской", async () => {
  const file = path.join(dataDir, "prompts/seo/seo.md");
  const orig = fs.readFileSync(file, "utf8");
  const p = await page(); p.on("dialog", (d) => d.accept());
  await p.goto(`${BASE}/prompts`);
  await p.getByRole("button", { name: /seo\/seo\.md/ }).click();
  const ta = p.getByLabel("Текст промпта");
  await ta.waitFor(); await p.waitForFunction(() => document.querySelector('textarea[aria-label="Текст промпта"]')?.value.length > 50);
  await ta.fill((await ta.inputValue()) + "\nE2E-ПРАВКА");
  await p.getByRole("button", { name: "Сохранить", exact: true }).click();
  await visible(p, "Заводская версия");
  assert.match(fs.readFileSync(file, "utf8"), /E2E-ПРАВКА/);
  const lost = await api("/prompts/file", "PUT", { path: "seo/seo.md", content: "без переменных" });
  assert.equal(lost.ok, false, "удаление переменных без force запрещено");
  const vers = await api("/prompts/versions?path=seo/seo.md");
  const r = await api("/prompts/restore", "POST", { path: "seo/seo.md", id: vers.data.find((x) => x.id === "original").id });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(fs.readFileSync(file, "utf8"), orig);
  const bad = await api("/prompts/file?path=../../.env");
  assert.equal(bad.ok, false, "выход за папку промптов запрещён");
  assert.deepEqual(p.errors, []); await p.close();
});

test("Бюджет: расход в $, плашка в меню, блокировка", async () => {
  const month = new Date().toISOString().slice(0, 7);
  fs.writeFileSync(path.join(dataDir, "usage.json"), JSON.stringify({ month, youtubeUnits: {}, llm: { "gemini-2.5-flash": { in: 1_000_000, out: 0, calls: 3 } }, images: { "gpt-image-1": 2 } }));
  const s = await api("/settings", "PUT", { budget: { monthlyUsd: 0.4, mode: "block", warnPct: 80 } });
  assert.ok(s.ok, JSON.stringify(s));
  const u = await api("/usage");
  assert.equal(u.data.cost.total, 0.44); assert.equal(u.data.budget.level, "over");
  const p = await page(); await p.goto(`${BASE}/`);
  await visible(p, "Бюджет исчерпан"); await visible(p, "$0.44 / $0.4");
  await p.goto(`${BASE}/settings`); await visible(p, "Блокировать вызовы");
  await api("/settings", "PUT", { budget: { monthlyUsd: 0 } });
  assert.deepEqual(p.errors, []); await p.close();
});

test("Исследование: прежний снимок доступен как архив без пересчёта", async () => {
  const p=await page();const legacy={...fx('research'),id:'abcdef12'};
  await p.route('**/api/research/runs/abcdef12',r=>r.fulfill({json:{ok:true,data:legacy}}));
  await p.goto(`${BASE}/research?legacy=abcdef12`);
  await p.getByTestId('research-legacy').waitFor();
  await visible(p,'Архив · неподтверждённые оценки');
  const [download]=await Promise.all([p.waitForEvent('download'),p.getByRole('button',{name:'Архивный JSON',exact:true}).click()]);
  assert.deepEqual(JSON.parse(fs.readFileSync(await download.path(),'utf8')),legacy);
  assert.deepEqual(p.errors,[]);await p.close();
});
test("Аномалии: пороги, группировка каналов, пресет и переход в анализ", async () => {
  const p = await page(); await p.goto(`${BASE}/anomalies`);
  await p.locator('[data-testid="anomaly-explainer"]').waitFor();
  await p.getByLabel("Запрос").fill("истории жизни");
  await p.getByRole("button", { name: "Быстрый взлёт: 7 дней", exact: true }).click();
  await p.getByRole("button", { name: "Найти", exact: true }).click();
  await p.locator('[data-testid="anomaly-channels"]').waitFor();
  assert.equal(posted.research.mode, "anomalies");
  assert.equal(posted.research.order, "viewCount");
  assert.equal(posted.research.filters.subsMax, 10000);
  assert.equal(posted.research.filters.viewsMin, 50000);
  assert.equal(posted.research.filters.ratioMin, 10);
  assert.equal(posted.research.filters.ageDays, 7);
  assert.equal(posted.research.filters.outlierMin, undefined);
  assert.equal(posted.research.pages, 2);
  assert.equal(await p.locator('[data-testid="anomaly-channels"] > div').count(), 1);
  await visible(p, "найдено аномалий: 2");
  await p.getByRole("button", { name: "Видео", exact: true }).click();
  await p.locator('[data-testid="research-rows"]').waitFor();
  assert.equal(await p.locator('[data-testid="research-rows"] > div').count(), 2);
  await p.getByRole("button", { name: "Каналы", exact: true }).click();
  if (process.env.TS_SHOTS) {
    fs.mkdirSync(process.env.TS_SHOTS, { recursive: true });
    await p.screenshot({ path: path.join(process.env.TS_SHOTS, "anomalies-desktop.png"), fullPage: true });
  }
  await p.getByRole("button", { name: "Анализ канала", exact: true }).click();
  await p.waitForURL(/\/analysis\?channel=/);
  assert.equal(await ph(p, "https://youtube.com/@channel").inputValue(), "UC1");
  assert.deepEqual(p.errors, []); await p.close();
});
test("Аномалии: пустая выдача на мобильном экране", async () => {
  const p = await page({ width: 390, height: 844 });
  await p.route("**/api/jobs/mock-anomalies/stream", (route) => route.fulfill({
    headers: { "content-type": "text/event-stream" },
    body: `event: done\ndata: ${JSON.stringify({ type: "done", data: { ...fx("anomalies"), rows: [], stats: { ...fx("anomalies").stats, shown: 0 } } })}\n\n`,
  }));
  await p.goto(`${BASE}/anomalies`);
  await p.getByLabel("Запрос").fill("узкая ниша");
  await p.getByRole("button", { name: "Найти", exact: true }).click();
  await visible(p, "Под фильтры ничего не попало");
  await visible(p, "Попробуйте 90 дней");
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.TS_SHOTS) await p.screenshot({ path: path.join(process.env.TS_SHOTS, "anomalies-mobile.png"), fullPage: true });
  assert.deepEqual(p.errors, []); await p.close();
});
test("Ключевые слова: прежний архив читается без новой генерации", async () => {
  const p = await page(); await p.goto(`${BASE}/keywords?legacy=abcdef12`);
  await visible(p, "Архив · неподтверждённые оценки");
  await p.getByTestId("keyword-legacy").getByText("психология отношений",{exact:true}).waitFor();
  assert.equal(posted.keywords, undefined);
  assert.deepEqual(p.errors, []); await p.close();
});
test("Конкуренты и настройки исследования", async () => {
  const p = await page(); await p.goto(`${BASE}/competitors`);
  await visible(p, "Пока никого не отслеживаете");
  await visible(p, "Тренд-алерты");
  await p.goto(`${BASE}/settings#research`);
  await p.locator('[data-testid="research-settings"]').waitFor();
  await visible(p, "Правило «вирусного потенциала»");
  assert.deepEqual(p.errors, []); await p.close();
});

test("Комментарии: архив старого анализа без повторного AI", async () => {
  const p = await page(); await p.goto(`${BASE}/comments?legacy=abcdef12`);
  await visible(p, "Архивный AI-разбор · неподтверждённая методика");
  await visible(p, fx("comments").ideas[0].title);
  assert.equal(posted.comments, undefined);
  assert.deepEqual(p.errors, []); await p.close();
});
test("Перед публикацией: оценка упаковки", async () => {
  const p = await page(); await p.goto(`${BASE}/check/scorecard`);
  await p.getByLabel("Заголовок").fill("Психология сна: почему мы забываем сны через 5 минут");
  await p.getByLabel("Целевые ключи").fill("психология сна, почему забываем сны");
  await p.getByLabel("Теги").fill("сны, психология сна");
  await p.getByRole("button", { name: /Оценить/ }).click();
  await p.locator('[data-testid="scorecard-result"]').waitFor();
  await visible(p, fx("scorecard").altTitles[0]);
  assert.deepEqual(posted.scorecard.keywords, ["психология сна", "почему забываем сны"]);
  assert.deepEqual(posted.scorecard.tags, ["сны", "психология сна"]);
  assert.equal(await p.locator('[data-testid="area-thumbnail"]').count(), 0);
  assert.deepEqual(p.errors, []); await p.close();
});
test("Дайджест конкурентов и страница расширения", async () => {
  const p = await page(); const d = fx("digest");
  await p.route("**/api/competitors/digests", (r) => r.fulfill({ json: { ok: true, data: [{ id: d.id, createdAt: d.createdAt, days: d.days, auto: false, topics: d.topics.length, hits: d.videos.length }] } }));
  await p.route(`**/api/competitors/digests/${d.id}`, (r) => r.fulfill({ json: { ok: true, data: d } }));
  await p.goto(`${BASE}/competitors`);
  await visible(p, d.topics[0].title);
  assert.equal(await p.locator('[data-testid="digest-topic"]').count(), d.topics.length);
  await p.goto(`${BASE}/extension`);
  await visible(p, "Установка — 1 минута");
  const res = await p.request.get(`${BASE}/api/ext/download`);
  assert.equal(res.status(), 200); assert.match(res.headers()["content-type"], /zip/);
  assert.deepEqual(p.errors, []); await p.close();
});

test("Одна кнопка: запуск, пауза после сценария, продолжить", async () => {
  const p = await page(); await p.goto(`${BASE}/pipeline`);
  await p.getByRole("textbox", { name: /^Тема/ }).fill("Почему в Риме не было мыла");
  await p.getByRole("checkbox", { name: "Видео-черновик", exact: true }).check();
  await p.getByLabel("Пауза после «SEO»").click();
  await p.getByRole("button", { name: /Запустить/ }).click();
  await p.locator('[data-testid="pipeline-paused"]').waitFor();
  assert.deepEqual(posted.pipeline.stages, ["script", "rater", "seo", "thumbnail", "storyboard", "video"]);
  assert.deepEqual(posted.pipeline.pauseAfter, ["script", "seo"]);
  assert.equal(posted.pipeline.video.images, 10);
  await p.getByRole("button", { name: /Продолжить/ }).click();
  await visible(p, "MP4 1280×720 · 348 с · 10 сцен");
  assert.equal(await p.locator('[data-testid="pipeline-paused"]').count(), 0);
  assert.deepEqual(p.errors, []); await p.close();
});
test("Видео и Shorts: черновик и Shorts из проекта", async () => {
  const pr = await (await fetch(`${BASE}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Римляне без мыла" }) })).json();
  const id = pr.data.id;
  await fetch(`${BASE}/api/projects/${id}/artifacts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "script", title: "Сценарий", data: { script: "Текст. ".repeat(200) } }) });
  await fetch(`${BASE}/api/projects/${id}/artifacts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "audio", title: "Озвучка · Римляне", data: { url: "/files/x/v.mp3", seconds: 348, segments: [] } }) });
  const p = await page();
  await p.route("**/api/pipeline/meta", (r) => r.fulfill({ json: { ok: true, data: { stages: [], ffmpeg: true } } }));
  await p.goto(`${BASE}/video?projectId=${id}`);
  await p.getByLabel("Картинок сцен").fill("4");
  await p.getByRole("button", { name: /Собрать видео/ }).click();
  await p.locator('[data-testid="draft-result"]').waitFor();
  await visible(p, "10 сцен · текстовые карточки");
  assert.equal(posted.draft.projectId, id); assert.equal(posted.draft.images, 4); assert.equal(posted.draft.subtitles, true);
  await p.getByRole("button", { name: /Сделать Shorts/ }).click();
  await p.locator('[data-testid="shorts-result"]').waitFor();
  await visible(p, fx("shorts").shorts[1].title);
  assert.equal(posted.shorts.count, 3); assert.equal(posted.shorts.video, false);
  assert.deepEqual(p.errors, []); await p.close();
});
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

test("Обслуживание: общие очереди, подтверждение очистки кеша и сохранность данных (390 px)", async () => {
  assert.equal((await fetch(`${BASE}/api/system/cache/clear`, { method: "POST" })).status, 200);
  fs.mkdirSync(path.join(dataDir, "cache"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "cache", "runtime-test.json"), JSON.stringify({ at: Date.now(), v: "mock cache" }));
  const project = await (await fetch(`${BASE}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Не удалять при очистке" }) })).json();
  const p = await page({ width: 390, height: 844 }); await p.goto(`${BASE}/settings`);
  const card = p.getByTestId("maintenance"); await card.scrollIntoViewIfNeeded();
  await card.getByText(/Текст \/ распознавание: 0\/2/).waitFor();
  assert.match(await card.innerText(), /Изображения: 0\/3/); assert.match(await card.innerText(), /Озвучка: 0\/1/);
  p.once("dialog", d => d.dismiss()); await card.getByRole("button", { name: "Очистить кеш", exact: true }).click();
  assert.ok(fs.existsSync(path.join(dataDir, "cache", "runtime-test.json")));
  p.once("dialog", d => { assert.match(d.message(), /квоту YouTube/); return d.accept(); });
  await card.getByRole("button", { name: "Очистить кеш", exact: true }).click();
  await card.getByText(/^Удалено файлов кеша: 1\./).waitFor(); assert.match(await card.innerText(), /Удалено файлов кеша: 1/);
  assert.equal(fs.existsSync(path.join(dataDir, "cache", "runtime-test.json")), false);
  assert.equal((await (await fetch(`${BASE}/api/projects/${project.data.id}`)).json()).data.title, "Не удалять при очистке");
  assert.equal((await p.request.get(`${BASE}/api/system/runtime`)).status(), 200);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const artifacts = process.env.TEST_ARTIFACTS_DIR ?? path.join(os.tmpdir(), "tubestudio-test-artifacts");
  fs.mkdirSync(artifacts, { recursive: true });
  await card.screenshot({ path: path.join(artifacts, "maintenance-mobile.png") });
  assert.deepEqual(p.errors, []); await p.close();
});

test("Отмена до получения jobId: поздняя задача отменяется, SSE не открывается", async () => {
  const p = await page(); let release, seen, cancelled, streams = 0;
  const gate = new Promise(r => release = r), sent = new Promise(r => seen = r), stopped = new Promise(r => cancelled = r);
  await p.route("**/api/topics", async r => { seen(); await gate; await r.fulfill({ json: { ok: true, data: { jobId: "late-start" } } }); });
  await p.route("**/api/jobs/late-start/cancel", async r => { await r.fulfill({ json: { ok: true, data: { cancelled: true } } }); cancelled(); });
  await p.route("**/api/jobs/late-start/stream", r => { streams++; return r.abort(); });
  await p.goto(`${BASE}/topics`); await ph(p, "древние люди").fill("история Рима");
  await ph(p, "Например: документальный").fill("Документальные истории Рима");
  await p.getByRole("button", { name: /Найти темы/ }).click(); await sent;
  await p.getByRole("button", { name: "Остановить", exact: true }).click(); release();
  await Promise.race([stopped, new Promise((_r, reject) => setTimeout(() => reject(new Error("late job not cancelled")), 5000))]);
  assert.equal(streams, 0); assert.equal(await p.getByRole("button", { name: /Найти темы/ }).isEnabled(), true); assert.deepEqual(p.errors, []); await p.close();
});

test("Niche Finder: поиск, неизвестные метрики, фильтры, JSON и явное добавление конкурента", async () => {
  const p = await page(); let tracked = null;
  await p.route("**/api/competitors", async r => { if (r.request().method() === "POST") { tracked = r.request().postDataJSON(); return r.fulfill({ json: { ok: true, data: {} } }); } return r.continue(); });
  await p.goto(`${BASE}/niches`);
  await p.getByLabel("Тема поиска", { exact: true }).fill("история быта");
  await p.getByRole("button", { name: "Найти похожие каналы", exact: true }).click();
  await p.getByTestId("niches-result").waitFor();
  assert.equal(posted.niches.q, "история быта"); assert.equal(posted.niches.language, "ru"); assert.equal(tracked, null);
  assert.equal(await p.getByTestId("niche-channel").count(), 2);
  await visible(p, "Монетизация"); await visible(p, "неизвестна"); await visible(p, "Не удалось получить загрузки");
  await p.getByLabel("Подписчики до", { exact: true }).fill("5000");
  assert.equal(await p.getByTestId("niche-channel").count(), 1);
  await p.getByLabel("Средние просмотры от", { exact: true }).fill("15000"); await visible(p, "Показано 0 из 2");
  await p.getByLabel("Средние просмотры от", { exact: true }).fill("");
  const dl = p.waitForEvent("download"); await p.getByRole("button", { name: "Скачать JSON" }).click();
  const downloaded = await dl; const json = JSON.parse(fs.readFileSync(await downloaded.path(), "utf8"));
  assert.equal(json.id, fx("niches").id); assert.equal(json.rows.length, 2); assert.equal(json.rows[1].subscribers, null);
  assert.equal(await p.getByRole("link", { name: "Анализ канала →" }).getAttribute("href"), `/analysis?channel=${fx("niches").rows[0].id}`);
  await p.getByRole("button", { name: "В конкуренты", exact: true }).click(); await visible(p, "В трекере");
  assert.deepEqual(tracked, { channel: fx("niches").rows[0].id }); assert.deepEqual(p.errors, []); await p.close();
});
test("Niche Finder: исходный канал, все языки и мобильная ширина 390 px", async () => {
  const p = await page({ width: 390, height: 844 }); await p.goto(`${BASE}/niches`);
  await p.getByLabel("Язык поиска", { exact: true }).waitFor();
  assert.equal(await p.getByLabel("Язык поиска", { exact: true }).locator("option").count(), 19);
  await p.getByLabel("Режим поиска", { exact: true }).selectOption("channel");
  await p.getByLabel("Исходный канал", { exact: true }).fill("@example");
  await p.getByLabel("Язык поиска", { exact: true }).selectOption("he");
  await p.getByLabel("Каналов из поиска", { exact: true }).selectOption("20");
  await p.getByLabel("Последних загрузок / канал", { exact: true }).selectOption("50");
  await p.getByLabel("Тип видео в выборке", { exact: true }).selectOption("shorts");
  await p.getByRole("switch", { name: /Обновить данные/ }).click();
  await p.getByRole("button", { name: "Найти похожие каналы", exact: true }).click(); await p.getByTestId("niches-result").waitFor();
  assert.equal(posted.niches.channel, "@example"); assert.equal(posted.niches.q, ""); assert.equal(posted.niches.language, "he"); assert.equal(posted.niches.limit, 20); assert.equal(posted.niches.sample, 50); assert.equal(posted.niches.type, "shorts"); assert.equal(posted.niches.force, true);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const artifacts = process.env.TEST_ARTIFACTS_DIR ?? path.join(os.tmpdir(), "tubestudio-test-artifacts"); fs.mkdirSync(artifacts, { recursive: true });
  await p.screenshot({ path: path.join(artifacts, "niches-mobile.png"), fullPage: true });
  await p.getByRole("link", { name: "Справка", exact: true }).click(); await p.locator("#niches").waitFor();
  assert.deepEqual(p.errors, []); await p.close();
});
test("Niche Finder: реальная история сервера открывается без новых API-поисков", async () => {
  const fixture = fx("niches"); fs.mkdirSync(path.join(dataDir, "niche-runs"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "niche-runs", fixture.id + ".json"), JSON.stringify(fixture));
  const p = await page(); let searches = 0;
  await p.route("**/api/niches", r => { searches++; return r.abort(); });
  await p.goto(`${BASE}/niches`);
  await p.getByRole("button", { name: /история быта.*2 каналов/ }).click();
  await p.getByTestId("niches-result").waitFor(); assert.equal(searches, 0);
  await visible(p, "Сравнение сохранено"); assert.deepEqual(p.errors, []); await p.close();
});
test("Niche Finder: ошибка API видна пользователю, завершённого результата нет", async () => {
  const p = await page();
  await p.route("**/api/niches", r => r.fulfill({ status: 429, json: { ok: false, error: { code: "YT_QUOTA", message: "Тест: квота YouTube исчерпана" } } }));
  await p.goto(`${BASE}/niches`); await p.getByLabel("Тема поиска", { exact: true }).fill("история");
  await p.getByRole("button", { name: "Найти похожие каналы", exact: true }).click(); await visible(p, "Тест: квота YouTube исчерпана");
  assert.equal(await p.getByTestId("niches-result").count(), 0); assert.deepEqual(p.errors, []); await p.close();
});
test("Niche Finder: настоящий HTTP-маршрут создаёт задачу, отсутствие ключа приходит через SSE", async () => {
  const response = await fetch(`${BASE}/api/niches`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: "offline test" }) });
  assert.equal(response.status, 200); const body = await response.json(); assert.ok(body.data.jobId);
  const stream = await fetch(`${BASE}/api/jobs/${body.data.jobId}/stream`);
  const events = await stream.text(); assert.match(events, /event: error/); assert.match(events, /KEY_MISSING/); assert.doesNotMatch(events, /event: done/);
  assert.equal(fs.existsSync(path.join(dataDir, "niche-runs", body.data.jobId + ".json")), false);
});

test("Транскрипты: ссылка, языки, исходник/таймкоды и JSON без автоматического AI", async () => {
  const p = await page(); let ai = 0; await p.route("**/api/transcripts/analyze", r => { ai++; return r.abort(); });
  await p.goto(`${BASE}/transcripts`);
  await p.getByLabel("Язык субтитров", { exact: true }).waitFor();
  assert.equal(await p.getByLabel("Язык субтитров", { exact: true }).locator("option").count(), 19);
  await p.getByLabel("Ссылка на видео", { exact: true }).fill("https://youtu.be/abcdefghijk");
  await p.getByLabel("Язык субтитров", { exact: true }).selectOption("ru");
  await p.getByRole("button", { name: "Получить субтитры", exact: true }).click(); await p.getByTestId("transcript-result").waitFor();
  assert.equal(posted["transcript-source"].url, "https://youtu.be/abcdefghijk"); assert.equal(ai, 0);
  await visible(p, "Автоматические субтитры"); assert.equal(await p.getByRole("link", { name: "00:01", exact: true }).getAttribute("href"), "https://www.youtube.com/watch?v=abcdefghijk&t=1s");
  const dl = p.waitForEvent("download"); await p.getByRole("button", { name: "JSON", exact: true }).click(); const d = await dl; const json = JSON.parse(fs.readFileSync(await d.path(), "utf8")); assert.deepEqual(json, fx("transcript-source"));
  assert.deepEqual(p.errors, []); await p.close();
});
test("Транскрипты: явный summary/remix, сохранённый источник, фактическая модель и экспорт сценария", async () => {
  const p = await page(); await p.goto(`${BASE}/transcripts`);
  await p.getByLabel("Источник текста", { exact: true }).selectOption("text"); await p.getByLabel("Название исходника", { exact: true }).fill("Моя вставка");
  await p.getByLabel("Текст источника", { exact: true }).fill("Введённый исходник"); await p.getByRole("button", { name: "Сохранить и разобрать текст", exact: true }).click(); await p.getByTestId("transcript-result").waitFor();
  assert.equal(posted["transcript-source"].text, "Введённый исходник"); assert.equal(posted["transcript-source"].kind, "text");
  await p.getByLabel("Текст источника", { exact: true }).fill("НЕСОХРАНЁННАЯ ПРАВКА");
  assert.equal(await p.getByLabel("Язык результата", { exact: true }).locator("option").count(), 19);
  await p.getByLabel("Язык результата", { exact: true }).selectOption("he"); await p.getByLabel("Цель сценария, слов", { exact: true }).selectOption("1500"); await p.getByLabel("Новый ракурс (для сценария)", { exact: true }).fill("Для новичков");
  await p.getByRole("button",{name:"Предпросмотр AI-запроса",exact:true}).click();await p.getByTestId("transcript-preview").waitFor();
  await p.getByRole("button", { name: "Краткий разбор (AI)", exact: true }).click(); await p.getByTestId("transcript-analysis").waitFor();
  assert.equal(posted["transcript-analysis"].id, fx("transcript-source").id); assert.equal(posted["transcript-analysis"].mode, "summary"); assert.equal(posted["transcript-analysis"].language, "he");
  await visible(p, "test-fixture-model"); await visible(p, "Внешняя проверка фактов не выполнялась");
  await p.getByLabel("Задача AI",{exact:true}).selectOption("remix");await p.getByRole("button",{name:"Предпросмотр AI-запроса",exact:true}).click();await p.getByRole("button", { name: "Новый сценарий (AI)", exact: true }).click(); await p.getByLabel("Новый сценарий — результат", { exact: true }).waitFor();
  assert.equal(posted["transcript-analysis"].id, fx("transcript-summary").id); assert.equal(posted["transcript-analysis"].words, 1500); assert.equal(posted["transcript-analysis"].angle, "Для новичков");
  assert.equal(await p.getByLabel("Новый сценарий — результат", { exact: true }).inputValue(), fx("transcript-remix").analysis.script);
  const dl = p.waitForEvent("download"); await p.getByRole("button", { name: "Сценарий TXT", exact: true }).click(); const d = await dl; assert.equal(fs.readFileSync(await d.path(), "utf8"), fx("transcript-remix").analysis.script);
  const md = p.waitForEvent("download"); await p.getByRole("button", { name: "Разбор Markdown", exact: true }).click(); const m = await md; const markdown = fs.readFileSync(await m.path(), "utf8"); assert.match(markdown, /test-fixture-model/); assert.match(markdown, /Факты внешне не проверены/);
  await p.getByRole("button", { name: "Редактировать как новый текст", exact: true }).click(); assert.equal(await p.getByLabel("Текст источника", { exact: true }).inputValue(), fx("transcript-source").text);
  assert.deepEqual(p.errors, []); await p.close();
});
test("Транскрипты: UTF-8 VTT, ошибки кодировки/размера и мобильная ширина 390 px", async () => {
  const p = await page({ width: 390, height: 844 }); await p.goto(`${BASE}/transcripts`); await p.getByLabel("Источник текста", { exact: true }).selectOption("file");
  const file = p.getByLabel("Файл субтитров или текста", { exact: true });
  await file.setInputFiles({ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from([0xff, 0xfe]) }); await visible(p, "Не удалось прочитать UTF-8");
  await file.setInputFiles({ name: "big.txt", mimeType: "text/plain", buffer: Buffer.alloc(1024 * 1024 + 1, 65) }); await visible(p, "Файл больше 1 МиБ");
  const content = "WEBVTT\n\n00:01.000 --> 00:03.000\nעברית 日本語";
  await file.setInputFiles({ name: "captions.vtt", mimeType: "text/vtt", buffer: Buffer.from(content) }); await visible(p, "captions.vtt");
  await p.getByRole("button", { name: "Сохранить и разобрать текст", exact: true }).click(); await p.getByTestId("transcript-result").waitFor();
  assert.equal(posted["transcript-source"].format, "vtt"); assert.equal(posted["transcript-source"].text, content); assert.equal(posted["transcript-source"].filename, "captions.vtt");
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const artifacts = process.env.TEST_ARTIFACTS_DIR ?? path.join(os.tmpdir(), "tubestudio-test-artifacts"); fs.mkdirSync(artifacts, { recursive: true });
  await p.screenshot({ path: path.join(artifacts, "transcripts-mobile.png"), fullPage: true });
  await p.getByRole("link", { name: "Справка", exact: true }).click(); await p.locator("#transcripts").waitFor();
  assert.deepEqual(p.errors, []); await p.close();
});
test("Транскрипты: история сервера открывается без YouTube и AI, длинный источник не обрезается", async () => {
  const fixture = { ...fx("transcript-source"), text: "x".repeat(60001), source: { kind: "text", title: "Длинный сохранённый исходник", format: "txt" } };
  fs.mkdirSync(path.join(dataDir, "transcript-runs"), { recursive: true }); fs.writeFileSync(path.join(dataDir, "transcript-runs", fixture.id + ".json"), JSON.stringify(fixture));
  const p = await page(); let posts = 0; await p.route("**/api/transcripts", r => { posts++; return r.abort(); }); await p.route("**/api/transcripts/analyze", r => { posts++; return r.abort(); });
  await p.goto(`${BASE}/transcripts`); await p.getByRole("button", { name: /Длинный сохранённый исходник.*исходник/ }).click(); await p.getByTestId("transcript-result").waitFor();
  assert.equal(posts, 0); assert.equal(await p.getByRole("button", { name: "Краткий разбор (AI)", exact: true }).isDisabled(), true); await visible(p, "Источник вне диапазона AI");
  const dl = p.waitForEvent("download"); await p.getByRole("button", { name: "Исходник TXT", exact: true }).click(); const d = await dl; assert.equal(fs.readFileSync(await d.path(), "utf8").length, 60001);
  assert.deepEqual(p.errors, []); await p.close();
});
test("Транскрипты: отказ YouTube предлагает ручной путь и не рисует выдуманный результат", async () => {
  const p = await page(); await p.route("**/api/transcripts", r => r.fulfill({ status: 502, json: { ok: false, error: { code: "UPSTREAM", message: "Тест: субтитры недоступны. Можно вставить текст или загрузить TXT/SRT/VTT вручную." } } }));
  await p.goto(`${BASE}/transcripts`); await p.getByLabel("Ссылка на видео", { exact: true }).fill("https://youtu.be/abcdefghijk"); await p.getByRole("button", { name: "Получить субтитры", exact: true }).click(); await visible(p, "Тест: субтитры недоступны"); assert.equal(await p.getByTestId("transcript-result").count(), 0);
  await p.getByLabel("Источник текста", { exact: true }).selectOption("text"); await p.getByLabel("Текст источника", { exact: true }).waitFor(); assert.deepEqual(p.errors, []); await p.close();
});
test("Транскрипты: настоящий локальный импорт/SSE работает без ключа; AI без ключа не сохраняет разбор", async () => {
  const text = "Проверка локального исходника. ".repeat(10);
  const response = await fetch(`${BASE}/api/transcripts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "text", text, title: "Локальный импорт" }) }); assert.equal(response.status, 200); const body = await response.json();
  const events = await (await fetch(`${BASE}/api/jobs/${body.data.jobId}/stream`)).text(); assert.match(events, /event: done/); assert.doesNotMatch(events, /event: error/);
  const done = events.split("\n").filter(s => s.startsWith("data:")).map(s => JSON.parse(s.slice(5))).find(e => e.type === "done"); const r = done.data; assert.equal(r.text, text.trim()); assert.equal(r.segments[0].start, null);
  const stored = await (await fetch(`${BASE}/api/transcript-runs/${r.id}`)).json(); assert.deepEqual(stored.data, r);
  const preview=await(await fetch(`${BASE}/api/transcripts/preview`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:r.id,mode:"summary"})})).json();
  const ai = await (await fetch(`${BASE}/api/transcripts/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: r.id, mode: "summary", previewHash:preview.data.hash }) })).json();
  const aiEvents = await (await fetch(`${BASE}/api/jobs/${ai.data.jobId}/stream`)).text(); assert.match(aiEvents, /KEY_MISSING/); assert.doesNotMatch(aiEvents, /event: done/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "transcript-runs", r.id + ".json"), "utf8")).analysis, undefined);
});

async function createCoachHttp(input = {}) {
  const res = await fetch(`${BASE}/api/coach/conversations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  assert.equal(res.status, 200); return (await res.json()).data;
}
test("AI Coach: реальный локальный контекст, явная отправка, история, модель и экспорт", async () => {
  const report = { ...fx("analysis"), id: randomUUID(), createdAt: new Date().toISOString() };
  fs.mkdirSync(path.join(dataDir, "reports"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "reports", report.id + ".json"), JSON.stringify(report));
  fs.writeFileSync(path.join(dataDir, "reports", "index.json"), JSON.stringify([{ id: report.id, title: report.channel.title, createdAt: report.createdAt }]));
  const project = (await (await fetch(`${BASE}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Coach test project" }) })).json()).data;
  await fetch(`${BASE}/api/projects/${project.id}/artifacts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "script", title: "Latest script", data: { script: "PINNED_SCRIPT_TEXT" } }) });
  const p = await page(); const calls = [], snapshots = new Map(); let result;
  await p.route("**/api/coach/ask", async route => {
    const input = route.request().postDataJSON(); calls.push(input);
    const c = snapshots.get(input.id) ?? (await (await fetch(`${BASE}/api/coach/runs/${input.id}`)).json()).data;
    const now = new Date().toISOString(); result = { ...c, id: randomUUID(), parentId: c.id, updatedAt: now, messages: [...c.messages, { role: "user", text: input.question, at: now, language: input.language }, { role: "assistant", text: "Тестовый совет <script>window.coachInjected=1</script>", at: now, language: input.language, model: "mock-coach-model" }] };
    const preview = (await (await fetch(`${BASE}/api/coach/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) })).json()).data;
    result.lastRequest = preview;
    fs.writeFileSync(path.join(dataDir, "coach-runs", result.id + ".json"), JSON.stringify(result));
    snapshots.set(result.id, result);
    await route.fulfill({ json: { ok: true, data: { jobId: "mock-coach-answer" } } });
  });
  await p.route("**/api/jobs/mock-coach-answer/stream", route => route.fulfill({ headers: { "content-type": "text/event-stream" }, body: `event: done\ndata: ${JSON.stringify({ type: "done", data: result })}\n\n` }));
  await p.goto(`${BASE}/coach`);
  await p.getByLabel("Сохранённый анализ канала", { exact: true }).selectOption(report.id);
  await p.getByLabel("Проект для контекста", { exact: true }).selectOption(project.id);
  await p.getByLabel("Название диалога", { exact: true }).fill("Coach browser context");
  await p.getByRole("button", { name: "Создать диалог с этим контекстом", exact: true }).click();
  await p.getByTestId("coach-context").waitFor(); assert.equal(calls.length, 0);
  const context = JSON.parse(await p.getByTestId("coach-context").innerText()); assert.equal(context.sources.length, 2); assert.equal(context.data.project.latestScript.text, "PINNED_SCRIPT_TEXT");
  assert.equal(await p.getByLabel("Язык ответа", { exact: true }).locator("option").count(), 19);
  await p.getByLabel("Язык ответа", { exact: true }).selectOption("he");
  await p.getByLabel("Вопрос AI Coach", { exact: true }).fill("Что проверить первым?");
  await p.getByRole("button", { name: "Предпросмотр запроса", exact: true }).click(); await p.getByTestId("coach-preview").waitFor(); await p.getByRole("button", { name: "Отправить в AI", exact: true }).click(); await p.getByTestId("coach-assistant").waitFor();
  assert.equal(calls[0].previewHash.length, 64); assert.equal(calls[0].language, "he"); await visible(p, "mock-coach-model"); assert.equal(await p.evaluate(() => window.coachInjected), undefined);
  const previousId = result.id;
  await p.getByLabel("Сохранённый анализ канала", { exact: true }).selectOption("");
  await p.getByLabel("Вопрос AI Coach", { exact: true }).fill("А что проверить затем?"); await p.getByRole("button", { name: "Предпросмотр запроса", exact: true }).click(); await p.getByTestId("coach-preview").waitFor(); await p.getByRole("button", { name: "Отправить в AI", exact: true }).click();
  await p.waitForFunction(() => document.querySelectorAll('[data-testid="coach-assistant"]').length === 2);
  assert.equal(calls[1].id, previousId); assert.equal(result.context.sources.length, 2);
  const dl = p.waitForEvent("download"); await p.getByRole("button", { name: "Диалог JSON", exact: true }).click(); const d = await dl; const exported = JSON.parse(fs.readFileSync(await d.path(), "utf8")); assert.deepEqual(exported.lastRequest, result.lastRequest); assert.equal(exported.messages.length, 4); assert.equal(exported.context.data.project.latestScript.text, "PINNED_SCRIPT_TEXT");
  const md = p.waitForEvent("download"); await p.getByRole("button", { name: "Диалог Markdown", exact: true }).click(); const m = await md; assert.match(fs.readFileSync(await m.path(), "utf8"), /mock-coach-model/);
  assert.deepEqual(p.errors, []); await p.close();
});
test("AI Coach: 390 px, общий диалог и ошибка не теряет вопрос", async () => {
  const p = await page({ width: 390, height: 844 });
  await p.route("**/api/coach/ask", route => route.fulfill({ status: 502, json: { ok: false, error: { code: "UPSTREAM", message: "Тест: провайдер недоступен" } } }));
  await p.goto(`${BASE}/coach`); await p.getByRole("button", { name: "Создать диалог с этим контекстом", exact: true }).click();
  await p.getByTestId("coach-context").waitFor(); await visible(p, "Источники не выбраны");
  await p.getByLabel("Вопрос AI Coach", { exact: true }).fill("Как спланировать выпуск?"); await p.getByRole("button", { name: "Предпросмотр запроса", exact: true }).click(); await p.getByTestId("coach-preview").waitFor(); await p.getByRole("button", { name: "Отправить в AI", exact: true }).click(); await visible(p, "Тест: провайдер недоступен");
  assert.equal(await p.getByLabel("Вопрос AI Coach", { exact: true }).inputValue(), "Как спланировать выпуск?"); assert.equal(await p.getByTestId("coach-assistant").count(), 0);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const artifacts = process.env.TEST_ARTIFACTS_DIR ?? os.tmpdir(); fs.mkdirSync(artifacts, { recursive: true }); await p.screenshot({ path: path.join(artifacts, "coach-mobile.png"), fullPage: true });
  await p.getByRole("button", { name: "Создать диалог с этим контекстом", exact: true }).click();
  await p.waitForFunction(() => !document.body.innerText.includes("Тест: провайдер недоступен"));
  assert.deepEqual(p.errors, []); await p.close();
});
test("AI Coach: история локальна, восемь ответов блокируют новую отправку", async () => {
  const c = await createCoachHttp({ title: "Coach limit history" }); const at = new Date().toISOString();
  c.messages = Array.from({ length: 16 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `Message ${i}`, at, ...(i % 2 ? { model: "history-model" } : {}) }));
  fs.writeFileSync(path.join(dataDir, "coach-runs", c.id + ".json"), JSON.stringify(c));
  const p = await page(); let calls = 0; await p.route("**/api/coach/ask", r => { calls++; return r.abort(); });
  await p.goto(`${BASE}/coach`); await p.getByRole("button", { name: /Coach limit history.*8 ответов/ }).click(); await visible(p, "Лимит 8 ответов достигнут");
  assert.equal(await p.getByRole("button", { name: "Отправить в AI", exact: true }).isDisabled(), true); assert.equal(calls, 0); assert.equal(await p.getByTestId("coach-assistant").count(), 8);
  assert.deepEqual(p.errors, []); await p.close();
});
test("AI Coach: настоящий HTTP/SSE без ключа не создаёт ответ и сохраняет исходный снимок", async () => {
  const c = await createCoachHttp({ title: "Offline coach HTTP" });
  const preview = (await (await fetch(`${BASE}/api/coach/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: c.id, question: "Какие шаги дальше?", language: "ru" }) })).json()).data;
  const response = await fetch(`${BASE}/api/coach/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: c.id, question: "Какие шаги дальше?", language: "ru", previewHash: preview.hash }) });
  assert.equal(response.status, 200); const body = await response.json(); const events = await (await fetch(`${BASE}/api/jobs/${body.data.jobId}/stream`)).text();
  assert.match(events, /KEY_MISSING/); assert.doesNotMatch(events, /event: done/);
  const stored = (await (await fetch(`${BASE}/api/coach/runs/${c.id}`)).json()).data; assert.deepEqual(stored, c);
});

test("AI Coach: предпросмотр без AI, изменение вопроса и языка блокирует отправку, старый снимок честен", async () => {
  const p = await page(); let calls = 0; await p.route("**/api/coach/ask", r => { calls++; return r.abort(); });
  await p.goto(`${BASE}/coach`); await p.getByRole("button", { name: "Создать диалог с этим контекстом", exact: true }).click();
  await p.getByTestId("coach-context").waitFor(); await p.getByTestId("coach-request-unavailable").waitFor();
  await p.getByLabel("Вопрос AI Coach", { exact: true }).fill("Что проверить?");
  const send = p.getByRole("button", { name: "Отправить в AI", exact: true }), prep = p.getByRole("button", { name: "Предпросмотр запроса", exact: true });
  assert.equal(await send.isDisabled(), true); await prep.click(); await p.getByTestId("coach-exact-request").waitFor();
  const exact = JSON.parse(await p.getByTestId("coach-exact-request").innerText()); assert.match(exact.system, /UNTRUSTED DATA/); assert.equal(JSON.parse(exact.user).question, "Что проверить?"); assert.equal(calls, 0);
  await p.getByLabel("Вопрос AI Coach", { exact: true }).fill("Другой вопрос"); assert.equal(await send.isDisabled(), true);
  await prep.click(); await p.getByTestId("coach-preview").waitFor(); await p.getByLabel("Язык ответа", { exact: true }).selectOption("he"); assert.equal(await send.isDisabled(), true);
  await prep.click(); await p.getByTestId("coach-preview").waitFor();
  const artifacts = process.env.TEST_ARTIFACTS_DIR ?? os.tmpdir(); fs.mkdirSync(artifacts, { recursive: true }); await p.screenshot({ path: path.join(artifacts, "coach-preview-desktop.png"), fullPage: true });
  assert.equal(calls, 0); assert.deepEqual(p.errors, []); await p.close();
});
test("AI Coach: остановка предпросмотра и уход не принимают поздний результат", async () => {
  const p = await page({ width: 390, height: 844 }); let release; const gate = new Promise(r => release = r); let entered = false;
  await p.route("**/api/coach/preview", async r => { entered = true; await gate; await r.fulfill({ json: { ok: true, data: { selection: { id: "late", question: "Поздний вопрос", language: "ru" }, system: "LATE_PREVIEW", user: "{}", hash: "a".repeat(64) } } }).catch(() => {}); });
  await p.goto(`${BASE}/coach`); await p.getByRole("button", { name: "Создать диалог с этим контекстом", exact: true }).click(); await p.getByTestId("coach-context").waitFor();
  await p.getByLabel("Вопрос AI Coach", { exact: true }).fill("Поздний вопрос"); await p.getByRole("button", { name: "Предпросмотр запроса", exact: true }).click();
  await p.waitForTimeout(100); assert.equal(entered, true); await p.getByRole("button", { name: "Остановить предпросмотр", exact: true }).click(); release(); await p.waitForTimeout(150);
  assert.equal(await p.getByTestId("coach-preview").count(), 0); assert.equal(await p.getByRole("button", { name: "Отправить в AI", exact: true }).isDisabled(), true);
  await p.goto(`${BASE}/daily-ideas`); await p.goto(`${BASE}/coach`); assert.equal(await p.getByTestId("coach-conversation").count(), 0); assert.deepEqual(p.errors, []); await p.close();
});

async function profitManualForm(p, { views="100000",rpm="2.5",ai="10",other="40",title="Profit browser scenario" } = {}) {
  await p.getByLabel("Название расчёта", {exact:true}).fill(title);
  await p.getByLabel("Просмотры за период", {exact:true}).fill(views);
  await p.getByLabel("RPM, USD за 1000 просмотров", {exact:true}).fill(rpm);
  await p.getByLabel("AI-затраты, USD", {exact:true}).fill(ai);
  await p.getByLabel("Прочие затраты, USD", {exact:true}).fill(other);
}
test("Прибыль: настоящий ручной расчёт, закреплённый результат, Markdown/JSON и история без AI", async()=>{
  const p=await page(); let aiCalls=0;
  await p.route("**/api/jobs/**",r=>{aiCalls++;return r.abort();});
  await p.goto(`${BASE}/profit`); await profitManualForm(p); await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click(); await p.getByTestId("profit-result").waitFor();
  assert.match(await p.getByTestId("profit-revenue").innerText(),/250/); assert.match(await p.getByTestId("profit-net").innerText(),/200/); assert.match(await p.getByTestId("profit-break-even").innerText(),/20\s*000/);
  await p.getByLabel("RPM, USD за 1000 просмотров",{exact:true}).fill("9"); assert.match(await p.getByTestId("profit-net").innerText(),/200/);
  const dl=p.waitForEvent("download");await p.getByRole("button",{name:"Расчёт JSON",exact:true}).click();const d=await dl;const r=JSON.parse(fs.readFileSync(await d.path(),"utf8")); assert.equal(r.input.rpm,2.5);assert.equal(r.result.estimatedProfit,200);assert.equal(r.workspace,null);
  const md=p.waitForEvent("download");await p.getByRole("button",{name:"Расчёт Markdown",exact:true}).click();const m=await md;assert.match(fs.readFileSync(await m.path(),"utf8"),/не реальные выплаты YouTube/);
  await p.reload();await p.getByRole("button",{name:/Profit browser scenario/}).click();await p.getByTestId("profit-result").waitFor();assert.match(await p.getByTestId("profit-net").innerText(),/200/);assert.equal(aiCalls,0);assert.deepEqual(p.errors,[]);await p.close();
});
test("Прибыль: учёт текущего месяца, все AM-токены, прямые модели, повторное чтение при сохранении",async()=>{
  const original=(await(await fetch(`${BASE}/api/settings`)).json()).data;const month=new Date().toISOString().slice(0,7);
  const ledger={month,llm:{"unit-paid":{in:1000000,out:500000,calls:1}},images:{"unit-image":2},am:{voice:1000000,"web-search":40000,orphan:460000}};
  fs.writeFileSync(path.join(dataDir,"usage.json"),JSON.stringify(ledger));
  await fetch(`${BASE}/api/settings`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({anymodel:{...original.anymodel,usdPerMillion:2},budget:{...original.budget,prices:[{match:"unit-paid",input:1,output:2,image:0},{match:"unit-image",input:0,output:0,image:.5}]}})});
  const p=await page();try{
    await p.goto(`${BASE}/profit`);await p.getByLabel("Источник расходов",{exact:true}).selectOption("workspace-month");await p.getByTestId("profit-cost-preview").getByText(/Балансовых токенов/).waitFor();
    await p.getByLabel("Название расчёта",{exact:true}).fill("Profit pinned workspace");await p.getByLabel("Просмотры за период",{exact:true}).fill("100000");await p.getByLabel("RPM, USD за 1000 просмотров",{exact:true}).fill("1");await p.getByLabel("Прочие затраты, USD",{exact:true}).fill("4");
    fs.writeFileSync(path.join(dataDir,"usage.json"),JSON.stringify({...ledger,am:{voice:3000000}}));
    await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click();await visible(p,"Обновите расходы");assert.equal(await p.getByTestId("profit-result").count(),0);await p.getByRole("button",{name:"Обновить расходы",exact:true}).click();await p.getByTestId("profit-cost-preview").getByText(/AnyModel:.*6.*прямые модели/).waitFor();await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click();await p.getByTestId("profit-result").waitFor();assert.match(await p.getByTestId("profit-net").innerText(),/87/);
    const dl=p.waitForEvent("download");await p.getByRole("button",{name:"Расчёт JSON",exact:true}).click();const d=await dl;const r=JSON.parse(fs.readFileSync(await d.path(),"utf8"));assert.equal(r.workspace.amBalanceTokens,3000000);assert.equal(r.workspace.amUsd,6);assert.equal(r.workspace.directKnownUsd,3);assert.equal(r.result.knownTotalCosts,13);assert.equal(r.period.start,month+"-01");
    fs.writeFileSync(path.join(dataDir,"usage.json"),JSON.stringify({...ledger,am:{voice:9000000}}));await p.reload();await p.getByRole("button",{name:/Profit pinned workspace/}).click();await p.getByTestId("profit-result").waitFor();assert.match(await p.getByTestId("profit-net").innerText(),/87/);
    assert.deepEqual(p.errors,[]);
  }finally{await p.close();await fetch(`${BASE}/api/settings`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(original)});}
});
test("Прибыль: неизвестная ставка не превращается в нулевые расходы или прибыль",async()=>{
  const month=new Date().toISOString().slice(0,7);fs.writeFileSync(path.join(dataDir,"usage.json"),JSON.stringify({month,llm:{"unknown-cost-unit":{in:1000,out:100,calls:1}},images:{},am:{voice:1000000}}));
  const p=await page();await p.goto(`${BASE}/profit`);await p.getByLabel("Источник расходов",{exact:true}).selectOption("workspace-month");await p.getByTestId("profit-cost-preview").getByText(/нет ставки/).waitFor();await p.getByLabel("Просмотры за период",{exact:true}).fill("10000");await p.getByLabel("RPM, USD за 1000 просмотров",{exact:true}).fill("5");await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click();await p.getByTestId("profit-result").waitFor();
  assert.equal(await p.getByTestId("profit-net").innerText(),"Неизвестно");await visible(p,"Есть неизвестные расходы");assert.equal(await p.getByTestId("profit-break-even").innerText(),"Неизвестны расходы");assert.deepEqual(p.errors,[]);await p.close();
});
test("Прибыль: нулевой RPM, убыток, мобильные 390 px и справка",async()=>{
  const p=await page({width:390,height:844});await p.goto(`${BASE}/profit`);await profitManualForm(p,{views:"0",rpm:"0",ai:"10",other:"0",title:"Profit zero RPM"});await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click();await p.getByTestId("profit-result").waitFor();
  assert.match(await p.getByTestId("profit-net").innerText(),/-10|−10/);assert.equal(await p.getByTestId("profit-break-even").innerText(),"Недостижима при RPM = 0");assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const artifacts=process.env.TEST_ARTIFACTS_DIR??os.tmpdir();fs.mkdirSync(artifacts,{recursive:true});await p.screenshot({path:path.join(artifacts,"profit-mobile.png"),fullPage:true});
  await p.getByRole("link",{name:"Справка",exact:true}).click();await p.locator("#profit").waitFor();assert.deepEqual(p.errors,[]);await p.close();
});
test("Прибыль: ошибка сохранения видна, форма и предыдущий результат не теряются",async()=>{
  const p=await page();await p.goto(`${BASE}/profit`);await profitManualForm(p,{title:"Profit retained on failure"});await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click();await p.getByTestId("profit-result").waitFor();
  await p.route("**/api/profit/calculate",r=>r.fulfill({status:400,json:{ok:false,error:{code:"VALIDATION",message:"Тест: журнал расходов повреждён"}}}));await p.getByLabel("RPM, USD за 1000 просмотров",{exact:true}).fill("3");await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click();await visible(p,"Тест: журнал расходов повреждён");assert.equal(await p.getByLabel("RPM, USD за 1000 просмотров",{exact:true}).inputValue(),"3");assert.match(await p.getByTestId("profit-net").innerText(),/200/);assert.deepEqual(p.errors,[]);await p.close();
});

function seedAdSource(name="Ad original עברית 日本語"){
 const id=randomUUID();const d={id,name,revision:4,updatedAt:new Date().toISOString(),duration:600,fragments:[{n:1,start:0,end:100,text:"До первой паузы"},{n:2,start:102,end:200,text:"Вторая фраза"},{n:3,start:204,end:400,text:"Третья фраза"},{n:4,start:403,end:600,text:"Последняя фраза"}],pauses:[{start:100,end:102},{start:200,end:204},{start:400,end:403}]};fs.mkdirSync(path.join(dataDir,"audio-storyboards"),{recursive:true});fs.writeFileSync(path.join(dataDir,"audio-storyboards",id+".json"),JSON.stringify(d));return d;
}
async function adForm(p,d,title="Ad browser plan"){
 await p.goto(`${BASE}/ad-breaks?audioId=${d.id}`);await p.getByRole("button",{name:"Подобрать и сохранить план",exact:true}).waitFor();await p.getByLabel("Название плана",{exact:true}).fill(title);await p.getByRole("button",{name:"Подобрать и сохранить план",exact:true}).click();await p.getByTestId("ad-result").waitFor();
}
test("Рекламные паузы: локальный HTTP, автоподбор, оригинальные таймкоды, TXT/Markdown/JSON и история",async()=>{
 const d=seedAdSource();const p=await page();let calls=0;await p.route("**/api/jobs/**",r=>{calls++;return r.abort();});await adForm(p,d);
 assert.match(await p.getByTestId("ad-count").innerText(),/Кандидатов: 3 · выбрано: 2/);assert.equal(await p.getByLabel("Точка 1",{exact:true}).isChecked(),false);assert.equal(await p.getByLabel("Точка 2",{exact:true}).isChecked(),true);
 const dl=p.waitForEvent("download");await p.getByRole("button",{name:"План JSON",exact:true}).click();const r=JSON.parse(fs.readFileSync(await(await dl).path(),"utf8"));assert.deepEqual(r.selectedN,[2,3]);assert.deepEqual(r.candidates.map(c=>c.at),[101,202,401.5]);assert.equal(r.source.revision,4);
 const txt=p.waitForEvent("download");await p.getByRole("button",{name:"Таймкоды TXT",exact:true}).click();const t=fs.readFileSync(await(await txt).path(),"utf8");assert.match(t,/00:03:22.000/);assert.doesNotMatch(t,/00:01:41.000/);assert.match(t,/не вставка рекламы/);
 const md=p.waitForEvent("download");await p.getByRole("button",{name:"План Markdown",exact:true}).click();assert.match(fs.readFileSync(await(await md).path(),"utf8"),/Вторая фраза/);
 fs.writeFileSync(path.join(dataDir,"audio-storyboards",d.id+".json"),JSON.stringify({...d,revision:5,pauses:[]}));await p.reload();await p.getByRole("button",{name:/Ad browser plan.*Ad original/}).click();await p.getByTestId("ad-result").waitFor();assert.match(await p.getByTestId("ad-count").innerText(),/Кандидатов: 3 · выбрано: 2/);assert.equal(calls,0);assert.deepEqual(p.errors,[]);await p.close();
});
test("Рекламные паузы: ручной выбор, блокировка экспорта, ошибка расстояния, новая версия и пустой план",async()=>{
 const d=seedAdSource("Manual pauses");const p=await page();await adForm(p,d,"Ad manual branch");await p.getByLabel("Точка 1",{exact:true}).check();assert.equal(await p.getByRole("button",{name:"План JSON",exact:true}).isDisabled(),true);
 await p.getByRole("button",{name:"Сохранить выбор",exact:true}).click();await visible(p,"Выбранные точки расположены ближе");assert.equal(await p.getByLabel("Точка 1",{exact:true}).isChecked(),true);
 await p.getByLabel("Точка 2",{exact:true}).uncheck();await p.getByRole("button",{name:"Сохранить выбор",exact:true}).click();await p.getByRole("button",{name:"План JSON",exact:true}).waitFor();await p.waitForFunction(()=>!Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="План JSON")?.disabled);
 const dl=p.waitForEvent("download");await p.getByRole("button",{name:"План JSON",exact:true}).click();const r=JSON.parse(fs.readFileSync(await(await dl).path(),"utf8"));assert.deepEqual(r.selectedN,[1,3]);assert.ok(r.parentId);assert.equal(r.rootId,r.parentId);const old=(await(await fetch(`${BASE}/api/ad-breaks/runs/${r.parentId}`)).json()).data;assert.deepEqual(old.selectedN,[2,3]);
 await p.getByLabel("Точка 1",{exact:true}).uncheck();await p.getByLabel("Точка 3",{exact:true}).uncheck();await p.getByRole("button",{name:"Сохранить выбор",exact:true}).click();await p.getByTestId("ad-count").getByText(/выбрано: 0/).waitFor();assert.deepEqual(p.errors,[]);await p.close();
});
test("Рекламные паузы: конфликт версии, отсутствие пауз и сохранность предыдущего результата",async()=>{
 const d=seedAdSource("Stale ad source");const p=await page();await adForm(p,d,"Ad retained result");fs.writeFileSync(path.join(dataDir,"audio-storyboards",d.id+".json"),JSON.stringify({...d,revision:5,pauses:[]}));await p.getByRole("button",{name:"Подобрать и сохранить план",exact:true}).click();await visible(p,"Версия аудио изменилась");assert.match(await p.getByTestId("ad-count").innerText(),/Кандидатов: 3/);
 await p.getByRole("button",{name:"Обновить список озвучек",exact:true}).click();await p.getByRole("option",{name:/Stale ad source.*версия 5/}).waitFor({state:"attached"});await p.getByRole("button",{name:"Подобрать и сохранить план",exact:true}).click();await visible(p,"Подходящих пауз нет");assert.match(await p.getByTestId("ad-count").innerText(),/Кандидатов: 0 · выбрано: 0/);assert.deepEqual(p.errors,[]);await p.close();
});
test("Рекламные паузы: несохранённый выбор защищён подтверждением, отмена восстанавливает снимок",async()=>{
 const d=seedAdSource("Discard ad source");const p=await page();await adForm(p,d,"Ad discard protection");await p.getByLabel("Точка 2",{exact:true}).uncheck();p.once("dialog",dialog=>dialog.dismiss());await p.getByRole("button",{name:/Ad discard protection.*Discard ad source/}).click();assert.equal(await p.getByLabel("Точка 2",{exact:true}).isChecked(),false);await visible(p,"Выбор не сохранён");await p.getByRole("button",{name:"Отменить выбор",exact:true}).click();assert.equal(await p.getByLabel("Точка 2",{exact:true}).isChecked(),true);assert.equal(await p.getByRole("button",{name:"План JSON",exact:true}).isEnabled(),true);assert.deepEqual(p.errors,[]);await p.close();
});
test("Рекламные паузы: мобильные 390 px, Unicode, Справка и переход к оригинальной озвучке",async()=>{
 const d=seedAdSource("Мобильный план עברית 日本語");const p=await page({width:390,height:844});await adForm(p,d,"Ad mobile plan");assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await visible(p,"После ручной правки они могут не совпадать");const artifacts=process.env.TEST_ARTIFACTS_DIR??os.tmpdir();fs.mkdirSync(artifacts,{recursive:true});await p.screenshot({path:path.join(artifacts,"ad-breaks-mobile.png"),fullPage:true});
 const link=p.getByRole("link",{name:"Открыть озвучку для проверки →",exact:true});assert.match(await link.getAttribute("href"),new RegExp(d.id));await p.getByRole("link",{name:"Справка",exact:true}).click();await p.locator("#ad-breaks").waitFor();assert.deepEqual(p.errors,[]);await p.close();
});
test("Рекламные паузы: основание v2 на 1440/390, ручная ветка и честный архив v1",async()=>{
 const artifacts=process.env.TEST_ARTIFACTS_DIR??os.tmpdir();fs.mkdirSync(artifacts,{recursive:true});
 for(const width of [1440,390]){
  const d=seedAdSource(`Основание ${width} עברית 日本語 <script>window.bad=1</script>`),p=await page({width,height:1000});await adForm(p,d,`Основание ${width}`);
  const basis=p.getByTestId("ad-basis");await basis.locator("summary").first().click();await visible(p,"слишком близко к ранее выбранным: №2");assert.match(await basis.innerText(),/Первоначальный автовыбор: №2, №3/);
  await basis.getByText("Исходные границы и SHA-256",{exact:true}).click();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await p.evaluate(()=>window.bad),undefined);
  await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(100);await p.screenshot({path:path.join(artifacts,`ad-basis-${width}.png`),fullPage:true});
  await p.getByLabel("Точка 1",{exact:true}).check();await p.getByLabel("Точка 2",{exact:true}).uncheck();await p.getByRole("button",{name:"Сохранить выбор",exact:true}).click();await p.waitForFunction(()=>!Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="План JSON")?.disabled);
  await p.getByTestId("ad-basis").locator("summary").first().click();await visible(p,"Текущий сохранённый выбор: №1, №3");assert.match(await p.getByTestId("ad-basis").innerText(),/Первоначальный автовыбор: №2, №3/);
  const dl=p.waitForEvent("download");await p.getByRole("button",{name:"План JSON",exact:true}).click();const r=JSON.parse(fs.readFileSync(await(await dl).path(),"utf8"));assert.equal(r.version,2);assert.deepEqual(r.basis.autoSelectedN,[2,3]);assert.deepEqual(r.selectedN,[1,3]);
  const legacy={...r,id:randomUUID(),version:1,title:`Legacy ${width}`};delete legacy.basis;fs.writeFileSync(path.join(dataDir,"ad-break-runs",legacy.id+".json"),JSON.stringify(legacy));await p.reload();await p.getByRole("button",{name:new RegExp(`Legacy ${width}`)}).click();await p.getByTestId("ad-basis-legacy").waitFor();assert.equal(await p.getByTestId("ad-basis").count(),0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(100);await p.screenshot({path:path.join(artifacts,`ad-legacy-${width}.png`),fullPage:true});assert.deepEqual(p.errors,[]);await p.close();
 }
});
async function profitFixture(ledger,prices=[{match:"unit-paid",input:1,output:2,image:0},{match:"unit-image",input:0,output:0,image:.5}]){
 const original=(await(await fetch(`${BASE}/api/settings`)).json()).data;
 fs.writeFileSync(path.join(dataDir,"usage.json"),JSON.stringify(ledger));
 const r=await fetch(`${BASE}/api/settings`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({anymodel:{...original.anymodel,usdPerMillion:2},budget:{...original.budget,prices}})});assert.equal(r.status,200);return original;
}
async function profitRestoreSettings(original){await fetch(`${BASE}/api/settings`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(original)});}
async function profitCapture(p,name){const artifacts=process.env.TEST_ARTIFACTS_DIR??os.tmpdir();fs.mkdirSync(artifacts,{recursive:true});await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(100);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:path.join(artifacts,name),fullPage:true});}
async function profitWorkspaceForm(p,title){await p.goto(`${BASE}/profit`);await p.getByLabel("Источник расходов",{exact:true}).selectOption("workspace-month");await p.getByTestId("profit-reviewed-basis").waitFor();await p.getByLabel("Название расчёта",{exact:true}).fill(title);await p.getByLabel("Просмотры за период",{exact:true}).fill("100000");await p.getByLabel("RPM, USD за 1000 просмотров",{exact:true}).fill("1");await p.getByLabel("Прочие затраты, USD",{exact:true}).fill("4");}
test("Прибыль: основание v2, формулы, Unicode, JSON/Markdown и закреплённая история 1440/390",async()=>{
 const month=new Date().toISOString().slice(0,7),paid="unit-paid-"+"עברית日本語".repeat(12)+"<script>window.profitInjected=1</script>",ledger={month,llm:{shared:{in:900000,out:100000,calls:2},[paid]:{in:1000000,out:500000,calls:1}},images:{shared:8,"unit-image":2},am:{shared:1000000,"web-search":40000,orphan:460000},extra:"PRIVATE_LEDGER_SENTINEL"};
 const original=await profitFixture(ledger);try{for(const width of [1440,390]){const p=await page({width,height:1000});try{
  await profitWorkspaceForm(p,`Evidence ${width}`);const reviewed=p.getByTestId("profit-reviewed-basis");await reviewed.locator("summary").click();await visible(p,"Прямые расходы этого ID не добавлены повторно");assert.match(await reviewed.innerText(),/1000000 × 1 \+ 500000 × 2/);assert.match(await reviewed.innerText(),/2 × 0.5/);assert.equal(await p.evaluate(()=>window.profitInjected),undefined);
  await profitCapture(p,`profit-review-${width}.png`);await reviewed.locator("summary").click();await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click();await p.getByTestId("profit-result").waitFor();assert.match(await p.getByTestId("profit-net").innerText(),/90/);
  await p.getByTestId("profit-saved-basis").locator("summary").click();await profitCapture(p,`profit-saved-${width}.png`);
  const dl=p.waitForEvent("download");await p.getByRole("button",{name:"Расчёт JSON",exact:true}).click();const r=JSON.parse(fs.readFileSync(await(await dl).path(),"utf8"));assert.equal(r.version,2);assert.equal(r.workspace.amUsd,3);assert.equal(r.workspace.directKnownUsd,3);assert.equal(r.result.estimatedProfit,90);assert.equal(r.workspace.costBasis.amRows.find(x=>x.model==="shared").images,8);assert.equal(r.workspace.costBasis.directRows.length,2);assert.equal(r.workspace.costBasis.directRows.find(x=>x.kind==="text").price.match,"unit-paid");assert.ok(!JSON.stringify(r).includes("PRIVATE_LEDGER_SENTINEL"));
  const md=p.waitForEvent("download");await p.getByRole("button",{name:"Расчёт Markdown",exact:true}).click();const text=fs.readFileSync(await(await md).path(),"utf8");assert.ok(text.includes(r.workspace.reviewHash));const block=text.match(/(`{3,})json\n([\s\S]*?)\n\1/);assert.ok(block);assert.deepEqual(JSON.parse(block[2]),r.workspace.costBasis);
  fs.writeFileSync(path.join(dataDir,"usage.json"),JSON.stringify({...ledger,am:{shared:9000000}}));await p.reload();await p.getByRole("button",{name:new RegExp(`Evidence ${width}`)}).click();await p.getByTestId("profit-result").waitFor();assert.match(await p.getByTestId("profit-net").innerText(),/90/);await p.getByTestId("profit-saved-basis").locator("summary").click();assert.ok((await p.getByTestId("profit-saved-basis").innerText()).includes(r.workspace.reviewHash));assert.equal(await p.evaluate(()=>window.profitInjected),undefined);assert.deepEqual(p.errors,[]);
 }finally{await p.close();fs.writeFileSync(path.join(dataDir,"usage.json"),JSON.stringify(ledger));}}}finally{await profitRestoreSettings(original);}
});
test("Прибыль: неизвестная ставка и известный ноль различаются в раскрытом основании 1440/390",async()=>{
 const ledger={month:new Date().toISOString().slice(0,7),llm:{unknown:{in:100,out:0,calls:1},zero:{in:0,out:0,calls:0}},images:{},am:{}},original=await profitFixture(ledger,[]);try{for(const width of [1440,390]){const p=await page({width,height:1000});try{
  await profitWorkspaceForm(p,`Unknown evidence ${width}`);await p.getByTestId("profit-reviewed-basis").locator("summary").click();await visible(p,"Нет записанной активности — учтено 0");await visible(p,"Стоимость неизвестна, не 0");await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click();await p.getByTestId("profit-result").waitFor();assert.equal(await p.getByTestId("profit-net").innerText(),"Неизвестно");await p.getByTestId("profit-reviewed-basis").locator("summary").click();await p.getByTestId("profit-saved-basis").locator("summary").click();await profitCapture(p,`profit-unknown-${width}.png`);assert.deepEqual(p.errors,[]);
 }finally{await p.close();}}}finally{await profitRestoreSettings(original);}
});
test("Прибыль: отсутствующий и прошлый журнал не становятся нулём и не изменяются чтением",async()=>{
 for(const kind of ["missing","stale"]){const file=path.join(dataDir,"usage.json");if(kind==="missing")fs.rmSync(file,{force:true});else fs.writeFileSync(file,JSON.stringify({month:"2000-01",llm:{},images:{},am:{old:123}}));const before=fs.existsSync(file)?fs.readFileSync(file):null,p=await page();try{
  await profitWorkspaceForm(p,`Coverage ${kind}`);await p.getByTestId("profit-reviewed-basis").locator("summary").click();assert.match(await p.getByTestId("profit-reviewed-basis").innerText(),/Нет данных текущего месяца/);await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click();await p.getByTestId("profit-result").waitFor();assert.equal(await p.getByTestId("profit-net").innerText(),"Неизвестно");assert.deepEqual(fs.existsSync(file)?fs.readFileSync(file):null,before);assert.deepEqual(p.errors,[]);
 }finally{await p.close();}}
});
test("Прибыль: изменение ставки даёт 409 без потери результата, обновление сохраняет новое основание",async()=>{
 const ledger={month:new Date().toISOString().slice(0,7),llm:{"unit-paid":{in:1000000,out:0,calls:1}},images:{},am:{}},original=await profitFixture(ledger);const p=await page();try{
  await profitWorkspaceForm(p,"Price conflict");await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click();await p.getByTestId("profit-result").waitFor();assert.match(await p.getByTestId("profit-net").innerText(),/95/);const count=fs.readdirSync(path.join(dataDir,"profit-runs")).length;
  const s=(await(await fetch(`${BASE}/api/settings`)).json()).data;await fetch(`${BASE}/api/settings`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({budget:{...s.budget,prices:[{match:"unit-paid",input:3,output:2,image:0}]}})});
  await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click();await visible(p,"Обновите расходы и проверьте детализацию");assert.match(await p.getByTestId("profit-net").innerText(),/95/);assert.equal(fs.readdirSync(path.join(dataDir,"profit-runs")).length,count);
  const refreshed=p.waitForResponse(r=>r.url().endsWith("/api/profit/workspace-costs"));await p.getByRole("button",{name:"Обновить расходы",exact:true}).click();await refreshed;await p.getByTestId("profit-reviewed-basis").locator("summary").click();await p.getByTestId("profit-reviewed-basis").getByText(/1000000 × 3/).waitFor();await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click();await p.getByTestId("profit-net").getByText(/93/).waitFor();assert.deepEqual(p.errors,[]);
 }finally{await p.close();await profitRestoreSettings(original);}
});
test("Прибыль: архив v1 открывается без текущих ставок и без переписывания 1440/390",async()=>{
 const ledger={month:new Date().toISOString().slice(0,7),llm:{},images:{},am:{voice:1000000}},original=await profitFixture(ledger);try{
  const w=(await(await fetch(`${BASE}/api/profit/workspace-costs`)).json()).data,response=await fetch(`${BASE}/api/profit/calculate`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({mode:"workspace-month",month:ledger.month,title:"Legacy basis test",views:10000,rpm:1,otherCosts:0,costsHash:w.reviewHash})});assert.equal(response.status,200);const raw=(await response.json()).data,legacy={...raw,id:randomUUID(),title:"Legacy v1 only",version:1,workspace:{...raw.workspace}};delete legacy.workspace.costBasis;delete legacy.workspace.reviewHash;const file=path.join(dataDir,"profit-runs",legacy.id+".json");fs.writeFileSync(file,JSON.stringify(legacy));const before=fs.readFileSync(file);fs.writeFileSync(path.join(dataDir,"usage.json"),JSON.stringify({...ledger,am:{voice:9999999}}));
  for(const width of [1440,390]){const p=await page({width,height:1000});try{await p.goto(`${BASE}/profit`);await p.getByRole("button",{name:/Legacy v1 only/}).click();await p.getByTestId("profit-legacy-basis").waitFor();assert.equal(await p.getByTestId("profit-saved-basis").count(),0);assert.match(await p.getByTestId("profit-net").innerText(),/8/);await profitCapture(p,`profit-legacy-${width}.png`);assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(p.errors,[]);}finally{await p.close();}}
 }finally{await profitRestoreSettings(original);}
});
test("Прибыль: поздний ответ сохранения или истории не восстанавливает результат после ухода",async()=>{
 const p=await page();try{await p.goto(`${BASE}/profit`);await profitManualForm(p,{title:"Late response source"});await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click();await p.getByTestId("profit-result").waitFor();
  let release;const gate=new Promise(r=>release=r);let intercepted;const started=new Promise(r=>intercepted=r);await p.route("**/api/profit/calculate",async route=>{const response=await route.fetch();intercepted();await gate;try{await route.fulfill({response});}catch{}});
  await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click();await started;{const group=p.getByRole("button",{name:"Рабочее пространство",exact:true});if(await group.getAttribute("aria-expanded")==="false")await group.click();}await p.getByRole("link",{name:"AI Coach",exact:true}).click();release();await p.waitForTimeout(150);assert.equal(await p.getByTestId("profit-result").count(),0);await p.unroute("**/api/profit/calculate");await p.goto(`${BASE}/profit`);assert.equal(await p.getByTestId("profit-result").count(),0);
  let releaseRead,readStarted;const readGate=new Promise(r=>releaseRead=r),readSignal=new Promise(r=>readStarted=r);await p.route(/\/api\/profit\/runs\/[0-9a-f-]+$/,async route=>{const response=await route.fetch();readStarted();await readGate;try{await route.fulfill({response});}catch{}});await p.getByRole("button",{name:/Late response source/}).first().click();await readSignal;{const group=p.getByRole("button",{name:"Рабочее пространство",exact:true});if(await group.getAttribute("aria-expanded")==="false")await group.click();}await p.getByRole("link",{name:"AI Coach",exact:true}).click();releaseRead();await p.waitForTimeout(150);await p.goto(`${BASE}/profit`);assert.equal(await p.getByTestId("profit-result").count(),0);assert.deepEqual(p.errors,[]);
 }finally{await p.close();}
});
