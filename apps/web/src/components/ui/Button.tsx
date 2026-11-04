import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

type Variant = "primary" | "outline" | "ghost" | "danger";
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean; loadingText?: string; block?: boolean };

const V: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground shadow-btn hover:brightness-110 active:translate-y-[2px] active:shadow-none font-semibold",
  outline: "border border-primary/50 text-primary hover:bg-primary/10",
  ghost: "text-muted-foreground hover:text-foreground hover:bg-muted",
  danger: "border border-accent/50 text-accent hover:bg-accent/10",
};
const S = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-[15px]" };

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", size = "md", loading, loadingText = "Генерируем…", block, className, children, disabled, ...rest }, ref,
) {
  return (
    <button ref={ref} disabled={disabled || loading} aria-label={rest["aria-label"] ?? (typeof rest.title === "string" ? rest.title : undefined)}
      className={cn("inline-flex items-center justify-center gap-2 rounded-md transition disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        V[variant], S[size], block && "w-full", className)} {...rest}>
      {loading ? <><Spinner className="h-4 w-4" />{loadingText}</> : children}
    </button>
  );
});
