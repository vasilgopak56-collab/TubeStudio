// Выпуск 4: «Публикация». Шаг 1: карточка ролика без сети и платных запросов.
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Copy, ImagePlus, Save, Sparkles, Trash2, Upload, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import type { ProjectSummary } from "@/lib/types";
import { Button, Card, ErrorAlert, Input, Label, SectionTitle, Select, Textarea, ToolHeader } from "@/components/ui";
import { ChannelPicker, JobBox, NeedChannel, useActiveChannel } from "@/features/studio/common";

type Chapter = { scene: number; start: number; excerpt: string; title: string };
type Check = { code: string; level: "ok" | "warn" | "block"; message: string };
type Proposal = { at: string; model: string; keyword: string; titles: string[]; description: string; tags: string[]; pinnedComments: { type: string; text: string }[]; chapters: { scene: number; excerpt: string; title: string }[] };
type PublishCard = { video: { id: string; linkedAt: string } | null; title: string | null; description: string | null; tags: string[]; language: string | null; categoryId: string | null; madeForKids: boolean | null; syntheticMedia: boolean | null; thumbnail: { file: string; width: number; height: number; bytes: number } | null };
type PublishState = {
  project: { id: string; title: string };
  montage: { file: string; seconds: number; bytes: number; width: number; height: number; at: string } | null;
  accepted: { file: string; at: string } | null;
  card: PublishCard; chapters: Chapter[]; categories: { id: string; name: string }[]; checks: Check[]; ready: boolean;
  youtube: { configured: boolean; connected: boolean; channel: { id: string; title: string } | null; uploadGranted: boolean; scopeKnown: boolean };
  proposal: Proposal | null; finalDescription: string; descriptionBytes: number; tagsLength: number; limits: { title: number; descriptionBytes: number; tags: number };
};
type Draft = { title: string; description: string; tags: string; language: string; categoryId: string; madeForKids: string; syntheticMedia: string; titles: Record<number, string> };

const clock = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = Math.floor(s % 60), p = (n: number) => String(n).padStart(2, "0"); return h ? `${h}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`; };
const yesNo = (v: boolean | null) => (v === null ? "" : v ? "yes" : "no");
const fromYesNo = (v: string) => (v === "" ? null : v === "yes");
const COMMENT: Record<string, string> = { controversial: "Спорный вопрос", sensory: "Образ", challenge: "Вызов" };
const tagList = (text: string) => text.split(",").map((t) => t.trim()).filter(Boolean);
const draftOf = (s: PublishState): Draft => ({
  title: s.card.title ?? "", description: s.card.description ?? "", tags: s.card.tags.join(", "), language: s.card.language ?? "", categoryId: s.card.categoryId ?? "", madeForKids: yesNo(s.card.madeForKids), syntheticMedia: yesNo(s.card.syntheticMedia),
  titles: Object.fromEntries(s.chapters.map((c) => [c.scene, c.title])),
});
function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Не удалось прочитать файл"));
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.readAsDataURL(file);
  });
}
const LEVEL = { ok: { icon: CheckCircle2, cls: "text-success" }, warn: { icon: AlertTriangle, cls: "text-crown" }, block: { icon: XCircle, cls: "text-accent" } };

