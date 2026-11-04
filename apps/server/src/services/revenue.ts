import crypto from "node:crypto";
import fs from "node:fs/promises";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { dataPath } from "../lib/storage.js";
import { revenueSource } from "./ytAnalytics.js";
const DIR = "yt-revenue-runs", MAX_ROWS = 366, MAX_FILE = 2 * 1024 ** 2;
const Id = z.string().uuid();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(s + "T00:00:00Z"); return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s;
}, "Некорректная календарная дата");
export const RevenueInput = z.object({ title: z.string().trim().max(120).default(""), startDate: Day, endDate: Day }).strict().refine(
  v => v.startDate >= "2005-01-01" && v.startDate <= v.endDate && Date.parse(v.endDate) - Date.parse(v.startDate) <= 365 * 86400000,
  "Проверьте период: с 2005 года, начало не позже конца, до 366 дней включительно",
);
export type RevenueInputT = z.infer<typeof RevenueInput>;
const Num = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Money = z.number().finite().min(-1e12).max(1e12);
const Row = z.object({ day: Day, views: Num.int().nullable(), estimatedRevenue: Money.nullable(), estimatedAdRevenue: Money.nullable() }).strict();
const Stored = z.object({
 version: z.literal(1), id: Id, createdAt: z.string().datetime(), title: z.string().max(120),
 channel: z.object({ id: z.string().regex(/^UC[\w-]{22}$/), title: z.string().max(300) }).strict(),
 requested: z.object({ startDate: Day, endDate: Day }).strict(), source: z.literal("YouTube Analytics API"),
 dimensions: z.literal("day"), currency: z.literal("USD"), metrics: z.tuple([z.literal("views"),z.literal("estimatedRevenue"),z.literal("estimatedAdRevenue")]),
 rows: z.array(Row).max(MAX_ROWS), status: z.enum(["returned","empty"]), mayBeLimited: z.boolean(),
 totals: z.object({ returnedViews: Num.nullable(), returnedRevenue: Money.nullable(), returnedAdRevenue: Money.nullable() }).strict(),
 warnings: z.array(z.string().max(1000)).max(20),
}).strict().superRefine((v,c) => {
 if (!RevenueInput.safeParse({title:v.title,...v.requested}).success) c.addIssue({code:"custom",message:"Некорректный период"});
 if (v.rows.some((x,i) => x.day<v.requested.startDate || x.day>v.requested.endDate || i>0 && x.day<=v.rows[i-1].day)) c.addIssue({code:"custom",message:"Некорректный порядок или дата строк"});
 if (v.status !== (v.rows.length ? "returned":"empty") || v.mayBeLimited !== (v.rows.length===MAX_ROWS)) c.addIssue({code:"custom",message:"Некорректный статус"});
 const totals = [sum(v.rows.map(x=>x.views),true),sum(v.rows.map(x=>x.estimatedRevenue)),sum(v.rows.map(x=>x.estimatedAdRevenue))];
 if (JSON.stringify(totals)!==JSON.stringify([v.totals.returnedViews,v.totals.returnedRevenue,v.totals.returnedAdRevenue])) c.addIssue({code:"custom",message:"Суммы не совпадают со строками"});
});
export type RevenueRun = z.infer<typeof Stored>;
type RawReport = { columnHeaders?: { name: string }[]; rows?: unknown[][] };
function value(v: unknown, integer=false): number|null {
 if (typeof v!=="number" || !Number.isFinite(v) || (integer ? !Number.isSafeInteger(v)||v<0 : Math.abs(v)>1e12)) return null;
 return v;
}
function sum(xs:(number|null)[],integer=false):number|null {
 return !xs.length || xs.some(x=>x===null) ? null : value(xs.reduce<number>((a,b)=>a+b!,0),integer);
}
export function normalizeRevenue(input:RevenueInputT,channel:RevenueRun["channel"],raw:RawReport,now=new Date()):RevenueRun {
 input=RevenueInput.parse(input);
 const names=Array.isArray(raw?.columnHeaders)?raw.columnHeaders.map(x=>x?.name):undefined;
 const expected=["day","views","estimatedRevenue","estimatedAdRevenue"];
 if (!names || new Set(names).size!==names.length || !expected.every(n=>names.includes(n)) || raw.rows!==undefined&&!Array.isArray(raw.rows)) throw new ApiError("UPSTREAM","Неожиданные столбцы дохода YouTube. Отчёт не сохранён.",502);
 const rows=raw.rows??[];
 if(rows.length>MAX_ROWS) throw new ApiError("UPSTREAM","Ответ дохода превысил предел 366 строк. Отчёт не сохранён.",502);
 const seen=new Set<string>();
 const projected=rows.map(r=>{
  if(!Array.isArray(r)||r.length!==names.length) throw new ApiError("UPSTREAM","Повреждённая строка дохода. Отчёт не сохранён.",502);
  const day=r[names.indexOf("day")];
  if(!Day.safeParse(day).success || typeof day!=="string" || day<input.startDate || day>input.endDate || seen.has(day)) throw new ApiError("UPSTREAM","Некорректная, повторная или выходящая за период дата дохода. Отчёт не сохранён.",502);
  seen.add(day);
  return {day,views:value(r[names.indexOf("views")],true),estimatedRevenue:value(r[names.indexOf("estimatedRevenue")]),estimatedAdRevenue:value(r[names.indexOf("estimatedAdRevenue")])};
 }).sort((a,b)=>a.day.localeCompare(b.day));
 const warnings=[
  "Оценочный доход USD, не окончательная выплата YouTube и не прибыль. Возможны корректировки, включая отрицательные значения. Данные не включают рекламу, проданную и обслуживаемую партнёром.",
  "Доход от рекламы — часть общего оценочного дохода, а не дополнительная сумма. Эти показатели не складываются.",
  "Показаны суммы только возвращённых строк. Отсутствующие дни и значения неизвестны, не равны нулю; это не подтверждённый итог всего периода.",
  "Последние дни могут отсутствовать: YouTube ограничивает ответ последним днём доступности всех запрошенных метрик. Первая и последняя возвращённые даты не гарантируют полного покрытия или свежести. Часовой пояс Настроек не применяется.",
  "Снимок содержит приватные финансовые данные. Экспорт и общий ZIP передавайте только доверенным получателям. Нет автоматического переноса в калькулятор прибыли.",
 ];
 if(!projected.length) warnings.push("API не вернул строки. Доход и просмотры неизвестны, это не нулевой доход.");
 if(projected.some(x=>x.views===null||x.estimatedRevenue===null||x.estimatedAdRevenue===null)) warnings.push("Часть чисел отсутствует или некорректна: неполные суммы не вычислены.");
 const days=1+(Date.parse(input.endDate)-Date.parse(input.startDate))/86400000;
 if(projected.length<days) warnings.push("Не все запрошенные дни возвращены; пропуски не заполнялись нулями.");
 if(projected.length===MAX_ROWS) warnings.push("Достигнут предел 366 строк. Следующие страницы не загружались.");
 return Stored.parse({version:1,id:crypto.randomUUID(),createdAt:now.toISOString(),title:input.title||"Оценочный доход",channel,
 requested:{startDate:input.startDate,endDate:input.endDate},source:"YouTube Analytics API",dimensions:"day",currency:"USD",metrics:["views","estimatedRevenue","estimatedAdRevenue"],rows:projected,status:projected.length?"returned":"empty",mayBeLimited:projected.length===MAX_ROWS,
 totals:{returnedViews:sum(projected.map(x=>x.views),true),returnedRevenue:sum(projected.map(x=>x.estimatedRevenue)),returnedAdRevenue:sum(projected.map(x=>x.estimatedAdRevenue))},warnings});
}
export async function saveRevenue(input: RevenueInputT) {
  input = RevenueInput.parse(input);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (input.endDate > yesterday) throw new ApiError("VALIDATION", "Выберите период не позднее вчерашнего дня UTC. Недавние данные API всё равно могут быть неполными.", 400);
  const { channel, result } = await revenueSource(input);
  const run = normalizeRevenue(input, channel, result);
  await checkDir();
  await fs.mkdir(dataPath(DIR), {recursive:true,mode:0o700});
  await fs.writeFile(dataPath(DIR,`${run.id}.json`), JSON.stringify(run,null,2), {flag:"wx",mode:0o600}); return run;
}
async function checkDir() {
  try { const st = await fs.lstat(dataPath(DIR)); if (!st.isDirectory() || st.isSymbolicLink()) throw new ApiError("VALIDATION", "Папка дохода должна быть обычной папкой, не ссылкой"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
}
export async function loadRevenue(id: string) {
  Id.parse(id); await checkDir(); const file = dataPath(DIR, `${id}.json`);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE) throw new ApiError("VALIDATION", "Некорректный файл отчёта дохода");
    const parsed = Stored.safeParse(JSON.parse(await fs.readFile(file, "utf8")));
    if (!parsed.success || parsed.data.id !== id) throw new ApiError("VALIDATION", "Файл дохода повреждён или имеет другую версию");
    return parsed.data;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (e instanceof SyntaxError) throw new ApiError("VALIDATION", "Файл дохода содержит повреждённый JSON");
    throw e;
  }
}
export async function listRevenue() {
  await checkDir(); let files: string[];
  try { files = (await fs.readdir(dataPath(DIR))).filter(f => /^[0-9a-f-]{36}\.json$/i.test(f)); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { items: [], warnings: [] as string[] }; throw e; }
  if (files.length > 5000) throw new ApiError("VALIDATION", "История дохода превышает предел сканирования 5000 файлов. Сохраните резервную копию и обслужите папку вручную.", 413);
  const all: { id: string; title: string; createdAt: string; channel: RevenueRun["channel"]; requested: RevenueRun["requested"]; status: RevenueRun["status"]; rowCount: number; mayBeLimited: boolean }[] = []; let skipped = 0;
  for (const f of files) { try { const r = await loadRevenue(f.slice(0, -5)); if (r) all.push({ id: r.id, title: r.title, createdAt: r.createdAt, channel: r.channel, requested: r.requested, status: r.status, rowCount: r.rows.length, mayBeLimited: r.mayBeLimited }); else skipped++; } catch { skipped++; } }
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  return { items: all.slice(0, 50), warnings: skipped ? [`Пропущено недоступных или повреждённых файлов: ${skipped}. Они не удалены.`] : [] };
}
