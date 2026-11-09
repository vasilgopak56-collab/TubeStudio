// Выпуск 2: «Визуал через G-Labs» — стиль канала, персонажи, сцены по озвучке, промпты, картинки и клипы, проверка, файлы для монтажа.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronRight, Clapperboard, Download, Folder, ImagePlus, Plus, RefreshCw, Trash2, Upload, Wand2, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useJob } from "@/lib/jobs";
import type { ProjectSummary } from "@/lib/types";
import { useVisualStyles } from "@/lib/visualStyles";
import { StylePicker } from "@/components/StylePicker";
import { Badge, Button, Card, ErrorAlert, Input, Label, SectionTitle, Select, StepCard, Textarea, ToolHeader } from "@/components/ui";
import { ChannelPicker, JobBox, NeedChannel, plural, useActiveChannel } from "@/features/studio/common";
import type { Board, CastItem, CastKind, Channel, Gen, GlabsCheck, PromptsResult, RedoReason, RenderSummary, Scene, VisualSettings, VisualState } from "@/features/studio/types";

const IMAGE_MODELS = [
  { v: "nano_banana_2", label: "Nano Banana 2 — по умолчанию" },
  { v: "nano_banana_pro", label: "Nano Banana Pro — лучше качество, медленнее" },
  { v: "nano_banana_2_lite", label: "Nano Banana 2 Lite — быстрее" },
] as const;
const VIDEO_MODELS = [
  { v: "veo_31_fast", label: "Veo 3.1 Fast — по умолчанию" },
  { v: "veo_31_lite", label: "Veo 3.1 Lite — экономнее" },
  { v: "veo_31_quality", label: "Veo 3.1 Quality — лучше качество, дольше" },
  { v: "omni_flash", label: "Omni Flash — от 4 до 10 с" },
] as const;
const ANIMATE = { none: "Не оживлять — только картинки", key: "Хук и ключевые сцены", every: "Каждую N-ю сцену", all: "Все сцены" } as const;
const KIND: Record<CastKind, string> = { character: "Персонаж", location: "Локация", object: "Предмет" };
const STATE: Record<Gen["state"], string> = { none: "ещё не сделано", queued: "в очереди G-Labs", running: "G-Labs рисует…", done: "готово", failed: "не удалось", waiting: "ждёт продолжения" };
const SHOT: Record<string, string> = { wide: "общий план", medium: "средний план", "close-up": "крупный план", detail: "деталь" };
const NAME_RE = /^[A-Za-z][A-Za-z0-9]{2,31}$/;
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const fileUrl = (projectId: string, local: string, v?: string) => `/files/${encodeURIComponent(projectId)}/${enc(local)}${v ? `?v=${encodeURIComponent(v)}` : ""}`;
const castUrl = (image: string, v?: string) => `/files/${enc(image)}${v ? `?v=${encodeURIComponent(v)}` : ""}`;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const settingsOf = (v: VisualSettings) => { const { cast: _c, ...rest } = v; return rest; };
type SettingsDraft = ReturnType<typeof settingsOf>;
type Edit = { concept?: string; motion?: string; animate?: boolean; picture?: { verdict: "accepted" | "redo" | null; reason?: RedoReason }; clip?: { verdict: "accepted" | "redo" | null; reason?: RedoReason } };

/** Связь с G-Labs: что не так и что сделать. */
function GlabsStatus({ q }: { q: ReturnType<typeof useGlabs> }) {
  if (q.isLoading) return <Card className="p-4 text-sm text-muted-foreground">Проверяю связь с G-Labs…</Card>;
  if (q.error) return <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />;
  const g = q.data!;
  if (g.ok) return <Card className="flex flex-wrap items-center gap-3 p-4 text-sm" data-testid="glabs-status">
    <CheckCircle2 className="h-4 w-4 text-success" /><span className="font-semibold">{g.message}</span><span className="text-muted-foreground">{g.base}</span>
    <Button variant="ghost" size="sm" className="min-h-11" onClick={() => void q.refetch()} loading={q.isFetching}><RefreshCw className="h-4 w-4" />Проверить</Button>
  </Card>;
  return <Card className="space-y-2 border-crown/40 p-4 text-sm" data-testid="glabs-status">
    <p className="font-semibold text-crown">G-Labs не на связи</p>
    <p>{g.message}</p>
    <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
      <li>Запустите программу G-Labs (нужен тариф MAX).</li>
      <li>Вкладка <b>Webhook</b> → нажмите <b>Start</b> (или включите <b>Auto-start</b>, чтобы запускалось само).</li>
      <li>Там же скопируйте <b>API key</b> и вставьте его в <Link to="/settings" className="text-primary hover:underline">Настройки → Ключи → G-Labs</Link>.</li>
    </ol>
    <Button variant="outline" size="sm" className="min-h-11" onClick={() => void q.refetch()} loading={q.isFetching}><RefreshCw className="h-4 w-4" />Проверить снова</Button>
  </Card>;
}
const useGlabs = () => useQuery({ queryKey: ["glabs-check"], queryFn: () => api<GlabsCheck>("/studio/visual/glabs"), retry: false, refetchOnWindowFocus: true, staleTime: 15_000 });

