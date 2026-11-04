import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, History, Users, X } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { useSettings } from "@/lib/queries";
import { CONTENT_LANGUAGES } from "@/lib/constants";
import { Button, Card, ErrorAlert, Input, Label, ProgressBar, SectionTitle, Select, Switch, ToolHeader } from "@/components/ui";
import type { NicheBrief, NicheForm, NicheRow, NicheRun } from "@/features/niches/types";

const number = (n: number | null) => n === null ? "неизвестно" : n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const usd = (n: number) => n.toLocaleString("ru-RU", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
function download(r: NicheRun) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: "application/json;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = `niche-${r.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Track({ row }: { row: NicheRow }) {
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: () => api("/competitors", { method: "POST", json: { channel: row.id } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["competitors"] }) });
  return <><Button size="sm" variant="outline" onClick={() => m.mutate()} loading={m.isPending} loadingText="Добавляю…" disabled={m.isSuccess}>{m.isSuccess ? "В трекере" : "В конкуренты"}</Button>{m.isError && <ErrorAlert error={m.error} />}</>;
}
function Evidence({ row }: { row: NicheRow }) {
  const e = row.evidence, b = row.basis;
  if (!e || !b) return <p className="mt-3 text-xs text-muted-foreground">Архив: исходные видео не закреплены. Старые расчёты нельзя проверить по этому снимку.</p>;
  return <details className="mt-4 rounded-lg border p-3 text-sm" data-testid="niche-evidence"><summary className="cursor-pointer font-semibold">База расчётов: {e.uploads.length} видео</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-muted-foreground">Оценено на {e.evaluatedAt}. {e.source === "fresh" ? "Запрошено без кеша." : "Кеш разрешён: счётчики могут быть старше времени расчёта (каналы до 6 ч, загрузки до 12 ч)."} Подписчики: {e.subscriberStatus === "known" ? "известны" : e.subscriberStatus === "hidden" ? "скрыты" : "нет данных"}. Дата создания канала: {e.channelPublishedAt || "неизвестна"}.</p>
      <p className="text-xs text-muted-foreground">Закреплены только возвращённые метаданные одной страницы загрузок. Недоступные videos.list строки здесь отсутствуют; это не полный список загрузок канала. Порядок — возвращённая выборка, не рейтинг.</p>
      <p>Просмотры: {row.mature} из {e.uploads.length} вошли в среднее/медиану. Настоящий ноль включается; неизвестное — нет.</p>
      <p>Частота: {b.frequency.count} видео; границы {b.frequency.first ?? "нет данных"} — {b.frequency.last ?? "нет данных"}; интервал {number(b.frequency.spanDays)} дней. {row.uploadsPerWeek === null ? "Частота неизвестна: нужны ≥2 даты и интервал ≥1 суток." : `(${b.frequency.count} − 1) × 7 / ${number(b.frequency.spanDays)} = ${number(row.uploadsPerWeek)} публикаций/неделю.`} Свежие видео и видео без просмотров участвуют в частоте, если подходят дата и группа длительности.</p>
      <details><summary className="cursor-pointer">Текстовая база совпадения</summary><p className="mt-2 whitespace-pre-wrap break-words text-xs">Название: {row.title}
Описание: {e.channelDescription || "нет"}
Также используются заголовки видео своего канала с уникальными ID, включая строки вне выбранной группы и с некорректной датой. Совпадение — подстрока уникального слова запроса, не семантика.</p></details>
      {e.uploadsState === "failed" && <p role="note">Загрузки не получены. Пустая база не означает, что у канала нет видео.</p>}
      {e.uploads.map((v, i) => <div key={i} className="min-w-0 rounded border p-3" data-testid="niche-source-video">
        <p className="break-words font-semibold">{i + 1}. {v.title}</p><p className="break-all text-xs text-muted-foreground">ID {v.id} · канал {v.channelId}</p>
        <p className="mt-2 text-xs">Дата: {v.publishedAt || "неизвестна"} · длительность: {number(v.durationSec)} с · просмотры: {number(v.views)}</p>
        <p className="mt-2 text-xs">В среднем/медиане: {b.entries[i].viewsIncluded ? "да" : "нет"}. В частоте: {b.entries[i].frequencyIncluded ? "да" : "нет"}.</p>
        {!!b.entries[i].reasons.length && <p className="mt-1 text-xs text-muted-foreground">{b.entries[i].reasons.join("; ")}.</p>}
        {/^[\w-]{11}$/.test(v.id) && <a className="mt-2 inline-block text-xs text-primary" href={`https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`} target="_blank" rel="noreferrer">Исходное видео ↗</a>}
      </div>)}
    </div>
  </details>;
}
function Results({ rows, saved }: { rows: NicheRow[]; saved: boolean }) {
  const [minimum, setMinimum] = useState(""); const [maximum, setMaximum] = useState(""); const [age, setAge] = useState("");
  const [sort, setSort] = useState("search");
  const filtered = rows.filter(r => (!minimum || (r.averageViews !== null && r.averageViews >= Number(minimum))) && (!maximum || (r.subscribers !== null && r.subscribers <= Number(maximum))) && (!age || (r.ageDays !== null && r.ageDays <= Number(age))));
  const key = sort as "averageViews" | "medianViews" | "uploadsPerWeek" | "textMatchPct";
  if (sort !== "search") filtered.sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1));
  return <div className="space-y-4" data-testid="niches-result">
    <Card>
      <SectionTitle>Фильтры полученной выборки</SectionTitle>
      <p className="mb-3 text-xs text-muted-foreground">Не запускают новые запросы. Неизвестные значения не проходят числовой фильтр.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label><Label>Средние просмотры от</Label><Input aria-label="Средние просмотры от" type="number" min="0" value={minimum} onChange={e => setMinimum(e.target.value)} /></label>
        <label><Label>Подписчики до</Label><Input aria-label="Подписчики до" type="number" min="0" value={maximum} onChange={e => setMaximum(e.target.value)} /></label>
        <label><Label>Возраст канала до, дней</Label><Input aria-label="Возраст канала до, дней" type="number" min="0" value={age} onChange={e => setAge(e.target.value)} /></label>
        <label><Label>Сортировка</Label><Select aria-label="Сортировка" value={sort} onChange={e => setSort(e.target.value)}><option value="search">Порядок поиска</option><option value="averageViews">Средние просмотры</option><option value="medianViews">Медиана просмотров</option><option value="uploadsPerWeek">Частота публикаций</option><option value="textMatchPct">Совпадение текста</option></Select></label>
      </div>
      <p className="mt-3 text-sm" role="status">Показано {filtered.length} из {rows.length}. {saved ? "Сравнение сохранено." : "Промежуточные данные — ещё не сохранены."}</p>
    </Card>
    {!filtered.length && <Card>Каналов по этим условиям нет. Измените фильтры или тему поиска.</Card>}
    <div className="grid items-start gap-4 xl:grid-cols-2">{filtered.map(r => <Card key={r.id} data-testid="niche-channel" className="min-w-0">
      <h3 className="break-words text-lg font-bold"><a href={`https://www.youtube.com/channel/${encodeURIComponent(r.id)}`} target="_blank" rel="noreferrer" className="hover:text-primary">{r.title}</a>{r.seed && <span className="ml-2 text-xs text-primary">Исходный канал</span>}</h3>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        {[["Подписчики", number(r.subscribers)], ["Возраст, дней", number(r.ageDays)], ["Средние просмотры", number(r.averageViews)], ["Медиана просмотров", number(r.medianViews)], ["Публикаций / неделю*", number(r.uploadsPerWeek)], ["Последняя загрузка, дней назад", number(r.lastUploadDays)], ["Совпадение текста*", `${r.textMatchPct}%`], ["Монетизация", "неизвестна"]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-semibold">{value}</dd></div>)}
      </dl>
      <details className="mt-4 text-sm"><summary className="cursor-pointer">Сценарий RPM — не фактический доход</summary><p className="mt-2">Условный доход среднего видео*: <b>{r.revenuePerVideo ? `${usd(r.revenuePerVideo.min)}–${usd(r.revenuePerVideo.max)}` : "неизвестно"}</b>. Не подтверждает монетизацию или выплаты.</p></details>
      <p className="mt-2 text-xs text-muted-foreground">Загрузок: {r.sampled}; выбранного типа с корректной датой: {r.selected}; видео старше 48 ч с известными просмотрами: {r.mature}.</p>
      {r.warnings.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-muted-foreground">{r.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
      <Evidence row={r} />
      <div className="mt-4 flex flex-wrap items-center gap-3"><Link className="text-sm text-primary underline" to={`/analysis?channel=${encodeURIComponent(r.id)}`}>Анализ канала →</Link>{saved && <Track row={r} />}</div>
    </Card>)}</div>
  </div>;
}
export default function Niches() {
  const settings = useSettings(); const qc = useQueryClient();
  const [f, setF] = useState<NicheForm>({ mode: "topic", q: "", channel: "", limit: 10, sample: 20, type: "all", force: false });
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [last, setLast] = useState<NicheRun | null>(null);
  const job = useJob<NicheRun, NicheForm>("/niches");
  const history = useQuery({ queryKey: ["niche-runs"], queryFn: () => api<NicheBrief[]>("/niche-runs") });
  const opened = useQuery({ queryKey: ["niche-run", openedId], queryFn: () => api<NicheRun>(`/niche-runs/${openedId}`), enabled: !!openedId });
  useEffect(() => { if (job.status === "done" && job.data) { setLast(job.data); void qc.invalidateQueries({ queryKey: ["niche-runs"] }); } }, [job.status, job.data, qc]);
  const cancelRef = useRef(job.cancel); cancelRef.current = job.cancel;
  useEffect(() => () => { void cancelRef.current(); }, []);
  const r = openedId ? opened.data : (job.data ?? last);
  const running = job.status === "running";
  const language = f.language ?? [settings.data?.contentLanguage, "ru"].find(code => CONTENT_LANGUAGES.some(x => x.value === code))!;
  const estimate = 101 + 2 * f.limit + (f.mode === "channel" ? 104 : 0);
  return <div>
    <ToolHeader icon={Users} title="Похожие каналы" eyebrow="NICHE FINDER" subtitle="Поиск по теме или каналу: просмотры, возраст и частота публикаций — с прозрачными границами выборки" />
    <Card className="mb-5">
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (r) setLast(r); setOpenedId(null); void job.start({ ...f, language }); }}>
        <fieldset disabled={running} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label><Label>Режим поиска</Label><Select aria-label="Режим поиска" value={f.mode} onChange={e => setF({ ...f, mode: e.target.value as NicheForm["mode"] })}><option value="topic">По теме</option><option value="channel">По исходному каналу</option></Select></label>
          <label><Label>Язык поиска</Label><Select aria-label="Язык поиска" value={language} onChange={e => setF({ ...f, language: e.target.value })}>{CONTENT_LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}</Select></label>
        </div>
        {f.mode === "channel" && <label className="block"><Label required>Исходный канал</Label><Input aria-label="Исходный канал" required minLength={3} maxLength={300} placeholder="@канал или ссылка YouTube" value={f.channel} onChange={e => setF({ ...f, channel: e.target.value })} /></label>}
        <label className="block"><Label required={f.mode === "topic"}>Тема поиска {f.mode === "channel" && "(необязательно)"}</Label><Input aria-label="Тема поиска" required={f.mode === "topic"} minLength={f.mode === "topic" ? 2 : undefined} maxLength={200} placeholder="Например: история повседневной жизни" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} /></label>
        {f.mode === "channel" && <p className="text-xs text-muted-foreground">Без темы используются до трёх ключевых слов канала, иначе — его название. Это текстовый поиск, не список рекомендаций YouTube.</p>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label><Label>Каналов из поиска</Label><Select aria-label="Каналов из поиска" value={f.limit} onChange={e => setF({ ...f, limit: Number(e.target.value) })}>{[5, 10, 20].map(n => <option key={n} value={n}>{n}</option>)}</Select></label>
          <label><Label>Последних загрузок / канал</Label><Select aria-label="Последних загрузок / канал" value={f.sample} onChange={e => setF({ ...f, sample: Number(e.target.value) })}>{[10, 20, 30, 50].map(n => <option key={n} value={n}>{n}</option>)}</Select></label>
          <label><Label>Тип видео в выборке</Label><Select aria-label="Тип видео в выборке" value={f.type} onChange={e => setF({ ...f, type: e.target.value as NicheForm["type"] })}><option value="all">Все</option><option value="long">Более 180 секунд</option><option value="shorts">До 180 секунд (не статус Shorts)</option></Select></label>
          <label><Label>Ставка RPM длинных видео</Label><Select aria-label="Ставка RPM длинных видео" value={f.rpmNiche ?? ""} onChange={e => setF({ ...f, rpmNiche: e.target.value || undefined })}><option value="">Из настроек</option>{settings.data?.rpm.filter(x => x.niche !== "Shorts").map(x => <option key={x.niche} value={x.niche}>{x.niche} ({x.min}–{x.max} $)</option>)}</Select></label>
        </div>
        <Switch checked={f.force} onChange={force => setF({ ...f, force })} label="Обновить данные, не использовать кеш" />
        <p className="text-xs text-muted-foreground">До ~{estimate} единиц YouTube за запуск без кеша, повторов и переключений ключей; в режиме канала — консервативная оценка с его разрешением. Это не счётчик расхода. Нейросети не вызываются. Добавление в конкуренты — отдельные запросы по вашей кнопке.</p>
        </fieldset>
        <div className="flex flex-wrap gap-3"><Button type="submit" disabled={running || settings.isPending} loading={running} loadingText="Ищу каналы…">Найти похожие каналы</Button>{running && <Button type="button" variant="outline" onClick={() => void job.cancel()}><X className="h-4 w-4" />Остановить</Button>}</div>
      </form>
    </Card>
    {settings.isError && <ErrorAlert error={settings.error} />}
    {running && <ProgressBar value={job.pct} label={job.stage} />}
    {job.error && !openedId && <ErrorAlert error={job.error} />}
    {opened.isError && openedId && <ErrorAlert error={opened.error} />}
    {openedId && opened.isPending && <p role="status">Открываю сохранённое сравнение…</p>}
    {r && <div className="space-y-4">
      <Card><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="break-words font-bold">Запрос: {r.query}</h2><p className="text-xs text-muted-foreground">Снимок {new Date(r.createdAt).toLocaleString("ru-RU")} · язык {r.language} · тип {r.input.type} · до {r.input.sample} загрузок</p></div><Button variant="outline" onClick={() => download(r)}><Download className="h-4 w-4" />Скачать JSON</Button></div>
        <p className="mt-3 text-sm">Подписчики известны у {r.summary.knownSubscribers} из {r.summary.candidates} найденных каналов (без исходного). {r.summary.establishedPct === null ? "Данных недостаточно для описательной доли ≥100 тыс. подписчиков." : `Доля каналов от 100 тыс. среди известных: ${r.summary.establishedPct}%.`}</p>
        {r.searchIds && <p className="mt-2 text-xs text-muted-foreground">Из поиска возвращено уникальных ID: {r.searchIds.length}; метаданные кандидатов (без исходного): {r.rows.filter(x => !x.seed).length}. Недоступные каналы не входят в описательную долю. Одна страница, не весь рынок; исходный канал учитывается отдельно.</p>}
        {r.version === 1 && <p className="mt-3 text-sm text-accent" role="note">Архивное сравнение v1: исходные видео не закреплены; прежние оценки не пересчитаны. Это не проверенная оценка рынка.</p>}
        <p className="mt-2 text-xs text-muted-foreground">* Среднее и медиана — только по видео старше 48 ч. Частота = (число видео − 1) × 7 / интервал между крайними датами; не прогноз будущих публикаций. Shorts определены приблизительно по длительности до 180 с, не по официальному статусу. Совпадение текста — доля слов запроса, найденных в названии, описании канала или названиях загрузок.</p>
        <p className="mt-2 text-xs text-muted-foreground">Условный доход среднего видео = среднее (просмотры × RPM / 1000), не месячный доход. Снимок ставок: длинные — {r.rpm.long.niche} {r.rpm.long.min}–{r.rpm.long.max} $, Shorts {r.rpm.shorts.min}–{r.rpm.shorts.max} $. Монетизация неизвестна; это сценарий при заданном RPM, а не фактические заработки.</p>
        <p className="mt-2 text-xs text-muted-foreground">Доля каналов с ≥100 тыс. подписчиков — только описание этой поисковой выборки (нужно ≥5 известных и ≥70% покрытия). Это не насыщенность, конкуренция, спрос, весь рынок или вероятность успеха. Изменение формы/фильтров не меняет сохранённый снимок и его JSON.</p>
        {!!r.warnings.length && <ul className="mt-3 list-disc pl-4 text-sm text-accent">{r.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
      </Card>
      <Results key={r.id} rows={r.rows} saved />
    </div>}
    {!r && !openedId && !!job.partial?.rows && <Results rows={job.partial.rows} saved={false} />}
    <Card className="mt-6"><SectionTitle icon={<History className="h-4 w-4" />}>История сравнений</SectionTitle><p className="mb-3 text-xs text-muted-foreground">Последние 50. Открытие не расходует квоту; история входит в экспорт всех данных.</p>
      {history.isError && <ErrorAlert error={history.error} />}{history.isPending && <p role="status">Загрузка истории…</p>}
      {history.data?.length === 0 && <p className="text-sm text-muted-foreground">Пока нет сохранённых сравнений.</p>}
      <div className="space-y-2">{history.data?.map(h => <button key={h.id} disabled={running} onClick={() => setOpenedId(h.id)} className="block w-full rounded border p-3 text-left text-sm hover:border-primary disabled:opacity-50"><span className="break-words font-semibold">{h.query}</span><span className="ml-2 text-xs text-muted-foreground">{new Date(h.createdAt).toLocaleDateString("ru-RU")} · {h.channels} каналов{h.warnings > 0 ? ` · предупреждений: ${h.warnings}` : ""}</span></button>)}</div>
    </Card>
  </div>;
}
