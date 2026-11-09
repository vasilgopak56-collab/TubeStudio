// Выпуск 3: «Монтаж». Проверка файлов перед сборкой и черновая сборка видеоряда с голосом.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Clapperboard, Film, Folder, SearchCheck, X, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import type { ProjectSummary } from "@/lib/types";
import { Button, Card, ErrorAlert, Label, SectionTitle, Select, ToolHeader } from "@/components/ui";
import { ChannelPicker, JobBox, NeedChannel, useActiveChannel } from "@/features/studio/common";
import { FolderPicker } from "@/pages/StudioVisual";

type Issue = { code: string; message: string; scenes: number[] };
type MontageCheck = {
  ready: boolean; blockers: Issue[]; warnings: Issue[];
  summary: { scenes: number; clips: number; pictures: number; files: number; audioSeconds: number | null };
};
type RenderResult = { file: string; at: string; seconds: number; width: number; height: number; bytes: number; parts: number; reused: number; lufs?: number; peak?: number; music?: number };
type MontageState = { running: { jobId: string | null; since: string } | null; result: RenderResult | null };
type MusicTrack = { name: string; file: string; seconds: number; lufs: number; use: boolean };
type MusicState = { folder: string | null; tracks: MusicTrack[]; skipped?: string[] };

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

/** Музыка ролика: папка, порядок треков и какие из них звучат. */
function MusicCard({ projectId, disabled }: { projectId: string; disabled: boolean }) {
  const [picking, setPicking] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const q = useQuery({ queryKey: ["montage-music", projectId], queryFn: () => api<MusicState>(`/studio/montage/projects/${projectId}/music`), retry: false });
  const folder = useMutation({
    mutationFn: (path: string) => api<MusicState>(`/studio/montage/projects/${projectId}/music/folder`, { method: "PUT", json: { folder: path } }),
    onSuccess: (d) => { setSkipped(d.skipped ?? []); void q.refetch(); },
  });
  const save = useMutation({
    mutationFn: (tracks: MusicTrack[]) => api(`/studio/montage/projects/${projectId}/music/tracks`, { method: "PUT", json: { tracks: tracks.map(({ name, use }) => ({ name, use })) } }),
    onSuccess: () => void q.refetch(),
  });
  const tracks = q.data?.tracks ?? [];
  const busy = disabled || folder.isPending || save.isPending;
  const move = (i: number, to: number) => { const next = [...tracks]; const [t] = next.splice(i, 1); next.splice(to, 0, t); save.mutate(next); };
  const toggle = (i: number) => save.mutate(tracks.map((t, k) => (k === i ? { ...t, use: !t.use } : t)));
  const used = tracks.filter((t) => t.use);
  const total = used.reduce((s, t) => s + t.seconds, 0);
  return <Card className="space-y-4 p-5" data-testid="montage-music">
    <SectionTitle>Музыка</SectionTitle>
    {picking && <FolderPicker title="Папка с музыкой этого ролика" onClose={() => setPicking(false)} onPick={(p) => { setPicking(false); folder.mutate(p); }} />}
    {q.data?.folder && <p className="break-all font-mono text-xs text-muted-foreground">{q.data.folder}</p>}
    <Button variant="outline" className="min-h-11" disabled={busy} loading={folder.isPending} loadingText="Копирую и измеряю треки…" onClick={() => setPicking(true)}><Folder className="h-4 w-4" />{q.data?.folder ? "Выбрать другую папку" : "Выбрать папку"}</Button>
    {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
    {folder.error && <ErrorAlert error={folder.error} />}
    {save.error && <ErrorAlert error={save.error} />}
    {skipped.length > 0 && <p className="text-sm text-crown">Не подошли (не открываются, беззвучны или слишком короткие): {skipped.join(", ")}</p>}
    {tracks.length > 0 && <ol className="space-y-1">{tracks.map((t, i) => <li key={t.name} className="flex items-center gap-2 text-sm">
      <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2"><input type="checkbox" checked={t.use} disabled={busy} onChange={() => toggle(i)} /><span className={`truncate ${t.use ? "" : "text-muted-foreground line-through"}`}>{t.name}</span></label>
      <span className="shrink-0 text-muted-foreground">{mmss(t.seconds)}</span>
      <Button variant="ghost" size="sm" className="min-h-11" aria-label={`Выше: ${t.name}`} disabled={busy || i === 0} onClick={() => move(i, i - 1)}><ArrowUp className="h-4 w-4" /></Button>
      <Button variant="ghost" size="sm" className="min-h-11" aria-label={`Ниже: ${t.name}`} disabled={busy || i === tracks.length - 1} onClick={() => move(i, i + 1)}><ArrowDown className="h-4 w-4" /></Button>
    </li>)}</ol>}
    {q.data && used.length === 0 && <p className="flex items-center gap-2 text-sm text-crown"><AlertTriangle className="h-4 w-4 shrink-0" />Музыка не выбрана: ролик соберётся только с голосом.</p>}
    {used.length > 0 && <p className="text-sm text-muted-foreground">Выбрано треков: {used.length}, общая длина {mmss(total)}. Если ролик длиннее, список повторится по кругу.</p>}
  </Card>;
}

export default function StudioMontage() {
  const [sp, setSp] = useSearchParams();
  const { channel, list, loading } = useActiveChannel();
  const projectId = sp.get("project") ?? "";
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<(ProjectSummary & { channelId?: string })[]>("/projects"), refetchOnWindowFocus: false });
  const withBoard = (projects.data ?? []).filter((p) => (p.counts.storyboard ?? 0) > 0).sort((a, b) => Number(b.channelId === channel?.id) - Number(a.channelId === channel?.id));
  const check = useQuery({ queryKey: ["montage-check", projectId], queryFn: () => api<MontageCheck>(`/studio/montage/projects/${projectId}/check`), enabled: false, retry: false, gcTime: 0 });
  const render = useJob<RenderResult>("");
  const rendering = render.status === "running";
  const state = useQuery({
    queryKey: ["montage-state", projectId], queryFn: () => api<MontageState>(`/studio/montage/projects/${projectId}`), enabled: !!projectId, retry: false,
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
  useEffect(() => { if (render.status === "done" || render.status === "error") void state.refetch(); }, [render.status]);
  const stop = useMutation({ mutationFn: (jobId: string) => api(`/jobs/${jobId}/cancel`, { method: "POST" }), onSuccess: () => void state.refetch() });
  const external = !rendering ? state.data?.running ?? null : null;
  const draft = state.data?.result ?? null;

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

    {projectId && <MusicCard projectId={projectId} disabled={rendering || !!external} />}

    {projectId && <Card className="space-y-4 p-5" data-testid="montage-render">
      <SectionTitle>Черновик видео</SectionTitle>
      <p className="text-sm text-muted-foreground">Видео 1920×1080 с голосом и музыкой, громкость −14 LUFS, пока без субтитров. Бесплатно, считается на этом компьютере. Первая сборка может занять больше часа, повторная быстрее: готовые куски берутся снова. Перед сборкой файлы проверяются ещё раз. После остановки сборка продолжится с прерванного места.</p>
      {!rendering && !external && <Button className="min-h-11" disabled={!!stop.isPending} onClick={() => void render.start({ channelId: channel.id }, `/studio/montage/projects/${projectId}/render`)}><Clapperboard className="h-4 w-4" />{draft ? "Собрать заново" : "Собрать"}</Button>}
      <JobBox job={render} onCancel={render.cancel} />
      {external && <div className="flex flex-wrap items-center gap-3 text-sm" role="status">
        <span className="font-semibold">Идёт сборка этого ролика</span>
        {external.jobId && <Button variant="danger" size="sm" className="min-h-11" loading={stop.isPending} onClick={() => stop.mutate(external.jobId!)}><X className="h-4 w-4" />Остановить</Button>}
      </div>}
      {render.status === "error" && render.error && <ErrorAlert error={render.error} />}
      {state.error && <ErrorAlert error={state.error} onRetry={() => void state.refetch()} />}
      {draft && !rendering && <div className="space-y-2">
        <video key={draft.file} controls preload="metadata" className="aspect-video w-full rounded-md bg-black" src={`/files/${encodeURIComponent(projectId)}/${draft.file.split("/").map(encodeURIComponent).join("/")}`} data-testid="montage-video" />
        <p className="text-sm text-muted-foreground">{draft.width}×{draft.height} · {mmss(draft.seconds)} · {(draft.bytes / 1024 ** 3).toFixed(2)} ГБ · собрано {new Date(draft.at).toLocaleString("ru-RU")}{draft.lufs !== undefined ? ` · ${draft.lufs.toFixed(1)} LUFS, пик ${draft.peak?.toFixed(1)} dBTP` : ""}{draft.music !== undefined ? ` · ${draft.music ? `треков: ${draft.music}` : "только голос"}` : ""}</p>
      </div>}
    </Card>}
  </div>;
}
