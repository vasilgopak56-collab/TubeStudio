import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zipSync, unzipSync, strToU8 } from "fflate";
import { BACKUP_LIMITS, DATA_FOLDERS, backupTarget, exportBackup, importBackup } from "../src/services/backup.js";

const zip = (files: Record<string, string>, version = 2) => zipSync(Object.fromEntries(Object.entries({ "tubestudio-backup.json": JSON.stringify({ version }), ...files }).map(([n, s]) => [n, strToU8(s)])));
async function fixture(fn: (base: string, roots: { dataDir: string; promptsDir: string }) => Promise<void>) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "ts-backup-"));
  try { await fn(base, { dataDir: path.join(base, "data"), promptsDir: path.join(base, "prompts") }); }
  finally { await fs.rm(base, { recursive: true, force: true }); }
}
async function put(root: string, rel: string, data: string | Uint8Array) { const p = path.join(root, rel); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, data); }

test("backup: round trip every current data folder, binary audio, OAuth and current prompt text", async () => fixture(async (base, roots) => {
  for (const folder of DATA_FOLDERS) await put(roots.dataDir, `${folder}/nested/sample.json`, JSON.stringify({ folder, test: true }));
  const binary = Uint8Array.from([0, 1, 0, 255, 10, 13, 128]);
  await put(roots.dataDir, "audio-storyboards/sample.pcm", binary);
  await put(roots.dataDir, "files/audio/Озвучка 1.mp3", binary);
  await put(roots.dataDir, "oauth.json", '{"refresh_token":"fake-test-token"}');
  await put(roots.dataDir, "settings.json", '{"theme":"dark"}');
  await put(roots.promptsDir, "script/custom.md", "User edited {{topic}} prompt text");
  for (const rel of [".env", "cache/test.json", "logs/app.log", "files/unfinished.tmp"]) await put(roots.dataDir, rel, "must not export");
  await put(roots.promptsDir, ".env", "must not export");
  const data = await exportBackup(roots), entries = unzipSync(data);
  for (const rel of [".env", "cache/test.json", "logs/app.log", "files/unfinished.tmp", "backup-prompts/.env"]) assert.ok(!(rel in entries), rel);
  const dest = { dataDir: path.join(base, "restore"), promptsDir: path.join(base, "restored-prompts") };
  const r = await importBackup(data, dest);
  assert.deepEqual(r.skipped, []); assert.deepEqual(r.warnings, []);
  assert.equal(r.imported, DATA_FOLDERS.size + 5);
  for (const folder of DATA_FOLDERS) assert.deepEqual(JSON.parse(await fs.readFile(path.join(dest.dataDir, folder, "nested/sample.json"), "utf8")), { folder, test: true });
  assert.deepEqual(new Uint8Array(await fs.readFile(path.join(dest.dataDir, "audio-storyboards/sample.pcm"))), binary);
  assert.equal(await fs.readFile(path.join(dest.promptsDir, "script/custom.md"), "utf8"), "User edited {{topic}} prompt text");
  assert.equal(await fs.readFile(path.join(dest.dataDir, "oauth.json"), "utf8"), '{"refresh_token":"fake-test-token"}');
  assert.equal((await fs.stat(path.join(dest.dataDir, "oauth.json"))).mode & 0o777, 0o600);
}));

test("backup: v1 stays compatible; merge overwrites matching files but preserves unrelated ones", async () => fixture(async (_base, roots) => {
  await put(roots.dataDir, "projects/existing.json", "old"); await put(roots.dataDir, "projects/untouched.json", "keep");
  const r = await importBackup(zip({ "projects/existing.json": "new", "pipelines/old.json": "restored" }, 1), roots);
  assert.equal(r.imported, 2); assert.match(r.warnings.join(" "), /v1/);
  assert.equal(await fs.readFile(path.join(roots.dataDir, "projects/existing.json"), "utf8"), "new");
  assert.equal(await fs.readFile(path.join(roots.dataDir, "projects/untouched.json"), "utf8"), "keep");
}));

