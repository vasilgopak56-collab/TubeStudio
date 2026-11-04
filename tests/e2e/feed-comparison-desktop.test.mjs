// Desktop-only derivative: historical mobile-menu branch omitted; app algorithms unchanged.
// Local-only preview: isolated storage, no provider credentials or outbound browser requests.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
const ROOT = process.cwd(), BASE = "http://127.0.0.1:8820";
let server, browser, dir;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-feed-"));
  server = spawn("node", ["dist/index.js"], { cwd: ROOT + "/apps/server", env: { PATH: process.env.PATH, PORT: "8820", HOST: "127.0.0.1", DATA_DIR: dir, ENV_FILE: dir + "/absent.env" }, stdio: "ignore" });
  let ready = false;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + "/api/auth/status")).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 200)); }
  assert.ok(ready, "isolated server ready");
  browser = await chromium.launch({ executablePath: "/usr/local/bin/chromium", args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
async function page(width = 1440) {
  const p = await browser.newPage({ viewport: { width, height: 1100 } });
  p.errors = []; p.posts = []; p.external = [];
  p.on("pageerror", e => p.errors.push(e.message));
  await p.route("**/*", r => {
    const u = new URL(r.request().url());
    if (u.origin !== BASE) { p.external.push(u.origin); return r.abort(); }
    if (r.request().method() === "POST") p.posts.push(u.pathname);
    return r.continue();
  });
  await p.addInitScript(() => {
    window.feedUrls = { made: 0, freed: 0 };
    const make = URL.createObjectURL.bind(URL), free = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = x => { window.feedUrls.made++; return make(x); };
    URL.revokeObjectURL = x => { window.feedUrls.freed++; return free(x); };
  });
  await p.goto(BASE + "/thumbnail?tab=compare");
  await p.getByTestId("feed-comparison").waitFor();
  return p;
}
async function image(p, width = 640, height = 360, mime = "image/png") {
  const data = await p.evaluate(({ width, height, mime }) => {
    const c = document.createElement("canvas"); c.width = width; c.height = height;
    const g = c.getContext("2d"); g.fillStyle = "#305268"; g.fillRect(0, 0, width, height);
    return c.toDataURL(mime).split(",")[1];
  }, { width, height, mime });
  return { name: mime === "image/webp" ? "test.webp" : "test.png", mimeType: mime, buffer: Buffer.from(data, "base64") };
}
const own = p => p.getByLabel("Изображение · своя обложка", { exact: true });
const mockup = p => p.getByTestId("feed-mockup");
async function loaded(p, role = "own") { await p.getByTestId(role === "own" ? "feed-own-card" : "feed-peer-card").locator("img").waitFor(); await p.waitForFunction(() => !document.body.innerText.includes("Изображение обрабатывается локально…")); }
test("feed empty direct route has no AI, external calls, fake metrics or overflow", async () => {
  const p = await page(1440);
  assert.match(await mockup(p).innerText(), /Загрузите свою обложку/);
  assert.doesNotMatch(await mockup(p).innerText(), /просмотров|CTR|\d+:\d+/);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(p.posts, []); assert.deepEqual(p.external, []); assert.deepEqual(p.errors, []);
  await p.close();
});
test("feed local upload title/channel are literal, URLs released and files not sent", async () => {
  const p = await page(), payload = await image(p);
  await own(p).setInputFiles(payload); await loaded(p);
  const title = '<img src=x onerror=alert(1)> עברית 日本語 ' + "X".repeat(120);
  await p.getByLabel("Заголовок · своя обложка", { exact: true }).fill(title);
  await p.getByLabel("Канал · своя обложка", { exact: true }).fill("Мой канал עברית 日本語");
  assert.equal(await p.getByTestId("feed-own-card").locator("h3").innerText(), title);
  assert.equal(await p.getByTestId("feed-own-card").locator("img").count(), 1);
  assert.ok((await p.getByTestId("feed-own-card").locator("img").getAttribute("src")).startsWith("data:image/png"));
  assert.match(await p.getByTestId("feed-comparison").innerText(), /640 × 360/);
  const urls = await p.evaluate(() => window.feedUrls); assert.equal(urls.made, urls.freed);
  assert.deepEqual(p.posts, []); assert.deepEqual(p.external, []); assert.deepEqual(p.errors, []);
  assert.equal(await p.evaluate(() => Object.values(localStorage).some(x => x.includes("data:image"))), false);
  await p.close();
});
test("feed wrong formats, spoofed files, empty/large/corrupt files preserve previous image", async () => {
  const p = await page(); await own(p).setInputFiles(await image(p)); await loaded(p);
  const src = await p.getByTestId("feed-own-card").locator("img").getAttribute("src");
  const invalid = [
    { name: "bad.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") },
    { name: "spoof.png", mimeType: "image/png", buffer: Buffer.from("<svg/>") },
    { name: "empty.png", mimeType: "image/png", buffer: Buffer.alloc(0) },
    { name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) },
    { name: "broken.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]) },
  ];
  for (const f of invalid) {
    await own(p).setInputFiles(f); await p.getByRole("alert").waitFor();
    await p.waitForFunction(() => !document.body.innerText.includes("Изображение обрабатывается локально…"));
    assert.equal(await p.getByTestId("feed-own-card").locator("img").getAttribute("src"), src);
  }
  const urls = await p.evaluate(() => window.feedUrls); assert.equal(urls.made, urls.freed);
  assert.deepEqual(p.posts, []); await p.close();
});
test("feed dimensions bounded, WebP supported and portrait not cropped", async () => {
  const p = await page();
  await own(p).setInputFiles(await image(p, 8193, 1)); await p.getByRole("alert").waitFor();
  assert.equal(await p.getByTestId("feed-own-card").locator("img").count(), 0);
  await own(p).setInputFiles(await image(p, 240, 480, "image/webp")); await loaded(p);
  assert.match(await p.getByTestId("feed-comparison").innerText(), /240 × 480/);
  assert.equal(await p.getByTestId("feed-own-card").locator("img").evaluate(x => getComputedStyle(x).objectFit), "contain");
  assert.equal(await p.getByRole("alert").count(), 0); await p.close();
});
test("feed five competitors, chosen own position, removal and mark toggle do not invent winner", async () => {
  const p = await page();
  for (let i = 0; i < 5; i++) await p.getByRole("button", { name: /Добавить конкурента/ }).click();
  assert.ok(await p.getByRole("button", { name: /Добавить конкурента/ }).isDisabled());
  assert.equal(await p.getByTestId("feed-peer-card").count(), 5);
  await p.getByLabel("Позиция своей обложки", { exact: true }).selectOption("4");
  assert.equal(await p.getByTestId("feed-cards").locator("article").nth(3).getAttribute("data-testid"), "feed-own-card");
  await p.getByLabel("Отмечать свою карточку", { exact: true }).uncheck();
  assert.equal(await mockup(p).getByText("Своя карточка", { exact: true }).count(), 0);
  await p.getByRole("button", { name: "Удалить конкурент 1", exact: true }).click();
  assert.equal(await p.getByTestId("feed-peer-card").count(), 4);
  assert.ok(await p.getByRole("button", { name: /Добавить конкурента/ }).isEnabled());
  assert.doesNotMatch(await mockup(p).innerText(), /победитель|CTR|%/); await p.close();
});
test("feed tab switches keep draft; reset and reload erase it without persistence", async () => {
  const p = await page(); await own(p).setInputFiles(await image(p)); await loaded(p);
  await p.getByRole("button", { name: /Добавить конкурента/ }).click();
  await p.getByRole("button", { name: "AI-генерация", exact: true }).click();
  await p.getByRole("button", { name: "Сравнение в ленте", exact: true }).click();
  assert.equal(await p.getByTestId("feed-own-card").locator("img").count(), 1);
  assert.equal(await p.getByTestId("feed-peer-card").count(), 1);
  await p.getByRole("button", { name: "Очистить сравнение", exact: true }).click();
  assert.equal(await p.getByTestId("feed-own-card").locator("img").count(), 0);
  assert.equal(await p.getByTestId("feed-peer-card").count(), 0);
  await own(p).setInputFiles(await image(p)); await loaded(p); await p.reload();
  await p.getByTestId("feed-comparison").waitFor();
  assert.equal(await p.getByTestId("feed-own-card").locator("img").count(), 0); await p.close();
});
test("feed clear invalidates in-flight decode and releases URL", async () => {
  const p = await page();
  await p.evaluate(() => { const decode = Image.prototype.decode; Image.prototype.decode = async function () { await new Promise(r => setTimeout(r, 250)); return decode.call(this); }; });
  await own(p).setInputFiles(await image(p)); await p.getByRole("status").waitFor();
  await p.getByRole("button", { name: "Очистить сравнение", exact: true }).click();
  await p.waitForTimeout(500);
  assert.equal(await p.getByTestId("feed-own-card").locator("img").count(), 0);
  const urls = await p.evaluate(() => window.feedUrls); assert.equal(urls.made, urls.freed); await p.close();
});
test("feed desktop and light/dark adapt, safe generated variant only on explicit selection", async () => {
  const p = await page();
  const picture = await image(p);
  await own(p).setInputFiles(picture); await loaded(p);
  await p.getByRole("button", { name: /Добавить конкурента/ }).click();
  await p.getByLabel("Изображение · конкурент 1", { exact: true }).setInputFiles(picture); await loaded(p, "peer");
  await p.getByLabel("Заголовок · своя обложка", { exact: true }).fill("Свой заголовок " + "длинный".repeat(20));
  for (const width of [1440]) {
    await p.setViewportSize({ width, height: 1100 });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.ok(await p.getByTestId("feed-comparison").locator("button").evaluateAll(xs => xs.every(x => x.getBoundingClientRect().height >= 44)));
    await p.getByRole("button", { name: "Мобильная лента", exact: true }).click();
    assert.ok(await p.getByTestId("feed-cards").evaluate(x => x.getBoundingClientRect().width <= 360));
    await p.getByRole("button", { name: "Светлый фон", exact: true }).click();
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await p.getByRole("button", { name: "Тёмный фон", exact: true }).click();
    await p.getByRole("button", { name: "Сетка", exact: true }).click();
  }
  assert.deepEqual(p.errors, []); assert.deepEqual(p.posts, []); assert.deepEqual(p.external, []);
  await p.route("**/api/projects/feed-test", r => r.fulfill({ json: { ok: true, data: { id: "feed-test", title: "Проект", artifacts: [{ id: "art", kind: "thumbnail", data: { variants: [{ variant: "A", url: "/files/feed.png", status: "done", versions: [] }, { variant: "B", url: "https://evil.example/track.png", status: "done", versions: [] }] } }] } } }));
  await p.route("**/files/feed.png", r => r.fulfill({ contentType: "image/png", body: picture.buffer }));
  await p.goto(BASE + "/thumbnail?tab=compare&projectId=feed-test&artifact=art");
  await p.getByRole("button", { name: "Взять вариант A", exact: true }).waitFor();
  assert.equal(await p.getByRole("button", { name: "Взять вариант B", exact: true }).count(), 0);
  assert.equal(await p.getByTestId("feed-own-card").locator("img").count(), 0);
  await p.getByRole("button", { name: "Взять вариант A", exact: true }).click(); await loaded(p);
  assert.equal(await p.getByTestId("feed-own-card").locator("img").getAttribute("src"), "/files/feed.png");
  assert.deepEqual(p.external, []); await p.close();
});
async function save(p, kind) {
  const waiting = p.waitForEvent("download");
  await p.getByRole("button", { name: `Скачать макет ${kind.toUpperCase()}`, exact: true }).click();
  const download = await waiting; const file = await download.path();
  await p.waitForFunction(() => !document.body.innerText.includes("Изображение обрабатывается локально…"));
  return { bytes: fs.readFileSync(file), download };
}
const restore = (p, bytes) => p.getByLabel("Восстановить макет JSON", { exact: true }).setInputFiles({ name:"feed.json", mimeType:"application/json", buffer:bytes });
async function settled(p) { await p.waitForFunction(() => !document.body.innerText.includes("Изображение обрабатывается локально…")); }
test("feed JSON explicit roundtrip keeps images order settings, no storage/network; PNG exports real raster", async () => {
  const p = await page(1440);
  await own(p).setInputFiles(await image(p, 1600, 900)); await loaded(p);
  await p.getByLabel("Заголовок · своя обложка", {exact:true}).fill('<img src=x> עברית 日本語 Рим');
  await p.getByRole("button",{name:/Добавить конкурента/}).click();
  await p.getByLabel("Изображение · конкурент 1",{exact:true}).setInputFiles(await image(p,240,480)); await loaded(p,"peer");
  await p.getByLabel("Позиция своей обложки",{exact:true}).selectOption("2");
  await p.getByRole("button",{name:"Мобильная лента",exact:true}).click();
  await p.getByRole("button",{name:"Светлый фон",exact:true}).click();
  await p.getByLabel("Отмечать свою карточку",{exact:true}).uncheck();
  const {bytes} = await save(p,"json"), s = JSON.parse(bytes);
  assert.equal(s.own.picture.width,1280); assert.equal(s.own.picture.height,720); assert.equal(s.position,2);
  assert.deepEqual([s.mobile,s.light,s.mark],[true,true,false]);
  assert.ok(s.own.picture.src.startsWith("data:image/png;base64,")); assert.equal(bytes.includes(Buffer.from("/files/")),false);
  await p.getByRole("button",{name:"Очистить сравнение",exact:true}).click();
  await restore(p,bytes); await loaded(p);
  assert.equal(await p.getByLabel("Заголовок · своя обложка",{exact:true}).inputValue(),s.own.title);
  assert.equal(await p.getByLabel("Отмечать свою карточку",{exact:true}).isChecked(),false);
  assert.equal(await p.getByTestId("feed-cards").locator("article").last().getAttribute("data-testid"),"feed-own-card");
  const png = await save(p,"png"); assert.deepEqual([...png.bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal(png.bytes.readUInt32BE(16),408); assert.equal(png.bytes.readUInt32BE(20),896);
  assert.equal(await p.evaluate(() => Object.values(localStorage).some(v=>v.includes("data:image"))),false);
  await p.waitForTimeout(1100); const urls = await p.evaluate(()=>window.feedUrls); assert.equal(urls.made,urls.freed);
  assert.deepEqual(p.posts,[]); assert.deepEqual(p.external,[]); assert.deepEqual(p.errors,[]); await p.close();
});
test("feed atomic import rejects URLs SVG broken PNG dimensions limits unknown fields without changing draft", async () => {
  const p = await page(); await own(p).setInputFiles(await image(p)); await loaded(p);
  const {bytes} = await save(p,"json"), good = JSON.parse(bytes), original = await p.getByTestId("feed-own-card").locator("img").getAttribute("src");
  const variants = [Buffer.from("{"), Buffer.alloc(16*1024*1024+1), ...[
    {...good,version:999}, {...good,secret:"no"}, {...good,own:{...good.own,picture:{...good.own.picture,src:"https://evil.test/x.png"}}},
    {...good,own:{...good.own,picture:{...good.own.picture,src:"data:image/svg+xml;base64,AAAA"}}},
    {...good,own:{...good.own,picture:{...good.own.picture,width:1}}},
    {...good,peers:[{...good.own,id:"1",picture:{src:"data:image/png;base64,AAAA",width:1,height:1}}]},
  ].map(v=>Buffer.from(JSON.stringify(v)))];
  for (const bytes of variants) { await restore(p,bytes); await p.getByRole("alert").waitFor(); await settled(p); assert.equal(await p.getByTestId("feed-own-card").locator("img").getAttribute("src"),original); assert.equal(await p.getByTestId("feed-peer-card").count(),0); }
  assert.deepEqual(p.posts,[]); assert.deepEqual(p.external,[]); assert.deepEqual(p.errors,[]); await p.close();
});
test("feed clear cancels delayed import/export without late download or stale image", async () => {
  const p = await page(); await own(p).setInputFiles(await image(p)); await loaded(p);
  const {bytes} = await save(p,"json"); await p.waitForTimeout(1100);
  await p.evaluate(()=>{const decode=Image.prototype.decode;Image.prototype.decode=async function(){await new Promise(r=>setTimeout(r,300));return decode.call(this);};});
  let downloads = 0; p.on("download",()=>downloads++);
  await p.getByRole("button",{name:"Скачать макет PNG",exact:true}).click();
  await p.getByRole("button",{name:"Очистить сравнение",exact:true}).click(); await p.waitForTimeout(700);
  assert.equal(downloads,0);
  await restore(p,bytes); await p.getByRole("button",{name:"Очистить сравнение",exact:true}).click(); await p.waitForTimeout(700);
  assert.equal(await p.getByTestId("feed-own-card").locator("img").count(),0);
  const urls=await p.evaluate(()=>window.feedUrls);assert.equal(urls.made,urls.freed);assert.deepEqual(p.errors,[]);await p.close();
});
test("feed selected app media is embedded only for explicit export; unavailable media creates no partial file", async()=>{
  const p=await page(),picture=await image(p);let requests=0;
  await p.route("**/api/projects/feed-test",r=>r.fulfill({json:{ok:true,data:{id:"feed-test",title:"Проект",artifacts:[{id:"art",kind:"thumbnail",data:{variants:[{variant:"A",url:"/files/feed.png",status:"done",versions:[]}]}}]}}}));
  await p.route("**/files/feed.png",r=>{requests++;return r.fulfill({contentType:"image/png",body:picture.buffer});});
  await p.goto(BASE+"/thumbnail?tab=compare&projectId=feed-test&artifact=art"); await p.getByRole("button",{name:"Взять вариант A",exact:true}).waitFor();assert.equal(requests,0);
  await p.getByRole("button",{name:"Взять вариант A",exact:true}).click();await loaded(p);assert.equal(requests,1);
  const {bytes}=await save(p,"json");assert.ok(JSON.parse(bytes).own.picture.src.startsWith("data:image/png;base64,"));assert.equal(requests,2);
  await p.route("**/files/feed.png",r=>r.fulfill({status:404,body:"missing"}));let downloads=0;p.on("download",()=>downloads++);
  await p.getByRole("button",{name:"Скачать макет JSON",exact:true}).click();await p.getByRole("alert").waitFor();await settled(p);assert.equal(downloads,0);
  assert.equal(await p.getByTestId("feed-own-card").locator("img").getAttribute("src"),"/files/feed.png");assert.deepEqual(p.external,[]);assert.deepEqual(p.posts,[]);await p.close();
});
test("feed six-card PNG uses fixed three columns even on mobile viewport; imported IDs stay unique", async()=>{
  const p=await page(1440);await own(p).setInputFiles(await image(p));await loaded(p);
  const {bytes}=await save(p,"json"),s=JSON.parse(bytes);
  s.peers=[1,2,3,4,5].map(id=>({...s.own,id:String(id),title:`Карточка ${id}`}));s.position=6;
  await restore(p,Buffer.from(JSON.stringify(s)));await loaded(p);
  const png=await save(p,"png");assert.equal(png.bytes.readUInt32BE(16),1168);assert.equal(png.bytes.readUInt32BE(20),896);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await p.getByRole("button",{name:"Удалить конкурент 1",exact:true}).click();
  await p.getByRole("button",{name:/Добавить конкурента/}).click();
  const updated=JSON.parse((await save(p,"json")).bytes);assert.equal(new Set(updated.peers.map(e=>e.id)).size,5);assert.deepEqual(p.errors,[]);await p.close();
});
test("feed leaving route invalidates delayed PNG export and import", async()=>{
  const p=await page();await own(p).setInputFiles(await image(p));await loaded(p);const {bytes}=await save(p,"json");
  await p.evaluate(()=>{const decode=Image.prototype.decode;Image.prototype.decode=async function(){await new Promise(r=>setTimeout(r,400));return decode.call(this);};});
  let downloads=0;p.on("download",()=>downloads++);
  await p.getByRole("button",{name:"Скачать макет PNG",exact:true}).click();
  await p.evaluate(()=>{history.pushState({},"","/keywords");dispatchEvent(new PopStateEvent("popstate"));});
  await p.getByTestId("feed-comparison").waitFor({state:"detached"});await p.waitForTimeout(700);assert.equal(downloads,0);
  await p.goto(BASE+"/thumbnail?tab=compare");await p.getByTestId("feed-comparison").waitFor();
  await p.evaluate(()=>{const decode=Image.prototype.decode;Image.prototype.decode=async function(){await new Promise(r=>setTimeout(r,400));return decode.call(this);};});
  await restore(p,bytes);await p.evaluate(()=>{history.pushState({},"","/keywords");dispatchEvent(new PopStateEvent("popstate"));});
  await p.getByTestId("feed-comparison").waitFor({state:"detached"});await p.waitForTimeout(700);assert.equal(downloads,0);assert.deepEqual(p.errors,[]);await p.close();
});
test("feed PNG clips oversized joined emoji graphemes inside their own text columns", async()=>{
  const p=await page(),{bytes}=await save(p,"json"),s=JSON.parse(bytes);
  s.light=true;s.own.title="😀‍".repeat(50);s.peers=[{...s.own,id:"1",title:"Соседняя карточка"}];
  await restore(p,Buffer.from(JSON.stringify(s)));await settled(p);
  const png=await save(p,"png");
  const whiteGap=await p.evaluate(async b64=>{
    const image=new Image();image.src='data:image/png;base64,'+b64;await image.decode();
    const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const g=c.getContext('2d');g.drawImage(image,0,0);
    const pixels=g.getImageData(385,335,18,44).data;
    for(let i=0;i<pixels.length;i+=4)if(pixels[i]!==255||pixels[i+1]!==255||pixels[i+2]!==255||pixels[i+3]!==255)return false;return true;
  },png.bytes.toString('base64'));
  assert.equal(whiteGap,true);assert.deepEqual(p.errors,[]);await p.close();
});
