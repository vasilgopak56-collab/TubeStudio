import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config, type Provider } from "../config.js";
import { resetKeyCache } from "./keycheck.js";
import { resetYtPool } from "./ytKeys.js";
import { ApiError } from "../lib/errors.js";

export const envPath = () => process.env.ENV_FILE || path.resolve(process.cwd(), "../../.env");
const NAMES: Record<Provider, string> = {
  anymodel: "ANYMODEL_API_KEY", youtube: "YOUTUBE_API_KEY", youtube2: "YOUTUBE_API_KEY_2", youtube3: "YOUTUBE_API_KEY_3", gemini: "GEMINI_API_KEY", lumean: "LUMEAN_API_KEY", anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY",
};
let pending: Promise<unknown> = Promise.resolve();
// One in-process queue for keys AND OAuth variables. Not a cross-process lock.
function commitEnv(entries: [string, string][], committed: () => void) {
  const file = envPath();
  const operation = pending.then(async () => {
    let text = "", tmp: string | undefined;
    try {
      try { text = await fs.readFile(file, "utf8"); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      let lines = text ? text.replace(/(\r?\n)+$/, "").split(/\r?\n/) : [];
      for (const [name, value] of entries) {
        // Remove duplicate definitions of the edited name; preserve unrelated lines.
        const matches = (line: string) => line.replace(/^\s*export\s+/, "").startsWith(name + "=");
        const first = lines.findIndex(matches);
        lines = lines.filter((line) => !matches(line));
        if (value) lines.splice(first < 0 ? lines.length : Math.min(first, lines.length), 0, `${name}=${value}`);
      }
      const candidate = `${file}.${randomUUID()}.tmp`;
      const handle = await fs.open(candidate, "wx", 0o600);
      tmp = candidate; // Only clean up a file created by this operation.
      try { await handle.writeFile(lines.join("\n").replace(/\n*$/, "\n"), "utf8"); }
      finally { await handle.close(); }
      await fs.rename(candidate, file);
      tmp = undefined;
    } catch {
      if (tmp) await fs.rm(tmp, { force: true }).catch(() => {});
      throw new ApiError("INTERNAL", "Не удалось сохранить .env. Изменения не применены. Проверьте доступ к файлу и свободное место.", 500);
    }
    // No asynchronous work after this commit point: disk first, then memory/cache.
    committed();
  });
  pending = operation.catch(() => {});
  return operation;
}
const validValue = (v: unknown): v is string => typeof v === "string" && v.length <= 400 && !/[\s"'`]/.test(v.trim()) && !/[\r\n]/.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Empty values remove definitions; the in-memory key remains an empty string. */
export async function saveKeys(patch: Partial<Record<Provider, string>>) {
  if (!object(patch)) throw new ApiError("VALIDATION", "Проверьте ключи для сохранения", 400);
  const entries = Object.entries(patch).filter(([p]) => Object.hasOwn(NAMES, p)) as [Provider, string][];
  if (!entries.length) throw new ApiError("VALIDATION", "Нет ключей для сохранения", 400);
  if (entries.some(([, v]) => !validValue(v))) throw new ApiError("VALIDATION", "Ключ содержит недопустимые символы (пробелы, кавычки, переносы)", 400);
  const values = entries.map(([p, v]) => [p, v.trim()] as const);
  const file = envPath();
  await commitEnv(values.map(([p, v]) => [NAMES[p], v]), () => {
    for (const [p, v] of values) { config.keys[p] = v; if (v) process.env[NAMES[p]] = v; else delete process.env[NAMES[p]]; }
    resetKeyCache();
    if (values.some(([p]) => p.startsWith("youtube"))) resetYtPool();
  });
  return { saved: values.map(([p]) => p), file };
}

export async function saveEnvVars(vars: Record<string, string>) {
  if (!object(vars)) throw new ApiError("VALIDATION", "Проверьте переменные .env", 400);
  const entries = Object.entries(vars);
  if (entries.some(([k, v]) => !/^[A-Z][A-Z0-9_]*$/.test(k) || !validValue(v))) throw new ApiError("VALIDATION", "Имя или значение переменной недопустимо", 400);
  const values = entries.map(([k, v]) => [k, v.trim()] as [string, string]);
  await commitEnv(values, () => { for (const [k, v] of values) { if (v) process.env[k] = v; else delete process.env[k]; } });
}
