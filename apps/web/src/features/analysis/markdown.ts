import type { Report } from "@/lib/types";
import { fmt, money } from "@/lib/format";

const SAT: Record<string, string> = { low: "Низкая", moderate: "Умеренная", high: "Высокая", extreme: "Экстремальная" };
const TREND: Record<string, string> = { growing: "Растёт", stable: "Стабилен", declining: "Падает" };

export function reportToMarkdown(r: Report): string {
  const L: string[] = [];
  const byId = new Map(r.videos.map((v) => [v.id, v]));
  L.push(`# Анализ канала: ${r.channel.title}`, "", `Дата: ${new Date(r.createdAt).toLocaleString("ru-RU")} · выборка: ${r.stats.sampleSize} видео`, "");
  L.push("## Метрики", `- Подписчики: ${fmt(r.channel.subscribers)}`, `- Средние просмотры: ${fmt(r.stats.avgViews)} (медиана ${fmt(r.stats.medianViews)})`, `- Вовлечённость: ${r.stats.engagement}%`, `- Виральность канала: ${r.stats.channelVirality}/10`, "");
  L.push(`## Доход (оценка)`, `${money(r.income.monthMin)} – ${money(r.income.monthMax)} в месяц (RPM $${r.income.rpm.min}–${r.income.rpm.max})`, "");
  L.push(`## Последние 30 дней`, `${fmt(r.windows.last30)} просмотров (${r.windows.growthPct}% к прошлым 30 дням), загрузок: ${r.windows.uploads30} / ${r.windows.uploadsPrev30}`, "");
  if (r.insights) {
    const n = r.insights.niche;
    L.push(`## Вердикт ниши: ${n.name}`, `Виральность ${n.virality}/10 · Спрос ${n.demand}/10 · Насыщенность: ${SAT[n.saturation]} · Тренд: ${TREND[n.trend]}`, "", ...n.bullets.map((b) => `- ${b.text}`), "", `**Итог:** ${n.entryVerdict}`, "");
    const d = r.insights.diagnosis;
    const sec = (t: string, a: string[]) => L.push(`### ${t}`, ...a.map((x) => `- ${x}`), "");
    L.push("## Диагноз канала"); sec("Почему растёт", d.whyGrowing); sec("Хиты и провалы", d.hitsVsFlops); sec("Ошибки", d.mistakes); sec("Востребованные ракурсы", d.angles);
    L.push("### План", ...d.plan.map((x, i) => `${i + 1}. ${x}`), "");
    L.push("## Топ-3 видео");
    for (const t of r.insights.top3) { const v = byId.get(t.videoId); if (v) L.push(`### ${v.title} — ${fmt(v.views)}`, ...t.reasons.map((x) => `- ${x}`), ""); }
  }
  L.push("## Теги", `Золотые: ${r.tags.golden.map((t) => t.tag).join(", ") || "—"}`, `Icebox: ${r.tags.icebox.map((t) => t.tag).join(", ") || "—"}`, "");
  r.outlierSets.forEach((set, i) => {
    L.push(`## Outlier-темы — набор ${i + 1}`);
    set.forEach((t, j) => L.push(`### ${j + 1}. ${t.title} (${t.score}/10, ${t.technique})`, t.why, ...t.howTo.map((h) => `- ${h}`), ""));
  });
  return L.join("\n");
}
