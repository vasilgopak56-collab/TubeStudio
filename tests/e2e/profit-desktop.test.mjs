// Desktop-only profit regressions extracted from tools.test.mjs; no real providers.
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
test("Прибыль: нулевой RPM, убыток, настольные 1440 px и справка",async()=>{
  const p=await page({width:1440,height:1000});await p.goto(`${BASE}/profit`);await profitManualForm(p,{views:"0",rpm:"0",ai:"10",other:"0",title:"Profit zero RPM"});await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click();await p.getByTestId("profit-result").waitFor();
  assert.match(await p.getByTestId("profit-net").innerText(),/-10|−10/);assert.equal(await p.getByTestId("profit-break-even").innerText(),"Недостижима при RPM = 0");assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const artifacts=process.env.TEST_ARTIFACTS_DIR??"/data/ts68-profit-qa";fs.mkdirSync(artifacts,{recursive:true});await p.screenshot({path:path.join(artifacts,"profit-desktop.png"),fullPage:true});
  await p.getByRole("link",{name:"Справка",exact:true}).click();await p.locator("#profit").waitFor();assert.deepEqual(p.errors,[]);await p.close();
});
test("Прибыль: ошибка сохранения видна, форма и предыдущий результат не теряются",async()=>{
  const p=await page();await p.goto(`${BASE}/profit`);await profitManualForm(p,{title:"Profit retained on failure"});await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click();await p.getByTestId("profit-result").waitFor();
  await p.route("**/api/profit/calculate",r=>r.fulfill({status:400,json:{ok:false,error:{code:"VALIDATION",message:"Тест: журнал расходов повреждён"}}}));await p.getByLabel("RPM, USD за 1000 просмотров",{exact:true}).fill("3");await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click();await visible(p,"Тест: журнал расходов повреждён");assert.equal(await p.getByLabel("RPM, USD за 1000 просмотров",{exact:true}).inputValue(),"3");assert.match(await p.getByTestId("profit-net").innerText(),/200/);assert.deepEqual(p.errors,[]);await p.close();
});

