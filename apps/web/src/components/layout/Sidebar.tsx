import { AppVersion, UI_VERSION } from "./AppVersion";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown, PanelLeftClose, PanelLeftOpen, LogOut, Wallet } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, type UsageT } from "@/lib/api";
import { useState, useEffect } from "react";
import { NAV } from "@/lib/nav";
import { cn } from "@/lib/cn";
import { useHealth } from "@/lib/queries";
import { StatusDot } from "@/components/ui";
import { ExitButton } from "./ExitButton";

export function Sidebar({ collapsed, onToggle, onNavigate, showLogout, onLogout }:
  { collapsed: boolean; onToggle?: () => void; onNavigate?: () => void; showLogout?: boolean; onLogout?: () => void }) {
  const { pathname } = useLocation();
  const activeGroup = NAV.find(g=>g.items.some(i=>i.to === "/" ? pathname === "/" : pathname === i.to || pathname.startsWith(i.to+"/")))?.collapsible ?? "workspace";
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try { const value = JSON.parse(localStorage.getItem("ts:nav-groups:v2") || "null");
      if (value && typeof value === "object" && !Array.isArray(value)) return {...Object.fromEntries(Object.entries(value).filter((entry): entry is [string,boolean]=>typeof entry[1] === "boolean")),[activeGroup]:true};
    } catch { /* invalid/unavailable storage */ }
    return {[activeGroup]:true};
  });
  useEffect(()=>{setOpen(o=>({...o,[activeGroup]:true}));},[pathname]);
  useEffect(()=>{try { localStorage.setItem("ts:nav-groups:v2",JSON.stringify(open)); } catch { /* storage unavailable */ }},[open]);
  const toggleGroup = (k:string) => setOpen(o=>({...o,[k]:!o[k]}));
  const { data } = useHealth();
  const required = data?.keys.filter((k) => k.required) ?? [];
  const pendingKeys = required.some(k => k.configured && (k.checkState === "unverified" || k.checkState === "stale"));
  const allOk = required.length > 0 && required.every((k) => k.ok);
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => api<UsageT>("/usage"), refetchInterval: 60_000 });
  const b = usage.error ? undefined : usage.data?.budget;
  const budgetAlert = b && (b.level === "warn" || b.level === "over" || !b.complete) ? b : null;

  return (
    <aside className={cn("native-visual-ui flex h-full min-h-0 flex-col border-r bg-card/60", collapsed ? "w-14" : "w-60")}>
      <div className={cn("flex h-14 shrink-0 items-center border-b px-3", collapsed ? "justify-center" : "justify-between")}>
        <NavLink to="/" onClick={onNavigate} title={collapsed ? `TubeStudio v${UI_VERSION} — интерфейс` : undefined} className="flex min-w-0 items-center gap-2 font-extrabold tracking-tight">
          <img src="/logo.svg" alt="" className="h-7 w-7" />
          {!collapsed && <span className="flex min-w-0 flex-col"><span>Tube<span className="text-primary">Studio</span></span><AppVersion /></span>}
        </NavLink>
        {onToggle && !collapsed && (
          <button onClick={onToggle} aria-label="Свернуть меню" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><PanelLeftClose className="h-4 w-4" /></button>
        )}
      </div>

      <nav aria-label="Разделы TubeStudio" className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {!collapsed && <div className="mb-3 flex gap-1 border-b pb-2 text-sm text-muted-foreground">
          <button type="button" className="min-h-11 flex-1 rounded px-1 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={()=>setOpen(Object.fromEntries(NAV.map(g=>[g.collapsible!,true])))}>Раскрыть всё</button>
          <button type="button" className="min-h-11 flex-1 rounded px-1 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={()=>setOpen({})}>Свернуть всё</button>
        </div>}
        {NAV.map((g) => {
          const isOpen = !!open[g.collapsible!], active=g.collapsible===activeGroup, Icon=g.items[0].icon;
          const sectionId="nav-group-"+g.collapsible;
          return <div key={g.title} className="mb-1">
            <button type="button" title={collapsed?g.title:undefined} aria-label={g.title} aria-expanded={isOpen} aria-controls={sectionId} onClick={()=>toggleGroup(g.collapsible!)}
              className={cn("flex min-h-11 w-full items-center rounded-md text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted",collapsed?"justify-center border-b border-border":"justify-between px-2",active?"text-primary":"text-muted-foreground")}>
              {collapsed?<Icon className="h-4 w-4"/>:<><span>{g.title}</span><ChevronDown className={cn("h-3.5 w-3.5 shrink-0",!isOpen&&"-rotate-90")}/></>}
            </button>
            <div id={sectionId} hidden={!isOpen}>
              {g.items.map(it=><NavLink key={it.to} to={it.to} end={it.to==="/"} onClick={onNavigate} title={collapsed?it.label:undefined}
                className={({isActive})=>cn("my-0.5 flex min-h-11 items-center gap-2 rounded-md border text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",collapsed?"justify-center":"px-2.5",isActive?"border-primary/30 bg-primary/12 font-semibold text-primary":"border-transparent text-muted-foreground hover:bg-muted hover:text-foreground")}>
                <it.icon className="h-4 w-4 shrink-0"/>{!collapsed&&<span>{it.label}</span>}
              </NavLink>)}
            </div>
          </div>;
        })}
      </nav>

      <div className="shrink-0 border-t p-2">
        {usage.error && <NavLink to="/" title="Журнал расходов недоступен: бюджет неизвестен" className="mb-1 flex items-center gap-2 rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-500"><Wallet className="h-3.5 w-3.5 shrink-0" />{!collapsed && "Бюджет неизвестен: ошибка журнала"}</NavLink>}
        {budgetAlert && (
          <NavLink to="/settings#budget" onClick={onNavigate} title={`Бюджет: $${budgetAlert.knownSpentUsd.toFixed(2)} из $${budgetAlert.limitUsd}`} data-testid="budget-alert"
            className={cn("mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs", budgetAlert.level === "over" ? "bg-red-500/10 text-red-500" : "bg-amber-500/10 text-amber-500", collapsed && "justify-center")}>
            <Wallet className="h-3.5 w-3.5 shrink-0" />{!collapsed && (budgetAlert.level === "over" ? "Бюджет исчерпан" : (!budgetAlert.complete ? "Расходы известны не полностью" : `Бюджет: ${Math.floor(budgetAlert.pct)}%`))}
          </NavLink>
        )}
        {collapsed ? (
          onToggle && <button onClick={onToggle} aria-label="Развернуть меню" className="mx-auto grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-muted"><PanelLeftOpen className="h-4 w-4" /></button>
        ) : (
          <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground">
            <NavLink to="/settings" onClick={onNavigate} className="flex items-center gap-2 hover:text-foreground">
              <StatusDot ok={allOk} muted={!data || pendingKeys} />{!data ? "Читаем статус ключей…" : pendingKeys ? "Ключи требуют проверки" : allOk ? "Проверка API пройдена" : "Проверьте ключи API"}
            </NavLink>
            {showLogout && <button onClick={onLogout} aria-label="Выйти из сеанса" title="Выйти из сеанса" className="rounded p-1 hover:bg-muted hover:text-foreground"><LogOut className="h-3.5 w-3.5" /></button>}
          </div>
        )}
        <ExitButton collapsed={collapsed} />
      </div>
    </aside>
  );
}
