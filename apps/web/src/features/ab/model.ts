export type Variant = { code: "A" | "B" | "C"; title: string; thumbnail: string; startDate: string | null; endDate: string | null; impressions: number | null; ctrPct: number | null; notes: string };
export type Draft = {
 title: string; channelRef: string; videoId: string; kind: "title" | "thumbnail" | "both";
 mode: "unknown" | "simultaneous" | "sequential"; status: "planned" | "running" | "finished";
 hypothesis: string; sourceNote: string; variants: Variant[]; decision: "none" | "inconclusive" | "A" | "B" | "C"; conclusion: string;
};
export type Run = { version: 1; id: string; experimentId: string; parentId: string | null; createdAt: string; source: "manual"; data: Draft; comparisons: { left: string; right: string; ctrDifferencePp: number | null }[]; warnings: string[] };
export type Brief = Pick<Run, "id" | "experimentId" | "parentId" | "createdAt"> & Pick<Draft, "title" | "videoId" | "status" | "decision">;
export const variant = (code: Variant["code"]): Variant => ({ code, title: "", thumbnail: "", startDate: null, endDate: null, impressions: null, ctrPct: null, notes: "" });
export const blank = (): Draft => ({ title: "", channelRef: "", videoId: "", kind: "title", mode: "unknown", status: "planned", hypothesis: "", sourceNote: "", variants: [variant("A"), variant("B")], decision: "none", conclusion: "" });
export const statusLabel = { planned: "План", running: "Наблюдение", finished: "Завершено" };
export const decisionLabel = (s: Draft["decision"]) => s === "none" ? "Решение не принято" : s === "inconclusive" ? "Недостаточно оснований" : `Вручную выбран ${s}`;
export const kindLabel = { title: "Заголовки", thumbnail: "Обложки", both: "Заголовки и обложки" };
export const modeLabel = { unknown: "Не указан", simultaneous: "Одновременное сравнение (по данным источника)", sequential: "Последовательная смена" };
export const number = (n: number | null) => n === null ? "неизвестно" : n.toLocaleString("ru-RU", { maximumFractionDigits: 6 });
// User text stays text even when opened in a Markdown renderer.
const text = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_{}\[\]()#!|]/g, "\\$&").replace(/[\r\n]+/g, " ");
export function abMarkdown(r: Run) {
 const d = r.data;
 return `# ${text(d.title)}\n\nРучной журнал A/B, не результат автоматического эксперимента.\n\nСнимок: ${r.id}\nСоздан: ${r.createdAt}\nПроверка: ${r.experimentId}\nПредыдущая версия: ${r.parentId ?? "нет"}\nКанал (введён вручную): ${text(d.channelRef) || "не указан"}\nID видео: ${d.videoId || "не указан"}\nТип: ${kindLabel[d.kind]}\nРежим: ${modeLabel[d.mode]}\nСтатус: ${statusLabel[d.status]}\n\nГипотеза: ${text(d.hypothesis) || "не указана"}\nИсточник чисел / часовой пояс: ${text(d.sourceNote) || "не указан"}\n\n` + d.variants.map(v => `## Вариант ${v.code}\n\nЗаголовок: ${text(v.title) || "не указан"}\nОбложка (описание/имя файла): ${text(v.thumbnail) || "не указана"}\nПериод: ${v.startDate ?? "неизвестно"} — ${v.endDate ?? "неизвестно"}\nПоказы: ${number(v.impressions)}\nCTR: ${v.ctrPct === null ? "неизвестно" : number(v.ctrPct) + "%"}\nЗаметки: ${text(v.notes) || "нет"}\n`).join("\n") + "\n## Описательное сравнение\n\n" + r.comparisons.map(c => `${c.right} − ${c.left}: ${c.ctrDifferencePp === null ? "неизвестно" : number(c.ctrDifferencePp) + " п.п. CTR"}`).join("\n") + `\n\nРучной итог: ${decisionLabel(d.decision)}\nОбоснование: ${text(d.conclusion) || "не указано"}\n\n## Ограничения\n\n` + r.warnings.map(w => "- " + w).join("\n") + "\n";
}
