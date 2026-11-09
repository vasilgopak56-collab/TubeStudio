// Выпуск 1: озвучка через Lumean — голос канала, бесплатная оценка, один заказ на сценарий, файлы в проект.
// Выпуск 2: «Мой шаблон» — готовый шаблон Lumean пользователя вместо шаблона, который создаёт TubeStudio.
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Folder, Mic, Pause, Play } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import type { Project, ProjectSummary } from "@/lib/types";
import { Badge, Button, Card, ErrorAlert, Input, Label, SectionTitle, Select, ToolHeader } from "@/components/ui";
import { ChannelPicker, JobBox, NeedChannel, num, useActiveChannel } from "@/features/studio/common";
import type { FactCheckReport, LumeanAccount, OrderRec, TemplateItem, TemplateList, VoiceEstimate, VoiceItem, VoiceResult, VoiceService } from "@/features/studio/types";
import { factStatus } from "@/features/studio/factHash";

const SERVICES: { v: VoiceService; label: string }[] = [
  { v: "elevenlabs", label: "ElevenLabs" }, { v: "cartesia", label: "Cartesia" }, { v: "heygen", label: "HeyGen" }, { v: "fishaudio", label: "Fish Audio" },
];
const STATUS: Record<string, string> = { created: "создан", pending: "в очереди", in_progress: "озвучивается", completed: "готов", result_delivered: "готов", partially_completed: "озвучен не весь", failed: "не удался", compensated: "отменён, деньги вернулись", cancelled: "отменён", sending: "отправляется", unknown: "неизвестно" };
const fileUrl = (projectId: string, local: string) => `/files/${encodeURIComponent(projectId)}/${local.split("/").map(encodeURIComponent).join("/")}`;

function Account() {
  const q = useQuery({ queryKey: ["lumean-account"], queryFn: () => api<LumeanAccount>("/studio/voice/account"), retry: false, refetchOnWindowFocus: false });
  if (q.isLoading) return <Card className="p-4 text-sm text-muted-foreground">Проверяю счёт Lumean…</Card>;
  if (q.error) {
    const e = q.error as ApiError;
    return <Card className="space-y-2 p-4 text-sm">{e.code === "KEY_MISSING"
      ? <><p className="font-semibold">Нужен ключ Lumean</p><p className="text-muted-foreground">{e.message}</p><Link to="/settings" className="text-primary hover:underline">Открыть Настройки →</Link></>
      : <ErrorAlert error={e} onRetry={() => void q.refetch()} />}</Card>;
  }
  const a = q.data!;
  return <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm" data-testid="lumean-account">
    <span><span className="text-muted-foreground">Тариф:</span> {a.plan ?? "без подписки"}</span>
    {a.tokensRemaining !== null && <span><span className="text-muted-foreground">Осталось в квоте:</span> {num(a.tokensRemaining)}{a.tokenAllowance ? ` из ${num(a.tokenAllowance)}` : ""} токенов</span>}
    {a.balance.map((b, i) => <span key={i}><span className="text-muted-foreground">Баланс:</span> {b.value.toFixed(2)} {b.asset}{b.locked ? ` (в заказах ${b.locked.toFixed(2)})` : ""}</span>)}
    {a.periodEnd && <span className="text-muted-foreground">квота обновится {new Date(a.periodEnd).toLocaleDateString("ru-RU")}</span>}
    <span className="text-xs text-muted-foreground">Lumean оплачивается отдельно и не входит в месячный лимит TubeStudio.</span>
  </Card>;
}

