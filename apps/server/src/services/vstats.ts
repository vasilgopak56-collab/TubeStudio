import { readJson, writeJson } from "../lib/storage.js";

/** Снимки просмотров видео во времени → «текущий» VPH по разнице между снимками */
type Pt = { t: number; v: number };
const FILE = "vstats.json";
const MAX_VIDEOS = 8000, MAX_PTS = 12;
let mem: Record<string, Pt[]> | null = null;
let saving: Promise<void> | null = null;

async function load() { if (!mem) mem = await readJson<Record<string, Pt[]>>(FILE, {}); return mem; }

export async function recordViews(rows: { id: string; views: number }[], now = Date.now()) {
  const m = await load();
  for (const r of rows) {
    const a = m[r.id] ?? (m[r.id] = []);
    const last = a[a.length - 1];
    if (last && now - last.t < 10 * 60_000) { last.v = Math.max(last.v, r.views); continue; }
    a.push({ t: now, v: r.views });
    if (a.length > MAX_PTS) a.splice(0, a.length - MAX_PTS);
  }
  const keys = Object.keys(m);
  if (keys.length > MAX_VIDEOS) {
    keys.sort((x, y) => (m[x].at(-1)?.t ?? 0) - (m[y].at(-1)?.t ?? 0)).slice(0, keys.length - MAX_VIDEOS).forEach((k) => delete m[k]);
  }
  saving = (saving ?? Promise.resolve()).then(() => writeJson(FILE, m)).catch(() => {});
  await saving;
}

/** VPH за последний промежуток между снимками (≥ 1 ч, ≤ 7 дн.). null — данных мало */
export async function recentVph(id: string, now = Date.now()): Promise<{ vph: number; hours: number } | null> {
  const a = (await load())[id];
  if (!a || a.length < 2) return null;
  const last = a[a.length - 1];
  const prev = [...a].reverse().find((p) => last.t - p.t >= 3600_000 && now - p.t <= 7 * 86400_000);
  if (!prev) return null;
  const hours = (last.t - prev.t) / 3600_000;
  return { vph: Math.max(0, (last.v - prev.v) / hours), hours: +hours.toFixed(1) };
}

export function _resetVstats(data: Record<string, Pt[]> = {}) { mem = data; }
