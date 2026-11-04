// Ротация ключей YouTube: квота кончилась → следующий ключ; все исчерпаны → YT_QUOTA
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ts-yt-"));
const { config } = await import("../src/config.js");
const { searchVideos } = await import("../src/services/youtube.js");
const { ytPoolStatus, resetYtPool } = await import("../src/services/ytKeys.js");

const calls: string[] = [];
let quotaFor = new Set<string>();
globalThis.fetch = (async (url: string) => {
  const key = new URL(url).searchParams.get("key")!; calls.push(key);
  if (quotaFor.has(key)) return new Response(JSON.stringify({ error: { code: 403, message: "quota", errors: [{ reason: "quotaExceeded" }] } }), { status: 403 });
  if (key === "BAD") return new Response(JSON.stringify({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", errors: [{ reason: "badRequest" }] } }), { status: 400 });
  return new Response(JSON.stringify({ items: [{ id: { videoId: `v-${key}` } }] }), { status: 200 });
}) as typeof fetch;

test("ключ 1 без квоты → ключ 2, дальше сразу ключ 2", async () => {
  config.keys.youtube = "K1"; config.keys.youtube2 = "K2"; config.keys.youtube3 = "K3"; resetYtPool();
  quotaFor = new Set(["K1"]);
  assert.deepEqual(await searchVideos("a"), ["v-K2"]);
  calls.length = 0;
  assert.deepEqual(await searchVideos("b"), ["v-K2"]);
  assert.deepEqual(calls, ["K2"]);
  const st = await ytPoolStatus();
  assert.equal(st.active, "youtube2");
  assert.equal(st.keys[0].state, "exhausted");
  assert.equal(st.keys[2].state, "standby");
});

test("недействительный ключ пропускается, все исчерпаны → YT_QUOTA", async () => {
  config.keys.youtube = "BAD"; config.keys.youtube2 = "Q2"; config.keys.youtube3 = "Q3"; resetYtPool();
  quotaFor = new Set(["Q2"]);
  assert.deepEqual(await searchVideos("c"), ["v-Q3"]);
  quotaFor = new Set(["Q2", "Q3"]);
  await assert.rejects(searchVideos("d"), (e: any) => e.code === "YT_QUOTA" && /всех 3 ключах/.test(e.message));
});