function VoicePicker({ channelId, language, current, onPicked }: { channelId: string; language: string; current: { service: VoiceService; voiceId: string; voiceName: string }; onPicked: () => void }) {
  const [service, setService] = useState<VoiceService>(current.service);
  const [search, setSearch] = useState(""), [lang, setLang] = useState(language.slice(0, 2)), [gender, setGender] = useState(""), [clones, setClones] = useState(false);
  const [page, setPage] = useState(0), [items, setItems] = useState<VoiceItem[]>([]), [more, setMore] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { audio.current?.pause(); }, []);
  const find = useMutation({
    mutationFn: (p: number) => api<{ voices: VoiceItem[]; hasMore: boolean }>(`/studio/voice/voices?${new URLSearchParams({ service, search, language: lang, gender, page: String(p), clones: clones ? "1" : "0" })}`),
    onSuccess: (r, p) => { setItems((x) => p === 0 ? r.voices : [...x, ...r.voices]); setMore(r.hasMore); setPage(p); },
  });
  const pick = useMutation({
    mutationFn: (v: VoiceItem) => api(`/studio/channels/${channelId}`, { method: "PATCH", json: { voice: { provider: "lumean", service: v.service, voiceId: v.voiceId, voiceName: v.name } } }),
    onSuccess: onPicked,
  });
  const play = (v: VoiceItem) => {
    audio.current?.pause();
    if (playing === v.voiceId || !v.previewUrl) { setPlaying(null); return; }
    const a = new Audio(v.previewUrl); audio.current = a; setPlaying(v.voiceId);
    a.onended = () => setPlaying(null); void a.play().catch(() => setPlaying(null));
  };
  return <div className="space-y-3">
    <div className="grid gap-3 md:grid-cols-[160px_1fr_90px_140px_auto]">
      <Select aria-label="Сервис" value={service} onChange={(e) => { setService(e.target.value as VoiceService); setItems([]); }}>{SERVICES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}</Select>
      <Input aria-label="Поиск голоса" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="deep, narrator, calm…" onKeyDown={(e) => { if (e.key === "Enter") find.mutate(0); }} />
      <Input aria-label="Язык" value={lang} maxLength={5} onChange={(e) => setLang(e.target.value)} placeholder="en" />
      <Select aria-label="Пол" value={gender} onChange={(e) => setGender(e.target.value)}><option value="">любой голос</option><option value="male">мужской</option><option value="female">женский</option></Select>
      <Button className="min-h-11" loading={find.isPending && page === 0} loadingText="Ищу…" onClick={() => find.mutate(0)}>Найти</Button>
    </div>
    {(service === "cartesia" || service === "fishaudio") && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={clones} onChange={(e) => setClones(e.target.checked)} />Мои клоны голоса</label>}
    {find.error && <ErrorAlert error={find.error} />}
    {pick.error && <ErrorAlert error={pick.error} />}
    {find.isSuccess && items.length === 0 && <p className="text-sm text-muted-foreground">Ничего не найдено. Уберите язык или пол.</p>}
    <ul className="grid gap-2 md:grid-cols-2">
      {items.map((v) => <li key={`${v.service}:${v.voiceId}`} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
        <Button variant="outline" size="sm" className="min-h-11 shrink-0" disabled={!v.previewUrl} aria-label={`Прослушать ${v.name}`} onClick={() => play(v)}>{playing === v.voiceId ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button>
        <div className="min-w-0 flex-1">
          <p className="font-semibold" dir="auto">{v.name}{v.clone && <Badge className="ml-2">клон</Badge>}{current.voiceId === v.voiceId && <Badge tone="primary" className="ml-2">выбран</Badge>}</p>
          <p className="text-muted-foreground">{[v.language, v.gender, v.accent].filter(Boolean).join(" · ")}</p>
          {v.description && <p className="line-clamp-2 text-xs text-muted-foreground" dir="auto">{v.description}</p>}
        </div>
        <Button size="sm" className="min-h-11 shrink-0" disabled={pick.isPending || current.voiceId === v.voiceId} onClick={() => pick.mutate(v)}>Выбрать</Button>
      </li>)}
    </ul>
    {more && <Button variant="ghost" className="min-h-11" loading={find.isPending && page > 0} onClick={() => find.mutate(page + 1)}>Показать ещё</Button>}
  </div>;
}

