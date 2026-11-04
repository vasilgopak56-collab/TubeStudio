import {downloadVoiceText} from '@/features/assistant/AssistantVoicePreparation';
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarPlus, Download, ExternalLink, Film, Mic, PenLine, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { ago, compact, date } from "@/lib/format";
import type { Artifact, FoundTopic, Project } from "@/lib/types";
import { Badge, Button, Card, CopyButton, EmptyState, ErrorAlert, Input, Skeleton, Textarea } from "@/components/ui";
import { KIND, PIPELINE } from "@/features/projects/meta";
import { cn } from "@/lib/cn";
import { VoiceProvenance } from "@/features/projects/VoiceProvenance";

function TopicBody({ d }: { d: Partial<FoundTopic> & { score?: number } }) {
  return (
    <div className="space-y-2 text-sm">
      {d.score != null && <div><span className="font-mono text-lg font-bold text-primary">{d.score}</span> <span className="text-xs text-muted-foreground">{d.label}</span></div>}
      {d.hook && <p className="border-l-2 border-primary/60 pl-3 italic">«{d.hook}»</p>}
      {d.why && <p><b className="text-xs text-success">Почему сработает: </b>{d.why}</p>}
      {d.audience && <p><b className="text-xs text-muted-foreground">Аудитория: </b>{d.audience}</p>}
      {d.thumbnail?.visual && <p><b className="text-xs text-muted-foreground">Обложка: </b>{d.thumbnail.visual}{d.thumbnail.text ? ` — «${d.thumbnail.text}»` : ""}</p>}
      {!!d.evidence?.length && <ul className="space-y-1">{d.evidence.map((e) => (
        <li key={e.id}><a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={`https://youtu.be/${e.id}`} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" />{e.title} · {compact(e.views)}</a></li>))}</ul>}
    </div>
  );
}

function ArtifactBody({ a, projectId }: { a: Artifact; projectId:string }) {
  const d = a.data as any;
  if(a.kind==='note'&&d?.source==='assistant-workflow-results'&&typeof d.text==='string')return <div className="space-y-2 text-sm" aria-label="Сохранённые результаты процесса"><p>Снимок принятых ответов и плана; не отдельные сценарий или промпты. Снимок не обновляется при изменении процесса и не проверяет факты.</p><p className="text-xs break-words">Процесс: {d.workflowId} · ревизия {d.revision} · SHA-256 текста: {d.sha256}</p><details><summary className="cursor-pointer">Полный JSON результатов</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{d.text}</pre></details></div>;
  if(a.kind==='note'&&d?.source==='assistant-voice-preparation'&&typeof d.cleanedText==='string'&&d.input&&d.sourceArtifact)return <div className="space-y-3 text-sm" aria-label="Сохранённая подготовка озвучки"><p><b>Подготовка, не аудио.</b> Сама подготовка не запускает генерацию. Полученные аудиочасти сохраняются отдельно.</p><p className="break-words [overflow-wrap:anywhere]">Сценарий: {d.sourceArtifact.title} · {d.sourceArtifact.version?`v${d.sourceArtifact.version}`:'без номера'} · {d.input.language} · {d.input.model}{d.input.tts?' · voice '+d.input.tts.voice+' · независимый TTS':''} · {d.input.speed}× · тон {d.input.pitch}</p><p className="text-xs text-muted-foreground">Закреплённый снимок. Доступность голоса не проверена. Текстовые подключения здесь не используются. Изменения сценария не меняют эту подготовку.</p><details><summary className="cursor-pointer">Полный очищенный текст подготовки</summary><pre className="whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">{d.cleanedText}</pre></details><details><summary className="cursor-pointer">Исходный сценарий подготовки</summary><pre className="whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">{d.originalText}</pre><p className="break-all text-xs">Версия {d.sourceArtifact.id} · SHA-256 {d.sourceArtifact.hash}</p></details><div className="flex flex-wrap gap-2"><CopyButton text={d.cleanedText}/><Button size="sm" variant="outline" onClick={()=>downloadVoiceText(d.cleanedText)}>Скачать очищенный TXT</Button></div></div>;
  if(a.kind==='note'&&d?.tool==='director'&&d?.package?.brief&&Array.isArray(d?.compiled?.blocks))return <div className="space-y-3 text-sm"><p><b>Режиссёрский пакет:</b> {d.package.brief.title} · {d.package.brief.seconds} с · {d.package.shots?.length ?? 0} кадров</p><p className="text-muted-foreground">{d.notice}</p><details><summary className="cursor-pointer py-2">История и сохранённые промпты блоков</summary><p className="whitespace-pre-wrap">{d.package.brief.story}</p>{d.compiled.blocks.map((b:any)=><details key={b.id}><summary className="py-2">{b.id}: монтаж {b.editSeconds} с / запрос {b.renderSeconds} с</summary><pre className="whitespace-pre-wrap break-words text-xs">{b.prompt}</pre><CopyButton text={b.prompt}/></details>)}</details><Link className="text-primary underline" to="/help#director">Как использовать этот пакет</Link></div>;
  if(a.kind==='note'&&d?.source==='research-comparison'&&d?.scriptBrief)return <div className="space-y-3 text-sm"><p><b>Гипотеза пользователя:</b> {d.review?.hypothesis}</p><p>Каналов с подтверждёнными примерами выше порогов: {d.summary?.supportedChannels}. Это ограниченная выборка, не доказанный спрос. Закреплённая версия не изменяется при новых проверках.</p><details><summary className="cursor-pointer py-2">Бриф, источники и ограничения</summary><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{d.scriptBrief.notes}</p></details><Link className="text-primary underline" to={'/script?projectId='+encodeURIComponent(projectId)+'&comparisonBrief='+encodeURIComponent(d.comparisonId)+'&comparisonArtifact='+encodeURIComponent(a.id)}>К сценарию с этим сравнением</Link></div>;
  if(a.kind==='topic'&&d?.source==='research-workflow'&&d?.scriptBrief)return <div className="space-y-3 text-sm"><p><b>Собственный ракурс:</b> {d.angle}</p><p>Закреплённый исследовательский бриф. Метрики — референс для выбора темы, не проверка фактов.</p><details><summary className="cursor-pointer py-2">Источники и сценарные требования</summary><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{d.scriptBrief.notes}</p></details><Link className="text-primary underline" to={'/script?projectId='+encodeURIComponent(projectId)+'&researchBrief='+encodeURIComponent(d.candidateId)}>К сценарию</Link></div>;
  if (a.kind === "topic" && d) return <TopicBody d={d} />;
  if (typeof d === "string") return <p className="whitespace-pre-wrap text-sm">{d.length > 1200 ? d.slice(0, 1200) + "…" : d}</p>;
  if (a.kind === "check" && d?.tool) return <p className="text-sm text-muted-foreground">{d.tool}{d.humanPct != null ? ` · человечность ${d.humanPct}%` : d.score != null ? ` · ${d.score}/100 — ${d.label}` : d.viralScore != null ? ` · Viral Score ${d.viralScore}` : ""}{d.summary || d.why ? ` — ${String(d.summary ?? d.why).slice(0, 220)}` : ""}</p>;
  if (a.kind === "thumbnail" && (Array.isArray(d?.variants) || d?.polished)) { const imgs: string[] = d.polished ? [d.polished.url] : d.variants.map((v: { url?: string }) => v.url).filter(Boolean); return imgs.length ? <div className="flex flex-wrap gap-2">{imgs.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="h-20 rounded border border-border object-cover" /></a>)}</div> : <p className="text-sm text-muted-foreground">Концепты: {d.variants.map((v: { idea: string }) => v.idea).join(" · ")}</p>; }
  if (a.kind === "storyboard" && Array.isArray(d?.rows)) return <div className="text-sm text-muted-foreground"><p>{d.rows.length} сцен · {d.input?.imageModel ?? ""}{d.input?.videoModel ? " + " + d.input.videoModel : ""}</p>{d.source === "audio" && d.origin?.schema === 1 && <p className="mt-1 break-words">Источник при копировании: {d.origin.projectTitle} · {d.origin.artifactTitle} · {d.origin.artifactVersion ? `v${d.origin.artifactVersion}` : "без номера"}. Снимок не подтверждает содержание речи.</p>}</div>;
  if (a.kind === "seo" && Array.isArray(d?.titles)) return <ul className="list-disc space-y-0.5 pl-5 text-sm">{d.titles.map((t: { title: string }, i: number) => <li key={i}>{t.title}</li>)}</ul>;
  if (a.kind === "audio" && typeof d?.url === "string") return <div className="space-y-1">{d.source === "assistant-voice-fx" && <p className="text-xs text-muted-foreground">Локальная копия · темп {d.speed}× · тон {d.pitch} · исходное аудио сохранено</p>}<VoiceProvenance value={d.provenance} /><audio controls preload="none" src={d.url} className="w-full max-w-xl" /><p className="font-mono text-[11px] text-muted-foreground">{d.uploaded ? "загруженный файл" : d.model}{d.seconds ? ` · ${Math.floor(d.seconds / 60)}:${String(Math.floor(d.seconds % 60)).padStart(2, "0")}` : ""} · <a className="underline" href={d.url} download>скачать</a></p></div>;
  if (a.kind === "video" && typeof d?.url === "string") return <div className="space-y-1"><video controls preload="metadata" src={d.url} className={cn("rounded border border-border", d.height > d.width ? "max-h-96" : "w-full max-w-xl")} /><p className="font-mono text-[11px] text-muted-foreground">{d.width}×{d.height} · {Math.floor(d.seconds / 60)}:{String(Math.round(d.seconds % 60)).padStart(2, "0")} · {d.scenes} сцен · <a className="underline" href={d.url} download>MP4</a> · <a className="underline" href={d.srtUrl} download>SRT</a></p></div>;
  if (a.kind === "shorts" && Array.isArray(d?.shorts)) return <ol className="list-decimal space-y-1 pl-5 text-sm">{d.shorts.map((x: { title: string; seconds: number; hook: string; videoUrl?: string }, i: number) => <li key={i}><b>{x.title}</b> <span className="text-muted-foreground">· ≈ {x.seconds} с — {x.hook}</span>{x.videoUrl && <> · <a className="underline" href={x.videoUrl} target="_blank" rel="noreferrer">видео</a></>}</li>)}</ol>;
  if (a.kind === "script" && typeof d?.script === "string") return <p className="whitespace-pre-wrap text-sm">{d.script.slice(0, 1200)}{d.script.length > 1200 ? "…" : ""}</p>;
  if (a.files?.length) return <ul className="text-sm">{a.files.map((f) => <li key={f}><a className="text-primary hover:underline" href={`/files/${f}`} target="_blank" rel="noreferrer">{f.split("/").pop()}</a></li>)}</ul>;
  return d ? <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(d, null, 2)}</pre> : null;
}

export default function ProjectDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["project", id], queryFn: () => api<Project>(`/projects/${id}`) });
  const inv = () => { qc.invalidateQueries({ queryKey: ["project", id] }); qc.invalidateQueries({ queryKey: ["projects"] }); };
  const [title, setTitle] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const rename = useMutation({ mutationFn: (t: string) => api(`/projects/${id}`, { method: "PATCH", json: { title: t } }), onSuccess: () => { setTitle(null); inv(); } });
  const addNote = useMutation({ mutationFn: () => api(`/projects/${id}/artifacts`, { method: "POST", json: { kind: "note", title: note.trim().split("\n")[0].slice(0, 80), data: note.trim() } }), onSuccess: () => { setNote(""); inv(); } });
  const delA = useMutation({ mutationFn: (aid: string) => api(`/projects/${id}/artifacts/${aid}`, { method: "DELETE" }), onSuccess: inv });
  const delP = useMutation({ mutationFn: () => api(`/projects/${id}`, { method: "DELETE" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["projects"] }); nav("/projects"); } });

  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.error || !q.data) return <ErrorAlert error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data;
  const has = (k: string) => p.artifacts.some((a) => a.kind === k);
  const topic = p.artifacts.find((a) => a.kind === "topic")?.data as Partial<FoundTopic> | undefined;
  const workflow=p.artifacts.find(a=>a.kind==='topic'&&(a.data as any)?.source==='research-workflow')?.data as {candidateId:string}|undefined;
  const comparison=p.artifacts.filter(a=>(a.data as any)?.source==='research-comparison').at(-1);
  const scriptUrl = `/script?${new URLSearchParams({ topic: p.title, ...(topic?.hook ? { hook: topic.hook } : {}), projectId: p.id, ...(comparison?{comparisonBrief:(comparison.data as any).comparisonId,comparisonArtifact:comparison.id}:workflow?{researchBrief:workflow.candidateId}:{}) })}`;

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/projects" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Проекты</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {title == null ? <h1 className="cursor-text text-2xl font-bold leading-tight" onClick={() => setTitle(p.title)} title="Нажмите, чтобы переименовать">{p.title}</h1>
            : <form onSubmit={(e) => { e.preventDefault(); if (title.trim()) rename.mutate(title.trim()); }}><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== p.title ? rename.mutate(title.trim()) : setTitle(null)} /></form>}
          <p className="mt-1 text-sm text-muted-foreground">Создан {date(p.createdAt)} · обновлён {ago(p.updatedAt)}{p.niche ? ` · ${p.niche}` : ""}</p>
        </div>
        <div className="flex gap-2">
          <Link to={`/calendar?project=${p.id}&title=${encodeURIComponent(p.title)}`}><Button variant="outline"><CalendarPlus className="h-4 w-4" />В календарь</Button></Link>
          <a href={`/api/projects/${p.id}/export`}><Button variant="outline"><Download className="h-4 w-4" />ZIP</Button></a>
          <Button variant="danger" onClick={() => confirm("Удалить проект со всеми файлами?") && delP.mutate()}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>

      <Card className="mb-6 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {PIPELINE.map((k, i) => { const I = KIND[k].icon; return (
            <span key={k} className="flex items-center gap-2">
              <span className={cn("inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs", has(k) ? "border-primary/60 bg-primary/10 text-primary" : "text-muted-foreground")}><I className="h-3.5 w-3.5" />{KIND[k].label}</span>
              {i < PIPELINE.length - 1 && <span className="text-muted-foreground/40">→</span>}
            </span>); })}
          {has("audio") && <Link to={`/video?projectId=${p.id}`} className="ml-auto"><Button size="sm" variant="outline"><Film className="h-3.5 w-3.5" />Видео и Shorts</Button></Link>}
          {has("script") && <Link to={`/voice?projectId=${p.id}`} className={has("audio") ? "" : "ml-auto"}><Button size="sm" variant="outline"><Mic className="h-3.5 w-3.5" />{has("audio") ? "Озвучка" : "Озвучить"}</Button></Link>}
          <Link to={scriptUrl} className={has("script") ? "" : "ml-auto"}><Button size="sm"><PenLine className="h-3.5 w-3.5" />{has("script") ? "Новая версия сценария" : "Написать сценарий"}</Button></Link>
        </div>
      </Card>

      <h2 className="mb-3 text-lg font-semibold">Таймлайн</h2>
      {!p.artifacts.length ? <EmptyState title="Пусто">Добавьте заметку или напишите сценарий.</EmptyState> : (
        <ol className="relative space-y-4 border-l pl-6">
          {[...p.artifacts].reverse().map((a) => { const I = KIND[a.kind]?.icon ?? KIND.note.icon; return (
            <li key={a.id} className="relative">
              <span className="absolute -left-[37px] top-3 grid h-6 w-6 place-items-center rounded-full border bg-card text-primary"><I className="h-3.5 w-3.5" /></span>
              <Card className="p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge tone="primary">{KIND[a.kind]?.label ?? a.kind}{a.version && a.version > 1 ? ` v${a.version}` : ""}</Badge>
                  <span className="min-w-0 flex-1 truncate font-medium">{a.title}</span>
                  <span className="text-xs text-muted-foreground">{ago(a.createdAt)}</span>
                  {(a.kind === "script" || a.kind === "seo" || a.kind === "storyboard" || a.kind === "thumbnail") && <Link to={a.kind === "storyboard" && (a.data as { source?: string })?.source === "audio" ? `/audio-storyboard?audioId=${(a.data as { audioId: string }).audioId}` : `/${a.kind}?projectId=${p.id}&artifact=${a.id}`} className="text-muted-foreground hover:text-primary" title="Открыть"><PenLine className="h-4 w-4" /></Link>}
                  <CopyButton label="" text={() => typeof a.data === "string" ? a.data : (a.data as any)?.script ?? (a.data as any)?.description?.full ?? JSON.stringify(a.data ?? {}, null, 2)} />
                  <button className="text-muted-foreground hover:text-accent" title="Удалить" onClick={() => confirm("Удалить артефакт?") && delA.mutate(a.id)}><Trash2 className="h-4 w-4" /></button>
                </div>
                <ArtifactBody a={a} projectId={p.id} />
              </Card>
            </li>); })}
        </ol>
      )}

      <Card className="mt-6 p-4">
        <Textarea label="Заметка" value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} placeholder="Идеи, ссылки, источники…" className="min-h-[72px]" />
        <Button className="mt-2" size="sm" variant="outline" disabled={!note.trim()} loading={addNote.isPending} loadingText="…" onClick={() => addNote.mutate()}><Plus className="h-3.5 w-3.5" />Добавить в таймлайн</Button>
      </Card>
    </div>
  );
}
