import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, ChevronDown, ChevronRight, Flame, Plus, RefreshCw, Settings2, Sparkles, Trash2, TrendingUp, Users, Video, Wand2, MessageSquareText } from "lucide-react";
import { api } from "@/lib/api";
import { useSettings } from "@/lib/queries";
import { ago, compact, dur } from "@/lib/format";
import { Badge, Button, Card, Chip, EmptyState, ErrorAlert, Input, SectionTitle, Skeleton, ToolHeader } from "@/components/ui";
import { type Alert, type Comp, type ChannelSnapshot, ytUrl } from "@/features/research/types";
import { OutlierDetails } from "@/features/research/OutlierBasis";
import { DigestCard } from "@/features/research/Digest";

const KIND: Record<Alert["kind"], { label: string; tone: "primary" | "success" | "crown" | "danger"; icon: typeof Bell }> = {
  new: { label: "Новое", tone: "primary", icon: Video }, outlier: { label: "Выброс", tone: "crown", icon: Flame },
  spike: { label: "Всплеск", tone: "danger", icon: TrendingUp }, subs: { label: "Подписчики", tone: "success", icon: Users },
};
function historyCounter(h: ChannelSnapshot, key: "subs"|"views"|"videos") {
  if (key === "subs" && h.hiddenSubscribers) return "Скрыты";
  const value=h[key];if(value == null || !Number.isSafeInteger(value) || value<0)return "—";
  return `${value.toLocaleString("ru-RU")}${h[`${key}Known`] === true ? "" : " (архив, не подтверждено)"}`;
}
const signed = (n: number) => `${n > 0 ? "+" : ""}${compact(n)}`;

