// Выпуск 1: сценарий канала — донор → черновик → проверка кодом → второе мнение → правка автором → проверка фактов.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PenLine } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import type { Project } from "@/lib/types";
import { Button, Card, CopyButton, ErrorAlert, Input, Label, SectionTitle, Switch, Textarea, ToolHeader } from "@/components/ui";
import { ChannelPicker, CriticView, FactCheckView, JobBox, LintReportView, NeedChannel, useActiveChannel } from "@/features/studio/common";
import type { FactCheckJobResult, LintReport, StudioScriptResult } from "@/features/studio/types";

type Form = { topic: string; angle: string; donorUrl: string; minutes: string; research: boolean; critic: boolean; factCheck: boolean; notes: string };
const EMPTY: Form = { topic: "", angle: "", donorUrl: "", minutes: "", research: true, critic: true, factCheck: true, notes: "" };

/** Сохранённый результат из проекта (после перезагрузки страницы или со страницы идей). */
function fromProject(p: Project): { form: Partial<Form>; result: StudioScriptResult | null } {
  const topic = [...p.artifacts].reverse().find((a) => a.kind === "topic");
  const t = (topic?.data ?? {}) as { url?: string; sourceTitle?: string; version?: { title?: string; angle?: string } | null };
  const form: Partial<Form> = topic ? { topic: t.version?.title || p.title, angle: t.version?.angle ?? "", donorUrl: t.url ?? "" } : { topic: p.title };
  const art = [...p.artifacts].reverse().find((a) => a.kind === "script" && (a.data as { studio?: unknown } | undefined)?.studio);
  if (!art) return { form, result: null };
  const d = art.data as { script: string; studio: Omit<StudioScriptResult, "projectId" | "artifactId" | "title" | "script"> };
  return { form, result: { ...d.studio, draft: d.studio.draft ?? d.script, lintDraft: d.studio.lintDraft ?? d.studio.lint, projectId: p.id, artifactId: art.id, title: art.title, script: d.script } };
}

