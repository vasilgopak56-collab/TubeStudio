import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { system } from "../src/routes/system.js";
import { APP_VERSION } from "../src/lib/version.js";

test("app version matches the release package", async () => {
  const pkg = JSON.parse(await fs.readFile(new URL("../../../package.json", import.meta.url), "utf8"));
  assert.equal(APP_VERSION, pkg.version);
});

test("version route is local metadata only, no provider fetch, no cache", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("External requests forbidden"); };
  try {
    const response = await system.request("http://local/version");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { ok: true, data: { version: APP_VERSION } });
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});
