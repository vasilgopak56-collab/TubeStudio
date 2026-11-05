// Выпуск 1: маршруты Студии — каналы, идеи, проверка сценария, озвучка без ключа.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ts-studio-routes-"));
process.env.DATA_DIR = dir;
const { config } = await import("../src/config.js");
config.dataDir = dir;
config.keys.lumean = "";
const { studioRoute } = await import("../src/routes/studio.js");
after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
const call = async (method: string, url: string, body?: unknown) => {
  const r = await studioRoute.request(url, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  return { status: r.status, json: await r.json() as any };
};
const SHIELDS = await fs.readFile(path.join(import.meta.dirname, "fixtures/scripts/shields-v1.txt"), "utf8");

test("каналы: создание, список, изменение, архив", async () => {
  const a = await call("POST", "/studio/channels", { name: "Psychology", language: "en", niche: "psychology" });
  assert.equal(a.status, 200);
  const id = a.json.data.id;
  const list = await call("GET", "/studio/channels");
  assert.equal(list.json.data.activeId, id);
  assert.equal(list.json.data.channels.length, 1);
  assert.deepEqual(list.json.data.spend, {});
  const u = await call("PATCH", `/studio/channels/${id}`, { radar: { maxSubs: 30000, minMultiplier: 5 } });
  assert.equal(u.json.data.radar.maxSubs, 30000);
  assert.equal((await call("PATCH", `/studio/channels/${id}`, { language: "English" })).status, 400);
  assert.equal((await call("POST", "/studio/channels", "{bad")).status, 400);
  assert.equal((await call("GET", "/studio/channels/not-a-uuid")).status, 400);
  assert.equal((await call("GET", "/studio/channels/00000000-0000-4000-8000-000000000000")).status, 404);
  const b = await call("POST", "/studio/channels", { name: "История", language: "ru" });
  assert.equal((await call("POST", `/studio/channels/${b.json.data.id}/archive`, { archived: true })).json.data.archived, true);
  assert.equal((await call("GET", "/studio/channels")).json.data.channels.length, 1, "архивный канал скрыт");
  assert.equal((await call("GET", "/studio/channels?archived=1")).json.data.channels.length, 2);
});

test("идеи: пустой Радар отвечает списком, чужой ролик — 404, неверный номер — 400", async () => {
  const id = (await call("GET", "/studio/channels")).json.data.activeId;
  const r = await call("GET", `/studio/channels/${id}/ideas?sort=new&period=month`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data.ideas, []);
  assert.equal(r.json.data.running, false);
  assert.equal((await call("POST", `/studio/channels/${id}/ideas/dQw4w9WgXcQ/hide`)).status, 404);
  assert.equal((await call("POST", `/studio/channels/${id}/ideas/bad/take`)).status, 400);
  assert.equal((await call("POST", `/studio/channels/${id}/ideas/dQw4w9WgXcQ/delete`)).status, 400);
});

test("проверка сценария: на Shields находит описательное вступление, оговорки и повтор", async () => {
  const id = (await call("GET", "/studio/channels")).json.data.activeId;
  const r = await call("POST", "/studio/script/lint", { text: SHIELDS, channelId: id });
  assert.equal(r.status, 200);
  const rules = r.json.data.issues.map((i: any) => i.rule);
  for (const rule of ["opening-descriptive", "hedges"]) assert.ok(rules.includes(rule), `нет правила ${rule}: ${rules.join(", ")}`);
  assert.ok(r.json.data.issues.some((i: any) => i.rule.startsWith("repeat")), "нет повтора вывода");
  assert.ok(r.json.data.errors >= 2);
  assert.equal((await call("POST", "/studio/script/lint", { text: "" })).status, 400);
  assert.equal((await call("POST", "/studio/script", { channelId: id })).status, 400, "без темы сценарий не запускается");
});

test("озвучка без ключа Lumean: понятная ошибка, заказов нет", async () => {
  const id = (await call("GET", "/studio/channels")).json.data.activeId;
  const a = await call("GET", "/studio/voice/account");
  assert.equal(a.json.error.code, "KEY_MISSING");
  assert.match(a.json.error.message, /Lumean/);
  const e = await call("POST", "/studio/voice/estimate", { channelId: id, text: "Короткий текст для оценки озвучки." });
  assert.equal(e.status, 400);
  assert.deepEqual((await call("GET", "/studio/voice/orders")).json.data.orders, []);
  assert.equal((await call("POST", "/studio/voice", { channelId: id, projectId: "x", extra: 1 })).status, 400);
});
