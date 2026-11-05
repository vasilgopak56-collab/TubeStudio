// Выпуск 1: профили каналов. У каждого канала своя ниша, язык, длина, стиль, образцы для Радара, голос и бюджет.
// Выпуск 2: строка «Визуал» — стиль картинок и персонажи (настраиваются в разделе «Визуал»).
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, Pencil, Plus, RotateCcw, Star, Users } from "lucide-react";
import { api } from "@/lib/api";
import { CONTENT_LANGUAGES } from "@/lib/constants";
import { Badge, Button, Card, ErrorAlert, Input, Label, SectionTitle, Select, Textarea, ToolHeader } from "@/components/ui";
import { useChannels, num } from "@/features/studio/common";
import { useVisualStyles } from "@/lib/visualStyles";
import type { Channel, ChannelDraft } from "@/features/studio/types";

const EMPTY: ChannelDraft = {
  name: "", language: "en", niche: "", audience: "", format: "", lengthMin: 10, style: "", skills: "", samples: [], ownChannel: "",
  radar: { seeds: [], maxSubs: 60_000, minMultiplier: 3, minViews: 10_000, minDurationSec: 240, maxQueries: 40, region: "" },
  models: { author: "", critic: "" }, budgetUsd: 0,
};
const lines = (s: string) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const langLabel = (v: string) => CONTENT_LANGUAGES.find((l) => l.value === v)?.label ?? v;

