import { compact } from "@/lib/format";

/** Простой SVG-гистограмма без анимаций; подсветка лучшего столбца */
export function BarChart({ data, highlight, height = 180, valueLabel = compact }: { data: { label: string; value: number; count?: number }[]; highlight?: number; height?: number; valueLabel?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {data.map((d, i) => {
        const h = Math.max(2, (d.value / max) * (height - 40));
        const best = i === highlight && d.value > 0;
        return (
          <div key={i} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${d.label}: ${valueLabel(d.value)}${d.count != null ? ` · видео: ${d.count}` : ""}`}>
            <span className={`truncate font-mono text-[10px] ${best ? "text-primary" : "text-muted-foreground"} ${data.length > 12 ? "hidden md:block" : ""}`}>{d.value ? valueLabel(d.value) : ""}</span>
            <div className={`w-full rounded-t ${best ? "bg-primary" : d.value ? "bg-primary/30 group-hover:bg-primary/50" : "bg-muted"}`} style={{ height: h }} />
            <span className={`font-mono text-[10.5px] ${best ? "font-bold text-primary" : "text-muted-foreground"}`}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}
