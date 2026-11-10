// Выпуск 4: замеры через 48 часов и 7 дней. Сеть подменена: настоящих запросов нет, данные во временной папке.
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "publish-snapshots-"));
process.env.DATA_DIR = dir; process.env.ENV_FILE = `${dir}/missing`;
const { checkVideo, runDueChecks, snapshotsState } = await import("../src/services/studio/publishSnapshots.js");
const { linkVideo, videoMilestoneReport } = await import("../src/services/ytAnalytics.js");

const H = 3600_000, project = "11111111-2222-4333-8444-555555555555", video = "abcdefghijk", ch = `UC${"a".repeat(22)}`;
const published = Date.parse("2026-11-01T12:00:00.000Z"), publishedAt = new Date(published).toISOString();
const facts = (over = {}) => ({ channelId: ch, title: "Frost", publishedAt, durationSec: 600, privacy: "public", counters: { views: 10, likes: 1, comments: 0 }, ...over });
const report = { channel: { id: ch, title: "The Frost Ledger" }, title: "Frost", durationSec: 600, period: { startDate: "2026-11-01", endDate: "2026-11-02" }, counters: { views: 10, likes: 1, comments: 0 }, totals: { views: 9 }, traffic: [], retention: [], compare: null };
let calls: { facts: number; report: number };
const deps = (o: { connected?: boolean; facts?: unknown; report?: () => Promise<unknown> } = {}) => ({
  connection: async () => ({ connected: o.connected ?? true, channel: o.connected === false ? null : { id: ch, title: "The Frost Ledger" } }),
  facts: async () => { calls.facts++; return ("facts" in o ? o.facts : facts()); },
  report: async () => { calls.report++; return o.report ? o.report() : report; },
}) as never;
const stored = async () => JSON.parse(await fs.readFile(path.join(dir, "files", project, "publish", "snapshots.json"), "utf8"))[video];
const writeCard = async (id: string | null) => { const f = path.join(dir, "files", project, "publish", "card.json"); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, JSON.stringify({ video: id ? { id, linkedAt: publishedAt } : null })); };

beforeEach(async () => { calls = { facts: 0, report: 0 }; await fs.rm(path.join(dir, "files"), { recursive: true, force: true }); await fs.rm(path.join(dir, "yt-links.json"), { force: true }); await fs.rm(path.join(dir, "oauth.json"), { force: true }); });
after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

test("до срока замера нет, следующая проверка назначена на срок и не ходит в сеть раньше него", async () => {
  assert.equal(await checkVideo(project, video, published + H, deps()), null);
  assert.equal(calls.report, 0);
  assert.equal((await stored()).nextCheckAt, new Date(published + 48 * H).toISOString());
  await checkVideo(project, video, published + 2 * H, deps());
  assert.equal(calls.facts, 1, "до срока повторного запроса нет");
});

test("замер 48 часов снимается один раз, не меняется и считается от даты публикации", async () => {
  assert.equal(await checkVideo(project, video, published + 48 * H, deps()), "48h");
  const first = await stored();
  assert.equal(first.snapshots["48h"].ageHours, 48);
  assert.equal(first.snapshots["48h"].lateHours, 0);
  assert.equal(first.nextCheckAt, new Date(published + 168 * H).toISOString());
  assert.equal(await checkVideo(project, video, published + 49 * H, deps()), null);
  assert.equal(calls.report, 1);
  assert.deepEqual((await stored()).snapshots["48h"], first.snapshots["48h"]);
});

test("если программа не работала в срок, замер показывает настоящий возраст и опоздание", async () => {
  assert.equal(await checkVideo(project, video, published + 53.5 * H, deps()), "48h");
  const s = (await stored()).snapshots["48h"];
  assert.equal(s.ageHours, 53.5);
  assert.equal(s.lateHours, 5.5);
});

test("оба срока прошли: один замер за 7 дней, 48 часов помечены пропущенными, после него запросов нет", async () => {
  assert.equal(await checkVideo(project, video, published + 240 * H, deps()), "7d");
  const t = await stored();
  assert.equal(t.skipped48h, true);
  assert.equal(t.snapshots["48h"], undefined);
  assert.equal(t.snapshots["7d"].lateHours, 72);
  assert.equal(await checkVideo(project, video, published + 300 * H, deps()), null);
  assert.equal(calls.facts, 1);
});

test("после снятого замера 48 часов недельный снимается в свой срок и 48 часов не считаются пропущенными", async () => {
  await checkVideo(project, video, published + 48 * H, deps());
  assert.equal(await checkVideo(project, video, published + 168 * H, deps()), "7d");
  const t = await stored();
  assert.equal(t.skipped48h, false);
  assert.ok(t.snapshots["48h"] && t.snapshots["7d"]);
});

test("ролик другого канала не замеряется, отчёт не запрашивается", async () => {
  assert.equal(await checkVideo(project, video, published + 50 * H, deps({ facts: facts({ channelId: `UC${"b".repeat(22)}` }) })), null);
  assert.equal(calls.report, 0);
  const t = await stored();
  assert.match(t.problem, /не с подключённого канала/);
  assert.deepEqual(t.snapshots, {});
});

test("без подключения канала сети нет, замер ждёт и снимается после подключения", async () => {
  assert.equal(await checkVideo(project, video, published + 50 * H, deps({ connected: false })), null);
  assert.equal(calls.facts, 0);
  assert.match((await stored()).problem, /не подключён/);
  assert.equal(await checkVideo(project, video, published + 51 * H, deps()), "48h");
  assert.equal((await stored()).problem, null);
});

