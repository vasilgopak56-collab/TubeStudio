import { DailyIdeasWidget } from "@/components/dailyIdeas/DailyIdeasWidget";
import { StudioWidget } from "@/features/studio/StudioWidget";
import { Link } from "react-router-dom";
import { ArrowRight, BarChart3, Clapperboard, FolderKanban, Lightbulb, RefreshCw, ShieldCheck, Gauge } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useHealth, useRecheckKeys } from "@/lib/queries";
import { api, type UsageT } from "@/lib/api";
import { ago, compact } from "@/lib/format";
import type { ProjectSummary, ReportIndexRow } from "@/lib/types";
import { Button, Card, EmptyState, ErrorAlert, SectionTitle, Skeleton, StatusDot } from "@/components/ui";

const WORKSPACES = [
  { n: "01", to: "/analysis", icon: BarChart3, title: "Анализ канала", text: "Свой канал или конкурент: метрики, доход, вердикт ниши, outlier-темы." },
  { n: "02", to: "/topics", icon: Clapperboard, title: "Создание контента", text: "Тема → сценарий → озвучка → SEO → обложки → раскадровка." },
  { n: "03", to: "/check/script-rater", icon: ShieldCheck, title: "Проверка и упаковка", text: "AI-детектор, оценка сценария, Viral Score для заголовка и обложки." },
];

