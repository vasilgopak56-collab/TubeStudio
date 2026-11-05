// Общие элементы Студии: выбор канала, ход задачи, отчёт проверки сценария, оценки критика.
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, XCircle, X } from "lucide-react";
import { api } from "@/lib/api";
import type { JobState, PriceChallenge } from "@/lib/jobs";
import { Badge, Button, Card, ErrorAlert, ProgressBar, Select } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Channel, ChannelList, CriticReport, LintIssue, LintReport } from "./types";

export const useChannels = (archived = false) => useQuery({ queryKey: ["studio-channels", archived], queryFn: () => api<ChannelList>(`/studio/channels${archived ? "?archived=1" : ""}`), staleTime: 10_000 });

/** Активный канал общий для всех разделов Студии: выбор здесь меняет его везде. */
export function useActiveChannel(): { channel: Channel | null; list?: ChannelList; loading: boolean; error: unknown; select: (id: string) => void } {
  const q = useChannels();
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: (id: string) => api<Channel>(`/studio/channels/${id}/activate`, { method: "POST" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["studio-channels"] }) });
  const list = q.data;
  const channel = list?.channels.find((c) => c.id === list.activeId) ?? list?.channels[0] ?? null;
  return { channel, list, loading: q.isLoading, error: q.error ?? m.error, select: (id) => m.mutate(id) };
}

