import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ts-niches-"));
process.env.DATA_DIR = dir; process.env.YOUTUBE_API_KEY = "fake-unit-key";
const { NicheInput, buildNicheRow, textMatch, summarizeNiche, runNicheSearch, listNicheRuns, loadNicheRun, nicheQuotaEstimate } = await import("../src/services/niches.js");
const { nichesRoute } = await import("../src/routes/niches.js");
import type { Channel, Video } from "../src/services/youtube.js";
import type { JobCtx } from "../src/lib/jobs.js";
const DAY = 86400000, NOW = Date.parse("2026-01-15T12:00:00Z");
const cid = (n: number) => "UC" + String(n).padStart(22, "0");
const ch: Channel = { id: cid(1), title: "История жизни", description: "Археология", publishedAt: "2020-01-01T00:00:00Z", subscribers: 1000, subscriberCountKnown: true, hiddenSubscribers: false, totalViews: 30000, videoCount: 4, uploadsPlaylistId: "UU1" };
const v = (id: string, days: number, views: number, shorts = false): Video => ({ id, title: "История быта", description: "", publishedAt: new Date(NOW - days * DAY).toISOString(), durationSec: shorts ? 60 : 600, isShort: shorts, views, viewsKnown: true, likes: 0, comments: 0, tags: [], channelId: ch.id, channelTitle: ch.title });
const input = NicheInput.parse({ q: "история быта" });
const rpm = { long: { niche: "Test", min: 4, max: 8 }, shorts: { niche: "Shorts", min: .05, max: .1 } };
const ctx = (): JobCtx => ({ signal: new AbortController().signal, progress() {}, partial() {} });
after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

test("niches: validates modes, bounds, languages and defaults", () => {
  assert.equal(input.limit, 10); assert.equal(input.sample, 20);
  for (const bad of [{ q: " " }, { q: "ok", limit: 21 }, { q: "ok", sample: 100 }, { q: "ok", language: "xx" }, { mode: "channel", channel: "" }]) assert.equal(NicheInput.safeParse(bad).success, false);
  assert.equal(NicheInput.safeParse({ mode: "channel", channel: "@example", language: "he" }).success, true);
  assert.equal(nicheQuotaEstimate(10, false), 121); assert.equal(nicheQuotaEstimate(10, true), 225);
});
test("niches: mature views and mixed RPM scenario use identical known-view sample", () => {
  const row = buildNicheRow(ch, [v("a", 10, 10000), v("b", 3, 20000, true), v("fresh", 1, 999999)], input, input.q, rpm, NOW);
  assert.equal(row.sampled, 3); assert.equal(row.mature, 2);
  assert.equal(row.averageViews, 15000); assert.equal(row.medianViews, 15000);
  assert.deepEqual(row.revenuePerVideo, { min: 20.5, max: 41 });
  assert.equal(row.uploadsPerWeek, 1.56); assert.equal(row.lastUploadDays, 1);
  assert.equal(row.monetization, "unknown");
});
test("niches: unknowns are null, real zero remains zero; single upload has no rate", () => {
  const row = buildNicheRow({ ...ch, hiddenSubscribers: true, publishedAt: "invalid" }, [v("a", 1, 0)], input, input.q, rpm, NOW);
  assert.equal(row.subscribers, null); assert.equal(row.ageDays, null); assert.equal(row.averageViews, null); assert.equal(row.revenuePerVideo, null); assert.equal(row.uploadsPerWeek, null);
  const zero = buildNicheRow({ ...ch, subscribers: 0 }, [v("zero", 4, 0)], input, input.q, rpm, NOW);
  assert.equal(zero.averageViews, 0); assert.equal(zero.subscribers, 0); assert.deepEqual(zero.revenuePerVideo, { min: 0, max: 0 });
  assert.equal(buildNicheRow({ ...ch, subscriberCountKnown: false }, [], input, input.q, rpm, NOW).subscribers, null);
});
test("niches: type, future dates, missing views and unknown durations don't fabricate metrics", () => {
  const row = buildNicheRow(ch, [v("future", -1, 9999), { ...v("bad", 4, 500), viewsKnown: false }, v("short", 4, 100, true)], { ...input, type: "long" }, input.q, rpm, NOW);
  assert.equal(row.selected, 1); assert.equal(row.mature, 0); assert.equal(row.averageViews, null); assert.ok(row.warnings.length >= 2);
  assert.equal(buildNicheRow(ch, [{ ...v("bad-duration", 4, 500), durationSec: 0 }], input, input.q, rpm, NOW).revenuePerVideo, null);
});
test("niches: text token matching handles Unicode and is not semantic similarity", () => {
  assert.equal(textMatch("История БЫТА", "история жизни"), 50);
  assert.equal(textMatch("日本語", "日本語の歴史"), 100);
  assert.equal(textMatch("", "text"), 0);
});
test("niches: saturation proxy excludes seed and requires sample coverage", () => {
  const base = buildNicheRow(ch, [], input, input.q, rpm, NOW);
  assert.equal(summarizeNiche([base]).establishedPct, null);
  const rows = Array.from({ length: 5 }, (_, i) => ({ ...base, id: cid(i), subscribers: i < 2 ? 100000 : 1000 }));
  assert.equal(summarizeNiche([...rows, { ...base, seed: true, subscribers: 900000 }]).establishedPct, 40);
  assert.equal(summarizeNiche([...rows, ...Array.from({ length: 3 }, () => ({ ...base, subscribers: null }))]).establishedPct, null);
});

