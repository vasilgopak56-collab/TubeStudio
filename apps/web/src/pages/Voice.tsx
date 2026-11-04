import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FolderOpen, Loader2, Mic, Play, Square, Upload, Volume2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { takeHandoff } from "@/lib/handoff";
import { useSaveSettings, useSettings } from "@/lib/queries";
import { CONTENT_LANGUAGES } from "@/lib/constants";
import type { Project, ProjectSummary } from "@/lib/types";
import { Badge, Button, Card, EmptyState, ErrorAlert, Input, Label, ProgressBar, SectionTitle, Select, Textarea, ToolHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { VoiceProvenance } from "@/features/projects/VoiceProvenance";

type VoiceT = { model: string; name: string; lang: string; gender: string; provider: string };
type Seg = { n: number; start: number; end: number; text: string };
type Audio = { url: string; bytes: number; seconds: number; model: string; chars: number; chunks: number; segments: Seg[]; artifactId?: string; projectId?: string; title: string; balanceTokens: number | null; uploaded?: boolean; provenance?: unknown };
type In = { language?: string; text: string; model?: string; title?: string; projectId?: string; sourceArtifactId?: string; sourceTextExpected?: string; speed?: number; pitch?: number };
type Est = { chars: number; chunks: number; tokens: number; usd: number };

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const SAMPLE = "Этому черепу девять тысяч лет. И в нём — дырка, которая зажила. Значит, человек пережил операцию.";

export default function Voice() {
  const [sp] = useSearchParams();
  const qc = useQueryClient();
  const settings = useSettings();
  const save = useSaveSettings();
  const [lang, setLang] = useState("ru");
  const [f, setF] = useState<In>({ text: "" });
  const [pick, setPick] = useState("");
  const [loadError, setLoadError] = useState<unknown>(null);
  const loadSequence = useRef(0);
  const fRef = useRef(f); fRef.current = f;
  const [speed, setSpeed] = useState(() => +(localStorage.getItem("ts:tts-speed") ?? 1) || 1);
  const [pitch, setPitch] = useState(() => +(localStorage.getItem("ts:tts-pitch") ?? 0) || 0);
  useEffect(() => { localStorage.setItem("ts:tts-speed", String(speed)); localStorage.setItem("ts:tts-pitch", String(pitch)); }, [speed, pitch]);
  const fx = useQuery({ queryKey: ["tts-fx"], queryFn: () => api<{ ffmpeg: boolean }>("/tts/fx"), staleTime: Infinity });
  const fxOn = Math.abs(speed - 1) >= 0.01 || pitch !== 0;
  const [res, setRes] = useState<Audio | null>(null);
  const voices = useQuery({ queryKey: ["tts-voices", lang], queryFn: () => api<{ voices: VoiceT[]; selected: string }>(`/tts/voices?lang=${lang}`), retry: false, staleTime: 30 * 60_000 });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<ProjectSummary[]>("/projects") });
  const proj = useQuery({ queryKey: ["project", f.projectId], queryFn: () => api<Project>(`/projects/${f.projectId}`), enabled: !!f.projectId });
  const job = useJob<Audio, In>("/tts");
  const configuredModel = settings.data?.anymodel?.tts || "fish-farm/s2.1-pro-free";
  const safeConfiguredModel = configuredModel.startsWith("edge-tts/") && !configuredModel.toLowerCase().startsWith(`edge-tts/${lang}-`) ? "fish-farm/s2.1-pro-free" : configuredModel;
  const model = f.model || voices.data?.selected || safeConfiguredModel;

  const scriptText = (data: unknown): string | undefined => typeof data === "string" ? data : data && typeof data === "object" && typeof (data as {script?: unknown}).script === "string" ? (data as {script: string}).script : undefined;
  const loadProject = async (id: string) => {
    const sequence = ++loadSequence.current; setLoadError(null);
    if (!id) { setPick(""); setF((x) => ({ ...x, projectId: undefined, sourceArtifactId: undefined })); return; }
    try {
      const p = await api<Project>(`/projects/${id}`); if (sequence !== loadSequence.current) return;
      const s = [...p.artifacts].reverse().find((a) => a.kind === "script" && scriptText(a.data) !== undefined);
      const text = s ? scriptText(s.data) : undefined;
      if (text !== undefined && fRef.current.text && fRef.current.text !== text && !window.confirm("Заменить текущий текст выбранным сценарием проекта? Текущий текст в этой форме не сохранится автоматически.")) return;
      setPick(p.id); setF((x) => ({ ...x, projectId: p.id, title: p.title, text: text ?? x.text, sourceArtifactId: s?.id }));
      const d = s?.data as {input?: {language?: string}} | undefined;
      if (d?.input?.language) { setLang(d.input.language); setF(x => ({...x, model: undefined})); }
    } catch (e) { if (sequence === loadSequence.current) setLoadError(e); }
  };
  const selectScript = (id: string) => {
    if (!id) { setF(x => ({...x, sourceArtifactId: undefined})); return; }
    const matches = proj.data?.artifacts.filter(a => a.id === id && a.kind === "script") ?? [];
    const a = matches.length === 1 ? matches[0] : undefined, text = a ? scriptText(a.data) : undefined;
    if (!a || text === undefined) { setLoadError(new Error("Не удалось прочитать выбранную версию. Обновите проект.")); return; }
    if (f.text && f.text !== text && !window.confirm("Заменить текущий текст выбранной версией? Текущий текст в этой форме не сохранится автоматически.")) return;
    setLoadError(null); setF(x => ({...x, text, sourceArtifactId: a.id}));
    const d = a.data as {input?: {language?: string}} | undefined;
    if (d?.input?.language) { setLang(d.input.language); setF(x => ({...x, model: undefined})); }
  };
  useEffect(() => {
    const h = takeHandoff();
    if (h?.text) { setF((x) => ({ ...x, text: h.text, title: h.title, projectId: h.projectId, sourceArtifactId: h.projectId ? h.sourceArtifactId : undefined })); if (h.projectId) setPick(h.projectId); if (h.language) { setLang(h.language); setF(x => ({...x, model: undefined})); } }
    else if (sp.get("projectId")) void loadProject(sp.get("projectId")!);
  }, []); // eslint-disable-line
  useEffect(() => { if (job.data) { setRes(job.data); qc.invalidateQueries({ queryKey: ["projects"] }); qc.invalidateQueries({ queryKey: ["project", job.data.projectId] }); qc.invalidateQueries({ queryKey: ["usage"] }); } }, [job.data]); // eslint-disable-line

  // оценка стоимости (без вызова нейросети)
  const [est, setEst] = useState<Est | null>(null);
  useEffect(() => {
    if (!f.text.trim()) { setEst(null); return; }
    const t = setTimeout(() => api<Est>("/tts/estimate", { method: "POST", json: { text: f.text, model } }).then(setEst).catch(() => setEst(null)), 400);
    return () => clearTimeout(t);
  }, [f.text, model]);

  // образец голоса
  const [preview, setPreview] = useState<{ model: string; url: string } | null>(null);
  const [pvBusy, setPvBusy] = useState(false); const [pvErr, setPvErr] = useState<unknown>(null);
  const listen = async () => {
    setPvBusy(true); setPvErr(null);
    try {
      const r = await fetch("/api/tts/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, text: f.text.trim().slice(0, 200) || SAMPLE, speed, pitch }) });
      if (!r.ok) { const j = await r.json().catch(() => null); throw new ApiError(j?.error?.code ?? "UPSTREAM", j?.error?.message ?? `HTTP ${r.status}`); }
      const url = URL.createObjectURL(await r.blob()); setPreview({ model, url });
      setTimeout(() => (document.getElementById("pv-audio") as HTMLAudioElement | null)?.play().catch(() => {}), 50);
    } catch (e) { setPvErr(e); } finally { setPvBusy(false); }
  };

  const audios = useMemo(() => (proj.data?.artifacts ?? []).filter((a) => a.kind === "audio").reverse().map((a) => ({ ...(a.data as Audio), id: a.id, title: a.title })), [proj.data]);
  const scriptChoices = (proj.data?.artifacts ?? []).filter(a => a.kind === "script");
  const selectedScript = scriptChoices.find(a => a.id === f.sourceArtifactId);
  const selectedText = selectedScript ? scriptText(selectedScript.data) : undefined;
  const vs = voices.data?.voices ?? [];
  const cur = vs.find((v) => v.model === model);

  return (
    <div>
      <ToolHeader icon={Mic} title="Озвучка" eyebrow="// TTS · ANYMODEL" subtitle="Сценарий → готовый MP3 голосом нейросети; или загрузите свою готовую озвучку в проект" />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_minmax(0,1fr)] [&>*]:min-w-0">
        <Card brackets className="h-fit p-5">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (f.sourceArtifactId && selectedText !== f.text && !window.confirm("Текст изменён относительно выбранной версии сценария. Запустить озвучку изменённого текста?")) return; job.start({ ...f, sourceTextExpected: f.sourceArtifactId ? selectedText : undefined, language: lang, model, speed, pitch }); }}>
            <div><Label>Взять из проекта</Label><Select aria-label="Взять из проекта" value={pick} onChange={(e) => void loadProject(e.target.value)}><option value="">— проект со сценарием —</option>{(projects.data ?? []).filter((p) => p.counts?.script).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select></div>
            {!!loadError && <ErrorAlert error={loadError} />}
            {f.projectId && <p className="text-xs text-muted-foreground">При выборе проекта автоматически подставляется последняя сохранённая версия. Проверьте или выберите другую.</p>}
            {f.projectId && <div><Label>Версия сценария</Label><Select aria-label="Версия сценария" value={f.sourceArtifactId ?? ""} onChange={e => selectScript(e.target.value)}><option value="">— без выбранной версии —</option>{scriptChoices.map(a => <option key={a.id} value={a.id}>{a.title} · {a.version ? `v${a.version}` : "без номера"} · {a.createdAt} · {a.id.slice(0,8)}</option>)}</Select>
              <p className="mt-1 text-xs text-muted-foreground" role="status">{f.sourceArtifactId ? selectedText === undefined ? "Версию пока не удалось прочитать; перед запуском проверьте проект." : f.text === selectedText ? "Текст совпадает с выбранной сохранённой версией." : "Текст изменён относительно выбранной версии. Озвучка сохранит это различие." : "Выбранной версии нет: текст будет отмечен как ручной."}</p>
              {proj.error && <ErrorAlert error={proj.error} onRetry={() => proj.refetch()} />}</div>}
            <Textarea label="Текст для озвучки" required value={f.text} maxLength={120000} rows={9} onChange={(e) => setF((x) => ({ ...x, text: e.target.value }))} placeholder="Вставьте сценарий. [VISUAL CUE], метки сцен и заголовки вырезаются автоматически" />
            {est && <p className="-mt-2 font-mono text-[11px] text-muted-foreground">{est.chars.toLocaleString("ru")} симв. · {est.chunks} частей · ≈ {mmss(est.chars / 15)} · {(est.tokens / 1e6).toFixed(2)} млн ток. ≈ ${est.usd.toFixed(3)}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-[160px_minmax(0,1fr)] gap-3">
              <div><Label>Язык</Label><Select value={lang} onChange={(e) => { setLang(e.target.value); setF(x => ({...x, model: undefined})); }}>{CONTENT_LANGUAGES.map((l) => <option key={l.value} value={l.value} lang={l.value} dir="auto">{l.label}</option>)}</Select></div>
              <div><Label hint={cur ? `${cur.gender} · ${cur.provider}` : undefined}>Голос</Label>
                <Select value={model} onChange={(e) => setF((x) => ({ ...x, model: e.target.value }))}>
                  {!cur && <option value={model}>{model}</option>}
                  {vs.map((v) => <option key={v.model} value={v.model}>{v.provider === "fish-farm" ? "★ " : ""}{v.name.replace(/\s*\(.*\)$/, "")}{v.gender && v.gender !== "—" ? ` · ${v.gender === "Male" ? "муж." : "жен."}` : ""}</option>)}
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3" data-testid="tts-fx">
              <div><Label hint={`${speed.toFixed(2)}×`}>Скорость</Label><input type="range" min={0.7} max={1.4} step={0.05} value={speed} onChange={(e) => setSpeed(+e.target.value)} className="w-full accent-[hsl(var(--primary))]" aria-label="Скорость" /></div>
              <div><Label hint={pitch ? `${pitch > 0 ? "+" : ""}${pitch} пт.` : "естественный"}>Тон</Label><input type="range" min={-6} max={6} step={1} value={pitch} onChange={(e) => setPitch(+e.target.value)} className="w-full accent-[hsl(var(--primary))]" aria-label="Тон" /></div>
            </div>
            {fxOn && <p className="-mt-2 text-[11px] text-muted-foreground">{fx.data?.ffmpeg === false ? <span className="text-accent">Нужен FFmpeg на компьютере (ffmpeg.org) — без него оставьте 1.0× и тон 0. </span> : null}Тон вниз — голос тяжелее, вверх — тоньше; середина — естественно. <button type="button" className="underline" onClick={() => { setSpeed(1); setPitch(0); }}>Сброс</button></p>}
            {voices.error ? <ErrorAlert error={voices.error} /> : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={listen} disabled={pvBusy}>{pvBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}Прослушать образец</Button>
              {model !== settings.data?.anymodel?.tts && settings.data && <Button type="button" size="sm" variant="ghost" onClick={() => save.mutate({ anymodel: { ...settings.data!.anymodel, tts: model } })}>Сделать голосом по умолчанию</Button>}
            </div>
            <p className="text-xs text-muted-foreground">Образец — отдельный запрос, может быть платным; проверка версии сценария для него не выполняется.</p>
            {model.startsWith("fish-farm/") && lang === "ru" && <p className="text-xs text-muted-foreground">При некоторых ошибках Fish программа может автоматически попробовать русский голос Edge. Это отдельный возможный платный запрос.</p>}
            {preview && preview.model === model && <audio id="pv-audio" controls src={preview.url} className="w-full" />}
            {pvErr ? <ErrorAlert error={pvErr} /> : null}
            <Input value={f.title ?? ""} onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} placeholder="Название (необязательно)" maxLength={200} />
            {f.projectId && <p className="text-xs text-muted-foreground">Сохранится в <Link className="underline" to={`/projects/${f.projectId}`}>проект</Link> · <button type="button" className="underline" onClick={() => { setPick(""); setF((x) => ({ ...x, projectId: undefined, sourceArtifactId: undefined })); }}>отвязать</button></p>}
            {job.status === "running"
              ? <div className="space-y-2"><ProgressBar value={job.pct} label={job.stage} /><Button type="button" variant="outline" onClick={job.cancel}><Square className="h-4 w-4" />Остановить</Button></div>
              : <Button type="submit" disabled={!f.text.trim() || !!loadError || (!!f.projectId && !!proj.error) || (!!f.sourceArtifactId && (proj.isLoading || selectedText === undefined))} className="w-full"><Play className="h-4 w-4" />Озвучить</Button>}
            {job.error && <ErrorAlert error={job.error} />}
          </form>
        </Card>

        <div className="space-y-6">
          {res ? <Result a={res} /> : job.status !== "running" && <Card><EmptyState icon={<Mic className="h-6 w-6" />} title="Здесь появится озвучка">Выберите проект или вставьте текст, подберите голос и нажмите «Озвучить». Готовый MP3 сохранится в проект — его можно скачать и отдать в монтаж.</EmptyState></Card>}
          <UploadCard projects={projects.data ?? []} projectId={f.projectId} onDone={(a) => { setRes(a); if (a.projectId) { setPick(a.projectId); setF((x) => ({ ...x, projectId: a.projectId, sourceArtifactId: x.projectId === a.projectId ? x.sourceArtifactId : undefined })); } qc.invalidateQueries({ queryKey: ["project", a.projectId] }); qc.invalidateQueries({ queryKey: ["projects"] }); }} />
          {audios.length > 0 && (
            <Card>
              <SectionTitle icon={<FolderOpen className="h-4 w-4" />}>Озвучки проекта</SectionTitle>
              <ul className="space-y-3">{audios.map((a) => (
                <li key={a.id} className="rounded-md border p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm"><b className="min-w-0 truncate">{a.title}</b><Badge>{a.uploaded ? "файл" : a.model}</Badge>{a.seconds ? <span className="font-mono text-xs text-muted-foreground">{mmss(a.seconds)}</span> : null}
                    <a className="ml-auto text-xs underline" href={a.url} download><Download className="mr-1 inline h-3.5 w-3.5" />скачать</a></div>
                  <VoiceProvenance value={a.provenance} />
                  <audio controls preload="none" src={a.url} className="w-full" />
                </li>))}</ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Result({ a }: { a: Audio }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [t, setT] = useState(0);
  return (
    <Card>
      <SectionTitle right={<a href={a.url} download><Button size="sm" variant="outline"><Download className="h-3.5 w-3.5" />MP3</Button></a>}>Готово: {a.title}</SectionTitle>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <Badge tone="success">{a.seconds ? mmss(a.seconds) : "—"}</Badge>
        <Badge>{a.uploaded ? "загружено" : a.model}</Badge>
        {a.chars ? <Badge>{a.chars.toLocaleString("ru")} симв.</Badge> : null}
        {a.balanceTokens === null ? <Badge>Расход токенов неизвестен</Badge> : a.balanceTokens ? <Badge>{(a.balanceTokens / 1e6).toFixed(2)} млн ток.</Badge> : null}
        <Badge>{(a.bytes / 1024 / 1024).toFixed(1)} МБ</Badge>
        {a.projectId && <Link className="underline" to={`/projects/${a.projectId}`}>в проекте</Link>}
      </div>
      <VoiceProvenance value={a.provenance} />
      <audio ref={ref} controls src={a.url} className="w-full" onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} />
      {(a.segments?.length ?? 0) > 1 && (
        <div className="mt-4">
          <p className="mono-label mb-2">Части · клик — перейти</p>
          <ol className="space-y-1.5">{(a.segments ?? []).map((s) => (
            <li key={s.n}><button type="button" onClick={() => { if (ref.current) { ref.current.currentTime = s.start; ref.current.play().catch(() => {}); } }}
              className={cn("w-full rounded-md border px-3 py-2 text-left text-sm hover:border-primary", t >= s.start && t < s.end && "border-primary bg-primary/5")}>
              <span className="mr-2 font-mono text-xs text-primary">{mmss(s.start)}</span>{s.text.slice(0, 160)}{s.text.length > 160 ? "…" : ""}
            </button></li>))}</ol>
        </div>
      )}
    </Card>
  );
}

function UploadCard({ projects, projectId, onDone }: { projects: ProjectSummary[]; projectId?: string; onDone: (a: Audio) => void }) {
  const [pid, setPid] = useState(projectId ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  useEffect(() => { if (projectId) setPid(projectId); }, [projectId]);
  const send = async () => {
    if (!file || !pid) return;
    setBusy(true); setErr(null);
    try {
      const seconds = await new Promise<number>((r) => { const el = new Audio(); el.preload = "metadata"; el.onloadedmetadata = () => r(Number.isFinite(el.duration) ? el.duration : 0); el.onerror = () => r(0); el.src = URL.createObjectURL(file); });
      const fd = new FormData(); fd.append("file", file); fd.append("projectId", pid); if (title) fd.append("title", title); if (seconds) fd.append("seconds", String(seconds));
      onDone(await api<Audio>("/tts/upload", { method: "POST", body: fd })); setFile(null); setTitle("");
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Card>
      <SectionTitle icon={<Upload className="h-4 w-4" />}>Готовая озвучка → в проект</SectionTitle>
      <p className="mb-3 text-sm text-muted-foreground">Уже есть файл (с anymodel.org, ElevenLabs, свой голос)? Загрузите его — он ляжет в проект рядом со сценарием. MP3, WAV, M4A, AAC, OGG, WEBM, FLAC, до 300 МБ.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label>Проект</Label><Select value={pid} onChange={(e) => setPid(e.target.value)}><option value="">— выберите проект —</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select></div>
        <div><Label>Файл</Label><input data-testid="audio-file" type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.webm,.flac" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm" /></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Input className="min-w-0 flex-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название (необязательно)" maxLength={160} />
        <Button onClick={send} disabled={!file || !pid || busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Загрузить</Button>
      </div>
      {err ? <div className="mt-3"><ErrorAlert error={err} /></div> : null}
    </Card>
  );
}
