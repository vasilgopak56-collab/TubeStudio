// Выпуск 3, шаг 6: карты и таймлайн средствами программы, без генератора картинок и платных запросов.
// Программа предлагает сцены по тексту сценария, в ролик попадает только то, что подтвердил автор.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { geoMercator, geoPath } from "d3-geo";
import sharp from "sharp";
import { feature } from "topojson-client";
import { z } from "zod";
import { ApiError } from "../../lib/errors.js";
import { dataPath } from "../../lib/storage.js";
import { visualState } from "./visual.js";

const W = 1920, H = 1080;
const FOLDER = "montage/graphics", META = "montage/graphics.json";
const projectFile = (projectId: string, local: string) => dataPath("files", projectId.replace(/[^\w-]/g, ""), ...local.split("/"));

// ---------- места ----------
export type Place = { name: string; lat: number; lon: number; span: number; region?: boolean; parent?: string; match?: RegExp };
const EU = "Europe";
/** span — сколько градусов долготы видно в кадре. region — показывается областью, а не точкой. */
export const PLACES: Place[] = [
  { name: EU, lat: 52, lon: 14, span: 60, region: true },
  { name: "Northern Europe", lat: 58, lon: 12, span: 44, region: true, parent: EU, match: /\b[Nn]orthern Europe\b/ },
  { name: "Scandinavia", lat: 62, lon: 15, span: 34, region: true, parent: EU },
  { name: "Alps", lat: 46.5, lon: 10, span: 18, region: true, parent: EU, match: /\bthe Alps\b/ },
  { name: "Baltic Sea", lat: 58, lon: 20, span: 26, region: true, parent: EU, match: /\b(?:the )?Baltic\b/ },
  { name: "Britain", lat: 54.5, lon: -3, span: 18, parent: EU },
  { name: "England", lat: 52.7, lon: -1.6, span: 14, parent: "Britain" },
  { name: "Scotland", lat: 56.8, lon: -4.2, span: 14, parent: "Britain" },
  { name: "Wales", lat: 52.3, lon: -3.7, span: 12, parent: "Britain" },
  { name: "Ireland", lat: 53.2, lon: -8, span: 16, parent: EU },
  { name: "Iceland", lat: 64.9, lon: -18.6, span: 26, parent: EU },
  { name: "Greenland", lat: 72, lon: -40, span: 70 },
  { name: "France", lat: 46.6, lon: 2.4, span: 18, parent: EU },
  { name: "Germany", lat: 51.1, lon: 10.4, span: 18, parent: EU },
  { name: "Denmark", lat: 56, lon: 9.6, span: 14, parent: EU },
  { name: "Norway", lat: 61, lon: 8.5, span: 26, parent: "Scandinavia" },
  { name: "Sweden", lat: 62, lon: 15.5, span: 26, parent: "Scandinavia" },
  { name: "Finland", lat: 63, lon: 26, span: 26, parent: EU },
  { name: "Italy", lat: 42.8, lon: 12.6, span: 18, parent: EU },
  { name: "Spain", lat: 40.2, lon: -3.6, span: 20, parent: EU },
  { name: "Portugal", lat: 39.6, lon: -8, span: 14, parent: EU },
  { name: "Poland", lat: 52, lon: 19.3, span: 18, parent: EU },
  { name: "Russia", lat: 56, lon: 38, span: 44, parent: EU },
  { name: "Netherlands", lat: 52.2, lon: 5.5, span: 12, parent: EU, match: /\b(?:the )?Netherlands\b/ },
  { name: "Belgium", lat: 50.6, lon: 4.6, span: 12, parent: EU },
  { name: "Switzerland", lat: 46.8, lon: 8.2, span: 12, parent: EU },
  { name: "Austria", lat: 47.6, lon: 14.1, span: 14, parent: EU },
  { name: "Hungary", lat: 47.1, lon: 19.5, span: 14, parent: EU },
  { name: "Normandy", lat: 49, lon: 0, span: 12, parent: "France" },
  { name: "Burgundy", lat: 47.1, lon: 4.8, span: 12, parent: "France" },
  { name: "Flanders", lat: 51, lon: 3.5, span: 10, parent: EU },
  { name: "Bavaria", lat: 48.8, lon: 11.5, span: 12, parent: "Germany" },
  { name: "Bohemia", lat: 49.9, lon: 14.8, span: 12, parent: EU },
  { name: "Tyrol", lat: 47, lon: 11.4, span: 10, parent: "Alps" },
  { name: "Cornwall", lat: 50.4, lon: -4.9, span: 9, parent: "England" },
  { name: "Dartmoor", lat: 50.57, lon: -3.92, span: 9, parent: "England" },
  { name: "Yorkshire", lat: 54, lon: -1.5, span: 9, parent: "England" },
  { name: "Norfolk", lat: 52.65, lon: 0.9, span: 9, parent: "England" },
  { name: "Wharram Percy", lat: 54.07, lon: -0.69, span: 9, parent: "Yorkshire" },
  { name: "London", lat: 51.507, lon: -0.128, span: 12, parent: "England" },
  { name: "York", lat: 53.96, lon: -1.08, span: 12, parent: "Yorkshire", match: /(?<!New )\bYork\b/ },
  { name: "Paris", lat: 48.857, lon: 2.352, span: 14, parent: "France" },
  { name: "Montpellier", lat: 43.61, lon: 3.877, span: 14, parent: "France" },
];
const byName = new Map(PLACES.map((p) => [p.name, p]));
const pattern = (p: Place) => p.match ?? new RegExp(`\\b${p.name}\\b`);

