import type { MiddlewareHandler } from "hono";

// This is a local desktop server, not an internet-facing reverse-proxy service.
// Do not trust Forwarded or X-Forwarded-* as evidence of the browser's origin.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(?::([0-9]{1,5}))?$/i;
const CHROME_EXTENSION = /^chrome-extension:\/\/[a-p]{32}$/;
function validHost(host: string | undefined): boolean {
  if (!host) return false;
  const m = LOCAL_HOST.exec(host);
  return !!m && (!m[2] || (Number(m[2]) >= 1 && Number(m[2]) <= 65535));
}
function extensionRoute(method: string, path: string): boolean {
  return method === "GET" && (path === "/api/ext/ping" || path === "/api/ext/videos") ||
    method === "POST" && path === "/api/saved-topics";
}

/** Reduces browser-origin attacks; does not authenticate local programs or extensions. */
export const browserGuard: MiddlewareHandler = async (c, next) => {
  const reject = () => c.json({ ok: false, error: { code: "BROWSER_ORIGIN_BLOCKED", message: "Запрос отклонён защитой локального сервера" } }, 403);
  const host = c.req.header("host");
  if (!validHost(host)) return reject();
  // Node also accepts absolute-form request targets; require both authorities
  // to agree so an absolute URL cannot bypass Host validation.
  let target: URL;
  try {
    target = new URL(c.req.url);
    if (!["http:", "https:"].includes(target.protocol) || target.host !== new URL(`${target.protocol}//${host}`).host) return reject();
  } catch { return reject(); }
  const path = c.req.path;
  if (path !== "/api" && !path.startsWith("/api/") && path !== "/files" && !path.startsWith("/files/")) return next();
  // Google redirects the user's browser here from a different origin. The callback
  // itself validates a short-lived, one-use state before exchanging a code.
  if (c.req.method === "GET" && path === "/api/yt-oauth/callback") return next();
  const origin = c.req.header("origin");
  const site = c.req.header("sec-fetch-site");
  // A Chrome extension with host permissions uses its own origin. This narrow
  // exception is not proof of extension identity; requireAuth still applies.
  if (origin && CHROME_EXTENSION.test(origin) && extensionRoute(c.req.method, path)) return next();
  if (origin !== undefined && origin !== target.origin) return reject();
  if (site !== undefined && !["same-origin", "none"].includes(site)) return reject();
  return next();
};
