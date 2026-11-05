// Выпуск 1: Радар «Идеи для канала» — по утверждённому макету (карточка 45).
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EyeOff, Radar, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { Button, Card, ErrorAlert, Select, ToolHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ChannelPicker, JobBox, NeedChannel, agoDays, num, useActiveChannel } from "@/features/studio/common";
import type { IdeaPeriod, IdeaShow, IdeaSort, IdeaView, IdeasResponse, RunSummary } from "@/features/studio/types";

const SUBS = [5_000, 10_000, 20_000, 30_000, 45_000, 60_000, 80_000, 100_000, 150_000, 250_000, 500_000];
const MULT = [1.5, 2, 3, 5, 10, 20, 50];
const SORTS: { v: IdeaSort; label: string }[] = [
  { v: "new", label: "Сначала новые форматы" }, { v: "multiplier", label: "Сначала большой множитель" },
  { v: "views", label: "Сначала больше просмотров" }, { v: "best", label: "Сначала лучшие в целом" },
];
const mult = (m: number) => m >= 10 ? String(Math.round(m)) : String(m).replace(".", ",");
const nearest = (arr: number[], v: number) => arr.reduce((b, x, i) => Math.abs(x - v) < Math.abs(arr[b] - v) ? i : b, 0);
const pref = <T extends string>(k: string, d: T): T => { try { return (localStorage.getItem(k) as T) || d; } catch { return d; } };
const keep = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