/** «Мой шаблон»: папки и шаблоны из кабинета Lumean, поиск по названию или номер шаблона. */
function TemplatePicker({ channelId, currentId, onPicked }: { channelId: string; currentId: string; onPicked: () => void }) {
  const [search, setSearch] = useState(""), [folder, setFolder] = useState(""), [page, setPage] = useState(1), [paste, setPaste] = useState("");
  const [items, setItems] = useState<TemplateItem[]>([]);
  const find = useMutation({
    mutationFn: (o: { folder: string; page: number; search: string }) => api<TemplateList>(`/studio/voice/templates?${new URLSearchParams({ search: o.search, folderId: o.folder, page: String(o.page) })}`),
    onSuccess: (r, o) => { setItems((x) => o.page === 1 ? r.items : [...x, ...r.items]); setPage(o.page); setFolder(o.folder); },
  });
  useEffect(() => { find.mutate({ folder: "", page: 1, search: "" }); }, []);
  const pick = useMutation({
    mutationFn: async (t: { id: string; name?: string }) => {
      const real = t.name ? t : await api<TemplateItem>(`/studio/voice/templates/${encodeURIComponent(t.id)}`);
      return api(`/studio/channels/${channelId}`, { method: "PATCH", json: { voice: { provider: "lumean", templateSource: "mine", ownTemplateId: real.id, ownTemplateName: real.name ?? real.id } } });
    },
    onSuccess: onPicked,
  });
  const data = find.data;
  return <div className="space-y-3" data-testid="template-picker">
    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
      <Input aria-label="Поиск шаблона" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Название шаблона" onKeyDown={(e) => { if (e.key === "Enter") find.mutate({ folder, page: 1, search }); }} />
      <Button className="min-h-11" loading={find.isPending && page === 1} loadingText="Ищу…" onClick={() => find.mutate({ folder, page: 1, search })}>Найти</Button>
    </div>
    {!search && data && (data.folder || folder) && <p className="flex flex-wrap items-center gap-1 text-sm">
      <button type="button" className="min-h-11 text-primary hover:underline" onClick={() => find.mutate({ folder: "", page: 1, search: "" })}>Все шаблоны</button>
      {data.breadcrumbs.filter((b) => b.id).map((b) => <span key={b.id}> / <button type="button" className="min-h-11 text-primary hover:underline" onClick={() => find.mutate({ folder: b.id, page: 1, search: "" })}>{b.name}</button></span>)}
      {data.folder && <span> / {data.folder.name}</span>}
    </p>}
    {find.error && <ErrorAlert error={find.error} />}
    {pick.error && <ErrorAlert error={pick.error} />}
    {find.isSuccess && items.length === 0 && <p className="text-sm text-muted-foreground">Шаблонов не найдено.</p>}
    <ul className="grid gap-2 md:grid-cols-2">
      {items.map((t) => t.type === "folder"
        ? <li key={`f-${t.id}`}><button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-lg border p-3 text-left text-sm hover:bg-muted" onClick={() => { setSearch(""); find.mutate({ folder: t.id, page: 1, search: "" }); }}><Folder className="h-4 w-4 shrink-0" /><span className="flex-1" dir="auto">{t.name}</span><span className="text-xs text-muted-foreground">{t.count ?? 0}</span></button></li>
        : <li key={t.id} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
          <div className="min-w-0 flex-1">
            <p className="font-semibold" dir="auto">{t.name}{currentId === t.id && <Badge tone="primary" className="ml-2">выбран</Badge>}</p>
            <p className="text-muted-foreground">{[t.service, t.voiceId && `голос ${t.voiceId.slice(0, 12)}`, t.mode].filter(Boolean).join(" · ")}</p>
          </div>
          <Button size="sm" className="min-h-11 shrink-0" disabled={pick.isPending || currentId === t.id} onClick={() => pick.mutate({ id: t.id, name: t.name })}>Выбрать</Button>
        </li>)}
    </ul>
    {data?.hasMore && <Button variant="ghost" className="min-h-11" loading={find.isPending && page > 1} onClick={() => find.mutate({ folder, page: page + 1, search })}>Показать ещё</Button>}
    <div className="grid gap-3 border-t pt-3 md:grid-cols-[1fr_auto]">
      <Input aria-label="Номер шаблона" value={paste} onChange={(e) => setPaste(e.target.value.trim())} placeholder="Или вставьте номер (ID) шаблона из кабинета Lumean" />
      <Button variant="outline" className="min-h-11" disabled={!paste} loading={pick.isPending} loadingText="Проверяю…" onClick={() => pick.mutate({ id: paste })}>Проверить и выбрать</Button>
    </div>
  </div>;
}

