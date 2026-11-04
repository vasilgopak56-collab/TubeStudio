import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Download, FolderOpen, PenLine, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import { Badge, Button, Card, Chip, CopyButton, EmptyState, ErrorAlert, Input, Select, Skeleton, ToolHeader } from "@/components/ui";

import type { SavedTopic as Topic } from "@/lib/types";

function download(name: string, body: string, type: string) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([body], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
function exportCsv(rows: Topic[]) {
  const head = ["title", "niche", "score", "status", "source", "createdAt", "hook", "why"];
  const lines = rows.map((t) => [t.title, t.niche, t.score, t.status, t.source, t.createdAt, (t.meta as any)?.hook, (t.meta as any)?.why].map(csvCell).join(","));
  download("saved-topics.csv", "\ufeff" + [head.join(","), ...lines].join("\n"), "text/csv;charset=utf-8");
}
const STATUS = { idea: "Идея", script: "Сценарий", done: "Готово" } as const;
const SOURCE = { analysis: "Анализ канала", "topic-finder": "Поиск тем", research: "Исследование", digest: "Дайджест конкурентов", comments: "Комментарии", manual: "Вручную" } as const;

export default function Saved() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["saved-topics"], queryFn: () => api<Topic[]>("/saved-topics") });
  const inv = () => qc.invalidateQueries({ queryKey: ["saved-topics"] });
  const add = useMutation({ mutationFn: (title: string) => api("/saved-topics", { method: "POST", json: { title, source: "manual" } }), onSuccess: () => { setNew(""); inv(); } });
  const patch = useMutation({ mutationFn: ({ id, ...p }: Partial<Topic> & { id: string }) => api(`/saved-topics/${id}`, { method: "PATCH", json: p }), onSuccess: inv });
  const del = useMutation({ mutationFn: (id: string) => api(`/saved-topics/${id}`, { method: "DELETE" }), onSuccess: inv });
  const [filter, setFilter] = useState<"all" | Topic["status"]>("all");
  const [search, setSearch] = useState("");
  const [nw, setNew] = useState("");

  const rows = useMemo(() => (q.data ?? []).filter((t) => (filter === "all" || t.status === filter) && t.title.toLowerCase().includes(search.toLowerCase())), [q.data, filter, search]);

  return (
    <div>
      <ToolHeader icon={Bookmark} title="Сохранённые темы" eyebrow="// МОИ ДАННЫЕ" subtitle="Темы из анализа канала, поиска тем и добавленные вручную" />
      <Card className="mb-6 p-4">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (nw.trim().length >= 3) add.mutate(nw.trim()); }}>
          <Input value={nw} onChange={(e) => setNew(e.target.value)} placeholder="Добавить тему вручную…" maxLength={300} />
          <Button type="submit" loading={add.isPending} loadingText="…" disabled={nw.trim().length < 3}><Plus className="h-4 w-4" />Добавить</Button>
        </form>
      </Card>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["all", "idea", "script", "done"] as const).map((s) => (
          <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
            {s === "all" ? "Все" : STATUS[s]} <span className="opacity-60">{(q.data ?? []).filter((t) => s === "all" || t.status === s).length}</span>
          </Chip>
        ))}
        <Input className="ml-auto max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск" />
        <Button variant="ghost" size="sm" disabled={!rows.length} onClick={() => exportCsv(rows)}><Download className="h-3.5 w-3.5" />CSV</Button>
        <Button variant="ghost" size="sm" disabled={!rows.length} onClick={() => download("saved-topics.json", JSON.stringify(rows, null, 2), "application/json")}><Download className="h-3.5 w-3.5" />JSON</Button>
      </div>
      {q.isLoading ? <Skeleton className="h-40" /> : q.error ? <ErrorAlert error={q.error} onRetry={() => q.refetch()} /> : !rows.length ? (
        <EmptyState icon={<Bookmark className="h-6 w-6" />} title="Тем пока нет">Сохраняйте темы в <Link to="/analysis" className="text-primary underline">анализе канала</Link> или добавьте вручную.</EmptyState>
      ) : (
        <div className="space-y-2">
          {rows.map((t) => (
            <Card key={t.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge>{SOURCE[t.source]}</Badge>
                  {t.score != null && <span className="font-mono text-primary">{t.score}</span>}
                  {t.niche && <span>{t.niche}</span>}
                  <span>{ago(t.createdAt)}</span>
                </div>
              </div>
              <Select value={t.status} onChange={(e) => patch.mutate({ id: t.id, status: e.target.value as Topic["status"] })} className="w-36">
                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <CopyButton text={t.title} label="" />
              {t.projectId && <Link to={`/projects/${t.projectId}`} title="Проект"><Button variant="ghost" size="sm"><FolderOpen className="h-4 w-4" /></Button></Link>}
              <Link to={`/script?${new URLSearchParams({ topic: t.title, ...((t.meta as any)?.hook ? { hook: (t.meta as any).hook } : {}), ...(t.projectId ? { projectId: t.projectId } : {}) })}`}><Button variant="outline" size="sm"><PenLine className="h-3.5 w-3.5" />В сценарист</Button></Link>
              <Button variant="ghost" size="sm" onClick={() => confirm("Удалить тему?") && del.mutate(t.id)}><Trash2 className="h-4 w-4" /></Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
