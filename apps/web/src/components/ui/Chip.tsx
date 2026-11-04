import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
export function Chip({ active, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button type="button" aria-pressed={active}
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition",
        active ? "border-primary bg-primary text-primary-foreground font-medium" : "border-border hover:border-primary/60 hover:text-foreground text-muted-foreground",
        className)} {...rest} />
  );
}
