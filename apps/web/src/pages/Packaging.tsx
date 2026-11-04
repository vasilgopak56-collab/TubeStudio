import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ImagePlus, ListChecks, Play, Sparkles, ThumbsUp, X, XCircle } from "lucide-react";
import { useJob } from "@/lib/jobs";
import { useDraft } from "@/lib/draft";
import { Button, Card, EmptyState, ErrorAlert, Input, Label, ProgressBar, ScoreRing, Textarea, ToolHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { prepareImage as prepare, type LocalImageMetrics as Local } from "@/lib/image";

type Result = { viralScore: number; synergy: { score: number; text: string }; thumbnailText: string; textHeightPct: number; textAreaPct: number; focalPoint: string; strengths: string[]; improvements: string[]; steps: string[]; checks: { level: "ok" | "warn" | "error"; text: string }[]; textPxSmall: number; model: string; title: string; projectId?: string };
type In = { title: string; about?: string; image: { mime: string; b64: string }; local?: Local; projectId?: string };


function FeedCard({ url, title, w, mobile }: { url: string; title: string; w: number; mobile?: boolean }) {
  const side = !mobile && w < 200;
  return (
    <div className={cn("flex gap-2", side ? "flex-row" : "flex-col")} style={{ width: side ? 400 : w }}>
      <div className="relative shrink-0 overflow-hidden rounded-lg bg-black" style={{ width: w, height: Math.round(w * 9 / 16) }}><img src={url} alt="" className="h-full w-full object-cover" /><span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 font-mono text-[10px] text-white">12:47</span></div>
      <div className="flex min-w-0 gap-2">
        {!side && <div className="h-8 w-8 shrink-0 rounded-full bg-primary/40" />}
        <div className="min-w-0"><p className={cn("line-clamp-2 font-medium leading-snug", side ? "text-[13px]" : "text-sm")}>{title}</p><p className="mt-0.5 text-xs text-muted-foreground">Ваш канал · 128 тыс. просмотров · 2 дня назад</p></div>
      </div>
    </div>
  );
}
const Icon = ({ l }: { l: string }) => l === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : l === "warn" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-crown" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />;

export default function Packaging() {
  const [sp] = useSearchParams();
  const [f, setF] = useDraft<{ title: string; about: string }>("packaging", { title: "", about: "" });
  const [img, setImg] = useState<{ url: string; b64: string; local: Local } | null>(null);
  const [imgErr, setImgErr] = useState("");
  const job = useJob<Result, In>("/check/packaging");
  const res = job.data;
  useEffect(() => { setImgErr(""); }, [img]);
  const pick = async (file?: File) => { if (!file) return; if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setImgErr("Нужен JPG, PNG или WebP"); try { setImg(await prepare(file)); } catch { setImgErr("Не удалось прочитать изображение"); } };
  const valid = f.title.trim().length >= 3 && !!img;
  const submit = () => valid && job.start({ title: f.title.trim(), about: f.about.trim() || undefined, image: { mime: "image/jpeg", b64: img!.b64 }, local: img!.local, projectId: sp.get("projectId") ?? undefined });

  return (
    <div>
      <ToolHeader icon={Sparkles} title="Проверка упаковки" eyebrow="// VIRAL ALCHEMIST" subtitle="Заголовок + обложка → Viral Score, синергия, читаемость на превью и план улучшений" />
      <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <Card brackets className="h-fit p-5">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div><Label required counter={`${f.title.length}/100`}>Заголовок</Label><Input value={f.title} maxLength={100} onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} placeholder="Почему в Средневековье БОЯЛИСЬ мыться?" /></div>
            <div><Label required>Обложка</Label>
              <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }} className="flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-md border border-dashed p-3 text-sm text-muted-foreground hover:border-primary">
                {img ? <img src={img.url} alt="" className="aspect-video w-full rounded object-cover" /> : <><ImagePlus className="h-7 w-7" />Перетащите или выберите файл (JPG/PNG/WebP)</>}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
              </label>
              {img && <p className="mt-1 font-mono text-[11px] text-muted-foreground">{img.local.width}×{img.local.height} · яркость {img.local.brightness.toFixed(0)} · контраст {img.local.contrast.toFixed(0)} · цвет {img.local.colorfulness.toFixed(0)}</p>}
              {imgErr && <p className="mt-1 text-xs text-accent">{imgErr}</p>}
            </div>
            <Textarea label="О чём видео" value={f.about} maxLength={3000} rows={4} onChange={(e) => setF((x) => ({ ...x, about: e.target.value }))} placeholder="Кратко: о чём ролик и что зритель узнает" />
            {job.status === "running" ? <div className="space-y-3"><ProgressBar value={job.pct} label={job.stage} /><Button type="button" variant="danger" onClick={job.cancel}><X className="h-4 w-4" />Остановить</Button></div>
              : <Button type="submit" size="lg" className="w-full" disabled={!valid}><Play className="h-4 w-4" />Проверить упаковку</Button>}
            {job.status === "error" && <ErrorAlert error={job.error} onRetry={submit} />}
          </form>
        </Card>

        <div className="min-w-0 space-y-4">
          {!res ? <Card className="p-10"><EmptyState icon={<Sparkles className="h-8 w-8" />} title="Здесь появится Viral Score">Заголовок и обложка оцениваются вместе ≈ 10–20 секунд.</EmptyState></Card> : (<>
            <Card className="flex flex-wrap items-center gap-6 p-5">
              <ScoreRing value={res.viralScore} size={108} label="Viral Score" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><h3 className="font-semibold">Синергия заголовка и обложки</h3><span className={cn("font-mono font-bold", res.synergy.score >= 8 ? "text-success" : res.synergy.score >= 6 ? "text-crown" : "text-accent")}>{res.synergy.score}/10</span></div>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{res.synergy.text}</p>
                <p className="mt-2 text-xs text-muted-foreground">Текст на обложке: <span className="text-foreground">{res.thumbnailText || "—"}</span> · взгляд падает на: <span className="text-foreground">{res.focalPoint}</span></p>
              </div>
            </Card>
            {img && <Card className="p-4"><h3 className="mb-3 font-semibold">Как это выглядит в ленте</h3>
              <div className="flex flex-wrap items-start gap-6">
                <div><p className="mono-label mb-2 text-muted-foreground">Главная</p><FeedCard url={img.url} title={res.title} w={320} /></div>
                <div><p className="mono-label mb-2 text-muted-foreground">Мобильная</p><FeedCard url={img.url} title={res.title} w={240} mobile /></div>
                <div><p className="mono-label mb-2 text-muted-foreground">Рекомендации · 168×94</p><FeedCard url={img.url} title={res.title} w={168} /></div>
              </div></Card>}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-4"><h3 className="mb-3 font-semibold">Проверки</h3><ul className="space-y-1.5">{res.checks.map((c) => <li key={c.text} className="flex gap-2 text-sm"><Icon l={c.level} />{c.text}</li>)}</ul></Card>
              <Card className="p-4"><div className="mb-3 flex items-center gap-2"><ThumbsUp className="h-4 w-4 text-success" /><h3 className="font-semibold">Сильные стороны</h3></div><ul className="list-disc space-y-1 pl-5 text-sm">{res.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></Card>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-4"><div className="mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h3 className="font-semibold">Улучшения</h3></div><ul className="list-disc space-y-1 pl-5 text-sm">{res.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul></Card>
              <Card className="p-4"><div className="mb-3 flex items-center gap-2"><ListChecks className="h-4 w-4 text-primary" /><h3 className="font-semibold">План по шагам</h3></div><ol className="list-decimal space-y-1 pl-5 text-sm">{res.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></Card>
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">{res.model}{res.projectId ? " · сохранено в проект" : ""}</p>
          </>)}
        </div>
      </div>
    </div>
  );
}
