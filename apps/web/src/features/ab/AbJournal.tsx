import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, History } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, CopyButton, ErrorAlert, Input, Label, SectionTitle, Select, Textarea } from "@/components/ui";
import { abMarkdown, blank, variant, number, kindLabel, modeLabel, statusLabel, decisionLabel, type Draft, type Variant, type Run, type Brief } from "./model";
const when = (s: string) => new Date(s).toLocaleString("ru-RU");
function download(name: string, text: string, mime: string) { const url = URL.createObjectURL(new Blob([text], { type: mime })), a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export default function AbJournal() {
 const qc = useQueryClient();
 const [draft, setDraft] = useState<Draft>(blank), [baseline, setBaseline] = useState(() => JSON.stringify(blank())), [parentId, setParent] = useState<string | null>(null), [current, setCurrent] = useState<Run | null>(null);
 const history = useQuery({ queryKey: ["ab-runs"], queryFn: () => api<{ items: Brief[]; warnings: string[] }>("/my-analytics/ab/runs"), refetchOnWindowFocus: false, retry: false });
 const save = useMutation({ mutationFn: (input: { parentId: string | null; data: Draft }) => api<Run>("/my-analytics/ab/runs", { method: "POST", json: input }), onSuccess: r => { setCurrent(r); setDraft(structuredClone(r.data)); setBaseline(JSON.stringify(r.data)); setParent(r.id); void qc.invalidateQueries({ queryKey: ["ab-runs"] }); } });
 const open = useMutation({ mutationFn: (id: string) => api<Run>(`/my-analytics/ab/runs/${id}`), onSuccess: r => { setCurrent(r); save.reset(); } });
 const busy = save.isPending || open.isPending, dirty = JSON.stringify(draft) !== baseline;
 const edit = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(d => ({ ...d, [key]: value }));
 const patch = (i: number, value: Partial<Variant>) => setDraft(d => ({ ...d, variants: d.variants.map((v, n) => n === i ? { ...v, ...value } : v) }));
 const replace = (r: Run | null) => {
  if (dirty && !confirm("Заменить несохранённый черновик? Сохранённые снимки не изменятся.")) return;
  const d = r ? structuredClone(r.data) : blank(); setDraft(d); setBaseline(JSON.stringify(d)); setParent(r?.id ?? null); save.reset();
 };
 return <div className="space-y-5" data-testid="ab-journal">
  <Card className="space-y-3 p-5"><SectionTitle icon={<FlaskConical className="h-4 w-4" />}>Журнал A/B-проверок</SectionTitle>
   <p className="text-sm text-muted-foreground">План и результаты вариантов заголовка/обложки, внесённые вручную. Не запускает тест в YouTube, не меняет ролики и не запрашивает API или AI. OAuth не нужен. Обложка хранится как описание или имя файла: файлы и внешние изображения не загружаются.</p>
   <p className="text-xs text-muted-foreground">Разность CTR — не доказательство победы. Последовательные периоды, общий CTR видео и разные аудитории не заменяют эксперимент по вариантам. Пустые показатели остаются неизвестными; клики и статистическая значимость не вычисляются.</p>
  </Card>
  <Card className="space-y-4 p-5"><SectionTitle>{parentId ? "Новая версия проверки" : "Новая проверка"}</SectionTitle>
   <p className="break-all text-xs text-muted-foreground">{parentId ? `Основана на снимке ${parentId}. Сохранение создаёт новый файл, не перезаписывая исходник. Можно продолжать старый снимок: это отдельная ветка, не слияние с поздними версиями.` : "Сначала сохраните план с вариантами. Позже внесите числа из исходного отчёта и сохраните новую версию."}</p>
   <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (!busy) save.mutate({ parentId, data: draft }); }}>
    <fieldset disabled={busy} className="min-w-0 space-y-4">
     <label className="block"><Label>Название проверки *</Label><Input aria-label="A/B: название" maxLength={120} required value={draft.title} onChange={e => edit("title", e.target.value)} placeholder="Например: упаковка выпуска про Рим" /></label>
     <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <label className="min-w-0"><Label>Канал — вручную, необязательно</Label><Input aria-label="A/B: канал" maxLength={200} value={draft.channelRef} disabled={!!parentId} onChange={e => edit("channelRef", e.target.value)} placeholder="Название или ID, без проверки владения" /></label>
      <label className="min-w-0"><Label>ID видео — необязательно</Label><Input aria-label="A/B: ID видео" maxLength={11} minLength={11} value={draft.videoId} disabled={!!parentId} onChange={e => edit("videoId", e.target.value)} placeholder="11 символов, не ссылка" /></label>
      <label className="min-w-0"><Label>Что сравниваем</Label><Select aria-label="A/B: тип" value={draft.kind} disabled={!!parentId} onChange={e => { const kind = e.target.value as Draft["kind"]; setDraft(d => ({ ...d, kind, variants: d.variants.map(v => ({ ...v, ...(kind === "title" ? { thumbnail: "" } : kind === "thumbnail" ? { title: "" } : {}) })) })); }}>{Object.entries(kindLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
      <label className="min-w-0"><Label>Способ сравнения</Label><Select aria-label="A/B: режим" value={draft.mode} onChange={e => edit("mode", e.target.value as Draft["mode"])}>{Object.entries(modeLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
     </div>
     <label className="block"><Label>Гипотеза</Label><Textarea aria-label="A/B: гипотеза" rows={3} maxLength={2000} value={draft.hypothesis} onChange={e => edit("hypothesis", e.target.value)} placeholder="Что меняем и почему это может помочь?" /></label>
     <label className="block"><Label>Источник чисел и часовой пояс</Label><Textarea aria-label="A/B: источник" rows={2} maxLength={1000} value={draft.sourceNote} onChange={e => edit("sourceNote", e.target.value)} placeholder="Отчёт по вариантам, дата сверки, часовой пояс. Не вставляйте ключи и токены." /></label>
     <p className="text-xs text-muted-foreground">Канал, ID видео и тип закрепляются после первого сохранения (в том числе пустые поля). Для другого видео начните новую проверку. Календарные даты копируются из источника без преобразования часового пояса. Показы — не просмотры. Не переносите общий CTR ролика в каждый вариант. CTR может быть известен без числа показов, но оценить объём наблюдений тогда нельзя.</p>
     <div className="grid min-w-0 gap-4 xl:grid-cols-3">{draft.variants.map((v, i) => <div key={v.code} className="min-w-0 space-y-3 rounded border p-3" data-testid={`ab-variant-${v.code}`}>
      <h3 className="font-semibold">Вариант {v.code}</h3>
      {draft.kind !== "thumbnail" && <label className="block"><Label>Заголовок *</Label><Textarea aria-label={`A/B ${v.code}: заголовок`} rows={2} maxLength={500} required value={v.title} onChange={e => patch(i, { title: e.target.value })} /></label>}
      {draft.kind !== "title" && <label className="block"><Label>Обложка: описание / имя файла *</Label><Textarea aria-label={`A/B ${v.code}: обложка`} rows={2} maxLength={500} required value={v.thumbnail} onChange={e => patch(i, { thumbnail: e.target.value })} /></label>}
      <label className="block min-w-0"><Label>Начало наблюдения</Label><Input className="min-w-0 max-w-full" aria-label={`A/B ${v.code}: начало`} type="date" value={v.startDate ?? ""} max={v.endDate ?? undefined} onChange={e => patch(i, { startDate: e.target.value || null })} /></label>
      <label className="block min-w-0"><Label>Конец наблюдения</Label><Input className="min-w-0 max-w-full" aria-label={`A/B ${v.code}: конец`} type="date" value={v.endDate ?? ""} min={v.startDate ?? undefined} onChange={e => patch(i, { endDate: e.target.value || null })} /></label>
      <label className="block"><Label>Показы</Label><Input aria-label={`A/B ${v.code}: показы`} type="number" min={0} max={1e12} step={1} value={v.impressions ?? ""} placeholder="Неизвестно" onChange={e => patch(i, { impressions: e.target.value === "" ? null : Number(e.target.value) })} /></label>
      <label className="block"><Label>CTR, %</Label><Input aria-label={`A/B ${v.code}: CTR`} type="number" min={0} max={100} step="any" value={v.ctrPct ?? ""} placeholder="Неизвестно" onChange={e => patch(i, { ctrPct: e.target.value === "" ? null : Number(e.target.value) })} /></label>
      <label className="block"><Label>Заметки варианта</Label><Textarea aria-label={`A/B ${v.code}: заметки`} rows={2} maxLength={2000} value={v.notes} onChange={e => patch(i, { notes: e.target.value })} /></label>
     </div>)}</div>
     <Button type="button" variant="outline" onClick={() => setDraft(d => d.variants.length === 2 ? { ...d, variants: [...d.variants, variant("C")] } : { ...d, variants: d.variants.slice(0, 2), decision: d.decision === "C" ? "none" : d.decision })}>{draft.variants.length === 2 ? "Добавить вариант C" : "Убрать вариант C из черновика"}</Button>
     <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <label className="min-w-0"><Label>Статус</Label><Select aria-label="A/B: статус" value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value as Draft["status"], decision: e.target.value === "finished" ? d.decision : "none" }))}>{Object.entries(statusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
      <label className="min-w-0"><Label>Ручное решение автора</Label><Select aria-label="A/B: решение" value={draft.decision} disabled={draft.status !== "finished"} onChange={e => edit("decision", e.target.value as Draft["decision"])}><option value="none">Решение не принято</option><option value="inconclusive">Недостаточно оснований</option>{draft.variants.map(v => <option key={v.code} value={v.code}>Вручную выбран {v.code}</option>)}</Select></label>
     </div>
     <label className="block"><Label>Обоснование / дальнейшие действия</Label><Textarea aria-label="A/B: вывод" rows={3} maxLength={2000} required={draft.decision !== "none"} value={draft.conclusion} onChange={e => edit("conclusion", e.target.value)} placeholder="Почему приняли решение и какие ограничения остались?" /></label>
     <div className="flex flex-wrap gap-3"><Button type="submit">{save.isPending ? "Сохраняю…" : "Сохранить снимок A/B"}</Button><Button type="button" variant="outline" onClick={() => replace(null)}>Начать новую проверку</Button></div>
    </fieldset>
    {save.isError && <ErrorAlert error={save.error} />}
   </form>
  </Card>
  {open.isError && <ErrorAlert error={open.error} />}
  {current && <Card className="min-w-0 space-y-4 p-5" data-testid="ab-result"><SectionTitle>{current.data.title}</SectionTitle>
   <p className="text-sm">{kindLabel[current.data.kind]} · {statusLabel[current.data.status]} · {modeLabel[current.data.mode]}</p>
   <p className="break-words text-sm">Канал (введён вручную): {current.data.channelRef || "не указан"} · видео: {current.data.videoId || "не указано"}</p>
   <p className="break-all text-xs text-muted-foreground">Снимок {current.id} · {when(current.createdAt)} · проверка {current.experimentId} · предыдущая версия: {current.parentId ?? "нет"}. Экспортируется этот сохранённый снимок, не черновик.</p>
   <p className="whitespace-pre-wrap break-words text-sm">Гипотеза: {current.data.hypothesis || "не указана"}</p>
   <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">Источник / часовой пояс: {current.data.sourceNote || "не указан"}</p>
   <div className="grid min-w-0 gap-3 md:grid-cols-3">{current.data.variants.map(v => <div key={v.code} className="min-w-0 space-y-2 rounded border p-3" data-testid={`ab-saved-${v.code}`}><b>Вариант {v.code}</b>{v.title && <p className="whitespace-pre-wrap break-words text-sm">Заголовок: {v.title}</p>}{v.thumbnail && <p className="whitespace-pre-wrap break-words text-sm">Обложка: {v.thumbnail}</p>}<p className="text-xs">{v.startDate ?? "дата неизвестна"} — {v.endDate ?? "дата неизвестна"}</p><p className="text-sm">Показы: {number(v.impressions)} · CTR: {v.ctrPct === null ? "неизвестно" : number(v.ctrPct) + "%"}</p><p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{v.notes}</p></div>)}</div>
   <div data-testid="ab-comparison"><b>Разница введённых CTR</b>{current.comparisons.map(c => <p key={c.left + c.right} className="mt-1 text-sm">{c.right} − {c.left}: {c.ctrDifferencePp === null ? "неизвестно" : number(c.ctrDifferencePp) + " п.п."}</p>)}</div>
   <p className="text-sm"><b>Ручной итог: {decisionLabel(current.data.decision)}</b></p><p className="whitespace-pre-wrap break-words text-sm">{current.data.conclusion || "Обоснование не указано."}</p>
   <ul className="list-disc space-y-2 pl-5 text-xs text-muted-foreground">{current.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
   <p className="text-xs text-muted-foreground">История и экспорт могут содержать приватные показатели. Передавайте их только доверенным получателям. MCP и разрешения расширения этим разделом не расширяются.</p>
   <div className="flex flex-wrap gap-3">{current.parentId && <Button variant="outline" disabled={busy} onClick={() => open.mutate(current.parentId!)}>Открыть предыдущую версию</Button>}{current.experimentId !== current.id && <Button variant="outline" disabled={busy} onClick={() => open.mutate(current.experimentId)}>Открыть начало проверки</Button>}<Button variant="outline" disabled={busy} onClick={() => replace(current)}>Продолжить этот снимок</Button><CopyButton label="Копировать A/B" text={abMarkdown(current)} /><Button variant="outline" onClick={() => download(`ab-${current.id}.md`, abMarkdown(current), "text/markdown;charset=utf-8")}>A/B Markdown</Button><Button variant="outline" onClick={() => download(`ab-${current.id}.json`, JSON.stringify(current, null, 2), "application/json;charset=utf-8")}>A/B JSON</Button></div>
  </Card>}
  <Card className="space-y-3 p-5" data-testid="ab-history"><SectionTitle icon={<History className="h-4 w-4" />}>История A/B</SectionTitle><p className="text-xs text-muted-foreground">Последние 50 снимков, включая версии и отдельные ветки. Поздние изменения не дописываются в старый снимок. Старые файлы не удаляются; каталог входит в общий ZIP-перенос. Открытие истории не меняет черновик.</p>
   {history.isPending && <p>Читаю историю…</p>}{history.isError && <ErrorAlert error={history.error} onRetry={() => void history.refetch()} />}{history.data?.warnings.map((w, i) => <p key={i} role="status" className="text-xs text-accent">{w}</p>)}{history.data?.items.length === 0 && <p className="text-sm text-muted-foreground">Проверок пока нет.</p>}
   {history.data?.items.map(r => <button type="button" key={r.id} disabled={busy} onClick={() => open.mutate(r.id)} className="block w-full min-w-0 break-words rounded border p-3 text-left text-sm hover:border-primary"><b>{r.title}</b><p className="mt-1 text-xs text-muted-foreground">{statusLabel[r.status]} · {decisionLabel(r.decision)} · {when(r.createdAt)}</p><p className="mt-1 break-all text-xs text-muted-foreground">{r.videoId || "Без ID видео"} · {r.parentId ? "Версия" : "Начало"} · {r.id}</p></button>)}
  </Card>
 </div>;
}
