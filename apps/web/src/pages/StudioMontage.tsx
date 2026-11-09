// Выпуск 3: «Монтаж». Пока только проверка файлов перед сборкой (шаг 2); сама сборка появится на следующих шагах.
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Film, SearchCheck, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import type { ProjectSummary } from "@/lib/types";
import { Button, Card, ErrorAlert, Label, SectionTitle, Select, ToolHeader } from "@/components/ui";
import { ChannelPicker, NeedChannel, useActiveChannel } from "@/features/studio/common";

type Issue = { code: string; message: string; scenes: number[] };
type MontageCheck = {
  ready: boolean; blockers: Issue[]; warnings: Issue[];
  summary: { scenes: number; clips: number; pictures: number; files: number; audioSeconds: number | null };
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
/** Номера сцен коротко: 1–5, 7, 197. */
function sceneList(ns: number[]) {
  const parts: string[] = [];
  for (let i = 0; i < ns.length; i++) {
    const from = ns[i];
    while (ns[i + 1] === ns[i] + 1) i++;
    parts.push(ns[i] === from ? String(from) : `${from}–${ns[i]}`);
  }
  return parts.join(", ");
}

function Issues({ title, items, danger }: { title: string; items: Issue[]; danger?: boolean }) {
  const Icon = danger ? XCircle : AlertTriangle;
  return <div className="space-y-2">
    <SectionTitle>{title}</SectionTitle>
    <ul className="space-y-2">{items.map((x) => <li key={x.code} className="flex gap-2 text-sm">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${danger ? "text-accent" : "text-crown"}`} />
      <span>{x.message}{x.scenes.length > 0 && <span className="text-muted-foreground"> {x.scenes.length === 1 ? "Сцена" : "Сцены"}: {sceneList(x.scenes)}.</span>}</span>
    </li>)}</ul>
  </div>;
}

export default function StudioMontage() {
  const [sp, setSp] = useSearchParams();
  const { channel, list, loading } = useActiveChannel();
  const projectId = sp.get("project") ?? "";
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<(ProjectSummary & { channelId?: string })[]>("/projects"), refetchOnWindowFocus: false });
  const withBoard = (projects.data ?? []).filter((p) => (p.counts.storyboard ?? 0) > 0).sort((a, b) => Number(b.channelId === channel?.id) - Number(a.channelId === channel?.id));
  const check = useQuery({ queryKey: ["montage-check", projectId], queryFn: () => api<MontageCheck>(`/studio/montage/projects/${projectId}/check`), enabled: false, retry: false, gcTime: 0 });

  if (loading) return null;
  const header = <ToolHeader icon={Film} title="Монтаж" eyebrow="// ВЫПУСК 3" subtitle="Проверка файлов перед сборкой ролика" right={channel ? <ChannelPicker /> : undefined} />;
  if (!list?.channels.length || !channel) return <div className="space-y-6">{header}<NeedChannel /></div>;
  const r = check.data;
  return <div className="space-y-6" data-testid="studio-montage">
    {header}
    <Card className="space-y-4 p-5">
      <SectionTitle>Проект</SectionTitle>
      <label className="block space-y-1 text-sm"><Label>Проект с раскадровкой</Label>
        <Select value={projectId} disabled={check.isFetching} onChange={(e) => setSp(e.target.value ? { project: e.target.value } : {}, { replace: true })}>
          <option value="">Выберите проект</option>
          {withBoard.map((p) => <option key={p.id} value={p.id}>{p.title}{p.channelId === channel.id ? "" : " (другой канал)"}</option>)}
        </Select></label>
      {projects.data && withBoard.length === 0 && <p className="text-sm text-muted-foreground">Проектов с раскадровкой нет. Нарежьте сцены в разделе <Link to="/studio/visual" className="text-primary hover:underline">Визуал</Link>.</p>}
      <Button className="min-h-11" disabled={!projectId} loading={check.isFetching} loadingText="Проверяю файлы…" onClick={() => void check.refetch()}><SearchCheck className="h-4 w-4" />Проверить</Button>
      {check.error && <ErrorAlert error={check.error} onRetry={() => void check.refetch()} />}
    </Card>

    {r && !check.isFetching && <Card className="space-y-4 p-5" data-testid="montage-check">
      <p className={`flex items-center gap-2 text-lg font-bold ${r.ready ? "text-success" : "text-accent"}`} role="status">
        {r.ready ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}{r.ready ? "Можно собирать" : "Сборку начинать нельзя"}
      </p>
      <p className="text-sm text-muted-foreground">Сцен: {r.summary.scenes} · клипов: {r.summary.clips} · картинок: {r.summary.pictures} · проверено файлов: {r.summary.files}{r.summary.audioSeconds !== null ? ` · озвучка ${mmss(r.summary.audioSeconds)}` : ""}</p>
      {r.blockers.length > 0 && <Issues title="Мешает сборке" items={r.blockers} danger />}
      {r.warnings.length > 0 && <Issues title="Предупреждения" items={r.warnings} />}
    </Card>}
  </div>;
}
