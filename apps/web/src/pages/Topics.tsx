import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Lightbulb, Play, RefreshCw, Save, Trash2, TriangleAlert, X } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import { useDraft } from "@/lib/draft";
import { ago, compact } from "@/lib/format";
import { CONTENT_LANGUAGES } from "@/lib/constants";
import { useSettings } from "@/lib/queries";
import type { TopicInput, TopicRun } from "@/lib/types";
import { Badge, Button, Card, Chip, CopyButton, ErrorAlert, Input, Label, ProgressBar, SectionTitle, Select, Skeleton, Switch, Textarea, ToolHeader } from "@/components/ui";
import { TopicCard, topicText } from "@/features/topics/TopicCard";

type Style = { id: string; name: string; hint: string };
type Template = { id: string; name: string; keywords: string; nicheDescription: string; style?: string; customStyle?: string };
const INIT: TopicInput = { keywords: "", nicheDescription: "", count: 10, format: "long", minutes: 12, language: "ru", style: "custom", customStyle: "", useYouTube: true, force: false };
const COMP_RU = { low: "низкая", medium: "средняя", high: "высокая" } as const;

export default function Topics() {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const runId = sp.get("run");
  const settings = useSettings();
  const [f, setF] = useDraft<TopicInput>("topics", INIT);
  const set = <K extends keyof TopicInput>(k: K, v: TopicInput[K]) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => { if (settings.data && !localStorage.getItem("ts:draft:topics")) set("language", settings.data.contentLanguage); }, [settings.data]); // eslint-disable-line

  const styles = useQuery({ queryKey: ["topic-styles"], queryFn: () => api<Style[]>("/topics/styles"), staleTime: Infinity });
  const templates = useQuery({ queryKey: ["topic-templates"], queryFn: () => api<Template[]>("/topics/templates") });
  const runs = useQuery({ queryKey: ["topic-runs"], queryFn: () => api<{ id: string; createdAt: string; keywords: string; count: number }[]>("/topics/runs") });
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => api<{ youtubeToday: number }>("/usage") });
  const job = useJob<TopicRun, TopicInput>("/topics");
  const opened = useQuery({ queryKey: ["topic-run", runId], queryFn: () => api<TopicRun>(`/topics/runs/${runId}`), enabled: !!runId && job.status !== "running" && job.data?.id !== runId });

  const saveTpl = useMutation({
    mutationFn: (name: string) => api("/topics/templates", { method: "POST", json: { name, keywords: f.keywords, nicheDescription: f.nicheDescription, style: f.style, customStyle: f.customStyle } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["topic-templates"] }),
  });
  const delTpl = useMutation({ mutationFn: (id: string) => api(`/topics/templates/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["topic-templates"] }) });

  useEffect(() => {
    if (job.status === "done" && job.data) { setSp({ run: job.data.id }, { replace: true }); qc.invalidateQueries({ queryKey: ["topic-runs"] }); qc.invalidateQueries({ queryKey: ["usage"] }); }
  }, [job.status, job.data, setSp, qc]);

  const shown = job.status === "running" ? undefined : job.data && (!runId || job.data.id === runId) ? job.data : opened.data;
  const valid = f.keywords.trim().length >= 2 && f.nicheDescription.trim().length >= 10;
  const submit = () => valid && job.start({ ...f, keywords: f.keywords.trim(), nicheDescription: f.nicheDescription.trim(), customStyle: f.style === "custom" ? f.customStyle : undefined });
  const phrases = Math.min(3, f.keywords.split(/[,;\n]/).filter((x) => x.trim().length >= 2).length || 1);
  const style = styles.data?.find((s) => s.id === f.style);

  return (
    <div>
      <ToolHeader icon={Lightbulb} title="Поиск тем" eyebrow="// IDEATION"
        subtitle="Темы с оценкой потенциала, конкуренцией и доказательствами из реального YouTube за последние 90 дней" />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card brackets className="p-5">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[200px] flex-1">
                <Label hint="ключи + описание + стиль">Шаблоны</Label>
                <Select value="" onChange={(e) => { const t = templates.data?.find((x) => x.id === e.target.value); if (t) setF((x) => ({ ...x, keywords: t.keywords, nicheDescription: t.nicheDescription, style: t.style ?? x.style, customStyle: t.customStyle ?? x.customStyle })); }}>
                  <option value="">{templates.data?.length ? "Выбрать шаблон…" : "Шаблонов пока нет"}</option>
                  {templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </div>
              <Button type="button" variant="outline" disabled={!f.keywords.trim() && !f.nicheDescription.trim()} loading={saveTpl.isPending} loadingText="…"
                onClick={() => { const n = prompt("Название шаблона", f.keywords.split(",")[0]?.trim().slice(0, 60)); if (n?.trim()) saveTpl.mutate(n.trim()); }}>
                <Save className="h-4 w-4" />Сохранить как шаблон
              </Button>
            </div>
            {!!templates.data?.length && (
              <div className="flex flex-wrap gap-1.5">
                {templates.data.map((t) => (
                  <span key={t.id} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">{t.name}
                    <button type="button" title="Удалить шаблон" onClick={() => confirm(`Удалить шаблон «${t.name}»?`) && delTpl.mutate(t.id)} className="hover:text-accent"><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            )}

            <Textarea label="Ключевые слова" required maxLength={500} rows={2} className="min-h-[64px]" value={f.keywords} onChange={(e) => set("keywords", e.target.value)}
              placeholder="древние люди, каменный век, неандертальцы" hint="Через запятую. Для поиска на YouTube берутся первые 3 фразы." />
            <Textarea label="Описание ниши" required maxLength={2000} value={f.nicheDescription} onChange={(e) => set("nicheDescription", e.target.value)}
              placeholder="Например: документальный faceless-канал о быте древних людей — выживание, медицина, еда, жильё. Аудитория 25–45, любит странные факты и реконструкции." />

            <div className="flex flex-wrap gap-6">
              <div><Label>Число тем</Label><div className="flex gap-2">{([5, 10, 15] as const).map((n) => <Chip key={n} active={f.count === n} onClick={() => set("count", n)}>{n}</Chip>)}</div></div>
              <div><Label>Формат</Label>
                <div className="flex items-center gap-2">
                  <Chip active={f.format === "long"} onClick={() => set("format", "long")}>Длинное ≈</Chip>
                  <Input type="number" min={3} max={120} value={f.minutes} onChange={(e) => set("minutes", Math.max(3, Math.min(120, +e.target.value || 12)))} className="h-8 w-16 px-2 text-center" disabled={f.format !== "long"} />
                  <span className="text-xs text-muted-foreground">мин</span>
                  <Chip active={f.format === "shorts"} onClick={() => set("format", "shorts")}>Shorts</Chip>
                </div>
              </div>
              <div className="w-40"><Label>Язык</Label>
                <Select value={f.language} onChange={(e) => set("language", e.target.value)}>{CONTENT_LANGUAGES.map((l) => <option key={l.value} value={l.value} lang={l.value} dir="auto">{l.label}</option>)}</Select>
              </div>
            </div>

            <div>
              <Label hint={style?.hint}>Стиль-пресет</Label>
              <div className="flex flex-wrap gap-1.5">
                {styles.data?.map((s) => <Chip key={s.id} active={f.style === s.id} onClick={() => set("style", s.id)} title={s.hint}>{s.name}</Chip>)}
                <Chip active={f.style === "custom"} onClick={() => set("style", "custom")}>Свой</Chip>
              </div>
              {f.style === "custom" && <Textarea className="mt-2 min-h-[64px]" rows={2} maxLength={3000} value={f.customStyle} onChange={(e) => set("customStyle", e.target.value)} placeholder="Опишите стиль канала: тон, типичные заголовки, визуал (необязательно)" />}
            </div>

            <Switch checked={f.useYouTube} onChange={(v) => set("useYouTube", v)} label="Опираться на реальные данные YouTube"
              description={<>Поиск по {phrases} фраз{phrases === 1 ? "е" : "ам"} ≈ {phrases * 100 + 2} ед. квоты (сегодня потрачено {usage.data?.youtubeToday ?? 0} из 10 000). Результаты кэшируются на 6 ч.</>} />
            {f.useYouTube && <Switch checked={!!f.force} onChange={(v) => set("force", v)} label="Обновить данные" description="Игнорировать кэш поиска" />}

            {job.status === "running" ? (
              <div className="space-y-3">
                <ProgressBar value={job.pct} label={job.stage} />
                {job.partial?.groups && <p className="text-xs text-muted-foreground">Найдено реальных видео: {job.partial.evidenceCount}</p>}
                <Button type="button" variant="danger" onClick={job.cancel}><X className="h-4 w-4" />Остановить</Button>
              </div>
            ) : (
              <Button type="submit" size="lg" disabled={!valid}><Play className="h-4 w-4" />Найти темы</Button>
            )}
            {job.status === "error" && <ErrorAlert error={job.error} onRetry={submit} />}
          </form>
        </Card>

        <Card className="p-5">
          <SectionTitle icon={<History className="h-4 w-4" />} right={<button onClick={() => runs.refetch()} className="text-muted-foreground hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /></button>}>История подборок</SectionTitle>
          {runs.isLoading ? <Skeleton className="h-24" /> : !runs.data?.length ? <p className="text-sm text-muted-foreground">Пока пусто</p> : (
            <ul className="max-h-[560px] space-y-1 overflow-auto">
              {runs.data.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setSp({ run: r.id })} className={`w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${r.id === runId ? "bg-muted" : ""}`}>
                    <span className="block truncate">{r.keywords}</span><span className="block text-xs text-muted-foreground">{r.count} тем · {ago(r.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-8">
        {job.status === "running" && <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[520px]" />)}</div>}
        {opened.isLoading && !shown && <Skeleton className="h-96" />}
        {opened.error && !shown && <ErrorAlert error={opened.error} />}
        {shown && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <h2 className="mr-2 text-xl font-semibold">Темы ({shown.topics.length})</h2>
              {shown.groups.map((g) => (
                <Badge key={g.phrase} tone={g.competition === "low" ? "success" : g.competition === "high" ? "danger" : "primary"}>
                  {g.phrase}: {COMP_RU[g.competition]} · {g.n10k} видео &gt;10K · медиана {compact(g.medianSubs)} подп.{g.open ? " · открыта" : ""}
                </Badge>
              ))}
              <CopyButton className="ml-auto" label="Копировать все" text={() => shown.topics.map(topicText).join("\n\n---\n\n")} />
            </div>
            {shown.warning && <div className="mb-4 flex items-center gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent"><TriangleAlert className="h-4 w-4" />{shown.warning}</div>}
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {shown.topics.map((t) => <TopicCard key={`${shown.id}-${t.n}`} t={t} niche={shown.input.keywords.split(",")[0]?.trim()} />)}
            </div>
            <p className="mono-label mt-6 text-muted-foreground">Модель: {shown.model} · реальных видео: {shown.evidenceCount}</p>
          </>
        )}
      </div>
    </div>
  );
}
