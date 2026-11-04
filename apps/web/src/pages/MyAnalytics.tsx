import Reach from "@/features/reach/Reach";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Clock, Eye, KeyRound, Lightbulb, LineChart as LineIcon, Link2, LogOut, Play, Plug, UserPlus, X } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { compact, ago } from "@/lib/format";
import type { ProjectSummary } from "@/lib/types";
import { Badge, BarChart, Button, Card, Chip, CopyButton, EmptyState, ErrorAlert, Input, Label, LineChart, ProgressBar, SectionTitle, Select, Skeleton, StatTile, ToolHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import Geography from "@/features/geography/Geography";
import Channels from "@/features/channels/Channels";
import Revenue from "@/features/revenue/Revenue";
import AbJournal from "@/features/ab/AbJournal";

type Status = { monetaryGranted?: boolean; scopeKnown?: boolean; configured: boolean; clientId: string; connected: boolean; channel: { id: string; title: string; thumbnail?: string } | null; connectedAt?: string; redirectUri: string; scopes: string[] };
type Vid = { id: string; title: string; publishedAt?: string; thumbnail?: string; durationSec: number; views: number; minutes: number; avgDuration: number; avgPct: number; subs: number };
type Traffic = { source: string; label: string; views: number; minutes: number };
type Overview = { days: number; range: { startDate: string; endDate: string }; totals: Record<string, number>; daily: { day: string; views: number; estimatedMinutesWatched: number; subscribersGained: number }[]; traffic: Traffic[]; videos: Vid[]; note: string };
type Cmp = { projectTitle: string; score?: number; error?: string; points?: { ratio: number; sec: number; actual: number; predicted: number }[]; mae?: number; at30?: { actual: number; predicted: number }; mid?: { actual: number; predicted: number }; end?: { actual: number; predicted: number }; drops?: { sec: number; drop: number; gap: number }[]; verdict?: string };
type VRep = { id: string; title: string; durationSec: number; publishedAt: string; totals: Record<string, number>; retention: { ratio: number; watch: number; relative: number }[]; traffic: Traffic[]; daily: { day: string; views: number }[]; projectId?: string; compare: Cmp | null };
type Lessons = { summary: string; working: { title: string; evidence: string; action: string }[]; notWorking: { title: string; evidence: string; action: string }[]; experiments: string[]; forScript: string[]; createdAt: string; model: string; videos: number; channel?:{id:string;title:string} };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function Setup({ st }: { st: Status }) {
  const qc = useQueryClient();
  const [id, setId] = useState(""), [secret, setSecret] = useState("");
  const save = useMutation({ mutationFn: () => api<Status>("/yt-oauth/client", { method: "PUT", json: { clientId: id.trim(), clientSecret: secret.trim() } }), onSuccess: () => { setSecret(""); qc.invalidateQueries({ queryKey: ["yt-oauth"] }); } });
  const connect = useMutation({ mutationFn: () => api<{ url: string }>("/yt-oauth/start"), onSuccess: (r) => { window.location.href = r.url; } });
  const steps = [
    <>Откройте <a className="underline" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud Console</a> и создайте проект (можно тот же, где ключ YouTube).</>,
    <>APIs &amp; Services → Library: включите <b>YouTube Data API v3</b> и <b>YouTube Analytics API</b>.</>,
    <>OAuth consent screen (Google Auth Platform → Branding/Audience): тип <b>External</b>, имя «TubeStudio», ваш e-mail. В <b>Test users</b> добавьте свой Google-аккаунт. В режиме Testing подключение может требовать повторной авторизации через 7 дней. Для личного теста публикация не обязательна; переход в Production не отменяет требования Google к проверке приложения.</>,
    <>Clients → Create client → тип <b>Desktop app</b> (Приложение для ПК). Скопируйте <b>Client ID</b> и <b>Client secret</b> сюда.</>,
    <>Нажмите <b>Подключить YouTube</b>, выберите аккаунт/бренд-канал и разрешите доступ «только чтение».</>,
  ];
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card className="p-5">
        <SectionTitle icon={<KeyRound className="h-4 w-4" />}>Как подключить (≈ 5 минут, один раз)</SectionTitle>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        <p className="mt-3 text-xs text-muted-foreground">Адрес возврата для клиента типа «Web application» (если выберете его вместо Desktop): <code>{st.redirectUri}</code> <CopyButton text={st.redirectUri} label="" /></p>
        <p className="mt-2 text-xs text-muted-foreground">Доступ только на чтение: {st.scopes.map((s) => s.split("/").pop()).join(", ")}. Токен хранится у вас на компьютере (data/oauth.json), отключить можно в любой момент.</p>
      </Card>
      <Card brackets className="space-y-3 p-5">
        <SectionTitle icon={<Plug className="h-4 w-4" />}>OAuth-клиент Google</SectionTitle>
        {st.configured && <p className="text-sm">Клиент сохранён: <code>{st.clientId}</code></p>}
        <div><Label>Client ID</Label><Input value={id} onChange={(e) => setId(e.target.value)} placeholder="123-abc.apps.googleusercontent.com" aria-label="Client ID" /></div>
        <div><Label>Client secret</Label><Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="GOCSPX-…" aria-label="Client secret" autoComplete="off" /></div>
        <Button variant="outline" className="w-full" disabled={!id.trim() || !secret.trim()} loading={save.isPending} onClick={() => save.mutate()}>{st.configured ? "Заменить клиента" : "Сохранить"}</Button>
        {save.error && <ErrorAlert error={save.error} />}
        <Button className="w-full" disabled={!st.configured} loading={connect.isPending} onClick={() => connect.mutate()}><Play className="h-4 w-4" />Подключить YouTube</Button>
        {connect.error && <ErrorAlert error={connect.error} />}
      </Card>
    </div>
  );
}

