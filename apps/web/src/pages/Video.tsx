import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Film, Music, Play, Smartphone, X } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import type { Artifact, Project, ProjectSummary } from "@/lib/types";
import { Badge, Button, Card, CopyButton, EmptyState, ErrorAlert, Input, Label, ProgressBar, SectionTitle, Select, Switch, ToolHeader } from "@/components/ui";

type Draft = { url: string; srtUrl: string; width: number; height: number; seconds: number; scenes: number; generated: number; source: string; warnings: string[] };
type Short = { title: string; hook: string; script: string; onScreen: string[]; cta: string; quote: string; why: string; hashtags: string[]; words: number; seconds: number; audioUrl?: string; videoUrl?: string; error?: string };
const SRC: Record<string, string> = { storyboard: "картинки по раскадровке", thumbnails: "обложки проекта", cards: "текстовые карточки", mixed: "картинки + обложки/карточки" };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const shortText = (s: Short) => `${s.title}\n\n${s.script}\n\nНа экране: ${s.onScreen.join(" · ")}\n${s.hashtags.join(" ")}`;

function DraftView({ d }: { d: Draft }) {
  return (
    <div className="space-y-2" data-testid="draft-result">
      <video controls preload="metadata" src={d.url} className={d.height > d.width ? "max-h-[480px] rounded border border-border" : "w-full rounded border border-border"} />
      <p className="text-xs text-muted-foreground">{d.width}×{d.height} · {mmss(d.seconds)} · {d.scenes} сцен · {SRC[d.source] ?? d.source}{d.generated ? ` (${d.generated} сгенерировано)` : ""} · <a className="underline" href={d.url} download>MP4</a> · <a className="underline" href={d.srtUrl} download>SRT</a></p>
      {d.warnings.length > 0 && <ul className="text-xs text-crown">{d.warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}</ul>}
    </div>
  );
}
function ShortsView({ shorts }: { shorts: Short[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2" data-testid="shorts-result">
      {shorts.map((s, i) => (
        <Card key={i} className="space-y-2 p-4">
          <div className="flex items-start gap-2"><b className="flex-1 text-sm">{i + 1}. {s.title}</b><Badge tone={s.seconds > 58 ? "danger" : "primary"}>≈ {s.seconds} с · {s.words} сл.</Badge></div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{s.script}</p>
          {s.onScreen.length > 0 && <p className="text-xs"><span className="text-muted-foreground">На экране:</span> {s.onScreen.join(" · ")}</p>}
          <p className="text-xs text-muted-foreground">{s.hashtags.join(" ")}{s.why ? ` — ${s.why}` : ""}</p>
          {s.quote && <blockquote className="border-l-2 border-border pl-2 text-xs italic text-muted-foreground">«{s.quote.slice(0, 300)}»</blockquote>}
          {s.audioUrl && !s.videoUrl && <audio controls preload="none" src={s.audioUrl} className="w-full" />}
          {s.videoUrl && <video controls preload="metadata" src={s.videoUrl} className="max-h-80 rounded border border-border" />}
          {s.error && <p className="text-xs text-accent">{s.error}</p>}
          <CopyButton text={shortText(s)} />
        </Card>))}
    </div>
  );
}

export default function Video() {
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const pid = sp.get("projectId") ?? "";
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<ProjectSummary[]>("/projects") });
  const proj = useQuery({ queryKey: ["project", pid], queryFn: () => api<Project>(`/projects/${pid}`), enabled: !!pid });
  const meta = useQuery({ queryKey: ["pipeline-meta"], queryFn: () => api<{ ffmpeg: boolean }>("/pipeline/meta") });
  const [o, setO] = useState({ audio: "", images: 0, vertical: false, subtitles: true, music: "", musicName: "", musicDb: -20 });
  const [so, setSo] = useState({ count: 3, voice: false, video: false });
  const [up, setUp] = useState<{ busy: boolean; err?: unknown }>({ busy: false });
  const draft = useJob<Draft, unknown>("/draft");
  const shorts = useJob<{ shorts: Short[] }, unknown>("/shorts");
  const p = proj.data;
  const audios = (p?.artifacts ?? []).filter((a) => a.kind === "audio").reverse();
  const sb = [...(p?.artifacts ?? [])].reverse().find((a) => a.kind === "storyboard") as Artifact | undefined;
  const sbRows = ((sb?.data as { rows?: unknown[] })?.rows ?? []).length;
  const hasScript = (p?.artifacts ?? []).some((a) => a.kind === "script");
  const lastVideo = [...(p?.artifacts ?? [])].reverse().find((a) => a.kind === "video");
  const lastShorts = [...(p?.artifacts ?? [])].reverse().find((a) => a.kind === "shorts");
  useEffect(() => { setO((x) => ({ ...x, audio: "", music: "", musicName: "" })); }, [pid]);
  useEffect(() => { if (draft.status === "done" || shorts.status === "done") { qc.invalidateQueries({ queryKey: ["project", pid] }); qc.invalidateQueries({ queryKey: ["projects"] }); } }, [draft.status, shorts.status]); // eslint-disable-line
  const uploadMusic = async (file?: File) => {
    if (!file || !pid) return; setUp({ busy: true });
    try { const fd = new FormData(); fd.append("file", file); fd.append("projectId", pid); const r = await api<{ name: string }>("/draft/music", { method: "POST", body: fd }); setO((x) => ({ ...x, music: r.name, musicName: file.name })); setUp({ busy: false }); }
    catch (e) { setUp({ busy: false, err: e }); }
  };
  const runDraft = () => pid && draft.start({ projectId: pid, audioArtifactId: o.audio || undefined, images: o.images, vertical: o.vertical, subtitles: o.subtitles, music: o.music || undefined, musicDb: o.musicDb });
  const runShorts = () => pid && shorts.start({ projectId: pid, count: so.count, voice: so.voice || so.video, video: so.video });
  const shownDraft = draft.data ?? (lastVideo?.data as Draft | undefined);
  const shownShorts = shorts.data?.shorts ?? (shorts.partial as { shorts?: Short[] } | undefined)?.shorts ?? (lastShorts?.data as { shorts?: Short[] } | undefined)?.shorts;

  return (
    <div>
      <ToolHeader icon={Film} title="Видео и Shorts" eyebrow="// DRAFT VIDEO · SHORTS"
        subtitle="Черновой ролик из озвучки: картинки сцен с плавным наездом (Ken Burns), субтитры, фоновая музыка. И 3–5 Shorts из сценария длинного видео" />
      <Card className="mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[280px] flex-1"><Label>Проект</Label><Select value={pid} onChange={(e) => setSp(e.target.value ? { projectId: e.target.value } : {})} aria-label="Проект">
          <option value="">— выберите проект —</option>{(projects.data ?? []).filter((x) => x.counts?.script || x.counts?.audio).map((x) => <option key={x.id} value={x.id}>{x.title}{x.counts?.audio ? " · есть озвучка" : ""}</option>)}</Select></div>
        {p && <Link to={`/projects/${p.id}`} className="text-sm underline">открыть проект</Link>}
      </Card>
      {!pid ? <EmptyState icon={<Film className="h-6 w-6" />} title="Выберите проект">Нужен проект со сценарием (для Shorts) и озвучкой (для видео). Быстрее всего — <Link className="underline" to="/pipeline">«Одна кнопка»</Link>.</EmptyState> : (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card className="space-y-3.5 p-5">
            <SectionTitle icon={<Film className="h-4 w-4" />}>Видео-черновик</SectionTitle>
            {meta.data && !meta.data.ffmpeg && <p className="rounded-md border border-crown/40 bg-crown/5 p-2 text-xs">FFmpeg не найден. Windows: <code>winget install ffmpeg</code>, затем перезапустите TubeStudio (или укажите FFMPEG_PATH в .env).</p>}
            {!audios.length ? <p className="text-sm text-muted-foreground">В проекте нет озвучки. <Link className="underline" to={`/voice?projectId=${pid}`}>Озвучить</Link> или загрузить готовый файл.</p> : (<>
              <div><Label>Озвучка</Label><Select value={o.audio} onChange={(e) => setO({ ...o, audio: e.target.value })} aria-label="Озвучка"><option value="">последняя — {audios[0].title.slice(0, 60)}</option>{audios.slice(1).map((a) => <option key={a.id} value={a.id}>{a.title.slice(0, 80)}</option>)}</Select></div>
              <div className="flex items-center gap-3"><Label>Картинок сцен</Label><Input type="number" min={0} max={40} value={o.images} onChange={(e) => setO({ ...o, images: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })} className="w-20" aria-label="Картинок сцен" /></div>
              <p className="text-[11px] text-muted-foreground">{sbRows ? `Раскадровка: ${sbRows} сцен — сгенерируем до ${o.images || 0} картинок по её промптам (тратит баланс картинок).` : "Раскадровки нет — генерировать не из чего."} 0 — бесплатно: обложки проекта и текстовые карточки с фразами из сценария.</p>
              <Switch checked={o.subtitles} onChange={(x) => setO({ ...o, subtitles: x })} label="Вшить субтитры" description="файл SRT создаётся всегда" />
              <Switch checked={o.vertical} onChange={(x) => setO({ ...o, vertical: x })} label="Вертикальное 1080×1920" description="иначе 1280×720" />
              <div><Label hint="MP3/WAV/M4A, необязательно">Фоновая музыка</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:border-primary"><Music className="h-4 w-4" />{up.busy ? "Загрузка…" : o.musicName || "Выбрать файл"}<input type="file" accept="audio/*" className="hidden" onChange={(e) => uploadMusic(e.target.files?.[0])} /></label>
                  {o.music && <><Input type="number" min={-40} max={0} value={o.musicDb} onChange={(e) => setO({ ...o, musicDb: Math.max(-40, Math.min(0, Number(e.target.value) || -20)) })} className="w-20" aria-label="Громкость музыки, дБ" /><span className="text-xs text-muted-foreground">дБ</span><button type="button" className="text-xs text-muted-foreground hover:text-accent" onClick={() => setO({ ...o, music: "", musicName: "" })}>убрать</button></>}
                </div>{up.err ? <ErrorAlert error={up.err} /> : null}</div>
              {draft.status === "running" ? <><Button variant="danger" className="w-full" onClick={draft.cancel}><X className="h-4 w-4" />Стоп</Button><ProgressBar value={draft.pct} label={draft.stage} /></>
                : <Button className="w-full" onClick={runDraft} disabled={meta.data?.ffmpeg === false}><Play className="h-4 w-4" />Собрать видео</Button>}
              {draft.status === "error" && <ErrorAlert error={draft.error} onRetry={runDraft} />}
            </>)}
            {shownDraft && draft.status !== "running" && <DraftView d={shownDraft} />}
          </Card>
          <Card className="space-y-3.5 p-5">
            <SectionTitle icon={<Smartphone className="h-4 w-4" />}>Shorts из сценария</SectionTitle>
            {!hasScript ? <p className="text-sm text-muted-foreground">В проекте нет сценария.</p> : (<>
              <div className="flex items-center gap-3"><Label>Сколько</Label><Select value={so.count} onChange={(e) => setSo({ ...so, count: Number(e.target.value) })} className="w-20" aria-label="Сколько Shorts">{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</Select></div>
              <Switch checked={so.voice || so.video} onChange={(x) => setSo({ ...so, voice: x, video: x ? so.video : false })} label="Озвучить каждый" description="голос из настроек" />
              <Switch checked={so.video} onChange={(x) => setSo({ ...so, video: x, voice: x || so.voice })} label="Собрать вертикальные видео" description="1080×1920, субтитры, обложки/карточки (FFmpeg)" />
              {shorts.status === "running" ? <><Button variant="danger" className="w-full" onClick={shorts.cancel}><X className="h-4 w-4" />Стоп</Button><ProgressBar value={shorts.pct} label={shorts.stage} /></>
                : <Button className="w-full" onClick={runShorts}><Smartphone className="h-4 w-4" />Сделать Shorts</Button>}
              {shorts.status === "error" && <ErrorAlert error={shorts.error} onRetry={runShorts} />}
            </>)}
          </Card>
          {shownShorts?.length ? <div className="xl:col-span-2"><ShortsView shorts={shownShorts} /></div> : null}
        </div>)}
    </div>
  );
}
