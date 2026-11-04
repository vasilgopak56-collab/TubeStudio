import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
type Tone = "default" | "primary" | "success" | "danger" | "crown";
const T: Record<Tone, string> = {
  default: "bg-secondary text-secondary-foreground border-transparent",
  primary: "border-primary/40 text-primary bg-primary/10",
  success: "border-success/40 text-success bg-success/10",
  danger: "border-accent/40 text-accent bg-accent/10",
  crown: "border-crown/40 text-crown bg-crown/10",
};
export function Badge({ tone = "default", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.06em]", T[tone], className)}>{children}</span>;
}
