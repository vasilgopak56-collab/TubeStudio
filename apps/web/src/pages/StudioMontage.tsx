// Выпуск 3: «Монтаж». Проверка файлов перед сборкой и черновая сборка видеоряда с голосом.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Clapperboard, Download, Film, Folder, Map as MapIcon, SearchCheck, Table, X, XCircle } from "lucide-react";
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
type RenderResult = { file: string; at: string; seconds: number; width: number; height: number; bytes: number; parts: number; reused: number; lufs?: number; peak?: number; music?: number; cue?: number; subtitles?: { files: { srt: string; vtt: string } | null; cues: number; problem: string | null } };
type BurnResult = { file: string; at: string; seconds: number; bytes: number; source: string };
type ExportResult = { folder: string; at: string; files: string[] };
type MontageState = {
  running: { jobId: string | null; since: string; what?: "render" | "burn" } | null; result: RenderResult | null; burned: (BurnResult & { stale: boolean }) | null;
  accepted: { file: string; at: string } | null; facts: "none" | "stale" | "issues" | "passed"; exported: ExportResult | null;
};
const FACTS_NOTE: Record<MontageState["facts"], string> = { none: "Программа считает факты сценария непроверенными. Ручная проверка ей неизвестна.", stale: "Сценарий меняли после проверки фактов.", issues: "После проверки фактов остались неисправленные места.", passed: "" };
type MusicTrack = { name: string; file: string; seconds: number; lufs: number; use: boolean };
type CueRow = { row: number; n: string | null; start: number; end: number; layer: "base" | "over"; file: string; from: number; to: number; gainDb: number; ending: "fade" | "cut"; note: string };
type CueProblem = { row: number | null; message: string };
type CueState = { mode: "sequence" | "cue"; table: { name: string; at: string; rows: CueRow[]; problems: CueProblem[] } | null; errors: CueProblem[] };
type MusicState = { folder: string | null; tracks: MusicTrack[]; skipped?: string[]; cue?: CueState };

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const LAYER: Record<CueRow["layer"], string> = { base: "Основа", over: "Поверх" };
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

type GraphicStatus = "pending" | "accepted" | "rejected";
type GraphicItem = { scene: number; text: string; label: string; file: string; status: GraphicStatus };
type GraphicsState = { scanned: boolean; items: GraphicItem[] };
const GRAPHIC_STATUS: Record<GraphicStatus, string> = { pending: "ждёт решения", accepted: "подтверждена", rejected: "отклонена" };