export function ChannelPicker({ disabled }: { disabled?: boolean }) {
  const { channel, list, loading, error, select } = useActiveChannel();
  if (loading) return null;
  if (error) return <ErrorAlert error={error} />;
  if (!list?.channels.length) return null;
  return <label className="flex items-center gap-2 text-sm">
    <span className="text-muted-foreground">Канал</span>
    <Select aria-label="Канал" className="min-w-[180px]" value={channel?.id ?? ""} disabled={disabled} onChange={(e) => select(e.target.value)}>
      {list.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </Select>
  </label>;
}

/** Нет ни одного канала — ведём в «Каналы». */
export function NeedChannel() {
  return <Card className="space-y-3 p-6">
    <p className="text-lg font-semibold">Сначала создайте профиль канала</p>
    <p className="text-sm text-muted-foreground">В профиле — ниша, язык, длина роликов, стиль и каналы-образцы. По нему Радар ищет идеи, сценарист пишет текст, а озвучка берёт голос.</p>
    <Link to="/channels" className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">Создать канал →</Link>
  </Card>;
}

/** Ход задачи: подтверждение цены, прогресс, остановка, ошибка. */
export function JobBox<T>({ job, onCancel, note }: { job: JobState<T> & { decideConsent: (c: PriceChallenge, d: "approve" | "deny") => void }; onCancel: () => void; note?: string }) {
  return <>
    {job.status === "running" && job.consentError && <p role="alert" className="text-sm text-accent">{job.consentError}</p>}
    {job.status === "running" && (job.consents ?? []).map((c) => <Card key={c.id} className="space-y-3 p-4" role="group" aria-label="Подтверждение платного запроса">
      <p className="font-semibold">Подтвердите платный запрос</p>
      <p className="text-sm">{c.message}</p>
      <p className="text-sm text-muted-foreground">{c.tasks.map((t) => `${t.provider} · ${t.model}`).join(", ")} · до {new Date(c.expiresAt).toLocaleTimeString("ru-RU")}</p>
      <div className="flex gap-2"><Button onClick={() => job.decideConsent(c, "approve")}>Подтвердить</Button><Button variant="outline" onClick={() => job.decideConsent(c, "deny")}>Отклонить</Button></div>
    </Card>)}
    {job.status === "running" && <Card className="space-y-3 p-4" role="status">
      <ProgressBar value={job.pct} label={job.stage} />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="danger" className="min-h-11" onClick={onCancel}><X className="h-4 w-4" />Остановить</Button>
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
      </div>
    </Card>}
    {job.status === "error" && job.error && <ErrorAlert error={job.error} />}
  </>;
}

const SEV: Record<LintIssue["severity"], { label: string; icon: typeof XCircle; cls: string }> = {
  error: { label: "Ошибка", icon: XCircle, cls: "text-accent" },
  warn: { label: "Предупреждение", icon: AlertTriangle, cls: "text-crown" },
  info: { label: "Заметка", icon: Info, cls: "text-muted-foreground" },
};
const ORDER = { error: 0, warn: 1, info: 2 } as const;

/** Отчёт проверки кодом: каждое замечание с номером абзаца и временем в озвучке. */
export function LintReportView({ report, title = "Проверка сценария" }: { report: LintReport; title?: string }) {
  const issues = [...report.issues].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const target = report.targetWords ? ` · цель ≈ ${report.targetWords.toLocaleString("ru-RU")} слов` : "";
  return <Card className="space-y-4 p-5" data-testid="lint-report">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-lg font-bold">{title}</h3>
      <div className="flex gap-2">
        <Badge tone={report.errors ? "danger" : "success"}>{report.errors ? `ошибок: ${report.errors}` : "ошибок нет"}</Badge>
        <Badge tone={report.warnings ? "crown" : "default"}>предупреждений: {report.warnings}</Badge>
      </div>
    </div>
    <p className="text-sm text-muted-foreground">
      {report.words.toLocaleString("ru-RU")} {plural(report.words, ["слово", "слова", "слов"])}{target} · ≈ {report.duration} при {report.wpm} сл/мин · {report.paragraphs} абз. · оговорок {report.hedges.count} из допустимых {report.hedges.allowed}
    </p>
    {issues.length === 0 && <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" />Замечаний нет.</p>}
    <ul className="space-y-3">
      {issues.map((i, n) => {
        const s = SEV[i.severity];
        const items = i.items?.length ? i.items : i.paragraph !== undefined ? [{ paragraph: i.paragraph, at: i.at ?? "", quote: i.quote ?? "" }] : [];
        return <li key={`${i.rule}-${n}`} className="rounded-lg border p-3">
          <p className={cn("flex items-center gap-2 text-sm font-semibold", s.cls)}><s.icon className="h-4 w-4 shrink-0" />{s.label}: {i.title}</p>
          <p className="mt-1 text-sm">{i.advice}</p>
          {items.length > 0 && <ul className="mt-2 space-y-1">
            {items.slice(0, 8).map((x, k) => <li key={k} className="text-sm text-muted-foreground"><span className="font-mono text-xs">абзац {x.paragraph}{x.at ? ` · ${x.at}` : ""}</span>{x.match ? <> · <span className="font-medium text-foreground" dir="auto">{x.match}</span></> : null}{x.quote ? <> — «<span dir="auto">{x.quote}</span>»</> : null}</li>)}
            {items.length > 8 && <li className="text-xs text-muted-foreground">…и ещё {items.length - 8}</li>}
          </ul>}
        </li>;
      })}
    </ul>
    {report.passed.length > 0 && <details className="text-sm"><summary className="min-h-11 cursor-pointer py-2 text-muted-foreground">Пройдено проверок: {report.passed.length}</summary><ul className="list-disc space-y-1 pl-5 text-muted-foreground">{report.passed.map((p) => <li key={p}>{p}</li>)}</ul></details>}
  </Card>;
}

export function CriticView({ critic, after }: { critic: CriticReport; after?: CriticReport | null }) {
  const afterBy = new Map((after?.scores ?? []).map((s) => [s.q, s.score]));
  return <Card className="space-y-4 p-5" data-testid="critic-report">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-lg font-bold">Второе мнение: {critic.model}</h3>
      <div className="flex gap-2">
        <Badge tone={critic.passed ? "success" : "danger"}>средний {critic.average} · мин. {critic.min}</Badge>
        {after && <Badge tone={after.passed ? "success" : "danger"}>после правки: {after.average} · мин. {after.min}</Badge>}
      </div>
    </div>
    <p className="text-sm text-muted-foreground">Порог карточки 150: средний балл от 8 и ни одного ниже 6.{critic.sameFamily ? " Критик из той же семьи моделей, что и автор, — оценка менее независима." : ""}</p>
    <ul className="grid gap-2 md:grid-cols-2">
      {critic.scores.map((s) => <li key={s.q} className="rounded-lg border p-3 text-sm">
        <p className="flex items-start justify-between gap-2"><span>{s.question}</span><b className={cn("shrink-0 font-mono", s.score < 6 ? "text-accent" : s.score >= 8 ? "text-success" : "text-crown")}>{s.score}{afterBy.has(s.q) && afterBy.get(s.q) !== s.score ? ` → ${afterBy.get(s.q)}` : ""}</b></p>
        {s.note && <p className="mt-1 text-muted-foreground">{s.note}</p>}
      </li>)}
    </ul>
    {critic.problems.length > 0 && <div className="space-y-2">
      <p className="font-semibold">Что исправить</p>
      {critic.problems.map((p, i) => <div key={i} className="rounded-lg border p-3 text-sm">
        <p><span className="font-mono text-xs text-muted-foreground">абзац {p.paragraph}</span> — {p.problem}</p>
        {p.before && <p className="mt-1 text-muted-foreground">Было: «{p.before}»</p>}
        {p.after && <p className="mt-1">Стало: «{p.after}»</p>}
      </div>)}
    </div>}
  </Card>;
}

/** 158 тыс., 3,7 тыс., 1,2 млн */
export function num(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(".", ",").replace(",0", "")} тыс.`;
  return `${(n / 1_000_000).toFixed(1).replace(".", ",").replace(",0", "")} млн`;
}
export function plural(n: number, forms: [string, string, string]) {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? forms[2] : b > 1 && b < 5 ? forms[1] : b === 1 ? forms[0] : forms[2];
}
/** «≈ 4 недели назад» */
export function agoDays(days: number | undefined): string {
  if (days === undefined || !Number.isFinite(days)) return "неизвестно когда";
  const d = Math.max(0, Math.round(days));
  if (d < 1) return "сегодня";
  if (d < 14) return `≈ ${d} ${plural(d, ["день", "дня", "дней"])} назад`;
  if (d < 60) { const w = Math.round(d / 7); return `≈ ${w} ${plural(w, ["неделю", "недели", "недель"])} назад`; }
  if (d < 365) { const m = Math.round(d / 30); return `≈ ${m} ${plural(m, ["месяц", "месяца", "месяцев"])} назад`; }
  const y = Math.round(d / 365 * 10) / 10;
  return `≈ ${String(y).replace(".", ",")} ${Number.isInteger(y) ? plural(y, ["год", "года", "лет"]) : "года"} назад`;
}
