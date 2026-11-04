import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, CalendarClock, Eye, PenLine, Swords, Workflow, Users, Image as ImageIcon, Quote, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { compact } from "@/lib/format";
import type { Competition, FoundTopic, SavedTopic } from "@/lib/types";
import { Badge, Button, Card, CopyButton, ScoreBar } from "@/components/ui";

const COMP: Record<Competition, { label: string; tone: "success" | "primary" | "danger" }> = {
  low: { label: "Низкая", tone: "success" }, medium: { label: "Средняя", tone: "primary" }, high: { label: "Высокая", tone: "danger" },
};
export const LENSES: Record<string, string> = { L1: "Жуткая норма", L2: "Цена черты", L3: "Домино", L4: "Иди за деньгами", L5: "ELI5-аналогия", L6: "Инверсия", L7: "До стандарта", L8: "Аномалия против консенсуса", L9: "Ловушка перевода", L10: "Скрытый мир", L11: "Точка поворота", L12: "Правда страннее вымысла", L13: "Снятие вины", L14: "Разрешение", L15: "Шок масштаба", L16: "Контрфакт", L17: "Современное эхо", L18: "Человеческая микродеталь", L19: "Таймлайн процесса", L20: "Погружение в эпоху", L21: "Столкновение доменов", L22: "Собственный эксперимент" };
const scoreTone = (s: number) => (s >= 90 ? "text-success" : s >= 80 ? "text-primary" : s >= 65 ? "text-foreground" : "text-muted-foreground");