/** Места сцены. Более общее место убирается, если названо более точное внутри него: Монпелье вместо Франции. */
export function placesIn(text: string): Place[] {
  const found = PLACES.filter((p) => pattern(p).test(text));
  const ancestors = new Set<string>();
  for (const p of found) for (let up = p.parent; up; up = byName.get(up)?.parent) ancestors.add(up);
  return found.filter((p) => !ancestors.has(p.name));
}

// ---------- время ----------
const WORDS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth"];
const ORDINAL = `(?:${WORDS.join("|")}|\\d{1,2}(?:st|nd|rd|th))`;
const centuryNumber = (s: string) => { const n = WORDS.indexOf(s.toLowerCase()); return n >= 0 ? n + 1 : parseInt(s, 10); };
const RANGE = new RegExp(`\\b(${ORDINAL})(?:[- ]century)?\\s+(?:and|to|through)\\s+(?:the\\s+)?(${ORDINAL})[- ]centur(?:y|ies)\\b`, "i");
const SINGLE = new RegExp(`\\b(${ORDINAL})[- ]century\\b`, "i");
const YEARS = /\b(?:from|between)\s+(1\d{3})\s+(?:to|and|until)\s+(1\d{3})\b/i;
const YEAR = /\b(?:in|since|until|around|by)\s+(1\d{3})\b/i;

export type TimeSpan = { unit: "century" | "year"; from: number; to: number };
export function timeIn(text: string): TimeSpan | null {
  let m = RANGE.exec(text);
  if (m) { const from = centuryNumber(m[1]), to = centuryNumber(m[2]); return from <= to ? { unit: "century", from, to } : null; }
  if ((m = SINGLE.exec(text))) { const n = centuryNumber(m[1]); return { unit: "century", from: n, to: n }; }
  if ((m = YEARS.exec(text))) { const from = +m[1], to = +m[2]; return from <= to ? { unit: "year", from, to } : null; }
  if ((m = YEAR.exec(text))) return { unit: "year", from: +m[1], to: +m[1] };
  return null;
}

export type GraphicSpec = { kind: "map"; places: string[] } | ({ kind: "timeline" } & TimeSpan);
/** Одна графика на сцену; дата важнее места, потому что её сложнее показать картинкой. */
export function findCandidates(rows: { n: number; text: string }[]) {
  return rows.flatMap((r): { scene: number; text: string; spec: GraphicSpec }[] => {
    const time = timeIn(r.text);
    if (time) return [{ scene: r.n, text: r.text, spec: { kind: "timeline", ...time } }];
    const places = placesIn(r.text);
    return places.length ? [{ scene: r.n, text: r.text, spec: { kind: "map", places: places.map((p) => p.name) } }] : [];
  });
}

// ---------- рисование ----------
const INK = "#4a3a26", PAPER = "#eadcbd", SEA = "#b7c3bb", RED = "#8c2f23";
const FONT = "Georgia, 'Times New Roman', serif";
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const svgDoc = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * 2}" viewBox="0 0 ${W} ${H}"><defs><radialGradient id="v" cx="50%" cy="50%" r="75%"><stop offset="55%" stop-color="#3a2a14" stop-opacity="0"/><stop offset="100%" stop-color="#3a2a14" stop-opacity="0.38"/></radialGradient></defs>${body}<rect width="${W}" height="${H}" fill="url(#v)"/><rect x="26" y="26" width="${W - 52}" height="${H - 52}" fill="none" stroke="${INK}" stroke-width="4"/><rect x="38" y="38" width="${W - 76}" height="${H - 76}" fill="none" stroke="${INK}" stroke-width="1.5"/></svg>`;
const label = (x: number, y: number, text: string, size: number, anchor = "start") => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${FONT}" font-size="${size}" font-weight="700" text-anchor="${anchor}" fill="${INK}" stroke="${PAPER}" stroke-width="10" stroke-linejoin="round" paint-order="stroke">${xml(text)}</text>`;

