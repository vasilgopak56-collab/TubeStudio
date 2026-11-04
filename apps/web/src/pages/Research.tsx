import ResearchEvidence from './ResearchEvidence';
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Check, ExternalLink, Flame, History, Image as ImageIcon, LayoutList, Play, RefreshCw, Save, Search, Settings2, Sparkles, Wand2, X, MessageSquareText } from "lucide-react";
import { api, type Filters } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { useSaveSettings, useSettings } from "@/lib/queries";
import { ago, compact, dur } from "@/lib/format";
import { Badge, Button, Card, Chip, EmptyState, ErrorAlert, Input, ProgressBar, SectionTitle, Select, Skeleton, ToolHeader } from "@/components/ui";
import { FiltersPanel, filtersSummary } from "@/features/research/FiltersPanel";
import { type ResearchInput, type ResearchRow, type ResearchRun, type Sort, ytUrl } from "@/features/research/types";

const SORTS: [Sort, string][] = [["outlier", "Outlier Score"], ["vph", "VPH"], ["views", "Просмотры"], ["ratio", "Просмотры/подп."], ["date", "Новые"]];
const EMPTY: Filters = { type: "all", viralOnly: false };
const ANOMALY: Filters = { ...EMPTY, subsMax: 10000, viewsMin: 50000, ratioMin: 10, ageDays: 30 };
const ANOMALY_PRESETS: { id: string; name: string; filters: Filters }[] = [
  { id: "anomaly-default", name: "50K+ за 30 дней", filters: ANOMALY },
  { id: "anomaly-fast", name: "Быстрый взлёт: 7 дней", filters: { ...ANOMALY, ageDays: 7 } },
  { id: "anomaly-big", name: "100K+ за 90 дней", filters: { ...ANOMALY, viewsMin: 100000, ageDays: 90 } },
];

function OutlierBadge({ v }: { v: number | null }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  const tone = v >= 20 ? "text-crown" : v >= 5 ? "text-success" : v >= 2 ? "text-primary" : "text-muted-foreground";
  return <span className={`font-mono font-semibold ${tone}`}>{v >= 100 ? Math.round(v) : v}×</span>;
}
const vphOf = (r: ResearchRow) => r.vphRecent ?? r.vph;

function SaveBtn({ r, q }: { r: ResearchRow; q: string }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api("/saved-topics", { method: "POST", json: { title: r.title.slice(0, 300), niche: q, score: r.outlier ? Math.min(100, Math.round(40 + Math.log10(r.outlier + 1) * 30)) : undefined, source: "research", notes: `Outlier ${r.outlier ?? "—"}× · VPH ${Math.round(vphOf(r))} · ${compact(r.views)} просм. · канал ${r.channelTitle} (${compact(r.subs)} подп.) · ${ytUrl(r.id)}`, meta: { videoId: r.id, outlier: r.outlier, vph: vphOf(r), views: r.views, subs: r.subs } } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-topics"] }),
  });
  return <Button size="sm" variant="ghost" onClick={() => m.mutate()} disabled={m.isSuccess} loading={m.isPending} aria-label="Сохранить тему" title="В «Сохранённые темы»">{m.isSuccess ? <Check className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}{m.isSuccess ? "Сохранено" : "Сохранить"}</Button>;
}

