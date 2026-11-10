// Выпуск 4: «Shorts». Вертикальные ролики нарезкой из принятого монтажа. Бесплатно, считается на этом компьютере.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clapperboard, Copy, Download, Folder, Save, Scissors, X } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import type { ProjectSummary } from "@/lib/types";
import { Button, Card, ErrorAlert, Input, Label, SectionTitle, Select, ToolHeader } from "@/components/ui";
import { ChannelPicker, JobBox, NeedChannel, useActiveChannel } from "@/features/studio/common";
import { FolderPicker } from "@/pages/StudioVisual";

type Fragment = { id: string; fromScene: number; toScene: number; start: number; end: number; seconds: number; text: string };
type Item = Fragment & { file: string; at: string; bytes: number; lufs: number; peak: number; acceptedAt: string | null; title: string; description: string; videoId: string | null; finalDescription: string };
type Exported = { folder: string; at: string; files: string[] };
type State = {
  project: { id: string; title: string }; running: { jobId: string | null; what?: string } | null; blocker: string | null; fragments: Fragment[]; items: Item[];
  fullVideoId: string | null; exported: Exported | null; outdated: number; limits: { title: number; descriptionBytes: number; pick: number };
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function ShortCard({ item, path, fileUrl, busy, hasFullVideo, limits, onChanged }: { item: Item; path: string; fileUrl: string; busy: boolean; hasFullVideo: boolean; limits: State["limits"]; onChanged: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [url, setUrl] = useState(item.videoId ? `https://youtube.com/shorts/${item.videoId}` : "");
  const [copied, setCopied] = useState("");
  const [copyFailed, setCopyFailed] = useState(false);
  const copy = (what: string, text: string) => navigator.clipboard.writeText(text).then(() => { setCopyFailed(false); setCopied(what); window.setTimeout(() => setCopied((c) => (c === what ? "" : c)), 2000); }, () => { setCopied(""); setCopyFailed(true); });
  const accept = useMutation({ mutationFn: () => api(`${path}/accept`, { method: "POST", json: { id: item.id, file: item.file } }), onSuccess: onChanged });
  const save = useMutation({ mutationFn: () => api(`${path}/items/${item.id}`, { method: "PUT", json: { title, description, url: url.trim() || null } }), onSuccess: onChanged });
  const changed = title.trim() !== item.title || description.trim() !== item.description || (url.trim() !== "" && !item.videoId) || (url.trim() === "" && !!item.videoId);
  return <div className="space-y-3 rounded-lg border p-4" data-testid={`short-${item.id}`}>
    <p className="text-sm font-semibold">Сцены {item.fromScene}–{item.toScene} · {mmss(item.start)}–{mmss(item.end)}</p>
    <video key={item.file} controls preload="metadata" className="aspect-[9/16] w-full max-w-xs rounded-md bg-black" src={fileUrl} />
    <p className="text-sm text-muted-foreground">{item.seconds.toFixed(1)} с · {(item.bytes / 1024 ** 2).toFixed(1)} МБ · {item.lufs.toFixed(1)} LUFS, пик {item.peak.toFixed(1)} dBTP</p>
    {item.acceptedAt
      ? <p className="flex items-center gap-2 text-sm text-success" role="status"><CheckCircle2 className="h-4 w-4 shrink-0" />Принят {new Date(item.acceptedAt).toLocaleString("ru-RU")}</p>
      : <Button className="min-h-11" disabled={busy} loading={accept.isPending} onClick={() => accept.mutate()}><CheckCircle2 className="h-4 w-4" />Принять</Button>}
    {accept.error && <ErrorAlert error={accept.error} />}
    <label className="block space-y-1 text-sm"><Label counter={`${[...title].length}/${limits.title}`}>Название</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    <label className="block space-y-1 text-sm"><Label>Описание</Label><textarea className="field w-full resize-y leading-relaxed" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
    <label className="block space-y-1 text-sm"><Label>Ссылка на загруженный Short</Label><Input value={url} placeholder="https://youtube.com/shorts/…" onChange={(e) => setUrl(e.target.value)} /></label>
    <Button variant="outline" className="min-h-11" disabled={busy || !changed} loading={save.isPending} onClick={() => save.mutate()}><Save className="h-4 w-4" />Сохранить</Button>
    {save.error && <ErrorAlert error={save.error} />}
    {changed && <p role="alert" className="flex items-center gap-2 text-sm text-crown"><AlertTriangle className="h-4 w-4 shrink-0" />Есть несохранённые правки. Для копирования ниже показан последний сохранённый вариант.</p>}
    <div className="flex items-center justify-between gap-3"><Label>Название для YouTube</Label><Button variant="outline" size="sm" className="min-h-11" disabled={!item.title} onClick={() => void copy("title", item.title)}><Copy className="h-4 w-4" />{copied === "title" ? "Скопировано" : "Копировать"}</Button></div>
    <div className="flex items-center justify-between gap-3"><Label>Описание с #Shorts</Label><Button variant="outline" size="sm" className="min-h-11" onClick={() => void copy("description", item.finalDescription)}><Copy className="h-4 w-4" />{copied === "description" ? "Скопировано" : "Копировать"}</Button></div>
    <textarea aria-label="Описание с #Shorts" className="field w-full resize-y leading-relaxed" rows={4} readOnly value={item.finalDescription} />
    {!hasFullVideo && <p className="text-sm text-muted-foreground">Ссылка на полный ролик появится здесь, когда вы сохраните её на странице «Публикация».</p>}
    {copyFailed && <p role="alert" className="text-sm text-accent">Не удалось скопировать: браузер запретил доступ к буферу обмена. Выделите текст вручную.</p>}
  </div>;
}

export default function StudioShorts() {
  const [sp, setSp] = useSearchParams();
  const { channel, list, loading } = useActiveChannel();
  const projectId = sp.get("project") ?? "";
  const path = `/studio/shorts/projects/${projectId}`;
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<(ProjectSummary & { channelId?: string })[]>("/projects"), refetchOnWindowFocus: false });
  const withBoard = (projects.data ?? []).filter((p) => (p.counts.storyboard ?? 0) > 0).sort((a, b) => Number(b.channelId === channel?.id) - Number(a.channelId === channel?.id));
  const state = useQuery({ queryKey: ["shorts-state", projectId], queryFn: () => api<State>(path), enabled: !!projectId, retry: false, refetchOnWindowFocus: false, refetchInterval: (q) => (q.state.data?.running ? 3000 : false) });
  const build = useJob<unknown>("");
  const saving = useJob<Exported>("");
  const [picked, setPicked] = useState<string[]>([]);
  const [folderOpen, setFolderOpen] = useState(false);
  useEffect(() => { setPicked([]); }, [projectId]);
  useEffect(() => { if ([build.status, saving.status].some((s) => s === "done" || s === "error")) void state.refetch(); }, [build.status, saving.status]);

  if (loading) return null;
  const header = <ToolHeader icon={Scissors} title="Shorts" eyebrow="// ВЫПУСК 4" subtitle="Вертикальные ролики нарезкой из принятого монтажа" right={channel ? <ChannelPicker /> : undefined} />;
  if (!list?.channels.length || !channel) return <div className="space-y-6">{header}<NeedChannel /></div>;
  const s = state.data;
  const working = build.status === "running" || saving.status === "running";
  const external = !working ? s?.running ?? null : null;
  const busy = working || !!external;
  const limit = s?.limits.pick ?? 5;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < limit ? [...p, id] : p));
  const fileUrl = (local: string) => `/files/${encodeURIComponent(projectId)}/${local.split("/").map(encodeURIComponent).join("/")}`;
  const saveTo = (folder: string) => void saving.start({ channelId: channel.id, folder }, `${path}/export`);
  const accepted = s?.items.filter((i) => i.acceptedAt).length ?? 0;
  return <div className="space-y-6" data-testid="studio-shorts">
    {header}
    <Card className="space-y-4 p-5">
      <SectionTitle>Проект</SectionTitle>
      <label className="block space-y-1 text-sm"><Label>Ролик</Label>
        <Select value={projectId} disabled={working} onChange={(e) => setSp(e.target.value ? { project: e.target.value } : {}, { replace: true })}>
          <option value="">Выберите проект</option>
          {withBoard.map((p) => <option key={p.id} value={p.id}>{p.title}{p.channelId === channel.id ? "" : " (другой канал)"}</option>)}
        </Select></label>
      {state.error && <ErrorAlert error={state.error} onRetry={() => void state.refetch()} />}
      {s?.blocker && <p role="alert" className="flex items-start gap-2 text-sm text-accent"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{s.blocker} <Link to={`/studio/montage?project=${encodeURIComponent(projectId)}`} className="text-primary hover:underline">Открыть «Монтаж»</Link></span></p>}
    </Card>

    {s && !s.blocker && <Card className="space-y-4 p-5" data-testid="shorts-fragments">
      <SectionTitle>Куски ролика</SectionTitle>
      <p className="text-sm text-muted-foreground">От 20 до 55 секунд, начинаются с нового абзаца и не обрывают фразу. Отметьте до {limit} кусков. Бесплатно, считается на этом компьютере. Голос уже записан, поэтому первая фраза остаётся такой, как в ролике.</p>
      {s.fragments.length === 0 && <p className="text-sm text-muted-foreground">Подходящих кусков не нашлось: абзацы слишком короткие или слишком длинные.</p>}
      <ul className="space-y-2">{s.fragments.map((f) => { const on = picked.includes(f.id), made = s.items.some((i) => i.id === f.id); return <li key={f.id}>
        <label className="flex min-h-11 items-start gap-3 rounded-md border border-border p-3 text-sm">
          <input type="checkbox" className="mt-1" checked={on} disabled={busy || (!on && picked.length >= limit)} onChange={() => toggle(f.id)} />
          <span className="min-w-0"><span className="font-semibold">{mmss(f.start)}–{mmss(f.end)} · {Math.round(f.seconds)} с · сцены {f.fromScene}–{f.toScene}{made ? " · уже собран" : ""}</span><br /><span className="text-muted-foreground" dir="auto">{f.text}</span></span>
        </label></li>; })}</ul>
      {!busy && <Button className="min-h-11" disabled={!picked.length} onClick={() => void build.start({ channelId: channel.id, ids: picked }, `${path}/build`)}><Clapperboard className="h-4 w-4" />Собрать отмеченные ({picked.length})</Button>}
      <JobBox job={build} onCancel={build.cancel} />
      {build.status === "error" && build.error && <ErrorAlert error={build.error} />}
      {external && <p className="flex items-center gap-2 text-sm font-semibold" role="status"><X className="h-4 w-4 shrink-0" />Идёт сборка этого ролика. Дождитесь окончания.</p>}
      {s.outdated > 0 && <p className="text-sm text-crown">Shorts от прежней сборки монтажа устарели: {s.outdated}. Они удалятся при следующей сборке.</p>}
    </Card>}

    {s && s.items.length > 0 && <Card className="space-y-4 p-5" data-testid="shorts-items">
      <SectionTitle>Готовые Shorts</SectionTitle>
      <p className="text-sm text-muted-foreground">Посмотрите и послушайте каждый Short. Сохранить на компьютер можно только принятые. Загружаете вы вручную.</p>
      <div className="grid gap-4 md:grid-cols-2">{s.items.map((i) => <ShortCard key={i.file} item={i} path={path} fileUrl={fileUrl(i.file)} busy={busy} hasFullVideo={!!s.fullVideoId} limits={s.limits} onChanged={() => void state.refetch()} />)}</div>
    </Card>}

    {s && s.items.length > 0 && <Card className="space-y-4 p-5" data-testid="shorts-export">
      <SectionTitle>Сохранение</SectionTitle>
      {folderOpen && <FolderPicker title="Куда сохранить Shorts" onClose={() => setFolderOpen(false)} onPick={(p) => { setFolderOpen(false); saveTo(p); }} />}
      <p className="text-sm text-muted-foreground">Принято: {accepted} из {s.items.length}. Файлы с такими именами не перезаписываются.</p>
      {s.exported && <p className="break-all font-mono text-xs text-muted-foreground">{s.exported.folder}</p>}
      {!busy && <div className="flex flex-wrap gap-2">
        {s.exported && <Button className="min-h-11" disabled={!accepted} onClick={() => saveTo(s.exported!.folder)}><Download className="h-4 w-4" />Сохранить в эту папку</Button>}
        <Button className="min-h-11" variant={s.exported ? "outline" : "primary"} disabled={!accepted} onClick={() => setFolderOpen(true)}><Folder className="h-4 w-4" />{s.exported ? "Выбрать другую папку" : "Сохранить на компьютер"}</Button>
      </div>}
      <JobBox job={saving} onCancel={saving.cancel} />
      {saving.status === "error" && saving.error && <ErrorAlert error={saving.error} />}
      {s.exported && !working && <div className="text-sm text-muted-foreground"><p>Сохранено {new Date(s.exported.at).toLocaleString("ru-RU")}:</p><ul className="list-disc pl-5">{s.exported.files.map((f) => <li key={f} className="break-all">{f}</li>)}</ul></div>}
    </Card>}
  </div>;
}
