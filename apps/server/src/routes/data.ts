import { Hono } from "hono";
import { ok, fail } from "../lib/errors.js";
import { config } from "../config.js";
import { PROMPTS_DIR } from "../services/prompts.js";
import { BACKUP_LIMITS, exportBackup, importBackup } from "../services/backup.js";

export const dataRoute = new Hono();
const roots = () => ({ dataDir: config.dataDir, promptsDir: PROMPTS_DIR });
dataRoute.get("/data/export", async (c) => {
  try {
    const name = `tubestudio-data-${new Date().toISOString().slice(0, 10)}.zip`;
    return new Response(new Uint8Array(await exportBackup(roots())), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${name}"` } });
  } catch (e) { return fail(c, e); }
});
dataRoute.post("/data/import", async (c) => {
  try {
    // Bound request accumulation as well as decompressed archive size.
    const reader = c.req.raw.body?.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    if (reader) {
      try {
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.length;
          if (size > BACKUP_LIMITS.archive) { await reader.cancel(); return c.json({ ok: false, error: { code: "VALIDATION", message: "ZIP больше 512 МиБ. Используйте файловую копию при остановленной программе.", retryable: false } }, 413); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    const buf = new Uint8Array(size); let pos = 0;
    for (const chunk of chunks) { buf.set(chunk, pos); pos += chunk.length; }
    return ok(c, await importBackup(buf, roots()));
  } catch (e) { return fail(c, e); }
});