function IdeaCard({ idea, onHide, onTake, busy }: { idea: IdeaView; onHide: () => void; onTake: () => void; busy: boolean }) {
  const c = idea.channel;
  const tag = c.format || (c.type === "yes" ? "тот же тип" : c.type === "unsure" ? "тип под вопросом" : "");
  return <Card className="flex min-w-0 flex-col overflow-hidden p-0" data-testid="idea-card">
    <a href={idea.url} target="_blank" rel="noreferrer" className="block"><img src={idea.thumb} alt="" loading="lazy" className="aspect-video w-full object-cover" /></a>
    <div className="flex flex-1 flex-col gap-2 p-4">
      <a href={idea.url} target="_blank" rel="noreferrer" className="font-bold leading-snug hover:text-primary" dir="auto">{idea.title}</a>
      <p className="text-sm text-muted-foreground"><a href={c.url} target="_blank" rel="noreferrer" className="hover:text-primary" dir="auto">{c.name}</a> · {num(c.subs)} подписчиков</p>
      <div className="flex flex-wrap items-center gap-2">
        {tag && <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary" title={c.typeReason}>{tag}</span>}
        <span className="ml-auto whitespace-nowrap text-sm"><b className="text-lg font-extrabold text-accent">{mult(idea.multiplier)}×</b> · {num(idea.views)} просмотров</span>
      </div>
      {c.firstLongAgeDays !== undefined && <p className={cn("w-fit rounded px-2 py-0.5 text-xs", c.firstLongExact && c.firstLongAgeDays <= 120 ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>
        Первое длинное видео канала: {c.firstLongExact ? agoDays(c.firstLongAgeDays) : "давно (у канала много роликов)"}
      </p>}
      {idea.version && <div className="rounded-lg border border-crown/30 bg-crown/10 p-2 text-sm"><b className="block text-[11px] uppercase tracking-wide text-crown">Ваша версия</b><span dir="auto">{idea.version.title}</span>{idea.version.angle && <span className="block text-muted-foreground" dir="auto">{idea.version.angle}</span>}</div>}
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {idea.status === "taken" && idea.projectId ? <Link to={`/studio/script?project=${idea.projectId}`} className="inline-flex min-h-11 items-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground">Открыть сценарий →</Link>
          : <Button className="min-h-11" size="sm" disabled={busy} onClick={onTake}>Взять идею →</Button>}
        {idea.status === "new" && <Button className="min-h-11" size="sm" variant="ghost" disabled={busy} onClick={onHide}><EyeOff className="h-4 w-4" />Скрыть</Button>}
        {idea.status === "hidden" && <Button className="min-h-11" size="sm" variant="outline" disabled={busy} onClick={onHide}><RotateCcw className="h-4 w-4" />Вернуть</Button>}
      </div>
    </div>
  </Card>;
}

export default function Ideas() {
  const qc = useQueryClient(), navigate = useNavigate();
  const { channel, list, loading } = useActiveChannel();
  const [sort, setSort] = useState<IdeaSort>(() => pref("ts:ideas-sort", "new"));
  const [period, setPeriod] = useState<IdeaPeriod>(() => pref("ts:ideas-period", "month"));
  const [show, setShow] = useState<IdeaShow>("active");
  const [subsIdx, setSubsIdx] = useState(5), [multIdx, setMultIdx] = useState(2);
  useEffect(() => { if (channel) { setSubsIdx(nearest(SUBS, channel.radar.maxSubs)); setMultIdx(nearest(MULT, channel.radar.minMultiplier)); } }, [channel?.id]);
  const ideas = useQuery({
    queryKey: ["studio-ideas", channel?.id, sort, period, show, channel?.radar.maxSubs, channel?.radar.minMultiplier],
    queryFn: () => api<IdeasResponse>(`/studio/channels/${channel!.id}/ideas?sort=${sort}&period=${period}&show=${show}`),
    enabled: !!channel, refetchOnWindowFocus: false,
  });
  // Ползунки сохраняются в профиль канала: следующий поиск идёт с теми же порогами.
  const saveTimer = useRef<number>();
  const thresholds = useMutation({
    mutationFn: (radar: { maxSubs: number; minMultiplier: number }) => api(`/studio/channels/${channel!.id}`, { method: "PATCH", json: { radar } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["studio-channels"] }),
  });
  const onSlide = (s: number, m: number) => {
    setSubsIdx(s); setMultIdx(m);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => thresholds.mutate({ maxSubs: SUBS[s], minMultiplier: MULT[m] }), 450);
  };
  const job = useJob<RunSummary>("/studio/radar");
  const running = job.status === "running" || !!ideas.data?.running;
  useEffect(() => { if (job.status === "done" || job.status === "error") void qc.invalidateQueries({ queryKey: ["studio-ideas"] }); }, [job.status]);
  useEffect(() => () => { void job.cancel(); }, [job.cancel]);
  const action = useMutation({
    mutationFn: ({ idea, act }: { idea: IdeaView; act: "hide" | "unhide" | "take" }) => api<{ projectId?: string }>(`/studio/channels/${channel!.id}/ideas/${idea.videoId}/${act}`, { method: "POST" }),
    onSuccess: (r, v) => { if (v.act === "take" && r.projectId) navigate(`/studio/script?project=${r.projectId}`); else void qc.invalidateQueries({ queryKey: ["studio-ideas"] }); },
  });

  if (loading) return null;
  if (!list?.channels.length || !channel) return <div className="space-y-6"><ToolHeader icon={Radar} title="Идеи для канала" eyebrow="// РАДАР" subtitle="Маленькие каналы, у которых ролик обогнал канал в разы — формат с проверенным спросом" /><NeedChannel /></div>;
  const d = ideas.data, run = d?.lastRun, st = run?.stats ?? {};
  const sortLabel = SORTS.find((x) => x.v === sort)?.label ?? "";
  const samples = d?.samples.length ? ` · образец: ${d.samples.slice(0, 3).map((s) => `${s.name}${s.subs ? ` (${num(s.subs)})` : ""}`).join(", ")}` : "";
  const tabs: { v: IdeaShow; label: string; n?: number }[] = [
    { v: "active", label: "Новые", n: d?.counts.active }, { v: "hidden", label: "Скрытые", n: d?.counts.hidden },
    { v: "taken", label: "Взятые", n: d?.counts.taken }, { v: "rejected", label: "Не тот тип", n: d?.counts.rejected },
  ];
  return <div className="space-y-5" data-testid="ideas-page">
    <header className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold">Идеи для вашего канала</h1>
          <p className="text-sm text-muted-foreground">{sortLabel}{samples}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ChannelPicker disabled={running} />
          <Button className="min-h-11" loading={running} loadingText="Ищу…" onClick={() => void job.start({}, `/studio/channels/${channel.id}/radar`, { serverConsent: true })}>Найти идеи</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex min-h-11 items-center gap-2 whitespace-nowrap rounded-lg border bg-muted/40 px-3">Подписчики: до {num(SUBS[subsIdx])}
          <input type="range" aria-label="Подписчиков не больше" min={0} max={SUBS.length - 1} value={subsIdx} onChange={(e) => onSlide(Number(e.target.value), multIdx)} className="w-28 accent-[hsl(var(--primary))]" /></label>
        <label className="flex min-h-11 items-center gap-2 whitespace-nowrap rounded-lg border bg-muted/40 px-3">Множитель от {MULT[multIdx]}×
          <input type="range" aria-label="Множитель не меньше" min={0} max={MULT.length - 1} value={multIdx} onChange={(e) => onSlide(subsIdx, Number(e.target.value))} className="w-24 accent-[hsl(var(--primary))]" /></label>
        <div className="flex" role="group" aria-label="Период">
          {([["month", "За месяц"], ["year", "За год"], ["all", "Всё время"]] as const).map(([v, label], i, a) => <button key={v} type="button" aria-pressed={period === v}
            onClick={() => { setPeriod(v); keep("ts:ideas-period", v); }}
            className={cn("min-h-11 whitespace-nowrap border px-3", i === 0 && "rounded-l-lg", i === a.length - 1 && "rounded-r-lg", period === v ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>{label}</button>)}
        </div>
        <Select aria-label="Сортировка" className="w-auto" value={sort} onChange={(e) => { const v = e.target.value as IdeaSort; setSort(v); keep("ts:ideas-sort", v); }}>{SORTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}</Select>
      </div>
    </header>
    <JobBox job={job} onCancel={() => void job.cancel()} note="Поиск идёт 3–8 минут: Радар открывает страницы YouTube понемногу, чтобы не получить блокировку. Найденное сохраняется." />
    {ideas.error && <ErrorAlert error={ideas.error} />}
    {action.error && <ErrorAlert error={action.error} />}
    {thresholds.error && <ErrorAlert error={thresholds.error} />}
    <div className="flex flex-col gap-5 lg:flex-row">
      <aside className="w-full flex-none space-y-3 self-start rounded-xl border bg-card p-4 text-sm leading-relaxed lg:w-64">
        <h3 className="text-base font-bold">Как это работает</h3>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Читает каналы-образцы и профиль канала: темы, длину, формат.</li>
          <li>Ищет на YouTube по запросам из образцов, ниши и подсказок поиска — через открытые страницы, без расхода квоты ключа.</li>
          <li>Оставляет маленькие каналы — порог задаёте ползунком.</li>
          <li>Берёт видео, которые обогнали свой канал: просмотры ÷ подписчики.</li>
          <li>Если подключён AnyModel — модель проверяет «тот же тип» по названиям и превью и пишет вашу версию.</li>
        </ol>
        <p className="rounded-lg bg-success/10 p-2 text-xs text-success">Ничего не копируется: берётся проверенный спрос, угол — ваш. Работает на вашем ПК, идеи копятся в папке TubeStudioData.</p>
        {run && <div className="space-y-1 rounded-lg bg-primary/10 p-2 text-xs text-primary">
          <p>Поиск {new Date(run.startedAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}: {run.queries.length} запросов → {st.channelsFound ?? 0} каналов → {st.channelsChecked ?? 0} проверено{st.relatedChannels ? ` · похожих ${st.relatedChannels}` : ""}.</p>
          {run.stopped && <p>Остановлен: {run.stopped}</p>}
        </div>}
        {run?.notes.map((n, i) => <p key={i} className="text-xs text-muted-foreground">{n}</p>)}
        {run && run.queries.length > 0 && <details className="text-xs"><summary className="min-h-11 cursor-pointer py-2 text-muted-foreground">Запросы последнего поиска</summary><ul className="space-y-0.5 text-muted-foreground">{run.queries.map((q) => <li key={q} dir="auto">{q}</li>)}</ul></details>}
      </aside>
      <section className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap gap-2" role="tablist">
          {tabs.map((t) => <button key={t.v} type="button" role="tab" aria-selected={show === t.v} onClick={() => setShow(t.v)}
            className={cn("min-h-11 rounded-md border px-3 text-sm", show === t.v ? "border-primary/40 bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted")}>{t.label}{t.n !== undefined ? ` · ${t.n}` : ""}</button>)}
        </div>
        {d && d.ideas.length === 0 && <Card className="space-y-2 p-5 text-sm">
          {!run ? <><p className="font-semibold">Идей пока нет</p><p className="text-muted-foreground">Нажмите «Найти идеи». {channel.samples.length ? "" : "Лучше сначала добавьте 1–5 каналов-образцов в профиль канала — так Радар точнее поймёт тип."}</p>{!channel.samples.length && <Link to="/channels" className="text-primary hover:underline">Открыть профиль →</Link>}</>
            : period !== "all" && show === "active" ? <><p>За выбранный период подходящих роликов нет.</p><Button variant="outline" size="sm" className="min-h-11 w-fit" onClick={() => setPeriod(period === "month" ? "year" : "all")}>{period === "month" ? "Показать за год" : "Показать за всё время"}</Button></>
              : <p className="text-muted-foreground">В этом списке пусто.</p>}
        </Card>}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {d?.ideas.map((idea) => <IdeaCard key={idea.videoId} idea={idea} busy={action.isPending}
            onTake={() => action.mutate({ idea, act: "take" })}
            onHide={() => action.mutate({ idea, act: idea.status === "hidden" ? "unhide" : "hide" })} />)}
        </div>
      </section>
    </div>
  </div>;
}
