import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCode2, History, RotateCcw, Save, Search as SearchIcon, X, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Card, ErrorAlert, Input, Skeleton, ToolHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

type Row = { path: string; group: string; title: string; desc: string; words: number; vars: string[]; mtime: string; versions: number; edited: boolean };
type FileT = { path: string; content: string; vars: string[]; original: string | null };
type Ver = { id: string; label: string; createdAt: string | null; words: number };

const varsOf = (t: string) => [...new Set(t.match(/\{\{\w+\}\}/g) ?? [])].sort();

/** Построчный diff (LCS), достаточно для промптов до нескольких тысяч строк */
export function lineDiff(a: string, b: string) {
  const A = a.split("\n"), B = b.split("\n"); const n = A.length, m = B.length;
  if (n * m > 4_000_000) return [{ t: "=" as const, s: "(файл слишком большой для сравнения)" }];
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: { t: "=" | "-" | "+"; s: string }[] = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { out.push({ t: "=", s: A[i] }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: "-", s: A[i++] }); else out.push({ t: "+", s: B[j++] }); }
  while (i < n) out.push({ t: "-", s: A[i++] }); while (j < m) out.push({ t: "+", s: B[j++] });
  return out;
}

function DiffView({ before, after }: { before: string; after: string }) {
  const d = useMemo(() => lineDiff(before, after), [before, after]);
  const changed = d.filter((x) => x.t !== "=").length;
  // показываем изменения с 2 строками контекста
  const keep = new Set<number>(); d.forEach((x, i) => { if (x.t !== "=") for (let k = i - 2; k <= i + 2; k++) keep.add(k); });
  return (
    <div className="font-mono text-[12px]">
      <div className="mb-2 text-xs text-muted-foreground">{changed ? `изменено строк: ${changed}` : "различий нет"}</div>
      <div className="max-h-[60vh] overflow-auto rounded border">
        {d.map((x, i) => keep.has(i) ? (
          <div key={i} className={cn("whitespace-pre-wrap px-2", x.t === "-" && "bg-accent/15 text-accent line-through decoration-accent/40", x.t === "+" && "bg-success/15 text-success")}>{x.t === "=" ? "  " : x.t + " "}{x.s || " "}</div>
        ) : keep.has(i - 1) ? <div key={i} className="bg-muted px-2 text-muted-foreground">⋯</div> : null)}
      </div>
    </div>
  );
}