test("скрытый ролик ждёт публикации, срок не идёт", async () => {
  assert.equal(await checkVideo(project, video, published + 50 * H, deps({ facts: facts({ privacy: "private" }) })), null);
  const t = await stored();
  assert.equal(t.publishedAt, null);
  assert.match(t.waiting, /не открыт/);
  assert.equal(calls.report, 0);
});

test("ошибка Google показывается, ничего не сохраняет и повторяется через час", async () => {
  const failing = deps({ report: async () => { throw new Error("сеть"); } });
  assert.equal(await checkVideo(project, video, published + 50 * H, failing), null);
  const t = await stored();
  assert.match(t.problem, /повторит попытку/);
  assert.deepEqual(t.snapshots, {});
  assert.equal(t.nextCheckAt, new Date(published + 51 * H).toISOString());
  await checkVideo(project, video, published + 50.5 * H, failing);
  assert.equal(calls.report, 1);
  assert.equal(await checkVideo(project, video, published + 51 * H, deps()), "48h");
});

test("замеряются только ролики со ссылкой на странице «Публикация»", async () => {
  await linkVideo(video, project);
  await runDueChecks(published + 50 * H, deps());
  assert.equal(calls.facts, 0, "привязка из «Моей аналитики» без карточки замеров не включает");
  await writeCard("otherVideo1");
  await runDueChecks(published + 50 * H, deps());
  assert.equal(calls.facts, 0, "в карточке другой ролик");
  await writeCard(video);
  await runDueChecks(published + 50 * H, deps());
  assert.equal(calls.report, 1);
});

test("состояние для страницы: срок, пропуск, замеры нового ролика не смешиваются со старым", async () => {
  await writeCard(video);
  await checkVideo(project, video, published + 240 * H, deps());
  const s = await snapshotsState(project);
  assert.equal(s.videoId, video);
  assert.equal(s.rows[0].skipped, true);
  assert.equal(s.rows[1].dueAt, new Date(published + 168 * H).toISOString());
  assert.ok(s.rows[1].snapshot);
  await writeCard("otherVideo1");
  assert.ok((await snapshotsState(project)).rows.every((r) => r.snapshot === null && r.dueAt === null));
  await writeCard(null);
  assert.deepEqual((await snapshotsState(project)).rows, []);
});

// ───── запросы к Google, подменённые на уровне fetch ─────
const original = globalThis.fetch;
const report_ = (columns: string[], rows: unknown[][]) => Response.json({ columnHeaders: columns.map((name) => ({ name })), rows });
const video_ = (channelId = ch) => Response.json({ items: [{ snippet: { channelId, title: "Frost", publishedAt }, contentDetails: { duration: "PT10M" }, status: { privacyStatus: "public" }, statistics: { viewCount: "10", likeCount: "1", commentCount: "0" } }] });
async function connect() { await fs.writeFile(path.join(dir, "oauth.json"), JSON.stringify({ access_token: "fixture", refresh_token: "fixture-r", expires_at: Date.now() + 10 * H, channel: { id: ch, title: "The Frost Ledger" }, connectedAt: publishedAt })); }
function mock(fn: (url: string) => Response) { const seen: { url: string; method: string }[] = []; globalThis.fetch = (async (u: string | URL, init?: RequestInit) => { seen.push({ url: String(u), method: init?.method ?? "GET" }); return fn(String(u)); }) as typeof fetch; return seen; }

test("свежий ролик без данных аналитики: не ноль, а отсутствие данных; запросы только на чтение", async (t) => {
  t.after(() => { globalThis.fetch = original; });
  await connect();
  const seen = mock((u) => (u.includes("/youtube/v3/videos") ? video_() : Response.json({ columnHeaders: [{ name: "views" }], rows: [] })));
  const r = await videoMilestoneReport(video, project);
  assert.equal(r.totals, null);
  assert.deepEqual(r.retention, []);
  assert.equal(r.compare, null);
  assert.equal(r.counters.views, 10);
  assert.ok(seen.every((s) => s.method === "GET" && /googleapis\.com/.test(s.url)));
  assert.ok(seen.some((s) => s.url.includes("startDate=2026-11-01")), "период начинается с даты публикации");
});

test("данные аналитики разбираются, сбой удержания отличается от пустого удержания", async (t) => {
  t.after(() => { globalThis.fetch = original; });
  await connect();
  mock((u) => {
    if (u.includes("/youtube/v3/videos")) return video_();
    if (u.includes("elapsedVideoTimeRatio")) return Response.json({ error: { message: "нет" } }, { status: 400 });
    if (u.includes("insightTrafficSourceType")) return report_(["insightTrafficSourceType", "views", "estimatedMinutesWatched"], [["YT_SEARCH", 7, 20]]);
    return report_(["views", "averageViewPercentage"], [[9, 41.5]]);
  });
  const r = await videoMilestoneReport(video, project);
  assert.deepEqual(r.totals, { views: 9, averageViewPercentage: 41.5 });
  assert.equal(r.traffic[0].label, "Поиск YouTube");
  assert.equal(r.retention, null);
});

test("чужой ролик не доходит до отчётов аналитики", async (t) => {
  t.after(() => { globalThis.fetch = original; });
  await connect();
  const seen = mock(() => video_(`UC${"b".repeat(22)}`));
  await assert.rejects(videoMilestoneReport(video, project), /не с подключённого канала/);
  assert.equal(seen.filter((s) => s.url.includes("youtubeanalytics")).length, 0);
});
