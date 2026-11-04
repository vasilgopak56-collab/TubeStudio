export type TranscriptSelection={id:string;mode:"summary"|"remix";language:string;words:number;angle:string};
export type TranscriptPreview={selection:TranscriptSelection;sourceCreatedAt:string;system:string;user:string;hash:string};
export type TranscriptRun = {
  version: 1; id: string; parentId?: string; createdAt: string;
  source: { kind: "youtube" | "text" | "file"; title: string; url?: string; videoId?: string; channel?: string; language?: string; automatic?: boolean; availableLanguages?: string[]; filename?: string; format?: string };
  text: string; segments: { start: number | null; end: number | null; text: string }[]; warnings: string[];
  request?: TranscriptPreview;
  analysis?: { title: string; summary: string; keyPoints: string[]; outline: { heading: string; notes: string }[]; cautions: string[]; script: string; mode: "summary" | "remix"; model: string; language: string; requestedWords: number; scriptWords: number; angle: string };
};
export type TranscriptBrief = { id: string; createdAt: string; title: string; kind: string; mode: string; chars: number };
export const transcriptTime = (t: number) => `${Math.floor(t / 3600) ? `${Math.floor(t / 3600)}:` : ""}${String(Math.floor(t / 60) % 60).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
export function transcriptMarkdown(r: TranscriptRun) {
  const a = r.analysis;
  return [`# ${a?.title ?? r.source.title}`, `Снимок: ${r.createdAt}`, `Источник: ${r.source.url ?? r.source.filename ?? "Вставленный текст"}`, "Факты внешне не проверены. AI-результат требует проверки человеком.", ...r.warnings.map(w => `Предупреждение: ${w}`), "", ...(a ? [`## Краткий разбор`, a.summary, "## Основные мысли", ...a.keyPoints.map(p => `- ${p}`), "## Структура", ...a.outline.map(p => `### ${p.heading}\n${p.notes}`), "## Что проверить", ...a.cautions.map(p => `- ${p}`), ...(a.script ? ["## Новый сценарий", a.script] : []), `Модель: ${a.model}; язык: ${a.language}`, ...(r.request?["## Сохранённый AI-запрос",JSON.stringify(r.request,null,2)]:["Архивный AI-ответ: точный запрос не сохранён."])] : ["## Исходный транскрипт", r.text])].join("\n\n");
}
