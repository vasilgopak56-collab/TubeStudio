/**
 * Запуск портативной версии: ключи из защищённого хранилища, однократный
 * перенос ключей из старого .env и секрет установки для cookie сеанса.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config, type Provider } from "../config.js";
import { loadSecrets, setSecrets, secretsStatus } from "./secrets.js";
import { setInstallSecret } from "./session.js";
import { PROVIDER_ENV_NAMES, usesSecretStore } from "../services/envfile.js";
import { writeFileAtomic } from "./storage.js";

const INSTALL = "TUBESTUDIO_INSTALL_SECRET";
/** Names worth carrying over from an old .env (secrets and the few settings that lived there). */
const IMPORTABLE = new Set([
  "ANYMODEL_API_KEY", "YOUTUBE_API_KEY", "YOUTUBE_API_KEY_2", "YOUTUBE_API_KEY_3", "GEMINI_API_KEY", "LUMEAN_API_KEY",
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "ANYMODEL_BASE_URL", "FFMPEG_PATH",
]);

export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "").trim();
    out[m[1]] = value;
  }
  return out;
}

function apply(values: Record<string, string>) {
  const byEnv = Object.fromEntries(Object.entries(PROVIDER_ENV_NAMES()).map(([p, n]) => [n, p as Provider]));
  for (const [name, value] of Object.entries(values)) {
    if (name === INSTALL || !value) continue;
    process.env[name] = value;
    const provider = byEnv[name];
    if (provider) config.keys[provider] = value;
    if (name === "ANYMODEL_BASE_URL") config.anymodelBase = value.replace(/\/+$/, "");
  }
}

type Migration = { schema?: number; legacyEnv?: string | null; envImported?: boolean; importedNames?: string[]; [k: string]: unknown };

async function importLegacyEnv(current: Record<string, string>): Promise<string[]> {
  const file = path.join(config.dataDir, "migration.json");
  let m: Migration;
  try { m = JSON.parse(await fs.readFile(file, "utf8")) as Migration; }
  catch { return []; }
  if (!m.legacyEnv || m.envImported) return [];
  let parsed: Record<string, string> = {};
  try { parsed = parseEnvText(await fs.readFile(m.legacyEnv, "utf8")); }
  catch { /* the old .env may be gone; nothing to import */ }
  const patch: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) if (IMPORTABLE.has(name) && value && !current[name]) patch[name] = value;
  if (Object.keys(patch).length) await setSecrets(patch);
  const next = { ...m, envImported: true, importedNames: Object.keys(patch).sort(), envImportedAt: new Date().toISOString() };
  await writeFileAtomic(file, JSON.stringify(next, null, 2) + "\n");
  apply(patch);
  return Object.keys(patch);
}

export async function initPortableSecrets(): Promise<{ imported: string[] }> {
  if (!usesSecretStore()) return { imported: [] };
  const values = await loadSecrets();
  apply(values);
  let imported: string[] = [];
  try { imported = await importLegacyEnv(values); } catch { /* reported in status; the program still starts */ }
  if (values[INSTALL]) setInstallSecret(values[INSTALL]);
  else if (!secretsStatus().error) {
    const secret = crypto.randomBytes(32).toString("hex");
    try { await setSecrets({ [INSTALL]: secret }); setInstallSecret(secret); } catch { /* random per process */ }
  }
  return { imported };
}
