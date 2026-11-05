import { Hono, type MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  authRequired, checkLegacyPassword, consumeLaunchToken, extensionToken, legacyPasswordLogin,
  newSessionValue, SESSION_MAX_AGE, validSession,
} from "../lib/session.js";

const COOKIE = "ts_session";
export const auth = new Hono();

const startSession = (c: Parameters<MiddlewareHandler>[0]) =>
  setCookie(c, COOKIE, newSessionValue(), { httpOnly: true, sameSite: "Lax", path: "/", maxAge: SESSION_MAX_AGE });

auth.get("/auth/status", (c) => c.json({ ok: true, data: {
  required: authRequired(),
  authed: !authRequired() || validSession(getCookie(c, COOKIE)),
  passwordLogin: legacyPasswordLogin(),
} }));

/** Exchanges the one-time key from the launch link for a session cookie. */
auth.post("/auth/launch", async (c) => {
  const { token } = await c.req.json().catch(() => ({ token: "" }));
  if (!authRequired() || consumeLaunchToken(token)) {
    startSession(c);
    return c.json({ ok: true, data: { authed: true } });
  }
  return c.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Ссылка входа устарела или уже использована. Запустите TubeStudio ярлыком ещё раз." } }, 401);
});

/** Developer/test harness only (APP_PASSWORD set explicitly); the portable program never uses it. */
auth.post("/auth/login", async (c) => {
  const { password } = await c.req.json().catch(() => ({ password: "" }));
  if (!authRequired() || checkLegacyPassword(password)) {
    startSession(c);
    return c.json({ ok: true, data: { authed: true } });
  }
  return c.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Неверный пароль" } }, 401);
});

auth.post("/auth/logout", (c) => { deleteCookie(c, COOKIE, { path: "/" }); return c.json({ ok: true, data: {} }); });

/** Токен для расширения Chrome (заголовок X-TS-Token). */
export const extToken = extensionToken;

const OPEN_PATHS = new Set(["/api/yt-oauth/callback"]); // callback защищён одноразовым state

export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!authRequired() || c.req.path.startsWith("/api/auth/") || OPEN_PATHS.has(c.req.path)) return next();
  const ext = c.req.header("x-ts-token");
  if (ext && ext === extToken()) {
    const allowed = c.req.method === "GET" && ["/api/ext/ping", "/api/ext/videos"].includes(c.req.path) || c.req.method === "POST" && c.req.path === "/api/saved-topics";
    if (allowed) return next();
    return c.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Токен расширения не разрешает это действие" } }, 403);
  }
  if (!validSession(getCookie(c, COOKIE)))
    return c.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Требуется вход: запустите TubeStudio ярлыком на рабочем столе" } }, 401);
  return next();
};