export default function StudioPublish() {
  const [sp, setSp] = useSearchParams();
  const { channel, list, loading } = useActiveChannel();
  const projectId = sp.get("project") ?? "";
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<(ProjectSummary & { channelId?: string })[]>("/projects"), refetchOnWindowFocus: false });
  const withBoard = (projects.data ?? []).filter((p) => (p.counts.storyboard ?? 0) > 0).sort((a, b) => Number(b.channelId === channel?.id) - Number(a.channelId === channel?.id));
  const path = `/studio/publish/projects/${projectId}`;
  const state = useQuery({ queryKey: ["publish-state", projectId], queryFn: () => api<PublishState>(path), enabled: !!projectId, retry: false, refetchOnWindowFocus: false });
  const [draft, setDraft] = useState<Draft | null>(null);
  // Форма заполняется только при открытии ролика и после сохранения: обложка и готовые тексты не стирают ваши правки.
  const resetDraft = useRef(true);
  useEffect(() => { resetDraft.current = true; setDraft(null); }, [projectId]);
  useEffect(() => { if (state.data && resetDraft.current && state.data.project.id === projectId) { resetDraft.current = false; setDraft(draftOf(state.data)); } }, [state.data, projectId]);
  const texts = useJob<Proposal>("");
  useEffect(() => { if (texts.status === "done" || texts.status === "error") void state.refetch(); }, [texts.status]);
  const save = useMutation({
    mutationFn: (d: Draft) => api<PublishState>(path, { method: "PUT", json: {
      title: d.title.trim() || null, description: d.description.trim() || null, tags: tagList(d.tags),
      language: d.language.trim() || null, categoryId: d.categoryId || null, madeForKids: fromYesNo(d.madeForKids), syntheticMedia: fromYesNo(d.syntheticMedia),
      chapters: (state.data?.chapters ?? []).map((c) => ({ scene: c.scene, title: d.titles[c.scene] ?? "" })),
    } }),
    onSuccess: () => { resetDraft.current = true; void state.refetch(); },
  });
  const cover = useMutation({
    mutationFn: async (file: File) => api<PublishState>(`${path}/thumbnail`, { method: "PUT", json: { data: await fileToBase64(file) } }),
    onSuccess: () => void state.refetch(),
  });
  const dropCover = useMutation({ mutationFn: () => api<PublishState>(`${path}/thumbnail`, { method: "DELETE" }), onSuccess: () => void state.refetch() });
  const [videoUrl, setVideoUrl] = useState("");
  const [copied, setCopied] = useState("");
  const [copyFailed, setCopyFailed] = useState(false);
  const copy = (what: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => { setCopyFailed(false); setCopied(what); window.setTimeout(() => setCopied((c) => (c === what ? "" : c)), 2000); }, () => { setCopied(""); setCopyFailed(true); });
  };
  const link = useMutation({ mutationFn: (url: string | null) => api<PublishState>(`${path}/video`, { method: "PUT", json: { url } }), onSuccess: () => { setVideoUrl(""); void state.refetch(); } });
  const allowUpload = useMutation({ mutationFn: () => api<{ url: string }>("/yt-oauth/start-upload", { method: "POST", json: { consent: true, projectId } }), onSuccess: (r) => { window.location.href = r.url; } });
  const pickCover = (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) cover.mutate(f); };
  const url = (local: string) => `/files/${encodeURIComponent(projectId)}/${local.split("/").map(encodeURIComponent).join("/")}`;

  if (loading) return null;
  const header = <ToolHeader icon={Upload} title="Публикация" eyebrow="// ВЫПУСК 4" subtitle="Карточка ролика перед загрузкой на YouTube" right={channel ? <ChannelPicker /> : undefined} />;
  if (!list?.channels.length || !channel) return <div className="space-y-6">{header}<NeedChannel /></div>;
  const s = state.data;
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const unsaved = !!s && !!draft && (draft.title.trim() !== (s.card.title ?? "") || draft.description.trim() !== (s.card.description ?? "") || tagList(draft.tags).join(",") !== s.card.tags.join(",") || s.chapters.some((c) => (draft.titles[c.scene] ?? "").trim() !== c.title));
  const preparing = texts.status === "running";
  const busy = save.isPending || cover.isPending || dropCover.isPending || preparing;
  const applyProposal = (p: Proposal) => setDraft((d) => {
    if (!d) return d;
    const titles = { ...d.titles };
    for (const c of s?.chapters ?? []) { const found = p.chapters.find((x) => x.scene === c.scene && x.excerpt === c.excerpt); if (found?.title && !titles[c.scene]) titles[c.scene] = found.title; }
    return { ...d, description: p.description, tags: p.tags.join(", "), titles };
  });
  return <div className="space-y-6" data-testid="studio-publish">
    {header}
    <Card className="space-y-4 p-5">
      <SectionTitle>Проект</SectionTitle>
      <label className="block space-y-1 text-sm"><Label>Ролик</Label>
        <Select value={projectId} onChange={(e) => setSp(e.target.value ? { project: e.target.value } : {}, { replace: true })}>
          <option value="">Выберите проект</option>
          {withBoard.map((p) => <option key={p.id} value={p.id}>{p.title}{p.channelId === channel.id ? "" : " (другой канал)"}</option>)}
        </Select></label>
      {projects.data && withBoard.length === 0 && <p className="text-sm text-muted-foreground">Готовых к публикации проектов нет. Соберите ролик в разделе <Link to="/studio/montage" className="text-primary hover:underline">Монтаж</Link>.</p>}
      {state.error && <ErrorAlert error={state.error} onRetry={() => void state.refetch()} />}
    </Card>

    {s && draft && <>
      <Card className="space-y-3 p-5" data-testid="publish-checks">
        <SectionTitle>Готовность</SectionTitle>
        <p className={`flex items-center gap-2 text-lg font-bold ${s.ready ? "text-success" : "text-accent"}`} role="status">
          {s.ready ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}{s.ready ? "Карточка готова" : "Карточка не готова"}
        </p>
        {s.montage && <p className="text-sm text-muted-foreground">{s.montage.width}×{s.montage.height} · {clock(s.montage.seconds)} · {(s.montage.bytes / 1024 ** 3).toFixed(2)} ГБ · собрано {new Date(s.montage.at).toLocaleString("ru-RU")}</p>}
        <ul className="space-y-2 text-sm">{s.checks.map((c) => { const L = LEVEL[c.level]; return <li key={c.code} className="flex items-start gap-2"><L.icon className={`mt-0.5 h-4 w-4 shrink-0 ${L.cls}`} /><span>{c.message}</span></li>; })}</ul>
        {(!s.montage || !s.accepted) && <Link to={`/studio/montage?project=${encodeURIComponent(projectId)}`} className="inline-flex min-h-11 items-center text-sm text-primary hover:underline">Открыть «Монтаж»</Link>}
      </Card>

      <Card className="space-y-4 p-5" data-testid="publish-texts">
        <SectionTitle>Название, описание и теги</SectionTitle>
        <p className="text-sm text-muted-foreground">Платный запрос к текстовой модели AnyModel. Ориентир цены вы увидите до отправки, запрос уходит только после подтверждения. Автоматических повторов и резервных моделей нет.</p>
        {!preparing && <Button className="min-h-11" variant="outline" disabled={busy || !s.accepted} onClick={() => void texts.start({ channelId: channel.id }, `${path}/seo`, { serverConsent: true })}><Sparkles className="h-4 w-4" />{s.proposal ? "Подготовить тексты заново" : "Подготовить тексты"}</Button>}
        <JobBox job={texts} onCancel={() => void texts.cancel()} note="Обычно занимает меньше минуты." />
        {s.proposal && <div className="space-y-3 rounded-md border border-border p-4" data-testid="publish-proposal">
          <p className="font-semibold">Предложение модели</p>
          <p className="text-sm text-muted-foreground">{s.proposal.model} · {new Date(s.proposal.at).toLocaleString("ru-RU")} · ключевая фраза: {s.proposal.keyword}. Это предложения модели: факты и поисковый спрос не проверялись. В карточку попадёт только то, что вы выберете и сохраните.</p>
          <ul className="space-y-2">{s.proposal.titles.map((t) => <li key={t}><button type="button" className={`min-h-11 w-full rounded-md border px-3 py-2 text-left text-sm ${draft.title === t ? "border-primary font-semibold" : "border-border"}`} aria-pressed={draft.title === t} onClick={() => set({ title: t })}>{t}</button></li>)}</ul>
          <Button variant="outline" className="min-h-11" onClick={() => applyProposal(s.proposal!)}>Подставить описание, теги и пустые названия глав</Button>
          <div className="space-y-2"><p className="text-sm font-semibold">Для закреплённого комментария</p>
            {s.proposal.pinnedComments.map((c) => <div key={c.type} className="flex items-start justify-between gap-3 text-sm"><p><span className="text-muted-foreground">{COMMENT[c.type] ?? c.type}:</span> {c.text}</p><Button variant="outline" size="sm" className="min-h-11 shrink-0" aria-label="Копировать комментарий" onClick={() => copy(`pin-${c.type}`, c.text)}>{copied === `pin-${c.type}` ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button></div>)}
            {copyFailed && <p role="alert" className="text-sm text-accent">Не удалось скопировать: браузер запретил доступ к буферу обмена. Выделите текст вручную.</p>}
          </div>
        </div>}
        <label className="block space-y-1 text-sm"><Label counter={`${[...draft.title].length}/${s.limits.title}`}>Название ролика</Label><Input value={draft.title} onChange={(e) => set({ title: e.target.value })} /></label>
        <Textarea label="Описание" hint="Главы добавятся в конец автоматически, когда заполнены все их названия." value={draft.description} rows={10} onChange={(e) => set({ description: e.target.value })} />
        <label className="block space-y-1 text-sm"><Label hint="через запятую">Теги</Label><Input value={draft.tags} onChange={(e) => set({ tags: e.target.value })} /></label>
        <p className="text-sm text-muted-foreground">После сохранения: описание с главами {s.descriptionBytes}/{s.limits.descriptionBytes} байт, теги {s.tagsLength}/{s.limits.tags} знаков.</p>
      </Card>

      <Card className="space-y-4 p-5" data-testid="publish-details">
        <SectionTitle>Сведения для YouTube</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1 text-sm"><Label>Язык ролика (код)</Label><Input value={draft.language} placeholder="en" onChange={(e) => set({ language: e.target.value })} /></label>
          <label className="block space-y-1 text-sm"><Label>Категория</Label>
            <Select value={draft.categoryId} onChange={(e) => set({ categoryId: e.target.value })}><option value="">Не выбрана</option>{s.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></label>
          <label className="block space-y-1 text-sm"><Label>Ролик снят для детей?</Label>
            <Select value={draft.madeForKids} onChange={(e) => set({ madeForKids: e.target.value })}><option value="">Не отвечено</option><option value="no">Нет</option><option value="yes">Да</option></Select></label>
          <label className="block space-y-1 text-sm"><Label>Отметить контент, созданный или изменённый ИИ?</Label>
            <Select value={draft.syntheticMedia} onChange={(e) => set({ syntheticMedia: e.target.value })}><option value="">Не отвечено</option><option value="yes">Да</option><option value="no">Нет</option></Select></label>
        </div>
        <p className="text-sm text-muted-foreground">YouTube просит отмечать реалистичные сцены, людей, места или события, которые созданы или изменены ИИ и могут быть приняты за настоящие. Решение за вами.</p>
      </Card>

      <Card className="space-y-4 p-5" data-testid="publish-chapters">
        <SectionTitle>Главы</SectionTitle>
        {s.chapters.length === 0 && <p className="text-sm text-muted-foreground">Глав нет.</p>}
        {s.chapters.length > 0 && <>
          <p className="text-sm text-muted-foreground">Время взято из готового монтажа, глава начинается с нового абзаца. Названия впишите сами или подставьте из предложения модели.</p>
          <ol className="space-y-3">{s.chapters.map((c) => <li key={c.scene} className="space-y-1">
            <label className="block space-y-1 text-sm"><Label>{clock(c.start)} · сцена {c.scene}</Label>
              <Input value={draft.titles[c.scene] ?? ""} maxLength={80} placeholder="Название главы" onChange={(e) => set({ titles: { ...draft.titles, [c.scene]: e.target.value } })} /></label>
            <p className="text-xs text-muted-foreground">{c.excerpt}</p>
          </li>)}</ol>
        </>}
        <Button className="min-h-11" loading={save.isPending} loadingText="Сохраняю…" disabled={busy} onClick={() => save.mutate(draft)}><Save className="h-4 w-4" />Сохранить</Button>
        {save.error && <ErrorAlert error={save.error} />}
      </Card>

      <Card className="space-y-4 p-5" data-testid="publish-thumbnail">
        <SectionTitle>Обложка</SectionTitle>
        <p className="text-sm text-muted-foreground">JPG или PNG, 16:9, ширина от 640 пикселей, до 2 МБ.</p>
        {s.card.thumbnail && <div className="space-y-2">
          <img src={url(s.card.thumbnail.file)} alt="Обложка ролика" className="aspect-video w-full max-w-md rounded-md object-cover" />
          <p className="text-sm text-muted-foreground">{s.card.thumbnail.width}×{s.card.thumbnail.height} · {(s.card.thumbnail.bytes / 1024 ** 2).toFixed(2)} МБ</p>
        </div>}
        <div className="flex flex-wrap items-center gap-3">
          <label className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold ${busy ? "pointer-events-none opacity-50" : ""}`}>
            <ImagePlus className="h-4 w-4" />{cover.isPending ? "Загружаю…" : s.card.thumbnail ? "Заменить обложку" : "Выбрать файл"}
            <input type="file" accept="image/jpeg,image/png" className="sr-only" disabled={busy} onChange={pickCover} />
          </label>
          {s.card.thumbnail && <Button variant="outline" className="min-h-11" disabled={busy} loading={dropCover.isPending} onClick={() => dropCover.mutate()}><Trash2 className="h-4 w-4" />Убрать</Button>}
        </div>
        {cover.error && <ErrorAlert error={cover.error} />}
        {dropCover.error && <ErrorAlert error={dropCover.error} />}
      </Card>

      <Card className="space-y-4 p-5" data-testid="publish-manual">
        <SectionTitle>Для ручной загрузки в YouTube Studio</SectionTitle>
        {unsaved && <p role="alert" className="flex items-center gap-2 text-sm text-crown"><AlertTriangle className="h-4 w-4 shrink-0" />Есть несохранённые правки. Ниже показан последний сохранённый вариант: сначала нажмите «Сохранить».</p>}
        {!s.card.title && !s.finalDescription && <p className="text-sm text-muted-foreground">Заполните и сохраните название и описание, и они появятся здесь.</p>}
        {([["title", "Название", s.card.title ?? "", 1], ["description", "Описание с главами", s.finalDescription, 10], ["tags", "Теги", s.card.tags.join(", "), 2]] as const).map(([key, label, text, rows]) => <div key={key} className="space-y-1">
          <div className="flex items-center justify-between gap-3"><Label>{label}</Label>
            <Button variant="outline" size="sm" className="min-h-11" disabled={!text} onClick={() => copy(key, text)}><Copy className="h-4 w-4" />{copied === key ? "Скопировано" : "Копировать"}</Button></div>
          <textarea aria-label={label} className="field w-full resize-y leading-relaxed" rows={rows} readOnly value={text} />
        </div>)}
        {copyFailed && <p role="alert" className="text-sm text-accent">Не удалось скопировать: браузер запретил доступ к буферу обмена. Выделите текст вручную.</p>}
        <div className="space-y-2 border-t border-border pt-4">
          <SectionTitle>Ссылка на загруженный ролик</SectionTitle>
          <p className="text-sm text-muted-foreground">После загрузки вставьте сюда ссылку на ролик. По ней программа свяжет его с этим проектом для аналитики.</p>
          {s.card.video && <p className="flex flex-wrap items-center gap-2 text-sm text-success" role="status"><CheckCircle2 className="h-4 w-4 shrink-0" />Связан с проектом:<a className="text-primary hover:underline" href={`https://youtu.be/${s.card.video.id}`} target="_blank" rel="noreferrer">youtu.be/{s.card.video.id}</a></p>}
          <label className="block space-y-1 text-sm"><Label>Ссылка на ролик</Label><Input value={videoUrl} placeholder="https://youtu.be/…" onChange={(e) => setVideoUrl(e.target.value)} /></label>
          <div className="flex flex-wrap items-center gap-3">
            <Button className="min-h-11" disabled={!videoUrl.trim() || link.isPending} loading={link.isPending} onClick={() => link.mutate(videoUrl)}>{s.card.video ? "Заменить ссылку" : "Сохранить ссылку"}</Button>
            {s.card.video && <Button variant="outline" className="min-h-11" disabled={link.isPending} onClick={() => link.mutate(null)}><Trash2 className="h-4 w-4" />Убрать связь</Button>}
          </div>
          {link.error && <ErrorAlert error={link.error} />}
        </div>
      </Card>

      <Card className="space-y-4 p-5" data-testid="publish-youtube">
        <SectionTitle>Подключение YouTube</SectionTitle>
        {!s.youtube.configured && <p className="text-sm">Сначала настройте подключение Google в разделе <Link to="/my-analytics" className="text-primary hover:underline">Моя аналитика</Link>.</p>}
        {s.youtube.configured && !s.youtube.connected && <p className="text-sm">Канал не подключён. Подключите его в разделе <Link to="/my-analytics" className="text-primary hover:underline">Моя аналитика</Link>.</p>}
        {s.youtube.connected && <>
          <p className="text-sm" role="status">Канал Google: <b>{s.youtube.channel?.title ?? "неизвестен"}</b>. Профиль в программе: <b>{channel.name}</b>. Проверьте, что это один и тот же канал.</p>
          {s.youtube.uploadGranted
            ? <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4 shrink-0" />Загрузка на этот канал разрешена.</p>
            : <>
              <p className="text-sm text-muted-foreground">{s.youtube.scopeKnown ? "Сейчас разрешено только чтение." : "Разрешения этого подключения неизвестны."} Откроется окно Google: выберите тот же канал и разрешите загрузку роликов. Чтение и аналитика продолжат работать. Если выбрать другой канал или не дать разрешение, прежнее подключение останется как есть.</p>
              <Button className="min-h-11" disabled={busy} loading={allowUpload.isPending} onClick={() => allowUpload.mutate()}><Upload className="h-4 w-4" />Разрешить загрузку</Button>
              {allowUpload.error && <ErrorAlert error={allowUpload.error} />}
            </>}
        </>}
      </Card>
    </>}
  </div>;
}