test("backup: path validation handles traversal, Windows ADS and hidden files; accepts Unicode media", () => {
  for (const name of ["../outside.json", "/projects/x.json", "projects/../x.json", "projects/./x.json", "projects//x.json", "projects\\x.json", "C:/x.json", "files/x:stream", ".env", "files/.env", "files/a.tmp", "cache/x.json", "logs/x.json", "unknown/x.json", "files/CON.txt", "files/x. ", "backup-prompts/../x.md", "backup-prompts/x.json"])
    assert.equal(backupTarget(name), null, name);
  assert.equal(backupTarget("files/проект/Озвучка 1.mp3"), "data");
  assert.equal(backupTarget("backup-prompts/seo/seo.md"), "prompts");
});

test("backup: rejected archive paths are skipped and cannot write outside selected roots", async () => fixture(async (base, roots) => {
  const r = await importBackup(zip({ "projects/a.json": "safe", "../outside.json": "bad", "files/../../outside.json": "bad", "files/x:stream": "bad", ".env": "bad" }), roots);
  assert.equal(r.imported, 1); assert.equal(r.skipped.length, 4);
  await assert.rejects(fs.access(path.join(base, "outside.json")));
  await assert.rejects(fs.access(path.join(roots.dataDir, ".env")));
}));

test("backup: symlinks are excluded from export and rejected before any restore write", async () => fixture(async (base, roots) => {
  const outside = path.join(base, "outside"); await fs.mkdir(outside); await put(outside, "secret.json", "private");
  await fs.mkdir(roots.dataDir); await fs.symlink(outside, path.join(roots.dataDir, "files"));
  const exported = unzipSync(await exportBackup(roots));
  assert.ok(!("files/secret.json" in exported));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(exported["tubestudio-backup.json"])).skipped, ["files"]);
  await assert.rejects(importBackup(zip({ "settings.json": "must-not-write", "files/secret.json": "overwrite" }), roots), /ссылку/);
  assert.equal(await fs.readFile(path.join(outside, "secret.json"), "utf8"), "private");
  await assert.rejects(fs.access(path.join(roots.dataDir, "settings.json")));
}));

test("backup: invalid manifest, unknown version and broken ZIP rejected", async () => fixture(async (_base, roots) => {
  await assert.rejects(importBackup(zipSync({ "settings.json": strToU8("{}") }), roots), /резервную копию/);
  await assert.rejects(importBackup(zip({ "tubestudio-backup.json": "not-json" }), roots), /версия/);
  await assert.rejects(importBackup(zip({}, 99), roots), /версия/);
  await assert.rejects(importBackup(strToU8("this is not a zip archive!"), roots), /ZIP/);
}));

test("backup: declared unpacked size is checked before inflation", async () => fixture(async (_base, roots) => {
  const data = zip({ "files/too-large.bin": "small" });
  const buf = Buffer.from(data);
  for (let i = 0; i < buf.length - 46; i++) {
    if (buf.readUInt32LE(i) !== 0x02014b50) continue;
    const name = buf.subarray(i + 46, i + 46 + buf.readUInt16LE(i + 28)).toString();
    if (name === "files/too-large.bin") buf.writeUInt32LE(BACKUP_LIMITS.file + 1, i + 24);
  }
  await assert.rejects(importBackup(buf, roots), /размера/);
  await assert.rejects(fs.access(roots.dataDir));
}));

test("backup: case-insensitive duplicate names rejected for Windows compatibility", async () => fixture(async (_base, roots) => {
  await assert.rejects(importBackup(zip({ "files/A.txt": "one", "files/a.txt": "two" }), roots), /повторяющиеся/);
}));

test("backup: conflicting file/directory paths are rejected before writing", async () => fixture(async (_base, roots) => {
  await assert.rejects(importBackup(zip({ "files/a": "file", "files/a/b.txt": "nested" }), roots), /конфликт/);
  await assert.rejects(fs.access(roots.dataDir));
}));
