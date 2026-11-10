// Выпуск 4, шаг 3: отдельное право загрузки. Сеть подменена, токены выдуманные, данные во временной папке.
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "yt-upload-scope-"));
process.env.DATA_DIR = tmp; process.env.ENV_FILE = path.join(tmp, "absent.env");
process.env.GOOGLE_CLIENT_ID = "dummy.apps.googleusercontent.com"; process.env.GOOGLE_CLIENT_SECRET = "DUMMY_CLIENT_SECRET";
const A = await import("../src/services/ytAnalytics.js");

const oauth = path.join(tmp, "oauth.json");
const read = "https://www.googleapis.com/auth/youtube.readonly", channel = { id: `UC${"a".repeat(22)}`, title: "The Channel" };
const other = `UC${"b".repeat(22)}`;
const save = (scope: string) => fs.writeFile(oauth, JSON.stringify({ access_token: "DUMMY_OLD", refresh_token: "DUMMY_OLD_R", expires_at: Date.now() + 3600000, scope, channel, connectedAt: "2026-01-01T00:00:00.000Z" }));
const scopes = (url: string) => new URL(url).searchParams.get("scope")!.split(" ");
const stateOf = (url: string) => new URL(url).searchParams.get("state")!;
const original = globalThis.fetch;
/** Что вернёт Google: какие права выдал и какой канал выбран. */
function google(grantedScope: string | undefined, channelId = channel.id) {
  globalThis.fetch = (async (u: unknown) => {
    const url = String(u);
    if (url.includes("oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "DUMMY_NEW", refresh_token: "DUMMY_NEW_R", expires_in: 3600, ...(grantedScope ? { scope: grantedScope } : {}) }));
    if (url.includes("/channels")) return new Response(JSON.stringify({ items: [{ id: channelId, snippet: { title: channelId === channel.id ? channel.title : "Other" }, contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] }));
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}
beforeEach(async () => { await save(`${read} ${A.SCOPES[1]}`); });
after(async () => { globalThis.fetch = original; await fs.rm(tmp, { recursive: true, force: true }); });

test("обычное подключение и финансовый доступ не просят загрузку", () => {
  assert.ok(!scopes(A.authUrl()).includes(A.UPLOAD_SCOPE));
  assert.ok(!scopes(A.authUrl({ monetary: true })).includes(A.UPLOAD_SCOPE));
});

test("без подключённого канала ссылка не выдаётся", async () => {
  await fs.rm(oauth, { force: true });
  await assert.rejects(A.uploadAuthUrl(), /Сначала подключите канал/);
});

test("ссылка просит загрузку, сохраняет чтение и даёт выбрать канал", async () => {
  const url = await A.uploadAuthUrl();
  for (const s of [...A.SCOPES, A.UPLOAD_SCOPE]) assert.ok(scopes(url).includes(s), s);
  assert.ok(!scopes(url).includes(A.MONETARY_SCOPE), "финансовый доступ не добавляется сам");
  assert.equal(new URL(url).searchParams.get("include_granted_scopes"), "true");
  assert.match(new URL(url).searchParams.get("prompt")!, /select_account/);
});

test("выданный раньше финансовый доступ не теряется", async () => {
  await save(`${read} ${A.MONETARY_SCOPE}`);
  assert.ok(scopes(await A.uploadAuthUrl()).includes(A.MONETARY_SCOPE));
});

test("после разрешения загрузка видна, канал прежний", async () => {
  assert.equal((await A.oauthStatus()).uploadGranted, false);
  const state = stateOf(await A.uploadAuthUrl());
  google(`${read} ${A.UPLOAD_SCOPE}`);
  const ch = await A.handleCallback({ code: "c", state });
  assert.equal(ch.id, channel.id);
  const st = await A.oauthStatus();
  assert.equal(st.uploadGranted, true);
  assert.equal(st.channel?.id, channel.id);
});

test("выбран другой канал: подключение не меняется", async () => {
  const before = await fs.readFile(oauth, "utf8"), state = stateOf(await A.uploadAuthUrl());
  google(`${read} ${A.UPLOAD_SCOPE}`, other);
  await assert.rejects(A.handleCallback({ code: "c", state }), /другой канал/);
  assert.equal(await fs.readFile(oauth, "utf8"), before);
});

test("право не выдано или неизвестно: подключение не меняется", async () => {
  const before = await fs.readFile(oauth, "utf8");
  for (const granted of [read, undefined, `${A.UPLOAD_SCOPE}-fake`]) {
    const state = stateOf(await A.uploadAuthUrl());
    google(granted);
    await assert.rejects(A.handleCallback({ code: "c", state }), /не выдал право загрузки/);
    assert.equal(await fs.readFile(oauth, "utf8"), before);
  }
});

test("отмена в окне Google ничего не меняет, ссылка одноразовая", async () => {
  const before = await fs.readFile(oauth, "utf8"), state = stateOf(await A.uploadAuthUrl("11111111-2222-4333-8444-555555555555"));
  assert.equal(A.uploadReturn(state), "11111111-2222-4333-8444-555555555555");
  await assert.rejects(A.handleCallback({ state, error: "access_denied" }), /отменили/);
  assert.equal(A.uploadReturn(state), null);
  await assert.rejects(A.handleCallback({ state, code: "c" }), /устарела/);
  assert.equal(await fs.readFile(oauth, "utf8"), before);
});

test("обычное переподключение по-прежнему может выбрать другой канал", async () => {
  const state = stateOf(A.authUrl({ selectAccount: true }));
  google(read, other);
  assert.equal((await A.handleCallback({ code: "c", state })).id, other);
  assert.equal((await A.oauthStatus()).uploadGranted, false);
});
