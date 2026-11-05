import { z } from "zod";
import { APP_VERSION } from "../lib/version.js";
import { queueStatus } from "../lib/queue.js";
import { cacheStats, clearCache } from "../lib/cache.js";
import { activeJobCount } from "../lib/jobs.js";
import { resetKeyCache } from "../services/keycheck.js";
import { refreshAmCatalogSoon, resetAmCatalog } from "../services/anymodel.js";
import { secretsStatus } from "../lib/secrets.js";
import { log } from "../lib/logging.js";
import { Hono } from "hono";
import { ok, fail } from "../lib/errors.js";
import { checkKeys, activeLlm } from "../services/keycheck.js";
import { getSettings, updateSettings } from "../services/settings.js";
import { config } from "../config.js";
import { saveKeys } from "../services/envfile.js";

export const system = new Hono();

// Local process identity only: no settings, key checks, quota or provider requests.
system.get("/version", (c) => {
  c.header("Cache-Control", "no-store");
  return ok(c, { version: APP_VERSION });
});

system.get("/health", async (c) => {
  try {
    const settings = await getSettings();
    const keys = await checkKeys(); // GET, including legacy force=1, is always local.
    // Installed program: where keys live and how they are protected (names only, never values).
    const secrets = process.env.TUBESTUDIO_PORTABLE === "1" ? (({ protection, protectedByWindows, names, error }) => ({ protection, protectedByWindows, names, error }))(secretsStatus()) : undefined;
    return ok(c, { version: APP_VERSION, node: process.version, dataDir: config.dataDir, llm: activeLlm(settings.llmProvider, settings.anymodel.enabled && settings.anymodel.priority === "first"), keys, secrets });
  } catch (e) { return fail(c, e); }
});

// Explicit user action only. No generation probe; YouTube needs separate consent.
system.post("/settings/keys/check", async (c) => {
  try {
    const input = z.object({ youtube: z.boolean().default(false) }).strict().parse(await c.req.json());
    const settings = await getSettings();
    const keys = await checkKeys(true, input.youtube);
    return ok(c, { version: APP_VERSION, node: process.version, dataDir: config.dataDir, llm: activeLlm(settings.llmProvider, settings.anymodel.enabled && settings.anymodel.priority === "first"), keys });
  } catch (e) { return fail(c, e); }
});

system.get("/settings", async (c) => {
  try { return ok(c, await getSettings()); } catch (e) { return fail(c, e); }
});

system.put("/settings", async (c) => {
  try { return ok(c, await updateSettings(await c.req.json())); } catch (e) { return fail(c, e); }
});

/** Ключи из интерфейса: пишутся в .env и применяются сразу */
system.put("/settings/keys", async (c) => {
  try {
    const body = await c.req.json();
    const saved = await saveKeys(body);
    if (process.env.TUBESTUDIO_PORTABLE === "1" && body && typeof body === "object" && "anymodel" in body) { resetAmCatalog(); refreshAmCatalogSoon(); }
    return ok(c, saved);
  } catch (e) { return fail(c, e); }
});

system.get("/system/runtime", async (c) => {
  try { return ok(c, { queues: queueStatus(), jobs: activeJobCount(), cache: await cacheStats(), logs: { file: "DATA_DIR/logs/app.log", maxMiB: 10, backups: 5 } }); } catch (e) { return fail(c, e); }
});
system.post("/system/cache/clear", async (c) => {
  try {
    const removed = await clearCache(); resetKeyCache(); resetAmCatalog();
    log.info({ event: "cache_cleared", files: removed.files, bytes: removed.bytes });
    return ok(c, { removed, message: "Кеш очищен. Проекты, история, ключи и учёт квоты не изменены. Новые запросы могут расходовать квоту и баланс провайдера." });
  } catch (e) { return fail(c, e); }
});