async function profitFixture(ledger,prices=[{match:"unit-paid",input:1,output:2,image:0},{match:"unit-image",input:0,output:0,image:.5}]){
 const original=(await(await fetch(`${BASE}/api/settings`)).json()).data;
 fs.writeFileSync(path.join(dataDir,"usage.json"),JSON.stringify(ledger));
 const r=await fetch(`${BASE}/api/settings`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({anymodel:{...original.anymodel,usdPerMillion:2},budget:{...original.budget,prices}})});assert.equal(r.status,200);return original;
}
async function profitRestoreSettings(original){await fetch(`${BASE}/api/settings`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(original)});}
async function profitCapture(p,name){const artifacts=process.env.TEST_ARTIFACTS_DIR??"/data/ts68-profit-qa";fs.mkdirSync(artifacts,{recursive:true});await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(100);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:path.join(artifacts,name),fullPage:true});}
async function profitWorkspaceForm(p,title){await p.goto(`${BASE}/profit`);await p.getByLabel("Источник расходов",{exact:true}).selectOption("workspace-month");await p.getByTestId("profit-reviewed-basis").waitFor();await p.getByLabel("Название расчёта",{exact:true}).fill(title);await p.getByLabel("Просмотры за период",{exact:true}).fill("100000");await p.getByLabel("RPM, USD за 1000 просмотров",{exact:true}).fill("1");await p.getByLabel("Прочие затраты, USD",{exact:true}).fill("4");}
test("Прибыль: основание v2, формулы, Unicode, JSON/Markdown и закреплённая история 1440",async()=>{
 const month=new Date().toISOString().slice(0,7),paid="unit-paid-"+"עברית日本語".repeat(12)+"<script>window.profitInjected=1</script>",ledger={month,llm:{shared:{in:900000,out:100000,calls:2},[paid]:{in:1000000,out:500000,calls:1}},images:{shared:8,"unit-image":2},am:{shared:1000000,"web-search":40000,orphan:460000},extra:"PRIVATE_LEDGER_SENTINEL"};
 const original=await profitFixture(ledger);try{for(const width of [1440]){const p=await page({width,height:1000});try{
  await profitWorkspaceForm(p,`Evidence ${width}`);const reviewed=p.getByTestId("profit-reviewed-basis");await reviewed.locator("summary").click();await visible(p,"Прямые расходы этого ID не добавлены повторно");assert.match(await reviewed.innerText(),/1000000 × 1 \+ 500000 × 2/);assert.match(await reviewed.innerText(),/2 × 0.5/);assert.equal(await p.evaluate(()=>window.profitInjected),undefined);
  await profitCapture(p,`profit-review-${width}.png`);await reviewed.locator("summary").click();await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click();await p.getByTestId("profit-result").waitFor();assert.match(await p.getByTestId("profit-net").innerText(),/90/);
  await p.getByTestId("profit-saved-basis").locator("summary").click();await profitCapture(p,`profit-saved-${width}.png`);
  const dl=p.waitForEvent("download");await p.getByRole("button",{name:"Расчёт JSON",exact:true}).click();const r=JSON.parse(fs.readFileSync(await(await dl).path(),"utf8"));assert.equal(r.version,2);assert.equal(r.workspace.amUsd,3);assert.equal(r.workspace.directKnownUsd,3);assert.equal(r.result.estimatedProfit,90);assert.equal(r.workspace.costBasis.amRows.find(x=>x.model==="shared").images,8);assert.equal(r.workspace.costBasis.directRows.length,2);assert.equal(r.workspace.costBasis.directRows.find(x=>x.kind==="text").price.match,"unit-paid");assert.ok(!JSON.stringify(r).includes("PRIVATE_LEDGER_SENTINEL"));
  const md=p.waitForEvent("download");await p.getByRole("button",{name:"Расчёт Markdown",exact:true}).click();const text=fs.readFileSync(await(await md).path(),"utf8");assert.ok(text.includes(r.workspace.reviewHash));const block=text.match(/(`{3,})json\n([\s\S]*?)\n\1/);assert.ok(block);assert.deepEqual(JSON.parse(block[2]),r.workspace.costBasis);
  fs.writeFileSync(path.join(dataDir,"usage.json"),JSON.stringify({...ledger,am:{shared:9000000}}));await p.reload();await p.getByRole("button",{name:new RegExp(`Evidence ${width}`)}).click();await p.getByTestId("profit-result").waitFor();assert.match(await p.getByTestId("profit-net").innerText(),/90/);await p.getByTestId("profit-saved-basis").locator("summary").click();assert.ok((await p.getByTestId("profit-saved-basis").innerText()).includes(r.workspace.reviewHash));assert.equal(await p.evaluate(()=>window.profitInjected),undefined);assert.deepEqual(p.errors,[]);
 }finally{await p.close();fs.writeFileSync(path.join(dataDir,"usage.json"),JSON.stringify(ledger));}}}finally{await profitRestoreSettings(original);}
});
test("Прибыль: неизвестная ставка и известный ноль различаются в раскрытом основании 1440",async()=>{
 const ledger={month:new Date().toISOString().slice(0,7),llm:{unknown:{in:100,out:0,calls:1},zero:{in:0,out:0,calls:0}},images:{},am:{}},original=await profitFixture(ledger,[]);try{for(const width of [1440]){const p=await page({width,height:1000});try{
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
test("Прибыль: архив v1 открывается без текущих ставок и без переписывания 1440",async()=>{
 const ledger={month:new Date().toISOString().slice(0,7),llm:{},images:{},am:{voice:1000000}},original=await profitFixture(ledger);try{
  const w=(await(await fetch(`${BASE}/api/profit/workspace-costs`)).json()).data,response=await fetch(`${BASE}/api/profit/calculate`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({mode:"workspace-month",month:ledger.month,title:"Legacy basis test",views:10000,rpm:1,otherCosts:0,costsHash:w.reviewHash})});assert.equal(response.status,200);const raw=(await response.json()).data,legacy={...raw,id:randomUUID(),title:"Legacy v1 only",version:1,workspace:{...raw.workspace}};delete legacy.workspace.costBasis;delete legacy.workspace.reviewHash;const file=path.join(dataDir,"profit-runs",legacy.id+".json");fs.writeFileSync(file,JSON.stringify(legacy));const before=fs.readFileSync(file);fs.writeFileSync(path.join(dataDir,"usage.json"),JSON.stringify({...ledger,am:{voice:9999999}}));
  for(const width of [1440]){const p=await page({width,height:1000});try{await p.goto(`${BASE}/profit`);await p.getByRole("button",{name:/Legacy v1 only/}).click();await p.getByTestId("profit-legacy-basis").waitFor();assert.equal(await p.getByTestId("profit-saved-basis").count(),0);assert.match(await p.getByTestId("profit-net").innerText(),/8/);await profitCapture(p,`profit-legacy-${width}.png`);assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(p.errors,[]);}finally{await p.close();}}
 }finally{await profitRestoreSettings(original);}
});
test("Прибыль: поздний ответ сохранения или истории не восстанавливает результат после ухода",async()=>{
 const p=await page();try{await p.goto(`${BASE}/profit`);await profitManualForm(p,{title:"Late response source"});await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click();await p.getByTestId("profit-result").waitFor();
  let release;const gate=new Promise(r=>release=r);let intercepted;const started=new Promise(r=>intercepted=r);await p.route("**/api/profit/calculate",async route=>{const response=await route.fetch();intercepted();await gate;try{await route.fulfill({response});}catch{}});
  await p.getByRole("button",{name:"Рассчитать и сохранить",exact:true}).click();await started;{const group=p.getByRole("button",{name:"Рабочее пространство",exact:true});if(await group.getAttribute("aria-expanded")==="false")await group.click();}await p.getByRole("link",{name:"AI Coach",exact:true}).click();release();await p.waitForTimeout(150);assert.equal(await p.getByTestId("profit-result").count(),0);await p.unroute("**/api/profit/calculate");await p.goto(`${BASE}/profit`);assert.equal(await p.getByTestId("profit-result").count(),0);
  let releaseRead,readStarted;const readGate=new Promise(r=>releaseRead=r),readSignal=new Promise(r=>readStarted=r);await p.route(/\/api\/profit\/runs\/[0-9a-f-]+$/,async route=>{const response=await route.fetch();readStarted();await readGate;try{await route.fulfill({response});}catch{}});await p.getByRole("button",{name:/Late response source/}).first().click();await readSignal;{const group=p.getByRole("button",{name:"Рабочее пространство",exact:true});if(await group.getAttribute("aria-expanded")==="false")await group.click();}await p.getByRole("link",{name:"AI Coach",exact:true}).click();releaseRead();await p.waitForTimeout(150);await p.goto(`${BASE}/profit`);assert.equal(await p.getByTestId("profit-result").count(),0);assert.deepEqual(p.errors,[]);
 }finally{await p.close();}
});
