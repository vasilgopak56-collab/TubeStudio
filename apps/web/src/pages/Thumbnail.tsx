import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, FolderOpen, Image as ImageIcon, ImageUp, Pencil, Play, RefreshCw, Sparkles, Trash2, Wand2 } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { useDraft } from "@/lib/draft";
import { idbDel, idbGet, idbSet } from "@/lib/idb";
import { CONTENT_LANGUAGES } from "@/lib/constants";
import type { Project, ProjectSummary } from "@/lib/types";
import { Badge, Button, Card, Chip, CopyButton, ErrorAlert, Input, Label, ProgressBar, Select, StepCard, Textarea, ToolHeader } from "@/components/ui";
import { PolishStudio } from "@/components/thumbnail/PolishStudio";
import { FeedComparison } from "@/components/thumbnail/FeedComparison";
import { download } from "@/components/thumbnail/polishGl";
import { cn } from "@/lib/cn";

type Meta = { styles: string[][]; emotions: string[][]; compositions: string[][]; palettes: [string, string, string, string[]][]; lights: string[][]; textPositions: string[][] };
type StepKey = "style" | "character" | "emotion" | "outfit" | "composition" | "palette" | "light" | "textPos" | "text";
type In = { title: string; summary: string; language: string; steps: Record<StepKey, string>; projectId?: string };
type Version = { url: string; instruction?: string; createdAt: string };
type Variant = { variant: "A" | "B" | "C"; idea: string; text: string; prompt: string; why: string; status: "pending" | "done" | "error"; url?: string; bytes?: number; error?: string; versions: Version[] };
type Result = { variants: Variant[]; projectId?: string; artifactId?: string; input?: Partial<In> };
type Img = { mime: string; b64: string; dataUrl: string };

const INIT: In = { title: "", summary: "", language: "ru", steps: { style: "ai", character: "ai", emotion: "ai", outfit: "ai", composition: "ai", palette: "ai", light: "ai", textPos: "ai", text: "ai" } };
const VAR_LABEL = { A: "Эмоция персонажа", B: "Объект / тайна", C: "Контраст до/после" };
const CHAR_KEY = "my-character";

/** Шаг с чипами: «Пусть решит AI» + варианты + «Своё» */
function ChipStep({ value, options, onChange, customLabel = "Своё", palettes }: { value: string; options: string[][]; onChange: (v: string) => void; customLabel?: string; palettes?: boolean }) {
  const known = value === "ai" || value === "skip" || options.some((o) => o[0] === value);
  const [custom, setCustom] = useState(!known);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Chip active={value === "ai" && !custom} onClick={() => { setCustom(false); onChange("ai"); }}><Sparkles className="h-3.5 w-3.5" />Пусть решит AI</Chip>
        {options.map((o) => (
          <Chip key={o[0]} active={value === o[0] && !custom} onClick={() => { setCustom(false); onChange(o[0]); }}>
            {palettes && <span className="flex">{(o[3] as unknown as string[]).map((c) => <span key={c} className="-ml-1 h-3.5 w-3.5 rounded-full border border-black/40 first:ml-0" style={{ background: c }} />)}</span>}{o[1]}
          </Chip>
        ))}
        <Chip active={custom} onClick={() => { setCustom(true); if (known) onChange(""); }}>{customLabel}</Chip>
      </div>
      {custom && <Input autoFocus value={value} maxLength={300} placeholder="Опишите своими словами" onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

async function fileToImg(f: File, max = 1024): Promise<Img> {
  const url = URL.createObjectURL(f); const im = new Image(); im.src = url; await im.decode();
  const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight)); const c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
  c.getContext("2d")!.drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
  const dataUrl = c.toDataURL("image/jpeg", 0.9); return { mime: "image/jpeg", b64: dataUrl.split(",")[1], dataUrl };
}
async function downloadAs(url: string, type: "jpg" | "png", name: string) {
  const b = await (await fetch(url)).blob();
  if (type === "jpg") return download(b, `${name}.jpg`);
  const im = new Image(); im.src = URL.createObjectURL(b); await im.decode(); const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext("2d")!.drawImage(im, 0, 0);
  c.toBlob((p) => p && download(p, `${name}.png`), "image/png");
}