/** Карты и таймлайн: программа предлагает сцены по тексту, в ролик идёт только подтверждённое. */
function GraphicsCard({ projectId, disabled }: { projectId: string; disabled: boolean }) {
  const q = useQuery({ queryKey: ["montage-graphics", projectId], queryFn: () => api<GraphicsState>(`/studio/montage/projects/${projectId}/graphics`), retry: false });
  const scan = useMutation({ mutationFn: () => api<GraphicsState>(`/studio/montage/projects/${projectId}/graphics/scan`, { method: "POST" }), onSuccess: () => void q.refetch() });
  const edit = useMutation({ mutationFn: ({ scene, status }: { scene: number; status: GraphicStatus }) => api<GraphicsState>(`/studio/montage/projects/${projectId}/graphics/${scene}`, { method: "PATCH", json: { status } }), onSuccess: () => void q.refetch() });
  const items = q.data?.items ?? [];
  const busy = disabled || scan.isPending || edit.isPending;
  const accepted = items.filter((i) => i.status === "accepted").length;
  return <Card className="space-y-4 p-5" data-testid="montage-graphics">
    <SectionTitle>Графика</SectionTitle>
    <p className="text-sm text-muted-foreground">Карты и таймлайн по тексту сценария. Подтверждённая графика идёт на весь кадр вместо клипа этой сцены. Бесплатно.</p>
    <Button variant="outline" className="min-h-11" disabled={busy} loading={scan.isPending} loadingText="Ищу сцены и рисую…" onClick={() => scan.mutate()}><MapIcon className="h-4 w-4" />{q.data?.scanned ? "Найти сцены заново" : "Найти сцены для графики"}</Button>
    {q.error && <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />}
    {scan.error && <ErrorAlert error={scan.error} />}
    {edit.error && <ErrorAlert error={edit.error} />}
    {q.data?.scanned && items.length === 0 && <p className="text-sm text-muted-foreground">В тексте сценария не нашлось известных мест и дат.</p>}
    {items.length > 0 && <div className="grid gap-4 md:grid-cols-2">{items.map((g) => <div key={g.scene} className="space-y-2 rounded-lg border p-3" data-testid={`graphic-${g.scene}`}>
      <img src={`/files/${encodeURIComponent(projectId)}/${g.file.split("/").map(encodeURIComponent).join("/")}`} alt={g.label} loading="lazy" className="aspect-video w-full rounded-md bg-black object-cover" />
      <p className="text-sm font-semibold">Сцена {g.scene} · {g.label}</p>
      <p className="text-sm text-muted-foreground" dir="auto">{g.text}</p>
      <p className={`text-sm ${g.status === "accepted" ? "text-success" : g.status === "rejected" ? "text-accent" : "text-crown"}`}>{GRAPHIC_STATUS[g.status]}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="min-h-11" disabled={busy || g.status === "accepted"} onClick={() => edit.mutate({ scene: g.scene, status: "accepted" })}><CheckCircle2 className="h-4 w-4" />Подтвердить</Button>
        <Button size="sm" variant="outline" className="min-h-11" disabled={busy || g.status === "rejected"} onClick={() => edit.mutate({ scene: g.scene, status: "rejected" })}><X className="h-4 w-4" />Отклонить</Button>
      </div>
    </div>)}</div>}
    {items.length > 0 && <p className="text-sm text-muted-foreground">Подтверждено: {accepted} из {items.length}. Чтобы изменения попали в ролик, нажмите «Собрать заново» ниже.</p>}
  </Card>;
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
  const mode = useMutation({ mutationFn: (m: CueState["mode"]) => api(`/studio/montage/projects/${projectId}/music/mode`, { method: "PUT", json: { mode: m } }), onSuccess: () => void q.refetch() });
  const load = useMutation({ mutationFn: () => api(`/studio/montage/projects/${projectId}/music/cue`, { method: "POST" }), onSuccess: () => void q.refetch() });
  const tracks = q.data?.tracks ?? [];
  const cue = q.data?.cue ?? null;
  const byTable = cue?.mode === "cue";
  const busy = disabled || folder.isPending || save.isPending || mode.isPending || load.isPending;
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
    {mode.error && <ErrorAlert error={mode.error} />}
    {skipped.length > 0 && <p className="text-sm text-crown">Не подошли (не открываются, беззвучны или слишком короткие): {skipped.join(", ")}</p>}
    {q.data && <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Как звучит музыка">
      <Button size="sm" role="radio" aria-checked={!byTable} variant={byTable ? "outline" : "primary"} className="min-h-11" disabled={busy} onClick={() => { if (byTable) mode.mutate("sequence"); }}>Подряд</Button>
      <Button size="sm" role="radio" aria-checked={byTable} variant={byTable ? "primary" : "outline"} className="min-h-11" disabled={busy} onClick={() => { if (!byTable) mode.mutate("cue"); }}>По таблице</Button>
    </div>}
    {byTable && cue && <CueTable cue={cue} folder={!!q.data?.folder} busy={busy} loading={load.isPending} onLoad={() => load.mutate()} error={load.error} tracks={tracks.length} />}
    {!byTable && tracks.length > 0 && <ol className="space-y-1">{tracks.map((t, i) => <li key={t.name} className="flex items-center gap-2 text-sm">
      <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2"><input type="checkbox" checked={t.use} disabled={busy} onChange={() => toggle(i)} /><span className={`truncate ${t.use ? "" : "text-muted-foreground line-through"}`}>{t.name}</span></label>
      <span className="shrink-0 text-muted-foreground">{mmss(t.seconds)}</span>
      <Button variant="ghost" size="sm" className="min-h-11" aria-label={`Выше: ${t.name}`} disabled={busy || i === 0} onClick={() => move(i, i - 1)}><ArrowUp className="h-4 w-4" /></Button>
      <Button variant="ghost" size="sm" className="min-h-11" aria-label={`Ниже: ${t.name}`} disabled={busy || i === tracks.length - 1} onClick={() => move(i, i + 1)}><ArrowDown className="h-4 w-4" /></Button>
    </li>)}</ol>}
    {!byTable && q.data && used.length === 0 && <p className="flex items-center gap-2 text-sm text-crown"><AlertTriangle className="h-4 w-4 shrink-0" />Музыка не выбрана: ролик соберётся только с голосом.</p>}
    {!byTable && used.length > 0 && <p className="text-sm text-muted-foreground">Выбрано треков: {used.length}, общая длина {mmss(total)}. Если ролик длиннее, список повторится по кругу.</p>}
  </Card>;
}

