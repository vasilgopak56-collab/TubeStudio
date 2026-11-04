import crypto from "node:crypto";
import fs from "node:fs/promises";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { dataPath } from "../lib/storage.js";

const DIR = "ab-test-runs", MAX_FILE = 64 * 1024;
const Id = z.string().uuid();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
 const d = new Date(s + "T00:00:00Z"); return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s;
}, "Некорректная календарная дата");
const Code = z.enum(["A", "B", "C"]);
const Variant = z.object({
 code: Code, title: z.string().trim().max(500), thumbnail: z.string().trim().max(500),
 startDate: Day.nullable(), endDate: Day.nullable(),
 impressions: z.number().int().min(0).max(1e12).nullable(), ctrPct: z.number().finite().min(0).max(100).nullable(),
 notes: z.string().trim().max(2000),
}).strict();
export const AbDraft = z.object({
 title: z.string().trim().min(1).max(120), channelRef: z.string().trim().max(200),
 videoId: z.string().regex(/^(?:[\w-]{11})?$/, "Введите ID видео из 11 символов, не URL, или оставьте поле пустым"),
 kind: z.enum(["title", "thumbnail", "both"]), mode: z.enum(["unknown", "simultaneous", "sequential"]),
 status: z.enum(["planned", "running", "finished"]), hypothesis: z.string().trim().max(2000),
 sourceNote: z.string().trim().max(1000), variants: z.array(Variant).min(2).max(3),
 decision: z.enum(["none", "inconclusive", "A", "B", "C"]), conclusion: z.string().trim().max(2000),
}).strict().superRefine((v, ctx) => {
 const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
 if (v.variants.some((x, i) => x.code !== ["A", "B", "C"][i])) issue(["variants"], "Нужны варианты A, B и при необходимости C в этом порядке");
 v.variants.forEach((x, i) => {
  if (v.kind !== "thumbnail" && !x.title) issue(["variants", i, "title"], "Укажите заголовок варианта");
  if (v.kind !== "title" && !x.thumbnail) issue(["variants", i, "thumbnail"], "Опишите обложку или укажите имя файла");
  if ((x.startDate === null) !== (x.endDate === null) || x.startDate && x.endDate && x.startDate > x.endDate) issue(["variants", i, "startDate"], "Укажите обе даты в правильном порядке либо оставьте обе пустыми");
  if (x.impressions === 0 && x.ctrPct !== null) issue(["variants", i, "ctrPct"], "При нулевых показах CTR не определён: оставьте его пустым");
 });
 if (v.decision !== "none" && v.status !== "finished") issue(["decision"], "Решение фиксируется только для завершённой проверки");
 if (["A", "B", "C"].includes(v.decision) && !v.variants.some(x => x.code === v.decision)) issue(["decision"], "Выбранного варианта нет в снимке");
 if (v.decision !== "none" && !v.conclusion) issue(["conclusion"], "Добавьте обоснование своего решения");
});
export const AbInput = z.object({ parentId: Id.nullable(), data: AbDraft }).strict();
const Stored = z.object({ version: z.literal(1), id: Id, experimentId: Id, parentId: Id.nullable(), createdAt: z.string().datetime(), source: z.literal("manual"), data: AbDraft }).strict().superRefine((v, ctx) => {
 if (v.parentId === v.id || (!v.parentId && v.id !== v.experimentId) || (v.parentId && v.id === v.experimentId)) ctx.addIssue({ code: "custom", message: "Повреждена связь версий" });
});
export type AbData = z.infer<typeof AbDraft>;
export type AbStored = z.infer<typeof Stored>;

