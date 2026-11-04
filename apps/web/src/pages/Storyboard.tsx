import {StoryboardPromptRevision} from '@/features/assistant/StoryboardPromptRevision';
import {StoryboardEditorTransfer} from '@/features/assistant/StoryboardEditorTransfer';
import {readStoryboardEditorTransfer,clearStoryboardEditorTransfer} from '@/lib/storyboardEditorTransfer';
import {StoryboardProjectPicker} from '@/features/assistant/StoryboardProjectPicker';
import {StoryboardSavedInput} from '@/features/assistant/StoryboardSavedInput';
import {StoryboardHandoff} from '@/features/assistant/StoryboardHandoff';
import { StylePicker } from "@/components/StylePicker";
import type { VisualStyle } from "@/lib/visualStyles";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, CheckCircle2, Clapperboard, Download, FolderOpen, ImageIcon, Loader2, Play, RotateCw, X, XCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { useDraft } from "@/lib/draft";
import type { Project, ProjectSummary } from "@/lib/types";
import { Badge, Button, Card, Chip, CopyButton, EmptyState, ErrorAlert, Label, ProgressBar, Select, Switch, Textarea, ToolHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

type Meta = { styles: { id: string; name: string }[]; presets?: { id: string; name: string; hint: string }[]; imageModels: { id: string; name: string }[]; videoModels: { id: string; name: string; clips: number[] }[] };
type Row = { n: number; text: string; words: number; seconds: number; start: number; concept: string; image: string; video: string; clip: number; clips: number; batch: number };
type Bible = { medium: string; palette: string; lighting: string; camera: string; mood: string; negative: string; characters: { id: string; name: string; description: string }[]; locations: { id: string; name: string; description: string }[] };
type Batch = { n: number; from: number; to: number; errors: string[]; warnings: string[]; retried: boolean };
type Result = { manualPromptRevision?: {sourceArtifactId:string;position?:number;positions?:number[]}; visualStyle?: VisualStyle; rows: Row[]; bible: Bible; batches: Batch[]; totalUnits: number; totalSeconds: number; done: boolean; model: string; projectId?: string };
type In = { visualStyleId?: string; script: string; style: string; customStyle?: string; preset?: string; imageModel: string; videoModel: string; clip: number; maxBatches?: number; projectId?: string };
const INIT: In = { script: "", style: "universal", customStyle: "", imageModel: "midjourney", videoModel: "kling", clip: 5 };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
function download(name: string, text: string, type: string) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href); }
const csvCell = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;

