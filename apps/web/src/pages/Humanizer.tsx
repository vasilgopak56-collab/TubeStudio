import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, AudioLines, CheckCircle2, Download, Gauge, Mic, Play, ScanSearch, ShieldCheck, Wand2, X, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { useDraft } from "@/lib/draft";
import { putHandoff, takeHandoff } from "@/lib/handoff";
import { useVoiceProfile, voiceHint } from "@/lib/queries";
import { CONTENT_LANGUAGES } from "@/lib/constants";
import { Badge, Button, Card, Chip, CopyButton, EmptyState, ErrorAlert, Input, Label, ProgressBar, ScoreRing, Select, Switch, Textarea, ToolHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

type Strength = 0 | 1 | 2 | 3;
type Rule = { id: string; group: string; strength: Strength; name: string; fix: string };
type Hit = { rule: string; strength: Strength; start: number; end: number; quote: string };
type Report = { score: number; verdict: "human" | "traces" | "rewrite"; words: number; sentences: number; avgSentence: number; maxSentence: number; penalty: number; strong: number; hits: Hit[]; counts: { rule: string; name: string; strength: Strength; count: number }[] };
type FactDiff = { lostNumbers: string[]; addedNumbers: string[]; lostQuotes: string[]; addedQuotes: string[]; lostNames: string[]; addedNames: string[]; ok: boolean };
type Scene = { i: number; before: string; after: string; status: "clean" | "edited" | "rejected"; reason?: string; scoreBefore: number; scoreAfter: number; hitsBefore: Hit[]; hitsAfter: Hit[]; edits: { before: string; rules: string[]; after: string }[]; kept: { quote: string; why: string }[]; facts: FactDiff | null; factsToCheck: string[]; wordsBefore: number; wordsAfter: number };
type Result = { before: Report; after: Report; scenes: Scene[]; text: string; original: string; report: string; factsToCheck: string[]; passes: number; threshold: number; model: string; language: string; title?: string; projectId?: string; score: number; label: string };
type In = { text: string; language: string; title?: string; authorSample?: string; channelVoice?: boolean; maxPasses: number; maxDelta: number; force: boolean; projectId?: string };

const VERDICT = { human: ["Звучит как человек", "text-success"], traces: ["Есть следы ИИ — править", "text-crown"], rewrite: ["Много признаков — переписать", "text-accent"] } as const;
const DOTS = ["инфо", "●", "●●", "●●●"];
const countWords = (s: string) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

/** Пословный diff (LCS) для «было → стало» */
function wordDiff(a: string, b: string) {
  const A = a.split(/(\s+)/), B = b.split(/(\s+)/), n = A.length, m = B.length;
  if (n * m > 400000) return [{ t: "del" as const, s: a }, { t: "add" as const, s: b }];
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { t: "eq" | "del" | "add"; s: string }[] = []; let i = 0, j = 0;
  const push = (t: "eq" | "del" | "add", s: string) => { const l = out[out.length - 1]; if (l && l.t === t) l.s += s; else out.push({ t, s }); };
  while (i < n && j < m) { if (A[i] === B[j]) { push("eq", A[i]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) push("del", A[i++]); else push("add", B[j++]); }
  while (i < n) push("del", A[i++]); while (j < m) push("add", B[j++]);
  return out;
}

function Marked({ text, hits, rules }: { text: string; hits: Hit[]; rules: Map<string, Rule> }) {
  const segs: { s: string; h?: Hit }[] = []; let p = 0;
  for (const h of [...hits].sort((a, b) => a.start - b.start)) { if (h.start < p) continue; if (h.start > p) segs.push({ s: text.slice(p, h.start) }); segs.push({ s: text.slice(h.start, h.end), h }); p = h.end; }
  segs.push({ s: text.slice(p) });
  return <>{segs.map((x, k) => x.h ? <mark key={k} title={`${x.h.rule} ${rules.get(x.h.rule)?.name ?? ""} — ${rules.get(x.h.rule)?.fix ?? ""}`} className={cn("rounded px-0.5 text-foreground", x.h.strength === 3 ? "bg-accent/30" : x.h.strength === 2 ? "bg-crown/30" : x.h.strength === 1 ? "bg-primary/20" : "bg-muted underline decoration-dotted")}>{x.s}<sup className="ml-0.5 font-mono text-[9px] text-muted-foreground">{x.h.rule}</sup></mark> : <span key={k}>{x.s}</span>)}</>;
}

function Counts({ r }: { r: Report }) {
  const c = r.counts.filter((x) => x.strength > 0);
  return c.length ? <div className="flex flex-wrap gap-1.5">{c.map((x) => <span key={x.rule} title={x.name} className={cn("rounded border px-1.5 py-0.5 font-mono text-[11px]", x.strength === 3 ? "border-accent/50 text-accent" : x.strength === 2 ? "border-crown/50 text-crown" : "text-muted-foreground")}>{x.rule} ×{x.count}</span>)}</div> : <span className="text-sm text-success">признаков не найдено</span>;
}

export default function Humanizer() {
  const vp = useVoiceProfile();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [f, setF] = useDraft<In>("humanizer", { text: "", language: "ru", maxPasses: 2, maxDelta: 15, force: false });
  const set = <K extends keyof In>(k: K, v: In[K]) => setF((x) => ({ ...x, [k]: v }));
  const rulesQ = useQuery({ queryKey: ["humanizer-rules"], queryFn: () => api<{ rules: Rule[]; threshold: number }>("/check/humanizer/rules"), staleTime: Infinity });
  const rules = useMemo(() => new Map((rulesQ.data?.rules ?? []).map((r) => [r.id, r])), [rulesQ.data]);
  const job = useJob<Result, In>("/check/humanizer");
  const [res, setRes] = useState<Result | null>(null);
  const [accept, setAccept] = useState<Record<number, boolean>>({});
  const [view, setView] = useState<"diff" | "after" | "marks">("diff");
  const [authorOpen, setAuthorOpen] = useState(false);
  const scan = useMutation({ mutationFn: (t: string) => api<Report>("/check/humanizer/scan", { method: "POST", json: { text: t, language: f.language, title: f.title || undefined } }) });
  const [scanned, setScanned] = useState<string>("");

  useEffect(() => { const h = takeHandoff(); if (h?.text) setF((x) => ({ ...x, text: h.text.slice(0, 60000), title: h.title ?? x.title, language: h.language ?? x.language, projectId: h.projectId })); else if (sp.get("projectId")) setF((x) => ({ ...x, projectId: sp.get("projectId")! })); }, []); // eslint-disable-line
  // живая оценка без LLM
  useEffect(() => { if (f.text.trim().length < 50) return; const t = setTimeout(() => { scan.mutate(f.text); setScanned(f.text); }, 700); return () => clearTimeout(t); }, [f.text, f.language, f.title]); // eslint-disable-line
  useEffect(() => { if (job.data) { setRes(job.data); setAccept(Object.fromEntries(job.data.scenes.map((s) => [s.i, s.status === "edited"]))); } }, [job.data]);

  const valid = f.text.trim().length >= 100 && f.text.length <= 60000;
  const submit = () => valid && (setRes(null), job.start({ ...f, text: f.text.trim(), title: f.title?.trim() || undefined, authorSample: f.authorSample?.trim() || undefined }));
  const finalText = useMemo(() => res ? res.scenes.map((s) => (accept[s.i] ? s.after : s.before)).join("\n\n") : "", [res, accept]);
  const accepted = res ? res.scenes.filter((s) => s.status === "edited" && accept[s.i]).length : 0;
  const edited = res ? res.scenes.filter((s) => s.status === "edited").length : 0;
  const live = scan.data && scanned === f.text ? scan.data : null;
  const go = (to: string) => { putHandoff({ text: finalText, title: f.title, projectId: f.projectId, language: f.language }); nav(`${to}${f.projectId ? `?projectId=${f.projectId}` : ""}`); };
  const download = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([finalText], { type: "text/plain;charset=utf-8" })); a.download = `${(f.title || "script").replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60)}_human.txt`; a.click(); URL.revokeObjectURL(a.href); };

  return (
    <div>
      <ToolHeader icon={AudioLines} title="Живой голос" eyebrow="// HUMANIZER" subtitle="Находит признаки ИИ (§1–§26, T1–T11), правит по сценам, сверяет факты и показывает «было → стало»" />
      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card brackets className="h-fit p-5">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Textarea label="Сценарий" required value={f.text} maxLength={60000} rows={14} onChange={(e) => set("text", e.target.value)} placeholder="Вставьте текст озвучки — от 100 символов. Метки [[SCENE n]] и [IMAGE n] сохраняются" />
            <div className="-mt-2 flex items-center justify-between font-mono text-[11px] text-muted-foreground"><span>{countWords(f.text)} слов · {f.text.length} симв.</span>
              {live && <span className={cn("font-semibold", VERDICT[live.verdict][1])}>живой голос {live.score}/100</span>}</div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Язык</Label><Select value={f.language} onChange={(e) => set("language", e.target.value)}>{CONTENT_LANGUAGES.map((l) => <option key={l.value} value={l.value} lang={l.value} dir="auto">{l.label}</option>)}</Select>{!["ru", "en"].includes(f.language) && <p className="mt-1 text-xs text-muted-foreground">Локальные словари ИИ-маркеров есть только для русского и английского; на этом языке используются общие метрики. Это не доказательство авторства.</p>}</div>
              <div><Label hint="для §24">Название</Label><Input value={f.title ?? ""} maxLength={300} onChange={(e) => set("title", e.target.value)} placeholder="необязательно" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Проходов</Label><div className="flex gap-1.5">{[1, 2, 3].map((n) => <Chip key={n} active={f.maxPasses === n} onClick={() => set("maxPasses", n)}>{n}</Chip>)}</div></div>
              <div><Label hint={`±${f.maxDelta}%`}>Длина сцены</Label><input type="range" min={5} max={25} step={1} value={f.maxDelta} onChange={(e) => set("maxDelta", +e.target.value)} className="mt-2 w-full accent-primary" aria-label="Допустимое изменение длины сцены" /></div>
            </div>
            <div className="divide-y rounded-md border px-3">
              <Switch checked={f.force} onChange={(v) => set("force", v)} label="Править все сцены" description="Выкл — только сцены ниже порога 85 или с сильными признаками ●●●" />
              <Switch checked={authorOpen || !!f.authorSample} onChange={(v) => { setAuthorOpen(v); if (!v) set("authorSample", ""); }} label="Голос автора" description="Образец вашего текста: длина фраз, лексика, пунктуация" />
            </div>
            {(authorOpen || !!f.authorSample) && <Textarea label="Образец текста автора" value={f.authorSample ?? ""} maxLength={6000} rows={4} onChange={(e) => set("authorSample", e.target.value)} placeholder="2–3 абзаца, написанных вами" />}
            {!(authorOpen || !!f.authorSample) && <Switch checked={(f.channelVoice ?? true) && !!(vp.data?.enabled && vp.data.passport)} onChange={(v) => set("channelVoice", v)} label="Голос канала" description={voiceHint(vp.data)} />}
            {job.status === "running" ? <div className="space-y-3"><ProgressBar value={job.pct} label={job.stage} /><Button type="button" variant="danger" onClick={job.cancel}><X className="h-4 w-4" />Остановить</Button></div>
              : <Button type="submit" size="lg" className="w-full" disabled={!valid}><Wand2 className="h-4 w-4" />Очеловечить</Button>}
            {job.status === "error" && <ErrorAlert error={job.error} onRetry={submit} />}
            <p className="text-[11px] leading-relaxed text-muted-foreground">Оценка = 100 − 5 × (штраф на 100 слов): ●●● = 3, ●● = 2, ● = 1. ≥85 — звучит как человек, 65–84 — есть следы, &lt;65 — переписать. Правка отклоняется, если добавлены числа, изменены «цитаты», сдвинуты метки или длина вышла за лимит.</p>
          </form>
        </Card>

        <div className="min-w-0 space-y-4">
          {!res ? (live ? (
            <Card className="p-5">
              <div className="flex flex-wrap items-center gap-5">
                <ScoreRing value={live.score} size={96} label="живой голос" />
                <div className="min-w-0 flex-1"><div className={cn("text-xl font-bold", VERDICT[live.verdict][1])}>{VERDICT[live.verdict][0]}</div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{live.words} слов · {live.sentences} предл. · ср. {live.avgSentence} сл. · макс {live.maxSentence} · штраф {live.penalty}</div>
                  <div className="mt-2"><Counts r={live} /></div></div>
                <Badge>без LLM</Badge>
              </div>
              <div className="mt-4 max-h-[520px] overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/20 p-4 text-[15px] leading-relaxed"><Marked text={f.text} hits={live.hits} rules={rules} /></div>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground"><span><mark className="rounded bg-accent/30 px-1">●●●</mark> сильный</span><span><mark className="rounded bg-crown/30 px-1">●●</mark> средний</span><span><mark className="rounded bg-primary/20 px-1">●</mark> слабый</span><span>наведите на подсветку — правило и как исправить</span></div>
            </Card>
          ) : <Card className="p-10"><EmptyState icon={<ScanSearch className="h-8 w-8" />} title="Здесь появится отчёт">Оценка и подсветка считаются сразу, без LLM. «Очеловечить» правит сцены по 4 шагам Humanizer: признаки → черновик → сверка фактов → чистовик. ≈ 20–60 секунд.</EmptyState></Card>) : (<>
            <Card className="flex flex-wrap items-center gap-6 p-5">
              <div className="flex items-center gap-3"><ScoreRing value={res.before.score} size={84} label="было" /><span className="text-2xl text-muted-foreground">→</span><ScoreRing value={res.after.score} size={108} label="стало" /></div>
              <div className="min-w-0 flex-1">
                <div className={cn("text-2xl font-bold", VERDICT[res.after.verdict][1])}>{VERDICT[res.after.verdict][0]}</div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">порог {res.threshold} · правок в {edited} из {res.scenes.length} сцен · проходов {res.passes} · слов {res.before.words} → {res.after.words} · ср. длина {res.before.avgSentence} → {res.after.avgSentence} · {res.model}</div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2"><div><div className="mono-label mb-1 text-muted-foreground">Найдено</div><Counts r={res.before} /></div><div><div className="mono-label mb-1 text-muted-foreground">Осталось</div><Counts r={res.after} /></div></div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2"><h3 className="flex-1 font-semibold">Сцены: было → стало</h3>
                {(["diff", "after", "marks"] as const).map((v) => <Chip key={v} active={view === v} onClick={() => setView(v)}>{v === "diff" ? "Разница" : v === "after" ? "Чистовик" : "Признаки"}</Chip>)}</div>
              <div className="space-y-3">{res.scenes.map((s) => (
                <div key={s.i} className={cn("rounded-md border p-3", s.status === "edited" && accept[s.i] && "border-success/40")}>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono text-primary">СЦЕНА {s.i + 1}</span>
                    <span className="font-mono text-xs text-muted-foreground">{s.scoreBefore} → <b className={s.scoreAfter >= res.threshold ? "text-success" : "text-crown"}>{s.scoreAfter}</b> · {s.wordsBefore} → {s.wordsAfter} сл.</span>
                    {s.status === "clean" && <Badge tone="success">чисто</Badge>}
                    {s.status === "rejected" && <Badge tone="danger">правка отклонена</Badge>}
                    {s.facts && !s.facts.ok && <Badge tone="crown">проверить факты</Badge>}
                    {s.status === "edited" && <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs"><input type="checkbox" className="accent-primary" checked={!!accept[s.i]} onChange={(e) => setAccept((a) => ({ ...a, [s.i]: e.target.checked }))} />принять правку</label>}
                  </div>
                  {s.reason && <p className="mb-2 flex items-center gap-1.5 text-xs text-accent"><XCircle className="h-3.5 w-3.5" />{s.reason} — оставлен исходный текст</p>}
                  <div className="whitespace-pre-wrap text-[14.5px] leading-relaxed">
                    {view === "after" ? (accept[s.i] ? s.after : s.before)
                      : view === "marks" ? <Marked text={accept[s.i] ? s.after : s.before} hits={accept[s.i] ? s.hitsAfter : s.hitsBefore} rules={rules} />
                      : s.status !== "edited" ? <span className="text-muted-foreground">{s.before}</span>
                      : (() => { const d = wordDiff(s.before, s.after), same = d.filter((x) => x.t === "eq").reduce((a, x) => a + x.s.trim().length, 0);
                        // сильная переработка: пословный diff нечитаем — показываем «было | стало» рядом
                        if (same / Math.max(1, s.before.length) < 0.5) return <div className="grid gap-3 md:grid-cols-2"><div><div className="mono-label mb-1 text-accent">было</div><div className="text-muted-foreground">{s.before}</div></div><div><div className="mono-label mb-1 text-success">стало</div>{s.after}</div></div>;
                        return d.map((x, k) => x.t === "eq" ? <span key={k}>{x.s}</span> : x.t === "del" ? <del key={k} className="rounded bg-accent/15 text-accent/90">{x.s}</del> : <ins key={k} className="rounded bg-success/15 text-success no-underline">{x.s}</ins>); })()}
                  </div>
                  {s.edits.length > 0 && <details className="mt-2"><summary className="cursor-pointer text-xs text-muted-foreground">Правки по правилам ({s.edits.length})</summary>
                    <ul className="mt-2 space-y-1.5 text-sm">{s.edits.map((e, k) => <li key={k} className="rounded border p-2"><span className="text-accent/90">«{e.before}»</span> <span className="font-mono text-xs text-muted-foreground">→ {e.rules.map((r) => <span key={r} title={rules.get(r)?.name}>{r} </span>)}→</span> <span className="text-success">«{e.after}»</span></li>)}</ul></details>}
                  {s.facts && !s.facts.ok && <p className="mt-2 flex items-start gap-1.5 text-xs text-crown"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{[s.facts.lostNumbers.length && `пропали числа: ${s.facts.lostNumbers.join(", ")} (если записаны словами — ок)`, s.facts.lostQuotes.length && "изменена цитата"].filter(Boolean).join(" · ")}</p>}
                  {s.facts && (s.facts.addedNames.length > 0 || s.facts.lostNames.length > 0) && <p className="mt-1 text-xs text-muted-foreground">Имена: {s.facts.lostNames.length ? `пропали (${s.facts.lostNames.join(", ")}…)` : ""} {s.facts.addedNames.length ? `новые (${s.facts.addedNames.join(", ")}…)` : ""} — сверьте</p>}
                </div>))}</div>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-4"><div className="mb-2 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /><h3 className="font-semibold">[FACT-CHECK] — проверить</h3></div>
                {res.factsToCheck.length ? <ul className="list-inside list-disc space-y-1 text-sm">{res.factsToCheck.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="text-sm text-muted-foreground">Новых утверждений без источника нет.</p>}</Card>
              <Card className="p-4"><h3 className="mb-2 font-semibold">Оставлено намеренно</h3>
                {res.scenes.some((s) => s.kept.length) ? <ul className="space-y-1.5 text-sm">{res.scenes.flatMap((s) => s.kept.map((k, j) => <li key={`${s.i}-${j}`}><span className="italic">«{k.quote.replace(/^«|»$/g, "")}»</span> <span className="text-muted-foreground">— {k.why}</span></li>))}</ul> : <p className="text-sm text-muted-foreground">—</p>}</Card>
            </div>

            <Card className="p-4">
              <div className="mb-2 flex items-center gap-2"><h3 className="flex-1 font-semibold">Отчёт проверки</h3><CopyButton text={res.report} /></div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/20 p-3 font-mono text-xs leading-relaxed">{res.report}</pre>
            </Card>

            <Card className="flex flex-wrap items-center gap-2 p-4">
              <span className="mr-auto text-sm">Принято правок: <b>{accepted}</b> из {edited}</span>
              <CopyButton text={finalText} label="Копировать чистовик" />
              <Button size="sm" variant="ghost" onClick={download}><Download className="h-3.5 w-3.5" />.txt</Button>
              <Button size="sm" variant="outline" onClick={() => { set("text", finalText); setRes(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Play className="h-3.5 w-3.5" />В редактор и перепроверить</Button>
              <Button size="sm" variant="outline" onClick={() => go("/check/script-rater")}><Gauge className="h-3.5 w-3.5" />Оценить</Button>
              <Button size="sm" onClick={() => go("/voice")}><Mic className="h-3.5 w-3.5" />В озвучку →</Button>
            </Card>
            {res.projectId && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-success" />Отчёт сохранён в проект</p>}
          </>)}
        </div>
      </div>
    </div>
  );
}
