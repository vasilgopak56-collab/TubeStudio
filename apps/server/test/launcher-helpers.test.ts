// Portable launcher helpers: whose process number it is, and where the shared folder is
// after "Extract all" (an extra folder named after the archive).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

process.env.TUBESTUDIO_LAUNCHER_NO_MAIN = "1";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const L: any = await import(pathToFileURL(path.resolve("../../launcher/launcher.mjs")).href);

test("launcher: tasklist CSV gives the program name for exactly this number", () => {
  assert.equal(L.parseTasklist('"node.exe","1234","Console","1","45 678 K"\r\n', 1234), "node.exe");
  assert.equal(L.parseTasklist('"PING.EXE","5124","Console","1","4 200 K"', 5124), "PING.EXE");
  assert.equal(L.parseTasklist('"chrome.exe","12345","Console","1","1 K"', 1234), "", "another number is not a match");
  assert.equal(L.parseTasklist("INFO: No tasks are running which match the specified criteria.", 1234), "");
  assert.equal(L.parseTasklist("", 1234), "");
  for (const yes of ["node.exe", "NODE.EXE", "node", "Node"]) assert.ok(L.isNodeImage(yes), yes);
  for (const no of ["", "nodepad.exe", "node.exe.bak", "PING.EXE", "svchost.exe"]) assert.ok(!L.isNodeImage(no), no);
});

test("launcher: shared folder for direct unpack and for the archive-named folder", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "ts-home-"));
  try {
    const mk = async (...p: string[]) => { const d = path.join(base, ...p); await fs.mkdir(d, { recursive: true }); return d; };
    const direct = await mk("Программы", "TubeStudio", "TubeStudio-1.1.1");
    assert.equal(L.homeFor(direct), path.join(base, "Программы", "TubeStudio"));
    const wrapped = await mk("Программы", "TubeStudio", "TubeStudio-1.1.1-windows", "TubeStudio-1.1.1");
    assert.equal(L.homeFor(wrapped), path.join(base, "Программы", "TubeStudio"), "Extract all: one level up");
    const twice = await mk("Программы", "TubeStudio", "TubeStudio-1.1.1-windows (2)", "TubeStudio-1.1.1");
    assert.equal(L.homeFor(twice), path.join(base, "Программы", "TubeStudio"));
    const other = await mk("Программы", "TubeStudio", "Версия_34", "TubeStudio-1.1.1");
    assert.equal(L.homeFor(other), path.join(base, "Программы", "TubeStudio", "Версия_34"), "an ordinary folder stays the shared folder");
    const earlier = await mk("Программы", "TubeStudio", "TubeStudio-1.1.2-windows", "TubeStudio-1.1.2");
    await mk("Программы", "TubeStudio", "TubeStudio-1.1.2-windows", "TubeStudioData");
    assert.equal(L.homeFor(earlier), path.join(base, "Программы", "TubeStudio", "TubeStudio-1.1.2-windows"), "data already inside stay there");
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});