export default function Storyboard() {
  const [sp] = useSearchParams();
  const location = useLocation(), nav = useNavigate();
  const incoming = (location.state as {assistantStoryboard?:unknown} | null)?.assistantStoryboard;
  const transferId = sp.get("editorTransfer");
  const [editorTransfer] = useState(()=>readStoryboardEditorTransfer(transferId));
  useEffect(()=>{clearStoryboardEditorTransfer(transferId);}, []); // eslint-disable-line
  const qc = useQueryClient();
  const [f, setF] = useDraft<In>("storyboard", INIT);
  const draftRef = useRef(f); draftRef.current = f;
  const set = <K extends keyof In>(k: K, v: In[K]) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => { const id = sp.get("visualStyle"); if (id) set("visualStyleId", id); }, [sp]);
  const meta = useQuery({ queryKey: ["storyboard-meta"], queryFn: () => api<Meta>("/storyboard/meta"), staleTime: Infinity });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<ProjectSummary[]>("/projects") });
  const [testOnly, setTestOnly] = useState(false);
  const testOnlyRef = useRef(testOnly); testOnlyRef.current = testOnly;
  const job = useJob<Result, In>("/storyboard");
  const [res, setRes] = useState<Result | null>(null);
  const [frames, setFrames] = useState<Record<number, { src?: string; loading?: boolean; error?: string }>>({});
  const [showBible, setShowBible] = useState(false);
  const seg = useQuery({ queryKey: ["sb-seg", f.script, f.style], gcTime: 10000, queryFn: () => api<{ units: number; batches: unknown[]; totalSeconds: number }>("/storyboard/segment", { method: "POST", json: { script: f.script, style: f.style } }), enabled: f.script.trim().length >= 200 });

  useEffect(() => { if (!incoming && !transferId && sp.get("projectId") && !sp.get("artifact")) set("projectId", sp.get("projectId")!); }, []); // eslint-disable-line
  const art = useQuery({ queryKey: ["project", sp.get("projectId")], queryFn: () => api<Project>(`/projects/${sp.get("projectId")}`), enabled: !!sp.get("projectId") && !!sp.get("artifact") });
  useEffect(() => { if (!sp.get("artifact")) return; const a = art.data?.artifacts.find((x) => x.id === sp.get("artifact") && x.kind === "storyboard"); const d = a?.data as Result | undefined; setRes(d && Array.isArray(d.rows) && Array.isArray(d.batches) && d.bible ? { ...d, projectId: art.data!.id } : null); setFrames({}); }, [art.data, sp.get("artifact")]); // eslint-disable-line
  useEffect(() => { if (job.data) { setRes(job.data); qc.invalidateQueries({ queryKey: ["projects"] }); } }, [job.data]); // eslint-disable-line
  const statusRef = useRef(job.status); statusRef.current = job.status;
  const resultRef = useRef(res); resultRef.current = res;
  const live: Result | null = job.status === "running" && job.partial?.rows ? { rows: job.partial.rows, bible: job.partial.bible as Bible, batches: job.partial.batches ?? [], totalUnits: seg.data?.units ?? 0, totalSeconds: 0, done: false, model: "" } : res;

  const vm = meta.data?.videoModels.find((v) => v.id === f.videoModel);
  useEffect(() => { if (vm && !vm.clips.includes(f.clip)) set("clip", vm.clips[0]); }, [vm?.id]); // eslint-disable-line

  const valid = f.script.trim().length >= 200;
  const submit = () => valid && job.start({ ...f, script: f.script.trim(), customStyle: f.customStyle?.trim() || undefined, maxBatches: testOnly ? 1 : undefined });

  const frame = async (r: Row) => {
    setFrames((x) => ({ ...x, [r.n]: { loading: true } }));
    try { const d = await api<{ url?: string; dataUrl?: string }>("/storyboard/frame", { method: "POST", json: { prompt: r.image, projectId: live?.projectId ?? f.projectId } }); setFrames((x) => ({ ...x, [r.n]: { src: d.url ?? d.dataUrl } })); }
    catch (e) { setFrames((x) => ({ ...x, [r.n]: { error: (e as ApiError).message } })); }
  };
  const framesUsed = Object.values(frames).filter((x) => x.src || x.loading).length;
  const rows = live?.rows ?? [];
  const exp = useMemo(() => ({
    csv: () => ["n,start,duration,clip,clips,line,concept,image_prompt,video_prompt", ...rows.map((r) => [r.n, mmss(r.start), r.seconds, r.clip, r.clips, r.text, r.concept, r.image, r.video].map(csvCell).join(","))].join("\n"),
    txt: () => rows.map((r) => `#${r.n} [${mmss(r.start)} · ${r.seconds}s]\n${r.text}\nIMAGE: ${r.image}\nVIDEO: ${r.video}`).join("\n\n"),
    json: () => JSON.stringify({ visualStyle: live?.visualStyle, bible: live?.bible, scenes: rows }, null, 2),
  }), [rows, live]);

  return (
    <div>
      <ToolHeader icon={Clapperboard} title="Раскадровка" eyebrow="// STORYBOARD" subtitle="Сценарий → сцены с image- и video-промптами: библия стиля, батчи с валидаторами, экспорт CSV/JSON/TXT" />
      <p className="mb-4 text-sm text-muted-foreground">Уже есть готовая озвучка? <Link className="text-primary underline" to="/audio-storyboard">Раскадровка из аудио по реальным паузам →</Link></p>
      {transferId&&<StoryboardEditorTransfer value={editorTransfer} draft={f} draftFingerprint={JSON.stringify([f,testOnly])} running={job.status==='running'} onCancel={()=>{const q=new URLSearchParams(location.search);q.delete('editorTransfer');nav(location.pathname+(q.toString()?'?'+q.toString():''),{replace:true,state:null});}} onApply={p=>{setF(x=>({...x,script:p.text,projectId:p.projectId}));setRes(null);setFrames({});const q=new URLSearchParams(location.search);q.delete('editorTransfer');nav(location.pathname+(q.toString()?'?'+q.toString():''),{replace:true,state:null});}}/>}
      {Boolean(incoming)&&<StoryboardHandoff key={location.key} value={incoming} draft={f} getDraft={()=>JSON.stringify([draftRef.current,statusRef.current])} running={job.status==='running'} onCancel={()=>nav(location.pathname+location.search,{replace:true,state:null})} onApply={p=>{setF(x=>({...x,script:p.text,projectId:p.project.id}));setRes(null);setFrames({});nav(location.pathname+location.search,{replace:true,state:null});}}/>}
      {sp.get("projectId")&&sp.get("artifact")&&<StoryboardSavedInput key={sp.get("projectId")+":"+sp.get("artifact")} projectId={sp.get("projectId")!} artifactId={sp.get("artifact")!} draft={f} draftFingerprint={JSON.stringify([f,testOnly])} getDraft={()=>JSON.stringify([draftRef.current,testOnlyRef.current,statusRef.current])} running={job.status==='running'} onApply={input=>{const {maxBatches,...rest}=input;setF({...INIT,...rest});setTestOnly(maxBatches===1);}}/>}
      {sp.get("projectId")&&sp.get("artifact")&&art.data?.artifacts.some(a=>a.id===sp.get("artifact")&&a.kind==="storyboard"&&(a.data as {source?:string})?.source!=="audio")&&<StoryboardPromptRevision key={"prompt-revision:"+sp.get("projectId")+":"+sp.get("artifact")} projectId={sp.get("projectId")!} artifactId={sp.get("artifact")!} running={job.status==='running'}/>}
      <StoryboardProjectPicker projects={projects.data ?? []} draft={f} draftFingerprint={JSON.stringify([f,testOnly])} getDraft={()=>({fingerprint:JSON.stringify([draftRef.current,testOnlyRef.current,statusRef.current]),result:resultRef.current})} running={job.status==='running'} onApply={p=>{setF(x=>({...x,script:p.text,projectId:p.project.id}));setRes(null);setFrames({});}}/>
      <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <Card brackets className="h-fit p-5">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <p className="text-xs text-muted-foreground">Если результат успешно сохранится в выбранном проекте, полный переданный сценарий и параметры сохранятся вместе с ним. Проверьте конфиденциальность. Раскадровка использует собственные модели и может быть платной.</p>
            <Textarea label="Сценарий" aria-label="Сценарий" required value={f.script} maxLength={60000} rows={9} onChange={(e) => set("script", e.target.value)} placeholder="Текст сценария (ремарки в [скобках] и заголовки вырезаются)" />
            {seg.data && <p className="-mt-2 font-mono text-[11px] text-muted-foreground">{seg.data.units} сцен · {seg.data.batches.length} батч(ей) · ≈ {mmss(seg.data.totalSeconds)}</p>}
            {f.projectId && <p className="-mt-2 text-xs text-muted-foreground">Сохранится в <Link className="underline" to={`/projects/${f.projectId}`}>проект</Link> · <button type="button" className="underline" onClick={() => set("projectId", undefined)}>отвязать</button></p>}
            <StylePicker value={f.visualStyleId} onChange={id=>set("visualStyleId",id||undefined)} disabled={job.status === "running"} />
            <div><Label>Стиль ниши (структура)</Label><Select value={f.style} onChange={(e) => set("style", e.target.value)}>{meta.data?.styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
            {!!meta.data?.presets?.length && <div><Label hint={meta.data.presets.find((p) => p.id === f.preset)?.hint ?? "18 пресетов YT-Genius; поверх стиля ниши"}>Визуальный пресет</Label>
              <Select disabled={!!f.visualStyleId} value={f.preset ?? ""} onChange={(e) => set("preset", e.target.value || undefined)}><option value="">— из стиля ниши —</option>{meta.data.presets.map((p) => <option key={p.id} value={p.id}>{p.id} · {p.name}</option>)}</Select></div>}
            {(f.style === "universal" || !!f.visualStyleId) && <Textarea label="Свой стиль" value={f.customStyle ?? ""} maxLength={2000} rows={3} onChange={(e) => set("customStyle", e.target.value)} placeholder="Например: тёмная акварель, приглушённая палитра, плёночное зерно, без людей крупным планом" />}
            <div><Label>Модель картинок</Label><div className="flex flex-wrap gap-1.5">{meta.data?.imageModels.map((m) => <Chip key={m.id} active={f.imageModel === m.id} onClick={() => set("imageModel", m.id)}>{m.name}</Chip>)}</div></div>
            <div><Label>Модель видео</Label><div className="flex flex-wrap gap-1.5">{meta.data?.videoModels.map((m) => <Chip key={m.id} active={f.videoModel === m.id} onClick={() => set("videoModel", m.id)}>{m.name}</Chip>)}</div></div>
            <div><Label>Длина клипа</Label><div className="flex gap-1.5">{vm?.clips.map((c) => <Chip key={c} active={f.clip === c} onClick={() => set("clip", c)}>{c} с</Chip>)}</div></div>
            <Switch checked={testOnly} onChange={setTestOnly} label="Только первый батч" description="Быстрая проверка стиля перед полной раскадровкой" />
            {job.status === "running" ? <div className="space-y-3"><ProgressBar value={job.pct} label={job.stage} /><Button type="button" variant="danger" onClick={job.cancel}><X className="h-4 w-4" />Остановить</Button></div>
              : <Button type="submit" size="lg" className="w-full" disabled={!valid}><Play className="h-4 w-4" />Сделать раскадровку</Button>}
            {job.status === "error" && <ErrorAlert error={job.error} onRetry={submit} />}
          </form>
        </Card>

        <div className="min-w-0 space-y-4">
          {!live ? <Card className="p-10"><EmptyState icon={<Clapperboard className="h-8 w-8" />} title="Здесь появится таблица сцен">Шаг 1 — сегментация, 3a — библия стиля и ассеты, 3b/3c — батчи image/video-промптов с валидаторами. ≈ 20–40 с на батч.</EmptyState></Card> : (<>
            <Card className="flex flex-wrap items-center gap-2 p-3 text-sm">
              {live.visualStyle && <span className="text-primary">{live.visualStyle.name} · r{live.visualStyle.revision}</span>}
              <span><b>{rows.length}</b>{live.totalUnits ? ` из ${live.totalUnits}` : ""} сцен</span>
              {live.batches.map((b) => <Badge key={b.n} tone={b.errors.length ? "danger" : b.warnings.length ? "crown" : "success"}>батч {b.n}{b.retried ? " ↻" : ""}</Badge>)}
              {!live.done && job.status !== "running" && <Badge tone="crown">частично</Badge>}
              <span className="flex-1" />
              {live.bible && <Button size="sm" variant="ghost" onClick={() => setShowBible((v) => !v)}><BookOpen className="h-3.5 w-3.5" />Библия стиля</Button>}
              <Button size="sm" variant="outline" disabled={!rows.length} onClick={() => download("storyboard.csv", "\uFEFF" + exp.csv(), "text/csv")}><Download className="h-3.5 w-3.5" />CSV</Button>
              <Button size="sm" variant="outline" disabled={!rows.length} onClick={() => download("storyboard.json", exp.json(), "application/json")}>JSON</Button>
              <Button size="sm" variant="outline" disabled={!rows.length} onClick={() => download("storyboard.txt", exp.txt(), "text/plain")}>TXT</Button>
              {live.projectId && <Link className="text-xs underline" to={`/projects/${live.projectId}`}><FolderOpen className="mr-1 inline h-3.5 w-3.5" />проект</Link>}
            </Card>

            {showBible && live.bible && <Card className="space-y-2 p-4 text-sm">
              {([["Техника", live.bible.medium], ["Палитра", live.bible.palette], ["Свет", live.bible.lighting], ["Камера", live.bible.camera], ["Настроение", live.bible.mood], ["Избегать", live.bible.negative]] as const).map(([k, v]) => <p key={k}><span className="mono-label mr-2 text-muted-foreground">{k}</span>{v}</p>)}
              {[...live.bible.characters, ...live.bible.locations].length > 0 && <div className="grid gap-2 pt-1 md:grid-cols-2">{[...live.bible.characters, ...live.bible.locations].map((c) => <div key={c.id} className="rounded-md border p-2"><div className="font-mono text-xs text-primary">[{c.id}] {c.name}</div><p className="text-xs text-muted-foreground">{c.description}</p></div>)}</div>}
            </Card>}

            {live.manualPromptRevision && <Card className="p-4 text-sm">Ручная правка промптов {live.manualPromptRevision.positions ? `позиций ${live.manualPromptRevision.positions.join(", ")}` : `позиции ${live.manualPromptRevision.position}`}. Результаты прежних валидаторов относятся к исходной записи и не проверяют новые промпты.</Card>}
            {!live.manualPromptRevision && live.batches.some((b) => b.errors.length || b.warnings.length) && <Card className="p-4"><h3 className="mb-2 font-semibold">Валидаторы</h3>
              {live.batches.map((b) => (b.errors.length || b.warnings.length) ? <div key={b.n} className="mb-2 text-sm"><span className="font-mono text-xs text-muted-foreground">батч {b.n} ({b.from}–{b.to}){b.retried ? " · исправлен повторной генерацией" : ""}</span>
                {b.errors.map((e) => <p key={e} className="flex gap-2"><XCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />{e}</p>)}
                {b.warnings.slice(0, 6).map((e) => <p key={e} className="flex gap-2 text-muted-foreground"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-crown" />{e}</p>)}
                {b.warnings.length > 6 && <p className="pl-6 text-xs text-muted-foreground">…ещё {b.warnings.length - 6}</p>}</div> : null)}
            </Card>}
            {!live.manualPromptRevision && live.batches.length > 0 && live.batches.every((b) => !b.errors.length) && <p className="flex items-center gap-1.5 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" />Все батчи прошли валидаторы (покрытие строк, якоря стиля, запрещённые термины, формат модели)</p>}

            <Card className="overflow-hidden p-0">
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground"><span className="flex-1">Копировать столбец:</span>
                <CopyButton label="Строки" text={() => rows.map((r) => r.text).join("\n")} /><CopyButton label="Концепты" text={() => rows.map((r) => r.concept).join("\n")} /><CopyButton label="Image" text={() => rows.map((r) => r.image).join("\n\n")} /><CopyButton label="Video" text={() => rows.map((r) => r.video).join("\n\n")} /></div>
              <div className="max-h-[75vh] overflow-auto">
                <table className="w-full min-w-[1100px] text-left text-[13px]">
                  <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground"><tr className="border-b">{["№", "Строка", "Концепт", "Image-промпт", "Video-промпт", "Длит."].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                  <tbody>{rows.map((r) => (
                    <tr key={r.n} className="border-b align-top hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.n}<div className="text-[10px]">{mmss(r.start)}</div></td>
                      <td className="w-[22%] px-3 py-2">{r.text}</td>
                      <td className="w-[14%] px-3 py-2 text-muted-foreground">{r.concept}</td>
                      <td className="w-[30%] px-3 py-2"><div className="font-mono text-[11.5px] leading-relaxed">{r.image}</div>
                        <div className="mt-1.5 flex items-center gap-2"><CopyButton label="" text={r.image} />
                          {frames[r.n]?.src ? <a href={frames[r.n].src} target="_blank" rel="noreferrer"><img src={frames[r.n].src} alt="" className="h-16 rounded border" /></a>
                            : frames[r.n]?.loading ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />генерируем…</span>
                            : <button type="button" disabled={framesUsed >= 3} onClick={() => frame(r)} className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-40" title={framesUsed >= 3 ? "Для проверки стиля достаточно 3 кадров" : "Сгенерировать кадр по промпту"}>{frames[r.n]?.error ? <RotateCw className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}Кадр</button>}
                        </div>{frames[r.n]?.error && <p className="mt-1 text-[11px] text-accent">{frames[r.n].error}</p>}</td>
                      <td className="w-[24%] px-3 py-2"><div className="font-mono text-[11.5px] leading-relaxed">{r.video}</div><CopyButton label="" text={r.video} className="mt-1.5" /></td>
                      <td className="px-3 py-2 font-mono text-xs">{r.seconds}s<div className={cn("text-[10px]", r.clips > 1 ? "text-crown" : "text-muted-foreground")}>клип {r.clip}s{r.clips > 1 ? ` ×${r.clips}` : ""}</div></td>
                    </tr>))}</tbody>
                </table>
              </div>
            </Card>
          </>)}
        </div>
      </div>
    </div>
  );
}
