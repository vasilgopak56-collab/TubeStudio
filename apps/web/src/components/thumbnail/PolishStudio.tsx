import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, Eye, ImageUp, RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, Chip, EmptyState, ErrorAlert } from "@/components/ui";
import { cn } from "@/lib/cn";
import { HSL_COLORS, PRESETS, PolishGl, download, exportBlob, neutral, toCanvas1280, type Adjust } from "./polishGl";

type Key = Exclude<keyof Adjust, "hsl">;
const GROUPS: { title: string; items: [Key, string, number?][] }[] = [
  { title: "Свет", items: [["exposure", "Экспозиция"], ["contrast", "Контраст"], ["highlights", "Света"], ["shadows", "Тени"], ["whites", "Белые"], ["blacks", "Чёрные"]] },
  { title: "Цвет", items: [["temperature", "Температура"], ["tint", "Оттенок"], ["vibrance", "Сочность"], ["saturation", "Насыщенность"]] },
  { title: "Детали", items: [["sharpness", "Резкость", 0], ["clarity", "Чёткость"], ["smoothing", "Сглаживание", 0], ["denoise", "Шумоподавление", 0]] },
  { title: "Эффекты", items: [["pop", "Pop", 0], ["vignette", "Виньетка"]] },
];
const LS = "ts:polish:adj";

function Slider({ label, value, min = -100, onChange }: { label: string; value: number; min?: number; onChange: (v: number) => void }) {
  return (
    <label className="block" onDoubleClick={() => onChange(0)} title="Двойной клик — сброс">
      <div className="mb-0.5 flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className={cn("font-mono tabular-nums", value ? "text-primary" : "text-muted-foreground/60")}>{value > 0 ? `+${value}` : value}</span></div>
      <input type="range" min={min} max={100} value={value} onChange={(e) => onChange(+e.target.value)} className="w-full accent-[hsl(var(--primary))]" />
    </label>
  );
}

