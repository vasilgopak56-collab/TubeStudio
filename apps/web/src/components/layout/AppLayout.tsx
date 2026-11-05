import { AssistantPanel } from "@/features/assistant/AssistantPanel";
import { AppVersion, VersionNotice } from "./AppVersion";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import type { ProjectSummary } from "@/lib/types";

export function AppLayout({ authRequired }: { authRequired: boolean }) {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("ts:sidebar") === "1"; } catch { return false; } });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [assistantOpen,setAssistantOpen]=useState(false);
  const loc = useLocation();
  // Наблюдатель без собственного запроса: предупреждает в инструментах, где список не загрузился.
  const projectList = useQuery({ queryKey: ["projects"], queryFn: () => api<ProjectSummary[]>("/projects"), enabled: false });
  useEffect(() => { try { localStorage.setItem("ts:sidebar", collapsed ? "1" : "0"); } catch { /* storage unavailable */ } }, [collapsed]);
  useEffect(() => { setMobileOpen(false); window.scrollTo(0, 0); }, [loc.pathname]);
  const logout = async () => { await api("/auth/logout", { method: "POST" }); location.reload(); };
  const wide = loc.pathname === "/styles" || loc.pathname.startsWith("/analysis") || loc.pathname.startsWith("/topics") || loc.pathname.startsWith("/script") || loc.pathname.startsWith("/seo") || loc.pathname.startsWith("/check") || loc.pathname.startsWith("/storyboard") || loc.pathname.startsWith("/thumbnail") || loc.pathname === "/" || loc.pathname.startsWith("/projects") || loc.pathname.startsWith("/studio/") || loc.pathname === "/channels";
  const full = loc.pathname === "/ideas";

  return (
    <div className="flex min-h-screen">
      <div className="sticky top-0 hidden h-screen md:block">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} showLogout={authRequired} onLogout={logout} />
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 z-50 bg-background">
            <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} showLogout={authRequired} onLogout={logout} />
          </div>
          <button aria-label="Закрыть меню" onClick={() => setMobileOpen(false)} className="absolute right-3 top-3 z-50 rounded-md bg-card p-2"><X className="h-5 w-5" /></button>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur md:hidden">
          <button aria-label="Открыть меню" onClick={() => setMobileOpen(true)} className="rounded-md p-1.5 hover:bg-muted"><Menu className="h-5 w-5" /></button>
          <span className="font-extrabold">Tube<span className="text-primary">Studio</span></span>
          <AppVersion />
        </header>
        <main className={`mx-auto w-full flex-1 px-4 py-6 md:px-8 md:py-8 ${full ? "max-w-[1480px]" : wide ? "max-w-[1200px]" : "max-w-[960px]"}`}>
          <VersionNotice />
          {projectList.error && loc.pathname !== "/projects" && loc.pathname !== "/" && <div role="alert" className="mb-4 rounded border border-red-500 bg-red-500/10 p-3 text-sm"><strong>Список проектов недоступен.</strong> Данные в выборе проекта могут отсутствовать или устареть. <Link className="underline" to="/projects">Откройте «Проекты» для проверки и повтора.</Link></div>}
          <Outlet />
        </main>
      </div>
      {!assistantOpen && <button aria-label="Открыть помощника" onClick={()=>setAssistantOpen(true)} className="fixed bottom-5 right-5 z-30 rounded-full border border-primary/50 bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-lg">Помощник</button>}
      {assistantOpen && <AssistantPanel onClose={()=>setAssistantOpen(false)} />}
    </div>
  );
}
