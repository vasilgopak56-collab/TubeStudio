import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ClipboardCheck, History, ImagePlus, Play, RefreshCw, X, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { useDraft } from "@/lib/draft";
import { ago, compact } from "@/lib/format";
import { prepareImage, type LocalImageMetrics } from "@/lib/image";
import { Badge, Button, Card, Chip, CopyButton, ErrorAlert, Input, Label, ProgressBar, ScoreBar, ScoreRing, SectionTitle, Skeleton, Switch, Textarea, ToolHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

type Check = { level: "ok" | "warn" | "error"; text: string };
type Area = "title" | "thumbnail" | "hook" | "promise" | "seo";
type Res = {
  id: string; createdAt: string; total: number; label: string; verdict: "ready" | "fix" | "rework"; summary: string; model: string;
  areas: Record<Area, { score: number; note: string } | undefined>; weights: Record<Area, number>;
  fixes: { area: Area; priority: number; text: string }[]; altTitles: string[]; hookRewrite?: string; thumbnailText?: string;
  local: { title: Check[]; seo: Check[]; hook: Check[] }; thumbChecks: Check[]; hasImage: boolean;
  keyword?: { keyword: string; metrics: { volume: number; competition: number; level: "low" | "medium" | "high"; overall: number } };
  input: { title: string };
};
const AREA: Record<Area, string> = { title: "Заголовок", thumbnail: "Обложка", hook: "Хук (первые 15 с)", promise: "Единое обещание", seo: "SEO: описание, теги, ключи" };
const LVL = { low: "низкая", medium: "средняя", high: "высокая" } as const;
const Icon = ({ l }: { l: Check["level"] }) => l === "ok" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" /> : l === "warn" ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-crown" /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-accent" />;
const Checks = ({ cs }: { cs: Check[] }) => <ul className="mt-2 space-y-1">{cs.map((c, i) => <li key={i} className="flex items-start gap-1.5 text-xs"><Icon l={c.level} /><span>{c.text}</span></li>)}</ul>;
const splitList = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

type Form = { title: string; description: string; tags: string; keywords: string; hook: string; format: "long" | "short"; minutes: string; niche: string; checkKeyword: boolean };
const EMPTY: Form = { title: "", description: "", tags: "", keywords: "", hook: "", format: "long", minutes: "", niche: "", checkKeyword: false };

function ResultView({ r }: { r: Res }) {
  const tone = r.verdict === "ready" ? "success" : r.verdict === "fix" ? "primary" : "danger";
  const checksFor: Partial<Record<Area, Check[]>> = { title: r.local.title, seo: r.local.seo, hook: r.local.hook, thumbnail: r.thumbChecks };
  return (
    <div className="space-y-5" data-testid="scorecard-result">
      <Card className="flex flex-wrap items-center gap-5 p-5">
        <ScoreRing value={r.total} size={96} label="Готовность" />
        <div className="min-w-0 flex-1">
          <Badge tone={tone}>{r.label}</Badge>
          <p className="mt-2 text-sm leading-relaxed">{r.summary}</p>
          {r.keyword && <p className="mt-2 text-xs text-muted-foreground">Ключ «{r.keyword.keyword}»: объём ≈ {compact(r.keyword.metrics.volume)}/мес · конкуренция {r.keyword.metrics.competition} ({LVL[r.keyword.metrics.level]}) · оценка {r.keyword.metrics.overall}/100</p>}
        </div>
      </Card>
      <Card className="p-5">
        <SectionTitle icon={<ClipboardCheck className="h-4 w-4" />}>Что исправить — по важности</SectionTitle>
        <ol className="space-y-2">{[...r.fixes].sort((a, b) => a.priority - b.priority).map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-sm"><span className={cn("mt-0.5 shrink-0 rounded px-1.5 font-mono text-[10px]", f.priority === 1 ? "bg-accent/15 text-accent" : f.priority === 2 ? "bg-crown/15 text-crown" : "bg-muted text-muted-foreground")}>P{f.priority}</span><span><b className="text-muted-foreground">{AREA[f.area].split(":")[0]}:</b> {f.text}</span></li>))}
        </ol>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {(Object.keys(AREA) as Area[]).filter((k) => r.areas[k] && r.weights[k] > 0).map((k) => (
          <Card key={k} className="p-4" data-testid={`area-${k}`}>
            <div className="flex items-center gap-2"><b className="flex-1 text-sm">{AREA[k]}</b><span className="font-mono text-sm">{r.areas[k]!.score}</span><span className="text-[10px] text-muted-foreground">вес {r.weights[k]}%</span></div>
            <ScoreBar value={r.areas[k]!.score} className="mt-1.5" />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{r.areas[k]!.note}</p>
            {checksFor[k]?.length ? <Checks cs={checksFor[k]!} /> : null}
          </Card>))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4"><SectionTitle>Варианты заголовка</SectionTitle>
          <ul className="space-y-1.5">{r.altTitles.map((t, i) => <li key={i} className="flex items-center gap-2 text-sm"><span className="flex-1">{t}</span><span className="font-mono text-[10px] text-muted-foreground">{t.length}</span><CopyButton text={t} label="Копировать" /></li>)}</ul></Card>
        {r.hookRewrite && <Card className="p-4"><SectionTitle>Сильнее начало</SectionTitle><p className="text-sm leading-relaxed">{r.hookRewrite}</p><div className="mt-2"><CopyButton text={r.hookRewrite} /></div></Card>}
      </div>
      <p className="text-xs text-muted-foreground">Итог = локальные правила (40%) + оценка ИИ (60%) по каждой части, взвешенно. Модель {r.model}.{r.thumbnailText ? ` Текст на обложке: «${r.thumbnailText}».` : ""}</p>
    </div>
  );
}

export default function Scorecard() {
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const [f, setF] = useDraft<Form>("scorecard", EMPTY);
  const [img, setImg] = useState<{ url: string; b64: string; local: LocalImageMetrics } | null>(null);
  const [imgErr, setImgErr] = useState("");
  const job = useJob<Res, unknown>("/scorecard");
  const runId = sp.get("run");
  const list = useQuery({ queryKey: ["scorecards"], queryFn: () => api<{ id: string; createdAt: string; title: string; total: number }[]>("/scorecards") });
  const opened = useQuery({ queryKey: ["scorecard", runId], queryFn: () => api<Res>(`/scorecards/${runId}`), enabled: !!runId && job.data?.id !== runId && job.status !== "running" });
  useEffect(() => { try { const k = sessionStorage.getItem("ts:seo-keywords"); if (k && !f.keywords) setF((x) => ({ ...x, keywords: JSON.parse(k).join(", ") })); } catch { /* */ } }, []); // eslint-disable-line
  useEffect(() => { if (job.status === "done" && job.data) { setSp({ run: job.data.id }, { replace: true }); qc.invalidateQueries({ queryKey: ["scorecards"] }); } }, [job.status]); // eslint-disable-line
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  const pick = async (file?: File) => { if (!file) return; setImgErr(""); if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setImgErr("Нужен JPG, PNG или WebP"); try { setImg(await prepareImage(file)); } catch { setImgErr("Не удалось прочитать изображение"); } };
  const tags = splitList(f.tags), kws = splitList(f.keywords);
  const valid = f.title.trim().length >= 3;
  const submit = () => valid && job.start({
    title: f.title.trim(), description: f.description, tags, keywords: kws, hook: f.hook, format: f.format, minutes: Number(f.minutes) || undefined, niche: f.niche.trim() || undefined,
    checkKeyword: f.checkKeyword && kws.length > 0, image: img ? { mime: "image/jpeg", b64: img.b64 } : undefined, local: img?.local, projectId: sp.get("projectId") ?? undefined,
  });
  const shown = job.status === "running" ? undefined : job.data && (!runId || job.data.id === runId) ? job.data : opened.data;
  return (
    <div>
      <ToolHeader icon={ClipboardCheck} title="Перед публикацией" eyebrow="// PRE-PUBLISH SCORECARD"
        subtitle="Вся упаковка разом: заголовок, обложка, первые 15 секунд, описание, теги и ключи → готовность 0–100 и список правок по важности" />
      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card brackets className="p-5">
            <form className="space-y-3.5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <div><Label required counter={`${f.title.length}/100`}>Заголовок</Label><Input value={f.title} maxLength={100} onChange={(e) => set({ title: e.target.value })} placeholder="Почему мы забываем сны через 5 минут" aria-label="Заголовок" /></div>
              <div><Label hint="необязательно">Обложка</Label>
                <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }} className="flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground hover:border-primary">
                  {img ? <img src={img.url} alt="" className="aspect-video w-full rounded object-cover" /> : <><ImagePlus className="h-6 w-6" />Перетащите или выберите (JPG/PNG/WebP)</>}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
                </label>
                {img && <button type="button" className="mt-1 text-xs text-muted-foreground hover:text-accent" onClick={() => setImg(null)}>Убрать обложку</button>}
                {imgErr && <p className="mt-1 text-xs text-accent">{imgErr}</p>}
              </div>
              <div><Label hint="через запятую; первый — главный">Целевые ключи</Label><Input value={f.keywords} onChange={(e) => set({ keywords: e.target.value })} placeholder="психология сна, осознанные сны" aria-label="Целевые ключи" /></div>
              <Textarea label="Хук — первые 15 секунд сценария" value={f.hook} onChange={(e) => set({ hook: e.target.value })} rows={4} maxLength={3000} placeholder="Через пять минут после пробуждения вы забудете 90% сна…" />
              <Textarea label="Описание" value={f.description} onChange={(e) => set({ description: e.target.value })} rows={4} maxLength={5000} />
              <div><Label hint={`${tags.length} шт · ${tags.join(",").length}/500`}>Теги</Label><Input value={f.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="через запятую" aria-label="Теги" /></div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex gap-1.5"><Chip active={f.format === "long"} onClick={() => set({ format: "long" })}>Длинное</Chip><Chip active={f.format === "short"} onClick={() => set({ format: "short" })}>Shorts</Chip></div>
                <div className="w-24"><Label>Минут</Label><Input type="number" min={0} value={f.minutes} onChange={(e) => set({ minutes: e.target.value })} /></div>
              </div>
              <Switch checked={f.checkKeyword} onChange={(x) => set({ checkKeyword: x })} label="Проверить конкуренцию главного ключа" description="≈ 102 ед. квоты YouTube" />
              {job.status === "running" ? <Button type="button" variant="danger" className="w-full" onClick={job.cancel}><X className="h-4 w-4" />Стоп</Button>
                : <Button type="submit" className="w-full" disabled={!valid}><Play className="h-4 w-4" />Оценить</Button>}
              {job.status === "running" && <ProgressBar value={job.pct} label={job.stage} />}
              {job.status === "error" && <ErrorAlert error={job.error} onRetry={submit} />}
            </form>
          </Card>
          <Card className="p-4">
            <SectionTitle icon={<History className="h-4 w-4" />} right={<button onClick={() => list.refetch()} className="text-muted-foreground hover:text-foreground" aria-label="Обновить"><RefreshCw className="h-3.5 w-3.5" /></button>}>История</SectionTitle>
            {!list.data?.length ? <p className="text-sm text-muted-foreground">Пока пусто</p> : <ul className="max-h-[240px] space-y-1 overflow-auto">{list.data.map((x) => (
              <li key={x.id}><button onClick={() => setSp({ run: x.id })} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${x.id === runId ? "bg-muted" : ""}`}><span className="flex-1 truncate">{x.title}</span><span className="font-mono text-xs">{x.total}</span><span className="text-xs text-muted-foreground">{ago(x.createdAt)}</span></button></li>))}</ul>}
          </Card>
        </div>
        <div>
          {opened.isLoading && !shown ? <Skeleton className="h-96" /> : shown ? <ResultView r={shown} /> : (
            <Card className="p-6 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Что проверяется</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li><b>Заголовок</b> — длина, ключ в первых 40 символах, конкретика, без капса и «!!!».</li>
                <li><b>Обложка</b> — читаемость на превью, контраст, размер 1280×720, связь с заголовком.</li>
                <li><b>Хук</b> — без приветствий, короткая первая фраза, подтверждает обещание заголовка.</li>
                <li><b>Единое обещание</b> — заголовок + обложка создают один вопрос, а хук сразу его подхватывает.</li>
                <li><b>SEO</b> — ключ в начале описания, таймкоды, хэштеги ≤ 15, теги ≤ 500 символов, все ключи использованы.</li>
              </ul>
              <p className="mt-3">Без обложки и хука оценка строится по остальным частям (веса пересчитываются).</p>
            </Card>)}
        </div>
      </div>
    </div>
  );
}
