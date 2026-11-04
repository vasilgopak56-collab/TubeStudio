import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, History, X } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { useSettings } from "@/lib/queries";
import { CONTENT_LANGUAGES } from "@/lib/constants";
import { Button, Card, CopyButton, ErrorAlert, Input, Label, ProgressBar, SectionTitle, Select, Textarea, ToolHeader } from "@/components/ui";
import { transcriptMarkdown, transcriptTime, type TranscriptBrief, type TranscriptRun, type TranscriptPreview } from "@/features/transcripts/types";
function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Result({ r, onEdit, disabled }: { r: TranscriptRun; onEdit: () => void; disabled: boolean }) {
  const [shown, setShown] = useState(100); const a = r.analysis;
  return <div className="space-y-4" data-testid="transcript-result">
    <Card>
      <div className="flex flex-wrap justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-lg font-bold">{r.source.title}</h2><p className="mt-1 text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString("ru-RU")} · {r.text.length.toLocaleString("ru-RU")} символов · {r.segments.length} фрагментов · {r.source.language ?? r.source.format ?? "язык не задан"}{r.source.automatic ? " · автоматические субтитры" : ""}</p>{r.source.url && <a className="text-sm text-primary underline" href={r.source.url} target="_blank" rel="noreferrer">Открыть исходное видео ↗</a>}</div><Button variant="outline" onClick={() => download(`transcript-${r.id}.json`, JSON.stringify(r, null, 2), "application/json;charset=utf-8")}><Download className="h-4 w-4" />JSON</Button></div>
      <p className="mt-3 text-xs text-muted-foreground">Источник сохранён локально. Это текст субтитров или ваш ввод, не проверенная расшифровка аудио. История хранит отдельные снимки; AI не изменяет исходник.</p>
      {r.warnings.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-4 text-sm text-accent">{r.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
    </Card>
    {a && !r.request && <Card data-testid="transcript-legacy"><p className="text-sm text-muted-foreground">Архивный AI-ответ: точный запрос не сохранён. Инструкции и параметры провайдера не восстанавливаются задним числом.</p></Card>}
    {r.request && <Card data-testid="transcript-saved-request"><details><summary className="cursor-pointer py-3 font-semibold">Сохранённый AI-запрос</summary><p className="text-xs text-muted-foreground">Источник: {r.request.selection.id} · {r.request.sourceCreatedAt} · хеш {r.request.hash}</p><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({system:r.request.system,user:r.request.user},null,2)}</pre></details></Card>}
    {a && <Card data-testid="transcript-analysis">
      <h2 className="break-words text-lg font-bold">{a.title}</h2><p className="mt-1 text-xs text-muted-foreground">{a.mode === "remix" ? "Новый сценарий" : "Краткий разбор"} · {a.language} · модель {a.model}{a.mode === "remix" ? ` · ${a.scriptWords} слов при цели ~${a.requestedWords}` : ""}</p>
      <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{a.summary}</p>
      <h3 className="mt-4 text-sm font-bold">Основные мысли</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{a.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
      {a.outline.length > 0 && <><h3 className="mt-4 text-sm font-bold">Структура</h3><ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">{a.outline.map((p, i) => <li key={i}><b>{p.heading}</b><p className="text-muted-foreground">{p.notes}</p></li>)}</ol></>}
      <h3 className="mt-4 text-sm font-bold">Что требует проверки</h3><p className="mt-1 text-xs text-muted-foreground">Внешняя проверка фактов не выполнялась. Ошибки субтитров могут перейти в AI-ответ.</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{a.cautions.map((p, i) => <li key={i}>{p}</li>)}</ul>
      {a.script && <div className="mt-5"><SectionTitle>Новый сценарий</SectionTitle><Textarea aria-label="Новый сценарий — результат" readOnly value={a.script} className="min-h-[320px]" /><div className="mt-3 flex flex-wrap gap-3"><CopyButton text={a.script} label="Копировать сценарий" /><Button variant="outline" size="sm" onClick={() => download(`script-${r.id}.txt`, a.script, "text/plain;charset=utf-8")}>Сценарий TXT</Button></div></div>}
      <div className="mt-4 flex flex-wrap gap-3"><CopyButton text={transcriptMarkdown(r)} label="Копировать разбор" /><Button variant="outline" size="sm" onClick={() => download(`transcript-analysis-${r.id}.md`, transcriptMarkdown(r), "text/markdown;charset=utf-8")}>Разбор Markdown</Button></div>
    </Card>}
    <Card>
      <SectionTitle>Исходный транскрипт</SectionTitle><div className="mb-4 flex flex-wrap gap-3"><CopyButton text={r.text} label="Копировать исходник" /><Button variant="outline" size="sm" onClick={() => download(`transcript-${r.id}.txt`, r.text, "text/plain;charset=utf-8")}>Исходник TXT</Button><Button variant="ghost" size="sm" disabled={disabled} onClick={onEdit}>Редактировать как новый текст</Button></div>
      <div className="max-h-[450px] space-y-2 overflow-y-auto rounded border p-3 text-sm" data-testid="transcript-segments">{r.segments.slice(0, shown).map((s, i) => <div key={i} className="flex items-start gap-3">{s.start !== null && <span className="shrink-0 font-mono text-xs text-primary">{r.source.url ? <a href={`${r.source.url}&t=${Math.floor(s.start)}s`} target="_blank" rel="noreferrer">{transcriptTime(s.start)}</a> : transcriptTime(s.start)}</span>}<p className="min-w-0 whitespace-pre-wrap break-words">{s.text}</p></div>)}</div>
      {shown < r.segments.length && <Button size="sm" variant="ghost" onClick={() => setShown(n => n + 100)}>Показать ещё 100 фрагментов</Button>}
      <p className="mt-2 text-xs text-muted-foreground">Показано {Math.min(shown, r.segments.length)} из {r.segments.length}. TXT/JSON содержат весь сохранённый текст. Для вставленного обычного текста таймкоды не придумываются.</p>
    </Card>
  </div>;
}
export default function Transcripts() {
  const settings = useSettings(); const qc = useQueryClient();
  const [kind, setKind] = useState<"youtube" | "text" | "file">("youtube"); const [url, setUrl] = useState("");
  const [text, setText] = useState(""); const [title, setTitle] = useState(""); const [format, setFormat] = useState<"txt" | "srt" | "vtt">("txt");
  const [filename, setFilename] = useState(""); const [fileError, setFileError] = useState<Error | null>(null); const [reading, setReading] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState<string>(); const [language, setLanguage] = useState<string>();
  const [mode,setMode]=useState<"summary"|"remix">("summary");
  const [preview,setPreview]=useState<TranscriptPreview|null>(null);
  const [words, setWords] = useState(1000); const [angle, setAngle] = useState(""); const [current, setCurrent] = useState<TranscriptRun | null>(null);
  const job = useJob<TranscriptRun>("/transcripts"); const running = job.status === "running";
  const history = useQuery({ queryKey: ["transcript-runs"], queryFn: () => api<TranscriptBrief[]>("/transcript-runs") });
  const open = useMutation({ mutationFn: (id: string) => api<TranscriptRun>(`/transcript-runs/${id}`), onSuccess: setCurrent });
  const pre=useMutation({mutationFn:(input:object)=>api<TranscriptPreview>("/transcripts/preview",{method:"POST",body:JSON.stringify(input)}),onSuccess:setPreview});
  const busy = running || reading || open.isPending || pre.isPending;
  useEffect(()=>()=>{void job.cancel();},[job.cancel]);
  useEffect(()=>{setPreview(null);},[current?.id]);
  useEffect(() => { if (job.status === "done" && job.data) { setCurrent(job.data); void qc.invalidateQueries({ queryKey: ["transcript-runs"] }); } }, [job.status, job.data, qc]);
  const lang = language ?? settings.data?.contentLanguage ?? "ru", sourceLang = sourceLanguage ?? settings.data?.contentLanguage ?? "ru";
  const selection={id:current?.id??"",mode,language:lang,words,angle:angle.trim()};
  const previewReady=!!preview&&JSON.stringify(preview.selection)===JSON.stringify(selection);
  const canAnalyze = !!current && current.text.trim().length >= 100 && current.text.length <= 60000;
  const importSource = () => {
    setFileError(null);
    const input = kind === "youtube" ? { kind, url, language: sourceLang } : kind === "text" ? { kind, text, title, format } : { kind, text, filename, format };
    void job.start(input);
  };
  async function readFile(file?: File) {
    setFileError(null); setFilename(""); setText(""); if (!file) return;
    if (file.size > 1024 * 1024) { setFileError(new Error("Файл больше 1 МиБ. Разделите его на части.")); return; }
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !["txt", "srt", "vtt"].includes(ext)) { setFileError(new Error("Поддерживаются только TXT, SRT и VTT в UTF-8.")); return; }
    setReading(true);
    try { const content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); if (content.length > 300000) throw new Error("Текст длиннее 300 000 символов. Разделите файл."); setText(content); setFilename(file.name); setFormat(ext as typeof format); }
    catch (e) { setFileError(e instanceof TypeError ? new Error("Не удалось прочитать UTF-8. Пересохраните файл в UTF-8 и загрузите снова.") : e as Error); }
    finally { setReading(false); }
  }
  return <div data-testid="transcripts" className="space-y-5 [overflow-wrap:anywhere] [&_button]:min-h-11 [&_input]:min-h-11">
    <ToolHeader icon={FileText} title="Транскрипты" eyebrow="TRANSCRIPT → SUMMARY / REMIX" subtitle="Субтитры YouTube или ваш текст → краткий разбор и новый сценарий; исходник сохраняется отдельно" />
    <Card className="mb-5"><form className="space-y-4" onSubmit={e => { e.preventDefault(); importSource(); }}>
      <label className="block"><Label>Источник текста</Label><Select aria-label="Источник текста" disabled={busy} value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="youtube">Субтитры YouTube</option><option value="text">Вставить текст</option><option value="file">Файл TXT / SRT / VTT</option></Select></label>
      {kind === "youtube" ? <>
        <label className="block"><Label required>Ссылка на видео</Label><Input aria-label="Ссылка на видео" disabled={busy} placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={e => setUrl(e.target.value)} required minLength={3} maxLength={500} /></label>
        <label className="block"><Label>Язык субтитров</Label><Select aria-label="Язык субтитров" disabled={busy} value={sourceLang} onChange={e => setSourceLanguage(e.target.value)}>{CONTENT_LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}</Select></label>
        <p className="text-xs text-muted-foreground">Получение субтитров неофициальное: YouTube может блокировать доступ или изменить страницу. Только доступные публичные дорожки; без входа, обхода ограничений и автоматического перевода. Если не получилось, выберите вставку текста или файл. API-ключ YouTube не используется.</p>
      </> : <>
        {kind === "file" ? <label className="block"><Label required>Файл субтитров или текста</Label><input aria-label="Файл субтитров или текста" type="file" accept=".txt,.srt,.vtt" disabled={busy} onChange={e => void readFile(e.target.files?.[0])} className="block w-full max-w-full text-sm" /><p className="mt-2 text-xs text-muted-foreground">UTF-8, до 1 МиБ и 300 000 символов; текущий файл: {filename || "не выбран"}.</p></label> : <label className="block"><Label>Название исходника</Label><Input aria-label="Название исходника" disabled={busy} value={title} onChange={e => setTitle(e.target.value)} maxLength={300} /></label>}
        {kind === "text" && <label className="block"><Label>Формат вставленного текста</Label><Select aria-label="Формат вставленного текста" disabled={busy} value={format} onChange={e => setFormat(e.target.value as typeof format)}><option value="txt">Обычный текст (без таймкодов)</option><option value="srt">SRT</option><option value="vtt">WebVTT</option></Select></label>}
        <Textarea label="Текст источника" aria-label="Текст источника" disabled={busy} required value={text} maxLength={300000} onChange={e => setText(e.target.value)} readOnly={kind === "file"} className="min-h-[220px]" placeholder="Вставьте транскрипт или субтитры…" />
      </>}
      {fileError && <ErrorAlert error={fileError} />}
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy || (kind === "file" && !filename)}>{kind === "youtube" ? "Получить субтитры" : "Сохранить и разобрать текст"}</Button>{running && <Button type="button" variant="outline" onClick={() => void job.cancel()}><X className="h-4 w-4" />Остановить</Button>}</div>
      <p className="text-xs text-muted-foreground">Эта кнопка только получает/разбирает и сохраняет исходный текст. Нейросеть не вызывается.</p>
    </form></Card>
    {running && <ProgressBar value={job.pct} label={job.stage} />}{job.error && <ErrorAlert error={job.error} />}{open.isError && <ErrorAlert error={open.error} />}
    {current && <>
      <Card className="mb-5" data-testid="transcript-ai-controls"><SectionTitle>AI-разбор сохранённого источника</SectionTitle>
        <p className="mb-4 text-sm text-muted-foreground">Будет отправлен сохранённый источник «{current.source.title}», не несохранённый ввод сверху. Только по кнопкам ниже текст передаётся настроенному LLM-провайдеру; возможны платные сетевые повторы и резервные модели. Скрытое исправление JSON отключено.</p>
        <label className="mb-4 block"><Label>Задача AI</Label><Select aria-label="Задача AI" disabled={busy} value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="summary">Краткий разбор</option><option value="remix">Новый сценарий</option></Select></label>
        <div className="grid gap-4 md:grid-cols-2"><label><Label>Язык результата</Label><Select aria-label="Язык результата" disabled={busy} value={lang} onChange={e => setLanguage(e.target.value)}>{CONTENT_LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}</Select></label><label><Label>Цель сценария, слов</Label><Select aria-label="Цель сценария, слов" disabled={busy} value={words} onChange={e => setWords(Number(e.target.value))}>{[500, 1000, 1500, 2000, 3000].map(n => <option key={n} value={n}>{n}</option>)}</Select></label></div>
        <Textarea className="mt-3" label="Новый ракурс (для сценария)" aria-label="Новый ракурс (для сценария)" disabled={busy} value={angle} maxLength={1000} onChange={e => setAngle(e.target.value)} placeholder="Что объяснить иначе, кому адресовать, на чём сделать акцент…" />
        <p className="my-3 text-xs text-muted-foreground">Для AI: от 100 до 60 000 символов, без скрытого обрезания. Новый сценарий — самостоятельная переработка, не копия; точный объём не гарантируется. Факты требуют вашей проверки.</p>
        {!canAnalyze && <p role="status" className="mb-3 text-sm text-accent">Источник вне диапазона AI: сохраните отдельную часть длиной 100–60 000 символов.</p>}
        <Button variant="outline" disabled={busy||!canAnalyze} onClick={()=>pre.mutate(selection)}>Предпросмотр AI-запроса</Button>
        {pre.error&&<ErrorAlert error={pre.error}/>}
        {preview&&<div className="my-4 space-y-3 rounded-lg border p-3" data-testid="transcript-preview"><p className="text-sm">Показан весь сохранённый текст и сведения об источнике; прежний AI-ответ и несохранённый ввод не отправляются. Таймкоды отдельно не отправляются. Источник: {preview.selection.id}. Режим: {preview.selection.mode}. Роль модели: {preview.selection.mode==="remix"?"сценарная":"основная"}.</p><p className="text-xs text-muted-foreground">Передавайте только разрешённые материалы: личные сведения могут быть внутри текста. Предпросмотр без AI и сети YouTube; внешнего фактчекинга нет.</p><details><summary className="cursor-pointer py-3 text-sm font-semibold">Точный запрос: инструкции и исходник</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({system:preview.system,user:preview.user},null,2)}</pre></details>{!previewReady&&<p role="status" className="text-sm text-accent">Форма изменилась. Обновите предпросмотр: прежний запрос не будет отправлен.</p>}</div>}
        <div className="mt-4 flex flex-wrap gap-3"><Button disabled={busy||!canAnalyze||!previewReady||mode!=="summary"} onClick={()=>void job.start({...selection,previewHash:preview!.hash},"/transcripts/analyze")}>Краткий разбор (AI)</Button><Button variant="outline" disabled={busy||!canAnalyze||!previewReady||mode!=="remix"} onClick={()=>void job.start({...selection,previewHash:preview!.hash},"/transcripts/analyze")}>Новый сценарий (AI)</Button>{running&&<Button variant="ghost" onClick={()=>void job.cancel()}>Остановить AI-задачу</Button>}</div>
      </Card>
      <Result key={current.id} r={current} disabled={busy} onEdit={() => { setKind("text"); setText(current.text); setTitle(current.source.title); setFormat("txt"); window.scrollTo({ top: 0 }); }} />
    </>}
    <Card className="mt-6"><SectionTitle icon={<History className="h-4 w-4" />}>История транскриптов и разборов</SectionTitle><p className="mb-3 text-xs text-muted-foreground">Последние 50 снимков. Открытие бесплатно, без запросов YouTube/LLM. Входит в общий ZIP-перенос данных.</p>{history.isError && <ErrorAlert error={history.error} />}{(history.isPending || open.isPending) && <p role="status">Загрузка…</p>}{history.data?.length === 0 && <p className="text-sm text-muted-foreground">История пока пуста.</p>}<div className="space-y-2">{history.data?.map(h => <button key={h.id} disabled={busy} onClick={() => open.mutate(h.id)} className="block w-full rounded border p-3 text-left text-sm hover:border-primary disabled:opacity-50"><span className="break-words font-semibold">{h.title}</span><span className="ml-2 text-xs text-muted-foreground">{h.mode === "source" ? "исходник" : h.mode === "summary" ? "разбор" : "сценарий"} · {new Date(h.createdAt).toLocaleDateString("ru-RU")} · {h.chars} символов</span></button>)}</div></Card>
  </div>;
}
