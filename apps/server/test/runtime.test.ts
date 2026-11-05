import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ts-runtime-"));
process.env.DATA_DIR = tmp; process.env.ENV_FILE = path.join(tmp, "absent.env");
process.env.ANYMODEL_API_KEY = "fake-private-test-key-only";
const { RequestQueue, queueStatus } = await import("../src/lib/queue.js");
const { runTask, checkCancelled } = await import("../src/lib/taskContext.js");
const { fetchRetry, sleep, retryDelay } = await import("../src/lib/http.js");
const { amChat, amImage, amSpeech } = await import("../src/services/anymodel.js");
const { startJob, cancelJob, getJob } = await import("../src/lib/jobs.js");
const { cached, clearCache, cacheStats } = await import("../src/lib/cache.js");
const { createLogger, RotatingLog, flushLogs } = await import("../src/lib/logging.js");
const delay = (ms = 5) => new Promise<void>(r => setTimeout(r, ms));
const isCancel = (e: any) => e?.code === "CANCELLED";
after(async () => { await flushLogs(); await fs.rm(tmp, { recursive: true, force: true }); });

test("queue: FIFO, shared concurrency bound and release after failure", async () => {
  const q = new RequestQueue(2), order: number[] = []; let active = 0, max = 0;
  await Promise.allSettled(Array.from({ length: 8 }, (_, n) => q.run(async () => { order.push(n); max = Math.max(max, ++active); await delay(); active--; if (n === 2) throw new Error("fake"); })));
  assert.equal(max, 2); assert.deepEqual(order, [0,1,2,3,4,5,6,7]); assert.deepEqual(q.snapshot(), { limit: 2, active: 0, waiting: 0 });
});
test("queue: abort removes waiter without invoking provider; already-aborted rejected", async () => {
  const q = new RequestQueue(1), release = await q.acquire(), abort = new AbortController(); let called = false;
  const p = q.run(async () => { called = true; }, abort.signal);
  assert.equal(q.snapshot().waiting, 1); abort.abort(); await assert.rejects(p, isCancel); release();
  assert.equal(called, false); await assert.rejects(async () => q.acquire(abort.signal), isCancel); assert.equal(q.snapshot().active, 0);
});
test("providers: actual AnyModel leaf calls obey 2/3/1 limits across callers", async () => {
  const original = globalThis.fetch; const active = { llm: 0, image: 0, tts: 0 }, peak = { ...active };
  globalThis.fetch = (async (url: string | URL | Request) => {
    const kind = String(url).includes("/images/") ? "image" : String(url).includes("/speech") ? "tts" : "llm";
    peak[kind] = Math.max(peak[kind], ++active[kind]); await delay(15); active[kind]--;
    return kind === "tts" ? new Response(new Uint8Array([1,2,3]), { headers: { "content-type": "audio/mpeg" } }) : Response.json(kind === "image" ? { data: [{ b64_json: "AAAA" }] } : { choices: [{ message: { content: "mock answer" } }] });
  }) as typeof fetch;
  try {
    await Promise.all(Array.from({ length: 6 }, () => Promise.all([
      amChat({ model: "fake", system: "private", user: "private" }),
      amImage({ model: "fake", prompt: "private", size: "1024x1024", quality: "medium" }), amSpeech("fake", "private"),
    ])));
    assert.deepEqual(peak, { llm: 2, image: 3, tts: 1 }); for (const q of Object.values(queueStatus())) assert.equal(q.active + q.waiting, 0);
  } finally { globalThis.fetch = original; }
});
test("http: job cancellation is combined with caller signal, no retries", async () => {
  const original = globalThis.fetch, job = new AbortController(), caller = new AbortController(); let calls = 0;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => { calls++; return new Promise((_res, reject) => { init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }); }); }) as typeof fetch;
  try { const p = runTask({ signal: job.signal }, () => fetchRetry("https://fake.test", { signal: caller.signal })); await delay(); job.abort(); await assert.rejects(p, isCancel); assert.equal(calls, 1); assert.equal(caller.signal.aborted, false); }
  finally { globalThis.fetch = original; }
});
test("http: cancellation interrupts Retry-After wait and polling sleep", async () => {
  const original = globalThis.fetch, a = new AbortController(); let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response("rate", { status: 429, headers: { "retry-after": "60" } }); }) as typeof fetch;
  try { const p = runTask({ signal: a.signal }, () => fetchRetry("https://fake.test")); await delay(); a.abort(); await assert.rejects(p, isCancel); assert.equal(calls, 1); await assert.rejects(async () => sleep(30_000, a.signal), isCancel); }
  finally { globalThis.fetch = original; }
  assert.equal(retryDelay("2", 0), 2000); assert.equal(retryDelay("invalid", 2), 9000); assert.equal(retryDelay("Thu, 01 Jan 1970 00:00:10 GMT", 0, 0), 10_000);
});
test("jobs: cancellation propagates into pending HTTP and emits one error, never done", async () => {
  const original = globalThis.fetch; let entered = false;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => { entered = true; return new Promise((_r, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true })); }) as typeof fetch;
  try {
    const id = startJob(async () => { await fetchRetry("https://fake.test"); return "must not finish"; });
    while (!entered) await delay(); assert.equal(cancelJob(id), true);
    for (let i = 0; i < 100 && !getJob(id)!.done; i++) await delay();
    const j = getJob(id)!; assert.equal(j.done, true); assert.deepEqual(j.events.map(e => e.type), ["error"]); assert.equal((j.events[0] as any).error.code, "CANCELLED"); assert.equal(cancelJob(id), false);
  } finally { globalThis.fetch = original; }
});
test("jobs: synchronous throw is captured; completed jobs cannot be cancelled", async () => {
  const id = startJob(() => { throw new Error("fake failure"); }); await delay(); assert.equal(getJob(id)!.done, true); assert.equal(getJob(id)!.events[0].type, "error"); assert.equal(cancelJob(id), false);
  assert.throws(() => runTask({ signal: AbortSignal.abort() }, () => checkCancelled()), isCancel);
});
test("cache: clear only removes cache; in-flight old results cannot refill it", async () => {
  for (const [f, s] of Object.entries({ "projects/keep.json": "project", "oauth.json": "fake oauth", "yt-quota.json": "quota" })) { await fs.mkdir(path.dirname(path.join(tmp, f)), { recursive: true }); await fs.writeFile(path.join(tmp, f), s); }
  await cached("ready", 60_000, async () => "cached"); assert.equal((await cacheStats()).files, 1);
  let release!: () => void, started!: () => void;
  const signal = new Promise<void>(r => started = r), gate = new Promise<void>(r => release = r);
  const pending = cached("late", 60_000, async () => { started(); await gate; return "late"; }); await signal;
  assert.equal((await clearCache()).files, 1); release(); await pending; assert.equal((await cacheStats()).files, 0);
  for (const [f, s] of Object.entries({ "projects/keep.json": "project", "oauth.json": "fake oauth", "yt-quota.json": "quota" })) assert.equal(await fs.readFile(path.join(tmp, f), "utf8"), s);
  await cached("new", 60_000, async () => "new"); assert.equal((await cacheStats()).files, 1);
});
test("cache: root symlink is rejected and its destination remains untouched", async () => {
  await fs.rm(path.join(tmp, "cache"), { recursive: true }); const outside = path.join(tmp, "outside"); await fs.mkdir(outside); await fs.writeFile(path.join(outside, "keep"), "safe");
  await fs.symlink(outside, path.join(tmp, "cache")); await assert.rejects(clearCache(), /символические/); assert.equal(await fs.readFile(path.join(outside, "keep"), "utf8"), "safe"); await fs.unlink(path.join(tmp, "cache"));
});
test("logging: Pino redacts secrets, OAuth query values and payload fields", () => {
  let output = ""; const log = createLogger({ write: s => { output += s; } }, () => ["fake-secret-123"]);
  log.info({ headers: { authorization: "private" }, prompt: "private prompt", clips: ["private audio"], nested: { refresh_token: "fake token" }, note: "Bearer bearer123 https://fake.test?code=secretcode&state=secretstate fake-secret-123" }, "safe event");
  const row = JSON.parse(output); assert.equal(row.level, 30); assert.equal(row.prompt, "[redacted]"); assert.equal(row.headers, "[redacted]");
  for (const value of ["private prompt", "private audio", "fake token", "bearer123", "secretcode", "secretstate", "fake-secret-123"]) assert.ok(!output.includes(value), value);
});
test("logging: rotation retains only configured history, bounded files and 0600 mode", async () => {
  const file = path.join(tmp, "rotation", "app.log"), destination = new RotatingLog(file, 256, 5), log = createLogger(destination, () => []);
  for (let i = 0; i < 30; i++) log.info({ event: "test", i }, "rotation message"); log.info("x".repeat(1000)); await destination.flush();
  const files = await fs.readdir(path.dirname(file)); assert.equal(files.length, 6);
  for (const f of files) { const stat = await fs.stat(path.join(path.dirname(file), f)); assert.ok(stat.size <= 256); if(process.platform!=='win32')assert.equal(stat.mode & 0o777, 0o600); for (const line of (await fs.readFile(path.join(path.dirname(file), f), "utf8")).trim().split("\n")) JSON.parse(line); }
  assert.match(await fs.readFile(file, "utf8"), /log_record_oversize/);
});

