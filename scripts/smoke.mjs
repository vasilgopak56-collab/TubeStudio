// «Живой» smoke-тест на реальных ключах: npm run smoke [-- --record] [-- --only=seo,script]
// Если сервер не запущен — поднимает apps/server/dist с ../../.env. --record сохраняет ответы в tests/e2e/fixtures/.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const BASE = process.env.SMOKE_URL ?? "http://127.0.0.1:8787";
const RECORD = process.argv.includes("--record");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);
const FIX = path.resolve("tests/e2e/fixtures");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const C = { g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m` };

async function api(p, body) {
  const r = await fetch(BASE + "/api" + p, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const j = await r.json(); if (!j.ok) { const e = new Error(j.error?.message ?? `HTTP ${r.status}`); e.code = j.error?.code; throw e; } return j.data;
}
/** POST → jobId → SSE до done/error */
async function job(p, body, timeoutMs = 600_000) {
  const { jobId } = await api(p, body);
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE}/api/jobs/${jobId}/stream`, { signal: ctl.signal });
    const dec = new TextDecoder(); let buf = "", last = "";
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true }); let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = block.match(/^event: (.+)$/m)?.[1], data = block.match(/^data: (.+)$/m)?.[1]; if (!data) continue;
        const d = JSON.parse(data);
        if (ev === "progress" && d.stage !== last) { last = d.stage; process.stdout.write(C.d(`    · ${d.stage} (${d.pct}%)\n`)); }
        if (ev === "done") return d.data;
        if (ev === "error") { const e = new Error(d.error.message); e.code = d.error.code; throw e; }
      }
    }
    throw new Error("SSE оборвался без результата");
  } finally { clearTimeout(t); }
}

async function ensureServer() {
  try { await api("/health"); return null; } catch { /* поднимаем */ }
  console.log(C.d("Сервер не отвечает — запускаю apps/server/dist…"));
  const p = spawn("node", ["--env-file-if-exists=../../.env", "dist/index.js"], { cwd: "apps/server", stdio: "ignore" });
  for (let i = 0; i < 40; i++) { await sleep(500); try { await api("/health"); return p; } catch { /* ждём */ } }
  p.kill(); throw new Error("Сервер не запустился (npm run build?)");
}