function VariantCard({ v, busy, onRegen, onEdit, onPolish, onPick }: { v: Variant; busy?: boolean; onRegen: (prompt: string) => void; onEdit: (instr: string) => void; onPolish: (url: string) => void; onPick: (url: string) => void }) {
  const [edit, setEdit] = useState(false); const [instr, setInstr] = useState(""); const [showPrompt, setShowPrompt] = useState(false); const [prompt, setPrompt] = useState(v.prompt);
  useEffect(() => setPrompt(v.prompt), [v.prompt]);
  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-video bg-muted/40">
        {v.url ? <img src={v.url} alt={`Вариант ${v.variant}`} className="h-full w-full object-cover" />
          : v.status === "pending" || busy ? <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-muted/30 via-muted/60 to-muted/30" />
          : <div className="absolute inset-0 grid place-items-center px-4 pb-9 pt-8 text-center text-[11px] leading-snug text-muted-foreground"><div><AlertTriangle className="mx-auto mb-2 h-5 w-5 text-amber-400" />{v.error ?? "Нет изображения"}</div></div>}
        {busy && v.url && <div className="absolute inset-0 grid place-items-center bg-black/50"><RefreshCw className="h-6 w-6 animate-spin text-white" /></div>}
        <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 font-mono text-[11px] text-white">Вариант {v.variant}</span>
        {v.text && <span className="absolute bottom-2 left-2 max-w-[90%] truncate rounded bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">{v.text}</span>}
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2"><div><div className="mono-label text-primary">{VAR_LABEL[v.variant]}</div><div className="text-sm font-semibold">{v.idea}</div></div>{v.bytes && <Badge>{(v.bytes / 1024).toFixed(0)} КБ</Badge>}</div>
        {v.why && <p className="text-xs text-muted-foreground">{v.why}</p>}
        {v.versions.length > 1 && <div className="flex gap-1.5 overflow-x-auto pb-1">{v.versions.map((x, i) => <button key={x.url} type="button" title={x.instruction ?? `Версия ${i + 1}`} onClick={() => onPick(x.url)} className={cn("h-10 w-[72px] shrink-0 overflow-hidden rounded border-2", x.url === v.url ? "border-primary" : "border-transparent opacity-70 hover:opacity-100")}><img src={x.url} alt="" className="h-full w-full object-cover" /></button>)}</div>}
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRegen(prompt)} title="Перегенерировать"><RefreshCw className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="ghost" disabled={!v.url || busy} onClick={() => setEdit((e) => !e)} title="Правка текстом"><Pencil className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="ghost" disabled={!v.url} onClick={() => downloadAs(v.url!, "jpg", `thumb_${v.variant}`)}><Download className="h-3.5 w-3.5" />JPG</Button>
          <Button size="sm" variant="ghost" disabled={!v.url} onClick={() => downloadAs(v.url!, "png", `thumb_${v.variant}`)}>PNG</Button>
          <Button size="sm" variant="outline" disabled={!v.url} onClick={() => onPolish(v.url!)}><Wand2 className="h-3.5 w-3.5" />В Polish Studio</Button>
        </div>
        {edit && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (instr.trim().length >= 3) { onEdit(instr.trim()); setEdit(false); setInstr(""); } }}><Input value={instr} maxLength={1000} placeholder="Что изменить? Напр.: сделай фон красным" onChange={(e) => setInstr(e.target.value)} /><Button size="sm" type="submit" disabled={instr.trim().length < 3}>Править</Button></form>}
        <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShowPrompt((s) => !s)}>{showPrompt ? "Скрыть промпт" : "Промпт"}</button>
        {showPrompt && <div className="space-y-1.5"><Textarea value={prompt} maxLength={4000} rows={5} onChange={(e) => setPrompt(e.target.value)} className="font-mono text-xs" /><div className="flex gap-2"><CopyButton text={prompt} /><span className="text-[11px] text-muted-foreground">Можно поправить и перегенерировать</span></div></div>}
      </div>
    </Card>
  );
}

