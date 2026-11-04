import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, ExternalLink, RefreshCw, Search as SearchIcon, Wallet } from "lucide-react";
import { api, type AnymodelSettings } from "@/lib/api";
import { useSaveSettings } from "@/lib/queries";
import { Badge, Button, Card, Chip, EmptyState, ErrorAlert, Input, Label, SectionTitle, Select, Skeleton, Switch, ToolHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

type Bal = { balance: number; unlimited: boolean; status: string; usd: number; usdPerMillion: number; history: { at: string; balance: number }[]; monthTokens: number };
type M = { id: string; kind: string; vendor: string; unit: string; coefIn: number | null; coefOut: number | null; usdIn: number | null; usdOut: number | null; unitTokens: number | null; unitUsd: number | null; scales: Record<string, Record<string, number>> | null; context: number | null; vision: boolean; search: boolean };
type Cat = { rate: number; models: M[]; selected: AnymodelSettings };

/** Типичный расход «сырых» токенов на операцию (замерено живым прогоном TubeStudio, ±30%) */
export const PROFILE = {
  topics: { in: 10_000, out: 3_500 },          // поиск тем: 5 тем с оценкой
  research: { in: 1_000, out: 2_500, searches: 3 }, // глубокий ресёрч (веб-поиск + досье)
  scriptPer1k: { in: 75_000, out: 7_000 },     // сценарий на 1000 слов: план, акты, подгонка объёма
  humanizePer1k: { in: 20_000, out: 6_000 },
  ttsCharsPer1k: 7_100,                        // озвучка: символов на 1000 слов (50 ток./символ)   // живой голос после генерации
  seo: { in: 20_000, out: 2_000 },
  checks: { in: 32_000, out: 7_500 },          // AI-детектор + оценка сценария + упаковка
  thumbConcepts: { in: 5_000, out: 3_000 },    // 3 концепта обложки (текст)
  storyboardPer1k: { in: 62_000, out: 17_000 },// промпты раскадровки (основная модель)
};
const fmtT = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} млн` : n >= 1e3 ? `${Math.round(n / 1e3)} тыс.` : String(Math.round(n)));
const fmtUsd = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(n < 1 ? 3 : 2)}`);

export default function AnyModel() {
  const qc = useQueryClient();
  const bal = useQuery({ queryKey: ["am-balance"], queryFn: () => api<Bal>("/anymodel/balance"), retry: false });
  const cat = useQuery({ queryKey: ["am-models"], queryFn: () => api<Cat>("/anymodel/models"), staleTime: 10 * 60_000, retry: false });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["am-balance"] }); qc.invalidateQueries({ queryKey: ["usage"] }); };

  return (
    <div>
      <ToolHeader icon={Wallet} title="AnyModel" eyebrow="// БАЛАНС И КАЛЬКУЛЯТОР" subtitle="Баланс anymodel.org, сколько стоит одно видео и на сколько видео хватит денег, цены всех моделей"
        right={<a href="https://anymodel.org/app/dashboard" target="_blank" rel="noreferrer"><Button variant="outline"><ExternalLink className="h-4 w-4" />Кабинет / пополнить</Button></a>} />
      {bal.error ? <ErrorAlert error={bal.error} /> : null}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="lg:col-span-1">
          <SectionTitle right={<Button size="sm" variant="ghost" onClick={refresh} title="Обновить"><RefreshCw className="h-3.5 w-3.5" /></Button>}>Баланс</SectionTitle>
          {!bal.data ? <Skeleton className="h-28" /> : (
            <div data-testid="am-balance">
              <div className="text-3xl font-extrabold">{bal.data.unlimited ? "∞" : fmtT(bal.data.balance)} <span className="text-base font-semibold text-muted-foreground">ток.</span></div>
              <div className="mt-1 text-sm text-muted-foreground">≈ {fmtUsd(bal.data.usd)} · статус: {bal.data.status || "—"}</div>
              <div className="mt-3 rounded-md border px-3 py-2 text-sm"><div className="flex justify-between"><span>TubeStudio за месяц</span><span className="font-mono">{fmtT(bal.data.monthTokens)} ток.</span></div>
                <div className="flex justify-between text-xs text-muted-foreground"><span>≈ в долларах</span><span>{fmtUsd((bal.data.monthTokens * bal.data.usdPerMillion) / 1e6)}</span></div></div>
              <Spark points={bal.data.history} />
            </div>
          )}
        </Card>
        <div className="lg:col-span-2"><Calc cat={cat.data} bal={bal.data} loading={cat.isLoading} error={cat.error} /></div>
      </div>
      <div className="mt-5"><Catalog cat={cat.data} loading={cat.isLoading} /></div>
    </div>
  );
}

