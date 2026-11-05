// Выпуск 2: маршруты «Визуала» — проверка связи, нарезка, черновые промпты, правка сцены, выгрузка, эталоны, шаблоны Lumean.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ts-visual-routes-"));
process.env.DATA_DIR = dir;
const { config } = await import("../src/config.js");
config.dataDir = dir;
config.keys.glabs = "";
config.keys.lumean = "";
const G = await import("../src/services/studio/glabs.js");
const projects = await import("../src/services/projects.js");
const { studioRoute } = await import("../src/routes/studio.js");
G.setGlabsFetcher(async (url) => new URL(url).pathname === "/api/health" ? new Response(JSON.stringify({ status: "ok", tasks_pending: 1, tasks_running: 0 }), { status: 200 }) : new Response("{}", { status: 401 }));
after(async () => { G.setGlabsFetcher(null); await fs.rm(dir, { recursive: true, force: true }); });
const call = async (method: string, url: string, body?: unknown) => {
  const r = await studioRoute.request(url, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* файл */ }
  return { status: r.status, json, text, headers: r.headers };
};
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(400, 3)]);
const SCRIPT = "The snow fell for a whole year. Nobody in the valley had seen anything like it before. The harvest failed and bread became a luxury.\n\nThe old king opened the granaries. The grain lasted three weeks. Then a clerk found a secret ledger in the cellar.";

test("визуал: связь, сцены, черновые промпты, правка, выгрузка", async () => {
  const g = await call("GET", "/studio/visual/glabs");
  assert.equal(g.status, 200);
  assert.equal(g.json.data.ok, false); assert.equal(g.json.data.code, "KEY_MISSING"); assert.match(g.json.data.message, /Webhook/);
  const c = await call("POST", "/studio/channels", { name: "Frost", language: "en" });
  const id = c.json.data.id;
  assert.equal(c.json.data.visual.imageModel, "nano_banana_2");
  assert.equal(c.json.data.visual.clipSec, 8);
  const u = await call("PATCH", `/studio/channels/${id}`, { visual: { styleId: "builtin-obs-storybook-pencil", cast: [{ name: "OldKing", description: "Old king" }] } });
  assert.equal(u.status, 200);
  assert.equal((await call("PATCH", `/studio/channels/${id}`, { visual: { cast: [{ name: "Old King" }] } })).status, 400, "имя с пробелом не принимается");
  assert.equal((await call("PATCH", `/studio/channels/${id}`, { visual: { cast: [{ name: "Oldking" }, { name: "OLDKING" }] } })).status, 400, "повтор имени");
  const p = await projects.createProject({ title: "Frost", channelId: id, artifact: { kind: "script", title: "Сценарий", data: { script: SCRIPT } } as any });
  assert.equal((await call("POST", "/studio/visual/projects/bad.id/scenes", { channelId: id })).status, 400);
  const s = await call("POST", `/studio/visual/projects/${p.id}/scenes`, { channelId: id });
  assert.equal(s.status, 200); assert.ok(s.json.data.rows.length >= 3);
  const pr = await call("POST", `/studio/visual/projects/${p.id}/prompts`, { channelId: id, free: true });
  assert.equal(pr.status, 200); assert.equal(pr.json.data.result.written, s.json.data.rows.length);
  const st = await call("GET", `/studio/visual/projects/${p.id}`);
  assert.equal(st.json.data.board.rows.length, s.json.data.rows.length);
  assert.equal(st.json.data.reasons.artifacts, "Искажения: руки, лица, лишний текст");
  assert.equal(st.json.data.running, null);
  const e = await call("PATCH", `/studio/visual/projects/${p.id}/scenes/1`, { concept: "@OldKing counts sacks of grain by candlelight" });
  assert.equal(e.status, 200); assert.deepEqual(e.json.data.rows[0].cast, ["OldKing"]);
  assert.equal((await call("PATCH", `/studio/visual/projects/${p.id}/scenes/999`, { animate: true })).status, 404);
  assert.equal((await call("PATCH", `/studio/visual/projects/${p.id}/scenes/1`, { picture: { verdict: "redo", reason: "artifacts" } })).status, 400, "переделать можно только готовую картинку");
  const x = await call("GET", `/studio/visual/projects/${p.id}/export/images.txt`);
  assert.equal(x.status, 200);
  assert.match(x.headers.get("content-type")!, /text\/plain/);
  assert.match(x.headers.get("content-disposition")!, /prompts_images\.txt/);
  assert.equal(x.text.split("\n")[0], e.json.data.rows[0].image);
  const j = await call("GET", `/studio/visual/projects/${p.id}/export/scenes.json`);
  assert.equal(j.json.schema, 1);
  assert.equal((await call("GET", `/studio/visual/projects/${p.id}/export/other.txt`)).status, 400);
  const r = await call("POST", `/studio/visual/projects/${p.id}/render`, { channelId: id, what: "images" });
  assert.equal(r.status, 200); assert.ok(r.json.data.jobId, "картинки запускаются задачей");
});

test("эталоны: большой файл проходит только в загрузку эталона; шаблоны Lumean без ключа — понятная ошибка", async () => {
  const c = await call("POST", "/studio/channels", { name: "Cast", language: "en" });
  const id = c.json.data.id;
  await call("PATCH", `/studio/channels/${id}`, { visual: { cast: [{ name: "ThroneHall", kind: "location" }] } });
  assert.equal((await call("POST", `/studio/channels/${id}/cast/ThroneHall/image`, { image: "data:image/png;base64," + Buffer.alloc(200, 1).toString("base64") })).status, 400);
  assert.equal((await call("POST", `/studio/channels/${id}/cast/Nobody/image`, { image: "data:image/png;base64," + PNG.toString("base64") })).status, 404);
  const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024, 5)]);
  const ok = await call("POST", `/studio/channels/${id}/cast/ThroneHall/image`, { image: "data:image/png;base64," + big.toString("base64") });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.visual.cast[0].image, `_cast/${id}/ThroneHall.png`);
  assert.equal((await call("PATCH", `/studio/channels/${id}`, { notes: "x".repeat(2 * 1024 * 1024) })).status, 413, "обычные запросы — до 1 МБ");
  const t = await call("GET", "/studio/voice/templates");
  assert.equal(t.status, 400); assert.equal(t.json.error.code, "KEY_MISSING");
});
