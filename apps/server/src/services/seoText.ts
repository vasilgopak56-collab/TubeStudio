const TRIG_RU: Record<string, string> = { curiosity: "Любопытство", urgency: "Срочность", emotion: "Эмоция", authority: "Авторитет", belonging: "Сопричастность" };
const COMMENT_RU: Record<string, string> = { controversial: "Спорное мнение", sensory: "Сенсорный хук", challenge: "Сценарий-вызов" };
/** SEO-пакет одним текстом (экспорт проекта, «Копировать всё») */
export function seoToText(d: any): string {
  const sel = (d.tags ?? []).filter((t: any) => t.selected).map((t: any) => t.tag);
  return [
    "# ЗАГОЛОВКИ", ...(d.titles ?? []).map((t: any, i: number) => `${i + 1}. ${t.title}  [${(t.triggers ?? []).map((x: string) => TRIG_RU[x] ?? x).join(", ")}]`),
    "", "# ОПИСАНИЕ", d.description?.full ?? "",
    "", "# ХЭШТЕГИ", (d.hashtags ?? []).join(" "),
    "", `# ТЕГИ (${sel.join(", ").length} симв.)`, sel.join(", "),
    "", "# КОММЕНТАРИИ ДЛЯ ЗАКРЕПА", ...(d.pinnedComments ?? []).map((c: any) => `[${COMMENT_RU[c.type] ?? c.type}] ${c.text}`),
  ].join("\n");
}
