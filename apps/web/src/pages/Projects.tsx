import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import type { ProjectSummary } from "@/lib/types";
import { Button, Card, EmptyState, ErrorAlert, Input, Skeleton, ToolHeader } from "@/components/ui";
import { KIND, PIPELINE } from "@/features/projects/meta";
import { cn } from "@/lib/cn";

export default function Projects() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["projects"], queryFn: () => api<ProjectSummary[]>("/projects") });
  const [title, setTitle] = useState("");
  const [search, setSearch] = useState("");
  const create = useMutation({ mutationFn: () => api<ProjectSummary>("/projects", { method: "POST", json: { title: title.trim() } }), onSuccess: () => { setTitle(""); qc.invalidateQueries({ queryKey: ["projects"] }); } });
  const rows = useMemo(() => (q.data ?? []).filter((p) => p.title.toLowerCase().includes(search.toLowerCase())), [q.data, search]);

  return (
    <div>
      <ToolHeader icon={FolderKanban} title="Проекты" eyebrow="// МОИ ДАННЫЕ" subtitle="Тема → сценарий → озвучка → SEO → обложки → раскадровка. Проект создаётся сам при сохранении темы." />
      <Card className="mb-6 flex flex-wrap gap-2 p-4">
        <form className="flex min-w-[260px] flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim()) create.mutate(); }}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Новый проект (название видео)…" maxLength={300} />
          <Button type="submit" disabled={!title.trim() || !!q.error} loading={create.isPending} loadingText="…"><Plus className="h-4 w-4" />Создать</Button>
        </form>
        <Input className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск" />
      </Card>
      {create.error && <ErrorAlert error={create.error} />}
      {q.isLoading ? <Skeleton className="h-40" /> : q.error ? <ErrorAlert error={q.error} onRetry={() => q.refetch()} /> : !rows.length ? (
        <EmptyState icon={<FolderKanban className="h-6 w-6" />} title="Проектов пока нет">Сохраните тему в <Link className="text-primary underline" to="/topics">поиске тем</Link> — проект появится здесь.</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {rows.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`}>
              <Card className="h-full p-4 transition hover:border-primary/60">
                <div className="font-medium leading-snug">{p.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{p.niche ? `${p.niche} · ` : ""}обновлён {ago(p.updatedAt)}</div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {PIPELINE.map((k) => { const I = KIND[k].icon; const n = p.counts[k] ?? 0; return (
                    <span key={k} title={KIND[k].label} className={cn("inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs", n ? "border-primary/50 text-primary" : "text-muted-foreground/50")}>
                      <I className="h-3.5 w-3.5" />{n > 1 ? n : ""}
                    </span>); })}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
