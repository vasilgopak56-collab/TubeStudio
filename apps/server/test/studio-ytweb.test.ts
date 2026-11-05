// Выпуск 1: бесплатный разбор публичных страниц YouTube (без ключа и квоты).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  parseCount, parseAgeDays, parseLength, extractInitialData, collectVideos, parseChannelPage, findContinuation,
  setYtFetcher, webSearch, webChannel, webRelated, ytSuggest, channelRss, ytThumb, clientVersion,
} from "../src/services/studio/ytweb.js";
import { fakeFetcher, uc, vid, videoRenderer, lockup, channelJson, searchHtml, type World, type FV } from "./helpers/fakeYoutube.js";

after(() => setYtFetcher(null));

test("числа, возраст и длительность из текстов YouTube", () => {
  assert.equal(parseCount("1,234,567 views"), 1234567);
  assert.equal(parseCount("1.2K views"), 1200);
  assert.equal(parseCount("3.4M subscribers"), 3400000);
  assert.equal(parseCount("1B views"), 1e9);
  assert.equal(parseCount("No views"), 0);
  assert.equal(parseCount("12 тыс. просмотров"), 12000);
  assert.equal(parseCount("1,5 млн"), 1500000);
  assert.equal(parseCount(""), undefined);
  assert.equal(parseAgeDays("3 weeks ago"), 21);
  assert.equal(parseAgeDays("Streamed 2 days ago"), 2);
  assert.equal(parseAgeDays("1 year ago"), 365.25);
  assert.equal(parseAgeDays("9h ago"), 9 / 24);
  assert.equal(parseAgeDays("Premiered Oct 3, 2026"), undefined);
  assert.equal(parseLength("1:02:03"), 3723);
  assert.equal(parseLength("12:34"), 754);
  assert.equal(parseLength("LIVE"), undefined);
});

test("ytInitialData извлекается, даже если в строках есть скобки", () => {
  const html = `<script>var ytInitialData = {"a":"}{ \\" }","b":{"c":[1,2,{"d":"x"}]}};</script>`;
  assert.deepEqual(extractInitialData(html), { a: '}{ " }', b: { c: [1, 2, { d: "x" }] } });
  assert.equal(extractInitialData("<html>nothing</html>"), null);
  assert.equal(clientVersion(searchHtml([])), "2.20261101.01.00");
});

const v = (tag: string, extra: Partial<FV> = {}): FV => ({ id: vid(tag), title: `Video ${tag}`, ch: uc(tag), chName: `Channel ${tag}`, views: 12345, len: "12:00", age: "2 weeks ago", ...extra });

test("карточки видео: старые (videoRenderer) и новые (lockupViewModel), Shorts пропускаются", () => {
  const tree = { a: [videoRenderer(v("a", { verified: true })), { reelItemRenderer: { videoId: vid("short") } }], b: { deep: [lockup(v("b", { views: 80000, len: "1:05:00", age: "1 month ago" }))] }, c: [videoRenderer(v("a"))] };
  const out = collectVideos(tree);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { id: vid("a"), title: "Video a", channelId: uc("a"), channelName: "Channel a", views: 12345, durationSec: 720, ageDays: 14, publishedText: "2 weeks ago", live: false, short: false, verified: true });
  assert.equal(out[1].id, vid("b"));
  assert.equal(out[1].channelId, uc("b"));
  assert.equal(out[1].channelName, "Channel b");
  assert.equal(out[1].views, 80000);
  assert.equal(out[1].durationSec, 3900);
  assert.equal(out[1].ageDays, 30.44);
});

test("страница канала: подписчики, число видео, длинные ролики и признак «есть ещё»", () => {
  const c = { id: uc("chan"), name: "Quiet Mind", handle: "QuietMind", subs: 1500, videos: [v("x1", { ch: uc("chan") }), v("x2", { ch: uc("chan"), age: "3 weeks ago" })], more: true };
  const p = parseChannelPage(channelJson(c))!;
  assert.equal(p.id, uc("chan"));
  assert.equal(p.name, "Quiet Mind");
  assert.equal(p.handle, "@QuietMind");
  assert.equal(p.subs, 1500);
  assert.equal(p.videoCount, 2);
  assert.equal(p.longVideos.length, 2);
  assert.equal(p.hasMoreLong, true);
  assert.equal(parseChannelPage(channelJson({ ...c, more: false }))!.hasMoreLong, false);
  assert.equal(parseChannelPage(channelJson({ ...c, subs: null }))!.subs, undefined);
  assert.equal(parseChannelPage({}), null);
  assert.equal(findContinuation({ x: { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: "T" } } } } }), "T");
});

test("сеть: поиск, канал по ID и по @handle, похожие, подсказки, превью", async () => {
  const chan = { id: uc("net"), name: "Net Channel", handle: "NetChannel", subs: 2300, videos: [v("n1", { ch: uc("net") })] };
  const w: World = {
    search: { "dark psychology": [v("s1"), v("s2", { len: "0:45" })] }, channels: [chan],
    related: { [vid("s1")]: [v("r1"), v("s1")] }, suggest: { "dark psychology": ["dark psychology tricks", "dark psychology book"] }, log: [],
  };
  setYtFetcher(fakeFetcher(w));
  const found = await webSearch("dark psychology", { period: "month" });
  assert.deepEqual(found.map((x) => x.id), [vid("s1"), vid("s2")]);
  assert.match(w.log[0], /search_query=dark%20psychology&sp=CAMSBAgEEAE%3D/);
  const byId = await webChannel(uc("net"));
  assert.equal(byId.subs, 2300);
  assert.ok(w.log.some((u) => u.includes("/youtubei/v1/browse")));
  assert.equal((await webChannel("@NetChannel")).id, uc("net"));
  assert.deepEqual((await webRelated(vid("s1"))).map((x) => x.id), [vid("r1")]);
  assert.deepEqual(await ytSuggest("dark psychology"), ["dark psychology tricks", "dark psychology book"]);
  assert.equal((await ytThumb(vid("s1")))?.mime, "image/jpeg");
  assert.equal(await ytThumb("bad id"), undefined);
  await assert.rejects(channelRss(uc("net")), { code: "NOT_FOUND" });
});

test("сеть: ограничение YouTube (429) — понятная ошибка с признаком ytLimited, без повторов", async () => {
  const w: World = { search: {}, channels: [], related: {}, suggest: {}, limited: () => true, log: [] };
  setYtFetcher(fakeFetcher(w));
  await assert.rejects(webSearch("anything"), (e: any) => e.status === 429 && e.details?.ytLimited === true && /15–30 минут/.test(e.message));
  assert.equal(w.log.length, 1);
  assert.deepEqual(await ytSuggest("anything"), []);
});