function DualChart({ pts }: { pts: { sec: number; actual: number; predicted: number }[] }) {
  const W = 800, H = 220, pl = 40, pr = 10, pt = 10, pb = 24;
  const maxX = Math.max(1, ...pts.map((p) => p.sec)), maxY = Math.max(100, ...pts.map((p) => Math.max(p.actual, p.predicted)));
  const X = (x: number) => pl + (x / maxX) * (W - pl - pr), Y = (y: number) => pt + (1 - y / maxY) * (H - pt - pb);
  const line = (k: "actual" | "predicted") => pts.map((p, i) => `${i ? "L" : "M"}${X(p.sec).toFixed(1)},${Y(p[k]).toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Удержание: прогноз и реальность">
        {[0, 25, 50, 75, 100].map((v) => <g key={v}><line x1={pl} x2={W - pr} y1={Y(v)} y2={Y(v)} className="stroke-border" strokeDasharray="3 3" /><text x={pl - 6} y={Y(v) + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">{v}%</text></g>)}
        {Array.from({ length: 6 }, (_, i) => (maxX * i) / 5).map((x) => <text key={x} x={X(x)} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">{mmss(x)}</text>)}
        <path d={line("predicted")} fill="none" className="stroke-muted-foreground" strokeWidth={2} strokeDasharray="6 4" />
        <path d={line("actual")} fill="none" className="stroke-primary" strokeWidth={2.5} />
      </svg>
      <div className="flex gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-1"><span className="h-0.5 w-5 bg-primary" />реальность</span><span className="flex items-center gap-1"><span className="h-0 w-5 border-t-2 border-dashed border-muted-foreground" />прогноз «Оценки сценария»</span></div>
    </div>
  );
}

function VideoPanel({ id, projects, onClose }: { id: string; projects: ProjectSummary[]; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["my-video", id], queryFn: () => api<VRep>(`/my-analytics/video/${id}`) });
  const link = useMutation({ mutationFn: (projectId: string | null) => api("/my-analytics/link", { method: "PUT", json: { videoId: id, projectId } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["my-video", id] }) });
  const r = q.data, c = r?.compare;
  return (
    <Card className="space-y-4 p-5" data-testid="video-panel">
      <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><h3 className="font-semibold">{r?.title ?? "Загрузка…"}</h3>{r && <p className="text-xs text-muted-foreground">{mmss(r.durationSec)} · опубликовано {ago(r.publishedAt)} · <a className="underline" href={`https://youtu.be/${r.id}`} target="_blank" rel="noreferrer">на YouTube</a></p>}</div><button type="button" onClick={onClose} aria-label="Закрыть" className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button></div>
      {q.error ? <ErrorAlert error={q.error} onRetry={() => q.refetch()} /> : !r ? <Skeleton className="h-48" /> : (<>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile icon={<Eye className="h-4 w-4" />} label="Просмотры" value={compact(r.totals.views ?? 0)} />
          <StatTile icon={<Clock className="h-4 w-4" />} label="Средний просмотр" value={mmss(r.totals.averageViewDuration ?? 0)} hint={`${Math.round(r.totals.averageViewPercentage ?? 0)}% ролика`} />
          <StatTile icon={<Activity className="h-4 w-4" />} label="Часы просмотра" value={compact(Math.round((r.totals.estimatedMinutesWatched ?? 0) / 60))} />
          <StatTile icon={<UserPlus className="h-4 w-4" />} label="Подписки" value={`+${r.totals.subscribersGained ?? 0}`} hint={`−${r.totals.subscribersLost ?? 0}`} />
        </div>
        <div>
          <SectionTitle icon={<LineIcon className="h-4 w-4" />} right={<div className="flex items-center gap-2"><Link2 className="h-3.5 w-3.5 text-muted-foreground" /><Select value={r.projectId ?? ""} onChange={(e) => link.mutate(e.target.value || null)} aria-label="Проект этого видео" className="h-8 w-56 text-xs"><option value="">— связать с проектом —</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select></div>}>Удержание</SectionTitle>
          {c?.points?.length ? (<>
            <DualChart pts={c.points} />
            <div className="mt-3 grid gap-2 text-sm md:grid-cols-4" data-testid="compare">
              <div><Badge tone={c.mae! < 8 ? "success" : "crown"}>{c.verdict}</Badge><p className="mt-1 text-xs text-muted-foreground">средняя разница {c.mae} п.п.{c.score != null ? ` · балл сценария ${c.score}` : ""}</p></div>
              {c.at30 && <p className="text-xs">30 с: <b>{c.at30.actual}%</b> <span className="text-muted-foreground">(прогноз {c.at30.predicted}%)</span></p>}
              {c.mid && <p className="text-xs">Середина: <b>{c.mid.actual}%</b> <span className="text-muted-foreground">({c.mid.predicted}%)</span></p>}
              {c.end && <p className="text-xs">Конец: <b>{c.end.actual}%</b> <span className="text-muted-foreground">({c.end.predicted}%)</span></p>}
            </div>
            {!!c.drops?.length && <p className="mt-2 text-xs text-muted-foreground">Самые резкие спады: {c.drops.map((d) => `${mmss(d.sec)} (−${d.drop.toFixed(1)} п.п.)`).join(", ")} — откройте сценарий проекта и посмотрите, что звучит в эти секунды.</p>}
          </>) : r.retention.length ? (<>
            <LineChart points={r.retention.map((x) => ({ x: x.ratio * r.durationSec, y: Math.round(x.watch * 1000) / 10 }))} yMax={Math.max(100, ...r.retention.map((x) => x.watch * 100))} />
            <p className="mt-1 text-xs text-muted-foreground">{c?.error ?? "Свяжите видео с проектом, где есть «Оценка сценария», — покажем прогноз рядом с реальностью."}</p>
          </>) : <p className="text-sm text-muted-foreground">YouTube ещё не посчитал удержание (нужно несколько сотен просмотров).</p>}
        </div>
        {r.traffic.length > 0 && <div><SectionTitle>Источники трафика</SectionTitle><BarChart data={r.traffic.slice(0, 8).map((t) => ({ label: t.label, value: t.views }))} height={140} /></div>}
      </>)}
    </Card>
  );
}

