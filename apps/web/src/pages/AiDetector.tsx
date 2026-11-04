import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, AudioLines, Bot, CheckCircle2, Lightbulb, Play, ScanText, User, Wand2, X } from "lucide-react";
import { useJob } from "@/lib/jobs";
import { useDraft } from "@/lib/draft";
import { putHandoff, takeHandoff } from "@/lib/handoff";
import { CONTENT_LANGUAGES } from "@/lib/constants";
import { Badge, Button, Card, CopyButton, EmptyState, ErrorAlert, Label, ProgressBar, ScoreBar, ScoreRing, Select, Textarea, ToolHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

type Metric = { id: string; name: string; value: number; score: number; weight: number; hint: string };
type Highlight = { start: number; end: number; quote: string; category: string; replacements: string[]; source: "llm" | "dictionary" };
type Result = { humanPct: number; verdict: "human" | "mixed" | "ai"; heuristicPct: number; llmPct: number; why: string; metrics: Metric[]; patterns: { category: string; example: string; count: number }[]; highlights: Highlight[]; tips: string[]; voice?: { score: number; counts: { rule: string; name: string; count: number }[] }; words: number; chars: number; model: string; text: string; language: string; projectId?: string };
type In = { text: string; language: string; projectId?: string };
const VERDICT = { human: ["Скорее человек", "text-success", User], mixed: ["Смешанный", "text-crown", AlertTriangle], ai: ["Скорее AI", "text-accent", Bot] } as const;
const countWords = (s: string) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

export default function AiDetector() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [f, setF] = useDraft<In>("ai-detector", { text: "", language: "ru" });
  const job = useJob<Result, In>("/check/ai-detector");
  const [res, setRes] = useState<Result | null>(null);
  const [choice, setChoice] = useState<Record<number, number | null>>({}); // индекс подсветки → выбранная замена (null = оставить)
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { const h = takeHandoff(); if (h?.text) setF((x) => ({ ...x, text: h.text.slice(0, 50000), language: h.language ?? x.language, projectId: h.projectId })); else if (sp.get("projectId")) setF((x) => ({ ...x, projectId: sp.get("projectId")! })); }, []); // eslint-disable-line
  useEffect(() => { if (job.data) { setRes(job.data); setChoice(Object.fromEntries(job.data.highlights.map((h, i) => [i, h.replacements.length ? 0 : null]))); setOpen(null); } }, [job.data]);
  const valid = f.text.trim().length >= 100 && f.text.length <= 50000;
  const submit = () => valid && job.start({ ...f, text: f.text.trim() });
  const applied = Object.values(choice).filter((v) => v != null).length;

  const applyAll = () => {
    if (!res) return;
    let t = res.text;
    [...res.highlights.map((h, i) => ({ h, i }))].sort((a, b) => b.h.start - a.h.start).forEach(({ h, i }) => { const c = choice[i]; if (c != null && h.replacements[c]) t = t.slice(0, h.start) + h.replacements[c] + t.slice(h.end); });
    setF((x) => ({ ...x, text: t })); setRes(null); window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const segments = useMemo(() => {
    if (!res) return [];
    const out: { text: string; i?: number }[] = []; let p = 0;
    res.highlights.forEach((h, i) => { if (h.start > p) out.push({ text: res.text.slice(p, h.start) }); out.push({ text: res.text.slice(h.start, h.end), i }); p = h.end; });
    out.push({ text: res.text.slice(p) }); return out;
  }, [res]);

  return (
    <div>
      <ToolHeader icon={ScanText} title="AI-детектор" eyebrow="// AI DETECTOR" subtitle="Насколько текст звучит как написанный нейросетью: метрики + LLM-анализ, подсветка и замены" />
      <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <Card brackets className="h-fit p-5">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Textarea label="Текст" required value={f.text} maxLength={50000} rows={14} onChange={(e) => setF((x) => ({ ...x, text: e.target.value }))} placeholder="Вставьте текст — от 100 до 50 000 символов" />
            <p className="-mt-2 font-mono text-[11px] text-muted-foreground">{countWords(f.text)} слов · {f.text.length} симв.</p>
            <div><Label>Язык</Label><Select value={f.language} onChange={(e) => setF((x) => ({ ...x, language: e.target.value }))}>{CONTENT_LANGUAGES.map((l) => <option key={l.value} value={l.value} lang={l.value} dir="auto">{l.label}</option>)}</Select>{!["ru", "en"].includes(f.language) && <p className="mt-1 text-xs text-muted-foreground">Локальные словари ИИ-маркеров есть только для русского и английского; на этом языке используются общие метрики. Это не доказательство авторства.</p>}</div>
            {job.status === "running" ? <div className="space-y-3"><ProgressBar value={job.pct} label={job.stage} /><Button type="button" variant="danger" onClick={job.cancel}><X className="h-4 w-4" />Остановить</Button></div>
              : <Button type="submit" size="lg" className="w-full" disabled={!valid}><Play className="h-4 w-4" />Проверить</Button>}
            {job.status === "error" && <ErrorAlert error={job.error} onRetry={submit} />}
          </form>
        </Card>

        <div className="min-w-0 space-y-4">
          {!res ? <Card className="p-10"><EmptyState icon={<ScanText className="h-8 w-8" />} title="Здесь появится отчёт">Итог = 40% детерминированные метрики + 60% LLM-анализ. ≈ 15–30 секунд.</EmptyState></Card> : (<>
            <Card className="flex flex-wrap items-center gap-6 p-5">
              <ScoreRing value={res.humanPct} size={108} label="человечность" />
              <div className="min-w-0 flex-1">
                {(() => { const [t, c, I] = VERDICT[res.verdict]; return <div className={cn("flex items-center gap-2 text-2xl font-bold", c)}><I className="h-6 w-6" />{t}</div>; })()}
                <div className="mt-1 font-mono text-xs text-muted-foreground">метрики {res.heuristicPct}% × 0.4 + LLM {res.llmPct}% × 0.6 · {res.words} слов · {res.model}</div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-gradient-to-r from-accent via-crown to-success"><div className="relative h-full" style={{ width: `${res.humanPct}%` }}><span className="absolute -right-1 -top-1 h-4 w-2 rounded bg-foreground" /></div></div>
                <div className="mt-1 flex justify-between text-[11px] text-muted-foreground"><span>AI</span><span>Смешанный</span><span>Человек</span></div>
              </div>
            </Card>

            {res.voice && <Card className="flex flex-wrap items-center gap-3 p-4">
              <AudioLines className="h-5 w-5 text-primary" /><div className="min-w-0 flex-1"><div className="font-semibold">Живой голос: {res.voice.score}/100 <span className="text-xs font-normal text-muted-foreground">(порог 85, правила §1–§26 и T1–T11)</span></div>
                <div className="mt-1 flex flex-wrap gap-1.5">{res.voice.counts.slice(0, 10).map((c) => <span key={c.rule} title={c.name} className="rounded border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{c.rule} ×{c.count}</span>)}</div></div>
              <Button size="sm" onClick={() => { putHandoff({ text: res.text, projectId: f.projectId, language: res.language }); nav(`/check/humanizer${f.projectId ? `?projectId=${f.projectId}` : ""}`); }}><Wand2 className="h-3.5 w-3.5" />Очеловечить</Button>
            </Card>}

            <Card className="p-4"><h3 className="mb-2 font-semibold">Почему так</h3><p className="text-sm leading-relaxed text-muted-foreground">{res.why}</p></Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-4"><h3 className="mb-3 font-semibold">Метрики</h3>
                <ul className="space-y-3">{res.metrics.filter((m) => m.weight > 0).map((m) => (
                  <li key={m.id} title={m.hint}><div className="mb-1 flex justify-between gap-2 text-sm"><span>{m.name}</span><span className="font-mono text-muted-foreground">{m.value}</span></div><ScoreBar value={Math.round(m.score * 100)} /><p className="mt-0.5 text-[11px] text-muted-foreground">{m.hint}</p></li>
                ))}</ul>
              </Card>
              <Card className="p-4"><h3 className="mb-3 font-semibold">Найденные AI-паттерны</h3>
                {res.patterns.length ? <ul className="space-y-2.5">{res.patterns.map((p, i) => (
                  <li key={i} className="rounded-md border p-2.5"><div className="flex items-center gap-2"><span className="flex-1 text-sm font-medium">{p.category}</span><Badge tone="danger">×{p.count}</Badge></div><p className="mt-1 text-xs italic text-muted-foreground">«{p.example}»</p></li>
                ))}</ul> : <p className="text-sm text-muted-foreground">Паттернов не найдено.</p>}
              </Card>
            </div>

            <Card className="p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2"><h3 className="flex-1 font-semibold">Текст с подсветкой</h3>
                <span className="text-xs text-muted-foreground">{res.highlights.length} фрагм. · нажмите на подсветку</span>
                <Button size="sm" onClick={applyAll} disabled={!applied}><Wand2 className="h-3.5 w-3.5" />Применить замены ({applied})</Button></div>
              <div className="max-h-[560px] overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/20 p-4 text-[15px] leading-relaxed">
                {segments.map((s, k) => s.i == null ? <span key={k}>{s.text}</span> : (
                  <span key={k} className="relative">
                    <mark onClick={() => setOpen(open === s.i ? null : s.i!)} className={cn("cursor-pointer rounded px-0.5 text-foreground", res.highlights[s.i].source === "llm" ? "bg-accent/25 hover:bg-accent/40" : "bg-crown/25 hover:bg-crown/40", choice[s.i] != null && "underline decoration-success decoration-2")}>{s.text}</mark>
                    {open === s.i && (() => { const h = res.highlights[s.i!]; return (
                      <span className="absolute left-0 top-full z-20 mt-1 block w-[min(420px,80vw)] whitespace-normal rounded-md border bg-card p-3 text-sm shadow-xl">
                        <span className="mb-2 block font-mono text-[11px] uppercase text-muted-foreground">{h.category}</span>
                        {h.replacements.length ? h.replacements.map((r, j) => (
                          <button key={j} type="button" onClick={() => { setChoice((c) => ({ ...c, [s.i!]: j })); setOpen(null); }} className={cn("mb-1.5 block w-full rounded border p-2 text-left hover:border-primary", choice[s.i!] === j && "border-success bg-success/10")}>{r}</button>
                        )) : <span className="mb-1.5 block text-muted-foreground">Словарный маркер — перепишите или удалите вручную.</span>}
                        <button type="button" onClick={() => { setChoice((c) => ({ ...c, [s.i!]: null })); setOpen(null); }} className={cn("block w-full rounded border p-2 text-left text-muted-foreground hover:border-primary", choice[s.i!] == null && "border-primary")}>Оставить как есть</button>
                      </span>); })()}
                  </span>
                ))}
              </div>
              <div className="mt-2 flex gap-4 text-[11px] text-muted-foreground"><span><mark className="rounded bg-accent/25 px-1 text-foreground">  </mark> найдено LLM</span><span><mark className="rounded bg-crown/25 px-1 text-foreground">  </mark> словарь маркеров</span><span className="underline decoration-success decoration-2">выбрана замена</span></div>
            </Card>

            <Card className="p-4"><div className="mb-3 flex items-center gap-2"><Lightbulb className="h-4 w-4 text-primary" /><h3 className="flex-1 font-semibold">Как сделать человечнее</h3><CopyButton text={res.tips.join("\n")} /></div>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm">{res.tips.map((t, i) => <li key={i}>{t}</li>)}</ol></Card>
            {res.projectId && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-success" />Отчёт сохранён в проект</p>}
          </>)}
        </div>
      </div>
    </div>
  );
}
