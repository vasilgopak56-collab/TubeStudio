import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Label({ children, required, hint, counter }: { children: ReactNode; required?: boolean; hint?: ReactNode; counter?: string }) {
  return (
    <div className="mb-1.5 flex items-end justify-between gap-3">
      <span className="text-[13px] font-semibold">{children}{required && <span className="text-primary"> *</span>}
        {hint && <span className="ml-2 font-normal text-muted-foreground">{hint}</span>}</span>
      {counter && <span className="font-mono text-[11px] text-muted-foreground">{counter}</span>}
    </div>
  );
}

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("field h-10", className)} {...p} />;
}

export function Textarea({ className, value, maxLength, label, required, hint, ...p }:
  TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; hint?: ReactNode }) {
  const len = typeof value === "string" ? value.length : 0;
  return (
    <label className="block">
      {label && <Label required={required} counter={maxLength ? `${len}/${maxLength}` : undefined}>{label}</Label>}
      <textarea className={cn("field min-h-[96px] resize-y leading-relaxed", className)} value={value} maxLength={maxLength} required={required} {...p} />
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </label>
  );
}

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("field h-10 cursor-pointer pr-8", className)} {...p}>{children}</select>;
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-1">
      <span><span className="text-sm font-medium">{label}</span>{description && <span className="block text-xs text-muted-foreground">{description}</span>}</span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors", checked ? "border-primary bg-primary" : "bg-muted")}>
        <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-background transition-[left]", checked ? "left-[18px]" : "left-0.5")} />
      </button>
    </label>
  );
}