/** Descriptive differences only. No inference of clicks, causal effect, significance or winner. */
export function describeAb(data: AbData) {
 const v = AbDraft.parse(data), comparisons: { left: string; right: string; ctrDifferencePp: number | null }[] = [];
 for (let i = 0; i < v.variants.length; i++) for (let j = i + 1; j < v.variants.length; j++) {
  const a = v.variants[i], b = v.variants[j];
  comparisons.push({ left: a.code, right: b.code, ctrDifferencePp: a.ctrPct === null || b.ctrPct === null ? null : Math.round((b.ctrPct - a.ctrPct) * 1e6) / 1e6 });
 }
 const warnings = [
  "Все сведения внесены вручную. TubeStudio не проверяет видео, канал, обложки, источник чисел или проведение эксперимента.",
  "Разница CTR — только разность введённых процентов (правый вариант минус левый), не статистическая значимость, причинный эффект или автоматический победитель. Даже большой объём показов не доказывает сопоставимость.",
  "Общий CTR видео нельзя приписывать отдельной обложке без отдельного отчёта по вариантам. Не подменяйте показы просмотрами; из округлённого CTR не восстанавливаются клики.",
 ];
 if (v.mode !== "simultaneous") warnings.push(v.mode === "sequential" ? "Последовательная смена вариантов не является рандомизированным A/B: время, трафик и аудитория могут различаться." : "Способ сравнения не указан: считать проверку рандомизированной нельзя.");
 if (v.variants.some(x => x.impressions === null || x.ctrPct === null)) warnings.push("Не все показы или CTR известны. Пустое поле — неизвестность, не ноль; отсутствующая разница не вычисляется.");
 if (v.variants.some(x => !x.startDate || !x.endDate)) warnings.push("Не все периоды наблюдений указаны. Часовой пояс и охват нужно проверить в исходном отчёте.");
 else if (new Set(v.variants.map(x => x.startDate + "/" + x.endDate)).size > 1) warnings.push("Периоды вариантов различаются. Прямое сопоставление процентов может вводить в заблуждение.");
 if (v.kind === "both") warnings.push("Менялись и заголовок, и обложка: выделить вклад одного изменения по этим записям нельзя.");
 if (!v.videoId || !v.channelRef) warnings.push("Видео или канал не указаны полностью. Это локальная запись, а не подтверждённая связь с OAuth.");
 if (v.decision !== "none") warnings.push("Итог — ручное решение автора записи, не автоматический вывод TubeStudio или подтверждение YouTube.");
 return { comparisons, warnings };
}
const project = (r: AbStored) => ({ ...r, ...describeAb(r.data) });
async function checkDir(create = false) {
 if (create) await fs.mkdir(dataPath(DIR), { recursive: true });
 try { const s = await fs.lstat(dataPath(DIR)); if (!s.isDirectory() || s.isSymbolicLink()) throw new ApiError("VALIDATION", "Папка A/B должна быть обычной папкой, не ссылкой"); }
 catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
}
export async function loadAb(id: string) {
 Id.parse(id); await checkDir(); const file = dataPath(DIR, id + ".json");
 try {
  const st = await fs.lstat(file);
  if (!st.isFile() || st.isSymbolicLink() || st.size > MAX_FILE) throw new ApiError("VALIDATION", "Некорректный файл A/B");
  const parsed = Stored.safeParse(JSON.parse(await fs.readFile(file, "utf8")));
  if (!parsed.success || parsed.data.id !== id) throw new ApiError("VALIDATION", "Снимок A/B повреждён или имеет другую версию");
  return project(parsed.data);
 } catch (e) {
  if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
  if (e instanceof SyntaxError) throw new ApiError("VALIDATION", "Снимок A/B содержит повреждённый JSON");
  throw e;
 }
}
export async function saveAb(raw: z.infer<typeof AbInput>) {
 const input = AbInput.parse(raw);
 const parent = input.parentId ? await loadAb(input.parentId) : null;
 if (input.parentId && !parent) throw new ApiError("NOT_FOUND", "Исходная версия A/B не найдена. Черновик не сохранён; выберите существующую версию или начните новую проверку.", 404);
 if (parent && ["videoId", "channelRef", "kind"].some(k => parent.data[k as keyof AbData] !== input.data[k as keyof AbData])) throw new ApiError("VALIDATION", "Канал, ID видео и тип проверки закреплены в цепочке. Для другого видео или типа начните новую проверку.", 409);
 const id = crypto.randomUUID();
 const run = Stored.parse({ version: 1, id, experimentId: parent?.experimentId ?? id, parentId: parent?.id ?? null, createdAt: new Date().toISOString(), source: "manual", data: input.data });
 await checkDir(true);
 // Exclusive create: never replace a previous snapshot, even if an ID collides.
 await fs.writeFile(dataPath(DIR, id + ".json"), JSON.stringify(run, null, 2), { encoding: "utf8", flag: "wx" });
 return project(run);
}
export async function listAb() {
 await checkDir(); let files: string[];
 try { files = (await fs.readdir(dataPath(DIR))).filter(f => /^[0-9a-f-]{36}\.json$/i.test(f)); }
 catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { items: [], warnings: [] as string[] }; throw e; }
 if (files.length > 5000) throw new ApiError("VALIDATION", "История A/B превышает предел сканирования 5000 файлов. Сделайте резервную копию и обслужите папку вручную.", 413);
 const all: { id: string; experimentId: string; parentId: string | null; createdAt: string; title: string; videoId: string; status: AbData["status"]; decision: AbData["decision"] }[] = []; let skipped = 0;
 for (const f of files) { try { const r = await loadAb(f.slice(0, -5)); if (r) all.push({ id: r.id, experimentId: r.experimentId, parentId: r.parentId, createdAt: r.createdAt, title: r.data.title, videoId: r.data.videoId, status: r.data.status, decision: r.data.decision }); else skipped++; } catch { skipped++; } }
 all.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
 return { items: all.slice(0, 50), warnings: skipped ? [`Пропущено недоступных или повреждённых файлов A/B: ${skipped}. Они не удалены.`] : [] };
}
