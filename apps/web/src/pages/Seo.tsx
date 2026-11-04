import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FolderOpen, Hash, MessageSquarePlus, Play, Search, Tags, Type, X, XCircle, AlignLeft } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { useDraft } from "@/lib/draft";
import { takeHandoff } from "@/lib/handoff";
import { CONTENT_LANGUAGES } from "@/lib/constants";
import { useSettings } from "@/lib/queries";
import type { Project, ProjectSummary, SeoInputT, SeoResult, SeoTag } from "@/lib/types";
import { Badge, Button, Card, CopyButton, EmptyState, ErrorAlert, Input, Label, ProgressBar, Select, Textarea, ToolHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

const TRIG: Record<string, [string, string]> = { curiosity: ["Любопытство", "bg-sky-500/15 text-sky-300 border-sky-500/30"], urgency: ["Срочность", "bg-red-500/15 text-red-300 border-red-500/30"], emotion: ["Эмоция", "bg-pink-500/15 text-pink-300 border-pink-500/30"], authority: ["Авторитет", "bg-amber-500/15 text-amber-300 border-amber-500/30"], belonging: ["Сопричастность", "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"] };
const COMMENT: Record<string, string> = { controversial: "Спорное мнение", sensory: "Сенсорный хук", challenge: "Сценарий-вызов" };
const GROUP: Record<SeoTag["group"], string> = { primary: "Основные теги", secondary: "Вторичные теги", longTail: "Long-tail" };
const INIT: SeoInputT = { niche: "", script: "", language: "ru" };
/** Длина тегов как в YouTube: через запятую, теги с пробелом считаются в кавычках */
const tagsLen = (t: string[]) => t.reduce((s, x, i) => s + x.length + (/\s/.test(x) ? 2 : 0) + (i ? 1 : 0), 0);

function Block({ icon: I, title, copy, right, children }: { icon: typeof Type; title: string; copy?: string | (() => string); right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2"><I className="h-4 w-4 text-primary" /><h3 className="flex-1 font-semibold">{title}</h3>{right}{copy && <CopyButton text={copy} />}</div>
      {children}
    </Card>
  );
}

export default function Seo() {
  const [sp] = useSearchParams();
  const qc = useQueryClient();
  const settings = useSettings();
  const [f, setF] = useDraft<SeoInputT>("seo", INIT);
  const set = <K extends keyof SeoInputT>(k: K, v: SeoInputT[K]) => setF((x) => ({ ...x, [k]: v }));
  const job = useJob<SeoResult, SeoInputT>("/seo");
  const [res, setRes] = useState<SeoResult | null>(null);
  const [tags, setTags] = useState<SeoTag[]>([]);
  const [pickProject, setPickProject] = useState("");
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<ProjectSummary[]>("/projects") });
  const withScripts = (projects.data ?? []).filter((p) => p.counts?.script);

  // сценарий из сценариста (handoff) / открытие сохранённого пакета из проекта
  const [kw, setKw] = useState<string[]>(() => { try { const v = sessionStorage.getItem("ts:seo-keywords"); return v ? JSON.parse(v) : []; } catch { return []; } });
  useEffect(() => {
    const h = takeHandoff();
    if (h?.text) setF((x) => ({ ...x, script: h.text, language: h.language ?? x.language, projectId: h.projectId }));
    else if (sp.get("projectId") && !sp.get("artifact")) set("projectId", sp.get("projectId")!);
  }, []); // eslint-disable-line
  useEffect(() => { if (settings.data && !localStorage.getItem("ts:draft:seo")) set("language", settings.data.contentLanguage); }, [settings.data]); // eslint-disable-line
  const art = useQuery({ queryKey: ["project", sp.get("projectId")], queryFn: () => api<Project>(`/projects/${sp.get("projectId")}`), enabled: !!sp.get("projectId") && !!sp.get("artifact") });
  useEffect(() => { const a = art.data?.artifacts.find((x) => x.id === sp.get("artifact")); if (a?.data) { const d = a.data as SeoResult; if (d.input) setF((x) => ({ ...x, niche: d.input.niche ?? "", language: d.input.language ?? x.language, projectId: art.data!.id })); setRes({ ...d, projectId: art.data!.id, artifactId: a.id }); setTags(d.tags); } }, [art.data]); // eslint-disable-line
  useEffect(() => { if (job.data) { setRes(job.data); setTags(job.data.tags); qc.invalidateQueries({ queryKey: ["projects"] }); } }, [job.data]); // eslint-disable-line

  const loadFromProject = async (id: string) => {
    setPickProject(id); if (!id) return;
    const p = await api<Project>(`/projects/${id}`);
    const s = [...p.artifacts].reverse().find((a) => a.kind === "script");
    const d = s?.data as { script?: string; input?: { language?: string } } | undefined;
    if (d?.script) setF((x) => ({ ...x, script: d.script!.slice(0, 20000), language: d.input?.language ?? x.language, projectId: p.id, niche: x.niche || p.niche || "" }));
  };

  const selected = tags.filter((t) => t.selected).map((t) => t.tag);
  const tLen = tagsLen(selected);
  const ltCount = tags.filter((t) => t.selected && t.group === "longTail").length;
  const allText = useMemo(() => !res ? "" : [
    "ЗАГОЛОВКИ", ...res.titles.map((t, i) => `${i + 1}. ${t.title}`), "", "ОПИСАНИЕ", res.description.full, "", "ХЭШТЕГИ", res.hashtags.join(" "), "", "ТЕГИ", selected.join(", "), "",
    "КОММЕНТАРИИ ДЛЯ ЗАКРЕПА", ...res.pinnedComments.map((c) => `[${COMMENT[c.type] ?? c.type}] ${c.text}`)].join("\n"), [res, selected]);
  const valid = f.script.trim().length >= 200;
  const submit = () => valid && job.start({ ...f, script: f.script.trim(), niche: f.niche?.trim() || undefined, keywords: kw.length ? kw : undefined });

  return (
    <div>
      <ToolHeader icon={Search} title="SEO" eyebrow="// SEO" subtitle="Заголовки с триггерами, описание с таймкодами, хэштеги, теги ≤ 500 символов и комментарии для закрепа" />
      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card brackets className="h-fit p-5">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div>
              <Label hint="необязательно" counter={`${f.niche?.length ?? 0}/500`}>Ниша</Label>
              <Input value={f.niche ?? ""} maxLength={500} onChange={(e) => set("niche", e.target.value)} placeholder="Странная история быта, научпоп" />
            </div>
            <div>
              <Label hint={<Link to="/keywords" className="underline">подобрать в «Ключевых словах»</Link>}>Целевые ключи</Label>
              <Input data-testid="seo-keywords" value={kw.join(", ")} onChange={(e) => { const v = e.target.value.split(",").map((x) => x.trimStart()).slice(0, 30); setKw(v); sessionStorage.setItem("ts:seo-keywords", JSON.stringify(v.filter((x) => x.trim()))); }} placeholder="Выбранные целевые фразы, через запятую" />
            </div>
            <div>
              <Label>Взять из проекта</Label>
              <Select value={pickProject} onChange={(e) => loadFromProject(e.target.value)}>
                <option value="">{withScripts.length ? "— выберите проект со сценарием —" : "Нет проектов со сценарием"}</option>
                {withScripts.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </Select>
            </div>
            <Textarea label="Сценарий" required value={f.script} maxLength={20000} rows={12} onChange={(e) => set("script", e.target.value)} placeholder="Вставьте текст сценария (минимум 200 символов)" />
            {f.projectId && <p className="-mt-2 text-xs text-muted-foreground">Пакет сохранится в <Link className="underline" to={`/projects/${f.projectId}`}>проект</Link> · <button type="button" className="underline" onClick={() => set("projectId", undefined)}>отвязать</button></p>}
            <div><Label>Язык</Label><Select value={f.language} onChange={(e) => set("language", e.target.value)}>{CONTENT_LANGUAGES.map((l) => <option key={l.value} value={l.value} lang={l.value} dir="auto">{l.label}</option>)}</Select></div>
            {job.status === "running" ? (
              <div className="space-y-3"><ProgressBar value={job.pct} label={job.stage} /><Button type="button" variant="danger" onClick={job.cancel}><X className="h-4 w-4" />Остановить</Button></div>
            ) : <Button type="submit" size="lg" className="w-full" disabled={!valid}><Play className="h-4 w-4" />Собрать SEO-пакет</Button>}
            {job.status === "error" && <ErrorAlert error={job.error} onRetry={submit} />}
          </form>
        </Card>

        <div className="min-w-0 space-y-4">
          {!res ? <Card className="p-10"><EmptyState icon={<Search className="h-8 w-8" />} title="Здесь появится SEO-пакет">Вставьте сценарий или возьмите его из проекта. Сборка ≈ 15–30 секунд.</EmptyState></Card> : (<>
            <Card className="flex flex-wrap items-center gap-2 p-3 text-sm">
              <span className="text-muted-foreground">Ключевая фраза:</span><Badge tone="primary">{res.keyword}</Badge>
              <span className="text-muted-foreground">· ≈ {res.minutes} мин</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">{res.model}</span>
              {res.projectId && <Link className="text-xs underline" to={`/projects/${res.projectId}`}><FolderOpen className="mr-1 inline h-3.5 w-3.5" />в проекте</Link>}
            </Card>

            <p className="text-sm text-muted-foreground">Это предложения модели, не проверка фактов или поискового спроса. Перед публикацией сверяйте заголовки, описание и комментарии со сценарием и источниками.</p>

            <Block icon={Type} title="5 заголовков" copy={() => res.titles.map((t) => t.title).join("\n")}>
              <ul className="space-y-3">
                {res.titles.map((t, i) => (
                  <li key={i} className="rounded-md border p-3">
                    <div className="flex items-start gap-2">
                      <span className="flex-1 text-[15px] font-medium">{t.title}</span>
                      <span className={cn("shrink-0 font-mono text-xs", t.level === "ok" ? "text-muted-foreground" : t.level === "warn" ? "text-crown" : "text-accent")} title="≤ 70 — ок, ≤ 100 — предел YouTube">{t.length}/70</span>
                      <CopyButton label="" text={t.title} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {t.triggers.map((x) => <span key={x} className={cn("rounded-full border px-2 py-0.5 text-[11px]", TRIG[x]?.[1])}>{TRIG[x]?.[0] ?? x}</span>)}
                      <span className="rounded-full border border-primary/40 px-2 py-0.5 font-mono text-[11px] text-primary">{t.hookWord}</span>
                    </div>
                    <p className="mt-1.5 text-sm text-muted-foreground">{t.why}</p>
                  </li>
                ))}
              </ul>
            </Block>

            <Block icon={AlignLeft} title="Описание" copy={res.description.full} right={<span className="font-mono text-xs text-muted-foreground">{res.description.full.length}/5000</span>}>
              <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm leading-relaxed">{res.description.full}</div>
            </Block>

            <div className="grid gap-4 lg:grid-cols-2">
              <Block icon={Hash} title="Хэштеги" copy={res.hashtags.join(" ")}>
                <div className="flex flex-wrap gap-1.5">{res.hashtags.map((h) => <span key={h} className="rounded-full border px-2.5 py-1 text-sm text-sky-300">{h}</span>)}</div>
                <p className="mt-2 text-xs text-muted-foreground">Первые 3 показываются над заголовком видео.</p>
              </Block>
              <Block icon={CheckCircle2} title="Проверки">
                <ul className="space-y-1.5">{res.checks.map((c) => <li key={c.text} className="flex gap-2 text-sm">{c.level === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : c.level === "warn" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-crown" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />}{c.text}</li>)}</ul>
              </Block>
            </div>

            <Block icon={Tags} title="Теги" copy={() => selected.join(", ")} right={<span className={cn("font-mono text-xs", tLen > 500 ? "text-accent" : "text-muted-foreground")}>{tLen}/500</span>}>
              <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full", tLen > 500 ? "bg-accent" : "bg-primary")} style={{ width: `${Math.min(100, (tLen / 500) * 100)}%` }} /></div>
              {(["primary", "secondary", "longTail"] as const).map((g) => (
                <div key={g} className="mb-3 last:mb-0">
                  <div className="mb-1.5 flex items-center gap-2"><span className="mono-label text-muted-foreground">{GROUP[g]}</span>
                    {g === "longTail" && <span className={cn("text-[11px]", ltCount > 3 ? "text-crown" : "text-muted-foreground")}>рекомендуем не больше 2–3 · выбрано {ltCount}</span>}
                    <CopyButton label="" text={() => tags.filter((t) => t.group === g).map((t) => t.tag).join(", ")} /></div>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.filter((t) => t.group === g).map((t) => (
                      <button key={t.tag} type="button" onClick={() => setTags((xs) => xs.map((x) => x.tag === t.tag ? { ...x, selected: !x.selected } : x))}
                        className={cn("rounded-full border px-2.5 py-1 text-sm transition", t.selected ? "border-primary/60 bg-primary/15 text-foreground" : "border-border text-muted-foreground line-through decoration-muted-foreground/50")}>{t.tag}</button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="mt-2 text-xs text-muted-foreground">Нажмите на тег, чтобы включить/исключить его из итогового набора. «Копировать» копирует только включённые.</p>
            </Block>

            <Block icon={MessageSquarePlus} title="3 комментария для закрепа" copy={() => res.pinnedComments.map((c) => c.text).join("\n\n")}>
              <ul className="space-y-3">{res.pinnedComments.map((c, i) => (
                <li key={i} className="rounded-md border p-3"><div className="mb-1.5 flex items-center gap-2"><Badge>{COMMENT[c.type] ?? c.type}</Badge><span className="flex-1" /><CopyButton label="" text={c.text} /></div><p className="text-sm">{c.text}</p></li>
              ))}</ul>
            </Block>

            <div className="flex justify-end"><CopyButton label="Копировать всё" text={allText} className="rounded-md border px-4 py-2" /></div>
          </>)}
        </div>
      </div>
    </div>
  );
}