export default function Thumbnail() {
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const tab = sp.get("tab") === "compare" ? "compare" : sp.get("tab") === "polish" ? "polish" : "ai";
  const [polishSrc, setPolishSrc] = useState<string | undefined>(sp.get("src") ?? undefined);
  const [f, setF] = useDraft<In>("thumbnail", INIT);
  const step = (k: StepKey, v: string) => setF((x) => ({ ...x, steps: { ...INIT.steps, ...x.steps, [k]: v } }));
  const st = { ...INIT.steps, ...f.steps };
  const meta = useQuery({ queryKey: ["thumb-meta"], queryFn: () => api<Meta>("/thumbnail/meta"), staleTime: Infinity });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<ProjectSummary[]>("/projects") });
  const job = useJob<Result, unknown>("/thumbnail/generate");
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<unknown>(null);
  const [char, setChar] = useState<Img | null>(null);
  const [useChar, setUseChar] = useState(false);
  const [pick, setPick] = useState("");
  const [remix, setRemix] = useState<string | null>(sp.get("remix"));
  useEffect(() => { const t = sp.get("title"); if (sp.get("remix") && t) setF((x) => ({ ...x, title: t.slice(0, 200) })); }, []); // eslint-disable-line

  useEffect(() => { idbGet<Img>(CHAR_KEY).then((c) => { if (c) { setChar(c); setUseChar(true); } }).catch(() => {}); }, []);
  const art = useQuery({ queryKey: ["project", sp.get("projectId")], queryFn: () => api<Project>(`/projects/${sp.get("projectId")}`), enabled: !!sp.get("projectId") });
  useEffect(() => {
    if (!art.data) return;
    const a = art.data.artifacts.find((x) => x.id === sp.get("artifact"));
    const d = a?.data as (Result & { polished?: { url: string } }) | undefined;
    if (d?.variants) { setRes({ ...d, projectId: art.data.id, artifactId: a!.id }); if (d.input) setF((x) => ({ ...x, ...d.input, steps: { ...INIT.steps, ...(d.input!.steps ?? {}) }, summary: d.input!.summary ?? "", projectId: art.data!.id })); }
    else if (d?.polished) { setPolishSrc(d.polished.url); setSp({ tab: "polish", projectId: art.data.id }, { replace: true }); }
    else if (!sp.get("artifact")) setF((x) => ({ ...x, projectId: art.data!.id, title: x.title || art.data!.title }));
  }, [art.data]); // eslint-disable-line
  useEffect(() => { if (job.partial?.variants) setRes((r) => ({ ...(r ?? {}), variants: job.partial!.variants! })); }, [job.partial]);
  useEffect(() => { if (job.data) { setRes(job.data); qc.invalidateQueries({ queryKey: ["projects"] }); } }, [job.data]); // eslint-disable-line

  const loadProject = async (id: string) => {
    setPick(id); if (!id) return;
    const p = await api<Project>(`/projects/${id}`);
    const seo = [...p.artifacts].reverse().find((a) => a.kind === "seo")?.data as { titles?: { title: string }[] } | undefined;
    const sc = [...p.artifacts].reverse().find((a) => a.kind === "script")?.data as { script?: string; input?: { language?: string } } | undefined;
    setF((x) => ({ ...x, projectId: p.id, title: (seo?.titles?.[0]?.title ?? p.title).slice(0, 200), summary: sc?.script ? sc.script.slice(0, 2000) : x.summary, language: sc?.input?.language ?? x.language }));
  };
  const onPhoto = async (file?: File) => {
    if (!file) return; if (!/^image\/(jpeg|png)$/.test(file.type)) return setErr(new Error("Фото: JPG или PNG")); if (file.size > 5 * 1024 * 1024) return setErr(new Error("Фото больше 5 МБ"));
    const img = await fileToImg(file); setChar(img); setUseChar(true); await idbSet(CHAR_KEY, img).catch(() => {});
  };
  const valid = f.title.trim().length >= 3;
  const submit = () => { if (!valid) return; setErr(null); setRes(null); job.start({ title: f.title.trim(), summary: f.summary.trim() || undefined, language: f.language, steps: Object.fromEntries(Object.entries(st).map(([k, v]) => [k, v.trim() || "ai"])), character: useChar && char && st.character !== "skip" ? { mime: char.mime, b64: char.b64 } : undefined, projectId: f.projectId, styleRef: remix ? { url: remix } : undefined }); };

  const patch = (variant: string, p: Partial<Variant>, version?: Version) => setRes((r) => r && ({ ...r, variants: r.variants.map((v) => v.variant === variant ? { ...v, ...p, versions: version ? [...v.versions, version] : v.versions } : v) }));
  const link = () => ({ projectId: res?.projectId, artifactId: res?.artifactId });
  const regen = async (v: Variant, prompt: string) => {
    setBusy((b) => ({ ...b, [v.variant]: true })); setErr(null);
    try { const r = await api<{ url: string; bytes: number }>("/thumbnail/regenerate", { method: "POST", json: { prompt, variant: v.variant, character: useChar && char ? { mime: char.mime, b64: char.b64 } : undefined, ...link() } }); patch(v.variant, { url: r.url, bytes: r.bytes, status: "done", error: undefined, prompt }, { url: r.url, createdAt: new Date().toISOString() }); }
    catch (e) { patch(v.variant, { status: v.url ? "done" : "error", error: (e as Error).message }); setErr(e); } finally { setBusy((b) => ({ ...b, [v.variant]: false })); }
  };
  const edit = async (v: Variant, instruction: string) => {
    setBusy((b) => ({ ...b, [v.variant]: true })); setErr(null);
    try { const r = await api<{ url: string; bytes: number }>("/thumbnail/edit", { method: "POST", json: { url: v.url, instruction, variant: v.variant, ...link() } }); patch(v.variant, { url: r.url, bytes: r.bytes }, { url: r.url, instruction, createdAt: new Date().toISOString() }); }
    catch (e) { setErr(e); } finally { setBusy((b) => ({ ...b, [v.variant]: false })); }
  };
  const toPolish = (url?: string) => { setPolishSrc(url); const n = new URLSearchParams(sp); n.set("tab", "polish"); n.delete("artifact"); setSp(n); window.scrollTo({ top: 0 }); };
  const m = meta.data; const running = job.status === "running";
  const variants = res?.variants ?? (running ? (["A", "B", "C"] as const).map((x) => ({ variant: x, idea: "…", text: "", prompt: "", why: "", status: "pending" as const, versions: [] })) : []);
  const projOptions = (projects.data ?? []).filter((p) => p.counts?.script || p.counts?.seo || p.counts?.topic);

  return (
    <div>
      <ToolHeader icon={ImageIcon} title="Обложки" eyebrow="// THUMBNAIL" subtitle="3 разных варианта 1280×720 (≤ 2 МБ), правка текстом, Polish Studio — цветокоррекция прямо в браузере" />
      <div className="mb-5 inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-border p-1">
        {([["ai", "AI-генерация"], ["polish", "Polish Studio"], ["compare", "Сравнение в ленте"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => { const n = new URLSearchParams(sp); n.set("tab", k); setSp(n); }} className={cn("min-h-11 rounded-md px-4 py-1.5 text-sm transition", tab === k ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{l}</button>)}
      </div>
      {tab === "compare" ? null : tab === "polish" ? <PolishStudio src={polishSrc} projectId={f.projectId} title={f.title} onSaved={() => qc.invalidateQueries({ queryKey: ["projects"] })} /> : (
        <div className="grid gap-6 xl:grid-cols-[460px_minmax(0,1fr)]">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <StepCard n={1} title="Видео" description="Название обязательно; краткое содержание поможет AI">
              <div className="space-y-3">
                <div><Label hint="автозаполнение">Взять из проекта</Label><Select value={pick} onChange={(e) => loadProject(e.target.value)}><option value="">— проект —</option>{projOptions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select></div>
                <div><Label required counter={`${f.title.length}/200`}>Название видео</Label><Input value={f.title} maxLength={200} onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} placeholder="Почему средневековые люди боялись купаться" /></div>
                <Textarea label="Краткое содержание" hint="необязательно" value={f.summary} maxLength={3000} rows={3} onChange={(e) => setF((x) => ({ ...x, summary: e.target.value }))} />
                <div className="flex items-center gap-3"><Label>Язык текста</Label><Select className="w-40" value={f.language} onChange={(e) => setF((x) => ({ ...x, language: e.target.value }))}>{CONTENT_LANGUAGES.map((l) => <option key={l.value} value={l.value} lang={l.value} dir="auto">{l.label}</option>)}</Select></div>
                {remix && (
                  <div className="flex gap-3 rounded-md border border-crown/40 bg-crown/5 p-2" data-testid="remix-ref">
                    <img src={remix} alt="Референс" className="h-16 w-28 rounded object-cover" />
                    <div className="min-w-0 flex-1 text-xs"><b className="text-crown">Ремикс обложки</b><p className="text-muted-foreground">AI возьмёт идею и композицию этой обложки, но не скопирует текст и людей. Замените название на своё.</p></div>
                    <button type="button" className="self-start text-muted-foreground hover:text-foreground" aria-label="Убрать референс" onClick={() => { setRemix(null); setSp({}, { replace: true }); }}>✕</button>
                  </div>
                )}
                {f.projectId && <p className="text-xs text-muted-foreground"><FolderOpen className="mr-1 inline h-3.5 w-3.5" />Сохранится в <Link className="underline" to={`/projects/${f.projectId}`}>проект</Link> · <button type="button" className="underline" onClick={() => setF((x) => ({ ...x, projectId: undefined }))}>отвязать</button></p>}
              </div>
            </StepCard>
            {m && <>
              <StepCard n={2} title="Художественный стиль" skipped={st.style === "skip"} onSkip={(s) => step("style", s ? "skip" : "ai")}><ChipStep value={st.style} options={m.styles} customLabel="Свой" onChange={(v) => step("style", v)} /></StepCard>
              <StepCard n={3} title="Главный персонаж" description="Фото хранится только в этом браузере как «Мой персонаж»" skipped={st.character === "skip"} onSkip={(s) => step("character", s ? "skip" : "ai")}>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    {char ? <img src={char.dataUrl} alt="Мой персонаж" className={cn("h-16 w-16 rounded-lg object-cover", !useChar && "opacity-40")} /> : <div className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-border text-muted-foreground"><ImageUp className="h-5 w-5" /></div>}
                    <div className="space-y-1.5 text-xs">
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-primary/50 px-3 py-1.5 text-primary hover:bg-primary/10"><ImageUp className="h-3.5 w-3.5" />{char ? "Заменить фото" : "Загрузить фото"} (JPG/PNG ≤ 5 МБ)<input type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} /></label>
                      {char && <div className="flex items-center gap-3"><label className="flex items-center gap-1.5"><input type="checkbox" checked={useChar} onChange={(e) => setUseChar(e.target.checked)} className="accent-[hsl(var(--primary))]" />Использовать</label><button type="button" className="text-muted-foreground hover:text-accent" onClick={() => { setChar(null); setUseChar(false); idbDel(CHAR_KEY); }}><Trash2 className="inline h-3.5 w-3.5" /> удалить</button></div>}
                    </div>
                  </div>
                  <Input value={st.character === "ai" || st.character === "skip" ? "" : st.character} maxLength={300} placeholder={useChar && char ? "Дополнительно (необязательно)" : "Или опишите текстом: средневековый монах, 50 лет, худой…"} onChange={(e) => step("character", e.target.value || "ai")} />
                </div>
              </StepCard>
              <StepCard n={4} title="Эмоция" skipped={st.emotion === "skip"} onSkip={(s) => step("emotion", s ? "skip" : "ai")}><ChipStep value={st.emotion} options={m.emotions} onChange={(v) => step("emotion", v)} /></StepCard>
              <StepCard n={5} title="Образ и одежда" skipped={st.outfit === "skip"} onSkip={(s) => step("outfit", s ? "skip" : "ai")}><Textarea value={st.outfit === "ai" || st.outfit === "skip" ? "" : st.outfit} maxLength={500} rows={2} placeholder="Пусто — решит AI. Напр.: грязная льняная рубаха, капюшон" onChange={(e) => step("outfit", e.target.value || "ai")} /></StepCard>
              <StepCard n={6} title="Композиция" skipped={st.composition === "skip"} onSkip={(s) => step("composition", s ? "skip" : "ai")}><ChipStep value={st.composition} options={m.compositions} onChange={(v) => step("composition", v)} /></StepCard>
              <StepCard n={7} title="Палитра и фон" skipped={st.palette === "skip"} onSkip={(s) => step("palette", s ? "skip" : "ai")}><ChipStep value={st.palette} options={m.palettes as unknown as string[][]} palettes customLabel="Своя" onChange={(v) => step("palette", v)} /></StepCard>
              <StepCard n={8} title="Свет и эффекты" skipped={st.light === "skip"} onSkip={(s) => step("light", s ? "skip" : "ai")}><ChipStep value={st.light} options={m.lights} onChange={(v) => step("light", v)} /></StepCard>
              <StepCard n={9} title="Текст на обложке" description="Не дублирует заголовок — добавляет новый угол" skipped={st.text === "skip"} onSkip={(s) => step("text", s ? "skip" : "ai")}>
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2"><Chip active={st.textPos === "ai"} onClick={() => step("textPos", "ai")}><Sparkles className="h-3.5 w-3.5" />AI</Chip>{m.textPositions.map(([id, l]) => <Chip key={id} active={st.textPos === id} onClick={() => step("textPos", id)}>{l}</Chip>)}</div>
                  <div className="flex flex-wrap gap-2"><Chip active={st.text === "ai"} onClick={() => step("text", "ai")}>AI напишет (1–3 слова)</Chip><Chip active={st.text !== "ai" && st.text !== "skip"} onClick={() => step("text", "")}>Свой</Chip></div>
                  {st.text !== "ai" && st.text !== "skip" && <div><Label counter={`${st.text.length}/50`}>Свой текст</Label><Input value={st.text} maxLength={50} placeholder="ГРЯЗНАЯ ЛОЖЬ" onChange={(e) => step("text", e.target.value)} /></div>}
                </div>
              </StepCard>
            </>}
            <Button type="submit" block size="lg" disabled={!valid} loading={running} loadingText="Генерируем…"><Play className="h-4 w-4" />Сгенерировать 3 варианта</Button>
          </form>
          <div className="space-y-4">
            {running && <Card className="p-4"><ProgressBar value={job.pct} label={job.stage} /></Card>}
            {job.status === "error" && <ErrorAlert error={job.error} onRetry={submit} />}
            {err != null && <ErrorAlert error={err} />}
            {res?.variants?.some((v) => v.status === "error") && !running && <Card className="border-amber-500/30 p-3 text-xs text-amber-300"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />Часть картинок не сгенерировалась. Концепты и промпты готовы — можно скопировать промпт или перегенерировать вариант после настройки провайдера картинок в <Link to="/settings" className="underline">Настройках</Link>.</Card>}
            {variants.length > 0 ? <div className="grid gap-4 2xl:grid-cols-3 lg:grid-cols-2">{variants.map((v) => <VariantCard key={v.variant} v={v} busy={busy[v.variant]} onRegen={(p) => regen(v, p)} onEdit={(i) => edit(v, i)} onPolish={toPolish} onPick={(url) => patch(v.variant, { url })} />)}</div>
              : !running && <Card brackets className="grid min-h-[360px] place-items-center p-8 text-center text-muted-foreground"><div><ImageIcon className="mx-auto mb-3 h-8 w-8 text-primary" /><p className="font-medium text-foreground">Три концепта: эмоция, тайна, контраст</p><p className="mt-1 text-sm">Заполните шаги или оставьте «Пусть решит AI». Можно сразу перейти в <button type="button" className="underline" onClick={() => toPolish(undefined)}>Polish Studio</button>.</p></div></Card>}
            {res?.projectId && !running && <p className="text-xs text-muted-foreground">Сохранено в <Link className="underline" to={`/projects/${res.projectId}`}>проект</Link></p>}
          </div>
        </div>
      )}
      <div hidden={tab !== "compare"}><FeedComparison candidates={(res?.variants ?? []).filter(v => v.url).map(v => ({ label: `вариант ${v.variant}`, url: v.url! }))} /></div>
    </div>
  );
}
