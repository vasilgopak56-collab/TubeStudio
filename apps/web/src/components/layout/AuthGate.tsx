import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Lock } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, ErrorAlert, Input, Spinner } from "@/components/ui";

type AuthStatus = { required: boolean; authed: boolean; passwordLogin?: boolean };

/** Reads the one-time key from ?launch=… once and removes it from the address bar. */
function takeLaunchToken(): string | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("launch");
  if (!token) return null;
  url.searchParams.delete("launch");
  window.history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
  return token;
}
let launchExchange: Promise<unknown> | null = null;

export function AuthGate({ children }: { children: (s: AuthStatus) => ReactNode }) {
  const qc = useQueryClient();
  const [launchError, setLaunchError] = useState<unknown>(null);
  const q = useQuery({
    queryKey: ["auth"],
    queryFn: async () => {
      if (!launchExchange) {
        const token = takeLaunchToken();
        launchExchange = token ? api("/auth/launch", { method: "POST", json: { token } }).catch((e) => { setLaunchError(e); }) : Promise.resolve();
      }
      await launchExchange;
      return api<AuthStatus>("/auth/status");
    },
    retry: 1,
  });
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
  if (q.data && q.data.required && !q.data.authed) {
    if (!q.data.passwordLogin)
      return (
        <div className="grid-bg grid min-h-screen place-items-center p-4">
          <Card brackets className="w-full max-w-md p-7">
            <div className="mb-4 flex items-center gap-2 text-lg font-extrabold"><KeyRound className="h-5 w-5 text-primary" />Вход в TubeStudio</div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Пароль не нужен. Откройте TubeStudio <b>ярлыком на рабочем столе</b> (или файлом «Запустить TubeStudio» в папке программы):
              программа сама создаст новый секретный ключ и откроет эту страницу уже с ним.
            </p>
            {launchError ? <div className="mt-4"><ErrorAlert error={launchError} /></div> : null}
          </Card>
        </div>
      );
    return (
      <div className="grid-bg grid min-h-screen place-items-center p-4">
        <Card brackets className="w-full max-w-sm p-7">
          <div className="mb-5 flex items-center gap-2 text-lg font-extrabold"><Lock className="h-5 w-5 text-primary" />Вход (режим разработчика)</div>
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
  }
  return <>{children(q.data!)}</>;
}
