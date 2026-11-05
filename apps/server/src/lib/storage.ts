import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { ApiError } from "./errors.js";

export const dataPath = (...p: string[]) => path.join(config.dataDir, ...p);

export async function ensureDataDirs() {
  for (const d of ["", "projects", "files", "cache", "logs", "reports", "topic-runs"]) await fs.mkdir(dataPath(d), { recursive: true });
}

const BUSY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Windows: an antivirus scanner, the search indexer or a sync client may hold
 * a file for a moment, and rename() then fails with EPERM/EBUSY. Retry briefly
 * (about 3 seconds in total) instead of losing the write.
 */
export async function renameWithRetry(from: string, to: string, attempts = 8) {
  for (let i = 0; ; i++) {
    try { await fs.rename(from, to); return; }
    catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (!BUSY_CODES.has(code) || i >= attempts - 1) throw e;
      await pause(25 * 2 ** i);
    }
  }
}

/** Writes a file so that a crash leaves either the old or the new version, never half of it. */
export async function writeFileAtomic(full: string, content: string | Uint8Array, opts: { backup?: boolean; mode?: number } = {}) {
  await fs.mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await fs.open(tmp, "wx", opts.mode ?? 0o666);
  try {
    try { await handle.writeFile(content); await handle.sync(); }
    finally { await handle.close(); }
    // The previous intact version stays as *.bak: used only if the main file is ever found damaged.
    let previousIntact = false;
    if (opts.backup) {
      let previous: Buffer | null = null;
      try { previous = await fs.readFile(full); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      previousIntact = previous !== null && intact(full, previous);
      if (previousIntact) await fs.writeFile(`${full}.bak`, previous!);
    }
    await renameWithRetry(tmp, full);
    // First save (or the old file was damaged): the new version becomes the backup.
    if (opts.backup && !previousIntact) await fs.copyFile(full, `${full}.bak`).catch(() => {});
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

function intact(full: string, content: Buffer): boolean {
  if (!full.endsWith(".json")) return true;
  try { JSON.parse(stripBom(content.toString("utf8"))); return true; } catch { return false; }
}

/** Atomic JSON write: temporary file + fsync + rename (with Windows retries). */
export async function writeJson(file: string, data: unknown, opts: { backup?: boolean } = {}) {
  await writeFileAtomic(dataPath(file), JSON.stringify(data, null, 2), opts);
}

/**
 * A missing file means "nothing saved yet" and returns the fallback.
 * A damaged file is NOT treated as empty: we try the *.bak copy, and if that
 * is also unusable we stop with a clear error, so nothing overwrites the data.
 */
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  const full = dataPath(file);
  let text: string;
  try { text = await fs.readFile(full, "utf8"); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new ApiError("INTERNAL", `Не удалось прочитать файл данных ${file}. Проверьте доступ к папке данных и повторите.`, 500);
  }
  try { return JSON.parse(stripBom(text)) as T; }
  catch {
    const restored = await restoreFromBackup(full);
    if (restored !== undefined) return restored as T;
    throw new ApiError("INTERNAL", `Файл данных ${file} повреждён, резервной копии нет. Файл не изменён и не будет перезаписан. Восстановите его из резервной копии папки данных.`, 500);
  }
}

const stripBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

async function restoreFromBackup(full: string): Promise<unknown | undefined> {
  let parsed: unknown;
  try { parsed = JSON.parse(stripBom(await fs.readFile(`${full}.bak`, "utf8"))); }
  catch { return undefined; }
  // Keep the damaged original for inspection, then put the good copy back.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.copyFile(full, `${full}.damaged-${stamp}`).catch(() => {});
  await writeFileAtomic(full, JSON.stringify(parsed, null, 2));
  return parsed;
}