export default function PromptStudio() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["prompts"], queryFn: () => api<Row[]>("/prompts") });
  const [sel, setSel] = useState<string>("universal/2_script.md");
  const [q, setQ] = useState("");
  const file = useQuery({ queryKey: ["prompt", sel], queryFn: () => api<FileT>(`/prompts/file?path=${encodeURIComponent(sel)}`), enabled: !!sel });
  const vers = useQuery({ queryKey: ["prompt-versions", sel], queryFn: () => api<Ver[]>(`/prompts/versions?path=${encodeURIComponent(sel)}`), enabled: !!sel });
  const [text, setText] = useState("");
  const [diff, setDiff] = useState<{ title: string; before: string; after: string } | null>(null);
  useEffect(() => { if (file.data) setText(file.data.content); }, [file.data]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["prompts"] }); qc.invalidateQueries({ queryKey: ["prompt", sel] }); qc.invalidateQueries({ queryKey: ["prompt-versions", sel] }); };
  const save = useMutation({ mutationFn: (force: boolean) => api("/prompts/file", { method: "PUT", json: { path: sel, content: text, force } }), onSuccess: refresh });
  const restore = useMutation({ mutationFn: (id: string) => api("/prompts/restore", { method: "POST", json: { path: sel, id } }), onSuccess: refresh });

  const dirty = !!file.data && text !== file.data.content;
  const lost = file.data ? file.data.vars.filter((v) => !text.includes(v)) : [];
  const added = file.data ? varsOf(text).filter((v) => !file.data!.vars.includes(v)) : [];
  const rows = (list.data ?? []).filter((r) => !q.trim() || (r.title + r.desc + r.path).toLowerCase().includes(q.toLowerCase()));
  const groups = [...new Set(rows.map((r) => r.group))];
  const cur = list.data?.find((r) => r.path === sel);
  const pick = (p: string) => { if (dirty && !confirm("Есть несохранённые изменения. Перейти без сохранения?")) return; setSel(p); save.reset(); };
  const showVer = async (v: Ver) => { const r = await api<{ content: string }>(`/prompts/version?path=${encodeURIComponent(sel)}&id=${v.id}`); setDiff({ title: `${v.label}${v.createdAt ? " · " + new Date(v.createdAt).toLocaleString("ru-RU") : ""} → текущая`, before: r.content, after: file.data?.content ?? "" }); };

  return (
    <div>
      <ToolHeader icon={FileCode2} title="Промпты" eyebrow="// PROMPT STUDIO" subtitle="Задания для нейросетей: смотреть, править, сравнивать версии и откатывать. Правка действует сразу, без перезапуска" />
      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-auto">
          <div className="relative mb-3"><SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти промпт" /></div>
          {list.isLoading ? <Skeleton className="h-96" /> : list.error ? <ErrorAlert error={list.error} /> : groups.map((g) => (
            <div key={g} className="mb-3">
              <div className="mono-label mb-1">{g}</div>
              {rows.filter((r) => r.group === g).map((r) => (
                <button key={r.path} type="button" onClick={() => pick(r.path)} className={cn("block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", sel === r.path && "bg-primary/10 font-semibold text-primary")}>
                  <span className="flex items-center gap-1.5">{r.title}{r.edited && <span className="h-1.5 w-1.5 rounded-full bg-crown" title="изменён вами" />}</span>
                  <span className="block truncate font-mono text-[10.5px] text-muted-foreground">{r.path} · {r.words} сл.</span>
                </button>
              ))}
            </div>
          ))}
        </aside>

        <div className="min-w-0 space-y-4">
          <Card>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold">{cur?.title ?? sel}{cur?.edited && <Badge tone="crown">изменён</Badge>}{dirty && <Badge tone="primary">не сохранено</Badge>}</h2>
                <p className="text-sm text-muted-foreground">{cur?.desc} <span className="font-mono text-[11px]">apps/server/prompts/{sel}</span></p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => file.data && setText(file.data.content)}><X className="h-4 w-4" />Отменить</Button>
                <Button variant="outline" size="sm" disabled={!dirty} onClick={() => setDiff({ title: "Текущая → ваши правки", before: file.data!.content, after: text })}>Сравнить</Button>
                <Button size="sm" disabled={!dirty} loading={save.isPending} loadingText="Сохраняем…" onClick={() => save.mutate(false)}><Save className="h-4 w-4" />Сохранить</Button>
              </div>
            </div>
            {file.isLoading ? <Skeleton className="h-[60vh]" /> : file.error ? <ErrorAlert error={file.error} /> : (
              <>
                <textarea aria-label="Текст промпта" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)}
                  className="h-[60vh] w-full resize-y rounded-lg border bg-background p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-primary" />
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">Переменные (программа подставляет данные — не удаляйте):</span>
                  {file.data!.vars.length ? file.data!.vars.map((v) => <Badge key={v} tone={text.includes(v) ? "default" : "danger"}>{v}</Badge>) : <span className="text-muted-foreground">нет</span>}
                  {added.map((v) => <Badge key={v} tone="danger" title="Новой переменной программа не знает — она останется как есть">{v} — новая?</Badge>)}
                  <span className="ml-auto font-mono text-muted-foreground">{(text.match(/\S+/g) ?? []).length} слов · {text.split("\n").length} строк</span>
                </div>
                {!!lost.length && <div className="mt-2 flex items-start gap-2 rounded-lg border border-accent/40 bg-accent/10 p-2.5 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />Пропали переменные {lost.join(", ")} — без них программа не сможет подставить данные (тему, язык, длину…).</div>}
                {save.error && <div className="mt-2 space-y-2"><ErrorAlert error={save.error} />{/переменные|разделители/.test((save.error as Error).message) && <Button size="sm" variant="danger" onClick={() => save.mutate(true)}>Сохранить всё равно</Button>}</div>}
                {save.isSuccess && !dirty && <div className="mt-2 text-sm text-success">Сохранено. Прошлая версия — в истории ниже.</div>}
              </>
            )}
          </Card>

          <Card>
            <h3 className="mb-2 flex items-center gap-2 font-bold"><History className="h-4 w-4 text-primary" />История версий</h3>
            {vers.isLoading ? <Skeleton className="h-16" /> : !vers.data?.length ? <p className="text-sm text-muted-foreground">Вы ещё не меняли этот промпт. При первом сохранении заводская версия сохранится сюда — к ней всегда можно вернуться.</p> : (
              <div className="divide-y">
                {vers.data.map((v) => (
                  <div key={v.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="font-semibold">{v.label}</span>
                    <span className="font-mono text-xs text-muted-foreground">{v.createdAt ? new Date(v.createdAt).toLocaleString("ru-RU") : "из архива проекта"} · {v.words} сл.</span>
                    <span className="ml-auto flex gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => showVer(v)}>Сравнить с текущей</Button>
                      <Button size="sm" variant="outline" loading={restore.isPending && restore.variables === v.id} onClick={() => confirm(`Вернуть «${v.label}»? Текущая версия сохранится в истории.`) && restore.mutate(v.id)}><RotateCcw className="h-3.5 w-3.5" />Вернуть</Button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">История хранится в папке данных (<span className="font-mono">data/prompt-versions</span>) и переживает обновление проекта: после распаковки нового архива ваши правки можно вернуть отсюда.</p>
          </Card>
        </div>
      </div>

      {diff && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={(e) => e.target === e.currentTarget && setDiff(null)} role="dialog" aria-label="Сравнение">
          <Card className="w-full max-w-4xl p-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">{diff.title}</h2><Button size="sm" variant="ghost" onClick={() => setDiff(null)} title="Закрыть"><X className="h-4 w-4" /></Button></div>
            <DiffView before={diff.before} after={diff.after} />
          </Card>
        </div>
      )}
    </div>
  );
}