export default function MyAnalytics() {
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const [days, setDays] = useState(28);
  const [view, setView] = useState<"overview" | "geography" | "ab" | "revenue" | "channels" | "reach">(sp.get("tab")==="channels"?"channels":"overview");
  const st = useQuery({ queryKey: ["yt-oauth"], queryFn: () => api<Status>("/yt-oauth/status") });
  const connected = !!st.data?.connected;
  const ov = useQuery({ queryKey: ["my-overview",st.data?.channel?.id,st.data?.connectedAt, days], queryFn: () => api<Overview>(`/my-analytics/overview?days=${days}`), enabled: connected, retry: false });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<ProjectSummary[]>("/projects"), enabled: connected });
  const lessons = useQuery({ queryKey: ["my-lessons",st.data?.channel?.id], queryFn: () => api<Lessons | null>("/my-analytics/lessons"), enabled: connected });
  const job = useJob<Lessons, unknown>("/my-analytics/lessons");
  const disc = useMutation({ mutationFn: () => api("/yt-oauth/disconnect", { method: "POST" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["yt-oauth"] }) });
  const vid = sp.get("video");
  useEffect(() => { if (sp.get("connected")) { qc.invalidateQueries({ queryKey: ["yt-oauth"] }); setSp({}, { replace: true }); } }, []); // eslint-disable-line
  useEffect(() => { if (job.status === "done") qc.invalidateQueries({ queryKey: ["my-lessons"] }); }, [job.status]); // eslint-disable-line
  const candidate=job.data??lessons.data;
  const L = candidate?.channel?.id===st.data?.channel?.id?candidate:null;
  const t = ov.data?.totals ?? {};
  return (
    <div>
      <ToolHeader icon={Activity} title="Моя аналитика" eyebrow="// YOUTUBE ANALYTICS"
        subtitle="Статистика своего OAuth-канала: просмотры, удержание и трафик; панель сохранённых каналов, география, оценочный доход и ручной журнал A/B с историей и экспортом"
        right={connected && st.data?.channel ? <div className="flex items-center gap-2 text-sm">{st.data.channel.thumbnail && <img src={st.data.channel.thumbnail} alt="" className="h-7 w-7 rounded-full" />}<b>{st.data.channel.title}</b><Button size="sm" variant="ghost" onClick={() => confirm("Отключить канал? Локальный токен будет удалён, программа попытается отозвать всё подключение Google, не только доход. История и финансовые снимки останутся. Сохранённые копии подключений не удаляются автоматически и тоже могут стать недействительными после отзыва Google.") && disc.mutate()} aria-label="Отключить канал"><LogOut className="h-4 w-4" /></Button></div> : undefined} />
      <div className="mb-5 flex flex-wrap gap-2"><Chip active={view === "overview"} onClick={() => setView("overview")}>Обзор</Chip><Chip active={view === "geography"} onClick={() => setView("geography")}>География и история</Chip><Chip active={view === "ab"} onClick={() => setView("ab")}>Журнал A/B</Chip><Chip active={view === "revenue"} onClick={() => setView("revenue")}>Доход</Chip><Chip active={view === "channels"} onClick={() => setView("channels")}>Каналы</Chip><Chip active={view === "reach"} onClick={() => setView("reach")}>Показы и CTR</Chip></div>
      {view === "reach" ? <Reach connected={connected} channel={st.data?.channel??null} /> : view === "channels" ? <Channels connected={connected} configured={!!st.data?.configured} channel={st.data?.channel??null} /> : view === "revenue" ? <Revenue configured={!!st.data?.configured} connected={connected} monetaryGranted={!!st.data?.monetaryGranted} scopeKnown={!!st.data?.scopeKnown} /> : view === "ab" ? <AbJournal /> : view === "geography" ? <Geography connected={connected} /> : st.isLoading ? <Skeleton className="h-64" /> : st.error ? <ErrorAlert error={st.error} /> : !connected ? <Setup st={st.data!} /> : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-1.5">{[7, 28, 90, 365].map((d) => <Chip key={d} active={days === d} onClick={() => setDays(d)}>{d === 365 ? "Год" : `${d} дней`}</Chip>)}{ov.data && <span className="ml-2 text-xs text-muted-foreground">{ov.data.range.startDate} — {ov.data.range.endDate}</span>}</div>
          {ov.error ? <ErrorAlert error={ov.error} onRetry={() => ov.refetch()} /> : !ov.data ? <Skeleton className="h-40" /> : (<>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="my-totals">
              <StatTile icon={<Eye className="h-4 w-4" />} label="Просмотры" value={compact(t.views ?? 0)} />
              <StatTile icon={<Clock className="h-4 w-4" />} label="Часы просмотра" value={compact(Math.round((t.estimatedMinutesWatched ?? 0) / 60))} />
              <StatTile label="Средний просмотр" value={mmss(t.averageViewDuration ?? 0)} />
              <StatTile label="Средний % просмотра" value={`${Math.round(t.averageViewPercentage ?? 0)}%`} />
              <StatTile icon={<UserPlus className="h-4 w-4" />} label="Подписчики" value={`+${(t.subscribersGained ?? 0) - (t.subscribersLost ?? 0)}`} hint={`+${t.subscribersGained ?? 0} / −${t.subscribersLost ?? 0}`} />
            </div>
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
              <Card className="p-5"><SectionTitle>Просмотры по дням</SectionTitle><LineChart points={ov.data.daily.map((d, i) => ({ x: i, y: d.views }))} yLabel={(v) => compact(v)} xLabel={(x) => ov.data!.daily[Math.round(x)]?.day.slice(5) ?? ""} /></Card>
              <Card className="p-5"><SectionTitle>Источники трафика</SectionTitle>{ov.data.traffic.length ? <ul className="space-y-1.5 text-sm">{ov.data.traffic.slice(0, 8).map((x) => { const tot = ov.data!.traffic.reduce((s, y) => s + y.views, 0) || 1; return <li key={x.source} className="flex items-center gap-2"><span className="flex-1">{x.label}</span><span className="font-mono text-xs">{Math.round((x.views / tot) * 100)}%</span></li>; })}</ul> : <p className="text-sm text-muted-foreground">Нет данных</p>}<p className="mt-3 text-[11px] text-muted-foreground">{ov.data.note}</p></Card>
            </div>
            {vid && <VideoPanel key={st.data?.channel?.id+":"+vid} id={vid} projects={projects.data ?? []} onClose={() => setSp({})} />}
            <Card className="p-5">
              <SectionTitle>Видео за период — нажмите, чтобы открыть удержание</SectionTitle>
              {!ov.data.videos.length ? <EmptyState title="Нет просмотров за период" /> : (
                <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="my-videos"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1.5">Видео</th><th>Просмотры</th><th>Ср. просмотр</th><th>% просмотра</th><th>Подписки</th></tr></thead>
                  <tbody>{ov.data.videos.map((v) => (
                    <tr key={v.id} className={cn("cursor-pointer border-t border-border hover:bg-muted/50", vid === v.id && "bg-muted")} onClick={() => setSp({ video: v.id })}>
                      <td className="flex items-center gap-2 py-2 pr-3">{v.thumbnail && <img src={v.thumbnail} alt="" className="h-9 w-16 shrink-0 rounded object-cover" />}<span className="line-clamp-2">{v.title}</span></td>
                      <td className="font-mono">{compact(v.views)}</td><td className="font-mono">{mmss(v.avgDuration)}</td>
                      <td><span className={cn("font-mono", v.avgPct >= 50 ? "text-success" : v.avgPct < 30 ? "text-accent" : "")}>{Math.round(v.avgPct)}%</span></td><td className="font-mono">+{v.subs}</td></tr>))}</tbody></table></div>)}
            </Card>
          </>)}
          <Card className="space-y-3 p-5">
            <SectionTitle icon={<Lightbulb className="h-4 w-4" />} right={job.status === "running" ? <Button size="sm" variant="danger" onClick={job.cancel}><X className="h-3.5 w-3.5" />Стоп</Button> : <Button size="sm" onClick={() => job.start({ days: 90 })}>{L ? "Обновить уроки" : "Найти уроки"}</Button>}>Уроки канала (ИИ, 90 дней)</SectionTitle>
            {job.status === "running" && <ProgressBar value={job.pct} label={job.stage} />}
            {job.status === "error" && <ErrorAlert error={job.error} />}
            {!L ? <p className="text-sm text-muted-foreground">ИИ сравнит сильные и слабые ролики (темы, длина, % просмотра, удержание, подписки) и даст выводы, эксперименты и правила для Сценариста. Откройте пару видео выше — их кривые удержания тоже попадут в анализ.</p> : (
              <div className="space-y-3 text-sm" data-testid="lessons">
                <p>{L.summary}</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div><b className="text-success">Работает</b><ul className="mt-1 space-y-2">{L.working.map((x, i) => <li key={i}><b>{x.title}.</b> <span className="text-muted-foreground">{x.evidence}</span> → {x.action}</li>)}</ul></div>
                  <div><b className="text-accent">Мешает</b><ul className="mt-1 space-y-2">{L.notWorking.map((x, i) => <li key={i}><b>{x.title}.</b> <span className="text-muted-foreground">{x.evidence}</span> → {x.action}</li>)}</ul></div>
                </div>
                <div><b>Эксперименты</b><ul className="mt-1 list-disc pl-5">{L.experiments.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                <div><b>Правила для сценария</b><ul className="mt-1 list-disc pl-5">{L.forScript.map((x, i) => <li key={i}>{x}</li>)}</ul><div className="mt-2"><CopyButton text={L.forScript.join("\n")} label="Копировать правила" /></div></div>
                <p className="text-xs text-muted-foreground">{L.videos} видео · {ago(L.createdAt)} · {L.model}</p>
              </div>)}
          </Card>
        </div>)}
    </div>
  );
}
