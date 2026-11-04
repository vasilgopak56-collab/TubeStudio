import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { CircleHelp } from "lucide-react";
import { Badge } from "./Badge";
import { helpIdForRoute } from "@/lib/help";

/** Шапка инструмента + баннер с сеткой и статичной иллюстрацией (без анимаций) */
export function ToolHeader({ icon: Icon, title, subtitle, badge, eyebrow, right }:
  { icon: LucideIcon; title: string; subtitle: string; badge?: string; eyebrow?: string; right?: ReactNode }) {
  const helpId = helpIdForRoute(useLocation().pathname);
  return (
    <header className="mb-6">
      {eyebrow && <div className="mono-label mb-3 text-primary">{eyebrow}</div>}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-primary/60 bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-[26px] font-extrabold leading-tight tracking-tight md:text-[30px]">
              {title}{badge && <Badge tone="primary">{badge}</Badge>}
            </h1>
            <p className="mt-1 text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {right}
          {helpId && <Link to={`/help#${helpId}`} title="Справка по разделу" className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13px] text-muted-foreground hover:border-primary hover:text-primary"><CircleHelp className="h-4 w-4" />Справка</Link>}
        </div>
      </div>
      <div className="bracket-card grid-bg relative mt-5 h-[120px] overflow-hidden md:h-[160px]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/.18),transparent_60%)]" />
        <div className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xl border border-primary/60 bg-card/80 text-primary shadow-[0_0_40px_-6px_hsl(var(--primary)/.6)]">
          <Icon className="h-7 w-7" />
        </div>
        <Bars className="absolute bottom-6 left-8" />
        <Bars className="absolute bottom-6 right-8" flip />
        <span className="absolute left-[30%] top-6 h-6 w-6 rounded border border-primary/30" />
        <span className="absolute right-[30%] top-10 h-5 w-5 rounded-full border border-primary/30" />
      </div>
    </header>
  );
}

function Bars({ className, flip }: { className?: string; flip?: boolean }) {
  const h = flip ? [10, 22, 14, 30] : [30, 14, 22, 10];
  return <div className={`flex items-end gap-1 ${className}`}>{h.map((x, i) => <span key={i} className="w-1.5 rounded-sm bg-primary/60" style={{ height: x }} />)}</div>;
}