/** Музыка по таблице: что загружено из .xlsx и какие строки мешают сборке. Заметки только показываются. */
function CueTable({ cue, folder, busy, loading, onLoad, error, tracks }: { cue: CueState; folder: boolean; busy: boolean; loading: boolean; onLoad: () => void; error: unknown; tracks: number }) {
  const t = cue.table;
  const bad = new Set(cue.errors.map((e) => e.row));
  return <div className="space-y-3" data-testid="montage-cue">
    <p className="text-sm text-muted-foreground">Таблица .xlsx из папки с музыкой (лист «Cue-sheet»): какой кусок трека где звучит. «Основа» — главный слой: если следующая строка начинается раньше конца предыдущей, будет плавный переход на всё перекрытие. «Поверх» звучит одновременно с основой. Где строк нет — тишина. Необязательные столбцы: «Громкость, дБ» (пусто — 0) и «Окончание»: «плавно» (затухание 2 с, по умолчанию) или «обрыв». После правки таблицы загрузите её снова.</p>
    <Button variant="outline" className="min-h-11" disabled={busy || !folder} loading={loading} loadingText="Читаю таблицу…" onClick={onLoad}><Table className="h-4 w-4" />{t ? "Загрузить таблицу заново" : "Загрузить таблицу"}</Button>
    {!folder && <p className="text-sm text-muted-foreground">Сначала выберите папку с музыкой: таблица берётся из неё.</p>}
    {!!error && <ErrorAlert error={error} />}
    {folder && !t && <p className="flex items-center gap-2 text-sm text-crown"><AlertTriangle className="h-4 w-4 shrink-0" />Таблица не загружена: ролик не соберётся, пока её нет или пока не выбран режим «Подряд».</p>}
    {t && <p className="text-sm text-muted-foreground">«{t.name}» · загружена {new Date(t.at).toLocaleString("ru-RU")} · строк: {t.rows.length} · треков в папке: {tracks}</p>}
    {cue.errors.length > 0 && <div role="alert" className="space-y-1">
      <p className="flex items-center gap-2 text-sm font-semibold text-accent"><XCircle className="h-4 w-4 shrink-0" />Мешает сборке</p>
      <ul className="space-y-1 text-sm">{cue.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
    </div>}
    {t && t.rows.length > 0 && cue.errors.length === 0 && <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4 shrink-0" />Ошибок в строках нет. Длину ролика проверят «Проверить» и сборка.</p>}
    {t && t.rows.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <thead className="text-muted-foreground"><tr><th className="p-1">Строка</th><th className="p-1">В ролике</th><th className="p-1">Слой</th><th className="p-1">Файл</th><th className="p-1">В треке</th><th className="p-1">дБ</th><th className="p-1">Окончание</th><th className="p-1">Заметка</th></tr></thead>
      <tbody>{t.rows.map((r) => <tr key={r.row} className={`border-t ${bad.has(r.row) ? "text-accent" : ""}`}>
        <td className="p-1">{r.row}{r.n ? ` (№ ${r.n})` : ""}</td>
        <td className="whitespace-nowrap p-1">{mmss(r.start)}–{mmss(r.end)}</td>
        <td className="p-1">{LAYER[r.layer]}</td>
        <td className="break-all p-1">{r.file}</td>
        <td className="whitespace-nowrap p-1">{mmss(r.from)}–{mmss(r.to)}</td>
        <td className="p-1">{r.gainDb > 0 ? `+${r.gainDb}` : r.gainDb}</td>
        <td className="p-1">{r.ending === "fade" ? "плавно" : "обрыв"}</td>
        <td className="p-1 text-muted-foreground" dir="auto">{r.note}</td>
      </tr>)}</tbody>
    </table></div>}
  </div>;
}

export default function StudioMontage() {
  const [sp, setSp] = useSearchParams();
  const { channel, list, loading } = useActiveChannel();
  const projectId = sp.get("project") ?? "";
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<(ProjectSummary & { channelId?: string })[]>("/projects"), refetchOnWindowFocus: false });
  const withBoard = (projects.data ?? []).filter((p) => (p.counts.storyboard ?? 0) > 0).sort((a, b) => Number(b.channelId === channel?.id) - Number(a.channelId === channel?.id));
  const check = useQuery({ queryKey: ["montage-check", projectId], queryFn: () => api<MontageCheck>(`/studio/montage/projects/${projectId}/check`), enabled: false, retry: false, gcTime: 0 });
  const render = useJob<RenderResult>("");
  const burn = useJob<BurnResult>("");
  const saving = useJob<ExportResult>("");
  const [picking, setPicking] = useState(false);
  const rendering = render.status === "running" || burn.status === "running" || saving.status === "running";
  const state = useQuery({
    queryKey: ["montage-state", projectId], queryFn: () => api<MontageState>(`/studio/montage/projects/${projectId}`), enabled: !!projectId, retry: false,
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
  useEffect(() => { if ([render.status, burn.status, saving.status].some((s) => s === "done" || s === "error")) void state.refetch(); }, [render.status, burn.status, saving.status]);
  const accept = useMutation({ mutationFn: (file: string) => api(`/studio/montage/projects/${projectId}/accept`, { method: "POST", json: { file } }), onSuccess: () => void state.refetch() });
  const stop = useMutation({ mutationFn: (jobId: string) => api(`/jobs/${jobId}/cancel`, { method: "POST" }), onSuccess: () => void state.refetch() });
  const external = !rendering ? state.data?.running ?? null : null;
  const draft = state.data?.result ?? null;
  const burned = state.data?.burned ?? null;
  const url = (local: string) => `/files/${encodeURIComponent(projectId)}/${local.split("/").map(encodeURIComponent).join("/")}`;
  const subs = draft?.subtitles ?? null;
  const accepted = state.data?.accepted ?? null;
  const facts = state.data?.facts ?? "passed";
  const exported = state.data?.exported ?? null;
  const saveTo = (folder: string) => void saving.start({ channelId: channel!.id, folder }, `/studio/montage/projects/${projectId}/export`);

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

    {projectId && <GraphicsCard projectId={projectId} disabled={rendering || !!external} />}

    {projectId && <MusicCard projectId={projectId} disabled={rendering || !!external} />}

    {projectId && <Card className="space-y-4 p-5" data-testid="montage-render">
      <SectionTitle>Черновик видео</SectionTitle>
      <p className="text-sm text-muted-foreground">Видео 1920×1080 с голосом и музыкой, громкость −14 LUFS, субтитры отдельным файлом. Бесплатно, считается на этом компьютере. Первая сборка может занять больше часа, повторная быстрее: готовые куски берутся снова. Перед сборкой файлы проверяются ещё раз. После остановки сборка продолжится с прерванного места.</p>
      {!rendering && !external && <Button className="min-h-11" disabled={!!stop.isPending} onClick={() => void render.start({ channelId: channel.id }, `/studio/montage/projects/${projectId}/render`)}><Clapperboard className="h-4 w-4" />{draft ? "Собрать заново" : "Собрать"}</Button>}
      <JobBox job={render} onCancel={render.cancel} />
      {external && <div className="flex flex-wrap items-center gap-3 text-sm" role="status">
        <span className="font-semibold">{external.what === "burn" ? "Идёт вшивание субтитров" : "Идёт сборка этого ролика"}</span>
        {external.jobId && <Button variant="danger" size="sm" className="min-h-11" loading={stop.isPending} onClick={() => stop.mutate(external.jobId!)}><X className="h-4 w-4" />Остановить</Button>}
      </div>}
      {render.status === "error" && render.error && <ErrorAlert error={render.error} />}
      {state.error && <ErrorAlert error={state.error} onRetry={() => void state.refetch()} />}
      {draft && !rendering && <div className="space-y-2">
        <video key={draft.file} controls preload="metadata" className="aspect-video w-full rounded-md bg-black" src={url(draft.file)} data-testid="montage-video">
          {subs?.files && <track default kind="subtitles" label="Субтитры" src={url(subs.files.vtt)} />}
        </video>
        <p className="text-sm text-muted-foreground">{draft.width}×{draft.height} · {mmss(draft.seconds)} · {(draft.bytes / 1024 ** 3).toFixed(2)} ГБ · собрано {new Date(draft.at).toLocaleString("ru-RU")}{draft.lufs !== undefined ? ` · ${draft.lufs.toFixed(1)} LUFS, пик ${draft.peak?.toFixed(1)} dBTP` : ""}{draft.cue !== undefined ? ` · музыка по таблице: строк ${draft.cue}, треков ${draft.music}` : draft.music !== undefined ? ` · ${draft.music ? `треков: ${draft.music}` : "только голос"}` : ""}</p>
        {subs?.files && <a className="inline-flex min-h-11 items-center gap-2 text-sm text-primary hover:underline" href={url(subs.files.srt)} download="subtitles.srt"><Download className="h-4 w-4" />Скачать субтитры SRT ({subs.cues})</a>}
        {subs?.problem && <p role="alert" className="flex items-center gap-2 text-sm text-crown"><AlertTriangle className="h-4 w-4 shrink-0" />Субтитры не подготовлены. {subs.problem}</p>}
      </div>}
    </Card>}

    {projectId && draft && <Card className="space-y-4 p-5" data-testid="montage-burn">
      <SectionTitle>Видео со вшитыми субтитрами</SectionTitle>
      <p className="text-sm text-muted-foreground">Отдельный файл: белый текст внизу кадра, выключить его потом нельзя. Всё видео кодируется заново, это может занять больше часа. При остановке работа начнётся сначала.</p>
      {!rendering && !external && <Button className="min-h-11" variant="outline" disabled={!subs?.files} onClick={() => void burn.start({ channelId: channel.id }, `/studio/montage/projects/${projectId}/burn`)}><Clapperboard className="h-4 w-4" />{burned ? "Собрать со вшитыми субтитрами заново" : "Собрать со вшитыми субтитрами"}</Button>}
      {!subs?.files && !rendering && !external && <p className="text-sm text-muted-foreground">Сначала соберите черновик заново: при этом подготовятся субтитры.</p>}
      <JobBox job={burn} onCancel={burn.cancel} />
      {burn.status === "error" && burn.error && <ErrorAlert error={burn.error} />}
      {burned?.stale && <p role="alert" className="flex items-center gap-2 text-sm text-crown"><AlertTriangle className="h-4 w-4 shrink-0" />Черновик собран заново после вшивания. Этот файл устарел.</p>}
      {burned && !rendering && <div className="space-y-2">
        <video key={burned.file} controls preload="metadata" className="aspect-video w-full rounded-md bg-black" src={url(burned.file)} data-testid="montage-burned" />
        <p className="text-sm text-muted-foreground">{mmss(burned.seconds)} · {(burned.bytes / 1024 ** 3).toFixed(2)} ГБ · собрано {new Date(burned.at).toLocaleString("ru-RU")}</p>
      </div>}
    </Card>}

    {projectId && draft && <Card className="space-y-4 p-5" data-testid="montage-accept">
      <SectionTitle>Принятие и сохранение</SectionTitle>
      {picking && <FolderPicker title="Куда сохранить файлы ролика" onClose={() => setPicking(false)} onPick={(p) => { setPicking(false); saveTo(p); }} />}
      {!accepted && <>
        <p className="text-sm text-muted-foreground">Посмотрите и послушайте черновик целиком. Принять можно только этот вариант: после новой сборки его нужно будет принять снова.</p>
        {facts !== "passed" && <p className="flex items-center gap-2 text-sm text-crown"><AlertTriangle className="h-4 w-4 shrink-0" />{FACTS_NOTE[facts]}</p>}
        <Button className="min-h-11" disabled={rendering || !!external} loading={accept.isPending} onClick={() => accept.mutate(draft.file)}><CheckCircle2 className="h-4 w-4" />Принять ролик</Button>
      </>}
      {accepted && <>
        <p className="flex items-center gap-2 text-sm text-success" role="status"><CheckCircle2 className="h-4 w-4 shrink-0" />Ролик принят {new Date(accepted.at).toLocaleString("ru-RU")}</p>
        <p className="text-sm text-muted-foreground">Будет сохранено: видео{subs?.files ? ", субтитры SRT" : ""}{burned && !burned.stale ? ", видео со вшитыми субтитрами" : ""}.{burned?.stale ? " Видео со вшитыми субтитрами устарело и не сохранится, сначала соберите его заново." : ""}{!burned ? " Видео со вшитыми субтитрами ещё не собрано." : ""} Файлы с такими именами не перезаписываются.</p>
        {exported && <p className="break-all font-mono text-xs text-muted-foreground">{exported.folder}</p>}
        {!rendering && !external && <div className="flex flex-wrap gap-2">
          {exported && <Button className="min-h-11" onClick={() => saveTo(exported.folder)}><Download className="h-4 w-4" />Сохранить в эту папку</Button>}
          <Button className="min-h-11" variant={exported ? "outline" : "primary"} onClick={() => setPicking(true)}><Folder className="h-4 w-4" />{exported ? "Выбрать другую папку" : "Сохранить на компьютер"}</Button>
        </div>}
      </>}
      <JobBox job={saving} onCancel={saving.cancel} />
      {saving.status === "error" && saving.error && <ErrorAlert error={saving.error} />}
      {accept.error && <ErrorAlert error={accept.error} />}
      {exported && !rendering && <div className="text-sm text-muted-foreground"><p>Сохранено {new Date(exported.at).toLocaleString("ru-RU")}:</p><ul className="list-disc pl-5">{exported.files.map((f) => <li key={f} className="break-all">{f}</li>)}</ul></div>}
    </Card>}
  </div>;
}
