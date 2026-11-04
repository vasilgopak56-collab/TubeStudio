import { log } from "../lib/logging.js";
/**
 * Пул ключей YouTube Data API (до 3 шт.): YOUTUBE_API_KEY, _2, _3.
 * Берём первый живой ключ; при quotaExceeded помечаем его исчерпанным до сброса квоты
 * (полночь по тихоокеанскому времени ≈ 10:00 МСК) и переходим к следующему.
 */
import { config } from "../config.js";
import { readJson, writeJson } from "../lib/storage.js";
import { ytDay } from "./usage.js";

export const YT_SLOTS = ["youtube", "youtube2", "youtube3"] as const;
export type YtSlot = (typeof YT_SLOTS)[number];
type SlotState = { exhaustedDay?: string; badUntil?: number; lastError?: string; lastErrorAt?: string };
const FILE = "yt-keys.json";
let state: Partial<Record<YtSlot, SlotState>> | null = null;
let lastKeys = "";

async function load() {
  const sig = YT_SLOTS.map((s) => config.keys[s]).join("|");
  if (!state || sig !== lastKeys) {
    const saved = await readJson<{ sig?: string; state?: Partial<Record<YtSlot, SlotState>> }>(FILE, {});
    // если ключи поменялись — состояние сбрасываем (новый ключ = новая квота)
    state = saved.sig === hash(sig) && saved.state ? saved.state : {};
    lastKeys = sig;
  }
  return state;
}
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };
const persist = () => writeJson(FILE, { sig: hash(lastKeys), state }).catch(() => {});

export const resetYtPool = () => { state = null; lastKeys = ""; };
export const ytConfigured = () => YT_SLOTS.filter((s) => !!config.keys[s]);

/** Ключи в порядке использования: живые, затем (если все мёртвые) — ничего */
export async function ytCandidates(): Promise<{ slot: YtSlot; key: string }[]> {
  const st = await load(); const day = ytDay(), now = Date.now();
  return YT_SLOTS.filter((s) => config.keys[s] && st[s]?.exhaustedDay !== day && (st[s]?.badUntil ?? 0) < now).map((s) => ({ slot: s, key: config.keys[s] }));
}
export async function markYt(slot: YtSlot, kind: "quota" | "bad", message: string) {
  const st = await load();
  const cur = (st[slot] ??= {});
  if (kind === "quota") cur.exhaustedDay = ytDay(); else cur.badUntil = Date.now() + 30 * 60_000;
  cur.lastError = message; cur.lastErrorAt = new Date().toISOString();
  log.warn({ event: "youtube_key_fallback", slot });
  await persist();
}
export async function markYtOk(slot: YtSlot) {
  const st = await load();
  if (st[slot]?.badUntil) { delete st[slot]!.badUntil; await persist(); }
}

/** Ближайший сброс квоты (полночь America/Los_Angeles) */
export function nextReset() {
  const now = new Date();
  const la = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const ms = (24 * 3600 - (la.getHours() * 3600 + la.getMinutes() * 60 + la.getSeconds())) * 1000;
  return new Date(now.getTime() + ms).toISOString();
}

export async function ytPoolStatus(byKey: Record<string, number> = {}) {
  const st = await load(); const day = ytDay(), now = Date.now();
  const cands = await ytCandidates();
  const active = cands[0]?.slot ?? null;
  return {
    active, resetAt: nextReset(), dailyLimitPerKey: 10_000,
    keys: YT_SLOTS.map((s, i) => {
      const k = config.keys[s];
      const exhausted = st[s]?.exhaustedDay === day, bad = (st[s]?.badUntil ?? 0) > now;
      return {
        slot: s, n: i + 1, configured: !!k, masked: k ? `${k.slice(0, 6)}…${k.slice(-4)}` : "",
        unitsToday: byKey[s] ?? 0, exhausted, bad, active: s === active,
        state: !k ? "empty" : exhausted ? "exhausted" : bad ? "bad" : s === active ? "active" : "standby",
        lastError: st[s]?.lastError, lastErrorAt: st[s]?.lastErrorAt,
      };
    }),
  };
}
