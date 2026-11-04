import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Карточка шага: «01 // НАЗВАНИЕ», описание, «Пропустить» справа */
export function StepCard({ n, title, description, skipped, onSkip, children, className }:
  { n: number; title: string; description?: string; skipped?: boolean; onSkip?: (v: boolean) => void; children: ReactNode; className?: string }) {
  return (
    <section className={cn("bracket-card p-5", skipped && "opacity-60", className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="mono-label text-primary">{String(n).padStart(2, "0")} // {title}</div>
          {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
        </div>
        {onSkip && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" className="accent-[hsl(var(--primary))]" checked={!!skipped} onChange={(e) => onSkip(e.target.checked)} />Пропустить
          </label>
        )}
      </div>
      <fieldset disabled={skipped}>{children}</fieldset>
    </section>
  );
}
