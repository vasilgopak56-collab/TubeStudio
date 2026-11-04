import { CONTENT_LANGUAGES } from "@/lib/constants";
import { Plus, Trash2 } from "lucide-react";
import type { Level, ResearchSettingsT } from "@/lib/api";
import { Button, Card, Chip, Input, Label, SectionTitle, Select, Switch } from "@/components/ui";
import { filtersSummary } from "./FiltersPanel";

const n = (v: string, d = 0) => (v === "" ? d : Math.max(0, Number(v) || 0));

export function ResearchSettingsCard({ v, onChange }: { v: ResearchSettingsT; onChange: (v: ResearchSettingsT) => void }) {
  const set = (p: Partial<ResearchSettingsT>) => onChange({ ...v, ...p });
  const K = v.keywords, C = v.competitors, CM = v.comments ?? { perVideo: 200, order: "relevance", channelVideos: 3 };
  return (
    <Card id="research" data-testid="research-settings">
      <SectionTitle>Исследование, ключи, конкуренты (как во vidIQ)</SectionTitle>
      <div className="space-y-6">
        <section className="space-y-3">
          <h4 className="mono-label">Поиск видео и Outlier Score</h4>
          <div className="grid gap-3 sm:grid-cols-4">
            <div><Label hint="RU, US… пусто — любой">Регион</Label><Input value={v.region} maxLength={2} onChange={(e) => set({ region: e.target.value.toUpperCase() })} placeholder="любой" /></div>
            <div><Label hint="пусто — язык контента">Язык выдачи</Label><Select aria-label="Язык выдачи" value={v.language} onChange={(e) => set({ language: e.target.value })}><option value="">Авто — язык контента</option>{v.language && !CONTENT_LANGUAGES.some(l => l.value === v.language) && <option value={v.language}>{v.language} (сохранённый)</option>}{CONTENT_LANGUAGES.map(l => <option key={l.value} value={l.value} lang={l.value} dir="auto">{l.label}</option>)}</Select></div>
            <div><Label hint="×100 ед.">Глубина по умолчанию</Label><Select value={v.pages} onChange={(e) => set({ pages: +e.target.value })}>{[1, 2, 3, 4].map((x) => <option key={x} value={x}>{x * 50} видео</option>)}</Select></div>
            <div><Label>Порядок выдачи</Label><Select value={v.order} onChange={(e) => set({ order: e.target.value as ResearchSettingsT["order"] })}><option value="relevance">По релевантности</option><option value="viewCount">По просмотрам</option><option value="date">По дате</option></Select></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <div><Label>База для Outlier</Label><div className="flex flex-wrap gap-1.5">
              <Chip active={v.outlierBase === "median"} onClick={() => set({ outlierBase: "median" })}>Медиана последних видео (точно, +2 ед./канал)</Chip>
              <Chip active={v.outlierBase === "average"} onClick={() => set({ outlierBase: "average" })}>Среднее за всё время (бесплатно)</Chip></div></div>
            <div><Label>Видео в базе</Label><Input type="number" min={10} max={50} value={v.baseVideos} onChange={(e) => set({ baseVideos: Math.min(50, Math.max(10, n(e.target.value, 30))) })} /></div>
          </div>
        </section>

        <section className="space-y-2">
          <h4 className="mono-label">Правило «вирусного потенциала»</h4>
          <p className="text-[13px] text-muted-foreground">Тема считается вирусной, если Outlier ≥ порога и VPH ≥ порога для возраста видео. По умолчанию — как в разборе vidIQ: до 3 мес. VPH ≥ 100, до года ≥ 50, старше ≥ 20; Outlier ≥ 20×.</p>
          <div className="flex items-center gap-2"><Label>Outlier ≥</Label><Input type="number" className="w-24" value={v.viral.outlierMin} onChange={(e) => set({ viral: { ...v.viral, outlierMin: n(e.target.value) } })} /><span className="text-sm text-muted-foreground">×</span></div>
          {v.viral.rules.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-28 text-muted-foreground">{r.maxAgeDays ? "Возраст до" : "Любой возраст"}</span>
              <Input type="number" className="w-24" value={r.maxAgeDays} onChange={(e) => set({ viral: { ...v.viral, rules: v.viral.rules.map((x, j) => (j === i ? { ...x, maxAgeDays: n(e.target.value) } : x)) } })} aria-label="Дней (0 — любой)" />
              <span className="text-muted-foreground">дн. (0 — любой) → VPH ≥</span>
              <Input type="number" className="w-24" value={r.vphMin} onChange={(e) => set({ viral: { ...v.viral, rules: v.viral.rules.map((x, j) => (j === i ? { ...x, vphMin: n(e.target.value) } : x)) } })} aria-label="VPH" />
              <button aria-label="Удалить правило" disabled={v.viral.rules.length < 2} onClick={() => set({ viral: { ...v.viral, rules: v.viral.rules.filter((_, j) => j !== i) } })} className="rounded p-1 text-muted-foreground hover:text-accent disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          {v.viral.rules.length < 6 && <Button size="sm" variant="ghost" onClick={() => set({ viral: { ...v.viral, rules: [...v.viral.rules, { maxAgeDays: 30, vphMin: 200 }] } })}><Plus className="h-3.5 w-3.5" />Правило</Button>}
        </section>

        <section className="space-y-2">
          <h4 className="mono-label">Пресеты фильтров</h4>
          {v.presets.map((p, i) => (
            <div key={p.id} className="flex items-center gap-2 text-sm">
              <Input className="w-56" value={p.name} onChange={(e) => set({ presets: v.presets.map((x, j) => (j === i ? { ...x, name: e.target.value.slice(0, 60) } : x)) })} />
              <span className="flex-1 truncate text-xs text-muted-foreground">{filtersSummary(p.filters)}</span>
              <button aria-label="Удалить пресет" onClick={() => set({ presets: v.presets.filter((_, j) => j !== i) })} className="rounded p-1 text-muted-foreground hover:text-accent"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Новые пресеты — кнопкой «Сохранить пресет» в «Исследовании».</p>
        </section>

        <section className="space-y-3">
          <h4 className="mono-label">Ключевые слова</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><Label>Подсказки</Label><Select value={K.depth} onChange={(e) => set({ keywords: { ...K, depth: e.target.value as "fast" | "deep" } })}><option value="fast">Быстро (~15 запросов)</option><option value="deep">Глубоко: по алфавиту</option></Select></div>
            <div><Label hint="≈102 ед. каждый">Анализировать топ</Label><Input type="number" min={0} max={15} value={K.analyzeTop} onChange={(e) => set({ keywords: { ...K, analyzeTop: Math.min(15, n(e.target.value)) } })} /></div>
            <div><Label hint="при копировании">Разделитель</Label><Input value={K.separator} maxLength={5} onChange={(e) => set({ keywords: { ...K, separator: e.target.value } })} /></div>
          </div>
          <p className="text-[13px] text-muted-foreground">Автовыбор: объём ≥ <b>A</b> и конкуренция не выше <b>B</b> — или объём ≥ <b>C</b> при любой конкуренции. Не больше <b>N</b> ключей.</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <div><Label>A — мин. объём</Label><Input type="number" value={K.minVolume} onChange={(e) => set({ keywords: { ...K, minVolume: n(e.target.value) } })} /></div>
            <div><Label>B — конкуренция ≤</Label><Select value={K.maxCompetition} onChange={(e) => set({ keywords: { ...K, maxCompetition: e.target.value as Level } })}><option value="low">низкая</option><option value="medium">средняя</option><option value="high">любая</option></Select></div>
            <div><Label>C — объём для «высокой»</Label><Input type="number" value={K.highCompVolume} onChange={(e) => set({ keywords: { ...K, highCompVolume: n(e.target.value) } })} /></div>
            <div><Label>N — ключей</Label><Input type="number" min={1} max={30} value={K.maxPick} onChange={(e) => set({ keywords: { ...K, maxPick: Math.min(30, Math.max(1, n(e.target.value, 5))) } })} /></div>
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="mono-label">Конкуренты и тренд-алерты</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><Label hint="0 — вручную">Авто-обновление, ч</Label><Input type="number" min={0} max={168} value={C.refreshHours} onChange={(e) => set({ competitors: { ...C, refreshHours: Math.min(168, n(e.target.value)) } })} /></div>
            <div><Label>Видео на канал</Label><Input type="number" min={5} max={50} value={C.videosPerChannel} onChange={(e) => set({ competitors: { ...C, videosPerChannel: Math.min(50, Math.max(5, n(e.target.value, 15))) } })} /></div>
            <div className="pt-6"><Switch checked={C.alertNew} onChange={(x) => set({ competitors: { ...C, alertNew: x } })} label="Алерт о новых видео" /></div>
            <div><Label hint="0 — выкл.">Выброс ≥, ×медианы</Label><Input type="number" step="0.5" value={C.alertOutlier} onChange={(e) => set({ competitors: { ...C, alertOutlier: n(e.target.value) } })} /></div>
            <div><Label hint="0 — выкл.">Всплеск VPH ≥, ×нормы</Label><Input type="number" step="0.5" value={C.alertVphX} onChange={(e) => set({ competitors: { ...C, alertVphX: n(e.target.value) } })} /></div>
            <div><Label hint="12–36 ч; 0 — выкл.">Изменение счётчика подписчиков ≥, %</Label><Input type="number" step="0.5" value={C.alertSubsPct} onChange={(e) => set({ competitors: { ...C, alertSubsPct: n(e.target.value) } })} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="pt-6"><Switch checked={!!C.digestAuto} onChange={(x) => set({ competitors: { ...C, digestAuto: x } })} label="Авто-дайджест" description="ИИ-разбор хитов раз в период (1 вызов нейросети)" /></div>
            <div><Label>Период дайджеста, дн.</Label><Input type="number" min={1} max={60} value={C.digestDays ?? 7} onChange={(e) => set({ competitors: { ...C, digestDays: Math.min(60, Math.max(1, n(e.target.value, 7))) } })} /></div>
            <div><Label hint="3–20">Хитов в разбор</Label><Input type="number" min={3} max={20} value={C.digestTop ?? 8} onChange={(e) => set({ competitors: { ...C, digestTop: Math.min(20, Math.max(3, n(e.target.value, 8))) } })} /></div>
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="mono-label">Анализ комментариев</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><Label hint="1 ед. за 100">Комментариев на видео</Label><Input type="number" min={20} max={500} value={CM.perVideo} onChange={(e) => set({ comments: { ...CM, perVideo: Math.min(500, Math.max(20, n(e.target.value, 200))) } })} /></div>
            <div><Label>Порядок</Label><Select value={CM.order} onChange={(e) => set({ comments: { ...CM, order: e.target.value as "relevance" | "time" } })}><option value="relevance">Популярные</option><option value="time">Новые</option></Select></div>
            <div><Label hint="для ссылки на канал">Видео канала</Label><Input type="number" min={1} max={10} value={CM.channelVideos} onChange={(e) => set({ comments: { ...CM, channelVideos: Math.min(10, Math.max(1, n(e.target.value, 3))) } })} /></div>
          </div>
        </section>
      </div>
    </Card>
  );
}
