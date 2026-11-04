import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Download, History, Play, RefreshCw, X } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { ago } from "@/lib/format";
import type { Report, ReportIndexRow } from "@/lib/types";
import { Button, Card, Chip, ErrorAlert, Input, Label, ProgressBar, SectionTitle, Skeleton, Switch, ToolHeader } from "@/components/ui";
import { ChannelHeader, Diagnosis, IncomeAndWindow, InsightsError, NicheVerdict, Outliers, Schedule, StatsRow, Tags, Top3, VideoGrid } from "@/features/analysis/blocks";
import { reportToMarkdown } from "@/features/analysis/markdown";

type Input = { channel: string; videos: 15 | 30 | 50 | 100; type: "all" | "long" | "shorts"; niche?: string; force?: boolean };
const TYPES = [["all", "Все"], ["long", "Длинные"], ["shorts", "Shorts"]] as const;

function download(r: Report) {
  const blob = new Blob([reportToMarkdown(r)], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `analysis-${(r.channel.handle ?? r.channel.title).replace(/[^\p{L}\p{N}_-]+/gu, "_")}-${r.createdAt.slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function ReportView({ r, onUpdate, loadingAi }: { r: Report; onUpdate?: (r: Report) => void; loadingAi?: boolean }) {
  const hasAi = !!r.insights;
  return (
    <div className="space-y-6">
      <ChannelHeader r={r} />
      <StatsRow r={r} />
      <IncomeAndWindow r={r} />
      {r.insightsError && <InsightsError msg={r.insightsError} />}
      {hasAi ? <NicheVerdict r={r} /> : loadingAi && <Skeleton className="h-64" />}
      {hasAi ? <Diagnosis r={r} /> : loadingAi && <Skeleton className="h-80" />}
      <Top3 r={r} />
      <Schedule r={r} />
      <Tags r={r} />
      <VideoGrid r={r} />
      {r.outlierSets?.length > 0 ? <Outliers r={r} onUpdate={onUpdate ?? (() => {})} /> : loadingAi && <Skeleton className="h-64" />}
    </div>
  );
}

export default function Analysis() {
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const reportId = sp.get("report");
  const job = useJob<Report, Input>("/youtube/channel-analysis");
  const [f, setF] = useState<Input>({ channel: sp.get("channel") ?? "", videos: 30, type: "all", niche: "", force: false });

  const reports = useQuery({ queryKey: ["reports"], queryFn: () => api<ReportIndexRow[]>("/youtube/reports") });
  const opened = useQuery({ queryKey: ["report", reportId], queryFn: () => api<Report>(`/youtube/reports/${reportId}`), enabled: !!reportId && job.status !== "running" && job.data?.id !== reportId });

  useEffect(() => {
    if (job.status === "done" && job.data) { setSp({ report: job.data.id }, { replace: true }); qc.invalidateQueries({ queryKey: ["reports"] }); qc.invalidateQueries({ queryKey: ["usage"] }); }
  }, [job.status, job.data, setSp, qc]);

  const shown: Report | undefined = job.status === "running" ? (job.partial?.channel ? (job.partial as Report) : undefined)
    : job.data && job.data.id === reportId ? job.data : reportId ? opened.data : job.data;
  const update = (r: Report) => { job.set(r); qc.setQueryData(["report", r.id], r); };
  const submit = () => { if (f.channel.trim().length >= 2) job.start({ ...f, channel: f.channel.trim(), niche: f.niche?.trim() || undefined }); };

  return (
    <div>
      <ToolHeader icon={BarChart3} title="Анализ канала" eyebrow="// YOUTUBE ANALYTICS"
        subtitle="Метрики, доход, вердикт ниши, диагноз, лучшее время публикации и outlier-темы по любому каналу"
        right={shown && job.status !== "running" ? <Button variant="outline" onClick={() => download(shown)}><Download className="h-4 w-4" />Markdown</Button> : undefined} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card brackets className="p-5">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div>
              <Label required hint="Ссылка, @handle, ID канала (UC…) или ссылка на любое видео канала">Канал</Label>
              <Input value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} placeholder="https://youtube.com/@channel" autoFocus />
            </div>
            <div className="flex flex-wrap gap-6">
              <div>
                <Label>Видео для анализа</Label>
                <div className="flex gap-2">{([15, 30, 50, 100] as const).map((n) => <Chip key={n} type="button" active={f.videos === n} onClick={() => setF({ ...f, videos: n })}>{n}</Chip>)}</div>
              </div>
              <div>
                <Label>Тип</Label>
                <div className="flex gap-2">{TYPES.map(([v, l]) => <Chip key={v} type="button" active={f.type === v} onClick={() => setF({ ...f, type: v })}>{l}</Chip>)}</div>
              </div>
            </div>
            <div>
              <Label hint="Необязательно — уточняет RPM и вердикт">Ниша</Label>
              <Input value={f.niche} onChange={(e) => setF({ ...f, niche: e.target.value })} placeholder="напр. личные финансы, true crime" maxLength={200} />
            </div>
            <Switch checked={!!f.force} onChange={(v) => setF({ ...f, force: v })} label="Обновить данные" description="Игнорировать кэш YouTube (6 ч), тратит квоту" />
            {job.status === "running" ? (
              <div className="space-y-3">
                <ProgressBar value={job.pct} label={job.stage} />
                <Button type="button" variant="danger" onClick={job.cancel}><X className="h-4 w-4" />Отменить</Button>
              </div>
            ) : (
              <Button type="submit" size="lg" disabled={f.channel.trim().length < 2}><Play className="h-4 w-4" />Анализировать</Button>
            )}
            {job.status === "error" && <ErrorAlert error={job.error} onRetry={submit} />}
          </form>
        </Card>

        <Card className="p-5">
          <SectionTitle icon={<History className="h-4 w-4" />} right={<button onClick={() => reports.refetch()} className="text-muted-foreground hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /></button>}>Недавние отчёты</SectionTitle>
          {reports.isLoading ? <Skeleton className="h-24" /> : !reports.data?.length ? <p className="text-sm text-muted-foreground">Пока пусто</p> : (
            <ul className="max-h-[320px] space-y-1 overflow-auto">
              {reports.data.slice(0, 30).map((x) => (
                <li key={x.id}>
                  <button onClick={() => setSp({ report: x.id })} className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${x.id === reportId ? "bg-muted" : ""}`}>
                    {x.avatar ? <img src={x.avatar} alt="" className="h-7 w-7 rounded-full" /> : <div className="h-7 w-7 rounded-full bg-muted" />}
                    <span className="min-w-0 flex-1"><span className="block truncate">{x.title}</span><span className="block text-xs text-muted-foreground">{x.videos} видео · {x.type} · {ago(x.createdAt)}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-8">
        {opened.isLoading && !shown && <Skeleton className="h-96" />}
        {opened.error && !shown && <ErrorAlert error={opened.error} />}
        {shown && <ReportView r={shown} onUpdate={update} loadingAi={job.status === "running"} />}
        {shown?.model && job.status !== "running" && <p className="mono-label mt-6 text-muted-foreground">Модель: {shown.model}</p>}
      </div>
    </div>
  );
}
