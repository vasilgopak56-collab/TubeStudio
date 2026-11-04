export type CoachRequest = { selection: { id: string; question: string; language: string }; system: string; user: string; hash: string };
export type CoachContext = { capturedAt: string; sources: { kind: "report" | "project"; id: string; title: string; savedAt: string }[]; data: Record<string, unknown>; warnings: string[] };
export type CoachMessage = { role: "user" | "assistant"; text: string; at: string; language?: string; model?: string };
export type CoachConversation = { version: 1; id: string; rootId: string; parentId?: string; title: string; createdAt: string; updatedAt: string; context: CoachContext; messages: CoachMessage[]; lastRequest?: CoachRequest };
export type CoachSources = { reports: { id: string; title: string; savedAt: string }[]; projects: { id: string; title: string; savedAt: string }[] };
export type CoachBrief = { id: string; rootId: string; title: string; updatedAt: string; turns: number; sources: string[] };
function exactBlock(text: string, language: string) {
  const fence = "`".repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), m => m[0].length + 1)));
  return `${fence}${language}\n${text}\n${fence}`;
}
export function coachMarkdown(c: CoachConversation) {
  return [`# ${c.title}`, `Снимок диалога: ${c.updatedAt}`, `Контекст закреплён: ${c.context.capturedAt}`, "Нет живого доступа к YouTube, внешней проверки фактов или выполнения действий.", ...c.context.sources.map(s => `Источник: ${s.kind === "report" ? "анализ" : "проект"} «${s.title}»; сохранён ${s.savedAt}; ID ${s.id}`), ...c.context.warnings.map(w => `Ограничение: ${w}`), ...(c.lastRequest ? ["## Точный запрос последнего ответа", "Сохранён только запрос последнего ответа этого снимка. Для предыдущих ответов откройте их снимки.", "Системные инструкции:", exactBlock(c.lastRequest.system, "text"), "Пользовательское сообщение (точная JSON-строка):", exactBlock(c.lastRequest.user, "json"), `SHA-256: ${c.lastRequest.hash}`] : ["Точный запрос не сохранён: старый снимок или диалог без ответов. Инструкции не восстанавливаются из текущего промпта."]), ...c.messages.flatMap(m => [`## ${m.role === "user" ? "Вы" : "AI Coach"}`, m.text, ...(m.model ? [`Модель: ${m.model}; язык: ${m.language ?? "—"}`] : [])])].join("\n\n");
}
