import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Download, Plus, Star, Trash2, X, FolderOpen } from "lucide-react";
import { api } from "@/lib/api";
import type { SavedTopic } from "@/lib/types";
import { Badge, Button, Card, Chip, ErrorAlert, Input, Label, Select, Skeleton, Textarea, ToolHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

type Status = "plan" | "script" | "ready" | "published";
type Item = { id: string; date: string; time?: string; title: string; status: Status; format: "long" | "short"; projectId?: string; notes?: string; remindDays: number };
type Best = { day: number; hour: number; label: string; topDays: number[]; channel: string } | null;
type Proj = { id: string; title: string };

export const STATUS: Record<Status, { label: string; cls: string }> = {
  plan: { label: "План", cls: "border-muted-foreground/40 bg-muted text-foreground" },
  script: { label: "Сценарий", cls: "border-primary/50 bg-primary/15 text-primary" },
  ready: { label: "Готово", cls: "border-crown/50 bg-crown/15 text-crown" },
  published: { label: "Опубликовано", cls: "border-success/50 bg-success/15 text-success" },
};
const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const wdIdx = (d: Date) => (d.getDay() + 6) % 7; // 0 = Пн

/** Сетка месяца: 6 недель с понедельника */
function monthGrid(y: number, m: number) {
  const first = new Date(y, m, 1); const start = new Date(y, m, 1 - wdIdx(first));
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export default function Calendar() {
  const qc = useQueryClient();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [edit, setEdit] = useState<Partial<Item> | null>(null);
  const items = useQuery({ queryKey: ["calendar"], queryFn: () => api<Item[]>("/calendar") });
  const best = useQuery({ queryKey: ["calendar-best"], queryFn: () => api<Best>("/calendar/best-time") });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<Proj[]>("/projects") });
  const topics = useQuery({ queryKey: ["saved-topics"], queryFn: () => api<SavedTopic[]>("/saved-topics") });
  const inv = () => qc.invalidateQueries({ queryKey: ["calendar"] });
  const save = useMutation({
    mutationFn: (it: Partial<Item>) => it.id ? api(`/calendar/${it.id}`, { method: "PATCH", json: strip(it) }) : api("/calendar", { method: "POST", json: strip(it) }),
    onSuccess: () => { setEdit(null); inv(); },
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/calendar/${id}`, { method: "DELETE" }), onSuccess: () => { setEdit(null); inv(); } });

  const grid = useMemo(() => monthGrid(ym.y, ym.m), [ym]);
  const byDate = useMemo(() => { const m = new Map<string, Item[]>(); for (const it of items.data ?? []) (m.get(it.date) ?? m.set(it.date, []).get(it.date)!).push(it); return m; }, [items.data]);
  const monthKey = `${ym.y}-${String(ym.m + 1).padStart(2, "0")}`;
  const inMonth = (items.data ?? []).filter((i) => i.date.startsWith(monthKey));
  const upcoming = (items.data ?? []).filter((i) => i.date >= iso(now) && i.status !== "published").slice(0, 6);
  const bestDays = new Set(best.data?.topDays ?? []);
  const defTime = best.data ? `${String(best.data.hour).padStart(2, "0")}:00` : "";
  const [sp, setSp] = useSearchParams();
  useEffect(() => {
    const pid = sp.get("project");
    if (!pid) return;
    setEdit({ date: iso(now), time: defTime, status: "script", format: "long", remindDays: 1, projectId: pid, title: sp.get("title") ?? "" });
    setSp({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const shift = (d: number) => setYm(({ y, m }) => { const x = new Date(y, m + d, 1); return { y: x.getFullYear(), m: x.getMonth() }; });

  return (
    <div>
      <ToolHeader icon={CalendarDays} title="Календарь публикаций" eyebrow="// МОИ ДАННЫЕ" subtitle="План выпусков на месяц: статусы, лучшее время из анализа канала, экспорт в Google Календарь с напоминаниями" />

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Card className="p-4"><div className="mono-label">В этом месяце</div><div className="mt-1 text-2xl font-extrabold">{inMonth.length}</div><div className="text-xs text-muted-foreground">{inMonth.filter((i) => i.status === "published").length} опубликовано · {inMonth.filter((i) => i.format === "short").length} Shorts</div></Card>
        <Card className="p-4 md:col-span-2">
          <div className="mono-label flex items-center gap-1"><Star className="h-3 w-3 text-crown" />Лучшее время</div>
          {best.data ? <><div className="mt-1 text-lg font-bold">{best.data.label}</div><div className="text-xs text-muted-foreground">по анализу «{best.data.channel}» · дни со звёздочкой — самые просматриваемые</div></>
            : <div className="mt-1 text-sm text-muted-foreground">Сделайте <Link to="/analysis" className="text-primary underline">анализ канала</Link> — здесь появится лучший день и час публикации.</div>}
        </Card>
        <Card className="flex flex-col justify-center gap-2 p-4">
          <a href="/api/calendar.ics" download className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold hover:border-primary hover:text-primary"><Download className="h-4 w-4" />Скачать .ics</a>
          <div className="text-[11px] leading-snug text-muted-foreground">Импортируйте в Google/Apple Календарь — придут напоминания на телефон</div>
        </Card>
      </div>

      <Card className="p-3 md:p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => shift(-1)} title="Предыдущий месяц"><ChevronLeft className="h-4 w-4" /></Button>
          <h2 className="min-w-[160px] text-center text-lg font-bold">{MONTHS[ym.m]} {ym.y}</h2>
          <Button size="sm" variant="ghost" onClick={() => shift(1)} title="Следующий месяц"><ChevronRight className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })}>Сегодня</Button>
          <div className="ml-auto flex flex-wrap gap-1.5">{(Object.keys(STATUS) as Status[]).map((s) => <span key={s} className={cn("rounded border px-1.5 py-0.5 text-[11px]", STATUS[s].cls)}>{STATUS[s].label}</span>)}</div>
          <Button size="sm" onClick={() => setEdit({ date: iso(now), time: defTime, status: "plan", format: "long", remindDays: 1 })}><Plus className="h-4 w-4" />Запланировать</Button>
        </div>
        {items.error ? <ErrorAlert error={items.error} onRetry={() => items.refetch()} /> : items.isLoading ? <Skeleton className="h-96" /> : (
          <div className="overflow-x-auto">
            <div className="grid min-w-[700px] grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
              {WD.map((w, i) => <div key={w} className="flex items-center justify-center gap-1 bg-card py-1.5 text-xs font-semibold text-muted-foreground">{w}{bestDays.has(i) && <Star className="h-3 w-3 fill-crown text-crown" aria-label="лучший день" />}</div>)}
              {grid.map((d) => {
                const key = iso(d), list = byDate.get(key) ?? [], other = d.getMonth() !== ym.m, today = key === iso(now);
                return (
                  <div key={key} data-date={key} onClick={(e) => { if (e.target === e.currentTarget) setEdit({ date: key, time: defTime, status: "plan", format: "long", remindDays: 1 }); }}
                    className={cn("min-h-[96px] cursor-pointer bg-card p-1.5 hover:bg-muted/50", other && "opacity-45", bestDays.has(wdIdx(d)) && !other && "bg-crown/[0.04]")}>
                    <div className={cn("pointer-events-none mb-1 text-xs", today && "inline-grid h-5 w-5 place-items-center rounded-full bg-primary font-bold text-primary-foreground")}>{d.getDate()}</div>
                    <div className="space-y-1">
                      {list.map((it) => (
                        <button key={it.id} type="button" onClick={() => setEdit(it)} title={it.title}
                          className={cn("block w-full truncate rounded border px-1.5 py-0.5 text-left text-[11.5px]", STATUS[it.status].cls)}>
                          {it.time && <b className="mr-1 font-mono">{it.time}</b>}{it.format === "short" && "▮ "}{it.title}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Щёлкните по пустому месту дня, чтобы добавить выпуск; по выпуску — чтобы изменить. ▮ — Shorts.</p>
      </Card>

      {!!upcoming.length && (
        <Card className="mt-4 p-4">
          <h3 className="mb-2 font-bold">Ближайшие выпуски</h3>
          <div className="divide-y">{upcoming.map((it) => (
            <button key={it.id} type="button" onClick={() => setEdit(it)} className="flex w-full items-center gap-3 py-2 text-left text-sm hover:text-primary">
              <span className="w-28 shrink-0 font-mono text-xs text-muted-foreground">{it.date.split("-").reverse().join(".")} {it.time}</span>
              <span className="flex-1 truncate">{it.title}</span><span className={cn("rounded border px-1.5 text-[11px]", STATUS[it.status].cls)}>{STATUS[it.status].label}</span>
            </button>
          ))}</div>
        </Card>
      )}

      {edit && <Editor value={edit} onClose={() => setEdit(null)} onSave={(v) => save.mutate(v)} onDelete={edit.id ? () => del.mutate(edit.id!) : undefined}
        busy={save.isPending} error={save.error} projects={projects.data ?? []} topics={topics.data ?? []} />}
    </div>
  );
}

function strip(it: Partial<Item>) { const { id: _id, ...rest } = it as Item & { createdAt?: string; updatedAt?: string }; delete (rest as any).createdAt; delete (rest as any).updatedAt; return rest; }

function Editor({ value, onClose, onSave, onDelete, busy, error, projects, topics }:
  { value: Partial<Item>; onClose: () => void; onSave: (v: Partial<Item>) => void; onDelete?: () => void; busy: boolean; error: unknown; projects: Proj[]; topics: SavedTopic[] }) {
  const [f, setF] = useState<Partial<Item>>(value);
  const set = <K extends keyof Item>(k: K, v: Item[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-label="Выпуск">
      <Card className="max-h-[90vh] w-full max-w-lg overflow-auto p-5">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold">{f.id ? "Выпуск" : "Новый выпуск"}</h2><Button size="sm" variant="ghost" onClick={onClose} title="Закрыть"><X className="h-4 w-4" /></Button></div>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
          <div><Label required>Название</Label><Input value={f.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="О чём видео" maxLength={300} autoFocus /></div>
          {!f.id && !!topics.length && (
            <div><Label hint="заполнит название">Или из сохранённых тем</Label>
              <Select value="" onChange={(e) => { const t = topics.find((x) => x.id === e.target.value); if (t) setF((x) => ({ ...x, title: t.title, projectId: t.projectId ?? x.projectId })); }}>
                <option value="">— выбрать тему —</option>{topics.slice(0, 50).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </Select></div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Дата</Label><Input type="date" value={f.date ?? ""} onChange={(e) => set("date", e.target.value)} required /></div>
            <div><Label hint="необязательно">Время</Label><Input type="time" value={f.time ?? ""} onChange={(e) => set("time", e.target.value)} /></div>
          </div>
          <div><Label>Статус</Label><div className="flex flex-wrap gap-1.5">{(Object.keys(STATUS) as Status[]).map((s) => <Chip key={s} type="button" active={f.status === s} onClick={() => set("status", s)}>{STATUS[s].label}</Chip>)}</div></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Формат</Label><Select value={f.format} onChange={(e) => set("format", e.target.value as Item["format"])}><option value="long">Длинное видео</option><option value="short">Shorts</option></Select></div>
            <div><Label>Напомнить</Label><Select value={String(f.remindDays ?? 1)} onChange={(e) => set("remindDays", Number(e.target.value))}><option value="0">не напоминать</option><option value="1">за 1 день</option><option value="2">за 2 дня</option><option value="3">за 3 дня</option><option value="7">за неделю</option></Select></div>
          </div>
          <div><Label hint="необязательно">Проект</Label>
            <Select value={f.projectId ?? ""} onChange={(e) => set("projectId", e.target.value)}><option value="">— без проекта —</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select>
            {f.projectId && <Link to={`/projects/${f.projectId}`} className="mt-1 inline-flex items-center gap-1 text-xs text-primary underline"><FolderOpen className="h-3 w-3" />открыть проект</Link>}
          </div>
          <Textarea label="Заметки" value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} maxLength={4000} rows={3} placeholder="Идеи, ссылки, что не забыть" />
          {!!error && <ErrorAlert error={error} />}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="submit" loading={busy} loadingText="Сохраняем…" disabled={!f.title?.trim() || !f.date}>Сохранить</Button>
            <Button type="button" variant="ghost" onClick={onClose}>Отмена</Button>
            {onDelete && <Button type="button" variant="danger" className="ml-auto" onClick={() => confirm("Удалить выпуск из календаря?") && onDelete()}><Trash2 className="h-4 w-4" />Удалить</Button>}
          </div>
          {f.status !== "published" && f.id && <Badge tone="primary">совет: после выхода видео поставьте «Опубликовано»</Badge>}
        </form>
      </Card>
    </div>
  );
}
