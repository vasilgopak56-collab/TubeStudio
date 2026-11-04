import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users, Eye, Flame, TrendingUp, DollarSign, CalendarDays, Crown, Tag, Video as VideoIcon, Lightbulb, Gauge, Stethoscope,
  ExternalLink, Bookmark, BookmarkCheck, PenLine, RefreshCw, ThumbsUp, MessageCircle, Clock, AlertTriangle, Check,
} from "lucide-react";
import { api } from "@/lib/api";
import { compact, date, dur, fmt, money, pct, ago } from "@/lib/format";
import type { OutlierTopic, Report, Video } from "@/lib/types";
import { Badge, BarChart, Button, Card, Chip, CopyButton, ErrorAlert, ScoreRing, SectionTitle, StatTile, TagPill } from "@/components/ui";
import { cn } from "@/lib/cn";

const SAT = { low: ["Низкая", "success"], moderate: ["Умеренная", "primary"], high: ["Высокая", "danger"], extreme: ["Экстремальная", "danger"] } as const;
const TREND = { growing: ["Растёт", "success"], stable: ["Стабилен", "primary"], declining: ["Падает", "danger"] } as const;
const MON = { low: "Низкая", medium: "Средняя", medium_high: "Средне-высокая", high: "Высокая" } as const;
const TYPE = { replication: "Репликация", counter: "Контр-тезис", format_shift: "Смена формата" } as const;

/** «Отслеживать» → трекер конкурентов (ежедневные снимки и тренд-алерты) */
function TrackButton({ id }: { id: string }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["competitors"], queryFn: () => api<{ channels: { id: string }[] }>("/competitors"), staleTime: 60_000 });
  const add = useMutation({ mutationFn: () => api("/competitors", { method: "POST", json: { channel: id } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["competitors"] }) });
  const tracked = list.data?.channels.some((c) => c.id === id);
  if (tracked) return <Link to="/competitors"><Button size="sm" variant="ghost"><Check className="h-3.5 w-3.5" />В трекере</Button></Link>;
  return <span title={add.error ? (add.error as Error).message : "Ежедневные снимки, выбросы и всплески — в «Конкурентах»"}><Button size="sm" variant="outline" onClick={() => add.mutate()} loading={add.isPending}><Eye className="h-3.5 w-3.5" />Отслеживать</Button></span>;
}

export function ChannelHeader({ r }: { r: Report }) {
  const url = r.channel.handle ? `https://www.youtube.com/${r.channel.handle}` : `https://www.youtube.com/channel/${r.channel.id}`;
  return (
    <div className="flex flex-wrap items-center gap-4">
      {r.channel.avatar && <img src={r.channel.avatar} alt="" className="h-14 w-14 rounded-full border" referrerPolicy="no-referrer" />}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-2xl font-extrabold">{r.channel.title}</h2>
        <div className="flex flex-wrap items-center gap-x-3 text-[13px] text-muted-foreground">
          {r.channel.handle && <span>{r.channel.handle}</span>}
          <span>{fmt(r.channel.videoCount)} видео</span><span>{compact(r.channel.totalViews)} просмотров всего</span>
          {r.channel.country && <span>{r.channel.country}</span>}<span>с {date(r.channel.publishedAt)}</span>
        </div>
      </div>
      <TrackButton id={r.channel.id} />
      <a href={url} target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><ExternalLink className="h-3.5 w-3.5" />Открыть канал</Button></a>
    </div>
  );
}

export function StatsRow({ r }: { r: Report }) {
  const eng = r.stats.engagement;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile icon={<Users className="h-4 w-4" />} label="Подписчики" value={r.channel.hiddenSubscribers ? "скрыто" : compact(r.channel.subscribers)} />
      <StatTile icon={<Eye className="h-4 w-4" />} label="Ср. просмотры (выборка)" value={compact(r.stats.avgViews)} hint={`медиана ${compact(r.stats.medianViews)}`} />
      <StatTile icon={<Flame className="h-4 w-4" />} label="Вовлечённость" value={`${eng}%`} hint={eng < 2 ? "ниже среднего" : eng <= 5 ? "средне" : "высоко"} />
      <StatTile icon={<TrendingUp className="h-4 w-4" />} label="Виральность канала" value={`${r.stats.channelVirality}/10`} hint={`outlier-видео: ${Math.round(r.stats.outlierShare * 100)}%`} />
    </div>
  );
}