/** Центр и ширина кадра: одно место — точно по центру, поэтому приближение идёт к маркеру. */
export function mapView(places: Place[]) {
  const lats = places.map((p) => p.lat), lons = places.map((p) => p.lon);
  const lat = (Math.min(...lats) + Math.max(...lats)) / 2, lon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const latRange = (Math.max(...lats) - Math.min(...lats)) / Math.cos((lat * Math.PI) / 180) / (H / W);
  return { lat, lon, span: Math.max(...places.map((p) => p.span), (Math.max(...lons) - Math.min(...lons)) * 2.2, latRange * 2.2) };
}

type Land = Parameters<ReturnType<typeof geoPath>>[0];
let land: Land | null = null;
async function loadLand(): Promise<Land> {
  if (land) return land;
  const file = createRequire(import.meta.url).resolve("world-atlas/land-50m.json");
  const topology = JSON.parse(await fs.readFile(file, "utf8"));
  land = feature(topology, topology.objects.land) as unknown as Land;
  return land;
}

export async function mapSvg(names: string[]): Promise<string> {
  const places = names.map((n) => { const p = byName.get(n); if (!p) throw new ApiError("VALIDATION", `Нет места: ${n}`); return p; });
  const view = mapView(places);
  const projection = geoMercator().center([view.lon, view.lat]).scale(W / ((view.span * Math.PI) / 180)).translate([W / 2, H / 2]).clipExtent([[0, 0], [W, H]]);
  const coast = geoPath(projection)(await loadLand()) ?? "";
  const marks = places.map((p) => {
    const [x, y] = projection([p.lon, p.lat]) as [number, number];
    const left = x > W * 0.72;
    if (p.region) return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="430" ry="260" fill="${RED}" fill-opacity="0.16" stroke="${RED}" stroke-width="5" stroke-dasharray="20 14"/>${label(x, y + 22, p.name, 72, "middle")}`;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="26" fill="${RED}" fill-opacity="0.28"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" fill="${RED}" stroke="${PAPER}" stroke-width="4"/>${label(left ? x - 44 : x + 44, y + 22, p.name, 64, left ? "end" : "start")}`;
  });
  return svgDoc(`<rect width="${W}" height="${H}" fill="${SEA}"/><path d="${coast}" fill="${PAPER}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>${marks.join("")}`);
}

const ordinal = (n: number) => { const r = n % 100; return `${n}${r >= 11 && r <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`; };
/** Шкала: века с запасом по одному с краёв; годы — круглыми отметками. */
export function timelineModel(t: TimeSpan) {
  if (t.unit === "century") {
    const first = Math.max(t.from - 1, 1), last = t.to + 1;
    return { min: (first - 1) * 100, max: last * 100, start: (t.from - 1) * 100, end: t.to * 100, ticks: Array.from({ length: last - first + 2 }, (_, i) => (first - 1 + i) * 100), tickLabels: Array.from({ length: last - first + 1 }, (_, i) => ({ at: (first - 1 + i) * 100 + 50, text: ordinal(first + i) })), title: t.from === t.to ? `${ordinal(t.from)} century` : `${ordinal(t.from)} – ${ordinal(t.to)} centuries` };
  }
  const pad = Math.max(Math.round((t.to - t.from) * 0.25), 5);
  const step = t.to - t.from + pad * 2 > 60 ? 20 : t.to - t.from + pad * 2 > 25 ? 10 : 5;
  const min = Math.floor((t.from - pad) / step) * step, max = Math.ceil((t.to + pad) / step) * step;
  const ticks = Array.from({ length: (max - min) / step + 1 }, (_, i) => min + i * step);
  return { min, max, start: t.from, end: t.to, ticks, tickLabels: ticks.map((at) => ({ at, text: String(at) })), title: t.from === t.to ? String(t.from) : `${t.from} – ${t.to}` };
}
export function timelineSvg(t: TimeSpan): string {
  const m = timelineModel(t), left = 180, right = W - 180, axis = 620;
  const x = (v: number) => left + ((v - m.min) / (m.max - m.min)) * (right - left);
  const from = x(m.start), width = Math.max(x(m.end) - from, 14);
  const ticks = m.ticks.map((v) => `<line x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" y1="${axis - 24}" y2="${axis + 24}" stroke="${INK}" stroke-width="4"/>`).join("");
  const size = m.tickLabels.length > 12 ? 30 : 38;
  const names = m.tickLabels.map((l) => `<text x="${x(l.at).toFixed(1)}" y="${axis + 90}" font-family="${FONT}" font-size="${size}" text-anchor="middle" fill="${INK}">${xml(l.text)}</text>`).join("");
  return svgDoc(`<rect width="${W}" height="${H}" fill="${PAPER}"/><text x="${W / 2}" y="340" font-family="${FONT}" font-size="104" font-weight="700" text-anchor="middle" fill="${INK}">${xml(m.title)}</text><rect x="${from.toFixed(1)}" y="${axis - 34}" width="${width.toFixed(1)}" height="68" fill="${RED}" fill-opacity="0.82"/><line x1="${left}" x2="${right}" y1="${axis}" y2="${axis}" stroke="${INK}" stroke-width="6"/>${ticks}${names}`);
}
export const specSvg = (spec: GraphicSpec) => (spec.kind === "map" ? mapSvg(spec.places) : Promise.resolve(timelineSvg(spec)));
export const specLabel = (spec: GraphicSpec) => (spec.kind === "map" ? `Карта: ${spec.places.join(", ")}` : `Таймлайн: ${timelineModel(spec).title}`);