function ChannelForm({ initial, onDone }: { initial?: Channel; onDone: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<ChannelDraft>(() => initial ? { ...EMPTY, ...initial } : EMPTY);
  const [samples, setSamples] = useState((initial?.samples ?? []).join("\n"));
  const [seeds, setSeeds] = useState((initial?.radar.seeds ?? []).join("\n"));
  const set = <K extends keyof ChannelDraft>(k: K, v: ChannelDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setRadar = (k: keyof ChannelDraft["radar"], v: number | string) => setD((x) => ({ ...x, radar: { ...x.radar, [k]: v } }));
  const save = useMutation({
    mutationFn: () => {
      // Голос и визуал настраиваются в своих разделах — форма профиля их не перезаписывает.
      const { voice: _v, visual: _vis, ...rest } = d as ChannelDraft & { id?: string; createdAt?: string; updatedAt?: string; archived?: boolean };
      const { id: _i, createdAt: _c, updatedAt: _u, archived: _a, ...body } = rest as Record<string, unknown>;
      const payload = { ...body, samples: lines(samples).slice(0, 5), radar: { ...d.radar, seeds: lines(seeds).slice(0, 40) } };
      return initial ? api<Channel>(`/studio/channels/${initial.id}`, { method: "PATCH", json: payload }) : api<Channel>("/studio/channels", { method: "POST", json: payload });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["studio-channels"] }); onDone(); },
  });
  const field = "block space-y-1 text-sm";
  return <Card className="space-y-5 p-5" data-testid="channel-form">
    <SectionTitle>{initial ? `Профиль: ${initial.name}` : "Новый канал"}</SectionTitle>
    <div className="grid gap-4 md:grid-cols-3">
      <label className={field}><Label required>Название</Label><Input value={d.name} maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder="Например, Dark Psychology EN" /></label>
      <label className={field}><Label>Язык роликов</Label><Select value={d.language} onChange={(e) => set("language", e.target.value)}>{CONTENT_LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</Select></label>
      <label className={field}><Label hint="минут">Длина ролика</Label><Input type="number" min={1} max={120} value={d.lengthMin} onChange={(e) => set("lengthMin", Number(e.target.value) || 10)} /></label>
      <label className={field}><Label>Ниша</Label><Input value={d.niche} maxLength={300} onChange={(e) => set("niche", e.target.value)} placeholder="психология поведения" /></label>
      <label className={field}><Label>Зрители</Label><Input value={d.audience} maxLength={500} onChange={(e) => set("audience", e.target.value)} placeholder="кто смотрит и зачем" /></label>
      <label className={field}><Label>Формат</Label><Input value={d.format} maxLength={300} onChange={(e) => set("format", e.target.value)} placeholder="2D-анимация, рассказ от автора" /></label>
    </div>
    <div className="grid gap-4 md:grid-cols-2">
      <Textarea label="Стиль подачи" hint="Как звучит канал: тон, длина фраз, обращение к зрителю." value={d.style} maxLength={4000} onChange={(e) => set("style", e.target.value)} />
      <Textarea label="Правила канала" hint="Что обязательно и что запрещено в сценарии. Учитываются сценаристом и проверкой." value={d.skills} maxLength={20000} onChange={(e) => set("skills", e.target.value)} />
    </div>
    <SectionTitle>Радар «Идеи для канала»</SectionTitle>
    <div className="grid gap-4 md:grid-cols-2">
      <Textarea label="Каналы-образцы" hint="До 5 ссылок, по одной в строке: youtube.com/@Name. Радар ищет каналы того же типа." value={samples} onChange={(e) => setSamples(e.target.value)} />
      <Textarea label="Свои поисковые запросы" hint="По одному в строке (необязательно). Без них Радар соберёт запросы из образцов и ниши." value={seeds} onChange={(e) => setSeeds(e.target.value)} />
    </div>
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
      <label className={field}><Label>Подписчиков до</Label><Input type="number" min={100} step={1000} value={d.radar.maxSubs} onChange={(e) => setRadar("maxSubs", Number(e.target.value) || 60000)} /></label>
      <label className={field}><Label>Множитель от</Label><Input type="number" min={1} step={0.5} value={d.radar.minMultiplier} onChange={(e) => setRadar("minMultiplier", Number(e.target.value) || 3)} /></label>
      <label className={field}><Label>Просмотров от</Label><Input type="number" min={0} step={1000} value={d.radar.minViews} onChange={(e) => setRadar("minViews", Number(e.target.value) || 0)} /></label>
      <label className={field}><Label hint="мин">Ролик не короче</Label><Input type="number" min={0} max={120} value={Math.round(d.radar.minDurationSec / 60)} onChange={(e) => setRadar("minDurationSec", (Number(e.target.value) || 0) * 60)} /></label>
      <label className={field}><Label>Запросов за поиск</Label><Input type="number" min={5} max={60} value={d.radar.maxQueries} onChange={(e) => setRadar("maxQueries", Math.min(60, Math.max(5, Number(e.target.value) || 40)))} /></label>
      <label className={field}><Label hint="US, GB…">Регион</Label><Input value={d.radar.region} maxLength={2} onChange={(e) => setRadar("region", e.target.value.toUpperCase())} /></label>
    </div>
    <SectionTitle>Модели и бюджет</SectionTitle>
    <div className="grid gap-4 md:grid-cols-3">
      <label className={field}><Label>Модель-автор</Label><Input value={d.models.author} maxLength={120} onChange={(e) => set("models", { ...d.models, author: e.target.value })} placeholder="как в Настройках (сценарий)" /></label>
      <label className={field}><Label>Модель-критик</Label><Input value={d.models.critic} maxLength={120} onChange={(e) => set("models", { ...d.models, critic: e.target.value })} placeholder="другая семья моделей, выбирается сама" /></label>
      <label className={field}><Label hint="$ в месяц, 0 — общий лимит">Бюджет канала</Label><Input type="number" min={0} step={1} value={d.budgetUsd} onChange={(e) => set("budgetUsd", Math.max(0, Number(e.target.value) || 0))} /></label>
    </div>
    <label className={field}><Label hint="необязательно">Ваш канал на YouTube</Label><Input value={d.ownChannel} maxLength={200} onChange={(e) => set("ownChannel", e.target.value)} placeholder="youtube.com/@ваш-канал" /></label>
    <p className="text-sm text-muted-foreground">Голос озвучки выбирается в разделе <Link to="/studio/voice" className="text-primary hover:underline">Озвучка</Link>, стиль картинок и персонажи — в разделе <Link to="/studio/visual" className="text-primary hover:underline">Визуал</Link>.</p>
    {save.error && <ErrorAlert error={save.error} />}
    <div className="flex flex-wrap gap-3">
      <Button className="min-h-11" loading={save.isPending} loadingText="Сохраняю…" disabled={!d.name.trim()} onClick={() => save.mutate()}>Сохранить</Button>
      <Button className="min-h-11" variant="ghost" onClick={onDone}>Отмена</Button>
    </div>
  </Card>;
}

export default function Channels() {
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const list = useChannels(showArchived);
  const [editing, setEditing] = useState<Channel | "new" | null>(null);
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "activate" | "archive" | "restore" }) => action === "activate"
      ? api(`/studio/channels/${id}/activate`, { method: "POST" })
      : api(`/studio/channels/${id}/archive`, { method: "POST", json: { archived: action === "archive" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["studio-channels"] }),
  });
  const channels = list.data?.channels ?? [];
  const styles = useVisualStyles();
  return <div className="space-y-6" data-testid="channels-page">
    <ToolHeader icon={Users} title="Каналы" eyebrow="// ВЫПУСК 1" subtitle="Профиль на каждый канал: ниша, язык, длина, стиль, образцы для Радара, голос и своя часть бюджета"
      right={!editing && <Button className="min-h-11" onClick={() => setEditing("new")}><Plus className="h-4 w-4" />Добавить канал</Button>} />
    {list.error && <ErrorAlert error={list.error} />}
    {act.error && <ErrorAlert error={act.error} />}
    {editing && <ChannelForm key={editing === "new" ? "new" : editing.id} initial={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}
    {!editing && list.data && channels.length === 0 && <Card className="space-y-3 p-6">
      <p className="text-lg font-semibold">Каналов пока нет</p>
      <p className="text-sm text-muted-foreground">Создайте профиль первого канала: укажите язык, нишу, длину роликов и 1–5 каналов-образцов. Остальное можно заполнить позже.</p>
      <Button className="min-h-11 w-fit" onClick={() => setEditing("new")}><Plus className="h-4 w-4" />Создать канал</Button>
    </Card>}
    <div className="grid gap-4 lg:grid-cols-2">
      {channels.map((c) => {
        const active = c.id === list.data?.activeId, spend = list.data?.spend[c.id];
        return <Card key={c.id} className="space-y-3 p-5" data-testid="channel-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-bold" dir="auto">{c.name}</h3>
            <div className="flex gap-2">{active && <Badge tone="primary">активный</Badge>}{c.archived && <Badge>в архиве</Badge>}</div>
          </div>
          <p className="text-sm text-muted-foreground">{langLabel(c.language)} · ролики ≈ {c.lengthMin} мин{c.niche ? ` · ${c.niche}` : ""}</p>
          <ul className="space-y-1 text-sm">
            <li>Радар: подписчиков до {num(c.radar.maxSubs)}, множитель от {c.radar.minMultiplier}×, образцов {c.samples.length}</li>
            <li>Голос: {c.voice.templateSource === "mine" ? (c.voice.ownTemplateId ? `мой шаблон «${c.voice.ownTemplateName || c.voice.ownTemplateId}»` : "мой шаблон не выбран") : c.voice.voiceId ? `${c.voice.voiceName || c.voice.voiceId} (${c.voice.service})` : "не выбран"}</li>
            <li>Визуал: {c.visual?.styleId || c.visual?.anchor ? (styles.data?.find((s) => s.id === c.visual.styleId)?.name ?? (c.visual.anchor ? "свой стиль" : "стиль выбран")) : "стиль не выбран"}{c.visual?.cast.length ? ` · персонажей и локаций: ${c.visual.cast.length}` : ""}</li>
            <li>Расход в этом месяце: ${(spend?.usd ?? 0).toFixed(2)}{c.budgetUsd ? ` из $${c.budgetUsd}` : ""}{spend?.unknown ? ` · без цены: ${spend.unknown}` : ""}</li>
          </ul>
          <div className="flex flex-wrap gap-2">
            {!active && !c.archived && <Button variant="outline" size="sm" className="min-h-11" onClick={() => act.mutate({ id: c.id, action: "activate" })}><Star className="h-4 w-4" />Сделать активным</Button>}
            {!c.archived && <Button variant="outline" size="sm" className="min-h-11" onClick={() => setEditing(c)}><Pencil className="h-4 w-4" />Изменить</Button>}
            {!c.archived && <Link to="/ideas" onClick={() => !active && act.mutate({ id: c.id, action: "activate" })} className="inline-flex min-h-11 items-center rounded-md px-3 text-xs text-primary hover:bg-primary/10">Идеи для канала →</Link>}
            {!c.archived && <Link to="/studio/visual" onClick={() => !active && act.mutate({ id: c.id, action: "activate" })} className="inline-flex min-h-11 items-center rounded-md px-3 text-xs text-primary hover:bg-primary/10">Визуал →</Link>}
            {!c.archived ? <Button variant="ghost" size="sm" className="min-h-11" onClick={() => { if (window.confirm(`Убрать «${c.name}» в архив? Идеи и проекты сохранятся.`)) act.mutate({ id: c.id, action: "archive" }); }}><Archive className="h-4 w-4" />В архив</Button>
              : <Button variant="outline" size="sm" className="min-h-11" onClick={() => act.mutate({ id: c.id, action: "restore" })}><RotateCcw className="h-4 w-4" />Вернуть</Button>}
          </div>
        </Card>;
      })}
    </div>
    <label className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Показать архивные каналы</label>
  </div>;
}
