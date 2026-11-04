import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Gauge, Play, SkipForward, Sparkles, TrendingUp, X, XCircle, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { useDraft } from "@/lib/draft";
import { takeHandoff } from "@/lib/handoff";
import { CONTENT_LANGUAGES } from "@/lib/constants";
import { Badge, Button, Card, CopyButton, EmptyState, ErrorAlert, Input, Label, LineChart, ProgressBar, ScoreRing, Select, Textarea, ToolHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

type TQ = { quote: string; pos: number; time: number; found: boolean };
type Result = {
  score: number; label: string; summary: string; emotionalArc: string[]; hook: { score: number; analysis: string; rewrite?: string; text: string; warnings?: string[] };
  pace: { i: number; time: number; len: number }[]; avgSentence: number;
  triggers: (TQ & { type: string; note: string })[]; problems: (TQ & { reason: string; severity: number })[]; improvements: (TQ & { issue: string; rewrite: string; warnings?: string[] })[];
  retention: { t: number; v: number }[]; minutes: number; analysis?: { errors: string[]; warnings: string[]; metrics: { words: number; ctaPos: number | null; questions: number } };
  model: string; script: string; language: string; projectId?: string;
  genius?: { items: { id: string; name: string; score: number; note: string }[]; avg: number; min: number; pass: boolean };
};
type In = { script: string; style?: string; niche?: string; language: string; projectId?: string };
const TRIG: Record<string, string> = { open_loop: "Открытая петля", twist: "Поворот", question: "Вопрос", stakes: "Ставки", reveal: "Раскрытие", emotion: "Эмоция", pattern_interrupt: "Смена ритма", cliffhanger: "Клиффхэнгер" };
const mmss = (s: number) => (s < 0 ? "—" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);

export default function ScriptRater() {
  const [sp] = useSearchParams();
  const [f, setF] = useDraft<In>("script-rater", { script: "", language: "ru", style: "", niche: "" });
  const styles = useQuery({ queryKey: ["script-styles"], queryFn: () => api<{ id: string; name: string }[]>("/script/styles"), staleTime: Infinity });
  const job = useJob<Result, In>("/check/script-rater");
  const [res, setRes] = useState<Result | null>(null);
  const [state, setState] = useState<Record<number, "applied" | "skipped">>({});
  const [text, setText] = useState("");
  useEffect(() => { const h = takeHandoff(); if (h?.text) setF((x) => ({ ...x, script: h.text.slice(0, 60000), language: h.language ?? x.language, projectId: h.projectId })); else if (sp.get("projectId")) setF((x) => ({ ...x, projectId: sp.get("projectId")! })); }, []); // eslint-disable-line
  useEffect(() => { if (job.data) { setRes(job.data); setText(job.data.script); setState({}); } }, [job.data]);
  const valid = f.script.trim().length >= 300;
  const submit = () => valid && job.start({ ...f, script: f.script.trim(), style: f.style || undefined, niche: f.niche?.trim() || undefined });

  const apply = (i: number) => { const im = res!.improvements[i]; if (text.includes(im.quote)) { setText((t) => t.replace(im.quote, im.rewrite)); setState((s) => ({ ...s, [i]: "applied" })); } };
  const applyHook = () => { if (res?.hook.rewrite) { const words = text.split(/(\s+)/); let n = 0, k = 0; for (; k < words.length && n < res.hook.text.split(/\s+/).length; k++) if (words[k].trim()) n++; setText(res.hook.rewrite + " " + words.slice(k).join("").trimStart()); setState((s) => ({ ...s, [-1]: "applied" })); } };
  const changed = res && text !== res.script;
  const pacePts = useMemo(() => (res?.pace ?? []).map((p) => ({ x: p.time, y: p.len })), [res]);
  const retPts = useMemo(() => (res?.retention ?? []).map((p) => ({ x: p.t, y: p.v })), [res]);
  const markers = useMemo(() => !res ? [] : [...res.triggers.map((t) => ({ x: t.time, label: TRIG[t.type] ?? t.type, tone: "good" as const })), ...res.problems.filter((p) => p.found).map((p) => ({ x: p.time, label: p.reason, tone: "bad" as const }))], [res]);

  return (
    <div>
      <ToolHeader icon={Gauge} title="Оценка сценария" eyebrow="// SCRIPT RATER" subtitle="Оценка 0–100, хук, темп, триггеры удержания с таймкодами, прогноз кривой удержания и правки" />
      <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <Card brackets className="h-fit p-5">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Textarea label="Сценарий" required value={f.script} maxLength={60000} rows={14} onChange={(e) => setF((x) => ({ ...x, script: e.target.value }))} placeholder="Вставьте сценарий (от 300 символов)" />
            <div><Label hint="необязательно">Ниша / стиль</Label><Select value={f.style ?? ""} onChange={(e) => setF((x) => ({ ...x, style: e.target.value }))}><option value="">— без ниши —</option>{styles.data?.filter((s) => s.id !== "universal").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
              <p className="mt-1 text-[11px] text-muted-foreground">С нишей дополнительно проверяются объём и структура. Для короткого формата CTA не обязателен.</p></div>
            <div><Label hint="необязательно">Описание канала</Label><Input value={f.niche ?? ""} maxLength={500} onChange={(e) => setF((x) => ({ ...x, niche: e.target.value }))} placeholder="О чём канал, аудитория" /></div>
            <div><Label>Язык</Label><Select value={f.language} onChange={(e) => setF((x) => ({ ...x, language: e.target.value }))}>{CONTENT_LANGUAGES.map((l) => <option key={l.value} value={l.value} lang={l.value} dir="auto">{l.label}</option>)}</Select></div>
            {job.status === "running" ? <div className="space-y-3"><ProgressBar value={job.pct} label={job.stage} /><Button type="button" variant="danger" onClick={job.cancel}><X className="h-4 w-4" />Остановить</Button></div>
              : <Button type="submit" size="lg" className="w-full" disabled={!valid}><Play className="h-4 w-4" />Оценить</Button>}
            {job.status === "error" && <ErrorAlert error={job.error} onRetry={submit} />}
          </form>
        </Card>

        <div className="min-w-0 space-y-4">
          {!res ? <Card className="p-10"><EmptyState icon={<Gauge className="h-8 w-8" />} title="Здесь появится разбор">Сценарий на 10 минут оценивается ≈ 30–60 секунд.</EmptyState></Card> : (<>
            <Card className="flex flex-wrap items-center gap-6 p-5">
              <ScoreRing value={res.score} size={108} label={res.label} />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-relaxed">{res.summary}</p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">{res.emotionalArc.map((e, i) => <span key={i} className="flex items-center gap-1.5">{i > 0 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}<span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-sm">{e}</span></span>)}</div>
                <p className="mt-2 font-mono text-[11px] text-muted-foreground">≈ {res.minutes} мин · ср. предложение {res.avgSentence} сл. · {res.model}</p>
              </div>
            </Card>

            {res.genius && <Card className="p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2"><h3 className="flex-1 font-semibold">Тест «гениальности»</h3>
                <span className="font-mono text-xs text-muted-foreground">порог: среднее ≥ 8 и ни одного &lt; 6</span>
                <Badge tone={res.genius.pass ? "success" : "danger"}>{res.genius.pass ? "порог AI пройден" : "ниже порога AI"} · {res.genius.avg}/10</Badge></div>
              <ul className="grid gap-2 sm:grid-cols-2">{res.genius.items.map((g) => (
                <li key={g.id} className="rounded-md border p-2.5"><div className="flex items-center gap-2 text-sm"><span className="flex-1 font-medium">{g.name}</span><span className={cn("font-mono font-bold", g.score >= 8 ? "text-success" : g.score >= 6 ? "text-crown" : "text-accent")}>{g.score}</span></div>
                  {g.note && <p className="mt-0.5 text-xs text-muted-foreground">{g.note}</p>}</li>))}</ul>
            </Card>}

            <Card className="p-4">
              <div className="mb-2 flex items-center gap-2"><Zap className="h-4 w-4 text-primary" /><h3 className="flex-1 font-semibold">Хук (первые 15 секунд)</h3><span className={cn("font-mono text-xl font-bold", res.hook.score >= 8 ? "text-success" : res.hook.score >= 6 ? "text-crown" : "text-accent")}>{res.hook.score}/10</span></div>
              <blockquote className="mb-2 border-l-2 border-primary/50 pl-3 text-sm italic text-muted-foreground">{res.hook.text}…</blockquote>
              <p className="text-sm leading-relaxed">{res.hook.analysis}</p>
              {res.hook.rewrite && <div className="mt-3 rounded-md border border-success/30 bg-success/5 p-3"><div className="mb-1 flex items-center gap-2 text-xs text-success"><Sparkles className="h-3.5 w-3.5" />Предложение модели<span className="flex-1" />
                {state[-1] === "applied" ? <span className="flex items-center gap-1"><Check className="h-3.5 w-3.5" />применено</span> : <Button size="sm" variant="outline" onClick={applyHook}>Применить</Button>}</div><p className="text-sm">{res.hook.rewrite}</p>{res.hook.warnings?.map(w => <p key={w} className="mt-2 text-sm text-crown">{w}</p>)}</div>}
            </Card>

            <Card className="p-4"><h3 className="mb-1 font-semibold">Темп</h3><p className="mb-2 text-xs text-muted-foreground">Длина предложений (слов) по ходу текста — ровная «расчёска» утомляет, нужен ритм.</p>
              <LineChart points={pacePts} bars height={170} yLabel={(v) => `${v}`} /></Card>

            <Card className="p-4"><div className="mb-1 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /><h3 className="flex-1 font-semibold">Прогноз кривой удержания</h3><Badge>прогноз</Badge></div>
              <p className="mb-2 text-xs text-muted-foreground">Модель-оценка (§8.5): потеря за первые 30 с зависит от хука, <span className="text-success">●</span> триггеры поднимают, <span className="text-accent">●</span> проблемные места роняют, в финале — CTA-спад.</p>
              <LineChart points={retPts} yMax={100} markers={markers} height={220} /></Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-4"><h3 className="mb-3 font-semibold">Триггеры удержания</h3>
                {res.triggers.length ? <ul className="space-y-2">{res.triggers.map((t, i) => (
                  <li key={i} className="flex gap-2 text-sm"><span className="w-11 shrink-0 font-mono text-xs text-success">{mmss(t.time)}</span><div className="min-w-0"><Badge tone="success">{TRIG[t.type] ?? t.type}</Badge><p className="mt-1 text-xs italic text-muted-foreground">«{t.quote.slice(0, 140)}»</p><p className="text-xs">{t.note}</p></div></li>
                ))}</ul> : <p className="text-sm text-muted-foreground">Не найдено.</p>}
              </Card>
              <Card className="p-4"><h3 className="mb-3 font-semibold">Проблемные места</h3>
                {res.problems.length ? <ul className="space-y-2">{res.problems.map((p, i) => (
                  <li key={i} className="flex gap-2 text-sm"><span className="w-11 shrink-0 font-mono text-xs text-accent">{mmss(p.time)}</span><div className="min-w-0"><p className="font-medium">Здесь зритель может уйти {"!".repeat(p.severity)}</p><p className="text-xs">{p.reason}</p><p className="mt-0.5 text-xs italic text-muted-foreground">«{p.quote.slice(0, 140)}»</p></div></li>
                ))}</ul> : <p className="text-sm text-muted-foreground">Не найдено.</p>}
              </Card>
            </div>

            <Card className="p-4"><p className="mb-3 text-sm text-muted-foreground">AI-правки не прошли проверку фактов. Перед применением сверяйте даты, числа и смысл; высокий балл не означает готовность к публикации.</p><div className="mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h3 className="flex-1 font-semibold">Улучшения</h3>{changed && <CopyButton label="Копировать новую версию" text={text} />}</div>
              <ul className="space-y-3">{res.improvements.map((im, i) => (
                <li key={i} className={cn("rounded-md border p-3", state[i] === "skipped" && "opacity-50")}>
                  <div className="mb-1.5 flex flex-wrap items-center gap-2"><span className="w-11 font-mono text-xs text-muted-foreground">{mmss(im.time)}</span><span className="flex-1 text-sm font-medium">{im.issue}</span>
                    {state[i] === "applied" ? <span className="flex items-center gap-1 text-xs text-success"><Check className="h-3.5 w-3.5" />применено</span> : state[i] === "skipped" ? <span className="text-xs text-muted-foreground">пропущено</span> : (<>
                      <Button size="sm" onClick={() => apply(i)} disabled={!text.includes(im.quote)} title={text.includes(im.quote) ? "" : "Фрагмент не найден дословно"}>Применить</Button>
                      <Button size="sm" variant="ghost" onClick={() => setState((s) => ({ ...s, [i]: "skipped" }))}><SkipForward className="h-3.5 w-3.5" />Пропустить</Button></>)}</div>
                  <p className="text-xs text-muted-foreground line-through decoration-accent/50">{im.quote}</p>
                  <p className="mt-1 text-sm">{im.rewrite}</p>{im.warnings?.map(w => <p key={w} className="mt-2 text-sm text-crown">{w}</p>)}
                </li>
              ))}</ul>
              {changed && <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => { setF((x) => ({ ...x, script: text })); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Перенести новую версию в форму и переоценить</Button></div>}
            </Card>

            {res.analysis && <Card className="p-4"><h3 className="mb-2 font-semibold">Проверка по нише (analyzeScript)</h3>
              <p className="mb-2 font-mono text-xs text-muted-foreground">{res.analysis.metrics.words} слов · CTA {res.analysis.metrics.ctaPos == null ? "нет" : `${res.analysis.metrics.ctaPos}%`} · вопросов {res.analysis.metrics.questions}</p>
              {[...res.analysis.errors.map((e) => [e, "e"]), ...res.analysis.warnings.map((w) => [w, "w"])].map(([t, k]) => <p key={t} className="flex gap-2 text-sm">{k === "e" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-crown" />}{t}</p>)}
              {!res.analysis.errors.length && !res.analysis.warnings.length && <p className="flex gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-success" />Замечаний нет</p>}
            </Card>}
          </>)}
        </div>
      </div>
    </div>
  );
}
