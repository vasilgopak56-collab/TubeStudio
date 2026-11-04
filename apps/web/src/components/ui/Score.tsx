import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const toneOf = (v: number, max: number) => (v / max >= 0.8 ? "success" : v / max >= 0.6 ? "primary" : "accent");

export function ScoreRing({ value, max = 100, size = 72, label, sub }: { value: number; max?: number; size?: number; label?: ReactNode; sub?: ReactNode }) {
  const r = (size - 8) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, value / max));
  const tone = toneOf(value, max);
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="6" />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`hsl(var(--${tone}))`} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - p)} />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center leading-none">
          <span className="text-xl font-extrabold">{value}</span>
          {sub ?? <span className="font-mono text-[10px] text-muted-foreground">/{max}</span>}
        </div>
      </div>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </div>
  );
}

export function ScoreBar({ value, max = 100, className }: { value: number; max?: number; className?: string }) {
  const tone = toneOf(value, max);
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: `hsl(var(--${tone}))` }} />
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div>
      {label && <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>{label}</span><span className="font-mono">{Math.round(value)}%</span></div>}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${value}%` }} /></div>
    </div>
  );
}

export function StatTile({ icon, label, value, hint }: { icon?: ReactNode; label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3.5">
      {icon && <div className="grid h-9 w-9 place-items-center rounded-md border border-primary/40 bg-primary/10 text-primary">{icon}</div>}
      <div className="min-w-0">
        <div className="text-[11.5px] text-muted-foreground">{label}</div>
        <div className="truncate text-lg font-extrabold leading-tight">{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

export function TagPill({ tag, value, kind }: { tag: string; value?: string; kind: "gold" | "ice" }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs",
      kind === "gold" ? "border-success/40 bg-success/10 text-success" : "border-accent/40 bg-accent/10 text-accent")}>
      #{tag.replace(/^#/, "")}{value && <span className="opacity-70">· {value}</span>}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("rounded-md bg-muted", className)} />;
}