export function IncomeAndWindow({ r }: { r: Report }) {
  const [period, setPeriod] = useState<"m" | "y">("m");
  const k = period === "m" ? 1 : 12;
  const g = r.windows.growthPct;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2 font-bold"><DollarSign className="h-4 w-4 text-success" />Оценка дохода</span>
          <div className="flex gap-1"><Chip active={period === "m"} onClick={() => setPeriod("m")} className="h-7 px-2.5 text-xs">Месяц</Chip><Chip active={period === "y"} onClick={() => setPeriod("y")} className="h-7 px-2.5 text-xs">Год</Chip></div>
        </div>
        <div className="text-3xl font-extrabold">{money(r.income.monthMin * k)} – {money(r.income.monthMax * k)}</div>
        <p className="mt-2 text-xs text-muted-foreground">По просмотрам видео за 30 дней: длинные {compact(r.income.longViews30)} × RPM ${r.income.rpm.min}–{r.income.rpm.max} ({r.income.rpm.niche}){r.income.shortViews30 > 0 && <>, Shorts {compact(r.income.shortViews30)} × ${r.income.shortsRpm.min}–{r.income.shortsRpm.max}</>}.</p>
        <p className="mt-1 text-xs text-muted-foreground">Это оценка: реальные выплаты зависят от гео, рекламы и спонсоров. Ставки — в Настройках.</p>
      </Card>
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2 font-bold"><TrendingUp className="h-4 w-4 text-primary" />Последние 30 дней</span>
          <Badge tone={g >= 0 ? "success" : "danger"}>{g >= 0 ? "↑" : "↓"} {pct(g)}</Badge>
        </div>
        <div className="text-3xl font-extrabold">{compact(r.windows.last30)} <span className="text-base font-medium text-muted-foreground">просмотров</span></div>
        <p className="mt-2 text-xs text-muted-foreground">Прошлые 30 дней: {compact(r.windows.prev30)} · загрузок: {r.windows.uploads30} сейчас против {r.windows.uploadsPrev30} раньше.</p>
        <p className="mt-1 text-xs text-muted-foreground">По просмотрам видео, опубликованных в каждом окне.</p>
      </Card>
    </div>
  );
}

