import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, History, MessageSquareText } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { useSettings } from "@/lib/queries";
import { CONTENT_LANGUAGES } from "@/lib/constants";
import { Button, Card, CopyButton, ErrorAlert, Input, Label, ProgressBar, SectionTitle, Select, Textarea, ToolHeader } from "@/components/ui";
import { coachMarkdown, type CoachRequest, type CoachBrief, type CoachConversation, type CoachSources } from "@/features/coach/types";
function download(filename: string, text: string, type: string) {
  const u = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement("a"); a.href = u; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000);
}
const date = (s: string) => new Date(s).toLocaleString("ru-RU");
export default function Coach() {
  const qc = useQueryClient(), settings = useSettings();
  const [hideJobError, setHideJobError] = useState(false);
  const [title, setTitle] = useState(""); const [reportId, setReportId] = useState(""); const [projectId, setProjectId] = useState("");
  const [current, setCurrent] = useState<CoachConversation | null>(null); const [question, setQuestion] = useState(""); const [language, setLanguage] = useState<string>(); const [showContext, setShowContext] = useState(false);
  const [preview, setPreview] = useState<CoachRequest | null>(null);
  const alive = useRef(true), epoch = useRef(0), localAbort = useRef<AbortController | null>(null);
  async function local<T>(path: string, json?: unknown) {
    localAbort.current?.abort(); const abort = new AbortController(); localAbort.current = abort;
    const token = ++epoch.current;
    try { const value = await api<T>(path, { signal: abort.signal, ...(json !== undefined ? { method: "POST", json } : {}) }); return { value, token, cancelled: abort.signal.aborted }; }
    catch (e) { if (abort.signal.aborted) return null; throw e; }
    finally { if (localAbort.current === abort) localAbort.current = null; }
  }
  const accept = (r: { token: number; cancelled: boolean } | null) => r && !r.cancelled && alive.current && r.token === epoch.current;
  const job = useJob<CoachConversation>("/coach/ask"); const running = job.status === "running";
  const sources = useQuery({ queryKey: ["coach-sources"], queryFn: () => api<CoachSources>("/coach/sources") });
  const history = useQuery({ queryKey: ["coach-runs"], queryFn: () => api<CoachBrief[]>("/coach/runs") });
  const create = useMutation({ mutationFn: () => local<CoachConversation>("/coach/conversations", { title, ...(reportId ? { reportId } : {}), ...(projectId ? { projectId } : {}) }), onSuccess: r => { if (!accept(r) || !r) return; setHideJobError(true); setCurrent(r.value); setQuestion(""); setPreview(null); setShowContext(true); void qc.invalidateQueries({ queryKey: ["coach-runs"] }); } });
  const open = useMutation({ mutationFn: (id: string) => local<CoachConversation>(`/coach/runs/${id}`), onSuccess: r => { if (!accept(r) || !r) return; setHideJobError(true); setCurrent(r.value); setQuestion(""); setPreview(null); setShowContext(false); } });
  const prep = useMutation({ mutationFn: (d: CoachRequest["selection"]) => local<CoachRequest>("/coach/preview", d), onSuccess: r => { if (accept(r) && r) setPreview(r.value); } });
  const busy = running || create.isPending || open.isPending || prep.isPending;
  useEffect(() => { alive.current = true; return () => { alive.current = false; ++epoch.current; localAbort.current?.abort(); void job.cancel(); }; }, [job.cancel]);
  useEffect(() => { if (alive.current && job.status === "done" && job.data) { setCurrent(job.data); setQuestion(""); setPreview(null); void qc.invalidateQueries({ queryKey: ["coach-runs"] }); } }, [job.status, job.data, qc]);
  const lang = language ?? settings.data?.contentLanguage ?? "ru";
  const matching = preview && current && preview.selection.id === current.id && preview.selection.question === question.trim() && preview.selection.language === lang;
  const turns = current?.messages.filter(m => m.role === "assistant").length ?? 0;
  return <div>
    <ToolHeader icon={MessageSquareText} title="AI Coach" eyebrow="CREATOR ADVISER" subtitle="Советы по сохранённому анализу канала и проекту: закреплённый контекст, история вопросов и ответов" />
    <Card className="mb-5"><SectionTitle>Новый диалог: выберите контекст</SectionTitle>
      <p className="mb-4 text-sm text-muted-foreground">Выберите до одного анализа и проекта из последних 50. Создание диалога локальное и без AI. Сначала покажем точный контекст; в модель он уйдёт только по кнопке «Отправить в AI».</p>
      {sources.isError && <ErrorAlert error={sources.error} />}
      <div className="space-y-4"><label className="block"><Label>Название диалога</Label><Input aria-label="Название диалога" value={title} maxLength={120} onChange={e => setTitle(e.target.value)} placeholder="Например: план развития канала" /></label>
        <div className="grid gap-4 md:grid-cols-2"><label className="min-w-0"><Label>Сохранённый анализ канала</Label><Select aria-label="Сохранённый анализ канала" value={reportId} onChange={e => setReportId(e.target.value)} disabled={busy || sources.isPending}><option value="">Без анализа</option>{sources.data?.reports.map(s => <option key={s.id} value={s.id}>{s.title} · {date(s.savedAt)}</option>)}</Select></label>
        <label className="min-w-0"><Label>Проект для контекста</Label><Select aria-label="Проект для контекста" value={projectId} onChange={e => setProjectId(e.target.value)} disabled={busy || sources.isPending}><option value="">Без проекта</option>{sources.data?.projects.map(s => <option key={s.id} value={s.id}>{s.title} · {date(s.savedAt)}</option>)}</Select></label></div>
        <p className="text-xs text-muted-foreground">Из анализа: сводка, до 5 видео, до 4 пунктов прежнего AI-плана. Из проекта: название, ниша и последний сценарий (до 12 000 символов). Файлы, аудио, картинки, ключи и OAuth не читаются для контекста. Без источников — общий разговор, не анализ канала.</p>
        <div className="flex flex-wrap gap-3"><Button disabled={busy || sources.isPending} onClick={() => create.mutate()}>Создать диалог с этим контекстом</Button><Button variant="ghost" disabled={busy || sources.isFetching} onClick={() => void sources.refetch()}>Обновить список источников</Button></div>
      </div>{create.isError && <div className="mt-3"><ErrorAlert error={create.error} /></div>}
      {current && <p className="mt-3 text-xs text-accent">Выборы сверху не меняют текущую переписку. Для нового состава источников создайте отдельный диалог; прежний останется в истории.</p>}
    </Card>
    {open.isError && <ErrorAlert error={open.error} />}
    {current && <div className="space-y-5" data-testid="coach-conversation">
      <Card><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-lg font-bold">{current.title}</h2><p className="mt-1 text-xs text-muted-foreground">Контекст закреплён {date(current.context.capturedAt)} · {turns}/8 ответов · снимок {date(current.updatedAt)}</p></div><Button variant="outline" size="sm" disabled={busy} onClick={() => { setCurrent(null); setQuestion(""); setPreview(null); }}>Закрыть диалог</Button></div>
        <ul className="my-3 list-disc space-y-1 pl-5 text-sm">{current.context.sources.length ? current.context.sources.map(s => <li key={s.kind + s.id} className="break-words">{s.kind === "report" ? "Анализ" : "Проект"}: {s.title} · сохранён {date(s.savedAt)}</li>) : <li>Без выбранных источников</li>}</ul>
        <ul className="list-disc space-y-1 pl-5 text-xs text-accent">{current.context.warnings.map((w,i) => <li key={i}>{w}</li>)}</ul>
        <Button className="mt-3" variant="ghost" size="sm" aria-expanded={showContext} onClick={() => setShowContext(!showContext)}>{showContext ? "Скрыть точный контекст" : "Показать точный контекст"}</Button>
        {showContext && <pre data-testid="coach-context" className="mt-3 max-h-[350px] overflow-y-auto whitespace-pre-wrap break-words rounded border p-3 text-xs">{JSON.stringify(current.context, null, 2)}</pre>}
      </Card>
      <Card><SectionTitle>Переписка</SectionTitle><p className="mb-4 text-xs text-muted-foreground">Coach не обновляет YouTube и не выполняет действия. Это советы модели, не внешняя проверка фактов. Источники и ранние AI-выводы могут быть неполными или устаревшими.</p>
        <div className="space-y-4" data-testid="coach-messages">{current.messages.length === 0 && <p className="text-sm text-muted-foreground">Проверьте контекст выше, задайте вопрос и подготовьте предпросмотр запроса.</p>}{current.messages.map((m,i) => <article key={i} data-testid={`coach-${m.role}`} className={`min-w-0 rounded-lg border p-4 ${m.role === "user" ? "bg-background" : "bg-primary/5"}`}><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{m.role === "user" ? "Вы" : "AI Coach"}</b><CopyButton text={m.text} label="Копировать" /></div><p className="whitespace-pre-wrap break-words text-sm leading-relaxed" dir="auto">{m.text}</p>{m.model && <p className="mt-3 break-all text-xs text-muted-foreground">Модель: {m.model} · язык {m.language}</p>}</article>)}</div>
        {running && <div className="mt-4"><ProgressBar value={job.pct} label={job.stage} /></div>}{job.error && !hideJobError && <div className="mt-4"><ErrorAlert error={job.error} /></div>}
        <form className="mt-5 space-y-3" onSubmit={e => { e.preventDefault(); setHideJobError(false); if (preview && matching && !busy && turns < 8) void job.start({ ...preview.selection, previewHash: preview.hash }); }}>
          <label className="block max-w-sm"><Label>Язык ответа</Label><Select aria-label="Язык ответа" value={lang} disabled={busy} onChange={e => { setLanguage(e.target.value); setPreview(null); }}>{CONTENT_LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}</Select></label>
          <Textarea aria-label="Вопрос AI Coach" label="Ваш вопрос" value={question} onChange={e => { setQuestion(e.target.value); setPreview(null); }} minLength={3} maxLength={4000} required disabled={busy || turns >= 8} placeholder="Какие три изменения стоит проверить в следующем выпуске и почему?" />
          <p className="text-xs text-muted-foreground">Отправка передаст провайдеру закреплённый контекст, всю переписку и вопрос. Возможны платные вызовы и резервные модели по общим настройкам бюджета. До 8 ответов и 60 000 символов общего запроса, без скрытого обрезания. Не отправляйте секреты или чужие приватные материалы.</p>
          {turns >= 8 && <p role="status" className="text-sm text-accent">Лимит 8 ответов достигнут. Создайте новый диалог; этот сохранён.</p>}
          {prep.isError && <ErrorAlert error={prep.error} />}
          <div className="flex flex-wrap gap-3"><Button type="button" variant="outline" disabled={busy || turns >= 8 || question.trim().length < 3} onClick={() => { setPreview(null); prep.mutate({ id: current.id, question: question.trim(), language: lang }); }}>Предпросмотр запроса</Button>{prep.isPending && <Button type="button" variant="outline" onClick={() => { ++epoch.current; localAbort.current?.abort(); setPreview(null); }}>Остановить предпросмотр</Button>}</div>
          {preview && <div className="min-w-0 space-y-3 rounded-lg border p-3" data-testid="coach-preview"><h3 className="font-semibold">Проверьте данные перед отправкой</h3><p className="text-sm text-muted-foreground">Локальный предпросмотр без AI: точные инструкции и сообщение с закреплённым контекстом, всей перепиской и вопросом. Изменение вопроса или языка требует нового предпросмотра; изменение промпта или диалога сервер проверит перед вызовом. Настройки провайдера и резервные модели действуют на момент отправки — это не обещание конкретной модели или стоимости.</p><pre data-testid="coach-exact-request" className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{JSON.stringify({ system: preview.system, user: preview.user }, null, 2)}</pre><CopyButton text={JSON.stringify(preview, null, 2)} label="Копировать предпросмотр" /></div>}
          <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy || turns >= 8 || !matching}>Отправить в AI</Button>{running && <Button type="button" variant="outline" onClick={() => void job.cancel()}>Остановить</Button>}</div>
        </form>
      </Card>
      <Card><SectionTitle>Запрос последнего ответа</SectionTitle>{current.lastRequest ? <><p className="mb-3 text-sm text-muted-foreground">Сохранены инструкции и точное пользовательское сообщение последнего ответа этого снимка, не всех ответов сразу. Они не зависят от последующего изменения промпта или удаления источников.</p><details><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Сохранённый точный запрос</summary><pre data-testid="coach-saved-request" className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{JSON.stringify(current.lastRequest, null, 2)}</pre></details></> : <p className="text-sm text-muted-foreground" data-testid="coach-request-unavailable">Точный запрос не сохранён: это старый снимок или диалог без ответов. Инструкции не восстанавливаются из текущего промпта.</p>}</Card>
      <Card><SectionTitle>Экспорт диалога</SectionTitle><div className="flex flex-wrap gap-3"><CopyButton text={coachMarkdown(current)} label="Копировать диалог" /><Button variant="outline" onClick={() => download(`coach-${current.id}.md`, coachMarkdown(current), "text/markdown;charset=utf-8")}><Download className="h-4 w-4" />Диалог Markdown</Button><Button variant="outline" onClick={() => download(`coach-${current.id}.json`, JSON.stringify(current,null,2), "application/json;charset=utf-8")}>Диалог JSON</Button></div><p className="mt-3 text-xs text-muted-foreground">JSON включает точный контекст, всю переписку и запрос последнего ответа, если он был сохранён. Храните приватно. История входит в общий ZIP-перенос данных.</p></Card>
    </div>}
    <Card className="mt-6"><SectionTitle icon={<History className="h-4 w-4" />}>История AI Coach</SectionTitle><p className="mb-3 text-xs text-muted-foreground">Последние 50 снимков, включая версии после каждого ответа. Старые файлы не удаляются. Открытие бесплатно. Ответ из старого снимка создаёт новую ветку, не перезаписывает более поздние версии.</p>{history.isError && <ErrorAlert error={history.error} />}{(history.isPending || open.isPending) && <p>Загрузка…</p>}{history.data?.length === 0 && <p className="text-sm text-muted-foreground">Диалогов пока нет.</p>}<div className="space-y-2">{history.data?.map(h => <button key={h.id} disabled={busy} onClick={() => open.mutate(h.id)} className="block w-full rounded border p-3 text-left text-sm hover:border-primary disabled:opacity-50"><b className="break-words">{h.title}</b><span className="ml-2 text-xs text-muted-foreground">{h.turns} ответов · {date(h.updatedAt)}</span><p className="mt-1 break-words text-xs text-muted-foreground">{h.sources.join(" · ") || "Без выбранных источников"}</p></button>)}</div></Card>
  </div>;
}
