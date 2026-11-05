// Release 1 foundation: reliable writes, budget default, key store, legacy .env import,
// launch-key login, paid-request retries and the launcher control channel.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ts-release1-"));
process.env.DATA_DIR = dir;
process.env.TUBESTUDIO_PORTABLE = "1";
process.env.TUBESTUDIO_SECRETS_PROTECTION = "file";
process.env.TUBESTUDIO_CONTROL_DIR = path.join(dir, ".tubestudio-control");
process.env.TUBESTUDIO_PROGRAM_DIR = path.join(dir, "program");
const { config } = await import("../src/config.js");
config.dataDir = dir;
const storage = await import("../src/lib/storage.js");
const settings = await import("../src/services/settings.js");
const secrets = await import("../src/lib/secrets.js");
const startup = await import("../src/lib/startup.js");
const session = await import("../src/lib/session.js");
const { fetchRetry } = await import("../src/lib/http.js");
const { openSoftControl } = await import("../src/lib/softControl.js");
after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

test("storage: first save creates a backup; a damaged file is restored from it and kept for inspection", async () => {
  await storage.writeJson("r1-a.json", { v: 1 }, { backup: true });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, "r1-a.json.bak"), "utf8")), { v: 1 });
  await storage.writeJson("r1-a.json", { v: 2 }, { backup: true });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, "r1-a.json.bak"), "utf8")), { v: 1 });
  await fs.writeFile(path.join(dir, "r1-a.json"), "{ half-writ");
  assert.deepEqual(await storage.readJson("r1-a.json", null), { v: 1 });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, "r1-a.json"), "utf8")), { v: 1 });
  assert.ok((await fs.readdir(dir)).some((n) => n.startsWith("r1-a.json.damaged-")));
});

test("storage: damaged file without a usable backup is an error and is never overwritten", async () => {
  await fs.writeFile(path.join(dir, "r1-b.json"), "{ broken");
  await assert.rejects(storage.readJson("r1-b.json", { fallback: true }), { code: "INTERNAL" });
  assert.equal(await fs.readFile(path.join(dir, "r1-b.json"), "utf8"), "{ broken");
  assert.deepEqual(await storage.readJson("r1-missing.json", { fallback: true }), { fallback: true });
  // A damaged previous version never becomes the backup.
  await storage.writeJson("r1-b.json", { ok: true }, { backup: true });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, "r1-b.json.bak"), "utf8")), { ok: true });
});

test("settings: installed program starts with a $20 monthly limit that blocks; old 0/warn settings are moved once", async () => {
  await fs.rm(path.join(dir, "settings.json"), { force: true });
  let s = await settings.getSettings();
  assert.equal(s.budget.monthlyUsd, 20); assert.equal(s.budget.mode, "block");
  await fs.writeFile(path.join(dir, "settings.json"), JSON.stringify({ budget: { monthlyUsd: 0, mode: "warn", warnPct: 80 } }));
  s = await settings.getSettings();
  assert.equal(s.budget.monthlyUsd, 20); assert.equal(s.budget.mode, "block");
  assert.ok(JSON.parse(await fs.readFile(path.join(dir, "settings.json.bak"), "utf8")).budget.mode === "warn");
  s = await settings.updateSettings({ budget: { monthlyUsd: 0, mode: "warn" } });
  assert.equal((await settings.getSettings()).budget.mode, "warn", "the user's own choice is kept");
  await fs.writeFile(path.join(dir, "settings.json"), JSON.stringify({ budget: { monthlyUsd: 35, mode: "warn", warnPct: 80 } }));
  s = await settings.getSettings();
  assert.equal(s.budget.monthlyUsd, 35, "an existing positive limit is kept"); assert.equal(s.budget.mode, "block");
});

test("secrets: values are sealed, readable after reload, removable; the file never holds them as text", async () => {
  secrets.resetSecretsForTests();
  await secrets.setSecrets({ R1_TEST_KEY: "plain-value-must-not-appear-123" });
  const text = await fs.readFile(secrets.secretsFile(), "utf8");
  assert.ok(!text.includes("plain-value-must-not-appear-123"));
  secrets.resetSecretsForTests();
  assert.equal((await secrets.loadSecrets()).R1_TEST_KEY, "plain-value-must-not-appear-123");
  await secrets.setSecrets({ R1_TEST_KEY: "" });
  secrets.resetSecretsForTests();
  assert.equal((await secrets.loadSecrets()).R1_TEST_KEY, undefined);
  assert.equal(secrets.secretsStatus().protection, "file");
});