function Spark({ points }: { points: { at: string; balance: number }[] }) {
  if (points.length < 2) return <p className="mt-3 text-xs text-muted-foreground">График расхода появится после нескольких проверок баланса.</p>;
  const xs = points.map((p) => Date.parse(p.at)), ys = points.map((p) => p.balance);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const d = points.map((p, i) => `${i ? "L" : "M"}${(((xs[i] - x0) / (x1 - x0 || 1)) * 280).toFixed(1)},${(56 - ((p.balance - y0) / (y1 - y0 || 1)) * 52).toFixed(1)}`).join(" ");
  return (
    <div className="mt-3"><div className="mono-label mb-1">История баланса</div>
      <svg viewBox="0 0 280 60" className="h-16 w-full"><path d={d} fill="none" stroke="currentColor" strokeWidth="2" className="text-primary" /></svg>
      <div className="flex justify-between text-[11px] text-muted-foreground"><span>{new Date(x0).toLocaleDateString("ru-RU")}</span><span>{new Date(x1).toLocaleDateString("ru-RU")}</span></div>
    </div>
  );
}

function Calc({ cat, bal, loading, error }: { cat?: Cat; bal?: Bal; loading: boolean; error: unknown }) {
  const sel = cat?.selected;
  const [f, setF] = useState({ videos: 8, words: 1500, research: true, humanize: true, seo: true, checks: true, thumbs: 3, thumbEdits: 2, storyboard: true, frames: 0, topics: 1, voice: true });
  const [m, setM] = useState<{ text?: string; script?: string; fast?: string; search?: string; image?: string; quality?: string }>({});
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const models = cat?.models ?? [];
  const script = m.script ?? sel?.script ?? sel?.text ?? "";
  const text = m.text ?? sel?.text ?? "", fast = m.fast ?? sel?.fast ?? "", search = m.search ?? sel?.search ?? "", image = m.image ?? sel?.image ?? "", quality = m.quality ?? sel?.imageQuality ?? "medium";
  const find = (id: string) => models.find((x) => x.id === id);

  const rows = useMemo(() => {
    const rate = cat?.rate ?? 0.05;
    const tok = (id: string, p: { in: number; out: number }, k = 1) => { const x = find(id); return Math.ceil(((p.in * (x?.coefIn ?? 1)) + (p.out * (x?.coefOut ?? 1))) * k); };
    const img = (() => { const x = find(image); if (!x) return 100_000; const q = x.scales?.quality?.[quality] ?? 1, s = x.scales?.size?.["1536x1024"] ?? 1; return Math.ceil((x.unitTokens ?? 100_000) * q * s); })();
    const k = f.words / 1000;
    const r: { label: string; model: string; tokens: number }[] = [];
    if (f.topics) r.push({ label: `Поиск тем ×${f.topics}`, model: text, tokens: tok(text, PROFILE.topics, f.topics) });
    if (f.research) r.push({ label: "Глубокий ресёрч (веб-поиск)", model: search, tokens: tok(search, PROFILE.research) + PROFILE.research.searches * 40_000 });
    r.push({ label: `Сценарий ${f.words} слов`, model: script, tokens: tok(script, PROFILE.scriptPer1k, k) });
    if (f.humanize) r.push({ label: "Живой голос", model: text, tokens: tok(text, PROFILE.humanizePer1k, k) });
    if (f.seo) r.push({ label: "SEO-пакет", model: text, tokens: tok(text, PROFILE.seo) });
    if (f.checks) r.push({ label: "Проверки (детектор, оценка, упаковка)", model: text, tokens: tok(text, PROFILE.checks) });
    if (f.thumbs) r.push({ label: `Обложки: концепты + ${f.thumbs} карт.`, model: image, tokens: tok(text, PROFILE.thumbConcepts) + f.thumbs * img });
    if (f.thumbEdits) r.push({ label: `Правки обложек ×${f.thumbEdits}`, model: image, tokens: f.thumbEdits * img });
    if (f.storyboard) r.push({ label: "Раскадровка (промпты)", model: text, tokens: tok(text, PROFILE.storyboardPer1k, k) });
    if (f.voice) r.push({ label: "Озвучка (TTS)", model: sel?.tts ?? "edge-tts", tokens: Math.ceil(PROFILE.ttsCharsPer1k * k * 50) });
    if (f.frames) r.push({ label: `Кадры раскадровки ×${f.frames}`, model: image, tokens: f.frames * img });
    const perVideo = r.reduce((s, x) => s + x.tokens, 0);
    return { r, perVideo, usd: (perVideo * rate) / 1e6, rate, img };
  }, [f, script, text, fast, search, image, quality, models, cat?.rate]);

  if (error) return <Card><ErrorAlert error={error} /></Card>;
  if (loading || !cat) return <Card><Skeleton className="h-72" /></Card>;
  const balance = bal?.balance ?? 0;
  const enough = rows.perVideo ? Math.floor(balance / rows.perVideo) : 0;
  const monthTokens = rows.perVideo * f.videos;
  const textModels = models.filter((x) => x.kind === "text"), imageModels = models.filter((x) => x.kind === "image");
  const opt = (xs: M[]) => xs.map((x) => <option key={x.id} value={x.id}>{x.id} · ×{x.coefOut ?? "?"}</option>);

  return (
    <Card>
      <SectionTitle icon={<Calculator className="h-4 w-4" />}>Калькулятор: сколько стоит видео</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label><Label>Видео в месяц</Label><Input type="number" min={1} max={200} value={f.videos} onChange={(e) => set("videos", Math.max(1, +e.target.value))} /></label>
        <label><Label>Длина сценария, слов</Label><Input type="number" min={100} max={10000} step={100} value={f.words} onChange={(e) => set("words", Math.max(100, +e.target.value))} /></label>
        <label><Label>Обложек на видео</Label><Input type="number" min={0} max={9} value={f.thumbs} onChange={(e) => set("thumbs", Math.max(0, +e.target.value))} /></label>
        <label><Label>Правок обложек</Label><Input type="number" min={0} max={20} value={f.thumbEdits} onChange={(e) => set("thumbEdits", Math.max(0, +e.target.value))} /></label>
        <label><Label>Запусков поиска тем</Label><Input type="number" min={0} max={20} value={f.topics} onChange={(e) => set("topics", Math.max(0, +e.target.value))} /></label>
        <label><Label>Картинок-кадров раскадровки</Label><Input type="number" min={0} max={300} value={f.frames} onChange={(e) => set("frames", Math.max(0, +e.target.value))} /></label>
      </div>
      <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
        <Switch checked={f.research} onChange={(v) => set("research", v)} label="Глубокий ресёрч" />
        <Switch checked={f.humanize} onChange={(v) => set("humanize", v)} label="Живой голос" />
        <Switch checked={f.seo} onChange={(v) => set("seo", v)} label="SEO" />
        <Switch checked={f.checks} onChange={(v) => set("checks", v)} label="Проверки" />
        <Switch checked={f.storyboard} onChange={(v) => set("storyboard", v)} label="Раскадровка (промпты)" />
        <Switch checked={f.voice} onChange={(v) => set("voice", v)} label="Озвучка" />
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-[13px] text-muted-foreground hover:text-foreground">Модели для расчёта (по умолчанию — из Настроек)</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label><Label>Сценарий</Label><Select value={script} onChange={(e) => setM({ ...m, script: e.target.value })}>{opt(textModels)}</Select></label>
          <label><Label>Тексты</Label><Select value={text} onChange={(e) => setM({ ...m, text: e.target.value })}>{opt(textModels)}</Select></label>
          <label><Label>Быстрые задачи</Label><Select value={fast} onChange={(e) => setM({ ...m, fast: e.target.value })}>{opt(textModels)}</Select></label>
          <label><Label>Веб-ресёрч</Label><Select value={search} onChange={(e) => setM({ ...m, search: e.target.value })}>{opt(textModels.filter((x) => x.search))}</Select></label>
          <label><Label>Картинки</Label><Select value={image} onChange={(e) => setM({ ...m, image: e.target.value })}>{opt(imageModels)}</Select></label>
          <div><Label>Качество картинок</Label><div className="flex gap-2">{["low", "medium", "high"].map((q) => <Chip key={q} active={quality === q} onClick={() => setM({ ...m, quality: q })}>{q}</Chip>)}</div></div>
        </div>
      </details>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead><tr className="mono-label text-left"><th className="py-1">Шаг</th><th>Модель</th><th className="text-right">Токены</th><th className="text-right">$</th></tr></thead>
          <tbody>{rows.r.map((x) => <tr key={x.label} className="border-t"><td className="py-1.5">{x.label}</td><td className="font-mono text-xs text-muted-foreground">{x.model}</td><td className="text-right font-mono">{fmtT(x.tokens)}</td><td className="text-right font-mono">{fmtUsd((x.tokens * rows.rate) / 1e6)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3" data-testid="am-calc">
        <Stat label="Одно видео" value={`${fmtT(rows.perVideo)} ток.`} sub={fmtUsd(rows.usd)} />
        <Stat label={`В месяц (${f.videos} видео)`} value={`${fmtT(monthTokens)} ток.`} sub={fmtUsd(rows.usd * f.videos)} />
        <Stat label="Баланса хватит на" value={`${enough} видео`} sub={bal ? `при балансе ${fmtT(balance)}` : "баланс не загружен"} accent={enough < f.videos} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Оценка по типичному расходу TubeStudio (±30%): реальная сумма зависит от длины ответов, повторов и правок. 1 картинка {quality} 1536×1024 на {image} ≈ {fmtT(rows.img)} ток. Точный расход — на Панели и в кабинете AnyModel.</p>
    </Card>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return <div className={cn("rounded-lg border p-3", accent && "border-accent/60")}><div className="mono-label">{label}</div><div className="mt-0.5 text-xl font-extrabold">{value}</div><div className="text-xs text-muted-foreground">{sub}</div></div>;
}

const KIND: Record<string, string> = { text: "Текст", image: "Картинки", video: "Видео", tts: "Озвучка", stt: "Распознавание", embedding: "Эмбеддинги", rerank: "Rerank", web: "Поиск", imageToText: "Зрение" };

function Catalog({ cat, loading }: { cat?: Cat; loading: boolean }) {
  const [q, setQ] = useState(""); const [kind, setKind] = useState("text"); const [sort, setSort] = useState<"price" | "name">("price");
  const save = useSaveSettings();
  const qc = useQueryClient();
  if (loading) return <Skeleton className="h-64" />;
  if (!cat) return null;
  const kinds = [...new Set(cat.models.map((m) => m.kind))];
  const price = (m: M) => m.usdOut ?? m.unitUsd ?? 0;
  const list = cat.models.filter((m) => m.kind === kind && m.id.toLowerCase().includes(q.toLowerCase())).sort((a, b) => (sort === "price" ? price(a) - price(b) : a.id.localeCompare(b.id)));
  const use = async (k: keyof AnymodelSettings, id: string) => { await save.mutateAsync({ anymodel: { ...cat.selected, [k]: id } } as never); qc.invalidateQueries({ queryKey: ["am-models"] }); };
  const roles = (m: M): [keyof AnymodelSettings, string][] => m.kind === "image" ? [["image", "Обложки"], ["imageAlt", "Запасная"]] : m.kind === "text" ? [["script", "Сценарии"], ["text", "Тексты"], ["textAlt", "Запасная"], ["fast", "Быстрые"], ...(m.search ? [["search", "Ресёрч"] as [keyof AnymodelSettings, string]] : [])] : [];
  return (
    <Card>
      <SectionTitle>Модели и цены <span className="ml-2 text-xs font-normal text-muted-foreground">{cat.models.length} шт. · база ${cat.rate} за 1 млн при ×1</span></SectionTitle>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs"><SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти модель" /></div>
        {kinds.map((k) => <Chip key={k} active={kind === k} onClick={() => setKind(k)}>{KIND[k] ?? k}</Chip>)}
        <Select className="ml-auto w-auto" value={sort} onChange={(e) => setSort(e.target.value as "price" | "name")}><option value="price">Сначала дешёвые</option><option value="name">По имени</option></Select>
      </div>
      {!list.length ? <EmptyState title="Ничего не найдено">Измените поиск или тип.</EmptyState> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="mono-label text-left"><th className="py-1">Модель</th><th>Множитель</th><th className="text-right">Цена</th><th className="pl-4">Назначить</th></tr></thead>
            <tbody>{list.map((m) => {
              const active = (Object.entries(cat.selected) as [string, unknown][]).filter(([, v]) => v === m.id).map(([k]) => k);
              return (
                <tr key={m.id} className={cn("border-t", active.length && "bg-primary/5")}>
                  <td className="py-1.5 font-mono text-xs">{m.id}{m.vision && <Badge className="ml-1.5">зрение</Badge>}{m.search && <Badge className="ml-1">поиск</Badge>}</td>
                  <td className="font-mono text-xs">{m.coefOut != null ? `×${m.coefIn !== m.coefOut ? `${m.coefIn}/${m.coefOut}` : m.coefOut}` : "—"}</td>
                  <td className="text-right font-mono text-xs">{m.usdOut != null ? `$${m.usdOut.toFixed(3)}/1М` : m.unitUsd != null ? `$${m.unitUsd.toFixed(4)}/${m.unit === "image" ? "карт." : m.unit}` : "—"}</td>
                  <td className="pl-4"><div className="flex flex-wrap gap-1">{roles(m).map(([k, l]) => (
                    <button key={k} type="button" disabled={save.isPending} onClick={() => use(k, m.id)} className={cn("rounded border px-1.5 py-0.5 text-[11px] hover:border-primary", active.includes(k) && "border-primary bg-primary/15 text-primary")}>{l}</button>
                  ))}</div></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Подсвечены модели, выбранные сейчас. Кнопки сразу меняют <Link to="/settings#anymodel" className="underline">Настройки → AnyModel</Link>.</p>
    </Card>
  );
}
