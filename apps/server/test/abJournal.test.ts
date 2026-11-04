import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { AbDraft, AbInput, describeAb, saveAb, loadAb, listAb, type AbData } from "../src/services/abJournal.js";
import { backupTarget } from "../src/services/backup.js";
import { dataPath } from "../src/lib/storage.js";
const dir = dataPath("ab-test-runs");
const make = (): AbData => ({ title: "Проверка 😀 עברית 日本語", channelRef: "Мой канал", videoId: "abcdefghijk", kind: "title", mode: "unknown", status: "planned", hypothesis: "Короткий заголовок понятнее", sourceNote: "Ручная запись", variants: ["A", "B"].map((code, i) => ({ code: code as "A" | "B", title: `Заголовок ${code}`, thumbnail: "", startDate: null, endDate: null, impressions: null, ctrPct: null, notes: "" })), decision: "none", conclusion: "" });
const input = (data = make(), parentId: string | null = null) => ({ parentId, data });
const file = (id: string) => dataPath("ab-test-runs", id + ".json");
after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
test("A/B strict schema accepts a plan with unknown metrics; rejects credentials/derived or extra fields", () => {
 assert.ok(AbInput.safeParse(input()).success);
 for (const bad of [{ ...input(), token: "secret" }, { ...input(), data: { ...make(), winner: "B" } }, { ...input(), parentId: "../oauth" }, { ...input(), data: { ...make(), videoId: "https://youtu.be/abcdefghijk" } }]) assert.equal(AbInput.safeParse(bad).success, false);
 const d = make(); assert.equal(AbDraft.safeParse({ ...d, variants: [{ ...d.variants[0], access_token: "secret" }, d.variants[1]] }).success, false);
});
test("A/B requires named title/thumbnail variants and ordered unique codes A B optional C", () => {
 const d = make(); for (const variants of [[], [d.variants[0]], [d.variants[1], d.variants[0]], [d.variants[0], d.variants[0]], [...d.variants, ...d.variants]]) assert.equal(AbDraft.safeParse({ ...d, variants }).success, false);
 assert.equal(AbDraft.safeParse({ ...d, variants: [...d.variants, { ...d.variants[0], code: "C" }] }).success, true);
 assert.equal(AbDraft.safeParse({ ...d, variants: d.variants.map(v => ({ ...v, title: "  " })) }).success, false);
 for (const kind of ["thumbnail", "both"]) { assert.equal(AbDraft.safeParse({ ...d, kind }).success, false); assert.ok(AbDraft.safeParse({ ...d, kind, variants: d.variants.map(v => ({ ...v, thumbnail: "обложка.png" })) }).success); }
});
test("A/B dates must be actual calendar dates, complete pairs and ordered; empty planned periods allowed", () => {
 const d = make(); for (const patch of [{ startDate: "2026-02-30", endDate: "2026-03-01" }, { startDate: "2026-01-01", endDate: null }, { startDate: null, endDate: "2026-01-01" }, { startDate: "2026-03-01", endDate: "2026-02-01" }]) assert.equal(AbDraft.safeParse({ ...d, variants: [{ ...d.variants[0], ...patch }, d.variants[1]] }).success, false);
 assert.ok(AbDraft.safeParse({ ...d, variants: d.variants.map(v => ({ ...v, startDate: "2028-02-29", endDate: "2028-02-29" })) }).success);
});
test("A/B does not coerce strings, negative, fractional or unsafe impressions to numbers or zero", () => {
 const d = make(); for (const impressions of ["10", "", -1, 0.5, 1e12 + 1, NaN, Infinity]) assert.equal(AbDraft.safeParse({ ...d, variants: [{ ...d.variants[0], impressions }, d.variants[1]] }).success, false);
 for (const ctrPct of ["5", "", -1, 100.1, Infinity, NaN]) assert.equal(AbDraft.safeParse({ ...d, variants: [{ ...d.variants[0], ctrPct }, d.variants[1]] }).success, false);
});
test("A/B zero impressions have undefined CTR; zero CTR with positive or unknown denominator stays known", () => {
 const d = make(); assert.equal(AbDraft.safeParse({ ...d, variants: [{ ...d.variants[0], impressions: 0, ctrPct: 0 }, d.variants[1]] }).success, false);
 for (const impressions of [null, 1]) { const a = AbDraft.parse({ ...d, variants: d.variants.map(v => ({ ...v, impressions, ctrPct: 0 })) }); assert.equal(describeAb(a).comparisons[0].ctrDifferencePp, 0); }
 assert.ok(AbDraft.safeParse({ ...d, variants: d.variants.map(v => ({ ...v, impressions: 0 })) }).success);
});
test("A/B descriptive CTR differences use percentage points, correct sign and pair order, never infer clicks or winner", () => {
 const d = make(); d.variants = [...d.variants, { ...d.variants[0], code: "C" }].map((v, i) => ({ ...v, impressions: 10000, ctrPct: [4.2, 5.1, 0][i] }));
 assert.deepEqual(describeAb(d).comparisons, [{ left: "A", right: "B", ctrDifferencePp: 0.9 }, { left: "A", right: "C", ctrDifferencePp: -4.2 }, { left: "B", right: "C", ctrDifferencePp: -5.1 }]);
 assert.deepEqual(Object.keys(describeAb(d)).sort(), ["comparisons", "warnings"]);
});
test("A/B unknown CTR gives unknown difference; no zero fill, division or automatic winner", () => {
 const d = make(); d.variants[0].ctrPct = 0; assert.equal(describeAb(d).comparisons[0].ctrDifferencePp, null); assert.match(describeAb(d).warnings.join(" "), /неизвестность/);
});
test("A/B manual decisions need finished status, existing variant and explanatory conclusion", () => {
 const d = make(); for (const patch of [{ decision: "B" }, { status: "finished", decision: "C", conclusion: "потому" }, { status: "finished", decision: "B", conclusion: "  " }, { status: "running", decision: "inconclusive", conclusion: "нет данных" }]) assert.equal(AbDraft.safeParse({ ...d, ...patch }).success, false);
 const manual = AbDraft.parse({ ...d, status: "finished", decision: "B", conclusion: "Моё решение, не значимость" }); assert.match(describeAb(manual).warnings.join(" "), /ручное решение автора/);
});
test("A/B warns about sequential testing, differing periods, combined changes and unverified channel", () => {
 const d = make(); d.kind = "both"; d.mode = "sequential"; d.videoId = ""; d.variants = d.variants.map((v, i) => ({ ...v, thumbnail: "описание", startDate: `2026-01-0${i+1}`, endDate: `2026-01-0${i+1}`, impressions: 999999, ctrPct: 20 }));
 const w = describeAb(d).warnings.join(" "); for (const phrase of [/не является рандомизированным/, /Периоды вариантов различаются/, /выделить вклад/, /не подтверждённая связь/, /большой объём/]) assert.match(w, phrase);
});
test("A/B all local save/read/history actions make no network requests", async () => {
 const old = globalThis.fetch; let calls = 0; globalThis.fetch = (async () => { calls++; throw Error("External network prohibited"); }) as typeof fetch;
 try { const r = await saveAb(input()); await loadAb(r.id); await listAb(); assert.equal(calls, 0); assert.equal(r.source, "manual"); assert.equal(r.experimentId, r.id); assert.equal(r.parentId, null); } finally { globalThis.fetch = old; }
});
test("A/B revisions and concurrent branches retain identity without changing any previous bytes", async () => {
 const a = await saveAb(input()), bytes = await fs.readFile(file(a.id), "utf8"), draft = { ...a.data, title: "Новая версия", status: "running" as const };
 const [b, c] = await Promise.all([saveAb(input(draft, a.id)), saveAb(input({ ...draft, title: "Ветка" }, a.id))]);
 assert.notEqual(b.id, c.id); assert.equal(b.experimentId, a.id); assert.equal(c.parentId, a.id); assert.equal(await fs.readFile(file(a.id), "utf8"), bytes); assert.deepEqual(await loadAb(b.id), b);
 const again = await saveAb(input(b.data, b.id)); assert.equal(again.experimentId, a.id); assert.equal(again.parentId, b.id);
});
test("A/B rejects missing parent and changes to pinned video/channel/kind without writing files", async () => {
 const r = await saveAb(input()), before = (await fs.readdir(dir)).sort();
 await assert.rejects(() => saveAb(input(make(), crypto.randomUUID())), /не найдена/);
 for (const patch of [{ videoId: "bbbbbbbbbbb" }, { channelRef: "Другой канал" }, { kind: "thumbnail" as const, variants: make().variants.map(v => ({ ...v, thumbnail: "abc" })) }]) await assert.rejects(() => saveAb(input({ ...r.data, ...patch }, r.id)), /закреплены/);
 assert.deepEqual((await fs.readdir(dir)).sort(), before);
});
test("A/B failed validation never destroys saved results or creates incomplete snapshots", async () => {
 const a = await saveAb(input()), before = (await fs.readdir(dir)).sort(); await assert.rejects(() => saveAb(input({ ...make(), title: "" }))); assert.deepEqual((await fs.readdir(dir)).sort(), before); assert.deepEqual(await loadAb(a.id), a);
});
test("A/B rejects traversal, wrong ID, broken JSON and unknown stored fields but does not delete files", async () => {
 await assert.rejects(() => loadAb("../settings")); assert.equal(await loadAb(crypto.randomUUID()), null);
 const a = await saveAb(input()); const raw = JSON.parse(await fs.readFile(file(a.id), "utf8"));
 for (const content of ["{", JSON.stringify({ ...raw, secret: "SHOULD_NOT_LEAK" }), JSON.stringify({ ...raw, id: crypto.randomUUID() }), JSON.stringify({ ...raw, experimentId: crypto.randomUUID() })]) { const id = crypto.randomUUID(); await fs.writeFile(file(id), content); await assert.rejects(() => loadAb(id)); assert.ok((await fs.stat(file(id))).isFile()); }
});
test("A/B refuses symlink/oversized files and symlink roots", async () => {
 const r = await saveAb(input()), alias = crypto.randomUUID(), large = crypto.randomUUID();
 await fs.symlink(file(r.id), file(alias)); await assert.rejects(() => loadAb(alias)); await fs.writeFile(file(large), " ".repeat(64*1024+1)); await assert.rejects(() => loadAb(large));
 const moved = dir + "-test-original"; await fs.rename(dir, moved); await fs.symlink(moved, dir);
 try { await assert.rejects(() => listAb(), /не ссылкой/); await assert.rejects(() => saveAb(input()), /не ссылкой/); } finally { await fs.unlink(dir); await fs.rename(moved, dir); }
});
test("A/B local history retains files, returns newest 50 snapshots and flags corrupt entries", async () => {
 for (let i=0; i<52; i++) { const r = await saveAb(input({ ...make(), title: `История ${i}` })), raw = JSON.parse(await fs.readFile(file(r.id), "utf8")); raw.createdAt = new Date(Date.UTC(2030,0,i+1)).toISOString(); await fs.writeFile(file(r.id), JSON.stringify(raw)); }
 const h = await listAb(); assert.equal(h.items.length, 50); assert.equal(h.items[0].title, "История 51"); assert.match(h.warnings.join(" "), /Пропущено/); assert.ok((await fs.readdir(dir)).length > 50); assert.ok(h.items.every((x,i)=>i===0||h.items[i-1].createdAt>=x.createdAt));
});
test("A/B history over 5000 files fails explicitly instead of silently truncating scan", async () => {
 const moved = dir + "-test-original"; await fs.rename(dir, moved); await fs.mkdir(dir);
 try { await Promise.all(Array.from({length:5001}, (_,i)=>fs.writeFile(dataPath("ab-test-runs", `${String(i).padStart(8,"0")}-0000-4000-8000-000000000000.json`), "{}"))); await assert.rejects(() => listAb(), /5000/); } finally { await fs.rm(dir,{recursive:true,force:true}); await fs.rename(moved,dir); }
});
test("A/B backup accepts its catalogue but not traversal/temp entries; snapshots contain only declared fields", async () => {
 assert.equal(backupTarget(`ab-test-runs/${crypto.randomUUID()}.json`), "data"); assert.equal(backupTarget("ab-test-runs/../oauth.json"), null); assert.equal(backupTarget("ab-test-runs/a.tmp"), null);
 const r = await saveAb(input()), raw = JSON.parse(await fs.readFile(file(r.id), "utf8")); assert.deepEqual(Object.keys(raw).sort(), ["createdAt","data","experimentId","id","parentId","source","version"]); assert.equal(raw.data.variants[0].impressions, null); assert.ok(!("winner" in raw));
});
test("A/B Markdown exports saved identity, manual status, unknowns and plain user text", async () => {
 const { abMarkdown } = await import("../../web/src/features/ab/model.js");
 const r = await saveAb(input({ ...make(), title: '<img src=x onerror=alert(1)> [x](javascript:evil) 😀', hypothesis: "```\nInjected heading" }));
 const md = abMarkdown(r); assert.ok(md.includes(r.id)); assert.match(md,/неизвестно/); assert.ok(!md.includes("<img")); assert.ok(!md.includes("[x](javascript:evil)")); assert.ok(!md.includes("```")); assert.match(md,/Ручной журнал/);
});
test("A/B Markdown known zero CTR and nonzero signed difference are not null or relative lift", async () => {
 const { abMarkdown } = await import("../../web/src/features/ab/model.js");
 const d = make(); d.variants = d.variants.map((v,i)=>({...v,impressions:100,ctrPct:i===0?0:5}));
 const r = await saveAb(input(d)), md = abMarkdown(r); assert.match(md,/CTR: 0%/); assert.match(md,/B − A: 5 п.п. CTR/); assert.ok(!md.includes("Infinity"));
});