export default function Dashboard() {
  const health = useHealth();
  const recheck = useRecheckKeys();
  const hour = new Date().getHours();
  const greet = hour < 5 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";

  const reports = useQuery({ queryKey: ["reports"], queryFn: () => api<ReportIndexRow[]>("/youtube/reports") });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<ProjectSummary[]>("/projects") });
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => api<UsageT>("/usage") });
  return (
    <div className="space-y-8">
      <div>
        <div className="mono-label mb-2 text-primary">◆ Ваш творческий центр</div>
        <h1 className="text-[32px] font-extrabold tracking-tight md:text-[40px]">{greet}<span className="text-primary">.</span></h1>
        <p className="mt-1 text-muted-foreground">Следующее видео начинается здесь. Выберите раздел.</p>
      </div>

      <StudioWidget />

      <DailyIdeasWidget />

      <section>
        <div className="mono-label mb-1">Выберите направление</div>
        <h2 className="mb-4 text-xl font-bold">Рабочие пространства</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {WORKSPACES.map((w) => (
            <Link key={w.to} to={w.to} className="bracket-card group flex min-h-[170px] flex-col p-5 transition-colors hover:border-primary/60">
              <div className="mb-auto flex items-start justify-between">
                <div className="grid h-10 w-10 place-items-center rounded-lg border border-primary/50 bg-primary/10 text-primary"><w.icon className="h-5 w-5" /></div>
                <span className="font-mono text-xs text-muted-foreground">{w.n}</span>
              </div>
              <div className="mt-6 flex items-center justify-between font-bold">{w.title}<ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" /></div>
              <p className="mt-1 text-[13px] text-muted-foreground">{w.text}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <SectionTitle icon={<FolderKanban className="h-4 w-4" />} right={<Link to="/projects" className="text-xs text-muted-foreground hover:text-primary">Все проекты →</Link>}>
            Последние проекты
          </SectionTitle>
          {projects.isLoading ? <Skeleton className="h-20" /> : projects.error ? <ErrorAlert error={projects.error} onRetry={() => projects.refetch()} /> : !projects.data?.length ? <EmptyState title="Проектов пока нет">Проект создаётся автоматически, когда вы сохраняете тему или пишете сценарий.</EmptyState> : (
            <ul className="space-y-1">
              {projects.data.slice(0, 6).map((p) => (
                <li key={p.id}><Link to={`/projects/${p.id}`} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <span className="truncate">{p.title}</span><span className="shrink-0 text-xs text-muted-foreground">{Object.values(p.counts).reduce((a, b) => a + (b ?? 0), 0)} арт. · {ago(p.updatedAt)}</span>
                </Link></li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/topics"><Button size="sm"><Lightbulb className="h-4 w-4" />Новая тема</Button></Link>
            <Link to="/check/script-rater"><Button size="sm" variant="outline"><Gauge className="h-4 w-4" />Проверить сценарий</Button></Link>
          </div>
        </Card>

        <Card>
          <SectionTitle right={<Button size="sm" variant="ghost" onClick={() => recheck.mutate()} loading={recheck.isPending} loadingText="Проверяем…"><RefreshCw className="h-3.5 w-3.5" />Проверить</Button>}>
            Статус API
          </SectionTitle>
          <p className="mb-3 text-xs text-muted-foreground">Статус читается локально. «Проверить» запрашивает метаданные/баланс без генерации; проверка квоты YouTube — отдельно в Настройках.</p>
          {recheck.error && <ErrorAlert error={recheck.error} />}
          {health.error ? <ErrorAlert error={health.error} onRetry={() => health.refetch()} /> : (
            <ul className="space-y-2.5">
              {health.isLoading ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />) :
                health.data!.keys.map((k) => (
                  <li key={k.provider} className="flex min-w-0 flex-col items-start gap-1 rounded-md border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <span className="flex min-w-0 items-center gap-2 break-words"><StatusDot ok={k.ok} muted={k.checkState === "unverified" || k.checkState === "stale" || (!k.configured && !k.required)} />{k.label}</span>
                    <span className="min-w-0 break-words text-xs text-muted-foreground sm:text-right" title={k.message}>{k.message}{k.checkedAt && <span className="block">{new Date(k.checkedAt).toLocaleString("ru")}</span>}</span>
                  </li>
                ))}
            </ul>
          )}
          {health.data && (
            <p className="mt-3 text-xs text-muted-foreground">
              Тексты генерирует: <b className="text-foreground">{health.data.llm === "anymodel" ? "AnyModel" : health.data.llm === "anthropic" ? "Claude" : health.data.llm === "gemini" ? "Gemini" : "— (нет ключа LLM)"}</b>
            </p>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <SectionTitle icon={<BarChart3 className="h-4 w-4" />} right={<Link to="/analysis" className="text-xs text-muted-foreground hover:text-primary">Анализ →</Link>}>Недавние анализы</SectionTitle>
          {!reports.data?.length ? <EmptyState title="Анализов пока нет">Разберите свой канал или конкурента в «Анализе канала».</EmptyState> : (
            <ul className="space-y-1">
              {reports.data.slice(0, 5).map((r) => (
                <li key={r.id}><Link to={`/analysis?report=${r.id}`} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <span className="truncate">{r.title}</span><span className="shrink-0 text-xs text-muted-foreground">{r.videos} видео · {ago(r.createdAt)}</span>
                </Link></li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle>Расход за месяц</SectionTitle>
          <div className="mb-3 flex items-center justify-between rounded-md border px-3 py-2 text-sm"><span>YouTube сегодня</span><span className="font-mono">{(usage.data?.youtubeToday ?? 0).toLocaleString("ru")} / {(Math.max(1, (health.data?.keys ?? []).filter((k) => k.provider.startsWith("youtube") && k.configured).length) * 10000).toLocaleString("ru")} ед.</span></div>
          {usage.error && <ErrorAlert error={usage.error} onRetry={() => usage.refetch()} />}
          <BudgetBlock u={usage.error ? undefined : usage.data} />
          <ul className="mt-3 space-y-1.5 text-sm">
            {(usage.error ? [] : usage.data?.cost.rows ?? []).slice(0, 50).map((r) => (
              <li key={r.operationId ?? r.kind + r.model} className="flex justify-between gap-3"><span className="truncate font-mono text-xs">{r.model}{r.provider ? ` · ${r.provider} · тариф сохранён` : ""}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{r.kind === "search" ? `${r.calls} поиск.` : r.kind === "image" ? `${r.calls} карт.` : r.kind === "tts" ? "озвучка" : `${r.calls} выз. · ${compact(r.in + r.out)} ток.`} · {r.usd !== null ? usd(r.usd) : "цена неизвестна"}</span></li>
            ))}
            {!usage.error && (usage.data?.cost.rows.length ?? 0) > 50 && <li className="text-xs text-muted-foreground">Показаны первые 50 строк из {usage.data?.cost.rows.length}. Полный журнал — в резервной копии usage.json.</li>}
            {!usage.error && !usage.data?.cost.rows.length && <li className="text-xs text-muted-foreground">Пока нет платных вызовов</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

const usd = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);

function BudgetBlock({ u }: { u?: UsageT }) {
  const client=useQueryClient();
  const retry=useMutation({mutationFn:()=>api("/usage/retry-accounting",{method:"POST"}),onSuccess:()=>client.invalidateQueries({queryKey:["usage"]})});
  if (!u) return null;
  const b = u.budget;
  const color = b.level === "over" ? "bg-red-500" : b.level === "warn" ? "bg-amber-500" : "bg-success";
  return (
    <div className="rounded-md border px-3 py-2 text-sm" data-testid="budget-block">
      <div className="flex items-center justify-between"><span>{b.complete ? (u.cost.valuation === "current-rate-estimate" ? "Оценка по текущим тарифам ≈" : "Оценка записанных расходов ≈") : "Известная часть расходов ≈"}</span>
        <span className="font-mono">{usd(b.knownSpentUsd)}{b.limitUsd > 0 ? ` / $${b.limitUsd}` : ""}</span></div>
      <p className="mt-1 text-xs text-muted-foreground" data-testid="budget-valuation">{u.cost.valuation === "current-rate-estimate" ? "Старый журнал не фиксирует тариф операции: это оценка по текущим ценам, не счёт провайдера." : `Новые операции: тариф сохранён до вызова (${u.cost.recordedOperations ?? 0}). ${u.cost.legacyRows ? "Старые строки отдельно оценены по текущим ценам. " : ""}Это локальная оценка, не счёт провайдера.`}</p>
      {u.cost.accountingWarning && <div className="mt-1 space-y-2"><p className="text-xs text-red-500" role="alert">{u.cost.accountingWarning}</p><Button size="sm" disabled={retry.isPending} onClick={()=>retry.mutate()}>Повторить запись журнала</Button><p className="text-xs text-muted-foreground">Только локальное сохранение, без AI. Помогает лишь для записей, ещё находящихся в памяти этого процесса.</p>{retry.error && <ErrorAlert error={retry.error}/>}</div>}
      {!b.complete && <p className="mt-1 text-xs text-amber-500" data-testid="budget-incomplete">Итог неизвестен: строк без цены — {b.unknownRows}. Известная часть не доказывает соблюдение лимита.</p>}
      {b.limitUsd > 0 ? (
        <>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full ${color}`} style={{ width: `${Math.min(100, b.pct)}%` }} /></div>
          {b.level !== "ok" && <p className={`mt-1.5 text-xs ${b.level === "over" ? "text-red-500" : "text-amber-500"}`}>{b.level === "over" ? (b.mode === "block" ? "Лимит исчерпан — платные вызовы заблокированы." : "Лимит превышен.") : `Известные расходы: ${Math.floor(b.pct)}% лимита.`}</p>}
        </>
      ) : <p className="mt-1 text-xs text-muted-foreground">Лимит не задан — <Link to="/settings#budget" className="underline">задать</Link></p>}
    </div>
  );
}