function ChannelCard({ c, onRemove }: { c: Comp; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const [onlyLong, setOnlyLong] = useState<"all" | "long" | "shorts">("all");
  const nav = useNavigate();
  const qc = useQueryClient();
  const refresh = useMutation({ mutationFn: () => api("/competitors/refresh", { method: "POST", json: { ids: [c.id] } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["competitors"] }); qc.invalidateQueries({ queryKey: ["comp-alerts"] }); } });
  const vids = c.videos.filter((v) => onlyLong === "all" || (onlyLong === "shorts" ? v.isShort : !v.isShort));
  const best = [...c.videos].sort((a, b) => (b.outlier ?? 0) - (a.outlier ?? 0))[0];
  const count = (n: number | null) => n == null ? "—" : compact(n);
  return (
    <Card className="min-w-0 p-4" data-testid="comp-card">
      <div className="flex flex-wrap items-center gap-3">
        {c.avatar ? <img src={c.avatar} alt="" className="h-10 w-10 rounded-full" /> : <div className="h-10 w-10 rounded-full bg-muted" />}
        <div className="min-w-0 flex-1 basis-[calc(100%-3.25rem)] sm:basis-0">
          <a href={`https://www.youtube.com/channel/${c.id}`} target="_blank" rel="noreferrer" className="line-clamp-2 break-words font-medium hover:text-primary">{c.title}</a>
          <div className="text-xs text-muted-foreground">{c.handle} · обновлено {c.lastRefresh ? ago(c.lastRefresh) : "—"}{c.lastError && <span className="text-accent"> · {c.lastError}</span>}</div>
        </div>
        <div className="grid w-full grid-cols-2 gap-4 text-sm sm:grid-cols-3" data-testid="channel-counters">
          <div><div className="mono-label">Подписчики</div><span className="font-mono">{count(c.subs)}</span><p className="text-xs text-muted-foreground">{c.counterReasons?.subs}</p></div>
          <div><div className="mono-label">Просмотры канала</div><span className="font-mono">{count(c.totalViews)}</span><p className="text-xs text-muted-foreground">{c.counterReasons?.views}</p></div>
          <div><div className="mono-label">Публичных видео</div><span className="font-mono">{count(c.videoCount)}</span><p className="text-xs text-muted-foreground">{c.counterReasons?.videos}</p></div>
          <div><div className="mono-label">Новых в выборке ≤30 дн.</div><span className="font-mono">{c.uploads30}</span></div>
          
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => refresh.mutate()} loading={refresh.isPending} aria-label="Обновить"><RefreshCw className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Убрать «${c.title}» из трекера?`)) onRemove(); }} aria-label="Удалить"><Trash2 className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}Видео</Button>
        </div>
      </div>
      <div className="mt-3 break-words text-xs text-muted-foreground">
        <p>Счётчики на {c.countersAsOf ?? "неизвестную дату"} (UTC). Публичные значения API, не точный прирост аудитории.</p>
        {c.channelError && <p className="text-accent">{c.channelError}</p>}
      </div>
      <div className="mt-3 rounded-md border border-border p-3 text-sm" data-testid="channel-week">
        <b>Сравнение с датой −7 дней</b>
        <p className="mt-1 break-words text-xs text-muted-foreground">{c.week?.from && c.week?.to && c.week.hours != null ? `${c.week.from} → ${c.week.to} · ${c.week.hours.toFixed(2)} ч (UTC)` : "Недостаточно данных для недельного сравнения"}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">{(["subs","views"] as const).map(key => {const change=c.week?.[key];return <div key={key}><span>{key === "subs" ? "Изменение подписчиков" : "Изменение просмотров"}: </span><span className="font-mono">{change?.delta == null ? "—" : signed(change.delta)}</span>{change?.reason && <p className="mt-1 text-xs text-muted-foreground">{change.reason}</p>}</div>;})}</div>
        <p className="mt-2 text-xs text-muted-foreground">Разность публичных накопительных счётчиков, не сумма дневной аналитики. Дни между снимками могут отсутствовать; скрытые/неизвестные значения не равны нулю.</p>
      </div>
      {best && best.outlier != null && best.outlier >= 2 && !open && <p className="mt-2 text-xs text-muted-foreground">Наибольший Outlier в сохранённой выборке: <a href={ytUrl(best.id)} target="_blank" rel="noreferrer" className="text-foreground hover:text-primary">{best.title}</a> — <span className="text-crown">{best.outlier}×</span></p>}
      {refresh.error ? <ErrorAlert error={refresh.error} /> : null}
      {open && (
        <div className="mt-4 space-y-3">
          <details className="text-sm" data-testid="channel-history"><summary>История счётчиков (последние 60 дат UTC)</summary>
            <p className="my-2 text-xs text-muted-foreground">Один последний снимок за дату UTC, без заполнения пропущенных дней. Архивные числа сохранены как были, но не используются в сравнениях без подтверждения. Скрытые значения не выводятся.</p>
            <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead><tr><th>Время UTC</th><th>Подписчики</th><th>Просмотры</th><th>Видео</th></tr></thead><tbody>{c.history.map((h,i)=><tr key={`${h.d}-${i}`} className="border-b border-border/50"><td className="p-2">{h.t != null && Number.isFinite(h.t) && Math.abs(h.t)<=8.64e15 ? new Date(h.t).toISOString() : `${h.d} · время неизвестно`}</td>{(["subs","views","videos"] as const).map(key=><td key={key} className="p-2">{historyCounter(h,key)}</td>)}</tr>)}</tbody></table></div>
          </details>
          <div className="flex gap-1.5">{(["all", "long", "shorts"] as const).map((t) => <Chip key={t} active={onlyLong === t} onClick={() => setOnlyLong(t)}>{t === "all" ? "Все" : t === "long" ? ">180 с" : "≤180 с"}</Chip>)}</div>
          <p className="text-xs text-muted-foreground">Таблица прокручивается по горизонтали; справа — интервал и причины недоступности скорости.</p>
          <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm">
            <thead><tr className="border-b border-border text-left mono-label"><th className="min-w-52 p-2">Видео</th><th className="p-2">Просмотры</th><th className="p-2">Outlier</th><th className="p-2" title="Среднее с публикации до последнего снимка, не текущая скорость">VPH за всё время</th><th className="p-2" title="Среднее между снимками за 1–48 часов, не мгновенная скорость">VPH между снимками</th><th className="p-2" /></tr></thead>
            <tbody>{vids.map((v) => (
              <tr key={v.id} className="border-b border-border/50">
                <td className="p-2"><div className="flex items-center gap-2">{v.thumbnail && <img src={v.thumbnail} alt="" className="h-9 w-16 rounded object-cover" />}<div className="min-w-0"><a href={ytUrl(v.id)} target="_blank" rel="noreferrer" className="line-clamp-1 hover:text-primary">{v.title}</a><span className="text-xs text-muted-foreground">{ago(v.publishedAt)} · {dur(v.durationSec)}{v.isShort ? " · ≤180 с (не статус Shorts)" : ""}</span></div></div></td>
                <td className="p-2 font-mono">{v.viewsKnown === false ? "—" : compact(v.views)}</td>
                <td className={`p-2 font-mono ${(v.outlier ?? 0) >= 3 ? "text-crown" : ""}`}>{v.outlier != null ? `${Number(v.outlier.toFixed(2))}×` : "—"}</td>
                <td className="p-2 font-mono">{v.vph == null ? "—" : compact(Math.round(v.vph))}</td>
                <td className="p-2 font-mono">{v.vphRecent != null ? compact(Math.round(v.vphRecent)) : "—"}
                  {v.interval && <div className="mt-1 min-w-40 text-xs font-sans text-muted-foreground">{v.interval.from} → {v.interval.to} · {v.interval.hours.toFixed(2)} ч · Δ {v.interval.deltaViews}</div>}
                  {v.rateReason && <div className="mt-1 min-w-40 text-xs font-sans text-muted-foreground">{v.rateReason}</div>}</td>
                <td className="p-2 whitespace-nowrap text-right"><Button size="sm" variant="ghost" onClick={() => nav(`/research?q=${encodeURIComponent(v.title)}&auto=1`)} title="Похожие видео в нише"><Sparkles className="h-3.5 w-3.5" /></Button><Button size="sm" variant="ghost" onClick={() => nav(`/script?topic=${encodeURIComponent(v.title)}`)} title="В сценарий"><Wand2 className="h-3.5 w-3.5" /></Button><Button size="sm" variant="ghost" onClick={() => nav(`/comments?v=${encodeURIComponent(ytUrl(v.id))}&auto=1`)} title="Анализ комментариев" aria-label="Анализ комментариев"><MessageSquareText className="h-3.5 w-3.5" /></Button></td>
              </tr>))}
            </tbody>
          </table></div>
          <div className="space-y-2">{vids.map(v=><div key={v.id} className="rounded border border-border p-3"><p className="break-all text-sm font-medium">{v.title}</p>{v.outlierBasis?<OutlierDetails basis={v.outlierBasis}/>:<p className="text-xs text-muted-foreground">Архивный Outlier: база не сохранена и не подтверждена.</p>}</div>)}</div>
        </div>
      )}
    </Card>
  );
}

export default function Competitors() {
  const qc = useQueryClient();
  const settings = useSettings();
  const C = settings.data?.research.competitors;
  const [ch, setCh] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const list = useQuery({ queryKey: ["competitors"], queryFn: () => api<{ channels: Comp[]; unread: number; lastAuto?: string }>("/competitors"), refetchInterval: 5 * 60_000 });
  const alerts = useQuery({ queryKey: ["comp-alerts"], queryFn: () => api<Alert[]>("/competitors/alerts"), refetchInterval: 5 * 60_000 });
  const inv = () => { qc.invalidateQueries({ queryKey: ["competitors"] }); qc.invalidateQueries({ queryKey: ["comp-alerts"] }); qc.invalidateQueries({ queryKey: ["usage"] }); };
  const add = useMutation({ mutationFn: () => api<Comp>("/competitors", { method: "POST", json: { channel: ch.trim() } }), onSuccess: () => { setCh(""); inv(); } });
  const del = useMutation({ mutationFn: (id: string) => api(`/competitors/${id}`, { method: "DELETE" }), onSuccess: inv });
  const refreshAll = useMutation({ mutationFn: () => api<{ refreshed: number; alerts: number; units: number; failed?: number }>("/competitors/refresh", { method: "POST", json: {} }), onSuccess: inv });
  const read = useMutation({ mutationFn: (ids?: string[]) => api("/competitors/alerts/read", { method: "POST", json: { ids } }), onSuccess: inv });
  const chans = list.data?.channels ?? [];
  const al = (alerts.data ?? []).filter((a) => !onlyUnread || !a.read);

  return (
    <div>
      <ToolHeader icon={Users} title="Конкуренты" eyebrow="// COMPETITORS · TREND ALERTS"
        subtitle="Сохранённые наблюдения каналов: проверяемая база Outlier, интервалы VPH и публичные счётчики. Не прогноз успеха."
        right={<Link to="/settings#research" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><Settings2 className="h-4 w-4" />Настройки</Link>} />

      <p className="mb-4 text-sm text-muted-foreground">VPH между снимками — средняя скорость за указанный интервал, не «сейчас». Всплеск требует минимум 3 других видео того же формата с совпадающими границами (±10 мин), известными счётчиками и снимком не старше 48 ч. Без такой базы алерт не создаётся. Группы ≤180 с и &gt;180 с — не подтверждённый статус Shorts. Outlier исключает само видео и требует минимум 3 других видео этой группы с известной длительностью и свежими счётчиками.</p>
      <Card brackets className="mb-6 p-5">
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (ch.trim().length >= 2) add.mutate(); }}>
          <Input value={ch} onChange={(e) => setCh(e.target.value)} placeholder="Ссылка на канал, @handle или ссылка на видео" className="min-w-[260px] flex-1" aria-label="Канал конкурента" />
          <Button type="submit" loading={add.isPending} disabled={ch.trim().length < 2}><Plus className="h-4 w-4" />Отслеживать</Button>
          <Button type="button" variant="outline" onClick={() => refreshAll.mutate()} loading={refreshAll.isPending} disabled={!chans.length}><RefreshCw className="h-4 w-4" />Обновить все</Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          {C ? (C.refreshHours ? `Авто-обновление каждые ${C.refreshHours} ч (пока сервер запущен)` : "Авто-обновление выключено") : ""} · ≈ {chans.length * 2 + (chans.length ? 1 : 0)} базовых ед. за обновление всех (верхняя оценка без повторов) · {chans.length}/50 каналов
          {refreshAll.data && <> · обработано каналов {refreshAll.data.refreshed}, новых алертов: {refreshAll.data.alerts}, неполных обновлений: {refreshAll.data.failed??0}</>}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">Чтение истории и алертов не вызывает YouTube или AI. Добавление сначала разрешает канал отдельным запросом; повторы, резервные ключи и общая диагностика расходуют квоту отдельно. Авто-дайджест, если включён в настройках, может отдельно вызывать платный AI.</p>
        {list.error?<ErrorAlert error={list.error}/>:null}{alerts.error?<ErrorAlert error={alerts.error}/>:null}{del.error?<ErrorAlert error={del.error}/>:null}{read.error?<ErrorAlert error={read.error}/>:null}
        {add.error ? <div className="mt-2"><ErrorAlert error={add.error} /></div> : null}
        {refreshAll.error ? <div className="mt-2"><ErrorAlert error={refreshAll.error} /></div> : null}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-3">
          {list.error ? null : list.isLoading ? <Skeleton className="h-40" /> : !chans.length ? <EmptyState icon={<Users className="h-6 w-6" />} title="Пока никого не отслеживаете">Добавьте канал. Обновление запускается кнопкой либо по включённому расписанию, пока сервер работает. Без достаточной базы алертов не будет.</EmptyState>
            : chans.map((c) => <ChannelCard key={c.id} c={c} onRemove={() => del.mutate(c.id)} />)}
        </div>
        <Card className="min-w-0 h-fit p-4" data-testid="alerts">
          <SectionTitle icon={<Bell className="h-4 w-4" />} right={<div className="flex items-center gap-2"><Chip active={onlyUnread} onClick={() => setOnlyUnread(!onlyUnread)}>Непрочитанные</Chip>{(list.data?.unread ?? 0) > 0 && <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => read.mutate(undefined)}><BellOff className="inline h-3.5 w-3.5" /> Прочитать все</button>}</div>}>
            Тренд-алерты {(list.data?.unread ?? 0) > 0 && <Badge tone="danger">{list.data!.unread}</Badge>}
          </SectionTitle>
          {alerts.error ? null : !al.length ? <p className="text-sm text-muted-foreground">Алертов нет. Они появятся после следующих обновлений: новые видео, выбросы ≥ {C?.alertOutlier ?? 3}×, всплески VPH ≥ {C?.alertVphX ?? 2}× от нормы, изменение публичного счётчика подписчиков ≥ {C?.alertSubsPct ?? 5}% при проверенном интервале 12–36 ч.</p> : (
            <ul className="max-h-[70vh] space-y-2 overflow-auto">{al.slice(0, 200).map((a) => { const K = KIND[a.kind]; return (
              <li key={a.id} className={`rounded-md border p-2.5 text-sm ${a.read ? "border-border/50 opacity-70" : "border-border"}`} onClick={() => !a.read && read.mutate([a.id])}>
                <div className="flex items-center gap-2"><Badge tone={K.tone}><K.icon className="h-3 w-3" />{K.label}</Badge><span className="truncate text-xs text-muted-foreground">{a.channelTitle} · {ago(a.t)}</span></div>
                {a.videoId ? <a href={ytUrl(a.videoId)} target="_blank" rel="noreferrer" className="mt-1 line-clamp-2 block font-medium hover:text-primary">{a.title}</a> : null}
                <p className="mt-0.5 break-words text-xs text-muted-foreground">{a.text}</p>
                {a.kind === "outlier" && (a.outlierEvidence?<OutlierDetails basis={a.outlierEvidence} frozen/>:<p className="mt-1 text-xs text-muted-foreground">Архивный Outlier: база сравнения не сохранена и не подтверждена.</p>)}
                {a.kind === "subs" && (a.subsEvidence ? <details className="mt-2 break-words text-xs"><summary>Основание изменения подписчиков</summary><p>{a.subsEvidence.from} → {a.subsEvidence.to} (UTC) · {a.subsEvidence.hours.toFixed(2)} ч</p><p>Счётчик: {a.subsEvidence.before.toLocaleString("ru-RU")} → {a.subsEvidence.after.toLocaleString("ru-RU")}, разность {signed(a.subsEvidence.delta)}, ≈ {a.subsEvidence.percent.toFixed(1)}%, порог {a.subsEvidence.threshold}%.</p><p>Публичный счётчик, не точный прирост аудитории. Скрытые и архивные данные исключены.</p></details> : <p className="mt-1 text-xs text-muted-foreground">Архивный алерт подписчиков: период и счётчики не подтверждены.</p>)}
                {a.kind === "spike" && (a.evidence ? <details className="mt-2 break-all text-xs"><summary>Основание всплеска</summary><p>{a.evidence.from} → {a.evidence.to} · Δ {a.evidence.deltaViews} · {a.evidence.hours.toFixed(2)} ч</p><p>Медиана: {a.evidence.median.toFixed(1)} просмотров/ч · порог {a.evidence.threshold}× · формат {a.evidence.format}</p>{a.evidence.peers.map(p => <p key={p.id}>{p.id}: {p.rate.toFixed(1)} просмотров/ч · {p.from} → {p.to}</p>)}</details> : <p className="mt-1 text-xs text-muted-foreground">Архивный алерт прежней версии: интервал и база сравнения не подтверждены.</p>)}
              </li>); })}
            </ul>)}
        </Card>
      </div>
      <DigestCard hasChannels={chans.length > 0} days={C?.digestDays ?? 7} />
    </div>
  );
}