function VideoList({ rows, q, onSimilar, anomaly = false }: { rows: ResearchRow[]; q: string; onSimilar: (t: string) => void; anomaly?: boolean }) {
  const nav = useNavigate();
  return (
    <div className="space-y-2" data-testid="research-rows">
      {rows.map((r) => (
        <Card key={r.id} className="flex flex-col gap-3 p-3 sm:flex-row">
          <a href={ytUrl(r.id)} target="_blank" rel="noreferrer" className="relative shrink-0">
            {r.thumbnail ? <img src={r.thumbnail} alt="" className="h-[90px] w-[160px] rounded-md object-cover" loading="lazy" /> : <div className="h-[90px] w-[160px] rounded-md bg-muted" />}
            <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 font-mono text-[10px] text-white">{dur(r.durationSec)}</span>
          </a>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <a href={ytUrl(r.id)} target="_blank" rel="noreferrer" className="line-clamp-2 flex-1 font-medium hover:text-primary">{r.title}</a>
              {anomaly && <Badge tone="crown">Аномалия</Badge>}
              {r.viral && <Badge tone="crown" title={r.viralWhy}><Flame className="h-3 w-3" />вирусный</Badge>}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              {r.channelAvatar && <img src={r.channelAvatar} alt="" className="h-4 w-4 rounded-full" />}
              <a href={`https://www.youtube.com/channel/${r.channelId}`} target="_blank" rel="noreferrer" className="truncate hover:text-primary">{r.channelTitle}</a><span>· {r.hiddenSubs ? "подп. скрыты" : `${compact(r.subs)} подп.`}</span><span>· {ago(r.publishedAt)}</span>{r.isShort && <Badge>Shorts</Badge>}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-sm sm:grid-cols-5" title={r.viralWhy}>
              <div><div className="mono-label" title="Не то же самое, что просмотры / подписчики: сравнение с обычными видео канала">Outlier</div><OutlierBadge v={r.outlier} /></div>
              <div><div className="mono-label">VPH{r.vphRecent != null ? " сейчас" : ""}</div><span className="font-mono">{compact(Math.round(vphOf(r)))}</span></div>
              <div><div className="mono-label">Просмотры</div><span className="font-mono">{compact(r.views)}</span></div>
              <div><div className="mono-label">Просм./подп.</div><span className="font-mono">{r.ratio != null ? `${r.ratio >= 10 ? Math.round(r.ratio) : r.ratio}×` : "—"}</span></div>
              <div><div className="mono-label">Вовлечённость</div><span className="font-mono">{r.engagement}%</span></div>
            </div>
          </div>
          <div className="flex shrink-0 flex-row flex-wrap items-start gap-1 sm:w-[150px] sm:flex-col">
            <SaveBtn r={r} q={q} />
            <Button size="sm" variant="ghost" onClick={() => onSimilar(r.title)}><Sparkles className="h-3.5 w-3.5" />Похожие идеи</Button>
            <Button size="sm" variant="ghost" onClick={() => nav(`/script?topic=${encodeURIComponent(r.title)}`)}><Wand2 className="h-3.5 w-3.5" />В сценарий</Button>
            <Button size="sm" variant="ghost" onClick={() => nav(`/comments?v=${encodeURIComponent(ytUrl(r.id))}&auto=1`)} aria-label="Анализ комментариев"><MessageSquareText className="h-3.5 w-3.5" />Комментарии</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function ThumbGrid({ rows, onSimilar }: { rows: ResearchRow[]; onSimilar: (t: string) => void }) {
  const nav = useNavigate();
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="research-thumbs">
      {rows.filter((r) => r.thumbnail).map((r) => {
        const big = r.thumbnail!.replace(/\/(mq|default|sd)default\.jpg/, "/hqdefault.jpg");
        return (
          <Card key={r.id} className="overflow-hidden">
            <a href={ytUrl(r.id)} target="_blank" rel="noreferrer" className="relative block">
              <img src={big} alt={r.title} className="aspect-video w-full object-cover" loading="lazy" />
              <div className="absolute left-2 top-2 flex gap-1">
                <span className="rounded bg-black/80 px-1.5 py-0.5 font-mono text-[11px] text-white">{r.outlier != null ? `${r.outlier >= 100 ? Math.round(r.outlier) : r.outlier}×` : "—"}</span>
                <span className="rounded bg-black/80 px-1.5 py-0.5 font-mono text-[11px] text-white">{compact(Math.round(vphOf(r)))} VPH</span>
                {r.viral && <span className="rounded bg-crown px-1.5 py-0.5 text-[11px] font-semibold text-black">🔥</span>}
              </div>
            </a>
            <div className="p-3">
              <p className="line-clamp-2 text-sm font-medium">{r.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{r.channelTitle} · {r.hiddenSubs ? "подп. неизвестны" : `${compact(r.subs)} подп.`} · {compact(r.views)} просм.</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Button size="sm" variant="outline" onClick={() => nav(`/thumbnail?remix=${encodeURIComponent(big)}&title=${encodeURIComponent(r.title)}`)}><Wand2 className="h-3.5 w-3.5" />Ремикс</Button>
                <Button size="sm" variant="ghost" onClick={() => onSimilar(r.title)}><ImageIcon className="h-3.5 w-3.5" />Похожие</Button>
                <a className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" href={big.replace("hqdefault", "maxresdefault")} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" />Оригинал</a>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function ChannelList({ rows, q }: { rows: ResearchRow[]; q: string }) {
  const nav = useNavigate();
  const tracking = useMutation({ mutationFn: (channel: string) => api("/competitors", { method: "POST", json: { channel } }) });
  const groups = useMemo(() => {
    const m = new Map<string, ResearchRow[]>();
    for (const row of rows) m.set(row.channelId, [...(m.get(row.channelId) ?? []), row]);
    return [...m.values()]; // preserve selected video ranking, avoid summing ratios or growth
  }, [rows]);
  return <div className="grid gap-4 lg:grid-cols-2" data-testid="anomaly-channels">
    {tracking.error && <ErrorAlert error={tracking.error} />}
    {groups.map((hits) => {
      const first = hits[0];
      return <Card key={first.channelId} className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          {first.channelAvatar && <img src={first.channelAvatar} alt="" className="h-10 w-10 rounded-full" />}
          <div className="min-w-0 flex-1"><a href={`https://www.youtube.com/channel/${first.channelId}`} target="_blank" rel="noreferrer" className="font-semibold hover:text-primary">{first.channelTitle}</a><p className="text-xs text-muted-foreground">{compact(first.subs)} подп. сейчас · {first.channelVideos} видео на канале · найдено аномалий: {hits.length}</p></div>
          <Badge tone="crown">Аномалия</Badge>
        </div>
        <div className="space-y-3">{hits.slice(0, 3).map((hit) => <div key={hit.id} className="flex gap-3">
          <a href={ytUrl(hit.id)} target="_blank" rel="noreferrer" className="shrink-0">{hit.thumbnail && <img src={hit.thumbnail} alt="" className="h-[68px] w-[120px] rounded object-cover" loading="lazy" />}</a>
          <div className="min-w-0"><a href={ytUrl(hit.id)} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm hover:text-primary">{hit.title}</a><p className="mt-1 text-xs text-muted-foreground"><b className="text-foreground">{compact(hit.views)} просмотров</b> · {hit.ageDays < 1 ? "меньше суток" : `${Math.ceil(hit.ageDays)} дн.`} · {hit.ratio}× подписчиков · {compact(Math.round(hit.vph))} VPH в среднем</p><SaveBtn r={hit} q={q} /></div>
        </div>)}</div>
        {hits.length > 3 && <p className="text-xs text-muted-foreground">Ещё {hits.length - 3} — во вкладке «Видео».</p>}
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => nav(`/analysis?channel=${encodeURIComponent(first.channelId)}`)}>Анализ канала</Button><Button size="sm" variant="ghost" loading={tracking.isPending && tracking.variables === first.channelId} disabled={tracking.isPending || (tracking.isSuccess && tracking.variables === first.channelId)} onClick={() => tracking.mutate(first.channelId)}>{tracking.isSuccess && tracking.variables === first.channelId ? "Добавлен в конкуренты" : "Отслеживать канал"}</Button></div>
      </Card>;
    })}
  </div>;
}

function LegacyResearch({ anomalyMode = false }: { anomalyMode?: boolean }) {
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const settings = useSettings();
  const saveSettings = useSaveSettings();
  const R = settings.data?.research;
  const job = useJob<ResearchRun, ResearchInput>("/research/videos");
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [f, setF] = useState<Filters>(anomalyMode ? ANOMALY : EMPTY);
  const [sort, setSort] = useState<Sort>(anomalyMode ? "ratio" : "outlier");
  const [pages, setPages] = useState<number | null>(anomalyMode ? 2 : null);
  const [view, setView] = useState<"channels" | "videos" | "thumbs">(sp.get("view") === "thumbs" ? "thumbs" : sp.get("view") === "videos" ? "videos" : anomalyMode ? "channels" : "videos");
  const [preset, setPreset] = useState<string | null>(anomalyMode ? "anomaly-default" : null);
  const presets = anomalyMode ? ANOMALY_PRESETS : R?.presets ?? [];
  const runId = sp.get("run");

  const runs = useQuery({ queryKey: ["research-runs", anomalyMode], queryFn: () => api<{ id: string; createdAt: string; q: string; shown: number; fetched: number }[]>(`/research/runs?mode=${anomalyMode ? "anomalies" : "outliers"}`) });
  const opened = useQuery({ queryKey: ["research-run", runId], queryFn: () => api<ResearchRun>(`/research/runs/${runId}`), enabled: !!runId && job.data?.id !== runId && job.status !== "running" });
  const p = pages ?? R?.pages ?? 1;
  const est = useQuery({ queryKey: ["research-est", p, R?.outlierBase], queryFn: () => api<{ units: number }>(`/research/estimate?pages=${p}`), enabled: !!R });
  const sugg = useQuery({ queryKey: ["suggest", q], queryFn: () => api<{ keyword: string }[]>(`/research/suggest?q=${encodeURIComponent(q)}`), enabled: q.trim().length >= 3, staleTime: 3600_000 });

  useEffect(() => { if (job.status === "done" && job.data) { setSp({ run: job.data.id, ...((view === "thumbs" || (anomalyMode && view === "videos")) ? { view } : {}) }, { replace: true }); qc.invalidateQueries({ queryKey: ["research-runs"] }); qc.invalidateQueries({ queryKey: ["usage"] }); qc.invalidateQueries({ queryKey: ["yt-pool"] }); } }, [job.status, job.data]); // eslint-disable-line
  useEffect(() => { if (opened.data) { setQ(opened.data.input.q); setF({ ...EMPTY, ...opened.data.input.filters }); setSort(opened.data.input.sort); } }, [opened.data]);
  useEffect(() => { if (sp.get("q") && sp.get("auto") === "1" && R) start(sp.get("q")!); }, [!!R]); // eslint-disable-line

  const shown = job.status === "running" ? undefined : job.data && (!runId || job.data.id === runId) ? job.data : opened.data;
  const start = (query = q, filters = f) => { const qq = query.trim(); if (qq.length < 2) return; setQ(qq); job.start({ mode: anomalyMode ? "anomalies" : "outliers", q: qq, filters, sort, pages: p, ...(anomalyMode ? { order: "viewCount" as const } : {}) }); };
  const similar = (t: string) => { window.scrollTo({ top: 0, behavior: "smooth" }); start(t); };
  const applyPreset = (id: string) => { const pr = presets.find((x) => x.id === id); if (pr) { setF({ ...EMPTY, ...pr.filters }); setPreset(id); } };
  const savePreset = () => {
    const name = window.prompt("Название пресета", filtersSummary(f).slice(0, 60)); if (!name || !R) return;
    saveSettings.mutate({ research: { ...R, presets: [...R.presets, { id: Math.random().toString(36).slice(2, 8), name: name.slice(0, 60), filters: f }] } });
  };
  const rows = useMemo(() => shown?.rows ?? [], [shown]);
  const viralN = rows.filter((r) => r.viral).length;

  return (
    <div>
      <ToolHeader icon={anomalyMode ? Flame : Search} title={anomalyMode ? "Аномалии" : "Исследование"} eyebrow={anomalyMode ? "// SMALL CHANNELS · BIG VIEWS" : "// RESEARCH · OUTLIERS"}
        subtitle={anomalyMode ? "Маленькие каналы, большие просмотры: найдите свежие хиты по ключевому запросу — без привязки к своему каналу" : "Видео и обложки, которые в разы обогнали свой канал: Outlier Score, просмотры в час, фильтры по подписчикам и просмотрам — как Research во vidIQ"}
        right={<Link to="/settings#research" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><Settings2 className="h-4 w-4" />Настройки</Link>} />

      {anomalyMode && <Card className="mb-5 space-y-2 p-4" data-testid="anomaly-explainer"><p className="text-sm font-semibold">Архивная методика: исходная база Outlier не закреплена, возможна подмена медианы средним канала. Проверяемое сравнение доступно в «Outliers и обложки». Это не доказательство вирусности.</p><p className="text-sm">По умолчанию: <b>до 10 000 подписчиков · от 50 000 просмотров · за 30 дней · просмотры ≥ 10× подписчиков</b>. Меняйте пороги ниже. Outlier не обязателен: ищем и молодые каналы с первым хитом.</p><p className="text-xs text-muted-foreground">Сравниваем просмотры с числом подписчиков сейчас, не на дату публикации. Это сигнал для изучения темы, а не доказательство органического роста или гарантия успеха. Поиск YouTube ограничен выбранной глубиной и не охватывает все каналы.</p></Card>}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <Card brackets className="p-5">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); start(); }}>
            <div className="flex gap-2">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ключевое слово или тема: психология, история Рима…" list="research-sugg" autoFocus aria-label="Запрос" />
              <datalist id="research-sugg">{(sugg.data ?? []).map((s) => <option key={s.keyword} value={s.keyword} />)}</datalist>
              {job.status === "running" ? <Button type="button" variant="danger" onClick={job.cancel}><X className="h-4 w-4" />Стоп</Button> : <Button type="submit" disabled={q.trim().length < 2}><Play className="h-4 w-4" />Найти</Button>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mono-label mr-1">Пресеты</span>
              {presets.map((pr) => <Chip key={pr.id} active={preset === pr.id} onClick={() => applyPreset(pr.id)} title={filtersSummary(pr.filters)}>{pr.name}</Chip>)}
              <Chip onClick={() => { setF(anomalyMode ? ANOMALY : EMPTY); setSort(anomalyMode ? "ratio" : "outlier"); setPreset(anomalyMode ? "anomaly-default" : null); }}>Сброс</Chip>
              {!anomalyMode && <Button type="button" size="sm" variant="ghost" onClick={savePreset}><Save className="h-3.5 w-3.5" />Сохранить пресет</Button>}
            </div>
            <FiltersPanel anomaly={anomalyMode} f={f} onChange={(x) => { setF(x); setPreset(null); }} />
            <div className="flex flex-wrap items-center gap-4 border-t border-border pt-3 text-sm">
              <label className="flex items-center gap-2"><span className="mono-label">Сортировка</span><Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-9 w-auto">{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></label>
              <div className="flex items-center gap-1.5"><span className="mono-label">Глубина</span>{[1, 2, 3, 4].map((n) => <Chip key={n} active={p === n} onClick={() => setPages(n)}>{n * 50}</Chip>)}</div>
              <span className="text-xs text-muted-foreground" data-testid="research-cost">≈ {est.data?.units ?? "…"} ед. квоты YouTube{R?.outlierBase === "median" ? " (точный Outlier по медиане канала)" : ""}</span>
            </div>
            {job.status === "running" && <ProgressBar value={job.pct} label={job.stage} />}
            {job.status === "error" && <ErrorAlert error={job.error} onRetry={() => start()} />}
          </form>
        </Card>

        <Card className="p-5">
          <SectionTitle icon={<History className="h-4 w-4" />} right={<button onClick={() => runs.refetch()} className="text-muted-foreground hover:text-foreground" aria-label="Обновить"><RefreshCw className="h-3.5 w-3.5" /></button>}>Недавние поиски</SectionTitle>
          {runs.isLoading ? <Skeleton className="h-24" /> : !runs.data?.length ? <p className="text-sm text-muted-foreground">Пока пусто</p> : (
            <ul className="max-h-[420px] space-y-1 overflow-auto">
              {runs.data.map((x) => (
                <li key={x.id}><button onClick={() => setSp({ run: x.id })} className={`w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${x.id === runId ? "bg-muted" : ""}`}>
                  <span className="block truncate">{x.q}</span><span className="block text-xs text-muted-foreground">{x.shown} из {x.fetched} · {ago(x.createdAt)}</span>
                </button></li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-8">
        {opened.isLoading && !shown && <Skeleton className="h-96" />}
        {opened.error && !shown && <ErrorAlert error={opened.error} />}
        {shown && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="flex gap-1.5">
                {anomalyMode && <Chip active={view === "channels"} onClick={() => setView("channels")}>Каналы</Chip>}
                <Chip active={view === "videos"} onClick={() => setView("videos")}><LayoutList className="h-3.5 w-3.5" />Видео</Chip>
                <Chip active={view === "thumbs"} onClick={() => setView("thumbs")}><ImageIcon className="h-3.5 w-3.5" />Обложки</Chip>
              </div>
              <p className="text-sm text-muted-foreground" data-testid="research-summary">«{shown.input.q}»: <b className="text-foreground">{shown.stats.shown}</b> из {shown.stats.fetched} видео{anomalyMode ? ` · каналов с аномалиями: ${new Set(rows.map((r) => r.channelId)).size}` : ""} · вирусный потенциал: <b className="text-crown">{viralN}</b> · {filtersSummary(shown.input.filters)} · потрачено ≈ {shown.stats.units} ед.{shown.base === "average" ? " · Outlier по среднему за всё время" : ""}</p>
            </div>
            {!rows.length ? <EmptyState icon={<Search className="h-6 w-6" />} title="Под фильтры ничего не попало">{anomalyMode ? "Попробуйте 90 дней, минимум 20 000 просмотров или максимум 20 000 подписчиков. Можно изменить запрос и увеличить глубину. Каналы со скрытым/неизвестным числом подписчиков не включаются." : "Ослабьте фильтры (например, Outlier ≥ 5 вместо 20) или увеличьте глубину поиска."}</EmptyState>
              : view === "channels" ? <ChannelList rows={rows} q={shown.input.q} /> : view === "videos" ? <VideoList rows={rows} q={shown.input.q} onSimilar={similar} anomaly={anomalyMode} /> : <ThumbGrid rows={rows} onSimilar={similar} />}
            <p className="mt-4 text-xs text-muted-foreground">Outlier — просмотры видео ÷ {shown.base === "median" ? "медиана просмотров последних видео канала" : "среднее просмотров канала за всё время"}. VPH — просмотры ÷ часы с публикации; «VPH сейчас» — по разнице с прошлым снимком (если видео уже встречалось). Вирусный потенциал — правило из настроек. {anomalyMode && "Аномалия — соответствие заданным порогам размера канала, просмотров, возраста и просмотры/подписчики; это не то же самое, что Outlier. Подписчики округлены YouTube; близкие к границе значения могут быть неточными."}</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function Research({anomalyMode=false}:{anomalyMode?:boolean}){return anomalyMode?<LegacyResearch anomalyMode/>:<ResearchEvidence/>;}