export function topicText(t: FoundTopic) {
  return [`${t.title}`, t.altTitles.length ? `Альтернативы: ${t.altTitles.join(" / ")}` : "", `Оценка: ${t.score} — ${t.label}`, `Почему сработает: ${t.why}`, `Хук: ${t.hook}`,
    `Аудитория: ${t.audience}`, t.emotionalCore ? `Эмоциональное ядро: ${t.emotionalCore}` : "", t.lens ? `Линза: ${t.lens} ${LENSES[t.lens] ?? ""}` : "", `Обложка: ${t.thumbnail.visual}${t.thumbnail.text ? ` | Текст: ${t.thumbnail.text}` : ""}`,
    t.evidence.length ? `Похожие видео:\n${t.evidence.map((e) => `- ${e.title} (${compact(e.views)}) https://youtu.be/${e.id}`).join("\n")}` : ""].filter(Boolean).join("\n");
}

export function TopicCard({ t, niche }: { t: FoundTopic; niche?: string }) {
  const qc = useQueryClient();
  const [saved, setSaved] = useState<SavedTopic | null>(null);
  const save = useMutation({
    mutationFn: () => api<SavedTopic>("/saved-topics", { method: "POST", json: { title: t.title, niche, score: t.score, source: "topic-finder", meta: t } }),
    onSuccess: (r) => { setSaved(r); qc.invalidateQueries({ queryKey: ["saved-topics"] }); qc.invalidateQueries({ queryKey: ["projects"] }); },
  });
  const scriptUrl = `/script?${new URLSearchParams({ topic: t.title, hook: t.hook, ...(saved?.projectId ? { projectId: saved.projectId } : {}) })}`;

  return (
    <Card brackets className="flex flex-col p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="mono-label text-primary">Тема №{t.n}</div>
        <div className="text-right">
          <div className={`font-mono text-2xl font-bold leading-none ${scoreTone(t.score)}`}>{t.score}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{t.label}</div>
        </div>
      </div>
      <ScoreBar value={t.score} />
      <h3 className="mt-4 text-lg font-semibold leading-snug">{t.title}</h3>
      {t.altTitles.length > 0 && <p className="mt-1 text-xs text-muted-foreground">или: {t.altTitles.join(" · ")}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {t.competition && <Badge tone={COMP[t.competition].tone}><Swords className="h-3 w-3" />Конкуренция: {COMP[t.competition].label}</Badge>}
        {t.bestDay && <Badge><CalendarClock className="h-3 w-3" />{t.bestDay}, {String(t.bestHour).padStart(2, "0")}:00</Badge>}
        {t.angle && <Badge>{t.angle.replace(/_/g, " ")}</Badge>}
        {t.lens && <Badge tone="primary" title="Линза оригинальности">{t.lens}{LENSES[t.lens] ? ` · ${LENSES[t.lens]}` : ""}</Badge>}
      </div>

      <dl className="mt-4 space-y-3 text-sm">
        <div><dt className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-success"><Sparkles className="h-3.5 w-3.5" />Почему сработает</dt><dd>{t.why}</dd></div>
        {t.emotionalCore && <div><dt className="mb-0.5 text-xs font-semibold text-crown">Эмоциональное ядро</dt><dd>{t.emotionalCore}</dd></div>}
        <div><dt className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-primary"><Quote className="h-3.5 w-3.5" />Идея хука</dt>
          <dd className="border-l-2 border-primary/60 pl-3 italic text-foreground/90">«{t.hook}»</dd></div>
        <div><dt className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Users className="h-3.5 w-3.5" />Целевая аудитория</dt><dd>{t.audience}</dd></div>
        <div><dt className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><ImageIcon className="h-3.5 w-3.5" />Концепт обложки</dt>
          <dd>{t.thumbnail.visual}{t.thumbnail.text && <> <span className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-bold uppercase">{t.thumbnail.text}</span></>}</dd></div>
      </dl>

      {t.scorecard && (
        <details className="mt-4 rounded-md border p-2.5 text-sm">
          <summary className="cursor-pointer text-xs font-semibold">Скоринг-карта: {t.scorecard.total}/100 <span className="font-normal text-muted-foreground">{t.scorecard.total >= 85 ? "— делать немедленно" : t.scorecard.total >= 75 ? "— сильная, усилить слабейший критерий" : t.scorecard.total >= 60 ? "— переосмыслить угол" : "— в корзину"}</span></summary>
          <ul className="mt-2 space-y-1">{t.scorecard.items.map((x) => <li key={x.id} className="flex items-center gap-2 text-xs"><span className="w-44 shrink-0">{x.name} <span className="text-muted-foreground">×{x.weight}</span></span><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-primary" style={{ width: `${(x.score / 5) * 100}%` }} /></span><span className="w-6 text-right font-mono">{x.score}</span></li>)}</ul>
        </details>
      )}

      {t.evidence.length > 0 && (
        <div className="mt-4">
          <div className="mono-label mb-2 text-muted-foreground">Похожие видео на YouTube</div>
          <ul className="space-y-1.5">
            {t.evidence.map((e) => (
              <li key={e.id}>
                <a href={`https://www.youtube.com/watch?v=${e.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-md border p-1.5 hover:border-primary/60">
                  {e.thumbnail ? <img src={e.thumbnail} alt="" className="h-10 w-[72px] shrink-0 rounded object-cover" referrerPolicy="no-referrer" /> : <div className="h-10 w-[72px] shrink-0 rounded bg-muted" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{e.title}</span>
                    <span className="flex gap-2 text-[11px] text-muted-foreground"><span className="truncate">{e.channelTitle}</span><span className="flex shrink-0 items-center gap-0.5"><Eye className="h-3 w-3" />{compact(e.views)}</span>
                      {e.outlier != null && <span className={`shrink-0 font-mono ${e.outlier >= 5 ? "text-success" : ""}`}>×{e.outlier >= 100 ? Math.round(e.outlier) : e.outlier.toFixed(1)}</span>}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-4 [margin-top:max(1rem,auto)]">
        {saved ? <Link to={saved.projectId ? `/projects/${saved.projectId}` : "/saved"}><Button size="sm" variant="ghost"><BookmarkCheck className="h-3.5 w-3.5 text-success" />Сохранено</Button></Link>
          : <Button size="sm" variant="outline" onClick={() => save.mutate()} loading={save.isPending} loadingText="…"><Bookmark className="h-3.5 w-3.5" />Сохранить</Button>}
        <Link to={scriptUrl}><Button size="sm"><PenLine className="h-3.5 w-3.5" />Написать сценарий →</Button></Link>
        <Link to={`/pipeline?${new URLSearchParams({ topic: t.title, hook: t.hook, keywords: (t.searchKeywords ?? []).join(", "), ...(saved?.projectId ? { projectId: saved.projectId } : {}) })}`}><Button size="sm" variant="outline" aria-label="Одна кнопка: всё по теме"><Workflow className="h-3.5 w-3.5" />Одна кнопка</Button></Link>
        <CopyButton text={() => topicText(t)} label="" className="ml-auto" />
      </div>
    </Card>
  );
}