export default function StudioScript() {
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const projectId = sp.get("project");
  const { channel, list, loading } = useActiveChannel();
  const [form, setForm] = useState<Form>(EMPTY);
  const [result, setResult] = useState<StudioScriptResult | null>(null);
  const [text, setText] = useState("");
  const [lint, setLint] = useState<LintReport | null>(null);
  const [own, setOwn] = useState(""), [ownReport, setOwnReport] = useState<LintReport | null>(null);
  const project = useQuery({ queryKey: ["project", projectId], queryFn: () => api<Project>(`/projects/${projectId}`), enabled: !!projectId, retry: false, refetchOnWindowFocus: false });
  useEffect(() => {
    if (!project.data) return;
    const r = fromProject(project.data);
    setForm((f) => ({ ...f, ...r.form }));
    if (r.result) { setResult(r.result); setText(r.result.script); setLint(r.result.lint); }
  }, [project.data?.id, project.data?.updatedAt]);
  const job = useJob<StudioScriptResult>("/studio/script");
  useEffect(() => {
    if (job.status !== "done" || !job.data) return;
    setResult(job.data); setText(job.data.script); setLint(job.data.lint);
    setSp({ project: job.data.projectId }, { replace: true });
    for (const k of ["projects", "usage", "studio-channels"]) void qc.invalidateQueries({ queryKey: [k] });
  }, [job.status, job.data]);
  const save = useMutation({
    mutationFn: () => api<{ lint: LintReport }>("/studio/script/save", { method: "POST", json: { projectId: result!.projectId, artifactId: result!.artifactId, script: text } }),
    onSuccess: (r) => { setLint(r.lint); setResult((x) => x && { ...x, script: text, lint: r.lint }); void qc.invalidateQueries({ queryKey: ["project", result?.projectId] }); },
  });
  const check = useMutation({ mutationFn: () => api<LintReport>("/studio/script/lint", { method: "POST", json: { text: own, channelId: channel?.id } }), onSuccess: setOwnReport });
  // Проверка фактов сценария проекта: исправленный текст сохраняется в проект и подставляется в редактор.
  const fc = useJob<FactCheckJobResult>("/studio/script/factcheck");
  useEffect(() => {
    if (fc.status !== "done" || !fc.data?.projectId) return;
    const d = fc.data;
    setResult((x) => x && x.projectId === d.projectId ? { ...x, script: d.script, lint: d.lint, factCheck: d.report, beforeFacts: d.beforeFacts } : x);
    setText(d.script); setLint(d.lint);
    for (const k of [["project", d.projectId], ["usage"], ["studio-channels"]]) void qc.invalidateQueries({ queryKey: k });
  }, [fc.status, fc.data]);
  const ownFc = useJob<FactCheckJobResult>("/studio/script/factcheck");
  const minutes = Number(form.minutes) || channel?.lengthMin || 10;
  const dirty = !!result && text !== result.script;
  const running = job.status === "running", checking = fc.status === "running";
  const start = () => channel && job.start({
    channelId: channel.id, ...(projectId ? { projectId } : {}), topic: form.topic.trim(), angle: form.angle.trim(), donorUrl: form.donorUrl.trim(),
    minutes, research: form.research, critic: form.critic, factCheck: form.factCheck, notes: form.notes.trim(),
  }, undefined, { serverConsent: true });
  const checkFacts = async () => {
    if (!result || !channel) return;
    if (dirty) { try { await save.mutateAsync(); } catch { return; } }
    void fc.start({ channelId: channel.id, projectId: result.projectId, artifactId: result.artifactId }, undefined, { serverConsent: true });
  };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const words = useMemo(() => text.trim() ? text.trim().split(/\s+/).length : 0, [text]);

  if (loading) return null;
  if (!list?.channels.length || !channel) return <div className="space-y-6"><ToolHeader icon={PenLine} title="Сценарий" eyebrow="// ВЫПУСК 1" subtitle="Сценарий под ваш канал с проверкой и вторым мнением" /><NeedChannel /></div>;
  return <div className="space-y-6" data-testid="studio-script">
    <ToolHeader icon={PenLine} title="Сценарий" eyebrow="// ВЫПУСК 1" subtitle="Текст под профиль канала: структура образца, ваш угол, проверка кодом и второе мнение другой модели" right={<ChannelPicker disabled={running} />} />
    {project.error && <ErrorAlert error={project.error} />}
    <Card className="space-y-4 p-5">
      <SectionTitle>{projectId && project.data ? `Проект: ${project.data.title}` : "Новый сценарий"}</SectionTitle>
      <label className="block space-y-1"><Label required>Тема</Label><Input value={form.topic} maxLength={1000} onChange={(e) => set("topic", e.target.value)} placeholder="Например: Почему мы доверяем уверенным людям" dir="auto" /></label>
      <Textarea label="Ваша версия / угол" hint="Чем ваш ролик отличается от образца. Из Радара подставляется сама." value={form.angle} maxLength={2000} onChange={(e) => set("angle", e.target.value)} className="min-h-[72px]" />
      <div className="grid gap-4 md:grid-cols-[1fr_160px]">
        <label className="block space-y-1"><Label hint="необязательно">Ролик-образец на YouTube</Label><Input value={form.donorUrl} maxLength={500} onChange={(e) => set("donorUrl", e.target.value)} placeholder="https://www.youtube.com/watch?v=…" /></label>
        <label className="block space-y-1"><Label hint="минут">Длина</Label><Input type="number" min={1} max={120} value={form.minutes} placeholder={String(channel.lengthMin)} onChange={(e) => set("minutes", e.target.value)} /></label>
      </div>
      <p className="text-xs text-muted-foreground">Из образца берутся структура, темп и приёмы — не текст. Слова пишутся заново под ваш канал «{channel.name}».</p>
      <div className="grid gap-2 md:grid-cols-2">
        <Switch checked={form.research} onChange={(v) => set("research", v)} label="Сбор фактов перед текстом (ресёрч)" description="Перед текстом модель ищет факты по теме и спорные места." />
        <Switch checked={form.critic} onChange={(v) => set("critic", v)} label="Второе мнение" description="Модель другой семьи оценивает текст по 10 вопросам, автор правит." />
        <Switch checked={form.factCheck} onChange={(v) => set("factCheck", v)} label="Проверка фактов готового текста" description="Каждая цифра, дата, имя, причина и следствие проверяются поиском Google; неверное исправляется, непроверяемое убирается." />
      </div>
      <Textarea label="Заметки для сценариста" value={form.notes} maxLength={8000} onChange={(e) => set("notes", e.target.value)} className="min-h-[64px]" />
      <div className="flex flex-wrap items-center gap-3">
        <Button className="min-h-11" disabled={running || form.topic.trim().length < 3} loading={running} loadingText="Пишу…" onClick={() => void start()}>{result ? "Написать заново" : "Написать сценарий"}</Button>
        <p className="text-sm text-muted-foreground">Платно: тратит баланс AnyModel, действует месячный лимит. ≈ {minutes} мин ролика.</p>
      </div>
    </Card>
    <JobBox job={job} onCancel={() => void job.cancel()} note="Сценарий на 10 минут пишется 3–6 минут. Готовые этапы сохраняются в проект." />
    {result && <>
      <Card className="space-y-3 p-5" data-testid="script-result">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold" dir="auto">{result.title}</h2>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={text} />
            <Link to={`/studio/voice?project=${result.projectId}`} className="inline-flex min-h-11 items-center rounded-md border border-primary/50 px-3 text-sm text-primary hover:bg-primary/10">Озвучить →</Link>
            <Link to={`/projects/${result.projectId}`} className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-muted">Проект</Link>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">Автор: {result.models.author}{result.models.critic ? ` · критик: ${result.models.critic}` : ""}{result.revised ? " · текст исправлен по замечаниям" : ""} · {words.toLocaleString("ru-RU")} слов</p>
        {result.notes.map((n, i) => <p key={i} className="text-sm text-crown">{n}</p>)}
        <textarea aria-label="Текст сценария" className="field min-h-[420px] w-full resize-y leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} dir="auto" readOnly={checking} />
        {dirty && !!result.beforeFacts && text === result.beforeFacts && <p className="text-sm text-crown">В редакторе текст до проверки фактов. Нажмите «Сохранить правку и проверить», чтобы оставить его.</p>}
        {save.error && <ErrorAlert error={save.error} />}
        <div className="flex flex-wrap gap-3">
          <Button className="min-h-11" disabled={!dirty || checking} loading={save.isPending} loadingText="Сохраняю…" onClick={() => save.mutate()}>Сохранить правку и проверить</Button>
          {dirty && <Button className="min-h-11" variant="ghost" disabled={checking} onClick={() => setText(result.script)}>Отменить правку</Button>}
        </div>
      </Card>
      <JobBox job={fc} onCancel={() => void fc.cancel()} note="Проверка фактов 10-минутного сценария занимает 1–3 минуты." />
      <FactCheckView report={result.factCheck} text={text} rechecking={checking} onRecheck={running ? undefined : () => void checkFacts()}
        onRestore={result.beforeFacts && text !== result.beforeFacts && !checking ? () => setText(result.beforeFacts!) : undefined} />
      {lint && <LintReportView report={lint} />}
      {result.critic && <CriticView critic={result.critic} after={result.criticAfter} />}
      {result.donor && <Card className="space-y-2 p-5 text-sm"><details><summary className="min-h-11 cursor-pointer py-2 font-semibold">Разбор образца: {result.donor.title} · {result.donor.channel}</summary>
        <div className="space-y-2 pt-2">
          <p><b>Хук:</b> {result.donor.hook}</p>
          <p><b>Структура:</b></p><ol className="list-decimal pl-5">{result.donor.structure.map((s, i) => <li key={i}>{s}</li>)}</ol>
          {result.donor.devices.length > 0 && <p><b>Приёмы:</b> {result.donor.devices.join("; ")}</p>}
          <p><b>Темп:</b> {result.donor.pacing}</p><p><b>Финал:</b> {result.donor.ending}</p>
          {result.donor.avoid.length > 0 && <p><b>Не повторять:</b> {result.donor.avoid.join("; ")}</p>}
        </div></details></Card>}
      {result.revised && result.draft && <Card className="p-5 text-sm"><details><summary className="min-h-11 cursor-pointer py-2 font-semibold">Черновик до правки</summary><pre className="whitespace-pre-wrap pt-2 font-sans text-muted-foreground" dir="auto">{result.draft}</pre></details></Card>}
    </>}
    <Card className="space-y-3 p-5">
      <SectionTitle>Проверить свой текст — бесплатно</SectionTitle>
      <p className="text-sm text-muted-foreground">Проверка кодом, без ИИ: вступление, оговорки, повторы, ложные финалы, длина фраз и время озвучки — с номером абзаца.</p>
      <textarea aria-label="Свой текст для проверки" className="field min-h-[160px] w-full resize-y" value={own} onChange={(e) => setOwn(e.target.value)} placeholder="Вставьте сценарий. Абзацы разделяйте пустой строкой." dir="auto" />
      {check.error && <ErrorAlert error={check.error} />}
      <div className="flex flex-wrap items-center gap-3">
        <Button className="min-h-11" variant="outline" disabled={!own.trim()} loading={check.isPending} loadingText="Проверяю…" onClick={() => check.mutate()}>Проверить</Button>
        <Button className="min-h-11" variant="outline" disabled={own.trim().split(/\s+/).length < 5 || ownFc.status === "running"} loading={ownFc.status === "running"} loadingText="Проверяю факты…" onClick={() => void ownFc.start({ channelId: channel.id, text: own }, undefined, { serverConsent: true })}>Проверить факты — платно</Button>
      </div>
      <p className="text-xs text-muted-foreground">Проверка фактов ищет каждое утверждение в Google через AnyModel и возвращает исправленный текст; тратит баланс AnyModel.</p>
    </Card>
    {ownReport && <LintReportView report={ownReport} title="Проверка вашего текста" />}
    <JobBox job={ownFc} onCancel={() => void ownFc.cancel()} />
    {ownFc.status === "done" && ownFc.data && <>
      <FactCheckView report={ownFc.data.report} />
      <Card className="space-y-3 p-5" data-testid="fact-fixed-text">
        <SectionTitle right={<CopyButton text={ownFc.data.script} />}>Исправленный текст</SectionTitle>
        <textarea aria-label="Исправленный текст" readOnly className="field min-h-[220px] w-full resize-y" value={ownFc.data.script} dir="auto" />
        {ownFc.data.script !== own && <Button className="min-h-11" variant="outline" onClick={() => setOwn(ownFc.data!.script)}>Заменить мой текст исправленным</Button>}
      </Card>
    </>}
  </div>;
}