function Highlight({ text, words }: { text: string; words: string[] }) {
  const parts = useMemo(() => {
    const ws = words.filter((w) => w && text.includes(w));
    if (!ws.length) return [text];
    const re = new RegExp(`(${ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
    return text.split(re);
  }, [text, words]);
  return <>{parts.map((p, i) => (words.includes(p) ? <b key={i} className="text-primary">{p}</b> : p))}</>;
}

export function NicheVerdict({ r }: { r: Report }) {
  const n = r.insights!.niche;
  return (
    <Card brackets>
      <SectionTitle icon={<Gauge className="h-4 w-4" />}>Вердикт ниши <Badge tone="primary">{n.name}</Badge></SectionTitle>
      <div className="flex flex-wrap items-center gap-6">
        <ScoreRing value={n.virality} max={10} label="Виральность ниши" />
        <ScoreRing value={n.demand} max={10} label="Спрос" />
        <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
          {[["Насыщенность", <Badge key="s" tone={SAT[n.saturation][1]}>{SAT[n.saturation][0]}</Badge>], ["Тренд", <Badge key="t" tone={TREND[n.trend][1]}>{TREND[n.trend][0]}</Badge>], ["Монетизация", <span key="m" className="text-sm font-semibold">{MON[n.monetization]}</span>]].map(([l, v]) => (
            <div key={l as string} className="rounded-md border bg-background/40 p-3"><div className="mono-label mb-1.5">{l}</div>{v}</div>
          ))}
        </div>
      </div>
      <ul className="mt-5 space-y-2 text-[14px]">
        {n.bullets.map((b, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /><span><Highlight text={b.text} words={b.highlight} /></span></li>)}
      </ul>
      <div className="mt-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm"><b>Стоит ли входить: </b>{n.entryVerdict}</div>
    </Card>
  );
}

export function Diagnosis({ r }: { r: Report }) {
  const d = r.insights!.diagnosis;
  const block = (t: string, a: string[], tone = "") => (
    <div><div className={cn("mb-2 text-sm font-bold", tone)}>{t}</div><ul className="space-y-1.5 text-[13.5px] text-muted-foreground">{a.map((x, i) => <li key={i} className="flex gap-2"><span className="text-primary">›</span><span className="text-foreground/90">{x}</span></li>)}</ul></div>
  );
  return (
    <Card>
      <SectionTitle icon={<Stethoscope className="h-4 w-4" />}>Диагноз канала</SectionTitle>
      <div className="grid gap-5 md:grid-cols-2">
        {block("Почему растёт", d.whyGrowing, "text-success")}
        {block("Почему одни видео выстрелили, а другие нет", d.hitsVsFlops)}
        {block("Ошибки, которых стоит избегать", d.mistakes, "text-accent")}
        {block("Востребованные ракурсы", d.angles, "text-primary")}
      </div>
      <div className="mt-5 border-t pt-4">
        <div className="mb-2 text-sm font-bold">План действий</div>
        <ol className="grid gap-2 md:grid-cols-2">{d.plan.map((x, i) => <li key={i} className="flex gap-2.5 text-[13.5px]"><span className="font-mono text-xs text-primary">{String(i + 1).padStart(2, "0")}</span>{x}</li>)}</ol>
      </div>
    </Card>
  );
}

const ytUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

function VideoCard({ v, rank, reasons }: { v: Video; rank?: number; reasons?: string[] }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-card", rank === 1 && "border-crown/50")}>
      <a href={ytUrl(v.id)} target="_blank" rel="noreferrer" className="relative block aspect-video bg-muted">
        {v.thumbnail && <img src={v.thumbnail} alt="" decoding="async" className="h-full w-full object-cover" referrerPolicy="no-referrer" />}
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 font-mono text-[11px] text-white">{dur(v.durationSec)}</span>
        {rank && <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-bold text-crown">{rank === 1 && <Crown className="h-3 w-3" />}#{rank}</span>}
        {v.outlier >= 2 && <span className={cn("absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 font-mono text-[11px] font-bold", v.outlier >= 5 ? "bg-success text-black" : "bg-primary text-primary-foreground")}>×{v.outlier.toFixed(1)}</span>}
      </a>
      <div className="p-3">
        <a href={ytUrl(v.id)} target="_blank" rel="noreferrer" className="line-clamp-2 text-[13.5px] font-semibold leading-snug hover:text-primary">{v.title}</a>
        <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11.5px] text-muted-foreground">
          <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{compact(v.views)}</span>
          <span className="flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{compact(v.likes)}</span>
          <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{compact(v.comments)}</span>
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{ago(v.publishedAt)}</span>
        </div>
        {reasons && <ul className="mt-2.5 space-y-1 border-t pt-2.5 text-[12.5px]">{reasons.map((x, i) => <li key={i} className="flex gap-1.5"><span className="text-success">✓</span>{x}</li>)}</ul>}
      </div>
    </div>
  );
}

export function Top3({ r }: { r: Report }) {
  const byId = new Map(r.videos.map((v) => [v.id, v]));
  const reasons = new Map(r.insights?.top3.map((t) => [t.videoId, t.reasons]) ?? []);
  return (
    <section>
      <SectionTitle icon={<Crown className="h-4 w-4" />}>Топ-3 видео</SectionTitle>
      <div className="grid gap-4 md:grid-cols-3">{r.top3.map((id, i) => byId.get(id) && <VideoCard key={id} v={byId.get(id)!} rank={i + 1} reasons={reasons.get(id)} />)}</div>
    </section>
  );
}

export function Schedule({ r }: { r: Report }) {
  const s = r.schedule;
  return (
    <Card>
      <SectionTitle icon={<CalendarDays className="h-4 w-4" />}>Лучшее время публикации</SectionTitle>
      <p className="-mt-2 mb-4 text-xs text-muted-foreground">Средние просмотры по дню и часу публикации ({s.basis === "30d" ? "видео за 30 дней" : "вся выборка — за 30 дней мало видео"}), часовой пояс {r.params.tz}.</p>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.6fr]">
        <div>
          <div className="mb-2 text-sm">Лучший день: <b className="text-primary">{s.byDay[s.bestDay].label}</b></div>
          <BarChart data={s.byDay.map((d) => ({ label: d.label, value: d.avg, count: d.count }))} highlight={s.bestDay} />
        </div>
        <div>
          <div className="mb-2 text-sm">Лучший час: <b className="text-primary">{s.byHour[s.bestHour].label}:00</b></div>
          <BarChart data={s.byHour.map((d) => ({ label: d.label, value: d.avg, count: d.count }))} highlight={s.bestHour} />
        </div>
      </div>
    </Card>
  );
}

export function Tags({ r }: { r: Report }) {
  const { golden, icebox } = r.tags;
  return (
    <Card>
      <SectionTitle icon={<Tag className="h-4 w-4" />} right={golden.length > 0 && <CopyButton text={golden.map((t) => t.tag).join(", ")} label="Скопировать золотые" />}>Эффективность тегов</SectionTitle>
      {!golden.length && !icebox.length ? <p className="text-sm text-muted-foreground">Недостаточно тегов: нужно, чтобы тег встречался хотя бы в 2 видео.</p> : (
        <div className="space-y-4">
          <div><div className="mb-2 text-[13px] font-semibold text-success">Золотые — выше среднего по выборке ({compact(r.stats.avgViews)})</div>
            <div className="flex flex-wrap gap-1.5">{golden.length ? golden.map((t) => <TagPill key={t.tag} kind="gold" tag={t.tag} value={compact(t.avgViews)} />) : <span className="text-xs text-muted-foreground">нет</span>}</div></div>
          <div><div className="mb-2 text-[13px] font-semibold text-accent">Icebox — ниже среднего, лучше избегать</div>
            <div className="flex flex-wrap gap-1.5">{icebox.length ? icebox.map((t) => <TagPill key={t.tag} kind="ice" tag={t.tag} value={compact(t.avgViews)} />) : <span className="text-xs text-muted-foreground">нет</span>}</div></div>
        </div>
      )}
    </Card>
  );
}

const SORTS = [["views", "Просмотры"], ["likes", "Лайки"], ["comments", "Комментарии"], ["best", "Лучшие в целом"], ["new", "Новые"]] as const;
export function VideoGrid({ r }: { r: Report }) {
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>("views");
  const [all, setAll] = useState(false);
  const list = useMemo(() => {
    const a = [...r.videos];
    const f = { views: (v: Video) => v.views, likes: (v: Video) => v.likes, comments: (v: Video) => v.comments, best: (v: Video) => v.bestScore, new: (v: Video) => +new Date(v.publishedAt) }[sort];
    return a.sort((x, y) => f(y) - f(x));
  }, [r.videos, sort]);
  return (
    <section>
      <SectionTitle icon={<VideoIcon className="h-4 w-4" />}>Проанализированные видео ({r.videos.length})</SectionTitle>
      <div className="mb-4 flex flex-wrap gap-2">{SORTS.map(([k, l]) => <Chip key={k} active={sort === k} onClick={() => setSort(k)}>{l}</Chip>)}</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{(all ? list : list.slice(0, 12)).map((v) => <VideoCard key={v.id} v={v} />)}</div>
      {list.length > 12 && !all && <div className="mt-4 text-center"><Button variant="outline" size="sm" onClick={() => setAll(true)}>Показать все {list.length}</Button></div>}
    </section>
  );
}

function OutlierCard({ t, r, saved, onSave }: { t: OutlierTopic; r: Report; saved: boolean; onSave: () => void }) {
  const nav = useNavigate();
  const src = r.videos.find((v) => v.id === t.basedOnVideoId);
  return (
    <div className="flex flex-col rounded-lg border bg-card p-4 transition-colors hover:border-primary/50">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Badge tone="primary">{t.technique}</Badge><Badge>{TYPE[t.type]}</Badge>
        <Badge tone={t.score >= 8 ? "success" : "default"} className="ml-auto">{t.score}/10</Badge>
      </div>
      <h3 className="text-[15px] font-bold leading-snug">{t.title}</h3>
      {src && <a href={ytUrl(src.id)} target="_blank" rel="noreferrer" className="mt-1 line-clamp-1 text-[11.5px] text-muted-foreground hover:text-primary">На основе: {src.title} · {compact(src.views)}</a>}
      <p className="mt-3 rounded-md border-l-2 border-primary bg-primary/5 px-3 py-2 text-[13px]">{t.why}</p>
      <div className="mono-label mt-3 mb-1.5">Как исполнить</div>
      <ul className="mb-3 space-y-1.5 text-[13px]">{t.howTo.map((h, i) => <li key={i} className="flex gap-2"><span className="text-primary">›</span>{h}</li>)}</ul>
      <div className="mt-auto flex flex-wrap gap-2 border-t pt-3">
        <Button size="sm" variant={saved ? "ghost" : "outline"} onClick={onSave} disabled={saved}>{saved ? <><BookmarkCheck className="h-3.5 w-3.5" />Сохранено</> : <><Bookmark className="h-3.5 w-3.5" />Сохранить тему</>}</Button>
        <Button size="sm" onClick={() => nav(`/script?topic=${encodeURIComponent(t.title)}`)}><PenLine className="h-3.5 w-3.5" />Написать сценарий</Button>
        <CopyButton text={`${t.title}\n\n${t.why}\n\n${t.howTo.map((h) => `- ${h}`).join("\n")}`} className="ml-auto" />
      </div>
    </div>
  );
}

export function Outliers({ r, onUpdate }: { r: Report; onUpdate: (r: Report) => void }) {
  const qc = useQueryClient();
  const [idx, setIdx] = useState(Math.max(0, r.outlierSets.length - 1));
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const more = useMutation({
    mutationFn: () => api<{ set: OutlierTopic[]; index: number }>("/youtube/outliers", { method: "POST", json: { reportId: r.id } }),
    onSuccess: (d) => { onUpdate({ ...r, outlierSets: [...r.outlierSets, d.set] }); setIdx(d.index - 1); },
  });
  const save = useMutation({
    mutationFn: (t: OutlierTopic) => api("/saved-topics", { method: "POST", json: { title: t.title, niche: r.insights?.niche.name ?? r.niche, score: t.score * 10, source: "analysis", notes: `${t.why}\n\n${t.howTo.map((h) => `- ${h}`).join("\n")}`, meta: { channel: r.channel.title, reportId: r.id, technique: t.technique, type: t.type, basedOn: t.basedOnVideoId } } }),
    onSuccess: (_d, t) => { setSaved((s) => new Set(s).add(t.title)); qc.invalidateQueries({ queryKey: ["saved-topics"] }); },
  });
  const set = r.outlierSets[idx] ?? [];
  return (
    <section>
      <SectionTitle icon={<Lightbulb className="h-4 w-4" />} right={
        <div className="flex items-center gap-2">
          {r.outlierSets.length > 1 && r.outlierSets.map((_, i) => <Chip key={i} active={i === idx} onClick={() => setIdx(i)} className="h-7 px-2.5 text-xs">Набор {i + 1}</Chip>)}
          <Button size="sm" variant="outline" onClick={() => more.mutate()} loading={more.isPending} loadingText="Генерируем…"><RefreshCw className="h-3.5 w-3.5" />Ещё набор</Button>
        </div>}>Outlier-темы</SectionTitle>
      <p className="-mt-2 mb-4 text-xs text-muted-foreground">7 тем по образцу лучших видео канала{r.insights ? ` · ниша «${r.insights.niche.name}»` : ""}. Новый набор не повторяет предыдущие.</p>
      {more.error ? <div className="mb-4"><ErrorAlert error={more.error} onRetry={() => more.mutate()} /></div> : null}
      {save.error ? <div className="mb-4"><ErrorAlert error={save.error} /></div> : null}
      {!set.length ? <Card className="text-sm text-muted-foreground">Темы ещё не сгенерированы. Нажмите «Ещё набор».</Card> :
        <div className="grid gap-4 md:grid-cols-2">{set.map((t) => <OutlierCard key={t.title} t={t} r={r} saved={saved.has(t.title)} onSave={() => save.mutate(t)} />)}</div>}
      <div className="mt-3 text-right"><Link to="/saved" className="text-xs text-muted-foreground hover:text-primary">Сохранённые темы →</Link></div>
    </section>
  );
}

export function InsightsError({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div><b>AI-часть отчёта не построена.</b> Метрики выше посчитаны по реальным данным. Причина: {msg}</div>
    </div>
  );
}
