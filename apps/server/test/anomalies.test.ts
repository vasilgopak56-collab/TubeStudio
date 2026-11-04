import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ts-anomalies-"));
process.env.YOUTUBE_API_KEY = "unit-test-not-a-real-key";
const { ANOMALY_FILTERS, ResearchInput, buildRow, passCheap, runResearch, listResearch } = await import("../src/services/explore.js");
const { updateSettings } = await import("../src/services/settings.js");
const { exploreRoute } = await import("../src/routes/explore.js");
import type { Channel, Video } from "../src/services/youtube.js";
const DAY = 86400000;
const video: Video = { id: "hit", title: "Истории жизни", description: "", publishedAt: new Date(Date.now() - 7 * DAY).toISOString(), durationSec: 600, isShort: false, views: 100000, likes: 1000, comments: 100, tags: [], channelId: "UCsmall", channelTitle: "Маленький канал" };
const channel: Channel = { id: "UCsmall", title: "Маленький канал", description: "", publishedAt: "2020-01-01T00:00:00Z", subscribers: 2000, hiddenSubscribers: false, totalViews: 100000, videoCount: 1, uploadsPlaylistId: "UUsmall" };

test("Аномалии: стартовые пороги и независимость от Outlier", () => {
  const row = buildRow(video, channel);
  assert.equal(row.outlier, null);
  assert.equal(passCheap(row, ANOMALY_FILTERS), true);
  assert.equal(passCheap({ ...row, subs: 20000 }, ANOMALY_FILTERS), false);
  assert.equal(passCheap({ ...row, views: 49000 }, ANOMALY_FILTERS), false);
  assert.equal(passCheap({ ...row, views: 90000, subs: 10000, ratio: 9 }, ANOMALY_FILTERS), false);
  assert.equal(passCheap({ ...row, views: 99996, subs: 10000, ratio: 10 }, ANOMALY_FILTERS), false); // rounded display must not create a false match
  assert.equal(passCheap({ ...row, ageDays: 31 }, ANOMALY_FILTERS), false);
  assert.equal(passCheap({ ...row, views: 100000, subs: 10000, ratio: 10, ageDays: 30 }, ANOMALY_FILTERS), true);
});
test("Аномалии: скрытые и отсутствующие подписчики — неизвестны, не нули", () => {
  for (const ch of [undefined, { ...channel, hiddenSubscribers: true }]) {
    const row = buildRow(video, ch);
    assert.equal(row.hiddenSubs, true);
    assert.equal(row.ratio, null);
    assert.equal(passCheap(row, ANOMALY_FILTERS), false);
  }
  assert.equal(buildRow(video, { ...channel, subscribers: 0 }).ratio, null);
});
test("Аномалии: API не принимает поиск без обязательных порогов; старый Research совместим", () => {
  const valid = ResearchInput.parse({ mode: "anomalies", q: "истории", filters: ANOMALY_FILTERS });
  assert.equal(valid.mode, "anomalies");
  for (const key of ["subsMax", "viewsMin", "ageDays", "ratioMin"] as const) {
    assert.equal(ResearchInput.safeParse({ mode: "anomalies", q: "истории", filters: { ...ANOMALY_FILTERS, [key]: undefined } }).success, false);
  }
  assert.equal(ResearchInput.parse({ q: "истории" }).mode, "outliers");
});
test("Аномалии: полный поиск через mock YouTube, сохранение и разделение истории", async () => {
  await updateSettings({ research: { outlierBase: "average" } });
  const requests: URL[] = [];
  const original = globalThis.fetch;
  const makeV = (id: string, ch: string, days: number, views: number) => ({ id, snippet: { title: id, description: "", channelId: ch, channelTitle: ch, publishedAt: new Date(Date.now() - days * DAY).toISOString(), tags: [] }, statistics: { viewCount: String(views), likeCount: "1", commentCount: "1" }, contentDetails: { duration: "PT10M" } });
  const makeCh = (id: string, subs: number, hidden = false) => ({ id, snippet: { title: id, publishedAt: "2020-01-01T00:00:00Z" }, statistics: { subscriberCount: String(subs), hiddenSubscriberCount: hidden, videoCount: "1", viewCount: "100000" }, contentDetails: { relatedPlaylists: { uploads: "UU" + id.slice(2) } } });
  const vids = [makeV("good", "UCsmall", 7, 100000), makeV("big", "UCbig", 7, 100000), makeV("hidden", "UChidden", 7, 100000), makeV("old", "UCsmall", 45, 100000), makeV("weak", "UCsmall", 7, 2000), makeV("zero", "UCzero", 7, 100000), makeV("missing", "UCmissing", 7, 100000)];
  globalThis.fetch = (async (input: any) => {
    const u = new URL(String(input)); requests.push(u);
    let body: unknown;
    if (u.pathname.endsWith("/search")) body = { items: vids.map((v) => ({ id: { videoId: v.id } })) };
    else if (u.pathname.endsWith("/videos")) body = { items: vids };
    else if (u.pathname.endsWith("/channels")) body = { items: [makeCh("UCsmall", 2000), makeCh("UCbig", 20000), makeCh("UChidden", 0, true), makeCh("UCzero", 0)] };
    else throw new Error("Unexpected request: " + u.pathname);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const run = await runResearch(ResearchInput.parse({ mode: "anomalies", q: "истории", filters: ANOMALY_FILTERS, sort: "ratio", order: "viewCount", pages: 2 }), { progress() {}, partial() {}, signal: new AbortController().signal });
    assert.deepEqual(run.rows.map((v) => v.id), ["good"]);
    assert.equal(run.rows[0].outlier, 1); // young channel must qualify without an outlier >=20
    assert.equal(run.input.mode, "anomalies");
    const search = requests.find((u) => u.pathname.endsWith("/search"))!;
    assert.equal(search.searchParams.get("order"), "viewCount");
    assert.ok(search.searchParams.get("publishedAfter"));
    assert.equal((await listResearch())[0].mode, "anomalies");
    const response = await exploreRoute.request("http://localhost/research/runs?mode=anomalies");
    assert.equal((await response.json() as any).data.length, 1);
    const old = await exploreRoute.request("http://localhost/research/runs?mode=outliers");
    assert.equal((await old.json() as any).data.length, 0);
  } finally { globalThis.fetch = original; }
});