export function PolishStudio({ src, projectId, title, onSaved }: { src?: string; projectId?: string; title?: string; onSaved?: (url: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const eng = useRef<PolishGl | null>(null);
  const [adj, setAdj] = useState<Adjust>(() => { try { return { ...neutral(), ...JSON.parse(localStorage.getItem(LS) ?? "{}") }; } catch { return neutral(); } });
  const [orig, setOrig] = useState<string | null>(null); // dataURL 1280×720 исходника для сравнения
  const [compare, setCompare] = useState(false);
  const [preset, setPreset] = useState<string | null>(null);
  const [hslI, setHslI] = useState(0);
  const [open, setOpen] = useState<Record<string, boolean>>({ Свет: true, Цвет: true, Детали: false, Эффекты: true, HSL: false });
  const [err, setErr] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = (url: string) => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { try { const c = toCanvas1280(img); eng.current ??= new PolishGl(canvas.current!); eng.current.setImage(c, 1280, 720); eng.current.render(adj); setOrig(c.toDataURL("image/jpeg", 0.9)); setErr(null); setSaved(null); } catch (e) { setErr(e); } };
    img.onerror = () => setErr(new Error("Не удалось загрузить изображение"));
    img.src = url;
  };
  useEffect(() => { if (src) load(src); }, [src]); // eslint-disable-line
  useEffect(() => { localStorage.setItem(LS, JSON.stringify(adj)); if (!eng.current || !orig) return; const id = requestAnimationFrame(() => eng.current!.render(adj)); return () => cancelAnimationFrame(id); }, [adj, orig]);

  const set = (k: Key, v: number) => { setPreset(null); setAdj((a) => ({ ...a, [k]: v })); };
  const setHsl = (j: number, v: number) => { setPreset(null); setAdj((a) => ({ ...a, hsl: a.hsl.map((x, i) => (i === hslI ? (x.map((y, jj) => (jj === j ? v : y)) as [number, number, number]) : x)) })); };
  const pick = (f?: File) => { if (!f) return; if (!/^image\//.test(f.type)) return setErr(new Error("Нужен JPG, PNG или WebP")); load(URL.createObjectURL(f)); };
  const blob = (t: "jpeg" | "png") => { eng.current!.render(adj); return exportBlob(canvas.current!, t); };
  const save = async () => {
    setSaving(true); setErr(null);
    try { const b = await blob("jpeg"); const b64 = await new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(",")[1]); fr.readAsDataURL(b); });
      const r = await api<{ url: string; artifactId?: string }>("/thumbnail/save", { method: "POST", json: { image: { mime: "image/jpeg", b64 }, title, projectId } }); setSaved(r.url); onSaved?.(r.url);
    } catch (e) { setErr(e); } finally { setSaving(false); }
  };
  const dirty = JSON.stringify(adj) !== JSON.stringify(neutral());

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        <Card className="p-3">
          <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black/40">
            <canvas ref={canvas} className={cn("h-full w-full object-contain", !orig && "hidden")} />
            {orig && compare && <img src={orig} alt="Оригинал" className="absolute inset-0 h-full w-full object-contain" />}
            {orig && compare && <span className="absolute left-3 top-3 rounded bg-black/70 px-2 py-0.5 font-mono text-[11px] uppercase text-white">Оригинал</span>}
            {!orig && <div className="absolute inset-0 grid place-items-center"><EmptyState icon={<ImageUp className="h-6 w-6" />} title="Загрузите обложку">Всё работает в браузере, без API. Экспорт — 1280×720, JPG ≤ 2 МБ.</EmptyState></div>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-primary/50 px-3 text-xs text-primary hover:bg-primary/10"><ImageUp className="h-3.5 w-3.5" />{orig ? "Заменить обложку" : "Загрузить"}<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} /></label>
            <Button size="sm" variant="ghost" disabled={!orig} onPointerDown={() => setCompare(true)} onPointerUp={() => setCompare(false)} onPointerLeave={() => setCompare(false)}><Eye className="h-3.5 w-3.5" />Удерживайте для сравнения</Button>
            <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => { setAdj(neutral()); setPreset(null); }}><RotateCcw className="h-3.5 w-3.5" />Сброс</Button>
            <div className="flex-1" />
            <Button size="sm" variant="outline" disabled={!orig} onClick={async () => download(await blob("jpeg"), "thumbnail_1280x720.jpg")}><Download className="h-3.5 w-3.5" />JPG</Button>
            <Button size="sm" variant="outline" disabled={!orig} onClick={async () => download(await blob("png"), "thumbnail_1280x720.png")}><Download className="h-3.5 w-3.5" />PNG</Button>
            <Button size="sm" disabled={!orig} loading={saving} loadingText="Сохраняем…" onClick={save}><Save className="h-3.5 w-3.5" />Сохранить изменения</Button>
          </div>
          {saved && <p className="mt-2 text-xs text-emerald-400">Сохранено{projectId ? " в проект" : ""}: <a href={saved} target="_blank" rel="noreferrer" className="underline">{saved.split("/").pop()}</a></p>}
        </Card>
        {err != null && <ErrorAlert error={err} />}
        <Card className="p-4">
          <div className="mono-label mb-2 text-muted-foreground">Пресеты</div>
          <div className="flex flex-wrap gap-2">{PRESETS.map((p) => <Chip key={p.id} active={preset === p.id} onClick={() => { setPreset(p.id); setAdj(structuredClone(p.adj)); }}>{p.name}</Chip>)}</div>
        </Card>
      </div>
      <Card className="h-fit p-4">
        <div className="mb-3 flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-primary" /><h3 className="font-semibold">Коррекция</h3></div>
        <div className="space-y-2">
          {GROUPS.map((g) => (
            <div key={g.title} className="rounded-lg border border-border">
              <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium" onClick={() => setOpen((o) => ({ ...o, [g.title]: !o[g.title] }))}>{g.title}<ChevronDown className={cn("h-4 w-4 transition", open[g.title] && "rotate-180")} /></button>
              {open[g.title] && <div className="space-y-2.5 px-3 pb-3">{g.items.map(([k, l, min]) => <Slider key={k} label={l} min={min} value={adj[k]} onChange={(v) => set(k, v)} />)}</div>}
            </div>
          ))}
          <div className="rounded-lg border border-border">
            <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium" onClick={() => setOpen((o) => ({ ...o, HSL: !o.HSL }))}>HSL<ChevronDown className={cn("h-4 w-4 transition", open.HSL && "rotate-180")} /></button>
            {open.HSL && <div className="space-y-2.5 px-3 pb-3">
              <div className="flex flex-wrap gap-1.5">{HSL_COLORS.map(([n, c], i) => <button key={n} type="button" title={n} onClick={() => setHslI(i)} className={cn("h-6 w-6 rounded-full border-2", i === hslI ? "border-foreground" : "border-transparent", adj.hsl[i].some(Boolean) && "ring-2 ring-primary/50")} style={{ background: c }} />)}</div>
              <div className="text-xs text-muted-foreground">{HSL_COLORS[hslI][0]}</div>
              {["Тон", "Насыщенность", "Яркость"].map((l, j) => <Slider key={l} label={l} value={adj.hsl[hslI][j]} onChange={(v) => setHsl(j, v)} />)}
            </div>}
          </div>
        </div>
      </Card>
    </div>
  );
}
