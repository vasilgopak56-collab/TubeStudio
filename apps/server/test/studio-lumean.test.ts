// Выпуск 1: озвучка Lumean. Поддельный Lumean: деньги не тратятся, проверяется защита от двойной оплаты.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ts-lumean-"));
process.env.DATA_DIR = dir;
const { config } = await import("../src/config.js");
config.dataDir = dir;
config.keys.lumean = "test-key";
const L = await import("../src/services/studio/lumean.js");
const ch = await import("../src/services/studio/channels.js");
const projects = await import("../src/services/projects.js");
L.LUMEAN_POLL.ms = 5;
after(async () => { L.setLumeanFetcher(null); await fs.rm(dir, { recursive: true, force: true }); });

type Call = { method: string; path: string; body?: any };
type World = { calls: Call[]; orders: Map<string, { id: string; name: string; status: string; polls: number; text: string }>; failCreate?: "402" | "network" | "topup"; finalStatus?: string; templates: number };
let w: World;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function lumean(world: World) {
  return async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (u.hostname === "files.example") return new Response(Buffer.from(`file:${u.pathname}`), { status: 200 });
    assert.equal((init?.headers as Record<string, string>)["X-API-KEY"], "test-key");
    const p = u.pathname.replace("/api/public", "");
    world.calls.push({ method, path: p + u.search, body });
    if (method === "POST" && p === "/templates") { world.templates++; return json(201, { success: true, data: { id: `tpl-${world.templates}` } }); }
    if (method === "POST" && p === "/orders/chunks/preview") return json(200, { success: true, data: { total_chunks: 2, estimated_tokens: 1200 } });
    if (p === "/subscriptions") return json(200, { success: true, data: { subscriptions: [{ current_period_end: "2026-12-01", items: [{ plan: { name: "Creator" }, tokens_remaining: 50000, token_allowance: 100000, is_usable: true }] }] } });
    if (p === "/wallets") return json(200, { success: true, data: { items: [{ balance_formatted: "12.5", locked_balance_formatted: "0", asset: { code: "LMC" } }] } });
    if (p === "/usage") return json(200, { success: true, data: [] });
    if (method === "POST" && p === "/orders") {
      if (world.failCreate === "402") return json(402, { success: false, message: "Insufficient", reason: "payg_required" });
      if (world.failCreate === "topup" && !(body.confirm_payg_topup === true && body.quote_token === "Q1")) return json(402, { success: false, message: "Top-up", reason: "payg_topup_required", shortfall_lmc: 3.6, shortfall_lmc_minor: 360000000, quote_token: "Q1", expires_at: "2026-11-05T12:00:00Z" });
      const id = `ord-${world.orders.size + 1}`;
      world.orders.set(id, { id, name: body.name, status: "created", polls: 0, text: body.input_text });
      if (world.failCreate === "network") throw new TypeError("fetch failed");
      return json(201, { success: true, data: { id, status: "created" } });
    }
    if (method === "GET" && p === "/orders") return json(200, { success: true, data: { items: [...world.orders.values()].map((o) => ({ id: o.id, name: o.name, status: o.status })) } });
    const m = p.match(/^\/orders\/([\w-]+)$/);
    if (method === "GET" && m) {
      const o = world.orders.get(m[1]);
      if (!o) return json(404, { success: false, message: "not found" });
      o.polls++;
      o.status = o.polls < 2 ? "in_progress" : (world.finalStatus ?? "completed");
      const done = o.status === "completed";
      return json(200, { success: true, data: { id: o.id, status: o.status, completed_chunks: done ? 2 : 1, total_chunks: 2, progress_percent: done ? 100 : 50, tokens_spent: 1200, total_duration_ms: 61000, items: [], result: done ? { files: [`storage/1/orders/${o.id}/output/final/result.mp3`], service_files: [`storage/1/orders/${o.id}/output/final/service/subtitles.srt`] } : null } });
    }
    if (method === "POST" && p === "/storage/url") return json(200, { success: true, data: { url: `https://files.example/${encodeURIComponent(body.path)}` } });
    return json(404, { success: false, reason: "endpoint_not_found" });
  };
}
const ctx = { progress: () => {}, partial: () => {}, signal: new AbortController().signal };
const SCRIPT = "## Вступление\n\nДиктор: Почему мы верим тем, кто говорит уверенно? [музыка] {{pause=1s}}\n\nПотому что мозг экономит силы (это важно) и *доверяет* тону.";
let channelId = "";
let projectId = "";
beforeEach(async () => {
  w = { calls: [], orders: new Map(), templates: 0 };
  L.setLumeanFetcher(lumean(w));
  if (!channelId) {
    const c = await ch.createChannel({ name: "Психология", language: "ru" });
    channelId = (await ch.updateChannel(c.id, { voice: { provider: "lumean", service: "elevenlabs", voiceId: "voice-A", voiceName: "Анна" } })).id;
  }
  const p = await projects.createProject({ title: "Уверенность", channelId, artifact: { kind: "script", title: "Сценарий", data: { script: SCRIPT } } as any });
  projectId = p.id;
});
const posts = (path: string) => w.calls.filter((c) => c.method === "POST" && c.path === path).length;

test("текст для озвучки: разметка убрана, слова и паузы сохранены", () => {
  const t = L.voiceText(SCRIPT);
  assert.equal(t, "Вступление\n\nПочему мы верим тем, кто говорит уверенно? {{pause=1s}}\n\nПотому что мозг экономит силы и доверяет тону.");
});

