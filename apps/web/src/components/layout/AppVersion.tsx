import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const UI_VERSION: string = import.meta.env.VITE_APP_VERSION;

export function AppVersion() {
  return <span data-testid="app-version" title="Версия сборки интерфейса" className="whitespace-nowrap text-xs font-normal tracking-normal text-muted-foreground">v{UI_VERSION}</span>;
}

export function VersionNotice() {
  const q = useQuery({
    queryKey: ["app-version"],
    queryFn: async () => {
      const value = await api<{ version?: unknown }>("/version", { cache: "no-store" });
      if (typeof value?.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version) || value.version.length > 64) throw new Error("Версия недоступна");
      return value.version;
    },
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  if (!q.error && (!q.data || q.data === UI_VERSION)) return null;
  return <div role="status" data-testid="version-notice" className="mb-5 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
    {q.error ? <>Интерфейс v{UI_VERSION}. Версия сервера недоступна — совпадение версий не подтверждено.</> : <>Версии различаются: интерфейс v{UI_VERSION}, сервер v{q.data}. После завершения обновления перезапустите TubeStudio и обновите страницу.</>}
    <button type="button" disabled={q.isFetching} onClick={() => void q.refetch()} className="ml-2 inline-flex min-h-11 items-center underline underline-offset-2 disabled:opacity-50">{q.isFetching ? "Проверяем…" : "Проверить версии"}</button>
  </div>;
}
