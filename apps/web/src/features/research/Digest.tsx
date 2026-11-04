import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Check, Flame, Lightbulb, Newspaper, Play, Trash2, Wand2, X } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { ago, compact } from "@/lib/format";
import { Badge, Button, Card, Chip, ErrorAlert, ProgressBar, SectionTitle, Skeleton } from "@/components/ui";
import { type RateInterval, type OutlierBasis, ytUrl } from "./types";

import { OutlierDetails } from "./OutlierBasis";

type DVideo = { id: string; title: string; channelTitle: string; thumbnail?: string; publishedAt: string; isShort: boolean; views: number; viewsKnown?: boolean; interval?: RateInterval | null; rateReason?: string; outlierBasis?:OutlierBasis; outlier: number | null; vph: number | null; vphRecent: number | null; ageDays: number };
type DTopic = { title: string; angle: string; hook: string; why: string; format: "long" | "short"; basedOn: string[] };
export type DigestT = {
  id: string; createdAt: string; days: number; auto: boolean; model: string; channels: number; considered: number;
  summary: string; hits: { videoId: string; why: string; lesson: string }[]; patterns: string[]; topics: DTopic[]; avoid: string[]; videos: DVideo[];
};

function SaveTopic({ t }: { t: DTopic }) {
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: () => api("/saved-topics", { method: "POST", json: { title: t.title, source: "digest", notes: `${t.angle}\n\nХук: ${t.hook}\n\nПочему: ${t.why}` } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-topics"] }) });
  return <Button size="sm" variant="ghost" onClick={() => m.mutate()} disabled={m.isSuccess} loading={m.isPending} aria-label="Сохранить тему">{m.isSuccess ? <Check className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}Сохранить</Button>;
}

export function DigestView({ d }: { d: DigestT }) {
  const nav = useNavigate();
  const byId = new Map(d.videos.map((v) => [v.id, v]));
  return (
    <div className="space-y-5" data-testid="digest">
      <p className="text-sm leading-relaxed">{d.summary}</p>
      <div>
        <div className="mono-label mb-2">Выбранные видео · гипотезы AI</div>
        <div className="space-y-2">
          {d.videos.map((v) => { const h = d.hits.find((x) => x.videoId === v.id); return (
            <div key={v.id} className="flex gap-3 rounded-md border border-border p-2.5">
              <a href={ytUrl(v.id)} target="_blank" rel="noreferrer" className="shrink-0">{v.thumbnail ? <img src={v.thumbnail} alt="" className="h-[63px] w-[112px] rounded object-cover" loading="lazy" /> : <div className="h-[63px] w-[112px] rounded bg-muted" />}</a>
              <div className="min-w-0 flex-1 text-sm">
                <a href={ytUrl(v.id)} target="_blank" rel="noreferrer" className="line-clamp-1 font-medium hover:text-primary">{v.title}</a>
                <div className="text-xs text-muted-foreground">{v.channelTitle} · {ago(v.publishedAt)} · {v.viewsKnown === false ? "—" : compact(v.views)} просм. · <span className={(v.outlier ?? 0) >= 3 ? "font-semibold text-crown" : ""}>{v.outlier==null?"—":Number(v.outlier.toFixed(2))}×</span> · {v.vphRecent != null ? `${compact(Math.round(v.vphRecent))} VPH между снимками` : v.vph != null ? `${compact(Math.round(v.vph))} VPH за всё время` : "VPH —"}{v.isShort ? " · ≤180 с (не статус Shorts)" : ""}</div>
                {v.interval ? <p className="break-all text-xs text-muted-foreground">{v.interval.from} → {v.interval.to} · {v.interval.hours.toFixed(2)} ч</p> : v.vphRecent != null && <p className="text-xs text-muted-foreground">Архивная скорость: границы интервала неизвестны.</p>}
                {v.rateReason && <p className="text-xs text-muted-foreground">{v.rateReason}</p>}
                {v.outlierBasis?<OutlierDetails basis={v.outlierBasis}/>:<p className="mt-1 text-xs text-muted-foreground">Архивный Outlier: исходная база не подтверждена.</p>}
                {h && <p className="mt-1 text-xs leading-relaxed"><b>Почему:</b> {h.why} <span className="text-muted-foreground">→ {h.lesson}</span></p>}
              </div>
            </div>); })}
        </div>
      </div>
      {d.patterns.length > 0 && <div><div className="mono-label mb-1.5">Наблюдения AI</div><ul className="list-disc space-y-1 pl-5 text-sm">{d.patterns.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
      <div>
        <div className="mono-label mb-2">Темы-ответы для вашего канала</div>
        <div className="grid gap-3 md:grid-cols-2">
          {d.topics.map((t, i) => (
            <Card key={i} className="p-3" data-testid="digest-topic">
              <div className="flex items-start gap-2"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><b className="flex-1 text-sm">{t.title}</b>{t.format === "short" && <Badge>Shorts</Badge>}</div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t.angle}</p>
              <p className="mt-1.5 text-xs leading-relaxed"><b>Хук:</b> {t.hook}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground"><b className="text-foreground">Гипотеза:</b> {t.why}{t.basedOn.length ? ` (ответ на: ${t.basedOn.map((id) => byId.get(id)?.title).filter(Boolean).map((x) => `«${x!.slice(0, 40)}»`).join(", ")})` : ""}</p>
              <div className="mt-2 flex gap-1"><SaveTopic t={t} /><Button size="sm" variant="ghost" onClick={() => nav(`/script?topic=${encodeURIComponent(t.title)}`)}><Wand2 className="h-3.5 w-3.5" />В сценарий</Button></div>
            </Card>
          ))}
        </div>
      </div>
      {d.avoid.length > 0 && <div><div className="mono-label mb-1.5">Что проверить вручную</div><ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{d.avoid.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
      <p className="text-xs text-muted-foreground">{d.channels} каналов · {d.considered} видео за {d.days} дн. · модель {d.model}{d.auto ? " · собран автоматически" : ""}</p>
    </div>
  );
}

export function DigestCard({ hasChannels, days }: { hasChannels: boolean; days: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [period, setPeriod] = useState<number | null>(null);
  const job = useJob<DigestT, { days?: number }>("/competitors/digest");
  const list = useQuery({ queryKey: ["digests"], queryFn: () => api<{ id: string; createdAt: string; days: number; auto: boolean; topics: number; hits: number }[]>("/competitors/digests") });
  const cur = open ?? list.data?.[0]?.id ?? null;
  const one = useQuery({ queryKey: ["digest", cur], queryFn: () => api<DigestT>(`/competitors/digests/${cur}`), enabled: !!cur && job.status !== "running" && job.data?.id !== cur });
  const del = useMutation({ mutationFn: (id: string) => api(`/competitors/digests/${id}`, { method: "DELETE" }), onSuccess: () => { setOpen(null); qc.invalidateQueries({ queryKey: ["digests"] }); } });
  useEffect(() => { if (job.status === "done" && job.data) { setOpen(job.data.id); qc.invalidateQueries({ queryKey: ["digests"] }); qc.invalidateQueries({ queryKey: ["usage"] }); } }, [job.status]); // eslint-disable-line
  const shown = job.status === "running" ? undefined : job.data && job.data.id === cur ? job.data : one.data;
  const p = period ?? days;
  return (
    <Card className="mt-6 p-5" data-testid="digest-card">
      <SectionTitle icon={<Newspaper className="h-4 w-4" />} right={
        <div className="flex flex-wrap items-center gap-1.5">
          {[7, 14, 30].map((n) => <Chip key={n} active={p === n} onClick={() => setPeriod(n)}>{n} дн.</Chip>)}
          {job.status === "running" ? <Button size="sm" variant="danger" onClick={job.cancel}><X className="h-3.5 w-3.5" />Стоп</Button>
            : <Button size="sm" onClick={() => job.start({ days: p })} disabled={!hasChannels}><Play className="h-3.5 w-3.5" />Собрать дайджест</Button>}
        </div>}>Дайджест: гипотезы по выборке</SectionTitle>
      <p className="-mt-2 mb-3 text-xs text-muted-foreground">ИИ предлагает гипотезы по ограниченной сохранённой выборке трекера, не объясняет доказанную причину успеха и не измеряет спрос. Отбор по Outlier и среднему VPH, не по скорости «сейчас». Без новых запросов YouTube; отдельный платный AI-запрос, повторы/резервные модели по настройкам. Новые дайджесты сохраняют базу Outlier каждого видео, старые не пересчитываются.</p>
      {job.status === "running" && <ProgressBar value={job.pct} label={job.stage} />}
      {job.status === "error" && <ErrorAlert error={job.error} onRetry={() => job.start({ days: p })} />}
      {(list.data?.length ?? 0) > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="mono-label mr-1">Архив</span>
          {list.data!.slice(0, 10).map((x) => <Chip key={x.id} active={x.id === cur} onClick={() => setOpen(x.id)}>{new Date(x.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })} · {x.days} дн.{x.auto ? " · авто" : ""}</Chip>)}
        </div>
      )}
      {one.isLoading && !shown ? <Skeleton className="h-40" /> : shown ? (
        <>
          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground"><Flame className="h-3.5 w-3.5 text-crown" />Дайджест от {ago(shown.createdAt)}<button className="ml-auto inline-flex items-center gap-1 hover:text-accent" onClick={() => del.mutate(shown.id)} aria-label="Удалить дайджест"><Trash2 className="h-3.5 w-3.5" />Удалить</button></div>
          <DigestView d={shown} />
        </>
      ) : job.status !== "running" && <p className="text-sm text-muted-foreground">{hasChannels ? "Дайджестов пока нет — нажмите «Собрать дайджест». Автосбор раз в неделю включается в Настройках → Исследование." : "Сначала добавьте конкурентов."}</p>}
    </Card>
  );
}
