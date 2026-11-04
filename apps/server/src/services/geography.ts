import crypto from "node:crypto";
import fs from "node:fs/promises";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { dataPath, writeJson } from "../lib/storage.js";
import { geographySource } from "./ytAnalytics.js";
const DIR = "yt-geography-runs", MAX_ROWS = 250, MAX_FILE = 2 * 1024 ** 2;
const Id = z.string().uuid();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(s + "T00:00:00Z"); return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s;
}, "Некорректная календарная дата");
export const GeographyInput = z.object({ title: z.string().trim().max(120).default(""), startDate: Day, endDate: Day }).strict().refine(
  v => v.startDate >= "2005-01-01" && v.startDate <= v.endDate && Date.parse(v.endDate) - Date.parse(v.startDate) <= 365 * 86400000,
  "Проверьте период: с 2005 года, начало не позже конца, до 366 дней включительно",
);
export type GeographyInputT = z.infer<typeof GeographyInput>;
const Num = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Row = z.object({ country: z.string().regex(/^[A-Z]{2}$/), views: Num.int().nullable(), minutes: Num.nullable(), sharePct: z.number().finite().min(0).max(100).nullable() }).strict();
const Stored = z.object({
  version: z.literal(1), id: Id, createdAt: z.string().datetime(), title: z.string().max(120),
  channel: z.object({ id: z.string().regex(/^UC[\w-]{22}$/), title: z.string().max(300) }).strict(),
  requested: z.object({ startDate: Day, endDate: Day }).strict(),
  source: z.literal("YouTube Analytics API"), dimensions: z.literal("country"),
  metrics: z.tuple([z.literal("views"), z.literal("estimatedMinutesWatched")]),
  rows: z.array(Row).max(MAX_ROWS), status: z.enum(["returned", "empty"]), mayBeLimited: z.boolean(),
  totals: z.object({ returnedViews: Num.nullable(), returnedMinutes: Num.nullable() }).strict(),
  warnings: z.array(z.string().max(1000)).max(20),
}).strict();
export type GeographyRun = z.infer<typeof Stored>;
type RawReport = { columnHeaders?: { name: string }[]; rows?: unknown[][] };
function value(v: unknown, integer = false) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > Number.MAX_SAFE_INTEGER || integer && !Number.isSafeInteger(v)) return null;
  return v;
}
function completeSum(values: (number | null)[]) {
  if (!values.length || values.some(v => v === null)) return null;
  return value(values.reduce<number>((a, b) => a + b!, 0));
}
/** Only documented metrics survive projection. Unknown numbers stay null, known zeros stay zero. */
export function normalizeGeography(input: GeographyInputT, channel: GeographyRun["channel"], raw: RawReport, now = new Date()): GeographyRun {
  input = GeographyInput.parse(input);
  const names = raw?.columnHeaders?.map(x => x?.name);
  if (!names || new Set(names).size !== names.length || !["country", "views", "estimatedMinutesWatched"].every(n => names.includes(n)) || raw.rows !== undefined && !Array.isArray(raw.rows))
    throw new ApiError("UPSTREAM", "Неожиданные столбцы географии YouTube. Отчёт не сохранён.", 502);
  const rows = raw.rows ?? [];
  if (rows.length > MAX_ROWS) throw new ApiError("UPSTREAM", "Ответ географии превысил предел 250 строк. Отчёт не сохранён.", 502);
  const seen = new Set<string>();
  const projected = rows.map(r => {
    if (!Array.isArray(r) || r.length !== names.length) throw new ApiError("UPSTREAM", "Повреждённая строка географии. Отчёт не сохранён.", 502);
    const country = r[names.indexOf("country")];
    if (typeof country !== "string" || !/^[A-Z]{2}$/.test(country) || seen.has(country)) throw new ApiError("UPSTREAM", "Некорректный или повторный код страны. Отчёт не сохранён.", 502);
    seen.add(country);
    return { country, views: value(r[names.indexOf("views")], true), minutes: value(r[names.indexOf("estimatedMinutesWatched")]), sharePct: null as number | null };
  }).sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || a.country.localeCompare(b.country));
  const returnedViews = completeSum(projected.map(r => r.views)), returnedMinutes = completeSum(projected.map(r => r.minutes));
  if (returnedViews !== null && returnedViews > 0) for (const row of projected) row.sharePct = Math.round(row.views! / returnedViews * 10000) / 100;
  const warnings = [
    "Это снимок ответа API для указанного канала и запрошенных календарных дат, а не данные в реальном времени. Часовой пояс Настроек к запросу не применяется.",
    "Последние дни могут отсутствовать из-за задержки YouTube. Фактическая последняя дата данных в этом отчёте не определена; конец запрошенного периода не подтверждает покрытие.",
    "Доли считаются только от возвращённых просмотров (включая ZZ), не от всех просмотров канала. Пропущенные страны не считаются нулевыми; суммы могут отличаться от других отчётов.",
    "ZZ — страна не определена YouTube. Отчёт не содержит язык аудитории, доход, CTR, города или результат A/B-тестирования.",
  ];
  if (!projected.length) warnings.push("API не вернул строки. Это не доказательство нулевых просмотров; суммы и доли неизвестны.");
  if (projected.some(r => r.views === null || r.minutes === null)) warnings.push("Часть чисел отсутствует или некорректна: показано «неизвестно». Неполная сумма и зависящие от неё доли не вычислены.");
  if (projected.length === MAX_ROWS) warnings.push("Достигнут предел 250 строк: ответ может быть неполным. Следующие страницы не загружались; доли относятся только к этому набору.");
  return Stored.parse({ version: 1, id: crypto.randomUUID(), createdAt: now.toISOString(), title: input.title || "География просмотров", channel,
    requested: { startDate: input.startDate, endDate: input.endDate }, source: "YouTube Analytics API", dimensions: "country", metrics: ["views", "estimatedMinutesWatched"],
    rows: projected, status: projected.length ? "returned" : "empty", mayBeLimited: projected.length === MAX_ROWS,
    totals: { returnedViews, returnedMinutes }, warnings });
}
export async function saveGeography(input: GeographyInputT) {
  input = GeographyInput.parse(input);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (input.endDate > yesterday) throw new ApiError("VALIDATION", "Выберите период не позднее вчерашнего дня UTC. Недавние данные API всё равно могут быть неполными.", 400);
  const { channel, result } = await geographySource(input);
  const run = normalizeGeography(input, channel, result);
  await checkDir();
  await writeJson(`${DIR}/${run.id}.json`, run); return run;
}
async function checkDir() {
  try { const st = await fs.lstat(dataPath(DIR)); if (!st.isDirectory() || st.isSymbolicLink()) throw new ApiError("VALIDATION", "Папка географии должна быть обычной папкой, не ссылкой"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
}
export async function loadGeography(id: string) {
  Id.parse(id); await checkDir(); const file = dataPath(DIR, `${id}.json`);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE) throw new ApiError("VALIDATION", "Некорректный файл отчёта географии");
    const parsed = Stored.safeParse(JSON.parse(await fs.readFile(file, "utf8")));
    if (!parsed.success || parsed.data.id !== id) throw new ApiError("VALIDATION", "Файл географии повреждён или имеет другую версию");
    return parsed.data;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (e instanceof SyntaxError) throw new ApiError("VALIDATION", "Файл географии содержит повреждённый JSON");
    throw e;
  }
}
export async function listGeography() {
  await checkDir(); let files: string[];
  try { files = (await fs.readdir(dataPath(DIR))).filter(f => /^[0-9a-f-]{36}\.json$/i.test(f)); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { items: [], warnings: [] as string[] }; throw e; }
  if (files.length > 5000) throw new ApiError("VALIDATION", "История географии превышает предел сканирования 5000 файлов. Сохраните резервную копию и обслужите папку вручную.", 413);
  const all: { id: string; title: string; createdAt: string; channel: GeographyRun["channel"]; requested: GeographyRun["requested"]; status: GeographyRun["status"]; rowCount: number; mayBeLimited: boolean }[] = []; let skipped = 0;
  for (const f of files) { try { const r = await loadGeography(f.slice(0, -5)); if (r) all.push({ id: r.id, title: r.title, createdAt: r.createdAt, channel: r.channel, requested: r.requested, status: r.status, rowCount: r.rows.length, mayBeLimited: r.mayBeLimited }); else skipped++; } catch { skipped++; } }
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  return { items: all.slice(0, 50), warnings: skipped ? [`Пропущено недоступных или повреждённых файлов: ${skipped}. Они не удалены.`] : [] };
}
