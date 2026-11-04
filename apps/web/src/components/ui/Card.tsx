import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, brackets, ...rest }: HTMLAttributes<HTMLDivElement> & { brackets?: boolean }) {
  return <div className={cn(brackets ? "bracket-card" : "rounded-lg border bg-card", "min-w-0 p-5", className)} {...rest} />;
}

export function SectionTitle({ icon, children, right }: { icon?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex min-w-0 items-center gap-2 text-[17px] font-bold">{icon && <span className="text-primary">{icon}</span>}{children}</h2>
      {right}
    </div>
  );
}
