import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeedSnapshot, orderedFeed, MAX_FEED_JSON } from "../../web/src/components/thumbnail/feedSnapshot.js";
const entry = (id: string) => ({ id, title: "Рим <img src=x> עברית 日本語", channel: "Тест", picture: null });
const draft = () => ({ format: "tubestudio-feed", version: 1, createdAt: "2026-10-20T00:00:00.000Z", own: entry("own"), peers: [entry("2"), entry("5")], mobile: true, light: true, mark: false, position: 2 });
const parse = (o: unknown) => parseFeedSnapshot(JSON.stringify(o));
test("feed portable schema roundtrip preserves explicit settings and literal text", () => {
  const s = parse(draft()); assert.deepEqual(s, draft()); assert.equal(s.own.title, draft().own.title);
  assert.deepEqual(orderedFeed(s).map(e => e.id), ["2", "own", "5"]); assert.deepEqual(s.peers.map(e => e.id), ["2", "5"]);
});
for (const [name, patch] of Object.entries({ version: 2, format: "other", createdAt: "2026-02-30T00:00:00.000Z", position: 0, mobile: "true", light: null, mark: 1, peers: Array.from({length:6},(_,i)=>entry(String(i+1))), own: entry("1"), extra: true })) {
  test(`feed schema rejects invalid ${name}`, () => assert.throws(() => parse({ ...draft(), [name]: patch })));
}
test("feed schema rejects duplicates, prototype keys, unknown entry fields and nonobjects", () => {
  for (const bad of [null, [], 5, { ...draft(), peers: [entry("2"), entry("2")] }, { ...draft(), peers: [entry("own")] }, { ...draft(), own: {...entry("own"), url:"https://evil.test"} }, { ...draft(), peers:[entry("0")] }]) assert.throws(() => parse(bad));
  assert.throws(() => parseFeedSnapshot(JSON.stringify(draft()).replace('"version":1', '"version":1,"__proto__":{}')));
});
test("feed schema bounds texts and total bytes, including multibyte payloads", () => {
  assert.throws(() => parse({...draft(), own:{...entry("own"),title:"a".repeat(201)}}));
  assert.throws(() => parse({...draft(), own:{...entry("own"),channel:"a".repeat(101)}}));
  assert.throws(() => parseFeedSnapshot(" ".repeat(MAX_FEED_JSON+1)));
  assert.throws(() => parseFeedSnapshot("日".repeat(Math.ceil(MAX_FEED_JSON/3))));
});
test("feed schema rejects remote, SVG, noncanonical base64 shape and oversized raster declarations", () => {
  for (const src of ["https://evil.test/x.png", "/files/x.png", "data:image/svg+xml;base64,AAAA", "data:image/png;base64,AA=A", "data:image/png;base64,A==", "data:image/png;base64,AAAA\n"]) assert.throws(() => parse({...draft(),own:{...entry("own"),picture:{src,width:10,height:10}}}));
  for (const width of [0, -1, 1281, 1.5, "10"]) assert.throws(() => parse({...draft(),own:{...entry("own"),picture:{src:"data:image/png;base64,AAAA",width,height:10}}}));
});