test("startup: keys from the old .env are imported once; password and folders are not", async () => {
  secrets.resetSecretsForTests();
  const legacyEnv = path.join(dir, "old.env");
  await fs.writeFile(legacyEnv, "\uFEFF# old\r\nDATA_DIR=./data\r\nAPP_PASSWORD=old-secret\r\nYOUTUBE_API_KEY=\"AIza-r1-fake\"\r\nexport ANYMODEL_API_KEY=am-r1-fake # comment\r\nPORT=8787\r\n");
  await fs.writeFile(path.join(dir, "migration.json"), JSON.stringify({ schema: 1, legacyEnv, envImported: false }));
  const r = await startup.initPortableSecrets();
  assert.deepEqual(r.imported.sort(), ["ANYMODEL_API_KEY", "YOUTUBE_API_KEY"]);
  assert.equal(config.keys.youtube, "AIza-r1-fake"); assert.equal(config.keys.anymodel, "am-r1-fake");
  const m = JSON.parse(await fs.readFile(path.join(dir, "migration.json"), "utf8"));
  assert.equal(m.envImported, true); assert.deepEqual(m.importedNames, ["ANYMODEL_API_KEY", "YOUTUBE_API_KEY"]);
  const stored = await secrets.loadSecrets();
  assert.equal(stored.APP_PASSWORD, undefined); assert.equal(stored.DATA_DIR, undefined);
  assert.match(stored.TUBESTUDIO_INSTALL_SECRET ?? "", /^[0-9a-f]{64}$/);
  await fs.writeFile(legacyEnv, "YOUTUBE_API_KEY=changed-later\n");
  assert.deepEqual((await startup.initPortableSecrets()).imported, [], "imported only once");
  assert.equal(startup.parseEnvText("A_B='x y'\nC=1 # c\n#D=2\n").A_B, "x y");
});

test("login: the launch key works once; sessions are signed and expire", async () => {
  const token = "ab".repeat(32);
  process.env.TUBESTUDIO_LAUNCH_TOKEN = token;
  try {
    assert.equal(session.authRequired(), true);
    assert.equal(session.legacyPasswordLogin(), false);
    assert.equal(session.consumeLaunchToken(token), true);
    assert.equal(session.consumeLaunchToken(token), false);
    const again = session.issueLaunchToken();
    assert.equal(session.consumeLaunchToken("cd".repeat(32)), false);
    assert.equal(session.consumeLaunchToken(again), true);
    assert.equal(session.consumeLaunchToken(again), false);
    const expired = session.issueLaunchToken(Date.now() - 16 * 60_000);
    assert.equal(session.consumeLaunchToken(expired), false);
    const value = session.newSessionValue();
    assert.equal(session.validSession(value), true);
    assert.equal(session.validSession(value.slice(0, -2) + (value.endsWith("A") ? "BB" : "AA")), false);
    assert.equal(session.validSession(value, Date.now() + 31 * 86_400_000), false);
    assert.equal(session.validSession(undefined), false);
  } finally { delete process.env.TUBESTUDIO_LAUNCH_TOKEN; }
});

test("paid requests: a broken connection is not re-sent (may be charged); a refused connection is retried", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = (async () => { calls++; throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }); }) as typeof fetch;
    await assert.rejects(fetchRetry("https://example.invalid/x", {}, { retries: 2, beforeAttempt: () => {} }), (e: any) => e.code === "UPSTREAM" && e.details?.uncertain === true);
    assert.equal(calls, 1);
    calls = 0;
    globalThis.fetch = (async () => { calls++; if (calls === 1) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); return new Response("ok"); }) as typeof fetch;
    const r = await fetchRetry("https://example.invalid/x", {}, { retries: 1, beforeAttempt: () => {} });
    assert.equal(await r.text(), "ok"); assert.equal(calls, 2);
    calls = 0;
    globalThis.fetch = (async () => { calls++; if (calls === 1) throw new TypeError("fetch failed"); return new Response("free"); }) as typeof fetch;
    assert.equal(await (await fetchRetry("https://example.invalid/free", {}, { retries: 1 })).text(), "free", "free metadata requests keep retrying");
  } finally { globalThis.fetch = original; }
});

test("control channel: PING reports the version, LINK gives a fresh login link, the record names the program folder", async () => {
  const control = await openSoftControl(1234, () => false, { version: "9.8.7", link: () => "http://127.0.0.1:1234/?launch=" + "ef".repeat(32) });
  try {
    const folder = process.env.TUBESTUDIO_CONTROL_DIR!;
    const [file] = (await fs.readdir(folder)).filter((n) => n.endsWith(".json"));
    const d = JSON.parse(await fs.readFile(path.join(folder, file), "utf8"));
    assert.equal(d.program, process.env.TUBESTUDIO_PROGRAM_DIR); assert.equal(d.version, "9.8.7"); assert.equal(d.appPort, 1234);
    const ask = (cmd: string) => new Promise<string>((resolve, reject) => {
      const s = net.connect({ host: "127.0.0.1", port: d.controlPort }); let text = "";
      s.on("data", (c) => { text += c; }); s.on("end", () => resolve(text.trim())); s.on("error", reject);
      s.on("connect", () => s.write(`${cmd} ${d.token}\n`));
    });
    assert.equal(await ask("PING"), `PONG 9.8.7 ${process.pid}`);
    assert.match(await ask("LINK"), /^LINK http:\/\/127\.0\.0\.1:1234\/\?launch=[0-9a-f]{64}$/);
    assert.equal(await ask("STOP"), "BUSY");
  } finally { await control.close(); }
});