// ---------- графика проекта ----------
export type GraphicStatus = "pending" | "accepted" | "rejected";
export type GraphicItem = { scene: number; text: string; spec: GraphicSpec; label: string; file: string; status: GraphicStatus };
export const GraphicEdit = z.object({ status: z.enum(["pending", "accepted", "rejected"]) }).strict();

export async function graphicsState(projectId: string): Promise<{ scanned: boolean; items: GraphicItem[] }> {
  const raw = await fs.readFile(projectFile(projectId, META), "utf8").catch(() => null);
  if (!raw) return { scanned: false, items: [] };
  try { return { scanned: true, items: (JSON.parse(raw) as { items: GraphicItem[] }).items }; } catch { return { scanned: false, items: [] }; }
}
async function save(projectId: string, items: GraphicItem[]) {
  const file = projectFile(projectId, META);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify({ items }), "utf8");
  await fs.rename(`${file}.tmp`, file);
}
const specKey = (spec: GraphicSpec) => crypto.createHash("sha256").update(JSON.stringify(spec)).digest("hex").slice(0, 12);

/** Находит сцены и рисует предложения. Решения автора сохраняются, если сцена и графика остались теми же. */
export async function scanGraphics(projectId: string) {
  const { board } = await visualState(projectId);
  if (!board) throw new ApiError("VALIDATION", "Раскадровки нет: сначала нарежьте сцены в разделе «Визуал».");
  const before = new Map((await graphicsState(projectId)).items.map((i) => [`${i.scene}:${specKey(i.spec)}`, i.status]));
  const dir = projectFile(projectId, FOLDER);
  await fs.mkdir(dir, { recursive: true });
  const items: GraphicItem[] = [];
  for (const c of findCandidates(board.rows)) {
    const key = specKey(c.spec), name = `${String(c.scene).padStart(3, "0")}-${key}.png`, target = path.join(dir, name);
    if (!await fs.stat(target).then((s) => s.size > 0, () => false)) {
      await sharp(Buffer.from(await specSvg(c.spec))).png().toFile(`${target}.tmp`);
      await fs.rename(`${target}.tmp`, target);
    }
    items.push({ ...c, label: specLabel(c.spec), file: `${FOLDER}/${name}`, status: before.get(`${c.scene}:${key}`) ?? "pending" });
  }
  const keep = new Set(items.map((i) => path.basename(i.file)));
  for (const f of await fs.readdir(dir)) if (!keep.has(f)) await fs.rm(path.join(dir, f), { force: true }).catch(() => {});
  await save(projectId, items);
  return { scanned: true, items };
}

export async function setGraphicStatus(projectId: string, scene: number, raw: z.input<typeof GraphicEdit>) {
  const { status } = GraphicEdit.parse(raw);
  const { items } = await graphicsState(projectId);
  if (!items.some((i) => i.scene === scene)) throw new ApiError("NOT_FOUND", `Для сцены ${scene} графики нет.`, 404);
  const next = items.map((i) => (i.scene === scene ? { ...i, status } : i));
  await save(projectId, next);
  return { scanned: true, items: next };
}

type Row = { n: number; start: number; end: number; picture: { file?: string; verdict?: "accepted" | "redo" }; clip: { file?: string; verdict?: "accepted" | "redo" }; graphic?: boolean };
/** Подтверждённая графика занимает место клипа этой сцены. Файл клипа остаётся на диске. */
export function applyGraphics(rows: Row[], items: Pick<GraphicItem, "scene" | "file" | "status">[]): Row[] {
  const accepted = new Map(items.filter((i) => i.status === "accepted").map((i) => [i.scene, i.file]));
  return rows.map((r) => { const file = accepted.get(r.n); return file ? { ...r, picture: { file }, clip: {}, graphic: true } : r; });
}
