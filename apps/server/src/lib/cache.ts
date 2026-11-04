import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readJson, writeJson, dataPath } from "./storage.js";
import { ApiError } from "./errors.js";

const file = (k: string) => `cache/${crypto.createHash("sha1").update(k).digest("hex")}.json`;
let generation = 0;
let mutations: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const task = mutations.then(fn); mutations = task.catch(() => {}); return task;
}
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>, force = false): Promise<T> {
  const before = generation;
  if (!force) {
    const hit = await readJson<{ at: number; v: T } | null>(file(key), null);
    if (hit && Date.now() - hit.at < ttlMs) return hit.v;
  }
  const v = await fn();
  await serialized(async () => { if (generation === before) await writeJson(file(key), { at: Date.now(), v }); });
  return v;
}
export async function cacheStats() {
  let files = 0, bytes = 0;
  const walk = async (dir: string) => {
    const st = await fs.lstat(dir).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
    if (!st) return;
    if (st.isSymbolicLink()) throw new ApiError("VALIDATION", "Папка cache не должна содержать символические ссылки", 400);
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) { files++; bytes += (await fs.stat(full)).size; }
    }
  };
  await walk(dataPath("cache")); return { files, bytes };
}
/** In-flight requests started before a clear may finish, but cannot repopulate the old cache. */
export async function clearCache() {
  return serialized(async () => {
    const before = await cacheStats(); generation++;
    const dir = dataPath("cache"), trash = dataPath(`.cache-clear-${crypto.randomUUID()}`);
    const moved = await fs.rename(dir, trash).then(() => true).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return false; throw e; });
    await fs.mkdir(dir, { recursive: true });
    if (moved) await fs.rm(trash, { recursive: true, force: true });
    return before;
  });
}
