import { useState } from "react";
import type { Filters } from "@/lib/api";
import { Chip, Input, Switch } from "@/components/ui";

type K = keyof Filters;
const num = (v: string) => (v.trim() === "" ? undefined : Math.max(0, Number(v.replace(/\s/g, "").replace(/k$/i, "000").replace(/m$/i, "000000")) || 0));

function Range({ label, lo, hi, f, set, hint }: { label: string; lo: K; hi?: K; f: Filters; set: (p: Partial<Filters>) => void; hint?: string }) {
  return (
    <div>
      <div className="mb-1"><div className="mono-label">{label}</div>{hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}</div>
      <div className="flex items-center gap-1.5">
        <Input aria-label={`${label} от`} inputMode="numeric" placeholder="от" className="h-9" value={(f[lo] as number | undefined) ?? ""} onChange={(e) => set({ [lo]: num(e.target.value) })} />
        {hi && <><span className="text-muted-foreground">–</span><Input aria-label={`${label} до`} inputMode="numeric" placeholder="до" className="h-9" value={(f[hi] as number | undefined) ?? ""} onChange={(e) => set({ [hi]: num(e.target.value) })} /></>}
      </div>
    </div>
  );
}

const AGES = [[0, "Любая"], [7, "7 дн."], [30, "30 дн."], [90, "3 мес."], [180, "6 мес."], [365, "Год"]] as const;
const TYPES = [["all", "Все"], ["long", "Длинные"], ["shorts", "Shorts"]] as const;

export function FiltersPanel({ f, onChange, anomaly = false }: { f: Filters; onChange: (f: Filters) => void; anomaly?: boolean }) {
  const [advanced, setAdvanced] = useState(false);
  const set = (p: Partial<Filters>) => onChange({ ...f, ...p });
  return (
    <div className="space-y-4" data-testid="filters">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Range label="Подписчики канала" lo="subsMin" hi="subsMax" f={f} set={set} hint={anomaly ? "Размер канала сейчас" : undefined} />
        <Range label="Просмотры" lo="viewsMin" hi="viewsMax" f={f} set={set} hint="50k, 1m" />
        <Range label="Просмотры / подписчики" lo="ratioMin" f={f} set={set} hint="Во сколько раз больше базы" />
        {(!anomaly || advanced) && <>
          <Range label="Outlier Score, ×" lo="outlierMin" hi="outlierMax" f={f} set={set} hint="Сравнение с нормой канала" />
          <Range label="Просмотров в час (VPH)" lo="vphMin" hi="vphMax" f={f} set={set} />
          <Range label="Длительность, мин" lo="durationMin" hi="durationMax" f={f} set={set} />
        </>}
      </div>
      {anomaly && <button type="button" onClick={() => setAdvanced(!advanced)} className="text-xs text-primary hover:underline" aria-expanded={advanced}>{advanced ? "Скрыть дополнительные фильтры" : "Дополнительные фильтры: Outlier, VPH, длительность"}</button>}
      <div className="flex flex-wrap items-end gap-6">
        <div><div className="mono-label mb-1">Опубликовано</div><div className="flex flex-wrap gap-1.5">{AGES.filter(([d]) => !anomaly || d > 0).map(([d, l]) => <Chip key={d} active={(f.ageDays ?? 0) === d} onClick={() => set({ ageDays: d || undefined })}>{l}</Chip>)}</div></div>
        <div><div className="mono-label mb-1">Тип</div><div className="flex gap-1.5">{TYPES.map(([v, l]) => <Chip key={v} active={f.type === v} onClick={() => set({ type: v })}>{l}</Chip>)}</div></div>
        {(!anomaly || advanced) && <Switch checked={f.viralOnly} onChange={(v) => set({ viralOnly: v })} label="Только вирусный потенциал" description="Правило из настроек: Outlier и VPH по возрасту видео" />}
      </div>
    </div>
  );
}

export function filtersSummary(f: Filters) {
  const p: string[] = [];
  const r = (l: string, a?: number, b?: number) => { if (a != null || b != null) p.push(`${l} ${a != null ? `≥${a}` : ""}${a != null && b != null ? " " : ""}${b != null ? `≤${b}` : ""}`); };
  r("Outlier", f.outlierMin, f.outlierMax); r("VPH", f.vphMin, f.vphMax); r("просм.", f.viewsMin, f.viewsMax); r("подп.", f.subsMin, f.subsMax); r("просм./подп.", f.ratioMin);
  if (f.ageDays) p.push(`≤${f.ageDays} дн.`); if (f.type !== "all") p.push(f.type === "long" ? "длинные" : "Shorts"); if (f.viralOnly) p.push("вирусные");
  return p.join(" · ") || "без фильтров";
}
