/** Portable local mockups. No remote URLs, API credentials or inferred performance data. */
export type Picture = { src: string; width: number; height: number };
export type Entry = { id: string; title: string; channel: string; picture: Picture | null };
export type FeedDraft = { own: Entry; peers: Entry[]; mobile: boolean; light: boolean; mark: boolean; position: number };
export type FeedSnapshot = FeedDraft & { format: "tubestudio-feed"; version: 1; createdAt: string };
export const MAX_FEED_JSON = 16 * 1024 * 1024;
export const MAX_FEED_PNG = 5 * 1024 * 1024;
const fail = (): never => { throw Error("Некорректный макет JSON v1. Предыдущий черновик сохранён."); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const o = value as Record<string, unknown>;
  if (Object.keys(o).length !== keys.length || keys.some(k => !Object.hasOwn(o, k))) return fail();
  return o;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max) return fail();
  return value;
}
export function parseFeedSnapshot(raw: string): FeedSnapshot {
  if (raw.length > MAX_FEED_JSON || new TextEncoder().encode(raw).length > MAX_FEED_JSON) throw Error("JSON макета — до 16 МиБ. Предыдущий черновик сохранён.");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return fail(); }
  const o = object(parsed, ["format", "version", "createdAt", "own", "peers", "mobile", "light", "mark", "position"]);
  if (o.format !== "tubestudio-feed" || o.version !== 1 || typeof o.createdAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(o.createdAt) || !Number.isFinite(Date.parse(o.createdAt)) || new Date(o.createdAt).toISOString() !== o.createdAt) return fail();
  const entry = (value: unknown): Entry => {
    const e = object(value, ["id", "title", "channel", "picture"]);
    if (typeof e.id !== "string" || (e.id !== "own" && !/^[1-9]\d{0,8}$/.test(e.id))) return fail();
    let picture: Picture | null = null;
    if (e.picture !== null) {
      const p = object(e.picture, ["src", "width", "height"]);
      if (!Number.isInteger(p.width) || !Number.isInteger(p.height) || (p.width as number) < 1 || (p.height as number) < 1 || (p.width as number) > 1280 || (p.height as number) > 1280) return fail();
      if (typeof p.src !== "string" || p.src.length > Math.ceil(MAX_FEED_PNG / 3) * 4 + 22 || (!p.src.startsWith("data:image/png;base64,") || (p.src.length - 22) % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(p.src.slice(22)))) return fail();
      picture = { src: p.src, width: p.width as number, height: p.height as number };
    }
    return { id: e.id, title: text(e.title, 200), channel: text(e.channel, 100), picture };
  };
  if (!Array.isArray(o.peers) || o.peers.length > 5) return fail();
  const own = entry(o.own), peers = o.peers.map(entry);
  if (own.id !== "own" || peers.some(p => p.id === "own") || new Set(peers.map(p => p.id)).size !== peers.length) return fail();
  if ([o.mobile, o.light, o.mark].some(v => typeof v !== "boolean") || !Number.isInteger(o.position) || (o.position as number) < 1 || (o.position as number) > peers.length + 1) return fail();
  return { format: "tubestudio-feed", version: 1, createdAt: o.createdAt, own, peers, mobile: o.mobile as boolean, light: o.light as boolean, mark: o.mark as boolean, position: o.position as number };
}
export function orderedFeed(draft: FeedDraft): Entry[] {
  const entries = [...draft.peers]; entries.splice(Math.min(draft.position - 1, entries.length), 0, draft.own); return entries;
}
