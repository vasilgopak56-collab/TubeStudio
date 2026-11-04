import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Fingerprint, ArrowRight, Plus, Download, Save, Trash2, Check, Play } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { Button, Card, CopyButton, ErrorAlert, Input, Select, Textarea as SharedTextarea, ProgressBar } from "@/components/ui";
type DNA = {
    audience: string;
    promise: string;
    hooks: string;
    pov: string;
    pacing: string;
    stakes: string;
    explanation: string;
    humor: string;
    endings: string;
    avoid: string;
    evidence: string;
};
type Idea = {
    title: string;
    premise: string;
    difference: string;
    conflict: string;
    payoff: string;
    questions: string[];
};
type Source = {
    id: string;
    title: string;
    url: string;
    excerpt: string;
};
type Research = {
    sources: Source[];
    facts: string;
    uncertain: string;
    reconstruction: string;
    boundaries: string;
};
type Work = {
    name: string;
    channel: string;
    refs: {
        title: string;
        url: string;
        transcript: string;
    }[];
    notebookAnalysis: string;
    dna: DNA;
    dnaApproval: string;
    mode: "donor" | "own";
    direction: string;
    ideas: Idea[];
    selected: Idea | null;
    topicApproval: string;
    research: Research;
    outline: string;
    outlineChecks: string[];
    outlineBasis: string;
    outlineApproval: string;
    language: string;
    words: number;
};
type Snapshot = Work & {
    id: string;
    createdAt: string;
};
type Status = {
    dna: boolean;
    topic: boolean;
    research: boolean;
    ready: boolean;
    keys: {
        dna: string;
        topic: string;
        research: string;
        outline: string;
    };
};
type JobResult = {
    dna?: DNA;
    ideas?: Idea[];
    outline?: string;
    basis?: string;
    checks?: string[];
    model: string;
};
const DNA_LABELS: [
    keyof DNA,
    string,
    string
][] = [
    ["audience", "Аудитория", "Кому интересен формат и почему"], ["promise", "Обещание зрителю", "Что зритель проживает и понимает"], ["hooks", "Крючки и заголовки", "Тип интриги, а не готовые фразы донора"], ["pov", "Точка зрения / POV", "Ограниченное знание героя; второе лицо — по смыслу"], ["pacing", "Ритм и темп", "Действие → объяснение → возвращение в ситуацию"], ["stakes", "Конфликт и ставки", "Что герой рискует потерять"], ["explanation", "Способ объяснения", "Как действие раскрывает механизм"], ["humor", "Юмор и эмоция", "Самоуверенность, неловкость, ирония, эмпатия"], ["endings", "Развязка", "Как закрываются обещание и вопрос"], ["avoid", "Не переносить", "Чужие темы, формулировки, герои и узнаваемая структура"], ["evidence", "На чём основан разбор", "Номер референса + таймкод/выдержка; наблюдение или гипотеза"]
];
const EMPTY_IDEA: Idea = { title: "", premise: "", difference: "", conflict: "", payoff: "", questions: ["", ""] };
const INIT: Work = { name: "Новый сценарный маршрут", channel: "", refs: [{ title: "", url: "", transcript: "" }], notebookAnalysis: "", dna: Object.fromEntries(DNA_LABELS.map(([k]) => [k, ""])) as DNA, dnaApproval: "", mode: "donor", direction: "", ideas: [], selected: null, topicApproval: "", research: { sources: [], facts: "", uncertain: "", reconstruction: "", boundaries: "" }, outline: "", outlineChecks: [], outlineBasis: "", outlineApproval: "", language: "ru", words: 1500 };
const KEY = "ts:draft:donor-workflow:v1";
const STEPS = ["ДНК канала", "Новые темы", "Исследование", "Драматургия"];
function loadDraft(): {
    work: Work;
    broken: string;
} {
    let raw = "";
    try {
        raw = localStorage.getItem(KEY) || "";
        if (!raw)
            return { work: structuredClone(INIT), broken: "" };
        const d = JSON.parse(raw);
        const strings = (v: unknown, keys: string[]) => !!v && typeof v === "object" && keys.every(k => typeof (v as Record<string, unknown>)[k] === "string");
        const validIdea = (v: unknown) => strings(v, ["title", "premise", "difference", "conflict", "payoff"]) && Array.isArray((v as Idea).questions) && (v as Idea).questions.every(q => typeof q === "string");
        if (!strings(d, ["name", "channel", "notebookAnalysis", "dnaApproval", "direction", "topicApproval", "outline", "outlineBasis", "outlineApproval", "language"]) || !Array.isArray(d.refs) || d.refs.length < 1 || d.refs.length > 5 || !d.refs.every((x: unknown) => strings(x, ["title", "url", "transcript"])) || !strings(d.dna, DNA_LABELS.map(([k]) => k)) || !Array.isArray(d.ideas) || !d.ideas.every(validIdea) || (d.selected !== null && !validIdea(d.selected)) || !strings(d.research, ["facts", "uncertain", "reconstruction", "boundaries"]) || !Array.isArray(d.research.sources) || !d.research.sources.every((x: unknown) => strings(x, ["id", "title", "url", "excerpt"])) || !Number.isInteger(d.words) || !["own", "donor"].includes(d.mode) || (d.outlineChecks !== undefined && (!Array.isArray(d.outlineChecks) || !d.outlineChecks.every((x: unknown) => typeof x === "string"))))
            throw Error("shape");
        return { work: { ...structuredClone(INIT), ...d }, broken: "" };
    }
    catch {
        return { work: structuredClone(INIT), broken: raw || "Черновик недоступен" };
    }
}
function download(name: string, data: unknown) { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function Textarea(p: React.ComponentProps<typeof SharedTextarea>) { return <SharedTextarea {...p} aria-label={typeof p.label === "string" ? p.label : undefined}/>; }
function Field({ label, children }: {
    label: string;
    children: React.ReactNode;
}) { return <label className="block space-y-2"><span className="block font-semibold">{label}</span>{children}</label>; }
export default function DonorWorkflow() {
    const nav = useNavigate();
    const [sp] = useSearchParams();
    const [initialDraft] = useState(loadDraft);
    const [recovering, setRecovering] = useState(!!initialDraft.broken);
    const [w, setW] = useState<Work>(initialDraft.work);
    const [tab, setTab] = useState(0), [error, setError] = useState<Error | null>(null), [message, setMessage] = useState(""), [pending, setPending] = useState(false), [storageError, setStorageError] = useState(false), [prompts, setPrompts] = useState<{
        analysis: string;
        research: string;
    } | null>(null), [savedId, setSavedId] = useState("");
    const [debounced, setDebounced] = useState(w);
    const job = useJob<JobResult, Work>("/donor-workflow/analyze");
    type IdeasReview = {summary:string; model:string; reviewedAt:string; pairs:{left:number;right:number;verdict:string;reason:string}[]; donor:{idea:number;verdict:string;reason:string}[]};
    const ideasReview = useJob<IdeasReview, Work>("/donor-workflow/review-ideas");
    const [reviewBasis, setReviewBasis] = useState("");
    const ideasBasis = JSON.stringify([w.ideas,w.dna,w.refs,w.notebookAnalysis]);
    const stage = useRef("");
    const busy = pending || job.status === "running" || ideasReview.status === "running";
    useEffect(() => { const t = setTimeout(() => { setDebounced(w); try {
        if (!recovering)
            localStorage.setItem(KEY, JSON.stringify(w));
        setStorageError(false);
    }
    catch {
        setStorageError(true);
    } }, 300); setSavedId(""); return () => clearTimeout(t); }, [w, recovering]);
    const status = useQuery({ queryKey: ["donor-status", debounced], queryFn: () => api<Status>("/donor-workflow/status", { method: "POST", json: debounced }), retry: false, refetchOnWindowFocus: false });
    const current = debounced === w ? status.data : undefined;
    const snapshots = useQuery({ queryKey: ["donor-snapshots"], queryFn: () => api<{
            id: string;
            name: string;
            createdAt: string;
            ready: boolean;
        }[]>("/donor-workflow/snapshots"), refetchOnWindowFocus: false });
    const update = <K extends keyof Work>(key: K, value: Work[K]) => { setW(x => ({ ...x, [key]: value, ...(["dna", "refs", "notebookAnalysis", "channel", "direction"].includes(key) ? { ideas: [] } : {}) })); setMessage(""); setPrompts(null); };
    const act = async (fn: () => Promise<void>) => { setPending(true); setError(null); setMessage(""); try {
        await fn();
    }
    catch (e) {
        setError(e as Error);
    }
    finally {
        setPending(false);
    } };
    const open = async (id: string) => { if (!confirm("Загрузить снимок вместо текущего черновика? Текущий черновик можно сначала экспортировать."))
        return; await act(async () => { const record = await api<Snapshot>(`/donor-workflow/snapshots/${id}`); const { id: _, createdAt: __, ...form } = record; setW(form); setPrompts(null); setMessage("Снимок загружен. Генерация не запускалась."); }); };
    const openedParam = useRef("");
    useEffect(() => { const id = sp.get("snapshot"); if (id && openedParam.current !== id) {
        openedParam.current = id;
        void open(id);
    } }, [sp]); // eslint-disable-line
    useEffect(() => () => { void job.cancel(); void ideasReview.cancel(); }, [job.cancel, ideasReview.cancel]);
    useEffect(() => { if (job.status !== "done" || !job.data)
        return; const d = job.data; if (stage.current === "analyze" && d.dna) {
        setW(x => ({ ...x, dna: d.dna!, dnaApproval: "", ideas: [] }));
        setMessage("ДНК подготовлена. Проверьте доказательства, исправьте поля и подтвердите.");
    } if (stage.current === "ideas" && d.ideas) {
        setW(x => ({ ...x, ideas: d.ideas! }));
        setMessage("Подготовлено пять новых тем. Выберите одну и проверьте отличие от донора.");
    } if (stage.current === "outline" && d.outline) {
        setW(x => ({ ...x, outline: d.outline!, outlineBasis: d.basis!, outlineApproval: "", outlineChecks: d.checks || [] }));
        setMessage("Драматургия готова к вашей проверке. Сценарий ещё не написан.");
    } stage.current = ""; }, [job.status, job.data]);
    const start = (s: string) => { setError(null); setMessage(""); stage.current = s; void job.start(w, "/donor-workflow/" + s); };
    const approve = (s: string) => act(async () => { const patch = await api<Partial<Work>>("/donor-workflow/approve-" + s, { method: "POST", json: w }); setW(x => ({ ...x, ...patch })); setMessage("Этап подтверждён. Следующий шаг запускается только вручную."); });
    const notebook = () => act(async () => setPrompts(await api("/donor-workflow/notebook", { method: "POST", json: w })));
    const save = async () => { const record = await api<Snapshot>("/donor-workflow/snapshots", { method: "POST", json: w }); setSavedId(record.id); await snapshots.refetch(); setMessage("Новый снимок сохранён на сервере. Предыдущие версии не изменены."); return record.id; };
    const next = () => setTab(Math.min(3, tab + 1));
    return <div className="donor-ui space-y-6 text-base [overflow-wrap:anywhere]">
  <header className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-3xl"><p className="mb-2 text-sm font-semibold text-primary">ОРИГИНАЛЬНАЯ ИСТОРИЯ · ЗНАКОМЫЙ ЯЗЫК ПОДАЧИ</p><h1 className="flex items-center gap-3 text-3xl font-extrabold"><Fingerprint className="h-8 w-8 shrink-0"/>ДНК канала → сценарий</h1><p className="mt-3 text-muted-foreground">Переносим механику вовлечения, не чужую историю. Новая тема, свои факты и герой, за которого хочется переживать.</p></div></header>
  <Card className="space-y-4 p-5"><div className="grid gap-4 md:grid-cols-[1fr_auto]"><Field label="Название маршрута"><Input value={w.name} maxLength={180} onChange={e => update("name", e.target.value)} disabled={busy}/></Field><div className="flex flex-wrap items-end gap-2"><Button variant="outline" disabled={busy} onClick={() => download("TubeStudio-DNA-draft.json", { format: "tubestudio-donor-workflow", version: 1, work: w })}><Download className="h-4 w-4"/>Экспорт JSON</Button><Button variant="outline" disabled={busy} onClick={() => act(async () => { await save(); })}><Save className="h-4 w-4"/>Сохранить снимок</Button></div></div>
   <div className="flex flex-wrap items-center gap-3"><Field label="Открыть сохранённый снимок"><Select aria-label="Открыть сохранённый снимок" className="max-w-full sm:w-80" value="" disabled={busy} onChange={e => void open(e.target.value)}><option value="">Выберите снимок…</option>{snapshots.data?.map(x => <option value={x.id} key={x.id}>{x.name} · {new Date(x.createdAt).toLocaleString()} {x.ready ? "· бриф готов" : "· черновик"}</option>)}</Select></Field><label className="cursor-pointer text-sm underline">Импорт черновика JSON<input aria-label="Импорт маршрута JSON" type="file" accept=".json,application/json" className="sr-only" disabled={busy} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (!f)
        return; void act(async () => { if (f.size > 1500000)
        throw Error("JSON больше 1,5 МБ"); const j = JSON.parse(await f.text()); if (j.format !== "tubestudio-donor-workflow" || j.version !== 1)
        throw Error("Нужен экспорт маршрута TubeStudio"); await api("/donor-workflow/status", { method: "POST", json: j.work }); if (confirm("Заменить текущий черновик данными JSON?"))
        setW(j.work); }); }}/></label></div>
   {savedId && <p className="text-sm">Снимок сохранён. Его можно открыть в списке выше.</p>}<p className="text-sm text-muted-foreground">Черновик сохраняется в этом браузере; снимки — в данных программы и штатной резервной копии. AI-кнопки отправляют введённые материалы настроенному текстовому провайдеру и могут быть платными. Открытие, правки и подтверждение не вызывают AI.</p>
  </Card>
  {recovering && <Card className="space-y-3 border-accent p-4"><p role="alert">Сохранённый черновик повреждён. Он не перезаписан; автосохранение приостановлено.</p><div className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => download("TubeStudio-DNA-recovery.json", { raw: initialDraft.broken })}>Экспорт повреждённого черновика</Button><Button variant="danger" onClick={() => { if (confirm("Разрешить сохранение текущей формы вместо повреждённого черновика?"))
        setRecovering(false); }}>Продолжить с новой формой</Button></div></Card>}
  {storageError && <p role="alert" className="rounded-lg border border-accent p-4">Браузер не сохранил черновик. Экспортируйте JSON или сохраните снимок на сервере до закрытия страницы.</p>}
  {snapshots.error && <ErrorAlert error={snapshots.error}/>} {error && <ErrorAlert error={error}/>} {job.status === "error" && <ErrorAlert error={job.error}/>} {message && <p role="status" className="rounded-lg border border-primary/40 bg-primary/5 p-4">{message}</p>}
  {ideasReview.status === "running" && <Card className="space-y-3 p-5"><ProgressBar value={ideasReview.pct} label={ideasReview.stage}/><Button variant="danger" onClick={ideasReview.cancel}>Остановить проверку тем</Button></Card>}
  <nav aria-label="Этапы сценарного маршрута" className="grid grid-cols-2 gap-2 lg:grid-cols-4">{STEPS.map((s, i) => <button key={s} className={`flex min-h-14 items-center gap-2 rounded-lg border p-3 text-left font-semibold ${tab === i ? "border-primary bg-primary/10" : "bg-card"}`} aria-current={tab === i ? "step" : undefined} disabled={busy} onClick={() => setTab(i)}><span className="shrink-0 font-mono text-sm text-primary sm:text-base">0{i + 1}</span><span className="min-w-0 flex-1 text-sm leading-snug sm:text-base">{s}</span>{[current?.dna, current?.topic, current?.research, current?.ready][i] && <Check aria-label="Подтверждено" className="ml-auto h-4 w-4 shrink-0"/>}</button>)}</nav>
  {job.status === "running" && <Card className="space-y-3 p-5"><ProgressBar value={job.pct} label={job.stage}/><Button variant="danger" onClick={() => void job.cancel()}>Остановить AI</Button><p className="text-sm text-muted-foreground">Отмена не возвращает оплату уже отправленного запроса. Поля заблокированы, чтобы результат не попал в другой бриф.</p></Card>}
  <fieldset disabled={busy} className="min-w-0 space-y-6">
   {tab === 0 && <>
    <Card className="space-y-5 p-5"><div><h2 className="text-xl font-bold">01 · Из чего сделана подача донора</h2><p className="mt-2 text-muted-foreground">Добавьте 3–5 разрешённых референсов для более надёжного вывода. Можно начать с одного, но это разбор ролика, не доказательство ДНК всего канала. Ссылка сама по себе не анализирует видео.</p></div>
     <Field label="Канал-донор / ссылка"><Input value={w.channel} maxLength={1000} placeholder="Название или URL канала" onChange={e => update("channel", e.target.value)}/></Field>
     {w.refs.map((ref, i) => <section key={i} className="space-y-3 rounded-lg border p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-bold">Референс {i + 1}</h3>{w.refs.length > 1 && <Button variant="ghost" aria-label={`Удалить референс ${i + 1}`} onClick={() => update("refs", w.refs.filter((_, n) => n !== i))}><Trash2 className="h-4 w-4"/></Button>}</div><div className="grid gap-3 md:grid-cols-2">{(["title", "url"] as const).map(k => <Field key={k} label={k === "title" ? `Заголовок референса ${i + 1}` : `Ссылка референса ${i + 1}`}><Input value={ref[k]} maxLength={k === "url" ? 1000 : 300} placeholder={k === "url" ? "https://www.youtube.com/watch?v=…" : "Нужен для проверки повторения заголовков"} onChange={e => update("refs", w.refs.map((x, n) => n === i ? { ...x, [k]: e.target.value } : x))}/></Field>)}</div><Textarea label={`Транскрипт / разбор референса ${i + 1}`} rows={5} maxLength={30000} value={ref.transcript} placeholder="Вставьте транскрипт или подробный разбор с конкретными примерами. При необходимости получите субтитры в разделе «Транскрипты»." onChange={e => update("refs", w.refs.map((x, n) => n === i ? { ...x, transcript: e.target.value } : x))}/></section>)}
     <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={w.refs.length >= 5} onClick={() => update("refs", [...w.refs, { title: "", url: "", transcript: "" }])}><Plus className="h-4 w-4"/>Добавить референс</Button><a className="inline-flex min-h-11 items-center underline" href="/transcripts" target="_blank" rel="noreferrer">Открыть транскрипты</a></div>
     <details className="rounded-lg border p-4"><summary className="cursor-pointer font-semibold">Работаю через NotebookLM</summary><p className="my-3 text-sm text-muted-foreground">Загрузите референсы в свой NotebookLM вручную. Скопируйте запрос ниже, затем перенесите отчёт. Подключение к NotebookLM и автоматическая загрузка URL здесь не выполняются.</p><Button variant="outline" onClick={notebook}>Подготовить запросы NotebookLM</Button><Textarea className="mt-4" label="Отчёт NotebookLM по донору" value={w.notebookAnalysis} maxLength={20000} rows={6} onChange={e => update("notebookAnalysis", e.target.value)}/></details>
     <Button disabled={!w.refs.some(r => r.transcript.trim().length >= 200) && w.notebookAnalysis.trim().length < 100} onClick={() => start("analyze")}><Play className="h-4 w-4"/>Разобрать ДНК · AI</Button>
    </Card>
    <Card className="space-y-5 p-5"><h2 className="text-xl font-bold">Профиль подачи — можно заполнить вручную</h2><p className="text-muted-foreground">Не отрисовка персонажей и не тема ролика. Здесь фиксируем, почему зритель вовлекается. Для каждого поля нужны хотя бы 8 символов; неизвестное помечайте как гипотезу.</p><div className="grid gap-4 lg:grid-cols-2">{DNA_LABELS.map(([key, label, hint]) => <Textarea key={key} label={label} hint={hint} rows={3} maxLength={key === "evidence" ? 4000 : key === "pov" ? 1000 : ["hooks", "explanation", "avoid"].includes(key) ? 1600 : 1200} value={w.dna[key]} onChange={e => update("dna", { ...w.dna, [key]: e.target.value })}/>)}</div><div className="flex flex-wrap gap-3"><Button onClick={() => approve("dna")}>{current?.dna ? "Подтвердить ДНК повторно" : "Подтвердить ДНК"}</Button><Button variant="outline" disabled={!current?.dna} onClick={next}>К новым темам<ArrowRight className="h-4 w-4"/></Button></div></Card>
   </>}
   {tab === 1 && <Card className="space-y-5 p-5"><h2 className="text-xl font-bold">02 · Новая история, а не рерайт</h2><p className="text-muted-foreground">Сохраняем способ вовлечения. Меняем предмет, центральную проблему и примеры. Не обещаем, что автоматическая проверка обнаружит все смысловые заимствования.</p><Field label="Откуда берём направление"><Select aria-label="Откуда берём направление" value={w.mode} onChange={e => { setW(x => ({ ...x, mode: e.target.value as Work["mode"], selected: null, topicApproval: "", ideas: [] })); }}><option value="donor">Интересы аудитории донора → новые темы</option><option value="own">Моя идея → подача из ДНК</option></Select></Field><Textarea label={w.mode === "own" ? "Моя идея / направление" : "Уточнение направления (необязательно)"} rows={3} maxLength={1000} value={w.direction} placeholder="Например: у донора «Азбука финансов», моя идея — «Инвестирование». Нужны новые конфликты и примеры, а не замена слов." onChange={e => update("direction", e.target.value)}/><Button disabled={!current?.dna || (w.mode === "own" && w.direction.trim().length < 3)} onClick={() => start("ideas")}><Play className="h-4 w-4"/>Предложить 5 новых тем · AI</Button>
    {current && !current.dna && <p className="text-sm">Сначала подтвердите актуальную ДНК на шаге 01.</p>}
    <div className="grid gap-4 lg:grid-cols-2">{w.ideas.map((idea, i) => <article key={i} className="space-y-3 rounded-lg border p-5" data-testid="donor-idea"><p className="text-sm font-semibold text-primary">НОВАЯ ТЕМА 0{i + 1}</p><h3 className="text-lg font-bold">{idea.title}</h3><p>{idea.premise}</p><p className="text-sm"><b>Конфликт:</b> {idea.conflict}</p><p className="text-sm"><b>Развязка:</b> {idea.payoff}</p><p className="text-sm"><b>Почему не копия:</b> {idea.difference}</p><ul className="list-inside list-disc text-sm text-muted-foreground">{idea.questions.map((q, n) => <li key={n}>{q}</li>)}</ul><Button variant="outline" onClick={() => update("selected", structuredClone(idea))}>Выбрать тему {i + 1}</Button></article>)}</div>
    {w.ideas.length === 5 && <section className="space-y-4 rounded-lg border p-4" data-testid="donor-ideas-review">
      <h3 className="text-lg font-bold">Пять разных историй, а не пять заголовков</h3>
      <p>Отдельный AI-запрос, может быть платным: сравнение всех десяти пар и каждой темы с референсами. Не создаёт новые темы и не заменяет проверку автора.</p>
      <Button variant="outline" onClick={() => {setReviewBasis(ideasBasis); void ideasReview.start(w);}}>Проверить различия тем · AI</Button>
      {ideasReview.error && <ErrorAlert error={ideasReview.error}/>}
      {ideasReview.data && reviewBasis === ideasBasis && <div className="space-y-3" role="status"><p>{ideasReview.data.summary}</p><details><summary className="cursor-pointer py-3 font-semibold">Все 10 пар тем</summary><ul className="space-y-3">{ideasReview.data.pairs.map(x => <li key={`${x.left}-${x.right}`} className="rounded-lg border p-3"><b>Темы {x.left} и {x.right}: {x.verdict === "distinct" ? "различаются" : x.verdict === "similar" ? "есть повтор" : "нужна проверка"}</b><p>{x.reason}</p></li>)}</ul></details><details><summary className="cursor-pointer py-3 font-semibold">Отличия от донора</summary><ul className="space-y-3">{ideasReview.data.donor.map(x => <li key={x.idea} className="rounded-lg border p-3"><b>Тема {x.idea}: {x.verdict === "different" ? "есть отличия" : x.verdict === "similar" ? "есть сходство" : "недостаточно данных"}</b><p>{x.reason}</p></li>)}</ul></details><p className="text-sm text-muted-foreground">Мнение модели, не сертификат оригинальности. {ideasReview.data.model}. Отчёт текущей формы можно скопировать; в снимок маршрута он не входит.</p><CopyButton text={JSON.stringify(ideasReview.data,null,2)}/></div>}
      {ideasReview.data && reviewBasis !== ideasBasis && <p>Темы или референсы изменились. Предыдущий отчёт неактуален — проверьте заново.</p>}
    </section>}
    <Button variant="outline" onClick={() => update("selected", structuredClone(EMPTY_IDEA))}>Ввести свою конкретную тему</Button>
    {w.selected && <section className="space-y-4 rounded-lg border border-primary/40 p-4"><h3 className="text-lg font-bold">Выбранная тема — проверьте и уточните</h3>{([["title", "Заголовок новой темы", 200], ["premise", "Суть новой истории", 1400], ["difference", "Чем тема и конфликт отличаются от донора", 1400], ["conflict", "Проблема, попытка и цена решения", 1400], ["payoff", "Какую развязку обещаем", 1200]] as const).map(([k, label, max]) => <Textarea key={k} label={label} rows={k === "title" ? 2 : 3} value={w.selected![k]} maxLength={max} onChange={e => update("selected", { ...w.selected!, [k]: e.target.value })}/>)}<Textarea label="Вопросы для исследования (по одному в строке, минимум два)" rows={4} value={w.selected.questions.join("\n")} maxLength={2500} onChange={e => update("selected", { ...w.selected!, questions: e.target.value.split("\n").slice(0, 5) })}/><div className="flex flex-wrap gap-3"><Button disabled={!current?.dna} onClick={() => approve("topic")}>Подтвердить новую тему</Button><Button variant="outline" disabled={!current?.topic} onClick={next}>К исследованию<ArrowRight className="h-4 w-4"/></Button></div></section>}
   </Card>}
   {tab === 2 && <Card className="space-y-5 p-5"><h2 className="text-xl font-bold">03 · Фактическая опора новой темы</h2><p className="text-muted-foreground">Исследуем выбранную тему, не историю донора. Заполните вручную или перенесите результат NotebookLM. Автор проверяет качество источников; программа не подтверждает истинность вставленного текста.</p><p className="font-semibold">Тема: {w.selected?.title || "Ещё не выбрана"}</p><Button variant="outline" onClick={notebook}>Подготовить запросы NotebookLM</Button>
    {w.research.sources.map((source, i) => <section className="space-y-3 rounded-lg border p-4" key={i}><div className="flex items-center justify-between"><h3 className="font-bold">Источник {source.id}</h3><Button variant="ghost" aria-label={`Удалить источник ${source.id}`} onClick={() => update("research", { ...w.research, sources: w.research.sources.filter((_, n) => n !== i) })}><Trash2 className="h-4 w-4"/></Button></div>{(["title", "url", "excerpt"] as const).map(k => <Textarea key={k} rows={k === "excerpt" ? 4 : 2} maxLength={k === "excerpt" ? 5000 : k === "url" ? 1000 : 300} label={`${k === "title" ? "Название" : k === "url" ? "URL (необязательно)" : "Выдержка / страница / раздел"} · ${source.id}`} value={source[k]} onChange={e => update("research", { ...w.research, sources: w.research.sources.map((s, n) => n === i ? { ...s, [k]: e.target.value } : s) })}/>)}</section>)}
    <Button variant="outline" disabled={w.research.sources.length >= 20} onClick={() => { const n = Math.max(0, ...w.research.sources.map(s => +s.id.slice(1))) + 1; update("research", { ...w.research, sources: [...w.research.sources, { id: `R${n}`, title: "", url: "", excerpt: "" }] }); }}><Plus className="h-4 w-4"/>Добавить источник</Button>
    <Textarea label="Фактическая опора: утверждение → R# → подтверждение" rows={7} maxLength={16000} value={w.research.facts} onChange={e => update("research", { ...w.research, facts: e.target.value })} hint="Минимум 50 символов. Укажите существующие ID, например R1. Ссылка без выдержки не считается исследованием."/>
    <Textarea label="Спорные утверждения и пробелы" rows={4} maxLength={6000} value={w.research.uncertain} onChange={e => update("research", { ...w.research, uncertain: e.target.value })}/><Textarea label="Допустимая реконструкция / условные примеры" rows={4} maxLength={4000} value={w.research.reconstruction} placeholder="Безымянный герой, бытовая попытка, комедийная реакция. Для финансов — условный инвестор и расчёт, не реальный кейс без доказательств." onChange={e => update("research", { ...w.research, reconstruction: e.target.value })}/><Textarea label="Границы и обязательные уточнения" rows={3} maxLength={3000} value={w.research.boundaries} onChange={e => update("research", { ...w.research, boundaries: e.target.value })}/><Button variant="outline" disabled={!current?.topic} onClick={next}>К драматургии<ArrowRight className="h-4 w-4"/></Button>
   </Card>}
   {tab === 3 && <Card className="space-y-5 p-5"><h2 className="text-xl font-bold">04 · Герой пытается — мир отвечает — зритель понимает</h2><p className="text-muted-foreground">Не иллюстрированная лекция. План должен связывать эмоцию, объяснение и действие. Карты, схемы и спокойные паузы допустимы, если обслуживают вопрос истории.</p><div className="grid gap-4 sm:grid-cols-2"><Field label="Язык сценария"><Select aria-label="Язык сценария" value={w.language} onChange={e => update("language", e.target.value)}>{[["ru", "Русский"], ["en", "English"], ["uk", "Українська"], ["es", "Español"], ["de", "Deutsch"], ["fr", "Français"], ["pt", "Português"], ["pl", "Polski"]].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Объём сценария, слов"><Input type="number" min={100} max={5000} value={w.words} onChange={e => update("words", Math.max(100, Math.min(5000, +e.target.value || 100)))}/></Field></div><Button disabled={!current?.research} onClick={() => start("outline")}><Play className="h-4 w-4"/>Подготовить драматургию · AI</Button>{current && !current.research && <p className="text-sm">Нужны подтверждённые ДНК и тема, хотя бы один источник с выдержкой и фактическая опора с R#.</p>}
    <Textarea label="План истории — можно написать или исправить вручную" rows={14} maxLength={16000} value={w.outline} onChange={e => update("outline", e.target.value)} hint="Для каждого сюжетного блока: цель → препятствие → попытка → последствие → реакция → объяснение. Укажите R# для фактов и условность реконструкций. Не нужны промпты изображений в озвучке."/>
    {w.outlineChecks.length > 0 && <section className="rounded-lg border p-4"><h3 className="font-semibold">Замечания модели — не автоматический фактчекинг</h3><ul className="mt-2 list-inside list-disc space-y-2 text-sm">{w.outlineChecks.map((c, i) => <li key={i}>{c}</li>)}</ul></section>}
    {current && w.outline.length >= 100 && w.outlineBasis !== current.keys.research && <div className="space-y-3 rounded-lg border p-4"><p className="text-sm">План написан вручную или изменились материалы. Проверьте, что он соответствует текущей теме, фактам, языку и объёму.</p><Button variant="outline" disabled={!current?.research} onClick={() => { if (confirm("Подтверждаете, что вручную адаптировали план к текущим материалам и объёму?"))
            update("outlineBasis", current!.keys.research); }}>План адаптирован к текущим материалам</Button></div>}
    <section className="rounded-lg border p-4 text-sm"><h3 className="mb-3 font-bold">Перед утверждением проверьте</h3><ul className="list-inside list-disc space-y-2"><li>Новая тема и центральная проблема; нет рерайта донора.</li><li>Цель и цена ошибки понятны, решения вызывают последствия.</li><li>Юмор и эмпатия работают, объяснение не гасит историю.</li><li>Ключевые факты имеют опору; выдумка не меняет реальное событие.</li><li>В action-блоках событие остаётся даже при неподвижной камере.</li><li>Финал отвечает на обещание, а не обрывается справкой.</li></ul></section>
    <div className="flex flex-wrap gap-3"><Button disabled={!current?.research || w.outlineBasis !== current?.keys.research || w.outline.trim().length < 100} onClick={() => approve("outline")}>Утвердить драматургию</Button><Button variant="outline" disabled={!current?.ready} onClick={() => act(async () => { const id = await save(); nav(`/script?donorBrief=${encodeURIComponent(id)}`); })}>Открыть сценарист с брифом<ArrowRight className="h-4 w-4"/></Button></div>
    <p className="text-sm text-muted-foreground">Переход сохраняет неизменяемый снимок. В сценаристе нужно отдельно применить бриф и запустить генерацию. Источники и план передаются целиком. Озвучка остаётся чистой; исследование хранится в снимке. Визуальный стиль выбирается отдельно в библиотеке. Этот раздел не генерирует изображения, видео и не меняет движок монтажа.</p>
   </Card>}
   {prompts && <Card className="space-y-5 p-5"><h2 className="text-xl font-bold">Запросы для ручной работы в NotebookLM</h2>{(["analysis", "research"] as const).map(k => <section className="space-y-3" key={k}><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold">{k === "analysis" ? "Разбор донора" : "Исследование новой темы"}</h3><CopyButton text={prompts[k]}/></div><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-4 font-sans text-sm">{prompts[k]}</pre></section>)}</Card>}
  </fieldset>
  <details className="rounded-lg border p-4"><summary className="cursor-pointer font-semibold">Сохранённые снимки и удаление</summary><p className="my-3 text-sm text-muted-foreground">Каждое сохранение создаёт новую версию. Лимит — 50 снимков / 12 МБ. Экспортируйте открытый снимок перед удалением. Удаление не меняет уже готовые сценарии, но их повторная генерация по удалённому ID станет недоступна.</p><div className="space-y-2">{snapshots.data?.map(s => <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"><span className="min-w-0 flex-1">{s.name} · {new Date(s.createdAt).toLocaleString()}</span><Button variant="danger" disabled={busy} onClick={() => { if (confirm(`Удалить снимок «${s.name}»? Операцию нельзя отменить.`))
        void act(async () => { await api(`/donor-workflow/snapshots/${s.id}`, { method: "DELETE" }); await snapshots.refetch(); }); }}>Удалить снимок</Button></div>)}</div></details>
 </div>;
}
