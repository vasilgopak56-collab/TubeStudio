import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export const dataPath = (...p: string[]) => path.join(config.dataDir, ...p);

export async function ensureDataDirs() {
  for (const d of ["", "projects", "files", "cache", "logs", "reports", "topic-runs"]) await fs.mkdir(dataPath(d), { recursive: true });
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(dataPath(file), "utf8")) as T; }
  catch { return fallback; }
}

/** Атомарная запись: временный файл + rename */
export async function writeJson(file: string, data: unknown) {
  const full = dataPath(file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, full);
}
