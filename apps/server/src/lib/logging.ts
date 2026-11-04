import fs from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { config } from "../config.js";

/** Serialized rotating destination: app.log + 5 older files, 10 MiB each by default. */
export class RotatingLog {
  private pending: Promise<void> = Promise.resolve();
  private bytes: number | undefined;
  private failureReported = false;
  constructor(readonly file: string, readonly maxBytes = 10 * 1024 ** 2, readonly keep = 5) {}
  write(line: string) {
    if (Buffer.byteLength(line) > this.maxBytes) line = JSON.stringify({ level: 40, event: "log_record_oversize", originalBytes: Buffer.byteLength(line) }) + "\n";
    this.pending = this.pending.then(async () => {
      if (this.bytes === undefined) {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        this.bytes = await fs.stat(this.file).then(s => s.size).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return 0; throw e; });
        await fs.chmod(this.file, 0o600).catch((e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT") throw e; });
      }
      const size = Buffer.byteLength(line);
      if (this.bytes && this.bytes + size > this.maxBytes) {
        await fs.rm(`${this.file}.${this.keep}`, { force: true });
        for (let n = this.keep - 1; n >= 1; n--) {
          await fs.rename(`${this.file}.${n}`, `${this.file}.${n + 1}`).catch((e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT") throw e; });
        }
        await fs.rename(this.file, `${this.file}.1`); this.bytes = 0;
      }
      await fs.appendFile(this.file, line, { mode: 0o600 }); this.bytes! += size;
    }).catch(() => {
      this.bytes = undefined;
      if (!this.failureReported) { this.failureReported = true; process.stderr.write("TubeStudio: не удалось записать журнал. Проверьте место и права DATA_DIR/logs.\n"); }
    });
  }
  flush() { return this.pending; }
}

const privateKey = /password|authorization|cookie|secret|token|api.?key|headers|^body$|^prompt$|^system$|^user$|^text$|^clips$/i;
export function redactLog(value: unknown, secrets: string[] = [], depth = 0): unknown {
  if (depth > 5) return "[omitted]";
  if (typeof value === "string") {
    let text = value;
    for (const secret of secrets) if (secret.length >= 4) text = text.split(secret).join("[redacted]");
    return text.replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
      .replace(/([?&](?:key|code|state|token|access_token|refresh_token|client_secret|password)=)[^&#\s]*/gi, "$1[redacted]")
      .replace(/\b(?:AIza[\w-]{20,}|sk-[\w-]{16,}|ya29\.[\w.-]+|1\/\/[\w-]{20,})/g, "[redacted]").slice(0, 2000);
  }
  if (value instanceof Error) return { type: value.name, code: (value as { code?: string }).code, message: redactLog(value.message, secrets, depth + 1) };
  if (Array.isArray(value)) return value.slice(0, 20).map(v => redactLog(v, secrets, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 30).map(([k, v]) => [k, privateKey.test(k) ? "[redacted]" : redactLog(v, secrets, depth + 1)]));
  return value;
}
const runtimeSecrets = () => [...Object.values(config.keys), config.password, process.env.GOOGLE_CLIENT_SECRET ?? ""];
export function createLogger(destination: { write: (s: string) => void }, secrets: () => string[] = runtimeSecrets) {
  return pino({ level: "info", base: undefined, timestamp: pino.stdTimeFunctions.isoTime,
    hooks: { logMethod(args, method) {
      const safe = args.map(a => redactLog(a, secrets()));
      method.apply(this, safe as Parameters<typeof method>);
    } },
  }, destination);
}
const destination = new RotatingLog(path.join(config.dataDir, "logs", "app.log"));
export const log = createLogger(destination);
export const flushLogs = () => destination.flush();
