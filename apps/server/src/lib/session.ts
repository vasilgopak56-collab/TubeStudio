/**
 * Вход без пароля.
 *
 * При каждом запуске программа (лаунчер) создаёт случайный одноразовый ключ и
 * открывает браузер со ссылкой http://127.0.0.1:<порт>/?launch=<ключ>. Страница
 * обменивает ключ на cookie сеанса. Ключ из ссылки работает один раз и 15 минут.
 * Cookie — случайный номер сеанса, подписанный секретом этой установки (HMAC),
 * а не производная от пароля, поэтому её нельзя вычислить заранее.
 */
import crypto from "node:crypto";
import { config } from "../config.js";

const SESSION_DAYS = 30;
const LAUNCH_TTL_MS = 15 * 60_000;
let installSecret: Buffer = crypto.randomBytes(32);
const launchTokens = new Map<string, number>();

const hash = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const sign = (payload: string) => crypto.createHmac("sha256", installSecret).update(payload).digest("base64url");
const sameText = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function setInstallSecret(secretHex: string) {
  if (/^[a-f0-9]{64}$/.test(secretHex)) installSecret = Buffer.from(secretHex, "hex");
}

/** Product mode: the launcher passes a per-launch key. Legacy APP_PASSWORD remains only for developer test harnesses. */
export const authRequired = () => !!(process.env.TUBESTUDIO_LAUNCH_TOKEN || config.password || process.env.TUBESTUDIO_REQUIRE_AUTH === "1");
export const legacyPasswordLogin = () => !!config.password && !process.env.TUBESTUDIO_LAUNCH_TOKEN;

export function newSessionValue(now = Date.now()): string {
  const payload = `v1.${now + SESSION_DAYS * 86_400_000}.${crypto.randomBytes(16).toString("base64url")}`;
  return `${payload}.${sign(payload)}`;
}
export const SESSION_MAX_AGE = SESSION_DAYS * 86_400;

export function validSession(value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const payload = parts.slice(0, 3).join(".");
  if (!sameText(parts[3], sign(payload))) return false;
  const expires = Number(parts[1]);
  return Number.isFinite(expires) && expires > now;
}

/** A fresh one-time launch key (used by the control channel when the shortcut is clicked again). */
export function issueLaunchToken(now = Date.now()): string {
  for (const [k, exp] of launchTokens) if (exp <= now) launchTokens.delete(k);
  const token = crypto.randomBytes(32).toString("hex");
  launchTokens.set(hash(token), now + LAUNCH_TTL_MS);
  return token;
}

let envTokenUsed = false;
const startedAt = Date.now();
/** Consumes a launch key. Returns true once per key. */
export function consumeLaunchToken(token: unknown, now = Date.now()): boolean {
  if (typeof token !== "string" || token.length < 16 || token.length > 200) return false;
  const fromEnv = process.env.TUBESTUDIO_LAUNCH_TOKEN;
  if (fromEnv && !envTokenUsed && now - startedAt < LAUNCH_TTL_MS && sameText(hash(token), hash(fromEnv))) {
    envTokenUsed = true;
    return true;
  }
  const key = hash(token);
  const exp = launchTokens.get(key);
  if (!exp) return false;
  launchTokens.delete(key);
  return exp > now;
}

export function checkLegacyPassword(password: unknown): boolean {
  const expected = config.password;
  return !!expected && typeof password === "string" && sameText(hash(password), hash(expected));
}

/** Stable per installation: the Chrome extension keeps working after restarts. */
export const extensionToken = () => (authRequired() ? sign("tubestudio-extension").slice(0, 32) : "");
