import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, ErrorAlert, Input, Spinner } from "@/components/ui";

type AuthStatus = { required: boolean; authed: boolean };

export function AuthGate({ children }: { children: (s: AuthStatus) => ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["auth"], queryFn: () => api<AuthStatus>("/auth/status"), retry: 1 });
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const h = () => qc.invalidateQueries({ queryKey: ["auth"] });
    window.addEventListener("ts:unauthorized", h);
    return () => window.removeEventListener("ts:unauthorized", h);
  }, [qc]);

  if (q.isLoading) return <div className="grid min-h-screen place-items-center text-muted-foreground"><Spinner className="h-6 w-6" /></div>;
  if (q.error) return <div className="mx-auto max-w-md p-8"><ErrorAlert error={q.error} onRetry={() => q.refetch()} /></div>;
  if (q.data && q.data.required && !q.data.authed)
    return (
      <div className="grid-bg grid min-h-screen place-items-center p-4">
        <Card brackets className="w-full max-w-sm p-7">
          <div className="mb-5 flex items-center gap-2 text-lg font-extrabold"><Lock className="h-5 w-5 text-primary" />Вход в TubeStudio</div>
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault(); setBusy(true); setErr(null);
            try { await api("/auth/login", { method: "POST", json: { password: pw } }); await qc.invalidateQueries(); }
            catch (x) { setErr(x); } finally { setBusy(false); }
          }}>
            <Input type="password" autoFocus placeholder="Пароль из APP_PASSWORD" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
            {err ? <ErrorAlert error={err} /> : null}
            <Button block loading={busy} loadingText="Входим…">Войти</Button>
          </form>
        </Card>
      </div>
    );
  return <>{children(q.data!)}</>;
}