test("http: timeout stays an upstream failure rather than user cancellation", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    calls++; return new Promise((_r, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
  }) as typeof fetch;
  // Keep event loop alive: AbortSignal.timeout's timer is unref'ed.
  const keepAlive = setInterval(() => {}, 100);
  try { await assert.rejects(fetchRetry("https://fake.test", {}, { timeoutMs: 10, retries: 0 }), (e: any) => e.code === "UPSTREAM"); assert.equal(calls, 1); }
  finally { clearInterval(keepAlive); globalThis.fetch = original; }
});
test("SSE: completion during snapshot write is delivered before stream closes", async () => {
  const { Hono } = await import("hono"); const { jobsRoute } = await import("../src/routes/jobs.js");
  const app = new Hono(); app.route("/api", jobsRoute);
  const id = startJob(async ctx => { for (let i = 0; i < 300; i++) ctx.progress("test", i / 3); await delay(); return { mock: true }; });
  const response = await app.request(`/api/jobs/${id}/stream`); const text = await response.text();
  assert.equal((text.match(/event: done/g) ?? []).length, 1); assert.match(text, /"mock":true/); assert.equal(getJob(id)!.listeners.size, 0);
});
test("FFmpeg: cancellation kills running processing and rejects with CANCELLED", async () => {
  if (process.platform === "win32") return; // portable executable fixture uses a Unix shell
  const fake = path.join(tmp, "fake-ffmpeg"); await fs.writeFile(fake, '#!/bin/sh\nif [ "$1" = "-version" ]; then exit 0; fi\nexec sleep 30\n', { mode: 0o700 });
  const old = process.env.FFMPEG_PATH; process.env.FFMPEG_PATH = fake;
  try {
    const { applyVoiceFx } = await import("../src/services/audioFx.js"); const a = new AbortController();
    const pending = runTask({ signal: a.signal }, () => applyVoiceFx(Buffer.from("fake audio"), 2, 0));
    await delay(20); a.abort(); await assert.rejects(pending, isCancel);
    await assert.rejects(runTask({ signal: a.signal }, () => applyVoiceFx(Buffer.from("x"), 1, 0)), isCancel);
  } finally { if (old === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = old; }
});

test("LLM: cancellation during body parsing never switches to fallback model", async () => {
  const original = globalThis.fetch, a = new AbortController(); let calls = 0;
  globalThis.fetch = (async () => {
    calls++; const response = Response.json({ error: { message: "fake upstream failure" } }, { status: 400 });
    response.json = async () => { a.abort(); throw new DOMException("fake abort", "AbortError"); }; return response;
  }) as typeof fetch;
  try {
    const { generateText } = await import("../src/services/llm.js");
    await assert.rejects(runTask({ signal: a.signal }, () => generateText({ system: "private", user: "private" })), isCancel);
    assert.equal(calls, 1); assert.equal(queueStatus().llm.active, 0);
  } finally { globalThis.fetch = original; }
});

test("maintenance API: configured password protects status and destructive clear", async () => {
  const { Hono } = await import("hono"), { config } = await import("../src/config.js");
  const { auth, requireAuth, extToken } = await import("../src/routes/auth.js"); const { system } = await import("../src/routes/system.js");
  const previous = config.password; config.password = "fake-runtime-password-only";
  const app = new Hono(); app.use("/api/*", requireAuth); app.route("/api", auth); app.route("/api", system);
  try {
    await fs.mkdir(path.join(tmp, "cache"), { recursive: true }); await fs.writeFile(path.join(tmp, "cache", "auth-test.json"), "fake");
    assert.equal((await app.request("/api/system/runtime")).status, 401);
    assert.equal((await app.request("/api/system/cache/clear", { method: "POST" })).status, 401);
    assert.equal(await fs.readFile(path.join(tmp, "cache", "auth-test.json"), "utf8"), "fake");
    assert.equal((await app.request("/api/system/runtime", {headers:{"x-ts-token":extToken()}})).status,403);
    assert.equal((await app.request("/api/system/cache/clear", {method:"POST",headers:{"x-ts-token":extToken()}})).status,403);
    const login=await app.request("/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password:config.password})});
    const headers = { cookie: login.headers.get("set-cookie")!.split(";")[0] };
    const status = await app.request("/api/system/runtime", { headers }); assert.equal(status.status, 200);
    const j = await status.json(); assert.equal(j.data.queues.llm.limit, 2); assert.equal(j.data.logs.backups, 5);
    assert.equal((await app.request("/api/system/cache/clear", { method: "POST", headers })).status, 200);
    assert.equal((await cacheStats()).files, 0);
  } finally { config.password = previous; }
});
