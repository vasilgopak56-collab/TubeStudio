import { checkCancelled, taskSignal, cancellation } from "../lib/taskContext.js";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ApiError } from "../lib/errors.js";

/** Windows: winget кладёт ffmpeg в %LOCALAPPDATA%\\Microsoft\\WinGet (PATH обновится только после перезапуска оболочки) */
function windowsCandidates(): string[] {
  if (process.platform !== "win32") return [];
  const out: string[] = [];
  const la = process.env.LOCALAPPDATA;
  if (la) {
    out.push(path.join(la, "Microsoft", "WinGet", "Links", "ffmpeg.exe"));
    const pk = path.join(la, "Microsoft", "WinGet", "Packages");
    try {
      for (const d of fs.readdirSync(pk).filter((x) => /ffmpeg/i.test(x))) {
        for (const sub of fs.readdirSync(path.join(pk, d))) out.push(path.join(pk, d, sub, "bin", "ffmpeg.exe"));
      }
    } catch { /* нет папки */ }
  }
  out.push("C:\\ffmpeg\\bin\\ffmpeg.exe", path.join(process.env.ProgramFiles ?? "C:\\Program Files", "ffmpeg", "bin", "ffmpeg.exe"));
  return out;
}

/** Скорость/тон озвучки. AnyModel (Edge/Fish) параметры speed/pitch игнорирует — обрабатываем локально через FFmpeg */
let found: string | null | undefined;
export function ffmpegPath(): string | null {
  if (found !== undefined) return found;
  for (const c of [process.env.FFMPEG_PATH, "ffmpeg", ...windowsCandidates()].filter(Boolean) as string[]) {
    try { if (spawnSync(c, ["-version"], { timeout: 5000 }).status === 0) return (found = c); } catch { /* нет */ }
  }
  return (found = null);
}
/** сбросить кэш (после установки FFmpeg без перезапуска сервера) */
export const resetFfmpeg = () => { found = undefined; };

/** atempo держит 0.5–2; тон — asetrate × 2^(st/12) с компенсацией темпа */
export function fxFilter(speed: number, semitones: number) {
  const f: string[] = [];
  let tempo = speed;
  if (semitones) { const k = Math.pow(2, semitones / 12); f.push("aresample=24000", `asetrate=${Math.round(24000 * k)}`, "aresample=24000"); tempo = tempo / k; }
  while (tempo > 2) { f.push("atempo=2"); tempo /= 2; }
  while (tempo < 0.5) { f.push("atempo=0.5"); tempo /= 0.5; }
  if (Math.abs(tempo - 1) > 1e-3) f.push(`atempo=${tempo.toFixed(4)}`);
  return f.join(",");
}

export async function applyVoiceFx(mp3: Buffer, speed = 1, semitones = 0): Promise<Buffer> {
  const signal = taskSignal(); checkCancelled(signal);
  if (Math.abs(speed - 1) < 0.01 && !semitones) return mp3;
  const bin = ffmpegPath();
  if (!bin) throw new ApiError("VALIDATION", "Для скорости и тона нужен FFmpeg (ffmpeg.org; или переменная FFMPEG_PATH в .env). Без FFmpeg оставьте скорость 1.0 и тон 0", 400);
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-filter:a", fxFilter(speed, semitones), "-ar", "24000", "-ac", "1", "-b:a", "96k", "-f", "mp3", "pipe:1"]);
    const out: Buffer[] = []; let err = "";
    p.stdout.on("data", (d) => out.push(d)); p.stderr.on("data", (d) => (err += d));
    const onAbort = () => p.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    p.stdin.on("error", () => {}); // EPIPE is reported by the process close/error event
    p.on("error", e => { cleanup(); reject(signal?.aborted ? cancellation() : e); });
    p.on("close", (code) => { cleanup(); if (signal?.aborted) reject(cancellation()); else if (code === 0) resolve(Buffer.concat(out)); else reject(new ApiError("UPSTREAM", `FFmpeg: ${err.slice(0, 200)}`, 502)); });
    p.stdin.end(mp3);
  });
}
