import { useState } from "react";
import { createPortal } from "react-dom";
import { Power } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { Button, Card, ErrorAlert } from "@/components/ui";
import { cn } from "@/lib/cn";

type Phase = "idle" | "confirm" | "busy" | "closing" | "closed";

/** «Выход»: мягко останавливает TubeStudio. Если идёт задача — спрашивает ещё раз. */
export function ExitButton({ collapsed }: { collapsed?: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [busyText, setBusyText] = useState("");
  const [error, setError] = useState<unknown>(null);

  async function exit(force: boolean) {
    setError(null); setPhase("closing");
    try {
      await api("/system/exit", { method: "POST", json: { force } });
    } catch (e) {
      if (e instanceof ApiError && e.code === "BUSY") { setBusyText(e.message); setPhase("busy"); return; }
      setError(e); setPhase("confirm"); return;
    }
    // Wait until the server is really gone, then show the final screen.
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try { await fetch("/api/auth/status", { cache: "no-store" }); } catch { break; }
    }
    setPhase("closed");
  }

  return (
    <>
      <button type="button" onClick={() => setPhase("confirm")} aria-label="Выход из TubeStudio" title="Выход из TubeStudio" data-testid="exit-button"
        className={cn("flex min-h-9 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground", collapsed && "justify-center")}>
        <Power className="h-3.5 w-3.5" />{!collapsed && "Выход"}
      </button>
      {phase !== "idle" && createPortal(
        // Rendered into <body>: above every page element, whatever the sidebar's stacking context is.
        <div className={cn("fixed inset-0 z-[1000] grid place-items-center p-4", phase === "closed" ? "bg-background" : "bg-background/80 backdrop-blur-sm")} role="dialog" aria-modal="true" aria-label="Выход из TubeStudio">
          <Card brackets className="w-full max-w-md p-6">
            {phase === "closed" ? (
              <div data-testid="exit-done">
                <div className="mb-2 text-lg font-extrabold">TubeStudio закрыта</div>
                <p className="text-sm text-muted-foreground">Эту вкладку можно закрыть. Чтобы снова открыть программу, используйте ярлык TubeStudio на рабочем столе.</p>
              </div>
            ) : phase === "busy" ? (
              <>
                <div className="mb-2 text-lg font-extrabold">TubeStudio занята</div>
                <p className="mb-4 text-sm text-muted-foreground">{busyText} Если закрыть сейчас, текущая задача прервётся; уже сохранённое останется.</p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setPhase("idle")}>Подождать</Button>
                  <Button variant="danger" onClick={() => exit(true)}>Закрыть всё равно</Button>
                </div>
              </>
            ) : (
              <>
                <div className="mb-2 text-lg font-extrabold">Закрыть TubeStudio?</div>
                <p className="mb-4 text-sm text-muted-foreground">Программа остановится. Все данные уже сохранены в папке TubeStudioData.</p>
                {error ? <div className="mb-3"><ErrorAlert error={error} /></div> : null}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setPhase("idle")} disabled={phase === "closing"}>Отмена</Button>
                  <Button onClick={() => exit(false)} loading={phase === "closing"} loadingText="Закрываем…" data-testid="exit-confirm">Закрыть</Button>
                </div>
              </>
            )}
          </Card>
        </div>,
        document.body,
      )}
    </>
  );
}
