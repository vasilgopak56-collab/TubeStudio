import { StylePicker } from "@/components/StylePicker";
import { CONTENT_LANGUAGES } from "@/lib/constants";
import { useSettings } from "@/lib/queries";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, History, Loader2, Pause, Play, RotateCcw, SkipForward, Workflow, X, XCircle, MinusCircle, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { useDraft } from "@/lib/draft";
import { ago } from "@/lib/format";
import { Badge, Button, Card, Chip, ErrorAlert, Input, Label, ProgressBar, SectionTitle, Select, Switch, Textarea, ToolHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

type StageId = "script" | "rater" | "seo" | "thumbnail" | "storyboard" | "voice" | "video" | "shorts";
type Stage = { id: StageId; label: string; status: "pending" | "running" | "done" | "skipped" | "error"; summary?: string; error?: string; artifactId?: string; startedAt?: string; endedAt?: string };
type Pipe = { id: string; createdAt: string; status: "running" | "paused" | "done" | "error"; pausedAfter?: StageId; projectId?: string; title?: string; stages: Stage[]; input: { topic: string; stages: StageId[]; pauseAfter: StageId[] }; data: { videoUrl?: string; audioUrl?: string; thumbUrls?: string[] } };
const ALL: { id: StageId; label: string; hint: string }[] = [
  { id: "script", label: "Сценарий", hint: "ресёрч, план, текст, живой голос" },
  { id: "rater", label: "Оценка сценария", hint: "балл, хук, удержание" },
  { id: "seo", label: "SEO", hint: "заголовки, описание, теги" },
  { id: "thumbnail", label: "Обложки", hint: "3 варианта, картинки" },
  { id: "storyboard", label: "Раскадровка", hint: "промпты сцен" },
  { id: "voice", label: "Озвучка", hint: "MP3 голосом AnyModel" },
  { id: "video", label: "Видео-черновик", hint: "MP4 + субтитры (нужен FFmpeg)" },
  { id: "shorts", label: "Shorts", hint: "3 коротких ролика из сценария" },
];
const TOOL: Partial<Record<StageId, string>> = { script: "/script", seo: "/seo", thumbnail: "/thumbnail", storyboard: "/storyboard", voice: "/voice", video: "/video", shorts: "/video" };
type Form = { visualStyleId?: string; language: string; topic: string; hook: string; niche: string; keywords: string; words: number; tone: "serious" | "ironic" | "dramatic" | "friendly"; research: boolean; stages: StageId[]; pauseAfter: StageId[]; voiceModel: string; images: number; vertical: boolean; subtitles: boolean; projectId?: string };
const EMPTY: Form = { language: "", topic: "", hook: "", niche: "", keywords: "", words: 1500, tone: "serious", research: true, stages: ["script", "rater", "seo", "thumbnail", "storyboard"], pauseAfter: ["script"], voiceModel: "", images: 10, vertical: false, subtitles: true };
const TONES = [["serious", "Серьёзно"], ["ironic", "С иронией"], ["dramatic", "Драматично"], ["friendly", "Дружески"]] as const;

function StageIcon({ s }: { s: Stage["status"] }) {
  if (s === "done") return <CheckCircle2 className="h-5 w-5 text-success" />;
  if (s === "running") return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
  if (s === "error") return <XCircle className="h-5 w-5 text-accent" />;
  if (s === "skipped") return <MinusCircle className="h-5 w-5 text-muted-foreground" />;
  return <CircleDashed className="h-5 w-5 text-muted-foreground/60" />;
}

export default function Pipeline() {
  const [sp, setSp] = useSearchParams();
  const settings = useSettings();
  const qc = useQueryClient();
  const [f, setF] = useDraft<Form>("pipeline", EMPTY);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  const job = useJob<Pipe, unknown>("/pipeline");
  const id = sp.get("id");
  const meta = useQuery({ queryKey: ["pipeline-meta"], queryFn: () => api<{ ffmpeg: boolean }>("/pipeline/meta") });
  const lang = f.language || settings.data?.contentLanguage || "ru";
  const voices = useQuery({ queryKey: ["tts-voices", lang], queryFn: () => api<{ voices: { model: string; name: string }[]; selected: string }>(`/tts/voices?lang=${lang}`), enabled: f.stages.includes("voice"), retry: false, staleTime: 30 * 60_000 });
  const list = useQuery({ queryKey: ["pipelines"], queryFn: () => api<{ items: { id: string; createdAt: string; title: string; status: Pipe["status"]; projectId?: string }[] }>("/pipelines") });
  const loaded = useQuery({ queryKey: ["pipeline", id], queryFn: () => api<Pipe>(`/pipeline/${id}`), enabled: !!id && job.status !== "running" });
  useEffect(() => { const t = sp.get("topic"); if (t) { set({ topic: t, hook: sp.get("hook") ?? "", niche: sp.get("niche") ?? f.niche, keywords: sp.get("keywords") ?? f.keywords, projectId: sp.get("projectId") ?? undefined }); setSp({}, { replace: true }); } }, []); // eslint-disable-line
  const live = job.status === "running" ? (job.partial as Pipe | undefined) : undefined;
  useEffect(() => { const p = (job.partial as Pipe | undefined) ?? job.data; if (p?.id && p.id !== id) setSp({ id: p.id }, { replace: true }); }, [job.partial, job.data]); // eslint-disable-line
  useEffect(() => { if (job.status === "done" || job.status === "error") { qc.invalidateQueries({ queryKey: ["pipelines"] }); qc.invalidateQueries({ queryKey: ["pipeline", id] }); qc.invalidateQueries({ queryKey: ["projects"] }); } }, [job.status]); // eslint-disable-line
  const p: Pipe | undefined = live ?? (job.status === "done" && job.data?.id === id ? job.data : undefined) ?? loaded.data;
  const toggle = (k: "stages" | "pauseAfter", s: StageId) => set({ [k]: f[k].includes(s) ? f[k].filter((x) => x !== s) : [...f[k], s] } as Partial<Form>);
  const valid = f.topic.trim().length >= 3;
  const submit = () => valid && job.start({
    language: lang, topic: f.topic.trim(), hook: f.hook.trim() || undefined, niche: f.niche.trim() || undefined, keywords: f.keywords.split(",").map((x) => x.trim()).filter(Boolean),
    visualStyleId: f.stages.includes("storyboard") ? f.visualStyleId || undefined : undefined, words: f.words, tone: f.tone, research: f.research, stages: f.stages, pauseAfter: f.pauseAfter.filter((s) => f.stages.includes(s) || s === "script"),
    voice: { model: f.voiceModel || voices.data?.selected || undefined }, video: { images: f.images, vertical: f.vertical, subtitles: f.subtitles }, projectId: f.projectId,
  });
  const resume = (skip = false) => p && job.start({ skip }, `/pipeline/${p.id}/resume`);
  const rerun = (stage: StageId) => p && job.start({ stage }, `/pipeline/${p.id}/rerun`);
  const running = job.status === "running";
  const err = p?.stages.find((s) => s.status === "error");
  const next = p?.stages.find((s) => s.status === "pending");

  return (
    <div>
      <ToolHeader icon={Workflow} title="Одна кнопка" eyebrow="// FULL PIPELINE"
        subtitle="Тема → сценарий → оценка → SEO → обложки → раскадровка → озвучка → видео-черновик → Shorts. Всё сохраняется в проект; после выбранных этапов — пауза «проверь и продолжай»" />
      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card brackets className="p-5">
            <form className="space-y-3.5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <Textarea label="Тема" required value={f.topic} onChange={(e) => set({ topic: e.target.value, projectId: undefined })} rows={2} maxLength={1000} placeholder="Почему средневековые люди боялись купаться" />
              <Textarea label="Хук (необязательно)" value={f.hook} onChange={(e) => set({ hook: e.target.value })} rows={2} maxLength={2000} />
              <div className="grid grid-cols-2 gap-3">
                <div><Label hint="для оценки и SEO">Ниша</Label><Input value={f.niche} onChange={(e) => set({ niche: e.target.value })} placeholder="история" aria-label="Ниша" /></div>
                <div><Label>Объём</Label><Select value={f.words} onChange={(e) => set({ words: Number(e.target.value) })} aria-label="Объём">{[120, 180, 300, 800, 1500, 2500, 4000, 6000].map((w) => <option key={w} value={w}>{w} слов</option>)}</Select></div>
              </div>
              <div><Label>Язык контента</Label><Select aria-label="Язык контента" value={f.language || ""} onChange={e => set({language: e.target.value, voiceModel: ""})}><option value="">Из настроек</option>{CONTENT_LANGUAGES.map(l => <option key={l.value} value={l.value} lang={l.value} dir="auto">{l.label}</option>)}</Select></div>
              <div><Label hint="через запятую">Ключи SEO</Label><Input value={f.keywords} onChange={(e) => set({ keywords: e.target.value })} aria-label="Ключи SEO" /></div>
              <div className="flex flex-wrap gap-1.5">{TONES.map(([v, l]) => <Chip key={v} type="button" active={f.tone === v} onClick={() => set({ tone: v })}>{l}</Chip>)}</div>
              <Switch checked={f.research} onChange={(x) => set({ research: x })} label="Ресёрч фактов" description="веб/Википедия перед написанием" />
              <div>
                <Label hint="галочка справа — пауза после этапа">Этапы</Label>
                <ul className="mt-1 divide-y divide-border rounded-md border border-border" data-testid="stage-picker">
                  {ALL.map((s) => { const on = s.id === "script" || f.stages.includes(s.id); const off = (s.id === "video" && meta.data && !meta.data.ffmpeg); return (
                    <li key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <input type="checkbox" checked={on} disabled={s.id === "script"} onChange={() => toggle("stages", s.id)} aria-label={s.label} />
                      <span className={cn("flex-1", !on && "text-muted-foreground")}>{s.label} <span className="text-[11px] text-muted-foreground">— {off ? "FFmpeg не найден" : s.hint}</span></span>
                      <button type="button" disabled={!on} onClick={() => toggle("pauseAfter", s.id)} aria-label={`Пауза после «${s.label}»`} className={cn("rounded p-1", f.pauseAfter.includes(s.id) && on ? "bg-crown/15 text-crown" : "text-muted-foreground/50 hover:text-foreground")}><Pause className="h-3.5 w-3.5" /></button>
                    </li>); })}
                </ul>
              </div>
              {f.stages.includes("storyboard") && <StylePicker value={f.visualStyleId} onChange={id=>set({visualStyleId:id||undefined})}/>}
              {f.stages.includes("voice") && <div><Label>Голос</Label><Select value={f.voiceModel} onChange={(e) => set({ voiceModel: e.target.value })} aria-label="Голос"><option value="">из настроек{voices.data?.selected ? ` (${voices.data.selected.split("/").pop()})` : ""}</option>{(voices.data?.voices ?? []).map((v) => <option key={v.model} value={v.model}>{v.name}</option>)}</Select></div>}
              {f.stages.includes("video") && (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <div className="flex items-center gap-3"><Label>Картинок сцен</Label><Input type="number" min={0} max={40} value={f.images} onChange={(e) => set({ images: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })} className="w-20" aria-label="Картинок сцен" /></div>
                  <p className="text-[11px] text-muted-foreground">Генерируются по промптам раскадровки (тратит баланс). 0 — без генерации: обложки проекта и текстовые карточки.</p>
                  <Switch checked={f.subtitles} onChange={(x) => set({ subtitles: x })} label="Вшить субтитры" />
                  <Switch checked={f.vertical} onChange={(x) => set({ vertical: x })} label="Вертикальное 9:16" />
                </div>)}
              {running ? <Button type="button" variant="danger" className="w-full" onClick={job.cancel}><X className="h-4 w-4" />Стоп</Button>
                : <Button type="submit" className="w-full" disabled={!valid}><Play className="h-4 w-4" />Запустить</Button>}
              {job.status === "error" && <ErrorAlert error={job.error} />}
            </form>
          </Card>
          <Card className="p-4">
            <SectionTitle icon={<History className="h-4 w-4" />}>Запуски</SectionTitle>
            {!list.data?.items.length ? <p className="text-sm text-muted-foreground">Пока нет.</p> : (
              <ul className="space-y-1">{list.data.items.slice(0, 12).map((x) => (
                <li key={x.id}><button type="button" onClick={() => setSp({ id: x.id })} className={cn("flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted", x.id === id && "bg-muted")}>
                  <span className="min-w-0 flex-1 truncate">{x.title}</span>
                  <Badge tone={x.status === "done" ? "success" : x.status === "error" ? "danger" : x.status === "paused" ? "crown" : "primary"}>{{ done: "готово", error: "ошибка", paused: "пауза", running: "идёт" }[x.status]}</Badge>
                  <span className="text-[10px] text-muted-foreground">{ago(x.createdAt)}</span></button></li>))}</ul>)}
          </Card>
        </div>

        <div className="space-y-4" data-testid="pipeline-view">
          {!p ? <Card className="p-8 text-center text-sm text-muted-foreground">Укажите тему, отметьте этапы и нажмите «Запустить». Сценарий на 1500 слов — 2–4 мин, обложки ~1 мин, озвучка 1–3 мин, видео 2–5 мин.</Card> : (<>
            <Card className="p-5">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1"><h2 className="truncate text-lg font-semibold">{p.title ?? p.input.topic}</h2>
                  <p className="text-xs text-muted-foreground">{p.stages.filter((s) => s.status === "done").length} из {p.stages.length} этапов{p.projectId && <> · <Link className="underline" to={`/projects/${p.projectId}`}>проект</Link></>}</p></div>
                <Badge tone={p.status === "done" ? "success" : p.status === "error" ? "danger" : p.status === "paused" ? "crown" : "primary"}>{{ done: "Готово", error: "Ошибка", paused: "Пауза", running: "Выполняется" }[p.status]}</Badge>
              </div>
              {running && <div className="mt-3"><ProgressBar value={job.pct} label={job.stage} /></div>}
              {!running && p.status === "paused" && next && (
                <div className="mt-4 rounded-md border border-crown/40 bg-crown/5 p-3 text-sm" data-testid="pipeline-paused">
                  <b>Пауза после «{p.stages.find((s) => s.id === p.pausedAfter)?.label}».</b> Проверьте результат{p.projectId && p.pausedAfter && TOOL[p.pausedAfter] ? <> (<Link className="underline" to={`${TOOL[p.pausedAfter]}?projectId=${p.projectId}`}>открыть</Link>)</> : ""} — правки в инструменте сохраняются новой версией, но конвейер продолжит со своим текстом. Дальше: «{next.label}».
                  <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" onClick={() => resume()}><Play className="h-3.5 w-3.5" />Продолжить</Button><Button size="sm" variant="outline" onClick={() => resume(true)}><SkipForward className="h-3.5 w-3.5" />Пропустить «{next.label}»</Button></div>
                </div>)}
              {!running && p.status === "error" && err && (
                <div className="mt-4 rounded-md border border-accent/40 bg-accent/5 p-3 text-sm">
                  <b>«{err.label}» не выполнен:</b> {err.error}
                  <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" onClick={() => resume()}><RotateCcw className="h-3.5 w-3.5" />Повторить</Button>{err.id !== "script" && <Button size="sm" variant="outline" onClick={() => resume(true)}><SkipForward className="h-3.5 w-3.5" />Пропустить и дальше</Button>}</div>
                </div>)}
              {!running && p.status === "running" && <p className="mt-3 text-xs text-muted-foreground">Конвейер был прерван (перезапуск сервера или закрытие страницы). <button type="button" className="underline" onClick={() => resume()}>Продолжить с места остановки</button></p>}
            </Card>
            <ol className="space-y-2">
              {p.stages.map((s) => (
                <li key={s.id}><Card className={cn("flex items-start gap-3 p-4", s.status === "running" && "border-primary/60")} data-testid={`stage-${s.id}`}>
                  <StageIcon s={s.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><b className="text-sm">{s.label}</b>{p.input.pauseAfter.includes(s.id) && <Pause className="h-3 w-3 text-crown" aria-label="пауза после этапа" />}{s.startedAt && s.endedAt && <span className="font-mono text-[10px] text-muted-foreground">{Math.round((+new Date(s.endedAt) - +new Date(s.startedAt)) / 1000)} с</span>}</div>
                    {s.summary && <p className="mt-0.5 text-sm text-muted-foreground">{s.summary}</p>}
                    {s.status === "error" && <p className="mt-0.5 text-sm text-accent">{s.error}</p>}
                    {s.status === "skipped" && <p className="mt-0.5 text-xs text-muted-foreground">пропущен</p>}
                    {s.id === "thumbnail" && s.status === "done" && !!p.data.thumbUrls?.length && <div className="mt-2 flex flex-wrap gap-2">{p.data.thumbUrls.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="h-16 rounded border border-border" /></a>)}</div>}
                    {s.id === "voice" && s.status === "done" && p.data.audioUrl && <audio controls preload="none" src={p.data.audioUrl} className="mt-2 w-full max-w-md" />}
                    {s.id === "video" && s.status === "done" && p.data.videoUrl && <video controls preload="metadata" src={p.data.videoUrl} className="mt-2 max-h-72 rounded border border-border" />}
                  </div>
                  {!running && s.status === "done" && <div className="flex shrink-0 gap-1">
                    {p.projectId && TOOL[s.id] && <Link to={`${TOOL[s.id]}?projectId=${p.projectId}${s.artifactId ? `&artifact=${s.artifactId}` : ""}`} className="rounded p-1.5 text-muted-foreground hover:text-primary" aria-label="Открыть в инструменте"><ExternalLink className="h-4 w-4" /></Link>}
                    <button type="button" onClick={() => (s.id !== "script" || confirm("Новый сценарий — все этапы будут выполнены заново. Продолжить?")) && rerun(s.id)} className="rounded p-1.5 text-muted-foreground hover:text-primary" aria-label={`Повторить «${s.label}»`}><RotateCcw className="h-4 w-4" /></button>
                  </div>}
                </Card></li>))}
            </ol>
          </>)}
        </div>
      </div>
    </div>
  );
}
