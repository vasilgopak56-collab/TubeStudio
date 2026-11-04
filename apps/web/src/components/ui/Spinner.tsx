import { cn } from "@/lib/cn";
export function Spinner({ className }: { className?: string }) {
  return (
    <span className="allow-anim inline-flex" role="status" aria-label="Загрузка">
      <svg className={cn("animate-spin", className)} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
        <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  );
}
