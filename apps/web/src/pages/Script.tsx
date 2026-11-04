import {openStoryboardEditorTransfer} from '@/lib/storyboardEditorTransfer';
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, AudioLines, CheckCircle2, Download, ExternalLink, FileText, Gauge, Mic, PenLine, Play, RefreshCw, Save, ScanText, Search, X, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { useDraft } from "@/lib/draft";
import { putHandoff } from "@/lib/handoff";
import { CONTENT_LANGUAGES } from "@/lib/constants";
import { useSettings, useVoiceProfile, voiceHint } from "@/lib/queries";
import type { Project, SavedTopic, ScriptCheck, ScriptInputT, ScriptResult } from "@/lib/types";
import { Badge, Button, Card, Chip, CopyButton, ErrorAlert, Input, Label, ProgressBar, Select, Skeleton, Switch, Textarea, ToolHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

type Style = { id: string; name: string; hint: string };
const WPM: Record<string, number> = { ru: 120, en: 150, es: 150, de: 118, fr: 145, pt: 150, uk: 120, pl: 125 };
const CPW: Record<string, number> = { ru: 7.2, uk: 7.2, pl: 7.4, de: 7.0, en: 6.0, es: 5.8, fr: 5.9, pt: 5.9 };
const TONES = [["serious", "Серьёзный"], ["ironic", "Ироничный"], ["dramatic", "Драматичный"], ["friendly", "Дружелюбный"], ["custom", "Свой"]] as const;
const INIT: ScriptInputT = { topic: "", hook: "", language: "ru", unit: "words", value: 1500, style: "universal", customStyle: "", tone: "serious", customTone: "", headings: false, cta: true, visualCues: false, research: true, structure: "auto", humanize: true, notes: "" };
const countWords = (s: string) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
/** Топ-модели AnyModel для сценариев (множитель цены ×) */
const SCRIPT_MODELS = [
  { id: "cc/claude-opus-5", label: "Claude Opus 5 — топ, ×6" },
  { id: "cc/claude-opus-4-8", label: "Claude Opus 4.8 — ×4" },
  { id: "cc/claude-sonnet-5", label: "Claude Sonnet 5 — ×3" },
  { id: "cx/gpt-5.6-sol", label: "GPT-5.6 Sol — ×2.5" },
  { id: "cx/gpt-5.6-terra", label: "GPT-5.6 Terra — ×1.5" },
  { id: "ag/gemini-3.1-pro-low", label: "Gemini 3.1 Pro" },
];
const MODE_RU = { web: "Веб-поиск / сводка модели", wikipedia: "Википедия", notes: "ваши ссылки", model: "знания модели" } as const;

function download(name: string, blob: Blob) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href); }
const fileName = (t: string, ext: string) => `${t.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60) || "script"}.${ext}`;