const rawCh = (id: string, hidden = false) => ({ id, snippet: { title: "История " + id, description: "История быта", publishedAt: ch.publishedAt }, statistics: { subscriberCount: "1000", hiddenSubscriberCount: hidden, viewCount: "30000", videoCount: "2" }, contentDetails: { relatedPlaylists: { uploads: "UU" + id.slice(2) } }, brandingSettings: { channel: { keywords: '"история быта" археология новости' } } });
const rawV = (id: string, channelId: string) => ({ id, snippet: { title: "История быта", description: "", publishedAt: new Date(Date.now() - 7 * DAY).toISOString(), channelId, channelTitle: "История" }, contentDetails: { duration: "PT10M" }, statistics: { viewCount: "10000" } });
async function mocked(fn: (requests: URL[]) => Promise<void>, hook?: (u: URL) => Response | undefined) {
  const orig = globalThis.fetch; const requests: URL[] = [];
  globalThis.fetch = (async (url: any) => {
    const u = new URL(String(url)); requests.push(u);
    assert.equal(u.hostname, "www.googleapis.com");
    const intercepted = hook?.(u); if (intercepted) return intercepted;
    let body: unknown;
    if (u.pathname.endsWith("/search")) { assert.equal(u.searchParams.get("type"), "channel"); body = { items: [cid(1), cid(2), cid(2), cid(3)].map(id => ({ id: { channelId: id } })) }; }
    else if (u.pathname.endsWith("/channels")) { const ids = u.searchParams.get("id")?.split(",") ?? [cid(9)]; body = { items: ids.map(id => rawCh(id, id === cid(2))) }; }
    else if (u.pathname.endsWith("/playlistItems")) body = { items: [1, 2].map(n => ({ contentDetails: { videoId: u.searchParams.get("playlistId") + "_" + n } })) };
    else if (u.pathname.endsWith("/videos")) body = { items: u.searchParams.get("id")!.split(",").map(id => rawV(id, cid(1))) };
    else throw new Error("Unexpected path " + u.pathname);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  try { await fn(requests); } finally { globalThis.fetch = orig; }
}
test("niches: fake YouTube end-to-end, dedup, save/reopen, cache and force refresh", async () => mocked(async requests => {
  const q = NicheInput.parse({ q: "История тест", limit: 5, force: true });
  const r = await runNicheSearch(q, ctx());
  assert.equal(r.rows.length, 3); assert.equal(r.rows[1].subscribers, null); assert.equal(r.rows[0].averageViews, 10000);
  assert.equal(requests.filter(u => u.pathname.endsWith("/search")).length, 1);
  assert.equal(requests.length, 8); assert.equal(requests[0].searchParams.get("maxResults"), "5");
  assert.deepEqual(await loadNicheRun(r.id), r);
  assert.equal((await listNicheRuns())[0].id, r.id);
  const count = requests.length;
  await runNicheSearch({ ...q, force: false }, ctx()); assert.equal(requests.length, count);
  await runNicheSearch(q, ctx()); assert.equal(requests.length, count * 2);
  assert.equal(await loadNicheRun("../../settings"), null);
}));
test("niches: seed uses explicit topic or branding keywords, is marked and not tracked", async () => mocked(async requests => {
  const r = await runNicheSearch(NicheInput.parse({ mode: "channel", channel: "@seed", force: true }), ctx());
  assert.equal(r.query, "история быта археология новости"); assert.equal(r.rows[0].seed, true); assert.equal(r.summary.candidates, 3);
  const r2 = await runNicheSearch(NicheInput.parse({ mode: "channel", channel: "@seed", q: "моя тема", force: true }), ctx());
  assert.equal(r2.query, "моя тема"); assert.equal(requests.filter(u => u.pathname.endsWith("/search")).length, 2);
  assert.equal(await fs.stat(path.join(dir, "competitors.json")).then(() => true, () => false), false);
}));
test("niches: per-channel upstream failure is marked, never turns into zero views", async () => mocked(async () => {
  const r = await runNicheSearch(NicheInput.parse({ q: "failure", force: true }), ctx());
  assert.equal(r.rows[0].averageViews, null); assert.equal(r.rows[0].revenuePerVideo, null);
  assert.ok(r.warnings.length); assert.match(r.rows[0].warnings.join(" "), /Не удалось/);
}, u => u.pathname.endsWith("/playlistItems") && u.searchParams.get("playlistId") === "UU" + cid(1).slice(2) ? new Response(JSON.stringify({ error: { message: "sample unavailable" } }), { status: 400 }) : undefined));
test("niches: missing public subscriber count stays unknown from raw API", async () => mocked(async () => {
  const r = await runNicheSearch(NicheInput.parse({ q: "missing-statistics", force: true }), ctx());
  assert.equal(r.rows[0].subscribers, null);
}, u => u.pathname.endsWith("/channels") ? new Response(JSON.stringify({ items: [{ ...rawCh(cid(1)), statistics: { viewCount: "10" } }] })) : undefined));
test("niches: abort before start and between awaits leaves no completed history", async () => {
  const before = (await listNicheRuns()).length; const ac = new AbortController(); ac.abort();
  await assert.rejects(runNicheSearch(input, { ...ctx(), signal: ac.signal }), (e: any) => e.code === "CANCELLED");
  const bc = new AbortController();
  await mocked(async () => {
    await assert.rejects(runNicheSearch(NicheInput.parse({ q: "abort-between", force: true }), { ...ctx(), signal: bc.signal }), (e: any) => e.code === "CANCELLED");
  }, u => { if (u.pathname.endsWith("/search")) bc.abort(); return undefined; });
  assert.equal((await listNicheRuns()).length, before);
});
test("niches: cancellation during disk commit removes only its new history file", async () => mocked(async () => {
  const previous = (await listNicheRuns()).map(r => r.id); const ac = new AbortController(); const rename = fs.rename;
  fs.rename = (async (from: any, to: any) => {
    await rename(from, to);
    if (String(to).includes(path.sep + "niche-runs" + path.sep)) ac.abort();
  }) as typeof fs.rename;
  try {
    await assert.rejects(runNicheSearch(NicheInput.parse({ q: "cancel-on-commit", force: true }), { ...ctx(), signal: ac.signal }), (e: any) => e.code === "CANCELLED");
  } finally { fs.rename = rename; }
  assert.deepEqual((await listNicheRuns()).map(r => r.id), previous);
}));
test("niches: an explicit missing RPM selection is rejected instead of silently replaced", async () => {
  await assert.rejects(runNicheSearch(NicheInput.parse({ q: "rpm", rpmNiche: "not-configured" }), ctx()), (e: any) => e.code === "VALIDATION");
  await assert.rejects(runNicheSearch(NicheInput.parse({ q: "rpm", rpmNiche: "Shorts" }), ctx()), (e: any) => e.code === "VALIDATION");
});
test("niches: quota/key errors are not swallowed as per-channel warnings", async () => {
  // Inject at ALS-independent service leaf via real mock response; invalid key invalidates this isolated pool only.
  const before = (await listNicheRuns()).length;
  await mocked(async () => {
    await assert.rejects(runNicheSearch(NicheInput.parse({ q: "bad-key-last", force: true }), ctx()), (e: any) => e.code === "KEY_MISSING");
  }, u => u.pathname.endsWith("/playlistItems") ? new Response(JSON.stringify({ error: { errors: [{ reason: "keyInvalid" }], message: "invalid test key" } }), { status: 400 }) : undefined);
  assert.equal((await listNicheRuns()).length, before);
});
test("niches: API validates before enqueue; safe missing ID and history", async () => {
  const r = await nichesRoute.request("/niches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: "" }) });
  assert.equal(r.status, 400); assert.equal((await r.json() as any).ok, false);
  assert.equal((await nichesRoute.request("/niche-runs/not-an-id")).status, 404);
  assert.equal((await nichesRoute.request("/niche-runs")).status, 200);
});
test("niches: reads latest 50 by stored date, skips corrupt/unrelated files", async () => {
  const base = (await loadNicheRun((await listNicheRuns())[0].id))!;
  await fs.writeFile(path.join(dir, "niche-runs", "index.json"), "{}");
  await fs.writeFile(path.join(dir, "niche-runs", "ffffffff-ffff-4fff-8fff-ffffffffffff.json"), "broken");
  for (let i = 0; i < 53; i++) { const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`; await fs.writeFile(path.join(dir, "niche-runs", id + ".json"), JSON.stringify({ ...base, id, createdAt: new Date(NOW + (i + 1000) * DAY).toISOString() })); }
  const list = await listNicheRuns(); assert.equal(list.length, 50); assert.ok(list[0].createdAt > list[49].createdAt); assert.equal(list[0].id, "aaaaaaaa-aaaa-4aaa-8aaa-000000000052");
});
