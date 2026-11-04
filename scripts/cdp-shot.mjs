// Скриншот страницы через headless Chromium (CDP): node scripts/cdp-shot.mjs <url> <out.png> [waitSec] [preJs] [postJs]
// preJs выполняется после загрузки (например, кладёт черновик в localStorage и делает reload), postJs — через 3 с (клик по кнопке).
import { spawn } from "node:child_process";
import fs from "node:fs";
const [url, out, waitSec = "5", jsFile, jsFile2] = process.argv.slice(2);
const chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=9333", "--window-size=1440,1000", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; for (let i = 0; i < 40; i++) { try { const l = await (await fetch("http://127.0.0.1:9333/json")).json(); const p = l.find((x) => x.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(250); }
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const run = async (f) => { const r = await send("Runtime.evaluate", { expression: fs.readFileSync(f, "utf8"), awaitPromise: true }); console.log("js:", JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.text ?? "")); };
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url }); await sleep(2500);
if (jsFile) await run(jsFile);
if (jsFile2) { await sleep(3000); await run(jsFile2); }
await sleep(Number(waitSec) * 1000);
const { result: m } = await send("Page.getLayoutMetrics");
const h = Math.min(7000, Math.ceil(m.cssContentSize.height));
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(800);
const { result } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1440, height: h, scale: 1 } });
fs.writeFileSync(out, Buffer.from(result.data, "base64")); console.log("saved", out, h);
ws.close(); chrome.kill(); process.exit(0);
