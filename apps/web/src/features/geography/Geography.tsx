import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Globe2, History } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, CopyButton, ErrorAlert, Input, Label, SectionTitle } from "@/components/ui";
type InputT = { title: string; startDate: string; endDate: string };
type Row = { country: string; views: number | null; minutes: number | null; sharePct: number | null };
type Brief = { id: string; createdAt: string; title: string; channel: { id: string; title: string }; requested: { startDate: string; endDate: string }; status: "returned" | "empty"; mayBeLimited: boolean; rowCount: number };
type Run = Omit<Brief, "rowCount"> & { version: 1; source: string; dimensions: "country"; metrics: string[]; rows: Row[]; totals: { returnedViews: number | null; returnedMinutes: number | null }; warnings: string[] };
const number = (v: number | null) => v === null ? "неизвестно" : v.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const when = (d: string) => new Date(d).toLocaleString("ru-RU");
const country = (code: string) => { if (code === "ZZ") return "Страна не определена"; try { return new Intl.DisplayNames(["ru"], { type: "region" }).of(code) ?? code; } catch { return code; } };
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/[\r\n]/g, " ");
export function geographyMarkdown(r: Run) {
 return `# ${cell(r.title)}\n\nКанал: ${cell(r.channel.title)} (${r.channel.id})\nСнимок: ${r.createdAt}\nЗапрошенный период: ${r.requested.startDate} — ${r.requested.endDate}\nИсточник: ${r.source}; country; views, estimatedMinutesWatched\n\nПросмотры возвращённых строк: ${number(r.totals.returnedViews)}\nМинуты возвращённых строк: ${number(r.totals.returnedMinutes)}\n\n| Страна | Просмотры | Минуты | Доля возвращённых просмотров |\n| --- | ---: | ---: | ---: |\n` + r.rows.map(x => `| ${cell(country(x.country))} (${x.country}) | ${number(x.views)} | ${number(x.minutes)} | ${x.sharePct === null ? "неизвестно" : number(x.sharePct) + "%"} |`).join("\n") + "\n\n" + r.warnings.map(w => "- " + w).join("\n") + "\n";
}
function download(name: string, text: string, mime: string) { const url = URL.createObjectURL(new Blob([text], { type: mime })), a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export default function Geography({ connected }: { connected: boolean }) {
 const qc = useQueryClient();
 const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
 const [title, setTitle] = useState(""), [startDate, setStart] = useState(() => new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10)), [endDate, setEnd] = useState(yesterday);
 const [current, setCurrent] = useState<Run | null>(null);
 const history = useQuery({ queryKey: ["geography-runs"], queryFn: () => api<{ items: Brief[]; warnings: string[] }>("/my-analytics/geography/runs"), refetchOnWindowFocus: false, retry: false });
 const save = useMutation({ mutationFn: (input: InputT) => api<Run>("/my-analytics/geography/runs", { method: "POST", json: input }), onSuccess: r => { setCurrent(r); void qc.invalidateQueries({ queryKey: ["geography-runs"] }); } });
 const open = useMutation({ mutationFn: (id: string) => api<Run>(`/my-analytics/geography/runs/${id}`), onSuccess: r => { setCurrent(r); save.reset(); } });
 const busy = save.isPending || open.isPending;
 return <div className="space-y-5" data-testid="geography">
  <Card className="p-5"><SectionTitle icon={<Globe2 className="h-4 w-4" />}>География своего канала</SectionTitle>
   <p className="mb-4 text-sm text-muted-foreground">Запрос YouTube Analytics только по кнопке ниже, через уже подключённый OAuth-канал. Без AI и платных моделей. Сохраняется отдельный локальный снимок; история читается без обращения к YouTube.</p>
   {!connected && <p className="mb-4 text-sm" role="status">Чтобы запросить новый отчёт, подключите канал на вкладке «Обзор». Сохранённая история доступна и без подключения.</p>}
   <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (connected && !busy) save.mutate({ title, startDate, endDate }); }}>
    <label className="block"><Label>Название отчёта</Label><Input aria-label="Название отчёта географии" value={title} maxLength={120} disabled={busy} placeholder="Например: география канала за месяц" onChange={e => setTitle(e.target.value)} /></label>
    <div className="grid min-w-0 gap-4 sm:grid-cols-2"><label className="min-w-0"><Label>Начало периода</Label><Input className="min-w-0 max-w-full" aria-label="География: начало периода" type="date" value={startDate} min="2005-01-01" max={endDate} required disabled={busy} onChange={e => setStart(e.target.value)} /></label><label className="min-w-0"><Label>Конец периода</Label><Input className="min-w-0 max-w-full" aria-label="География: конец периода" type="date" value={endDate} min={startDate} max={yesterday} required disabled={busy} onChange={e => setEnd(e.target.value)} /></label></div>
    <p className="text-xs text-muted-foreground">До 366 дней включительно, не позднее вчерашнего дня UTC. Календарные даты запроса не переводятся из часового пояса Настроек. Последние данные API могут отставать; это не гарантия покрытия всего периода. До 250 строк, без автоматической загрузки следующих страниц.</p>
    <Button type="submit" disabled={!connected || busy}>{save.isPending ? "Запрашиваю и сохраняю…" : "Запросить географию и сохранить"}</Button>
    {save.isError && <ErrorAlert error={save.error} />}
   </form>
  </Card>
  {open.isError && <ErrorAlert error={open.error} />}
  {current && <Card className="min-w-0 space-y-4 p-5" data-testid="geography-result"><SectionTitle>{current.title}</SectionTitle>
   <p className="break-words text-sm"><b>{current.channel.title}</b> · <span className="break-all">{current.channel.id}</span></p>
   <p className="text-xs text-muted-foreground">Сохранённый снимок {when(current.createdAt)}. Запрошено: {current.requested.startDate} — {current.requested.endDate}. Изменение формы или подключённого канала не меняет этот снимок; экспортируется именно он, без нового запроса.</p>
   <p className="text-sm">Просмотры возвращённых строк: <b data-testid="geo-total-views">{number(current.totals.returnedViews)}</b> · минуты: <b>{number(current.totals.returnedMinutes)}</b>. Это не подтверждённые итоги всего канала.</p>
   {current.status === "empty" ? <p role="status">YouTube не вернул строки. Это не означает нулевые просмотры.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm" data-testid="geo-table"><thead><tr className="text-xs text-muted-foreground"><th className="p-2">Страна</th><th className="p-2">Просмотры</th><th className="p-2">Минуты</th><th className="p-2">Доля возвращённых просмотров</th></tr></thead><tbody>{current.rows.map(row => <tr key={row.country} className="border-t"><td className="p-2">{country(row.country)} <span className="text-xs text-muted-foreground">{row.country}</span></td><td className="p-2 font-mono">{number(row.views)}</td><td className="p-2 font-mono">{number(row.minutes)}</td><td className="p-2 font-mono">{row.sharePct === null ? "неизвестно" : number(row.sharePct) + "%"}</td></tr>)}</tbody></table></div>}
   {current.mayBeLimited && <p role="status">Достигнут предел строк: набор может быть неполным.</p>}
   <ul className="list-disc space-y-2 pl-5 text-xs text-muted-foreground">{current.warnings.map((w, i) => <li key={i} className="break-words">{w}</li>)}</ul>
   <p className="text-xs text-muted-foreground">Источник: YouTube Analytics API · country · views, estimatedMinutesWatched. Снимок может содержать приватную аналитику вашего канала — экспортируйте только доверенным получателям.</p>
   <div className="flex flex-wrap gap-3"><CopyButton text={geographyMarkdown(current)} label="Копировать географию" /><Button variant="outline" onClick={() => download(`geography-${current.id}.md`, geographyMarkdown(current), "text/markdown;charset=utf-8")}><Download className="h-4 w-4" />География Markdown</Button><Button variant="outline" onClick={() => download(`geography-${current.id}.json`, JSON.stringify(current, null, 2), "application/json;charset=utf-8")}>География JSON</Button></div>
  </Card>}
  <Card className="p-5"><SectionTitle icon={<History className="h-4 w-4" />}>История географии</SectionTitle><p className="mb-3 text-xs text-muted-foreground">Последние 50 снимков всех ранее подключённых каналов этой установки. Открытие не вызывает YouTube или AI. Старые файлы не удаляются; история входит в общий ZIP-перенос, но не добавлена в разрешения MCP.</p>
   {history.isPending && <p>Читаю историю…</p>}{history.isError && <ErrorAlert error={history.error} onRetry={() => void history.refetch()} />}
   {history.data?.warnings.map((w, i) => <p key={i} role="status" className="mb-2 text-xs text-accent">{w}</p>)}
   {history.data?.items.length === 0 && <p className="text-sm text-muted-foreground">Отчётов пока нет.</p>}
   <div className="space-y-2">{history.data?.items.map(r => <button key={r.id} type="button" disabled={busy} onClick={() => open.mutate(r.id)} className="block w-full break-words rounded border p-3 text-left text-sm hover:border-primary"><b>{r.title}</b><p className="mt-1 text-xs text-muted-foreground">{r.channel.title} · {when(r.createdAt)} · {r.requested.startDate} — {r.requested.endDate} · строк: {r.rowCount}{r.mayBeLimited ? " · возможен предел" : ""}</p></button>)}</div>
  </Card>
 </div>;
}