function CheckView({ c }: { c: ScriptCheck }) {
  const m = c.metrics;
  return (
    <div className="space-y-4">
      <div className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-sm", c.passed ? "border-success/40 bg-success/10 text-success" : "border-accent/40 bg-accent/10 text-accent")}>
        {c.passed ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{c.passed ? "Формальные требования выполнены" : `Ошибок: ${c.errors.length}`}{c.warnings.length ? ` · замечаний: ${c.warnings.length}` : ""}
      </div>
      <p className="text-xs text-muted-foreground">Это проверка объёма и структуры, не достоверности фактов. Длительность — оценка по темпу речи; точное время определяется по аудио.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["Слова", m.words], ["Символы", m.chars], ["≈ минут", m.minutes], ["Отклонение", m.deviationPct == null ? "—" : `${m.deviationPct > 0 ? "+" : ""}${m.deviationPct}%`],
          ["Предложений", m.sentences], ["Ср. длина", `${m.avgSentence} сл.`], ["Вопросов", m.questions], ["CTA", m.ctaPos == null ? "нет" : `${m.ctaPos}%`]].map(([k, v]) => (
          <div key={k as string} className="rounded-md border p-2.5"><div className="mono-label text-muted-foreground">{k}</div><div className="mt-0.5 font-mono text-lg">{v}</div></div>
        ))}
      </div>
      {c.errors.length > 0 && <ul className="space-y-1.5">{c.errors.map((e) => <li key={e} className="flex gap-2 text-sm"><XCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />{e}</li>)}</ul>}
      {c.warnings.length > 0 && <ul className="space-y-1.5">{c.warnings.map((e) => <li key={e} className="flex gap-2 text-sm text-muted-foreground"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-crown" />{e}</li>)}</ul>}
    </div>
  );
}

export default function Script() {
  const vp = useVoiceProfile();
  const [donorApplied,setDonorApplied]=useState(false);
  const [sp] = useSearchParams();
  const donorId=sp.get("donorBrief");
  const donorQ=useQuery({queryKey:["donor-script-brief",donorId],queryFn:()=>api<Partial<ScriptInputT>>(`/donor-workflow/snapshots/${encodeURIComponent(donorId!)}/brief`),enabled:!!donorId,retry:false,refetchOnWindowFocus:false});
  const nav = useNavigate();
  const qc = useQueryClient();
  const settings = useSettings();
  const [f, setF] = useDraft<ScriptInputT>("script", INIT);
  const set = <K extends keyof ScriptInputT>(k: K, v: ScriptInputT[K]) => setF((x) => ({ ...x, [k]: v }));
  const comparisonBriefId=sp.get('comparisonBrief'),comparisonArtifact=sp.get('comparisonArtifact');
  const researchBriefId=comparisonBriefId??sp.get('researchBrief'),researchProjectId=sp.get('projectId');
  const [briefApplied,setBriefApplied]=useState(false);
  const researchBrief=useQuery({queryKey:['research-script-brief',researchBriefId,researchProjectId,comparisonArtifact],queryFn:()=>api<Partial<ScriptInputT>>((comparisonBriefId?'/research-workflow/comparisons/':'/research-workflow/candidates/')+encodeURIComponent(researchBriefId!)+'/brief?projectId='+encodeURIComponent(researchProjectId!)+(comparisonBriefId?'&artifactId='+encodeURIComponent(comparisonArtifact??''):'')),enabled:!!researchBriefId&&!!researchProjectId,retry:false,refetchOnWindowFocus:false});
  const styles = useQuery({ queryKey: ["script-styles"], queryFn: () => api<Style[]>("/script/styles"), staleTime: Infinity });
  const structures = useQuery({ queryKey: ["script-structures"], queryFn: () => api<Style[]>("/script/structures"), staleTime: Infinity });
  const saved = useQuery({ queryKey: ["saved-topics"], queryFn: () => api<SavedTopic[]>("/saved-topics") });
  const job = useJob<ScriptResult, ScriptInputT>("/script");
  type DnaReview = { summary:string; script:string; sourceArtifactId:string; scriptHash:string; reviewedAt:string; model:string; findings:{criterion:string;verdict:"ok"|"issue"|"uncertain";quote:string;comment:string}[] };
  const dnaReview = useJob<DnaReview, {projectId:string;artifactId:string;script:string}>("/script/donor-review");
  useEffect(() => () => { void dnaReview.cancel(); }, [dnaReview.cancel]);
  const [tab, setTab] = useState<"script" | "plan" | "facts" | "check">("script");
  const [text, setText] = useState("");
  const [check, setCheck] = useState<ScriptCheck | null>(null);
  const [savedText, setSavedText] = useState<string | null>(null);
  const loadedArtifact = useRef<string | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const [storyboardTransferError, setStoryboardTransferError] = useState<unknown>(null);

  // предзаполнение из ссылки (?topic=&hook=&projectId=) или открытие версии из проекта (?projectId=&artifact=)
  const artifactId = sp.get("artifact");
  const projectQ = useQuery({ queryKey: ["project", sp.get("projectId")], queryFn: () => api<Project>(`/projects/${sp.get("projectId")}`), enabled: !!sp.get("projectId") && !!artifactId });
  useEffect(() => {
    const topic = sp.get("topic");
    if (topic) setF((x) => ({ ...x, topic, hook: sp.get("hook") ?? "", projectId: sp.get("projectId") ?? undefined }));
    else if (sp.get("projectId") && !artifactId) set("projectId", sp.get("projectId")!);
  }, []); // eslint-disable-line
  useEffect(() => { if (settings.data && !localStorage.getItem("ts:draft:script")) set("language", settings.data.contentLanguage); }, [settings.data]); // eslint-disable-line
  useEffect(() => {
    const key = `${sp.get("projectId")}:${artifactId}`;
    const a = projectQ.data?.artifacts.find((x) => x.id === artifactId);
    // Refetching a project must not silently replace the active editor.
    if (a?.data && loadedArtifact.current !== key) { loadedArtifact.current = key; const d = a.data as ScriptResult; if (d.input) setF({ ...INIT, ...d.input, projectId: projectQ.data!.id }); job.set({ ...d, projectId: projectQ.data!.id, artifactId: a.id, title: d.title ?? d.plan?.title ?? a.title } as ScriptResult); }
  }, [projectQ.data, artifactId]); // eslint-disable-line

  const res = job.data;
  const resRef = useRef(res);
  resRef.current = res;
  useEffect(() => { if (res) { setText(res.script); setSavedText(res.script); setCheck(res.check); qc.invalidateQueries({ queryKey: ["projects"] }); } }, [res]); // eslint-disable-line
  useEffect(() => { if (job.status === "running" && job.partial?.script) setText(job.partial.script); }, [job.status, job.partial?.script]);

  const lang = res?.input.language ?? f.language;
  const wpm = WPM[lang] ?? 140;
  // считаем как сервер: без [VISUAL CUE] и строк-заголовков актов
  const spoken = useMemo(() => { const names = new Set((res?.plan?.acts ?? []).map((a) => a.name.trim().toLowerCase())); return text.replace(/\[VISUAL CUE:[^\]]*\]/gi, " ").split("\n").filter((l) => !names.has(l.trim().replace(/^#+\s*/, "").toLowerCase())).join("\n"); }, [text, res]);
  const liveWords = useMemo(() => countWords(spoken), [spoken]);
  const liveChars = useMemo(() => spoken.replace(/\s+/g, " ").trim().length, [spoken]);
  const targetWords = f.unit === "chars" ? Math.round(f.value / (CPW[f.language] ?? 6.5)) : f.value;
  const edited = !!res && text !== res.script;
  const unsaved = !!res && savedText !== null && text !== savedText;

  const recheck = useMutation({
    mutationFn: () => api<ScriptCheck>("/script/check", { method: "POST", json: { profile: res?.donorBrief ? "donor" : "standard", script: text, language: lang, unit: res?.input.unit, target: res?.input.value, headings: res?.input.headings, visualCues: res?.input.visualCues, cta: res?.input.cta, actNames: res?.plan.acts.map((a) => a.name) } }),
    onSuccess: (c) => { setCheck(c); setTab("check"); },
  });
  const saveVersion = useMutation({
    mutationFn: async ({ snapshot, result }: { snapshot: string; result: ScriptResult }) => {
      const c = await api<ScriptCheck>("/script/check", { method: "POST", json: { profile: result.donorBrief ? "donor" : "standard", script: snapshot, language: result.input.language, unit: result.input.unit, target: result.input.value, headings: result.input.headings, visualCues: result.input.visualCues, cta: result.input.cta, actNames: result.plan.acts.map((a) => a.name) } });
      await api(`/projects/${result.projectId}/artifacts`, { method: "POST", json: { kind: "script", title: result.title, data: { ...result, script: snapshot, check: c, edited: true } } });
      return c;
    },
    onSuccess: (c, { snapshot, result }) => {
      if (resRef.current === result) {
        setSavedText(snapshot);
        if (textRef.current === snapshot) setCheck(c);
      }
      void qc.invalidateQueries({ queryKey: ["project", result.projectId] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const docx = useMutation({
    mutationFn: async () => { const r = await fetch("/api/script/docx", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: res?.title ?? f.topic, script: text }) }); if (!r.ok) throw new Error("Не удалось собрать .docx"); return r.blob(); },
    onSuccess: (b) => download(fileName(res?.title ?? "script", "docx"), b),
  });
  const go = (to: string) => { putHandoff({ text, title: res?.title, projectId: res?.projectId, sourceArtifactId: text === res?.script ? res?.artifactId : undefined, language: lang }); nav(`${to}${res?.projectId ? `?projectId=${res.projectId}` : ""}`); };

  const valid = f.topic.trim().length >= 3;
  const submit = () => valid && job.start({ ...f, topic: f.topic.trim(), hook: f.hook?.trim() || undefined, notes: f.notes?.trim() || undefined, model: f.model?.trim() || undefined, customStyle: f.style === "universal" ? f.customStyle : undefined, customTone: f.tone === "custom" ? f.customTone : undefined });
  const range = f.unit === "words" ? { min: 60, max: 6000, step: 10 } : { min: 500, max: 40000, step: 50 };
  const style = styles.data?.find((s) => s.id === f.style);
  const showResult = job.status === "running" ? !!job.partial?.script || !!job.partial?.plan : !!res;

  return (
    <div>
      <ToolHeader icon={PenLine} title="Сценарист" eyebrow="// SCRIPT" subtitle={f.donorBriefId ? "Утверждённая история и ДНК подачи — без повторного выбора структуры и обязательного вопроса в финале" : "Сценарий под озвучку: точный объём, хук, CTA на 40%, вопрос в финале, факты с источниками"} />
      {donorId&&<Card className="mb-4 mt-6 space-y-3"><h2 className="font-bold">ДНК → оригинальный сценарий</h2><p className="text-sm text-muted-foreground">Снимок содержит утверждённые ДНК, новую тему, источники и драматургию. Применение заменит текущую форму, но не запустит AI. При генерации исследование передаётся целиком; старые шаблоны хука и финала, автоподбор структуры и дополнительные преобразования в этом режиме не применяются.</p>{donorQ.error&&<ErrorAlert error={donorQ.error}/>} {donorQ.data&&<><p>{donorQ.data.topic} · {donorQ.data.value} слов</p><Button disabled={job.status==='running'} onClick={()=>{if(confirm('Заменить текущий черновик утверждённым брифом ДНК?')){setF({...INIT,...donorQ.data});setDonorApplied(true);}}}>Применить бриф ДНК</Button>{donorApplied&&<p role="status">Бриф применён. Сценарий ещё не запущен.</p>}</>}</Card>}
      {f.donorBriefId&&<p className="mb-6 mt-4 rounded-lg border p-3 text-sm">План сохранённого брифа — основа истории. Тон, хук и финал определяются ДНК. Сценарий пишется единым текстом без повторного планирования. <button className="ml-2 min-h-11 underline" onClick={()=>setF(x=>({...x,donorBriefId:undefined}))}>Отключить для этого черновика</button></p>}
      {res?.donorBrief&&<Card className="mb-6 mt-4 space-y-3"><h2 className="font-bold">Исследование и драматургия этого сценария</h2><p className="text-sm text-muted-foreground">Снимок сохранён вместе с результатом. Это материалы автора, не автоматическое подтверждение достоверности. Они не входят в чистую озвучку.</p><details><summary className="cursor-pointer py-2">Источники, факты и план</summary><div className="space-y-4 whitespace-pre-wrap break-words text-sm">{res.donorBrief.research.sources.map(s=><section key={s.id}><h3 className="font-bold">{s.id} · {s.title}</h3><p>{s.url}</p><p>{s.excerpt}</p></section>)}<p>{res.donorBrief.research.facts}</p><p>{res.donorBrief.research.uncertain}</p><p>{res.donorBrief.research.reconstruction}</p><p>{res.donorBrief.research.boundaries}</p><h3 className="font-bold">Утверждённая драматургия</h3><p>{res.donorBrief.outline}</p></div></details></Card>}
      {res?.donorBrief && <Card className="donor-ui mb-6 space-y-4 p-5 [overflow-wrap:anywhere]" data-testid="donor-script-review">
        <h2 className="text-xl font-bold">Проверка готового текста по ДНК</h2>
        <p className="text-base text-muted-foreground">Отдельный AI-запрос, может быть платным. Сравнивает текущий текст с сохранённой драматургией, подачей и источниками. Не переписывает сценарий и не подтверждает факты независимо. Отчёт и проверенная копия текста сохраняются в проекте.</p>
        <Button disabled={job.status === "running" || dnaReview.status === "running" || text.trim().length < 20 || text.length > 120000} onClick={() => dnaReview.start({projectId:res.projectId,artifactId:res.artifactId,script:text})}>Проверить сценарий по ДНК · AI</Button>
        {dnaReview.status === "running" && <div className="space-y-3"><ProgressBar value={dnaReview.pct} label={dnaReview.stage}/><Button variant="danger" onClick={dnaReview.cancel}>Остановить проверку</Button></div>}
        {dnaReview.error && <ErrorAlert error={dnaReview.error}/>}
        {dnaReview.data && dnaReview.data.sourceArtifactId === res.artifactId && <div className="space-y-4" role="status">
          {dnaReview.data.script !== text && <p className="rounded-lg border border-primary p-3 font-semibold">Текст изменён после проверки. Этот отчёт относится к предыдущей копии — запустите проверку заново.</p>}
          <p>{dnaReview.data.summary}</p>
          {dnaReview.data.findings.map(x => <section key={x.criterion} className="space-y-2 rounded-lg border p-4"><h3 className="font-bold">{{outline:"Утверждённая история",dna:"ДНК подачи",causality:"Причинность и действие",emotion:"Эмоция и юмор",facts:"Фактическая опора",originality:"Отличие от донора"}[x.criterion] || x.criterion} · {x.verdict === "ok" ? "Замечаний модели нет" : x.verdict === "issue" ? "Есть замечание" : "Нужна проверка автора"}</h3>{x.quote && <blockquote className="border-l-2 pl-3 text-muted-foreground">{x.quote}</blockquote>}<p>{x.comment}</p></section>)}
          <p className="text-sm text-muted-foreground">{dnaReview.data.model} · {dnaReview.data.reviewedAt}. Мнение модели, не сертификат качества или оригинальности.</p>
          <CopyButton text={JSON.stringify(dnaReview.data,null,2)}/>
        </div>}
      </Card>}
      {researchBriefId&&<Card className="space-y-3" data-testid="research-script-brief"><h2 className="font-bold">Бриф из исследования</h2><p className="text-sm text-muted-foreground">Чтение не вызывает YouTube или AI. Применение заменит поля текущего черновика, но не запустит сценарий. Проверьте источники и настройки перед генерацией; генерация использует выбранную модель и может быть платной.</p>{researchBrief.error&&<ErrorAlert error={researchBrief.error}/>} {researchBrief.data&&<><p>{researchBrief.data.topic} · {researchBrief.data.value} слов · {researchBrief.data.language}</p><details><summary className="cursor-pointer py-2">Показать источники и требования</summary><p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{researchBrief.data.notes}</p></details><Button disabled={job.status==='running'} onClick={()=>{if(window.confirm('Заменить поля текущего черновика сохранённым исследовательским брифом?')){setF({...INIT,...researchBrief.data,projectId:researchProjectId!});setBriefApplied(true);}}}>{briefApplied?'Применить бриф повторно':'Применить бриф к форме'}</Button>{briefApplied&&<p className="text-sm">Бриф применён. Генерация ещё не запускалась.</p>}</>}</Card>}

      <div className="grid gap-6 xl:grid-cols-[440px_minmax(0,1fr)]">
        <Card brackets className="h-fit p-5">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div>
              <Label required hint="[доп. вводные в скобках]">Тема</Label>
              <Input list="saved-topics-dl" value={f.topic} onChange={(e) => set("topic", e.target.value)} placeholder="Как люди каменного века лечили раны [без мистики, упор на археологию]" maxLength={1000} />
              <datalist id="saved-topics-dl">{saved.data?.map((t) => <option key={t.id} value={t.title} />)}</datalist>
              {f.projectId && <p className="mt-1 text-xs text-muted-foreground">Сохранится в проект · <button type="button" className="underline" onClick={() => set("projectId", undefined)}>отвязать</button></p>}
            </div>
            {!f.donorBriefId && <Textarea label="Хук (необязательно)" value={f.hook} onChange={(e) => set("hook", e.target.value)} maxLength={2000} rows={2} className="min-h-[64px]" placeholder="Готовый хук или пример интонации" />}
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Язык</Label><Select value={f.language} onChange={(e) => set("language", e.target.value)}>{CONTENT_LANGUAGES.map((l) => <option key={l.value} value={l.value} lang={l.value} dir="auto">{l.label}</option>)}</Select></div>
              <div><Label>Единицы</Label><div className="flex gap-1.5">
                <Chip active={f.unit === "words"} onClick={() => setF((x) => ({ ...x, unit: "words", value: x.unit === "words" ? x.value : Math.round(x.value / (CPW[x.language] ?? 6.5) / 50) * 50 || 1500 }))}>слова</Chip>
                <Chip active={f.unit === "chars"} onClick={() => setF((x) => ({ ...x, unit: "chars", value: x.unit === "chars" ? x.value : Math.round(x.value * (CPW[x.language] ?? 6.5) / 250) * 250 }))}>символы</Chip>
              </div></div>
            </div>
            <div>
              <Label hint={`≈ ${(targetWords / (WPM[f.language] ?? 140)).toFixed(1)} мин при ${WPM[f.language] ?? 140} сл/мин`}>Объём</Label>
              <div className="flex items-center gap-3">
                <input type="range" className="w-full accent-primary" {...range} value={Math.min(range.max, Math.max(range.min, f.value))} onChange={(e) => set("value", +e.target.value)} />
                <Input type="number" {...range} value={f.value} onChange={(e) => set("value", Math.max(range.min, Math.min(range.max, +e.target.value || range.min)))} className="w-24 text-center" />
              </div>
            </div>
            {!f.donorBriefId && <>
            <div>
              <Label hint={style?.hint}>Стиль</Label>
              <div className="flex flex-wrap gap-1.5">{styles.data?.map((s) => <Chip key={s.id} active={f.style === s.id} onClick={() => set("style", s.id)} title={s.hint}>{s.name}</Chip>)}</div>
              {f.style === "universal" && <Textarea className="mt-2 min-h-[56px]" rows={2} maxLength={3000} value={f.customStyle} onChange={(e) => set("customStyle", e.target.value)} placeholder="Свой стиль (необязательно): тон канала, приёмы, чего избегать" />}
            </div>
            </>}
            <div>
              <label htmlFor="script-model-id"><Label>Модель сценария — ручной ввод ID (AnyModel)</Label></label>
              <Input id="script-model-id" className="font-mono text-sm" value={f.model ?? ""}
                onChange={(e) => set("model", e.target.value)} list="script-model-ids" maxLength={120}
                autoComplete="off" autoCapitalize="none" spellCheck={false}
                placeholder="Например: cc/claude-opus-5" aria-describedby="script-model-help" />
              <datalist id="script-model-ids">{SCRIPT_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
              <div id="script-model-help" className="mt-2 space-y-2 text-sm text-muted-foreground">
                <p>Примеры: <code className="inline-block max-w-full break-all align-bottom">cc/claude-opus-5</code> или <code className="inline-block max-w-full break-all align-bottom">cc/claude-sonnet-5</code>. Можно вписать другой ID из каталога AnyModel, без кавычек и адреса сайта.</p>
                <p>Пустое поле — из настроек: <code className="inline-block max-w-full break-all align-bottom">{settings.data?.anymodel?.script ?? "cc/claude-opus-5"}</code>. Выбор действует для плана, актов и подгонки объёма; проверки и SEO используют основную модель.</p>
                <p>Чтобы эта модель использовалась первой, включите AnyModel и порядок «AnyModel основной» в настройках. При ошибке сохраняется автоматический переход на резерв; фактическая модель указана в результате.</p>
                <p>Прямой Claude API настраивается отдельно: Настройки → Прямые ключи → Claude. «Claude Pro» — не ID модели.</p>
              </div>
            </div>
            {!f.donorBriefId && <>
            <div>
              <Label hint={structures.data?.find((x) => x.id === f.structure)?.hint ?? "модель выберет из S1–S20 под тему"}>Структура</Label>
              <Select value={f.structure ?? "auto"} onChange={(e) => set("structure", e.target.value)}>
                <option value="auto">Авто — подобрать под тему</option>
                {structures.data?.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Тон</Label>
              <div className="flex flex-wrap gap-1.5">{TONES.map(([v, l]) => <Chip key={v} active={f.tone === v} onClick={() => set("tone", v)}>{l}</Chip>)}</div>
              {f.tone === "custom" && <Input className="mt-2" value={f.customTone} onChange={(e) => set("customTone", e.target.value)} maxLength={300} placeholder="напр. «спокойный, с лёгкой иронией, как у Пескова-натуралиста»" />}
            </div>
            <div className="divide-y rounded-md border px-3">
              <Switch checked={f.headings} onChange={(v) => set("headings", v)} label="Заголовки разделов" description="Выкл — чистый текст для озвучки" />
              <Switch checked={f.cta} onChange={(v) => set("cta", v)} label="Сильный CTA на подписку" description="Одна естественная фраза ≈ на 40% текста" />
              <Switch checked={f.visualCues} onChange={(v) => set("visualCues", v)} label="Визуальные подсказки [VISUAL CUE]" description="Для монтажёра; в озвучке вырезаются" />
              <Switch checked={f.research} onChange={(v) => set("research", v)} label="Глубокий ресёрч" description="Google Search (если доступен) → Википедия и ваши ссылки → досье фактов" />
              <Switch checked={f.humanize ?? true} onChange={(v) => set("humanize", v)} label="Живой голос после генерации" description="Humanizer: убрать признаки ИИ по актам, факты и объём (±6%) сохраняются" />
              <Switch checked={(f.channelVoice ?? true) && !!(vp.data?.enabled && vp.data.passport)} onChange={(v) => set("channelVoice", v)} label="Голос канала" description={voiceHint(vp.data)} />
            </div>
            <Textarea label="Заметки и факты" value={f.notes} onChange={(e) => set("notes", e.target.value)} maxLength={20000} placeholder="Вставьте факты, цитаты или ссылки — ссылки будут прочитаны при ресёрче" />
            </>}
            {job.status === "running" ? (
              <div className="space-y-3"><ProgressBar value={job.pct} label={job.stage} /><Button type="button" variant="danger" onClick={job.cancel}><X className="h-4 w-4" />Остановить</Button></div>
            ) : <Button type="submit" size="lg" block disabled={!valid}><Play className="h-4 w-4" />Написать сценарий</Button>}
            {job.status === "error" && <ErrorAlert error={job.error} onRetry={submit} />}
          </form>
        </Card>

        <div className="min-w-0">
          {!showResult ? (
            projectQ.isLoading ? <Skeleton className="h-[600px]" /> : (
              <Card className="grid min-h-[400px] place-items-center p-8 text-center text-muted-foreground">
                <div><FileText className="mx-auto mb-3 h-8 w-8" /><p className="font-medium text-foreground">Здесь появится сценарий</p><p className="mt-1 text-sm">{f.donorBriefId ? "Пишется по утверждённой истории без нового плана. " : "Пишется по актам — текст виден по мере готовности. "}120 слов ≈ 1 минута русской речи; точная длительность зависит от озвучки.</p></div>
              </Card>)
          ) : (
            <Card className="p-0">
              <div className="flex flex-wrap items-center gap-1 border-b px-3 pt-3">
                {([["script", "Сценарий"], ["plan", "План"], ["facts", "Факты и источники"], ["check", "Проверка"]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setTab(k)} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                    {l}{k === "check" && check && <span className={cn("ml-1.5 font-mono text-xs", check.passed ? "text-success" : "text-accent")}>{check.passed ? "✓" : check.errors.length}</span>}
                  </button>
                ))}
                {res && <span className="ml-auto pb-2 text-xs text-muted-foreground">{res.model}</span>}
              </div>
              <div className="p-4">
                {tab === "script" && (
                  <>
                    {res && <h2 className="mb-3 text-lg font-semibold">{res.title}</h2>}
                    <textarea aria-label="Текст сценария" value={text} onChange={(e) => setText(e.target.value)} readOnly={job.status === "running"} spellCheck={false}
                      className="field min-h-[560px] w-full resize-y font-[inherit] text-[15px] leading-relaxed" />
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
                      <span>{liveWords} слов</span><span>{liveChars} симв.</span><span>≈ {(liveWords / wpm).toFixed(1)} мин</span>
                      {res && <span>цель {res.input.value} {res.input.unit === "chars" ? "симв." : "слов"}</span>}
                      {edited && <Badge tone="crown">изменён</Badge>}
                      {res?.voice && <Badge tone={res.voice.after >= 85 ? "success" : "crown"} title={res.voice.counts.map((c) => `${c.rule} ${c.name} ×${c.count}`).join("\n") || "признаков не осталось"}>живой голос {res.voice.before !== res.voice.after ? `${res.voice.before} → ` : ""}{res.voice.after}/100{res.voice.edited ? ` · правок в ${res.voice.edited} из ${res.voice.scenes} актах` : ""}</Badge>}
                    </div>
                    {res && job.status !== "running" && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <CopyButton text={text} />
                        <Button size="sm" variant="ghost" onClick={() => download(fileName(res.title, "txt"), new Blob([text], { type: "text/plain;charset=utf-8" }))}><Download className="h-3.5 w-3.5" />.txt</Button>
                        <Button size="sm" variant="ghost" onClick={() => docx.mutate()} loading={docx.isPending} loadingText="…"><Download className="h-3.5 w-3.5" />.docx</Button>
                        <Button size="sm" variant="ghost" onClick={() => recheck.mutate()} loading={recheck.isPending} loadingText="…"><RefreshCw className="h-3.5 w-3.5" />Проверить</Button>
                        {unsaved && <Button size="sm" variant="outline" onClick={() => saveVersion.mutate({ snapshot: text, result: res })} loading={saveVersion.isPending} loadingText="Сохранение…" disabled={saveVersion.isPending}><Save className="h-3.5 w-3.5" />Сохранить версию</Button>}
                        <span className="ml-auto flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => { setStoryboardTransferError(null); try { openStoryboardEditorTransfer({source:'script-editor-v1',text,projectId:res?.projectId,edited}); } catch(e) { setStoryboardTransferError(e); } }}>В раскадровку ↗</Button>
                          <Button size="sm" onClick={() => go("/voice")}><Mic className="h-3.5 w-3.5" />В озвучку →</Button>
                          <Button size="sm" variant="outline" onClick={() => go("/seo")}><Search className="h-3.5 w-3.5" />В SEO →</Button>
                          <Button size="sm" variant="outline" onClick={() => go("/check/script-rater")}><Gauge className="h-3.5 w-3.5" />Оценить</Button>
                          <Button size="sm" variant="outline" onClick={() => go("/check/humanizer")}><AudioLines className="h-3.5 w-3.5" />Живой голос</Button>
                          <Button size="sm" variant="outline" onClick={() => go("/check/ai-detector")}><ScanText className="h-3.5 w-3.5" />AI-детектор</Button>
                        </span>
                      </div>
                    )}
                    {saveVersion.error && <div className="mt-3"><ErrorAlert error={saveVersion.error}/><p className="mt-2 text-sm">Проверьте проект перед повторным сохранением: при потере ответа версия могла записаться. Перед уходом скачайте текущий текст в TXT: несохранённые правки могут пропасть.</p></div>}
                    {storyboardTransferError?<ErrorAlert error={storyboardTransferError}/>:null}
                    {res && <p className="mt-3 text-xs text-muted-foreground" role="status"><span>{saveVersion.isPending ? "Сохранение выбранной версии…" : unsaved ? "Есть несохранённые изменения" : "Текущий текст сохранён в проекте"}</span>. {unsaved && !saveVersion.isPending && "До сохранения или скачивания TXT правки могут пропасть при уходе или перезагрузке. "}<a className="text-primary underline" href={`/projects/${res.projectId}`} onClick={(e) => { e.preventDefault(); nav(`/projects/${res.projectId}`); }}>Открыть проект</a></p>}
                  </>
                )}
                {tab === "plan" && (() => { const plan = res?.plan ?? job.partial?.plan; return !plan ? <Skeleton className="h-64" /> : (
                  <div className="space-y-4 text-sm">
                    <p><b>Главный вопрос:</b> {plan.core_question}</p>
                    {plan.structure_id && <p><b>Структура:</b> {plan.structure_id}{(() => { const x = structures.data?.find((s) => s.id === plan.structure_id); return x ? ` · ${x.name}` : ""; })()}</p>}
                    {plan.hook_strikes && (plan.hook_strikes.image || plan.hook_strikes.question) && <div className="rounded-md border p-3"><b>Хук в три удара</b><ol className="mt-1 list-inside list-decimal space-y-0.5 text-muted-foreground">{[["Образ", plan.hook_strikes.image], ["Противоречие", plan.hook_strikes.contradiction], ["Вопрос", plan.hook_strikes.question]].filter(([, v]) => v).map(([k, v]) => <li key={k}><span className="text-foreground">{k}:</span> {v}</li>)}</ol></div>}
                    <ol className="space-y-3">{plan.acts.map((a, i) => (
                      <li key={i} className="rounded-md border p-3">
                        <div className="flex items-center gap-2"><span className="font-mono text-primary">{String(i + 1).padStart(2, "0")}</span><b>{a.name}</b><span className="ml-auto font-mono text-xs text-muted-foreground">{a.words} сл.</span>{plan.ctaAct === i && <Badge tone="primary">CTA</Badge>}</div>
                        <p className="mt-1 text-muted-foreground">{a.summary}</p>
                        <ul className="mt-2 list-inside list-disc space-y-0.5">{a.beats.map((b) => <li key={b}>{b}</li>)}</ul>
                      </li>))}
                    </ol>
                    {!!plan.open_loops.length && <div><b>Журнал петель (открыта → закрыта):</b><ul className="mt-1 list-inside list-disc">{plan.open_loops.map((l) => <li key={l}>{l}</li>)}</ul></div>}
                    {plan.midroll_cta_line && <p><b>CTA:</b> «{plan.midroll_cta_line}»</p>}
                    <p><b>Вопрос в финале:</b> «{plan.ending_question}»</p>
                    {!!plan.claims_to_verify?.length && <div><b className="text-crown">[FACT-CHECK] Утверждения для проверки:</b><ul className="mt-1 list-inside list-disc text-muted-foreground">{plan.claims_to_verify.map((x) => <li key={x}>{x}</li>)}</ul></div>}
                  </div>); })()}
                {tab === "facts" && (() => { const d = res?.facts ?? job.partial?.facts; return !d ? <p className="text-sm text-muted-foreground">{(res?.input ?? f).research ? "Собираем…" : "Ресёрч был выключен"}</p> : (
                  <div className="space-y-4 text-sm">
                    <div className="flex flex-wrap items-center gap-2"><Badge tone={d.mode === "model" ? "danger" : "crown"}>Источник: {MODE_RU[d.mode]}</Badge>{d.note && <span className="text-xs text-muted-foreground">{d.note}</span>}</div>
                    <p className="text-xs text-muted-foreground">Уверенность указана моделью, а не независимой проверкой. Список ссылок не подтверждает каждое утверждение: перед публикацией сверяйте факты с оригиналами.</p>
                    <ol className="space-y-2">{d.facts.map((x, i) => (
                      <li key={i} className="flex gap-2"><span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", x.confidence === "high" ? "bg-success" : x.confidence === "medium" ? "bg-crown" : "bg-accent")} title={x.confidence} />
                        <span>{x.claim}<span className="ml-1 text-xs text-muted-foreground">({x.attribution === "source_text" ? "привязка модели к тексту, не независимая проверка" : x.attribution === "search_summary" ? "сводка модели" : x.attribution === "author_notes" ? "заметки автора" : x.attribution === "unattributed" ? "без проверенной привязки" : "старая привязка — перепроверьте"})</span>{x.attribution === "source_text" && x.source != null && d.sources[x.source]?.url && <a href={d.sources[x.source].url} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center text-xs text-primary hover:underline">[{x.source + 1}]<ExternalLink className="ml-0.5 h-3 w-3" /></a>}</span></li>))}
                    </ol>
                    {!!d.disputed.length && <div><b className="text-crown">Спорное — проверьте:</b><ul className="mt-1 list-inside list-disc text-muted-foreground">{d.disputed.map((x) => <li key={x}>{x}</li>)}</ul></div>}
                    {d.sources.some((s) => s.url) && <div><b>Материалы и ссылки для проверки</b><ol className="mt-1 space-y-0.5">{d.sources.map((s, i) => s.url && <li key={i} className="text-xs"><span className="font-mono">[{i + 1}]</span> <a className="text-primary hover:underline" href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}</ol></div>}
                  </div>); })()}
                {tab === "check" && (check ? <CheckView c={check} /> : <Skeleton className="h-40" />)}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
