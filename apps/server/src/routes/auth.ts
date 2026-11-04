import { Hono, type MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import crypto from "node:crypto";
import { config } from "../config.js";

const COOKIE = "ts_session";
const token = () => crypto.createHash("sha256").update(`tubestudio:${config.password}`).digest("hex");

export const auth = new Hono();

auth.get("/auth/status", (c) =>
  c.json({ ok: true, data: { required: !!config.password, authed: !config.password || getCookie(c, COOKIE) === token() } }));

auth.post("/auth/login", async (c) => {
  const { password } = await c.req.json().catch(() => ({ password: "" }));
  if (!config.password || password === config.password) {
    setCookie(c, COOKIE, token(), { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return c.json({ ok: true, data: { authed: true } });
  }
  return c.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Неверный пароль" } }, 401);
});

auth.post("/auth/logout", (c) => { deleteCookie(c, COOKIE, { path: "/" }); return c.json({ ok: true, data: {} }); });

/** Токен для расширения Chrome (заголовок X-TS-Token) — когда задан APP_PASSWORD */
export const extToken = () => (config.password ? crypto.createHash("sha256").update(`tubestudio-ext:${config.password}`).digest("hex").slice(0, 32) : "");

export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!config.password || c.req.path.startsWith("/api/auth/") || c.req.path === "/api/yt-oauth/callback") return next(); // callback защищён одноразовым state
  if (c.req.header("x-ts-token") && c.req.header("x-ts-token") === extToken()) {
    const allowed=c.req.method==="GET" && ["/api/ext/ping","/api/ext/videos"].includes(c.req.path) || c.req.method==="POST" && c.req.path==="/api/saved-topics";
    if(allowed)return next();
    return c.json({ok:false,error:{code:"UNAUTHORIZED",message:"Токен расширения не разрешает это действие"}},403);
  }
  if (getCookie(c, COOKIE) !== token())
    return c.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Требуется вход" } }, 401);
  return next();
};