export default function StudioVoice() {
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const { channel, list, loading } = useActiveChannel();
  const projectId = sp.get("project") ?? "";
  const [picking, setPicking] = useState(false);
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<(ProjectSummary & { channelId?: string })[]>("/projects"), refetchOnWindowFocus: false });
  const orders = useQuery({ queryKey: ["lumean-orders"], queryFn: () => api<{ orders: OrderRec[] }>("/studio/voice/orders"), refetchOnWindowFocus: false });
  const withScript = (projects.data ?? []).filter((p) => (p.counts.script ?? 0) > 0).sort((a, b) => Number(b.channelId === channel?.id) - Number(a.channelId === channel?.id));
  const settings = useMutation({
    mutationFn: (voice: Record<string, unknown>) => api(`/studio/channels/${channel!.id}`, { method: "PATCH", json: { voice } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["studio-channels"] }),
  });
  const estimate = useMutation({ mutationFn: () => api<VoiceEstimate>("/studio/voice/estimate", { method: "POST", json: { channelId: channel!.id, projectId } }) });
  useEffect(() => { estimate.reset(); }, [projectId, channel?.id, channel?.voice.voiceId, channel?.voice.mode, channel?.voice.templateSource, channel?.voice.ownTemplateId]);
  const job = useJob<VoiceResult>("/studio/voice");
  useEffect(() => { if (job.status === "done" || job.status === "error") { void qc.invalidateQueries({ queryKey: ["lumean-orders"] }); void qc.invalidateQueries({ queryKey: ["lumean-account"] }); } }, [job.status]);
  const run = (extra: { again?: boolean; topupMaxLmc?: number } = {}) => channel && job.start({ channelId: channel.id, projectId, ...extra });
  // Проверка фактов до озвучки: после неё правка текста — это новый платный заказ.
  const project = useQuery({ queryKey: ["project", projectId], queryFn: () => api<Project>(`/projects/${projectId}`), enabled: !!projectId, retry: false, refetchOnWindowFocus: false });
  const sd = (project.data ? [...project.data.artifacts].reverse().find((a) => a.kind === "script")?.data : undefined) as { script?: string; studio?: { factCheck?: FactCheckReport | null } } | undefined;
  const factReport = sd?.studio?.factCheck ?? null;
  const facts = projectId && project.data ? factStatus(sd?.script, factReport) : null;
  const factsTitle = facts === "none" ? "Факты в этом сценарии не проверены" : facts === "stale" ? "Сценарий меняли после проверки фактов" : facts === "issues" ? `После проверки фактов остались неисправленные места: ${factReport?.remaining ?? 0}` : "";
  const voiceNow = () => {
    if (facts && facts !== "passed" && !window.confirm(`${factsTitle}. YouTube может ограничить монетизацию ролика с недостоверными фактами. Всё равно озвучить? Это платно.`)) return;
    void run();
  };

  if (loading) return null;
  if (!list?.channels.length || !channel) return <div className="space-y-6"><ToolHeader icon={Mic} title="Озвучка" eyebrow="// ВЫПУСК 1" subtitle="Голос канала через Lumean" /><NeedChannel /></div>;
  const v = channel.voice, running = job.status === "running";
  const mine = v.templateSource === "mine", ready = mine ? !!v.ownTemplateId : !!v.voiceId;
  const err = job.error as ApiError | undefined;
  const topup = err?.code === "LUMEAN_PAYG_REQUIRED" ? (err.details as { topupLmc?: number } | undefined)?.topupLmc : undefined;
  const canAgain = !!err && /Озвучить ещё раз/.test(err.message);
  const done = job.status === "done" ? job.data : null;
  const ex = estimate.data?.existing;
  const summary = (estimate.data?.preview?.summary ?? {}) as { cost_lmc?: number | string; total_chunks?: number; chunks_count?: number; has_blocked_content?: boolean; blocked_chunks?: number[]; caps_ok?: boolean };
  return <div className="space-y-6" data-testid="studio-voice">
    <ToolHeader icon={Mic} title="Озвучка" eyebrow="// ВЫПУСК 1" subtitle="Голос канала через Lumean: бесплатная оценка, один заказ на сценарий, аудио и субтитры сразу в проект" right={<ChannelPicker disabled={running} />} />
    <Account />
    <Card className="space-y-4 p-5">
      <SectionTitle right={<Button variant="outline" size="sm" className="min-h-11" onClick={() => setPicking((x) => !x)}>{picking ? "Скрыть выбор" : mine ? (v.ownTemplateId ? "Сменить шаблон" : "Выбрать шаблон") : v.voiceId ? "Сменить голос" : "Выбрать голос"}</Button>}>Голос канала «{channel.name}»</SectionTitle>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Чем озвучивать">
        <Button size="sm" role="radio" aria-checked={!mine} variant={mine ? "outline" : "primary"} className="min-h-11" disabled={settings.isPending} onClick={() => { if (mine) { setPicking(false); settings.mutate({ templateSource: "auto" }); } }}>Голос — шаблон создаст TubeStudio</Button>
        <Button size="sm" role="radio" aria-checked={mine} variant={mine ? "primary" : "outline"} className="min-h-11" disabled={settings.isPending} onClick={() => { if (!mine) { setPicking(!v.ownTemplateId); settings.mutate({ templateSource: "mine", provider: "lumean" }); } }}>Мой шаблон Lumean</Button>
      </div>
      {mine
        ? <p className="text-sm">{v.ownTemplateId ? <>Шаблон «<span dir="auto">{v.ownTemplateName || v.ownTemplateId}</span>» — голос, модель и скорость как в вашем шаблоне, TubeStudio его не меняет.</> : <span className="text-muted-foreground">Шаблон не выбран — нажмите «Выбрать шаблон».</span>}</p>
        : <p className="text-sm">{v.voiceId ? <>{v.voiceName || v.voiceId} · {SERVICES.find((s) => s.v === v.service)?.label}</> : <span className="text-muted-foreground">Голос не выбран.</span>}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block space-y-1 text-sm"><Label>Как отправлять текст</Label>
          <Select value={v.mode} onChange={(e) => settings.mutate({ mode: e.target.value })}><option value="whole">Весь сценарий одним заказом (ровный голос)</option><option value="paragraph">По абзацам (каждый абзац отдельно)</option></Select></label>
        {!mine && <label className="block space-y-1 text-sm"><Label hint={`${v.speed.toFixed(2)}×`}>Скорость речи</Label>
          <input type="range" aria-label="Скорость речи" min={0.7} max={1.2} step={0.05} defaultValue={v.speed} key={`${channel.id}-${v.speed}`} onPointerUp={(e) => settings.mutate({ speed: Number((e.target as HTMLInputElement).value) })} onKeyUp={(e) => settings.mutate({ speed: Number((e.target as HTMLInputElement).value) })} className="w-full accent-[hsl(var(--primary))]" /></label>}
      </div>
      {settings.error && <ErrorAlert error={settings.error} />}
      {picking && !mine && <VoicePicker channelId={channel.id} language={channel.language} current={v} onPicked={() => { void qc.invalidateQueries({ queryKey: ["studio-channels"] }); setPicking(false); }} />}
      {picking && mine && <TemplatePicker channelId={channel.id} currentId={v.ownTemplateId} onPicked={() => { void qc.invalidateQueries({ queryKey: ["studio-channels"] }); setPicking(false); }} />}
    </Card>
    <Card className="space-y-4 p-5">
      <SectionTitle>Что озвучить</SectionTitle>
      <label className="block space-y-1 text-sm"><Label>Проект со сценарием</Label>
        <Select value={projectId} onChange={(e) => setSp(e.target.value ? { project: e.target.value } : {}, { replace: true })}>
          <option value="">Выберите проект</option>
          {withScript.map((p) => <option key={p.id} value={p.id}>{p.title}{p.channelId === channel.id ? "" : " (другой канал)"}</option>)}
        </Select></label>
      {projects.data && withScript.length === 0 && <p className="text-sm text-muted-foreground">Проектов со сценарием нет. Напишите его в разделе <Link to="/studio/script" className="text-primary hover:underline">Сценарий</Link>.</p>}
      {facts && facts !== "passed" && <div role="status" className="space-y-1 rounded-lg border border-crown/40 bg-crown/5 p-3 text-sm" data-testid="voice-facts">
        <p className="font-semibold text-crown">{factsTitle}</p>
        <p className="text-muted-foreground">YouTube может ограничить монетизацию ролика с недостоверными фактами. Проверьте факты до озвучки: после неё правка текста — это новый платный заказ.</p>
        <Link to={`/studio/script?project=${projectId}`} className="text-primary hover:underline">Проверить факты в разделе «Сценарий» →</Link>
      </div>}
      {facts === "passed" && factReport && <p className="flex items-center gap-2 text-sm text-success" data-testid="voice-facts"><CheckCircle2 className="h-4 w-4 shrink-0" />Факты проверены {new Date(factReport.at).toLocaleDateString("ru-RU")}{factReport.changed + factReport.removed ? ` · исправлено мест: ${factReport.changed + factReport.removed}` : " · неточностей не найдено"}{factReport.mode !== "web" ? " · без поиска Google" : ""}</p>}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" className="min-h-11" disabled={!projectId || !ready || running} loading={estimate.isPending} loadingText="Считаю…" onClick={() => estimate.mutate()}>Оценить бесплатно</Button>
        <Button className="min-h-11" disabled={!projectId || !ready || running} loading={running} loadingText="Озвучиваю…" onClick={voiceNow}>Озвучить</Button>
      </div>
      <p className="text-xs text-muted-foreground">Слова сценария не меняются: убираются только пометки в скобках, заголовки и разметка. Паузы {"{{pause=1s}}"} бесплатны. Повторное нажатие с тем же текстом и голосом не создаёт второй заказ.</p>
      {estimate.error && <ErrorAlert error={estimate.error} />}
      {estimate.data && <div className="space-y-2 rounded-lg border p-3 text-sm" data-testid="voice-estimate">
        <p>{estimate.data.chars.toLocaleString("ru-RU")} символов · {estimate.data.paragraphs} абз. · режим «{estimate.data.mode === "whole" ? "одним заказом" : "по абзацам"}»{summary.total_chunks ?? summary.chunks_count ? ` · частей: ${summary.total_chunks ?? summary.chunks_count}` : ""}{summary.cost_lmc !== undefined ? ` · стоимость ≈ ${summary.cost_lmc} LMC` : ""}</p>
        {summary.cost_lmc !== undefined && estimate.data.account?.balance?.length && estimate.data.account.balance.reduce((a, w) => a + w.value - w.locked, 0) < Number(summary.cost_lmc) ? <p role="alert" className="font-medium text-accent" data-testid="voice-balance-short">На балансе Lumean меньше, чем нужно для этой озвучки. Пополните счёт перед заказом.</p> : null}
        {estimate.data.preview?.error && <p className="text-muted-foreground">Оценка Lumean недоступна: {estimate.data.preview.error}</p>}
        {estimate.data.preview?.status === "processing" && <p className="text-muted-foreground">Lumean ещё считает длинный текст — оценка появится при следующем нажатии.</p>}
        {summary.has_blocked_content && <p className="text-accent">Часть текста уже отклонялась политикой сервиса (фрагменты {summary.blocked_chunks?.join(", ")}). Перефразируйте эти места до озвучки.</p>}
        {summary.caps_ok === false && <p className="text-accent">Слишком много пауз подряд — Lumean откажет. Уберите часть {"{{pause}}"}.</p>}
        {ex && <p>Этот текст этим голосом уже отправлялся: {STATUS[ex.status] ?? ex.status}{ex.orderId ? ` (заказ ${ex.orderId.slice(0, 8)})` : ""}. Нажмите «Озвучить» — TubeStudio продолжит тот же заказ без новой оплаты.</p>}
        <details><summary className="min-h-11 cursor-pointer py-2 text-muted-foreground">Начало текста, который уйдёт в Lumean</summary><pre className="whitespace-pre-wrap font-sans text-muted-foreground" dir="auto">{estimate.data.textPreview}</pre></details>
      </div>}
      <JobBox job={job} onCancel={() => void job.cancel()} note="Остановка прекращает ожидание; уже созданный заказ Lumean доделает сам, повторное нажатие его продолжит." />
      {topup !== undefined && <Button className="min-h-11" onClick={() => void run({ topupMaxLmc: topup })}>Разрешить доплату {topup.toFixed(2)} LMC и озвучить</Button>}
      {canAgain && <Button variant="outline" className="min-h-11" onClick={() => { if (window.confirm("Отправить текст в Lumean новым заказом? Это платно.")) void run({ again: true }); }}>Озвучить ещё раз</Button>}
      {done && <div className="space-y-2 rounded-lg border border-success/40 bg-success/5 p-3 text-sm" data-testid="voice-result">
        <p className="font-semibold">{done.reused ? "Уже было озвучено — файлы в проекте" : done.partial ? "Озвучено не полностью" : "Готово: файлы сохранены в проект"}</p>
        {done.files.filter((f) => /\.(mp3|wav|ogg|m4a)$/i.test(f.local)).map((f) => <audio key={f.local} controls src={fileUrl(projectId, f.local)} className="w-full" />)}
        <ul className="text-muted-foreground">{done.files.map((f) => <li key={f.local}><a className="hover:text-primary" href={fileUrl(projectId, f.local)} target="_blank" rel="noreferrer">{f.local.split("/").pop()}</a> · {num(f.bytes)} байт</li>)}</ul>
        <Link to={`/projects/${projectId}`} className="text-primary hover:underline">Открыть проект →</Link>
      </div>}
    </Card>
    {orders.data && orders.data.orders.length > 0 && <Card className="space-y-2 p-5 text-sm">
      <SectionTitle>Заказы Lumean</SectionTitle>
      <ul className="divide-y">{orders.data.orders.slice(0, 15).map((o) => <li key={o.hash} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
        <span className="text-muted-foreground">{new Date(o.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
        <span className="min-w-0 flex-1 truncate" dir="auto">{o.name.replace(/^TS-[a-f0-9]{10} /, "")}</span>
        <span>{o.chars.toLocaleString("ru-RU")} симв.</span>
        <Badge tone={o.status === "completed" || o.status === "result_delivered" ? "success" : ["failed", "compensated", "cancelled", "unknown"].includes(o.status) ? "danger" : "default"}>{STATUS[o.status] ?? o.status}</Badge>
        {o.projectId && <Link to={`/studio/voice?project=${o.projectId}`} className="text-primary hover:underline">к проекту</Link>}
      </li>)}</ul>
    </Card>}
  </div>;
}
