/**
 * Хранилище ключей API и других секретов.
 *
 * Значения шифруются AES-256-GCM. Сам ключ шифрования (мастер-ключ) на Windows
 * защищён DPAPI: расшифровать его может только та же учётная запись Windows на
 * этом же компьютере. Поэтому файл keys.json бесполезен, если его скопировать.
 * На других системах (разработка, тесты на Linux) мастер-ключ хранится рядом —
 * это только защита от случайного просмотра, о чём честно сообщает статус.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { config } from "../config.js";
import { writeFileAtomic } from "./storage.js";

export type Protection = "dpapi" | "file";
type Sealed = { iv: string; tag: string; data: string };
type SecretsDoc = { schema: 1; protection: Protection; master: string; values: Record<string, Sealed>; updatedAt: string };

export const secretsFile = () => path.join(config.dataDir, "secrets", "keys.json");
const ENTROPY = "TubeStudio/secrets/v1";
const NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

let state: { doc: SecretsDoc; master: Buffer } | null = null;
let lastError = "";
let tail: Promise<unknown> = Promise.resolve();

function wantedProtection(): Protection {
  const forced = process.env.TUBESTUDIO_SECRETS_PROTECTION;
  if (forced === "file" || forced === "dpapi") return forced;
  return process.platform === "win32" ? "dpapi" : "file";
}

/** Calls Windows DPAPI (CurrentUser scope) through the built-in Windows PowerShell 5.1. */
export function dpapi(op: "protect" | "unprotect", data: Buffer): Promise<Buffer> {
  const method = op === "protect" ? "Protect" : "Unprotect";
  const script = [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Security",
    "$b=[Convert]::FromBase64String($env:TS_DPAPI_IN)",
    `$e=[Text.Encoding]::UTF8.GetBytes('${ENTROPY}')`,
    `$r=[Security.Cryptography.ProtectedData]::${method}($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    "[Console]::Out.Write([Convert]::ToBase64String($r))",
  ].join(";");
  const exe = path.join(process.env.SystemRoot || process.env.windir || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, TS_DPAPI_IN: data.toString("base64") },
    });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("DPAPI_TIMEOUT")); }, 30_000);
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { err += c; });
    child.once("error", (e) => { clearTimeout(timer); reject(e); });
    child.once("close", (code) => {
      clearTimeout(timer);
      const text = out.trim();
      if (code === 0 && /^[A-Za-z0-9+/=]+$/.test(text)) resolve(Buffer.from(text, "base64"));
      else reject(new Error(`DPAPI_FAILED ${code}: ${err.slice(0, 300)}`));
    });
  });
}

function seal(master: Buffer, name: string, value: string): Sealed {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", master, iv);
  cipher.setAAD(Buffer.from(name, "utf8"));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

function open(master: Buffer, name: string, s: Sealed): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", master, Buffer.from(s.iv, "base64"));
  decipher.setAAD(Buffer.from(name, "utf8"));
  decipher.setAuthTag(Buffer.from(s.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(s.data, "base64")), decipher.final()]).toString("utf8");
}

async function readDoc(): Promise<SecretsDoc | null> {
  let text: string;
  try { text = await fs.readFile(secretsFile(), "utf8"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  const doc = JSON.parse(text) as SecretsDoc;
  if (doc?.schema !== 1 || (doc.protection !== "dpapi" && doc.protection !== "file") || typeof doc.master !== "string" || !doc.values || typeof doc.values !== "object") throw new Error("SECRETS_FORMAT");
  return doc;
}

async function unlock(doc: SecretsDoc): Promise<Buffer> {
  const raw = Buffer.from(doc.master, "base64");
  const master = doc.protection === "dpapi" ? await dpapi("unprotect", raw) : raw;
  if (master.length !== 32) throw new Error("SECRETS_MASTER");
  return master;
}

async function createState(): Promise<{ doc: SecretsDoc; master: Buffer }> {
  const protection = wantedProtection();
  const master = crypto.randomBytes(32);
  const stored = protection === "dpapi" ? await dpapi("protect", master) : master;
  return { master, doc: { schema: 1, protection, master: stored.toString("base64"), values: {}, updatedAt: new Date().toISOString() } };
}

async function persist(doc: SecretsDoc) {
  doc.updatedAt = new Date().toISOString();
  await writeFileAtomic(secretsFile(), JSON.stringify(doc, null, 2) + "\n", { mode: 0o600 });
}

/** Reads every secret once at startup. Never throws: problems are reported through secretsStatus(). */
export async function loadSecrets(): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  try {
    const doc = await readDoc();
    if (!doc) { state = null; lastError = ""; return values; }
    const master = await unlock(doc);
    for (const [name, sealed] of Object.entries(doc.values)) {
      try { values[name] = open(master, name, sealed); }
      catch { lastError = `Ключ ${name} не расшифровывается и пропущен.`; }
    }
    state = { doc, master };
  } catch (e) {
    state = null;
    lastError = (e as Error).message?.startsWith("DPAPI")
      ? "Ключи защищены другой учётной записью Windows или другим компьютером. Введите их заново в Настройках."
      : "Файл ключей повреждён. Введите ключи заново в Настройках; старый файл сохранится рядом.";
  }
  return values;
}

/** Empty value deletes the secret. All names are written in one atomic file update. */
export function setSecrets(patch: Record<string, string>): Promise<void> {
  const run = tail.then(async () => {
    for (const name of Object.keys(patch)) if (!NAME.test(name)) throw new Error(`SECRET_NAME ${name}`);
    if (!state) {
      // Keep an unreadable old file for inspection instead of silently overwriting it.
      try { await fs.access(secretsFile()); await fs.copyFile(secretsFile(), `${secretsFile()}.unreadable-${Date.now()}`); }
      catch { /* no previous file */ }
      state = await createState();
    }
    const doc: SecretsDoc = { ...state.doc, values: { ...state.doc.values } };
    for (const [name, value] of Object.entries(patch)) {
      if (value) doc.values[name] = seal(state.master, name, value);
      else delete doc.values[name];
    }
    await persist(doc);
    state = { doc, master: state.master };
    lastError = "";
  });
  tail = run.catch(() => {});
  return run;
}

export function secretsStatus() {
  return {
    file: secretsFile(),
    protection: state?.doc.protection ?? wantedProtection(),
    protectedByWindows: (state?.doc.protection ?? wantedProtection()) === "dpapi",
    names: state ? Object.keys(state.doc.values).sort() : [],
    error: lastError || undefined,
  };
}

/** For tests only. */
export function resetSecretsForTests() { state = null; lastError = ""; tail = Promise.resolve(); }