/** Стиль, модели, анимация и нарезка — настройки канала. */
function VisualSettingsCard({ channel }: { channel: Channel }) {
  const qc = useQueryClient();
  const server = JSON.stringify(settingsOf(channel.visual));
  const [d, setD] = useState<SettingsDraft>(() => settingsOf(channel.visual));
  useEffect(() => { setD(settingsOf(channel.visual)); }, [channel.id, server]);
  const styles = useVisualStyles();
  const style = styles.data?.find((s) => s.id === d.styleId);
  const set = <K extends keyof SettingsDraft>(k: K, v: SettingsDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const save = useMutation({ mutationFn: () => api(`/studio/channels/${channel.id}`, { method: "PATCH", json: { visual: d } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["studio-channels"] }) });
  const dirty = JSON.stringify(d) !== server;
  const veo = d.videoModel !== "omni_flash";
  const field = "block space-y-1 text-sm";
  return <Card className="space-y-4 p-5" data-testid="visual-settings">
    <SectionTitle>Стиль и настройки визуала канала «{channel.name}»</SectionTitle>
    <StylePicker value={d.styleId} onChange={(id) => set("styleId", id)} />
    {style && <details className="text-sm"><summary className="min-h-11 cursor-pointer py-2 text-muted-foreground">Стилевой ключ — добавляется дословно в каждый промпт</summary>
      <p className="rounded-md border bg-muted/40 p-3 text-xs leading-relaxed" dir="auto">{d.anchor || style.anchor}</p></details>}
    {!d.styleId && !d.anchor && <p className="text-sm text-crown">Выберите стиль: без него промпты не пишутся — у всех картинок ролика должен быть один стиль.</p>}
    <details className="text-sm"><summary className="min-h-11 cursor-pointer py-2 text-muted-foreground">Тонкая настройка стиля (необязательно)</summary>
      <div className="grid gap-3 md:grid-cols-2">
        <Textarea label="Свой стилевой ключ" hint="Пусто — как в выбранном стиле. На английском, одной фразой." value={d.anchor} maxLength={2000} onChange={(e) => set("anchor", e.target.value)} placeholder={style?.anchor.slice(0, 160)} />
        <Textarea label="Свой ключ движения" hint="Для анимации. Пусто — как в стиле." value={d.motion} maxLength={1000} onChange={(e) => set("motion", e.target.value)} placeholder={style?.motion.slice(0, 160)} />
        <Textarea label="Чего избегать" hint="Пусто — как в стиле." value={d.negative} maxLength={1000} onChange={(e) => set("negative", e.target.value)} placeholder={style?.negative.slice(0, 160)} />
        <label className={field}><Label hint="необязательно">Палитра</Label><Input value={d.palette} maxLength={300} onChange={(e) => set("palette", e.target.value)} placeholder="cold blues, warm candle amber, muted greys" /></label>
      </div>
    </details>
    <div className="grid gap-4 md:grid-cols-3">
      <label className={field}><Label>Модель картинок</Label><Select value={d.imageModel} onChange={(e) => set("imageModel", e.target.value as SettingsDraft["imageModel"])}>{IMAGE_MODELS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}</Select></label>
      <label className={field}><Label>Модель анимации</Label><Select value={d.videoModel} onChange={(e) => { const v = e.target.value as SettingsDraft["videoModel"]; setD((x) => ({ ...x, videoModel: v, clipSec: v !== "omni_flash" && x.clipSec === 10 ? 8 : x.clipSec })); }}>{VIDEO_MODELS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}</Select></label>
      <label className={field}><Label>Длина клипа</Label><Select value={d.clipSec} onChange={(e) => set("clipSec", Number(e.target.value) as SettingsDraft["clipSec"])}>
        <option value={8}>8 с — по умолчанию</option><option value={6}>6 с{veo ? " — только аккаунт Ultra" : ""}</option><option value={4}>4 с{veo ? " — только аккаунт Ultra" : ""}</option>{!veo && <option value={10}>10 с</option>}</Select></label>
      <label className={field}><Label>Какие сцены оживлять</Label><Select value={d.animate} onChange={(e) => set("animate", e.target.value as SettingsDraft["animate"])}>{Object.entries(ANIMATE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
      {d.animate === "every" && <label className={field}><Label>Каждую N-ю</Label><Input type="number" min={2} max={10} value={d.animateEvery} onChange={(e) => set("animateEvery", Math.min(10, Math.max(2, Number(e.target.value) || 3)))} /></label>}
      <label className={field}><Label>Формат кадра</Label><Select value={d.aspect} onChange={(e) => set("aspect", e.target.value as SettingsDraft["aspect"])}><option value="16:9">16:9 — обычный ролик</option><option value="9:16">9:16 — Shorts</option></Select></label>
      <label className={field}><Label>Нарезка на сцены</Label><Select value={d.sceneMode} onChange={(e) => set("sceneMode", e.target.value as SettingsDraft["sceneMode"])}><option value="rhythm">Ритм — по смыслу, до N секунд</option><option value="sentence">Предложение — сцена на фразу</option></Select></label>
      <label className={field}><Label hint="секунд">Сцена не длиннее</Label><Input type="number" min={3} max={10} step={1} value={d.maxSceneSec} onChange={(e) => set("maxSceneSec", Math.min(10, Math.max(3, Number(e.target.value) || 8)))} /></label>
    </div>
    {veo && (d.clipSec === 4 || d.clipSec === 6) && <p className="text-sm text-crown">Клипы Veo 4 и 6 с G-Labs делает только с аккаунтом Google Ultra. Если его нет — выберите 8 с.</p>}
    {save.error && <ErrorAlert error={save.error} />}
    <div className="flex flex-wrap items-center gap-3">
      <Button className="min-h-11" disabled={!dirty} loading={save.isPending} loadingText="Сохраняю…" onClick={() => save.mutate()}>Сохранить настройки визуала</Button>
      {dirty && <span className="text-sm text-crown">Есть несохранённые изменения</span>}
      {!dirty && save.isSuccess && <span className="text-sm text-success">Сохранено</span>}
    </div>
  </Card>;
}

const readFile = (f: File) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(new Error("Не удалось прочитать файл")); r.readAsDataURL(f); });

/** Персонажи, локации и предметы канала с эталонами: @Имя в промпте → эталон уходит в G-Labs. */
function CastCard({ channel, glabsOk }: { channel: Channel; glabsOk: boolean }) {
  const qc = useQueryClient();
  const server = channel.visual.cast;
  const pick = (c: CastItem[]) => JSON.stringify(c.map(({ name, kind, description }) => ({ name, kind, description })));
  const [items, setItems] = useState<CastItem[]>(server);
  useEffect(() => { setItems(server); }, [channel.id, pick(server)]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["studio-channels"] });
  const save = useMutation({ mutationFn: () => api(`/studio/channels/${channel.id}`, { method: "PATCH", json: { visual: { cast: items.map(({ name, kind, description }) => ({ name: name.trim(), kind, description })) } } }), onSuccess: refresh });
  const upload = useMutation({ mutationFn: async ({ name, file }: { name: string; file: File }) => {
    if (file.size > 12 * 1024 * 1024) throw new ApiError("VALIDATION", "Картинка больше 12 МБ — уменьшите её", 413);
    return api(`/studio/channels/${channel.id}/cast/${name}/image`, { method: "POST", json: { image: await readFile(file) } });
  }, onSuccess: refresh });
  const sync = useMutation({ mutationFn: () => api<{ results: { name: string; result: string; error?: string }[] }>(`/studio/channels/${channel.id}/cast/sync`, { method: "POST" }), onSuccess: refresh });
  const gen = useJob<{ name: string; image: string }>("");
  const [genName, setGenName] = useState("");
  useEffect(() => { if (gen.status === "done") void refresh(); }, [gen.status]);
  const dirty = pick(items) !== pick(server);
  const bad = items.find((c) => !NAME_RE.test(c.name.trim()));
  const dup = items.find((c, i) => items.findIndex((x) => x.name.trim().toLowerCase() === c.name.trim().toLowerCase()) !== i);
  const saved = (name: string) => server.find((c) => c.name === name);
  const upd = (i: number, p: Partial<CastItem>) => setItems((x) => x.map((c, k) => k === i ? { ...c, ...p } : c));
  return <Card className="space-y-4 p-5" data-testid="visual-cast">
    <SectionTitle right={<Button variant="outline" size="sm" className="min-h-11" disabled={items.length >= 30} onClick={() => setItems((x) => [...x, { name: "", kind: "character", description: "", image: "", glabs: "" }])}><Plus className="h-4 w-4" />Добавить</Button>}>Персонажи и локации</SectionTitle>
    <p className="text-sm text-muted-foreground">Повторяющиеся герои и места. Имя латиницей без пробелов (OldKing, ThroneHall) — в промпте оно пишется как <b>@OldKing</b>, и G-Labs рисует героя по эталону: одно лицо и одежда во всех сценах. Необязательно: без списка всё работает.</p>
    {items.length === 0 && <p className="text-sm text-muted-foreground">Список пуст.</p>}
    <ul className="space-y-3">
      {items.map((c, i) => { const s = saved(c.name.trim()); const busy = (upload.isPending && upload.variables?.name === c.name) || (gen.status === "running" && genName === c.name);
        return <li key={i} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[120px_1fr]">
          <div className="grid aspect-square place-items-center overflow-hidden rounded-md bg-muted">
            {s?.image ? <a href={castUrl(s.image, channel.updatedAt)} target="_blank" rel="noreferrer"><img src={castUrl(s.image, channel.updatedAt)} alt={`Эталон ${c.name}`} className="h-full w-full object-cover" /></a> : <span className="px-2 text-center text-xs text-muted-foreground">нет эталона</span>}
          </div>
          <div className="space-y-2">
            <div className="grid gap-2 md:grid-cols-[1fr_160px_auto]">
              <Input aria-label="Имя" value={c.name} maxLength={32} placeholder="OldKing" onChange={(e) => upd(i, { name: e.target.value.replace(/\s+/g, "") })} />
              <Select aria-label="Тип" value={c.kind} onChange={(e) => upd(i, { kind: e.target.value as CastKind })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              <Button variant="ghost" size="sm" className="min-h-11" aria-label={`Удалить ${c.name}`} onClick={() => setItems((x) => x.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
            {c.name && !NAME_RE.test(c.name) && <p className="text-xs text-accent">Латинские буквы и цифры, от 3 символов, начинается с буквы.</p>}
            <Textarea aria-label="Описание внешности" className="min-h-[64px]" value={c.description} maxLength={1500} placeholder="Elderly king, white beard, crimson cloak, tarnished crown, tired eyes" onChange={(e) => upd(i, { description: e.target.value })} hint="Внешность на английском: возраст, лицо, волосы, одежда, отличительная деталь." />
            {s ? <div className="flex flex-wrap gap-2">
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-primary/50 px-3 text-xs text-primary hover:bg-primary/10"><Upload className="h-4 w-4" />{s.image ? "Заменить эталон" : "Загрузить эталон"}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload.mutate({ name: s.name, file: f }); }} /></label>
              <Button variant="outline" size="sm" className="min-h-11" disabled={!glabsOk || gen.status === "running" || !c.description.trim()} loading={gen.status === "running" && genName === s.name} loadingText="G-Labs рисует…"
                title={!glabsOk ? "G-Labs не на связи" : !c.description.trim() ? "Сначала опишите внешность и сохраните" : undefined}
                onClick={() => { if (s.image && !window.confirm(`Заменить эталон @${s.name} новым из G-Labs? Старый сохранится в папке old.`)) return; setGenName(s.name); void gen.start({}, `/studio/channels/${channel.id}/cast/${s.name}/generate`); }}><Wand2 className="h-4 w-4" />Сделать эталон в G-Labs</Button>
            </div> : c.name && <p className="text-xs text-muted-foreground">Сохраните список — потом можно загрузить эталон.</p>}
          </div>
        </li>; })}
    </ul>
    {gen.status === "running" && <JobBox job={gen} onCancel={() => void gen.cancel()} note="Эталон — лист персонажа или доска локации в стиле канала." />}
    {gen.status === "error" && gen.error && <ErrorAlert error={gen.error} />}
    {(save.error || upload.error || sync.error) && <ErrorAlert error={save.error ?? upload.error ?? sync.error} />}
    {dup && <p className="text-sm text-accent">Имя @{dup.name} повторяется.</p>}
    <div className="flex flex-wrap items-center gap-3">
      <Button className="min-h-11" disabled={!dirty || !!bad || !!dup} loading={save.isPending} loadingText="Сохраняю…" onClick={() => save.mutate()}>Сохранить список</Button>
      {server.some((c) => c.image) && <Button variant="outline" className="min-h-11" disabled={!glabsOk || dirty} loading={sync.isPending} loadingText="Отправляю…" onClick={() => sync.mutate()} title="Необязательно: чтобы @имена работали и при ручной работе в G-Labs">Отправить в библиотеку G-Labs</Button>}
      {dirty && <span className="text-sm text-crown">Есть несохранённые изменения. Переименование сбрасывает эталон.</span>}
      {sync.data && <span className="text-sm text-muted-foreground">G-Labs: {sync.data.results.map((r) => `@${r.name} — ${r.result === "created" ? "добавлен" : r.result === "updated" ? "обновлён" : r.result === "skipped" ? "без изменений" : `ошибка: ${r.error}`}`).join("; ")}</span>}
    </div>
  </Card>;
}

/** Карточка сцены: кадр, клип, текст озвучки, описание, проверка. */
function SceneCard({ s, projectId, v, reasons, onEdit, editing }: { s: Scene; projectId: string; v: string; reasons: Record<RedoReason, string>; onEdit: (n: number, e: Edit) => void; editing: boolean }) {
  const [concept, setConcept] = useState(s.concept);
  useEffect(() => { setConcept(s.concept); }, [s.concept]);
  const [why, setWhy] = useState<"" | RedoReason>("");
  const [clipWhy, setClipWhy] = useState<"" | RedoReason>("");
  const p = s.picture, c = s.clip;
  const tone = p.verdict === "redo" ? "border-crown/60" : p.verdict === "accepted" ? "border-success/50" : p.state === "failed" ? "border-accent/50" : "";
  return <li className={`space-y-2 rounded-lg border p-3 ${tone}`} data-testid="visual-scene">
    <div className="grid aspect-video place-items-center overflow-hidden rounded-md bg-muted">
      {p.file ? <a href={fileUrl(projectId, p.file, p.at ?? v)} target="_blank" rel="noreferrer" className="h-full w-full"><img src={fileUrl(projectId, p.file, p.at ?? v)} alt={`Сцена ${s.n}`} loading="lazy" className="h-full w-full object-cover" /></a>
        : <span className="px-3 text-center text-xs text-muted-foreground">{STATE[p.state]}</span>}
    </div>
    {c.file && <video src={fileUrl(projectId, c.file, c.at ?? v)} controls preload="none" className="w-full rounded-md" aria-label={`Клип сцены ${s.n}`} />}
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <b className="font-mono">#{s.n}</b>
      <span className="font-mono text-muted-foreground">{mmss(s.start)}–{mmss(s.end)} · {s.seconds} с · {SHOT[s.shot] ?? s.shot}</span>
    </div>
    <div className="flex flex-wrap gap-1">
      {p.verdict === "accepted" && <Badge tone="success">принято</Badge>}
      {p.verdict === "redo" && <Badge tone="crown">переделать: {reasons[p.reason as RedoReason] ?? "—"}</Badge>}
      {p.file && (p.state === "queued" || p.state === "running") && <Badge tone="primary">{STATE[p.state]}</Badge>}
      {s.key && <Badge>ключевая</Badge>}
      {s.draft && <Badge tone="crown">черновик</Badge>}
      {s.cast.map((n) => <Badge key={n} tone="primary">@{n}</Badge>)}
      {s.animate && <Badge>{c.state === "done" ? (c.verdict === "redo" ? "клип: переделать" : "клип готов") : "оживить"}</Badge>}
    </div>
    <p className="text-sm" dir="auto">{s.text}</p>
    {p.error && p.state !== "done" && <p className="text-xs text-accent">{p.error}</p>}
    {c.error && c.state !== "done" && <p className="text-xs text-accent">Клип: {c.error}</p>}
    <details className="text-sm"><summary className="min-h-11 cursor-pointer py-2 text-muted-foreground">Что в кадре{s.concept ? "" : " — пусто"}</summary>
      <Textarea aria-label={`Описание кадра сцены ${s.n}`} className="min-h-[90px] text-xs" value={concept} maxLength={1500} onChange={(e) => setConcept(e.target.value)} placeholder="Опишите кадр по-английски: кто, что делает, где, свет, план" />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" className="min-h-11" disabled={editing || concept.trim() === s.concept || concept.trim().length < 10} onClick={() => onEdit(s.n, { concept: concept.trim() })}>Сохранить описание</Button>
        {s.motion && <span className="text-xs text-muted-foreground">Движение: {s.motion}</span>}
      </div>
    </details>
    <div className="flex flex-wrap items-center gap-2">
      {p.file && <Button size="sm" variant={p.verdict === "accepted" ? "primary" : "outline"} className="min-h-11" disabled={editing} onClick={() => onEdit(s.n, { picture: { verdict: p.verdict === "accepted" ? null : "accepted" } })}>{p.verdict === "accepted" ? "Принято ✓" : "Принять"}</Button>}
      {(p.file || p.state === "failed") && p.verdict !== "redo" && <>
        <Select aria-label={`Причина переделки сцены ${s.n}`} className="h-11 w-auto text-xs" value={why} onChange={(e) => setWhy(e.target.value as RedoReason)}>
          <option value="">Переделать: причина…</option>{(Object.keys(reasons) as RedoReason[]).filter((k) => k !== "motion").map((k) => <option key={k} value={k}>{reasons[k]}</option>)}</Select>
        <Button size="sm" variant="outline" className="min-h-11" disabled={!why || editing} onClick={() => { onEdit(s.n, { picture: { verdict: "redo", reason: why as RedoReason } }); setWhy(""); }}>Переделать</Button>
      </>}
      {p.verdict === "redo" && <Button size="sm" variant="ghost" className="min-h-11" disabled={editing} onClick={() => onEdit(s.n, { picture: { verdict: null } })}>Не переделывать</Button>}
      <label className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" checked={s.animate} disabled={editing} onChange={(e) => onEdit(s.n, { animate: e.target.checked })} />Оживить</label>
    </div>
    {c.file && <div className="flex flex-wrap items-center gap-2 border-t pt-2">
      <span className="text-xs text-muted-foreground">Клип:</span>
      <Button size="sm" variant={c.verdict === "accepted" ? "primary" : "outline"} className="min-h-11" disabled={editing} onClick={() => onEdit(s.n, { clip: { verdict: c.verdict === "accepted" ? null : "accepted" } })}>{c.verdict === "accepted" ? "Принят ✓" : "Принять"}</Button>
      {c.verdict !== "redo" ? <>
        <Select aria-label={`Причина переделки клипа ${s.n}`} className="h-11 w-auto text-xs" value={clipWhy} onChange={(e) => setClipWhy(e.target.value as RedoReason)}>
          <option value="">Переделать: причина…</option>{(["motion", "artifacts", "cast", "style"] as RedoReason[]).map((k) => <option key={k} value={k}>{reasons[k]}</option>)}</Select>
        <Button size="sm" variant="outline" className="min-h-11" disabled={!clipWhy || editing} onClick={() => { onEdit(s.n, { clip: { verdict: "redo", reason: clipWhy as RedoReason } }); setClipWhy(""); }}>Переделать</Button>
      </> : <Button size="sm" variant="ghost" className="min-h-11" disabled={editing} onClick={() => onEdit(s.n, { clip: { verdict: null } })}>Не переделывать</Button>}
    </div>}
  </li>;
}

type Filter = "all" | "check" | "redo" | "problems" | "animate";
const FILTERS: Record<Filter, string> = { all: "Все", check: "Проверить", redo: "Переделать", problems: "Не получилось", animate: "Оживляемые" };
const match = (s: Scene, f: Filter) => f === "all" || (f === "check" && s.picture.state === "done" && !s.picture.verdict) || (f === "redo" && (s.picture.verdict === "redo" || s.clip.verdict === "redo"))
  || (f === "problems" && (s.picture.state === "failed" || s.picture.state === "waiting" || s.clip.state === "failed" || s.clip.state === "waiting")) || (f === "animate" && s.animate);

function counts(b: Board) {
  const r = b.rows;
  const pendingPic = (s: Scene) => !!s.concept && (s.picture.state !== "done" || s.picture.verdict === "redo");
  const clipReady = (s: Scene) => s.animate && s.picture.state === "done" && s.picture.verdict !== "redo";
  return {
    total: r.length, withConcept: r.filter((s) => s.concept).length, drafts: r.filter((s) => s.draft).length,
    pics: r.filter((s) => s.picture.state === "done").length, picPending: r.filter(pendingPic).length, picWaiting: r.filter((s) => s.picture.state === "waiting").length,
    picFailed: r.filter((s) => s.picture.state === "failed").length, redo: r.filter((s) => s.picture.verdict === "redo").length, accepted: r.filter((s) => s.picture.verdict === "accepted").length,
    animate: r.filter((s) => s.animate).length, clips: r.filter((s) => s.clip.state === "done").length, clipPending: r.filter((s) => clipReady(s) && (s.clip.state !== "done" || s.clip.verdict === "redo")).length,
    clipBlocked: r.filter((s) => s.animate && !clipReady(s)).length, clipWaiting: r.filter((s) => s.clip.state === "waiting").length,
  };
}

type VideoSpend = {
  anymodel: { spentUsd: number; operations: number; unknown: number; balanceUsd: number | null; needUsd: number | null; remainingScenes: number; model: string };
  lumean: { units: number; balanceLmc: number | null };
};
/** Расход по ролику, балансы и предупреждение, если на оставшиеся промпты не хватает. */
function VideoSpendCard({ projectId }: { projectId: string }) {
  const q = useQuery({ queryKey: ["video-spend", projectId], queryFn: () => api<VideoSpend>(`/studio/visual/projects/${projectId}/spend`), retry: false, refetchOnWindowFocus: false });
  if (!q.data) return q.error ? <ErrorAlert error={q.error} /> : null;
  const { anymodel: am, lumean: lu } = q.data;
  const short = am.balanceUsd !== null && am.needUsd !== null && am.balanceUsd < am.needUsd;
  return <Card className="space-y-2 p-5" data-testid="video-spend">
    <SectionTitle>Расход и баланс</SectionTitle>
    <p className="text-sm">Расход по ролику: <b>${am.spentUsd.toFixed(4)}</b> AnyModel · операций {am.operations}{am.unknown ? ` · без цены ${am.unknown}, в сумму не вошли` : ""}{lu.units ? ` · озвучка ${lu.units.toLocaleString("ru-RU")} ед. Lumean` : ""}</p>
    <p className="text-sm">Баланс: AnyModel {am.balanceUsd === null ? "неизвестен" : <b>${am.balanceUsd.toFixed(2)}</b>} · Lumean {lu.balanceLmc === null ? "неизвестен" : <b>{lu.balanceLmc.toFixed(2)} LMC</b>}</p>
    {am.remainingScenes > 0 && am.needUsd !== null && <p className="text-sm text-muted-foreground">На оставшиеся промпты ({am.remainingScenes} сцен, {am.model}) нужно примерно ${am.needUsd.toFixed(2)}, с запасом.</p>}
    {short && <p role="alert" className="text-sm font-medium text-accent" data-testid="video-spend-short">На балансе AnyModel меньше, чем нужно для ролика. Пополните счёт, иначе промпты не допишутся.</p>}
    <p className="text-xs text-muted-foreground">Журнал программы может быть ниже реального списания: точная сумма — в кабинете AnyModel. Кредиты G-Labs программа не видит.</p>
  </Card>;
}

type ImportSide = { found: number; willImport: number[]; alreadyDone: number[]; missing: number[]; noNumber: string[]; outOfRange: string[]; duplicates: { n: number; names: string[] }[]; empty: string[]; otherType: string[] };
type ImportPreview = { imageDir: string; clipDir: string; total: number; clips: ImportSide; images: ImportSide };
type ImportResult = { clips: { imported: number; failed: string[] }; images: { imported: number; failed: string[] } };
const some = (list: (string | number)[]) => `${list.slice(0, 12).join(", ")}${list.length > 12 ? ` и ещё ${list.length - 12}` : ""}`;
function ImportSideView({ title, s }: { title: string; s: ImportSide }) {
  return <div className="space-y-1 text-sm">
    <p><b>{title}:</b> найдено {s.found} · подтянется {s.willImport.length} · уже есть {s.alreadyDone.length} · нет файла {s.missing.length}</p>
    {s.missing.length > 0 && <p className="text-xs text-muted-foreground">Сцены без файла: {some(s.missing)}</p>}
    {s.noNumber.length > 0 && <p className="text-xs text-crown">Без номера в начале имени: {some(s.noNumber)}</p>}
    {s.outOfRange.length > 0 && <p className="text-xs text-crown">Номер больше числа сцен: {some(s.outOfRange)}</p>}
    {s.duplicates.length > 0 && <p className="text-xs text-crown">Один номер у нескольких файлов, не подтянуты: {some(s.duplicates.map((d) => d.n))}</p>}
    {s.empty.length > 0 && <p className="text-xs text-crown">Пустые файлы: {some(s.empty)}</p>}
    {s.otherType.length > 0 && <p className="text-xs text-crown">Другой формат, не подтянуты: {some(s.otherType)}</p>}
  </div>;
}
type FolderList = { path: string; folders: { name: string; path: string }[]; denied: boolean };
const folderQuery = (p: string) => ({ queryKey: ["folders", p], queryFn: () => api<FolderList>(`/studio/folders${p ? `?path=${encodeURIComponent(p)}` : ""}`), retry: false, staleTime: 10_000 });
/** Ветка дерева: вложенные папки читаются только при раскрытии. */
function FolderBranch({ name, path, selected, onSelect }: { name: string; path: string; selected: string; onSelect: (p: string) => void }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({ ...folderQuery(path), enabled: open });
  return <li>
    <div className={`flex items-center gap-1 rounded ${selected === path ? "bg-primary/20" : "hover:bg-muted"}`}>
      <button type="button" aria-label={open ? `Свернуть ${name}` : `Раскрыть ${name}`} className="grid h-8 w-8 shrink-0 place-items-center" onClick={() => setOpen(!open)}>{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
      <button type="button" className="flex min-h-8 min-w-0 flex-1 items-center gap-2 py-1 text-left text-sm" onClick={() => onSelect(path)} onDoubleClick={() => setOpen(!open)}><Folder className="h-4 w-4 shrink-0 text-primary" /><span className="truncate">{name}</span></button>
    </div>
    {open && <div className="ml-4 border-l pl-1">
      {q.isLoading && <p className="px-2 py-1 text-xs text-muted-foreground">Открываю…</p>}
      {q.error && <p className="px-2 py-1 text-xs text-accent">{(q.error as Error).message}</p>}
      {q.data?.denied && <p className="px-2 py-1 text-xs text-muted-foreground">Нет доступа к этой папке</p>}
      {q.data && !q.data.denied && q.data.folders.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">Вложенных папок нет</p>}
      {q.data && q.data.folders.length > 0 && <ul>{q.data.folders.map((f) => <FolderBranch key={f.path} name={f.name} path={f.path} selected={selected} onSelect={onSelect} />)}</ul>}
    </div>}
  </li>;
}
/** Окно выбора папки по дереву компьютера. */
function FolderPicker({ title, onPick, onClose }: { title: string; onPick: (p: string) => void; onClose: () => void }) {
  const [selected, setSelected] = useState("");
  const drives = useQuery(folderQuery(""));
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", esc); return () => window.removeEventListener("keydown", esc); }, [onClose]);
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={title} data-testid="folder-picker">
    <Card className="flex max-h-[85vh] w-full max-w-xl flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2"><SectionTitle>{title}</SectionTitle><Button size="sm" variant="ghost" aria-label="Закрыть" onClick={onClose}><X className="h-4 w-4" /></Button></div>
      <div className="min-h-[260px] flex-1 overflow-auto rounded-lg border p-2">
        {drives.isLoading && <p className="p-2 text-sm text-muted-foreground">Ищу диски…</p>}
        {drives.error && <ErrorAlert error={drives.error} />}
        {drives.data && <ul>{drives.data.folders.map((f) => <FolderBranch key={f.path} name={f.name} path={f.path} selected={selected} onSelect={setSelected} />)}</ul>}
      </div>
      <p className="min-h-5 break-all font-mono text-xs text-muted-foreground">{selected || "Щёлкните по папке"}</p>
      <div className="flex justify-end gap-2"><Button variant="outline" className="min-h-11" onClick={onClose}>Отмена</Button><Button className="min-h-11" disabled={!selected} onClick={() => onPick(selected)}>Выбрать эту папку</Button></div>
    </Card>
  </div>;
}
/** Файлы, сделанные вручную: программа находит их по номеру сцены в папках этого ролика. */
function ImportCard({ projectId, channelId, disabled, sources, onDone }: { projectId: string; channelId: string; disabled: boolean; sources?: { images?: string; clips?: string }; onDone: () => void }) {
  const images = sources?.images ?? "", clips = sources?.clips ?? "";
  const [picking, setPicking] = useState<"images" | "clips" | null>(null);
  const saveFolders = useMutation({
    mutationFn: (next: { images: string; clips: string }) => api(`/studio/visual/projects/${projectId}/import/folders`, { method: "PUT", json: next }),
    onSuccess: (_d, next) => { onDone(); if (next.images && next.clips) void q.refetch(); },
  });
  const noFolders = !images || !clips;
  const q = useQuery({ queryKey: ["visual-import", projectId], queryFn: () => api<ImportPreview>(`/studio/visual/projects/${projectId}/import`), enabled: false, retry: false });
  const job = useJob<ImportResult>("");
  useEffect(() => { if (job.status === "done" || job.status === "error") { onDone(); void q.refetch(); } }, [job.status]);
  const running = job.status === "running";
  const count = q.data ? q.data.clips.willImport.length + q.data.images.willImport.length : 0;
  return <Card className="space-y-3 p-5" data-testid="visual-import">
    <SectionTitle>Файлы, сделанные вручную</SectionTitle>
    <p className="text-sm text-muted-foreground">Укажите папки с исходниками этого ролика: у каждого ролика свои. Номер сцены берётся из начала имени файла: <span className="font-mono">12_….mp4</span>. Заполняются только сцены без готового результата, ваши файлы остаются на месте.</p>
    <div className="grid gap-3 md:grid-cols-2">
      {([["images", "Выбрать папку картинок", images], ["clips", "Выбрать папку анимаций", clips]] as const).map(([k, label, value]) => <div key={k} className="space-y-1">
        <Button variant="outline" className="min-h-11" disabled={disabled || running || saveFolders.isPending} onClick={() => setPicking(k)}><Folder className="h-4 w-4" />{label}</Button>
        <p className="break-all font-mono text-xs text-muted-foreground">{value || "Папка не выбрана"}</p>
      </div>)}
    </div>
    {picking && <FolderPicker title={picking === "images" ? "Папка картинок" : "Папка анимаций"} onClose={() => setPicking(null)} onPick={(p) => { saveFolders.mutate(picking === "images" ? { images: p, clips } : { images, clips: p }); setPicking(null); }} />}
    <div className="flex flex-wrap gap-2">
    <Button variant="outline" className="min-h-11" disabled={disabled || running || noFolders} title={noFolders ? "Укажите папки" : undefined} loading={q.isFetching} loadingText="Смотрю папку…" onClick={() => void q.refetch()}>Подтянуть файлы</Button>
    </div>
    {noFolders && <p role="alert" className="text-sm font-medium text-accent" data-testid="import-need-folders">Укажите папки картинок и анимаций этого ролика.</p>}
    {saveFolders.error && <ErrorAlert error={saveFolders.error} />}
    {q.error && <ErrorAlert error={q.error} />}
    {q.data && <div className="space-y-2 rounded-lg border p-3">
      <p className="break-all font-mono text-xs text-muted-foreground">Картинки: {q.data.imageDir}<br />Анимации: {q.data.clipDir}</p>
      <ImportSideView title="Анимации" s={q.data.clips} />
      <ImportSideView title="Картинки" s={q.data.images} />
      <Button className="min-h-11" disabled={disabled || running || count === 0} onClick={() => void job.start({ channelId }, `/studio/visual/projects/${projectId}/import`)}>Подтянуть: {count} {plural(count, ["файл", "файла", "файлов"])}</Button>
    </div>}
    {running && <JobBox job={job} onCancel={() => void job.cancel()} note="Уже скопированные файлы сохраняются." />}
    {job.status === "done" && job.data && <p role="status" className="text-sm text-success">Подтянуто: клипов {job.data.clips.imported}, картинок {job.data.images.imported}.</p>}
    {job.status === "done" && job.data && [...job.data.clips.failed, ...job.data.images.failed].length > 0 && <p role="alert" className="text-sm text-accent">Не подошли (файл повреждён или не того формата): {some([...job.data.clips.failed, ...job.data.images.failed])}</p>}
    {job.status === "error" && job.error && <ErrorAlert error={job.error} />}
  </Card>;
}

export default function StudioVisual() {
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const { channel, list, loading } = useActiveChannel();
  const projectId = sp.get("project") ?? "";
  const glabs = useGlabs();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<(ProjectSummary & { channelId?: string })[]>("/projects"), refetchOnWindowFocus: false });
  const withScript = (projects.data ?? []).filter((p) => (p.counts.script ?? 0) > 0).sort((a, b) => Number(b.channelId === channel?.id) - Number(a.channelId === channel?.id));
  const prompts = useJob<PromptsResult>("");
  const render = useJob<RenderSummary>("");
  const jobRunning = prompts.status === "running" || render.status === "running";
  const state = useQuery({
    queryKey: ["visual", projectId], queryFn: () => api<VisualState>(`/studio/visual/projects/${projectId}`), enabled: !!projectId, retry: false,
    refetchInterval: (q) => (q.state.data?.running || jobRunning ? 3000 : false),
  });
  const reload = () => { void qc.invalidateQueries({ queryKey: ["video-spend", projectId] }); return qc.invalidateQueries({ queryKey: ["visual", projectId] }); };
  useEffect(() => { if (prompts.status === "done" || prompts.status === "error" || render.status === "done" || render.status === "error") void reload(); }, [prompts.status, render.status]);
  const scenes = useMutation({
    mutationFn: (replace: boolean) => api(`/studio/visual/projects/${projectId}/scenes`, { method: "POST", json: { channelId: channel!.id, replace } }),
    onSuccess: reload,
    onError: (e, replace) => { const err = e as ApiError; if (!replace && (err.details as { needReplace?: boolean } | undefined)?.needReplace && window.confirm(err.message)) scenes.mutate(true); },
  });
  const draft = useMutation({ mutationFn: (onlyEmpty: boolean) => api<{ result: PromptsResult }>(`/studio/visual/projects/${projectId}/prompts`, { method: "POST", json: { channelId: channel!.id, free: true, onlyEmpty } }), onSuccess: reload });
  const edit = useMutation({ mutationFn: ({ n, e }: { n: number; e: Edit }) => api(`/studio/visual/projects/${projectId}/scenes/${n}`, { method: "PATCH", json: e }), onSuccess: reload });
  const stop = useMutation({ mutationFn: (jobId: string) => api(`/jobs/${jobId}/cancel`, { method: "POST" }), onSuccess: reload });
  const [note, setNote] = useState("");
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(30);
  useEffect(() => { setShown(30); }, [filter, projectId]);
  const b = state.data?.board ?? null;
  const c = useMemo(() => b ? counts(b) : null, [b]);
  const visible = useMemo(() => (b?.rows ?? []).filter((s) => match(s, filter)), [b, filter]);

  if (loading) return null;
  if (!list?.channels.length || !channel) return <div className="space-y-6"><ToolHeader icon={Clapperboard} title="Визуал" eyebrow="// ВЫПУСК 2" subtitle="Картинки и анимация через G-Labs" /><NeedChannel /></div>;
  const v = channel.visual;
  const hasStyle = !!(v.styleId || v.anchor.trim());
  const glabsOk = !!glabs.data?.ok;
  const busy = state.data?.running ?? null;
  const external = busy && !jobRunning ? busy : null;
  const sum = render.status === "done" ? render.data : null;
  const runPrompts = () => { if (b && c && c.withConcept > 0 && !onlyEmpty && !window.confirm(`Переписать описания всех ${c.total} сцен? Ваши правки в описаниях заменятся. Чтобы дописать только пустые, отметьте «Только пустые сцены».`)) return; void prompts.start({ channelId: channel.id, note, onlyEmpty }, `/studio/visual/projects/${projectId}/prompts`, { serverConsent: true }); };
  const runRender = (what: "images" | "clips") => void render.start({ channelId: channel.id, what }, `/studio/visual/projects/${projectId}/render`);
  const audio = state.data?.audio;
  return <div className="space-y-6" data-testid="studio-visual">
    <ToolHeader icon={Clapperboard} title="Визуал" eyebrow="// ВЫПУСК 2" subtitle="Озвучка → сцены 4–8 с → промпты в стиле канала → картинки и клипы в G-Labs → проверка → файлы для монтажа" right={<ChannelPicker disabled={jobRunning} />} />
    <GlabsStatus q={glabs} />
    <VisualSettingsCard channel={channel} />
    <CastCard channel={channel} glabsOk={glabsOk} />
    {projectId && <VideoSpendCard projectId={projectId} />}
    {projectId && b && <ImportCard projectId={projectId} channelId={channel.id} disabled={jobRunning || !!busy} sources={b.sources} onDone={() => void reload()} />}

    <Card className="space-y-4 p-5">
      <SectionTitle>Проект</SectionTitle>
      <label className="block space-y-1 text-sm"><Label>Проект со сценарием</Label>
        <Select value={projectId} disabled={jobRunning} onChange={(e) => setSp(e.target.value ? { project: e.target.value } : {}, { replace: true })}>
          <option value="">Выберите проект</option>
          {withScript.map((p) => <option key={p.id} value={p.id}>{p.title}{p.channelId === channel.id ? "" : " (другой канал)"}</option>)}
        </Select></label>
      {projects.data && withScript.length === 0 && <p className="text-sm text-muted-foreground">Проектов со сценарием нет. Напишите его в разделе <Link to="/studio/script" className="text-primary hover:underline">Сценарий</Link>.</p>}
      {state.error && <ErrorAlert error={state.error} onRetry={() => void state.refetch()} />}
      {state.data && <p className="text-sm">{audio
        ? <>Озвучка Lumean{audio.seconds ? ` · ${mmss(audio.seconds)}` : ""}{audio.subtitles ? " · есть субтитры — время сцен совпадёт с голосом" : " · без субтитров — время сцен по длине аудио"}</>
        : <span className="text-crown">Озвучки ещё нет — время сцен будет примерным. Лучше сначала <Link to={`/studio/voice?project=${projectId}`} className="text-primary hover:underline">озвучить</Link>, потом нарезать.</span>}</p>}
    </Card>

    {projectId && state.data && <>
      {external && <Card className="flex flex-wrap items-center gap-3 p-4 text-sm" role="status">
        <span className="font-semibold">Идёт работа: {external.what === "prompts" ? "пишутся промпты" : external.what === "images" ? "G-Labs делает картинки" : external.what === "clips" ? "G-Labs делает клипы" : "подтягиваются файлы"}{c ? ` · картинок ${c.pics} из ${c.total}${c.animate ? `, клипов ${c.clips} из ${c.animate}` : ""}` : ""}</span>
        {external.jobId && <Button variant="danger" size="sm" className="min-h-11" loading={stop.isPending} onClick={() => stop.mutate(external.jobId!)}><X className="h-4 w-4" />Остановить</Button>}
      </Card>}

      <StepCard n={1} title="СЦЕНЫ" description={`Текст озвучки делится на сцены до ${v.maxSceneSec} с (${v.sceneMode === "rhythm" ? "«Ритм» — по смыслу" : "«Предложение» — по фразам"}). Бесплатно, меняется в настройках выше.`}>
        <div className="flex flex-wrap items-center gap-3">
          <Button className="min-h-11" variant={b ? "outline" : "primary"} disabled={!!busy || jobRunning} loading={scenes.isPending} loadingText="Нарезаю…" onClick={() => scenes.mutate(false)}>{b ? "Нарезать заново" : "Нарезать на сцены"}</Button>
          {b && c && <span className="text-sm">{c.total} {plural(c.total, ["сцена", "сцены", "сцен"])} · в среднем {(b.rows.reduce((a, s) => a + s.seconds, 0) / Math.max(1, c.total)).toFixed(1)} с · время {b.timing === "audio" ? `по озвучке${b.matched ? ` (совпало ${b.matched}%)` : ""}` : "примерное"}</span>}
        </div>
        {b?.stale && <p className="mt-2 text-sm text-crown">Сценарий или озвучка изменились после нарезки — нарежьте заново, чтобы сцены совпали с голосом.</p>}
        {scenes.error && !(scenes.error as ApiError).details && <div className="mt-2"><ErrorAlert error={scenes.error} /></div>}
      </StepCard>

      {b && c && <>
        <StepCard n={2} title="ПРОМПТЫ" description="Для каждой сцены — что в кадре и как двигается. Стилевой ключ канала код добавляет дословно в каждый промпт.">
          {!hasStyle && <p className="mb-2 text-sm text-crown">Сначала выберите стиль канала (выше).</p>}
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Input aria-label="Пожелание к промптам" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Пожелание (необязательно): больше снега, без крупных лиц…" />
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} />Только пустые сцены</label>
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button className="min-h-11" disabled={!hasStyle || !!busy || jobRunning} loading={prompts.status === "running"} loadingText="Пишу промпты…" onClick={runPrompts}><Wand2 className="h-4 w-4" />Написать промпты — платно</Button>
            <Button variant="outline" className="min-h-11" disabled={!hasStyle || !!busy || jobRunning} loading={draft.isPending} loadingText="Готовлю…" onClick={() => draft.mutate(onlyEmpty)}>Черновик бесплатно</Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Платно — модель-режиссёр пишет кадр под каждую фразу (цену покажет подтверждение). Черновик — бесплатная заготовка из текста озвучки, её стоит поправить вручную.</p>
          <div className="mt-2"><JobBox job={prompts} onCancel={() => void prompts.cancel()} /></div>
          {draft.error && <ErrorAlert error={draft.error} />}
          {b.prompts && <p className="mt-2 text-sm">Описаний: {c.withConcept} из {c.total}{c.drafts ? ` · черновиков ${c.drafts}` : ""} · {b.prompts.free ? "черновик" : b.prompts.model ?? "модель"} · {new Date(b.prompts.at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>}
          {(b.prompts?.notes ?? []).slice(0, 5).map((n, i) => <p key={i} className="text-sm text-crown">{n}</p>)}
        </StepCard>

        <StepCard n={3} title="КАРТИНКИ В G-LABS" description={`Модель ${IMAGE_MODELS.find((m) => m.v === v.imageModel)?.label.split(" — ")[0]}, формат ${v.aspect}. Тратится квота аккаунтов G-Labs, деньги TubeStudio — нет. Готовое не делается второй раз.`}>
          <div className="flex flex-wrap items-center gap-3">
            <Button className="min-h-11" disabled={!glabsOk || !c.picPending || !!busy || jobRunning} loading={render.status === "running" && (render.partial as { what?: string } | undefined)?.what !== "clips"} loadingText="G-Labs работает…" onClick={() => runRender("images")}>
              <ImagePlus className="h-4 w-4" />{c.picWaiting ? `Продолжить (${c.picPending})` : c.pics ? `Сделать оставшиеся (${c.picPending})` : `Сделать картинки (${c.picPending})`}</Button>
            <span className="text-sm">Готово {c.pics} из {c.total}{c.redo ? ` · к переделке ${c.redo}` : ""}{c.picFailed ? ` · не удалось ${c.picFailed}` : ""}{c.accepted ? ` · принято ${c.accepted}` : ""}</span>
          </div>
          {!glabsOk && <p className="mt-2 text-sm text-crown">G-Labs не на связи — см. подсказку вверху страницы.</p>}
          {c.withConcept < c.total && <p className="mt-2 text-sm text-muted-foreground">Сцен без описания: {c.total - c.withConcept} — для них картинки не делаются.</p>}
          <div className="mt-2"><JobBox job={render} onCancel={() => void render.cancel()} note="Остановка останавливает и задания в G-Labs. Готовое сохраняется." /></div>
          {sum && <p role="status" className={`mt-2 text-sm ${sum.stop ? "text-crown" : "text-success"}`}>{sum.message}</p>}
        </StepCard>

        <StepCard n={4} title="ПРОВЕРКА" description="Посмотрите каждую картинку. «Принять» — в монтаж. «Переделать» с причиной меняет в промпте одну вещь; затем нажмите «Сделать оставшиеся».">
          <div className="mb-3 flex flex-wrap gap-2">{(Object.keys(FILTERS) as Filter[]).map((f) => <Button key={f} size="sm" variant={filter === f ? "primary" : "outline"} className="min-h-11" onClick={() => setFilter(f)}>{FILTERS[f]} · {b.rows.filter((s) => match(s, f)).length}</Button>)}</div>
          {edit.error && <ErrorAlert error={edit.error} />}
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.slice(0, shown).map((s) => <SceneCard key={s.n} s={s} projectId={projectId} v={b.updatedAt} reasons={state.data!.reasons} editing={edit.isPending} onEdit={(n, e) => edit.mutate({ n, e })} />)}
          </ul>
          {visible.length > shown && <Button variant="ghost" className="mt-3 min-h-11" onClick={() => setShown((x) => x + 30)}>Показать ещё {Math.min(30, visible.length - shown)}</Button>}
          {visible.length === 0 && <p className="text-sm text-muted-foreground">Здесь пусто.</p>}
        </StepCard>

        <StepCard n={5} title="ОЖИВИТЬ" description={`${ANIMATE[v.animate]}${v.animate === "every" ? ` (каждая ${v.animateEvery}-я)` : ""}: картинка сцены становится первым кадром клипа ${v.videoModel === "omni_flash" ? v.clipSec : Math.min(8, v.clipSec)} с без звука. Отметки «Оживить» на карточках можно менять.`}>
          <div className="flex flex-wrap items-center gap-3">
            <Button className="min-h-11" disabled={!glabsOk || !c.clipPending || !!busy || jobRunning} onClick={() => runRender("clips")}><Clapperboard className="h-4 w-4" />{c.clipWaiting ? `Продолжить клипы (${c.clipPending})` : `Сделать клипы (${c.clipPending})`}</Button>
            <span className="text-sm">Клипов {c.clips} из {c.animate}{c.clipBlocked ? ` · ждут картинку: ${c.clipBlocked}` : ""}</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Клипы расходуют видеоквоту аккаунтов G-Labs и делаются дольше картинок. Клип делается из готовой картинки, которую вы не отправили на переделку.</p>
        </StepCard>

        <StepCard n={6} title="ФАЙЛЫ ДЛЯ МОНТАЖА" description="Всё сохраняется в папку проекта: visual/001.png, 001_anim.mp4… Эти файлы и scenes.json возьмёт автомонтаж (Выпуск 3).">
          <div className="flex flex-wrap gap-3">
            {([["images.txt", "Промпты картинок (TXT)"], ["motion.txt", "Промпты анимации (TXT)"], ["scenes.json", "Сцены и тайминги (JSON)"]] as const).map(([k, label]) =>
              <a key={k} href={`/api/studio/visual/projects/${encodeURIComponent(projectId)}/export/${k}`} download className="inline-flex min-h-11 items-center gap-2 rounded-md border border-primary/50 px-3 text-sm text-primary hover:bg-primary/10"><Download className="h-4 w-4" />{label}</a>)}
            <Link to={`/projects/${projectId}`} className="inline-flex min-h-11 items-center text-sm text-primary hover:underline">Открыть проект →</Link>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">TXT — 1 строка = 1 промпт, без заголовков. Запасной ручной режим: если Webhook недоступен, загрузите TXT в G-Labs вручную.</p>
        </StepCard>
      </>}
    </>}
  </div>;
}
