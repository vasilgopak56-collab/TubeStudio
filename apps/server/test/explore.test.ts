// vidIQ-функции: вирусный потенциал, фильтры, оценка ключей, автовыбор, тренд-алерты
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ts-ex-"));
const { viralCheck, passCheap, baselineFrom } = await import("../src/services/explore.js");
const { scoreKeyword, autoPick } = await import("../src/services/keywords.js");
const { videoStats } = await import("../src/services/competitors.js");
const { ResearchSettings } = await import("../src/services/settings.js");

const R = ResearchSettings.parse({});

test("вирусный потенциал по правилам из видео: <3 мес VPH≥100, ≥3 мес ≥50, ≥1 года ≥20, outlier ≥20", () => {
  assert.equal(viralCheck(30, 100, 100, R.viral).ok, true);
  assert.equal(viralCheck(30, 100, 60, R.viral).ok, false);
  assert.equal(viralCheck(150, 25, 60, R.viral).ok, true);
  assert.equal(viralCheck(500, 25, 21, R.viral).ok, true);
  assert.equal(viralCheck(500, 10, 500, R.viral).ok, false);
  assert.match(viralCheck(30, 100, 60, R.viral).why, /VPH ≥ 100.*✗/);
});

test("фильтры: подписчики 0–5000, просмотры ≥50K, VPH ≥20, тип", () => {
  const r = { views: 80000, subs: 1800, vph: 110, ratio: 44, engagement: 3, ageDays: 30, durationSec: 600, isShort: false };
  const f = { subsMax: 5000, viewsMin: 50000, vphMin: 20, type: "all" as const, viralOnly: false };
  assert.equal(passCheap(r, f), true);
  assert.equal(passCheap({ ...r, subs: 9000 }, f), false);
  assert.equal(passCheap(r, { ...f, type: "shorts" }), false);
  assert.equal(passCheap(r, { ...f, ageDays: 7 }), false);
});

test("база канала — медиана без видео моложе 2 дней", () => {
  const now = Date.now(), d = (n: number) => new Date(now - n * 86400_000).toISOString();
  const vids = [{ publishedAt: d(1), views: 1e6 }, { publishedAt: d(5), views: 1000 }, { publishedAt: d(9), views: 2000 }, { publishedAt: d(12), views: 3000 }] as never;
  assert.equal(baselineFrom(vids, now), 2000);
});

test("оценка ключа: крупные каналы и точное совпадение → высокая конкуренция; маленькие → низкая", () => {
  const big = Array.from({ length: 10 }, (_, i) => ({ title: `Psychology facts ${i}`, views: 3e6, ageDays: 400, subs: 4e6 }));
  const small = Array.from({ length: 10 }, (_, i) => ({ title: `Video ${i}`, views: 20000, ageDays: 60, subs: 3000 }));
  const a = scoreKeyword("psychology facts", big), b = scoreKeyword("psychology facts", small);
  assert.equal(a.level, "high"); assert.equal(b.level, "low");
  assert.ok(a.volume > b.volume);
  const picked = autoPick([{ keyword: "a", auto: 1, sources: 1, metrics: { ...a, top: [], tags: [] } }, { keyword: "b", auto: 1, sources: 1, metrics: { ...b, top: [], tags: [] } }], { minVolume: 1000, maxCompetition: "medium", highCompVolume: 1e9, maxPick: 5 });
  assert.deepEqual(picked, ["b"]);
});

test("трекер: текущий VPH по разнице снимков и outlier к медиане", () => {
  const now = Date.now();
  const v = { id: "x", title: "t", publishedAt: new Date(now - 10 * 86400_000).toISOString(), durationSec: 600, isShort: false, alerted: [], points: [{ t: now - 2 * 3600_000, v: 10000, l: 0, c: 0 }, { t: now, v: 12000, l: 0, c: 0 }] };
  const s = videoStats(v, 2000, now);
  assert.equal(s.vphRecent, 1000);
  assert.equal(s.outlier, 6);
});
