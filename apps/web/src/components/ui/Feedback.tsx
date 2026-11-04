import { useState, type ReactNode } from "react";
import { AlertTriangle, Check, Copy, Inbox } from "lucide-react";
import { Button } from "./Button";
import { cn } from "@/lib/cn";

export function CopyButton({ text, label = "Копировать", className }: { text: string | (() => string); label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label={label}
      onClick={async () => { await navigator.clipboard.writeText(typeof text === "function" ? text() : text); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground", className)}>
      {done ? <><Check className="h-3.5 w-3.5 text-success" />Скопировано</> : <><Copy className="h-3.5 w-3.5" />{label}</>}
    </button>
  );
}

export function ErrorAlert({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-accent/40 bg-accent/10 p-4 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
      <div className="flex-1">{msg}</div>
      {onRetry && <Button size="sm" variant="danger" onClick={onRetry}>Повторить</Button>}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-lg border border-dashed px-6 py-12 text-center">
      <div className="mb-3 text-muted-foreground">{icon ?? <Inbox className="h-8 w-8" />}</div>
      <div className="font-semibold">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function StatusDot({ ok, muted }: { ok: boolean; muted?: boolean }) {
  return <span className={cn("inline-block h-2 w-2 rounded-full", muted ? "bg-muted-foreground/50" : ok ? "bg-success" : "bg-accent")} />;
}
