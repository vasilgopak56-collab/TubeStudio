// Unit tests never inherit real provider credentials, .env, prompts or DATA_DIR.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tubestudio-unit-"));
const env = Object.fromEntries(["PATH", "HOME", "SystemRoot", "WINDIR", "TEMP", "TMP", "FFMPEG_PATH"].filter(k => process.env[k]).map(k => [k, process.env[k]]));
Object.assign(env, { DATA_DIR: path.join(tmp, "data"), ENV_FILE: path.join(tmp, "absent.env"), PROMPTS_DIR: path.join(tmp, "prompts") });
await fs.cp(path.join(root, "apps/server/prompts"), env.PROMPTS_DIR, { recursive: true });
try {
  const files = (await fs.readdir(path.join(root, "apps/server/test"))).filter(f => f.endsWith(".test.ts")).sort().map(f => `test/${f}`);
  const child = spawn(process.execPath, ["--import", "tsx", "--test", ...files], { cwd: path.join(root, "apps/server"), env, stdio: "inherit" });
  process.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => resolve(code ?? 1)); });
} finally { await fs.rm(tmp, { recursive: true, force: true }); }