test("заказ: один шаблон, один заказ, файлы скачаны в проект; повтор не создаёт второй заказ", async () => {
  const r = await L.runVoice({ channelId, projectId }, ctx);
  assert.equal(r.reused, false);
  assert.equal(posts("/templates"), 1);
  assert.equal(posts("/orders"), 1);
  const order = [...w.orders.values()][0];
  assert.match(order.name, /^TS-[a-f0-9]{10} Уверенность$/);
  assert.ok(!order.text.includes("Диктор") && !order.text.includes("[музыка]"));
  const p = await projects.getProject(projectId);
  const audio = p.artifacts.find((a) => a.kind === "audio")!;
  assert.ok(audio, "в проекте появился материал «audio»");
  assert.equal((audio.data as any).audio, `voice/${r.orderId}/result.mp3`);
  assert.deepEqual((audio.data as any).subtitles, [`voice/${r.orderId}/subtitles.srt`]);
  const mp3 = await fs.readFile(path.join(dir, "files", projectId, "voice", r.orderId, "result.mp3"), "utf8");
  assert.match(mp3, /result\.mp3/);
  // Повторное нажатие с тем же текстом и голосом: новый заказ не создаётся, шаблон не пересоздаётся.
  w.calls = [];
  const again = await L.runVoice({ channelId, projectId }, ctx);
  assert.equal(again.reused, true);
  assert.equal(again.orderId, r.orderId);
  assert.equal(posts("/orders"), 0);
  assert.equal(posts("/templates"), 0);
  // Смена голоса → новый шаблон.
  await ch.updateChannel(channelId, { voice: { voiceId: "voice-B" } });
  const est = await L.estimateVoice(channelId, SCRIPT);
  assert.equal(posts("/templates"), 1);
  assert.equal(est.existing, null, "для нового голоса прошлый заказ не считается готовым");
  assert.equal(est.account?.tokensRemaining, 50000);
  assert.equal(posts("/orders"), 0, "оценка не создаёт заказ");
});

test("нехватка денег (402): понятная ошибка, текст можно отправить снова после пополнения", async () => {
  w.failCreate = "402";
  await assert.rejects(L.runVoice({ channelId, projectId, text: "Совсем другой текст для проверки оплаты и ошибок." }, ctx), { code: "LUMEAN_PAYG_REQUIRED" });
  w.failCreate = undefined;
  const r = await L.runVoice({ channelId, projectId, text: "Совсем другой текст для проверки оплаты и ошибок." }, ctx);
  assert.equal(r.reused, false);
  assert.equal(posts("/orders"), 2, "первая попытка отклонена до оплаты, вторая создала заказ");
});

test("обрыв связи при отправке: заказ находится по имени, второй раз не оплачивается", async () => {
  const text = "Третий текст: проверяем, что обрыв связи не приводит к двойной оплате.";
  w.failCreate = "network";
  await assert.rejects(L.runVoice({ channelId, projectId, text }, ctx), (e: any) => e.details?.uncertain === true);
  assert.equal(w.orders.size, 1, "Lumean успел создать заказ");
  w.failCreate = undefined;
  const r = await L.runVoice({ channelId, projectId, text }, ctx);
  assert.equal(posts("/orders"), 1, "повторно заказ не отправлялся");
  assert.equal(r.orderId, [...w.orders.values()][0].id);
  const reg = await L.lumeanOrders();
  assert.equal(reg.find((x) => x.orderId === r.orderId)?.uncertain, false);
});

test("неудачный заказ: без согласия не повторяется, с «ещё раз» — новый заказ", async () => {
  const text = "Четвёртый текст: Lumean вернул отказ по всему заказу.";
  w.finalStatus = "compensated";
  await assert.rejects(L.runVoice({ channelId, projectId, text }, ctx), /Озвучить ещё раз/);
  await assert.rejects(L.runVoice({ channelId, projectId, text }, ctx), /compensated/);
  assert.equal(posts("/orders"), 1, "без согласия второй заказ не создан");
  w.finalStatus = undefined;
  const r = await L.runVoice({ channelId, projectId, text, again: true }, ctx);
  assert.equal(posts("/orders"), 2);
  assert.equal(r.status, "completed");
});

test("запасной режим Lumean: доплата подтверждается только в разрешённых пределах", async () => {
  const text = "Пятый текст: квоты не хватает, Lumean просит подтвердить доплату.";
  w.failCreate = "topup";
  await assert.rejects(L.runVoice({ channelId, projectId, text }, ctx), (e: any) => e.code === "LUMEAN_PAYG_REQUIRED" && e.details?.topupLmc === 3.6 && !("quoteToken" in e.details));
  await assert.rejects(L.runVoice({ channelId, projectId, text, topupMaxLmc: 1 }, ctx), { code: "LUMEAN_PAYG_REQUIRED" });
  assert.equal(w.calls.filter((c) => c.path === "/orders" && c.body?.confirm_payg_topup).length, 0, "сверх разрешённой суммы согласие не отправлено");
  const r = await L.runVoice({ channelId, projectId, text, topupMaxLmc: 3.6 }, ctx);
  assert.equal(r.status, "completed");
  assert.equal(w.orders.size, 1);
  assert.equal(w.calls.filter((c) => c.path === "/orders" && c.body?.confirm_payg_topup && c.body?.quote_token === "Q1").length, 1);
});
