import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Download, History } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { Button, Card, ErrorAlert, Input, ProgressBar, SectionTitle, ToolHeader } from "@/components/ui";
import type { VideoScoreReport, ScoreHistory } from "@/features/videoScore/types";
const num=(x:number|null)=>x===null?"Нет данных":x.toLocaleString("ru-RU",{maximumFractionDigits:2});
const date=(s:string)=>Number.isFinite(Date.parse(s))?new Date(s).toLocaleString("ru-RU"):"Дата недоступна";
function download(r:VideoScoreReport){const u=URL.createObjectURL(new Blob([JSON.stringify(r,null,2)],{type:"application/json;charset=utf-8"}));const a=document.createElement("a");a.href=u;a.download=`video-score-${r.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
export default function VideoScorecard(){
  const [sp,setSp]=useSearchParams(),qc=useQueryClient();
  const [video,setVideo]=useState(sp.get("v")??""),[baseline,setBaseline]=useState(true),[current,setCurrent]=useState<VideoScoreReport|null>(null);
  const job=useJob<VideoScoreReport,{video:string;baseline:boolean}>("/video-scorecard"),busy=job.status==="running",id=sp.get("run");
  const history=useQuery({queryKey:["video-score-runs"],queryFn:()=>api<ScoreHistory>("/video-score-runs"),refetchOnWindowFocus:false});
  const opened=useQuery({queryKey:["video-score-run",id],queryFn:()=>api<VideoScoreReport>(`/video-score-runs/${encodeURIComponent(id!)}`),enabled:!!id && current?.id!==id && !busy,retry:false,refetchOnWindowFocus:false});
  useEffect(()=>()=>{void job.cancel();},[job.cancel]);
  useEffect(()=>{if(opened.data && opened.data.id===id)setCurrent(opened.data);},[opened.data,id]);
  useEffect(()=>{if(job.status==="done" && job.data){setCurrent(job.data);setSp({run:job.data.id},{replace:true});void qc.invalidateQueries({queryKey:["video-score-runs"]});void qc.invalidateQueries({queryKey:["usage"]});}},[job.status,job.data]);
  return <div className="space-y-6 [&_button]:min-h-11 [&_input]:min-h-11" data-testid="video-scorecard">
    <ToolHeader icon={ClipboardCheck} title="Разбор видео по ссылке" eyebrow="// VIDEO SCORECARD" subtitle="Публичные метрики, прозрачная база Outlier и локальные проверки оформления. Без AI-оценки и скрытых показателей" />
    <Card className="space-y-4">
      <SectionTitle>Опубликованный ролик</SectionTitle>
      <form className="space-y-4" onSubmit={e=>{e.preventDefault();if(!busy)void job.start({video:video.trim(),baseline});}}>
        <label className="block space-y-2 text-sm font-medium">Ссылка YouTube или ID видео<Input aria-label="Ссылка YouTube или ID видео" placeholder="https://www.youtube.com/watch?v=…" value={video} onChange={e=>setVideo(e.target.value)} maxLength={2048} required disabled={busy} /></label>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" checked={baseline} disabled={busy} onChange={e=>setBaseline(e.target.checked)} />Сравнить с последними загрузками канала</label>
        <p className="max-w-3xl text-sm text-muted-foreground">{baseline?"До 4 базовых единиц квоты YouTube: видео, канал, страница загрузок, метаданные выборки.":"1 базовая единица квоты YouTube: метаданные видео."} Повторы и смена ключа могут увеличить расход. Нейросети не вызываются; каждый запуск получает свежие данные. Открытие истории не расходует квоту разбора. Общая диагностика ключей приложения может отдельно расходовать квоту.</p>
        <div className="flex flex-wrap items-center gap-3">{busy?<Button type="button" variant="danger" onClick={()=>void job.cancel()}>Остановить разбор</Button>:<Button type="submit" disabled={!video.trim()}>Разобрать видео</Button>}<Link className="inline-flex min-h-11 items-center text-sm text-primary hover:underline" to="/check/scorecard">Нужна проверка перед публикацией?</Link></div>
        {busy && <ProgressBar value={job.pct} label={job.stage} />}
        {job.error && <ErrorAlert error={job.error} />}
      </form>
    </Card>
    {opened.isFetching && <p role="status">Открываю локальный снимок…</p>}
    {opened.error && <ErrorAlert error={opened.error} />}
    {current?<div data-testid="video-score-result" className="space-y-5">
      {current.version===1&&<Card data-testid="video-score-legacy"><p className="font-semibold">Архив v1: происхождение базы ограничено</p><p className="mt-2 text-sm text-muted-foreground">Исходный порядок ID страницы и отдельные даты наблюдений не сохранены. Прежние данные не переписываются и не дополняются выдуманными исходниками; метрики рассчитаны по старой дате завершения.</p></Card>}
      <Card className="space-y-4">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row"><div className="min-w-0 w-full break-words sm:flex-1"><p className="mb-2 text-sm text-muted-foreground">Сохранённый снимок · {date(current.createdAt)}</p><h2 className="text-xl font-bold">{current.source.title||"Без заголовка"}</h2><p className="mt-1 text-sm text-muted-foreground">{current.source.channelTitle} · {current.source.id}</p></div><Button variant="outline" onClick={()=>download(current)}><Download className="h-4 w-4" />Снимок JSON</Button></div>
        {current.observations&&<div data-testid="video-score-observations" className="space-y-1 break-all rounded-md border border-border p-3 text-xs text-muted-foreground"><p>Снимок v2 · последовательные ответы API, UTC</p><p>Наблюдение цели: {current.observations.targetAt}</p><p>Канал: {current.observations.channelAt??"не получен"}</p><p>Страница загрузок: {current.observations.pageAt??"не получена"}</p><p>Счётчики выборки: {current.observations.sampleAt??"не запрашивались / не получены"}</p><p>Завершение: {current.createdAt}. Возраст и средний VPH цели считаются на дату её наблюдения, не завершения.</p></div>}
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground"><span>Публикация: {date(current.source.publishedAt)}</span><span>Длительность: {num(current.source.durationSec)}{current.source.durationSec===null?"":" с"}</span><span>Группа: {current.metrics.formatGroup??"нет данных"}</span><a href={`https://www.youtube.com/watch?v=${current.source.id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">Открыть на YouTube ↗</a></div>
        <div className="grid gap-3 min-[380px]:grid-cols-2 xl:grid-cols-3">{[
          ["Просмотры",num(current.metrics.views)], ["Лайки",num(current.metrics.likes)], ["Комментарии",num(current.metrics.comments)],
          ["Средний VPH за всё время",num(current.metrics.vph)], ["Вовлечение, %",num(current.metrics.engagement)], ["Outlier к медиане",current.metrics.outlier===null?"Нет данных":`${num(current.metrics.outlier)}×`]
        ].map(([label,value])=><div key={label} className="rounded-lg border border-border p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 break-words text-xl font-semibold tabular-nums [overflow-wrap:anywhere] sm:text-2xl" data-metric={label}>{value}</p></div>)}</div>
        <p className="text-sm text-muted-foreground">Нет данных ≠ ноль. Это зафиксированные публичные счётчики, не статистика в реальном времени. Новая ссылка в форме не меняет этот снимок или его экспорт.</p>
      </Card>
      <Card className="space-y-4">
        <SectionTitle>Откуда взялся Outlier</SectionTitle><p className="text-sm">{current.baselineNote}</p><p className="text-sm">В базе: <b>{current.baseline.sampleSize}</b> · медиана просмотров: <b>{num(current.baseline.median)}</b></p>
        {current.page&&<p className="text-sm text-muted-foreground" data-testid="video-score-page">Строк страницы API: {current.page.ids.length}. {current.page.hasMore?"API сообщил о следующей странице — она не загружалась.":"Следующая страница API не указана."} Отсутствующие метаданные сохраняют строку с «нет данных», не исчезают из снимка.</p>}
        {current.metrics.outlierReason&&<p className="text-sm font-medium" data-testid="outlier-unavailable">{current.metrics.outlierReason}</p>}
        {current.metrics.outlier===null && <p className="text-sm text-muted-foreground">Для расчёта нужны просмотры ролика, возраст от 48 часов, хотя бы 3 подходящих видео и медиана больше нуля. Недоступная база не заменяется средним по каналу.</p>}
        <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Выборка и исключения ({current.baseline.rows.length})</summary><ul className="divide-y divide-border">{current.baseline.rows.map((r,i)=><li key={`${r.id}-${i}`} data-testid="score-source-row" className="space-y-1 break-all py-3 text-sm"><p className="text-xs text-muted-foreground">{current.version===1?`Архивная строка ${i+1}`:`Строка ${i+1} страницы API`} · {r.metadata==="missing"?"метаданные не получены":current.version===1?"архивная запись":"метаданные получены"}</p><a className="text-primary hover:underline" href={`https://www.youtube.com/watch?v=${r.id}`} target="_blank" rel="noreferrer">{r.title||r.id}</a><p className="text-muted-foreground">{r.id} · канал: {r.channelId||"нет данных"} · длительность: {num(r.durationSec)}{r.durationSec===null?"":" с"}</p><p className="text-muted-foreground">{r.reason} · {num(r.views)} просмотров · {date(r.publishedAt)}</p></li>)}</ul>{!current.baseline.rows.length && <p className="text-sm text-muted-foreground">Выборка отсутствует.</p>}</details>
      </Card>
      <Card className="space-y-4"><SectionTitle>Оформление: локальные наблюдения</SectionTitle><div className="grid gap-4 md:grid-cols-3">{current.checks.map(c=><div key={c.label} className="rounded-lg border border-border p-4"><h3 className="font-semibold">{c.label} · {c.value}</h3><p className="mt-2 text-sm text-muted-foreground">{c.note}</p></div>)}</div><h3 className="font-semibold">Теги из API</h3><p className="break-words text-sm">{current.source.tags.length?current.source.tags.join(", "):"Теги не возвращены."}</p><details><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Описание из API</summary><p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{current.source.description||"Описание пусто."}</p></details></Card>
      <Card className="space-y-3"><SectionTitle>Методика и ограничения</SectionTitle><ul className="list-disc space-y-3 pl-5 text-sm text-muted-foreground">{current.notices.map(n=><li key={n}>{n}</li>)}</ul></Card>
    </div>:<Card><p className="font-semibold">Начните со ссылки на ролик</p><p className="mt-2 text-sm text-muted-foreground">Запрос метаданных для разбора отправляется только после нажатия «Разобрать видео». CTR и удержание здесь не появятся: для своих данных используйте «Моя аналитика».</p></Card>}
    <Card className="space-y-3"><SectionTitle icon={<History className="h-4 w-4" />}>Локальная история · последние 50</SectionTitle>{history.error && <ErrorAlert error={history.error} />}{!!history.data?.skipped && <p className="text-sm text-muted-foreground">Повреждённых или неподдерживаемых снимков пропущено: {history.data.skipped}.</p>}<ul className="max-h-80 space-y-2 overflow-auto">{history.data?.items.map(r=><li key={r.id}><button disabled={busy||opened.isFetching} onClick={()=>setSp({run:r.id})} className="w-full rounded-md border border-border p-3 text-left text-sm hover:bg-muted disabled:opacity-50"><span className="block break-words font-medium">{r.title||r.videoId}</span><span className="text-muted-foreground">{date(r.createdAt)}</span></button></li>)}</ul>{!history.isLoading && !history.data?.items.length && <p className="text-sm text-muted-foreground">Снимков пока нет.</p>}</Card>
  </div>;
}