const results = []; const ctx = {};
async function step(name, fn, { soft } = {}) {
  if (ONLY.length && !ONLY.includes(name)) return;
  const t0 = Date.now(); process.stdout.write(`▶ ${name}\n`);
  const transient = (e) => /перегружен|превышен лимит|overloaded|UNAVAILABLE|timeout/i.test(e.message);
  try {
    let out;
    try { out = await fn(); } catch (e) { if (!transient(e)) throw e; console.log(C.y(`  ↻ ${e.message} — повтор через 30 с`)); await sleep(30_000); out = await fn(); }
    const { data, note } = out;
    if (RECORD && data !== undefined) fs.writeFileSync(path.join(FIX, `${name}.json`), JSON.stringify(data, null, 1));
    results.push({ name, status: "PASS", note, ms: Date.now() - t0 }); console.log(C.g(`  ✓ ${note ?? ""}`));
  } catch (e) {
    const s = soft?.(e) ? "WARN" : "FAIL"; results.push({ name, status: s, note: e.message, ms: Date.now() - t0 });
    console.log((s === "WARN" ? C.y : C.r)(`  ${s === "WARN" ? "⚠" : "✗"} ${e.message}`));
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const imageLimited = (e) => e.code === "LLM_RATE_LIMIT" || /billing|бесплатном|quota/i.test(e.message);

const srv = await ensureServer();
await step("health", async () => {
  const h = await api("/health?force=1");
  const bad = h.keys.filter((k) => k.required && !k.ok);
  for (const k of h.keys) console.log(C.d(`    ${k.ok ? "✓" : k.configured ? "✗" : "–"} ${k.label}: ${k.message}`));
  assert(h.llm, "Нет рабочего LLM (AnyModel, Anthropic или Gemini)");
  const hard = bad.filter((k) => k.provider !== "lumean"); assert(!hard.length, `Обязательные ключи не работают: ${hard.map((k) => k.label).join(", ")}`);
  if (bad.length) { const e = new Error(`LLM: ${h.llm}; не работает ${bad.map((k) => k.label).join(", ")} — озвучка Lumean недоступна`); e.code = "SOFT"; throw e; }
  return { note: `LLM: ${h.llm}` };
}, { soft: (e) => e.code === "SOFT" });
await step("analysis", async () => {
  const r = await job("/youtube/channel-analysis", { channel: "@kurzgesagt", videos: 15, type: "all" });
  assert(r.metrics || r.channel, "пустой отчёт"); return { data: r, note: `${r.channel?.title ?? "канал"} · ${r.videos?.length ?? "?"} видео` };
});
await step("topics", async () => {
  const r = await job("/topics", { keywords: "средневековье, гигиена", nicheDescription: "Странная история быта для взрослой аудитории", count: 5, minutes: 10, language: "ru", force: true });
  assert(r.topics?.length >= 3 || r.ideas?.length >= 3, "меньше 3 тем"); return { data: r, note: `${(r.topics ?? r.ideas).length} тем` };
});
await step("script", async () => {
  const r = await job("/script", { topic: "Почему средневековые люди боялись купаться", language: "ru", unit: "words", value: 400, research: false });
  ctx.script = r.script; const w = r.script.split(/\s+/).length;
  assert(Math.abs(w - 400) / 400 < 0.25, `длина ${w} слов при цели 400`); return { data: r, note: `${w} слов · структура ${r.plan?.structure_id || "—"} · живой голос ${r.voice ? `${r.voice.before} → ${r.voice.after}` : "выкл"}` };
});
const AI_TEXT = `Добро пожаловать на канал! В этом видео мы погрузимся в удивительную историю средневековых бань. Это не просто гигиена. Это настоящая магия общества. Важно отметить, что бани играли ключевую роль в жизни города — они были местом встреч — и источником слухов.

Учёные доказали, что в 1348 году чума изменила всё. Давайте разберёмся. Многие считают, что люди не мылись вообще. Правда в том, что бани являлись неотъемлемой частью быта, а в Париже работало 26 бань. И это меняет всё.

Таким образом, бани были быстрыми, дешёвыми и удобными. Вы наверняка думаете, что их закрыли из-за морали. Но есть нюанс: врачи считали, что горячая вода открывает поры для «дурного воздуха». В заключение, история бань — это история страха.`;
await step("humanizer", async () => {
  const r = await job("/check/humanizer", { text: AI_TEXT, language: "ru", title: "Почему средневековые люди боялись купаться", maxPasses: 2 });
  assert(typeof r.after?.score === "number" && r.scenes?.length >= 1, "нет оценки");
  assert(r.after.score >= r.before.score, `оценка ухудшилась ${r.before.score} → ${r.after.score}`);
  assert(/ОЦЕНКА:/.test(r.report), "нет отчёта");
  return { data: r, note: `живой голос ${r.before.score} → ${r.after.score}, правок в ${r.scenes.filter((s) => s.status === "edited").length}/${r.scenes.length} сценах` };
});
const script = () => ctx.script ?? "Король, который моется раз в год, и город, где бани закрыли из-за чумы. ".repeat(12);
await step("seo", async () => { const r = await job("/seo", { script: script(), language: "ru" }); assert(r.titles?.length >= 3, "мало заголовков"); return { data: r, note: `${r.titles.length} заголовков, теги ${r.tagsLength} симв.` }; });
await step("ai-detector", async () => { const r = await job("/check/ai-detector", { text: script(), language: "ru" }); assert(typeof r.humanPct === "number", "нет оценки"); return { data: r, note: `человечность ${r.humanPct}% (${r.verdict})` }; });
await step("script-rater", async () => { const r = await job("/check/script-rater", { script: script(), language: "ru" }); assert(typeof r.score === "number", "нет оценки"); return { data: r, note: `оценка ${r.score}` }; });
await step("packaging", async () => {
  const png = await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#7a1f0a" } }).composite([{ input: Buffer.from('<svg width="1280" height="720"><text x="80" y="420" font-size="160" font-family="Arial" font-weight="bold" fill="white" stroke="black" stroke-width="6">ГРЯЗЬ?</text></svg>') }]).jpeg().toBuffer();
  const r = await job("/check/packaging", { title: "Почему средневековые люди боялись купаться", image: { mime: "image/jpeg", b64: png.toString("base64") } });
  assert(typeof r.viralScore === "number", "нет Viral Score"); return { data: r, note: `Viral Score ${r.viralScore}` };
});
await step("storyboard", async () => {
  const r = await job("/storyboard", { script: script(), style: "weird_history", imageModel: "midjourney", videoModel: "kling", clip: 5, maxBatches: 1 });
  assert(r.rows?.length > 0 && r.rows.every((x) => x.image && x.video), "пустые строки"); return { data: r, note: `${r.rows.length} сцен, ошибок валидатора: ${r.batches.reduce((s, b) => s + (b.errors?.length ?? 0), 0)}` };
});
await step("thumbnail", async () => {
  const r = await job("/thumbnail/generate", { title: "Почему средневековые люди боялись купаться", language: "ru" });
  assert(r.variants?.length === 3, "нужно 3 концепта");
  const ok = r.variants.filter((v) => v.status === "done").length;
  if (!ok) { const e = new Error(`концепты готовы, картинки нет: ${r.variants[0].error}`); e.code = imageLimited({ message: r.variants[0].error ?? "" }) ? "IMAGE_LIMIT" : "UPSTREAM"; if (RECORD) fs.writeFileSync(path.join(FIX, "thumbnail.json"), JSON.stringify(r, null, 1)); throw e; }
  return { data: r, note: `${ok}/3 картинок` };
}, { soft: (e) => e.code === "IMAGE_LIMIT" });

srv?.kill();
console.log("\n" + results.map((r) => `${r.status === "PASS" ? C.g("PASS") : r.status === "WARN" ? C.y("WARN") : C.r("FAIL")}  ${r.name.padEnd(13)} ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.note ?? ""}`).join("\n"));
const fail = results.filter((r) => r.status === "FAIL").length;
console.log(fail ? C.r(`\n${fail} шаг(ов) упало`) : C.g("\nSmoke пройден") + (results.some((r) => r.status === "WARN") ? C.y(" (есть предупреждения — см. WARN)") : ""));
process.exit(fail ? 1 : 0);
