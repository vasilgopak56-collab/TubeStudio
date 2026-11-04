import { useEffect, useRef, useState } from "react";
import { Button, Card, Input, SectionTitle } from "@/components/ui";
import { cn } from "@/lib/cn";

import { type Entry, type FeedDraft } from "./feedSnapshot";
import { readFeedPicture, importFeedFile, prepareFeedSnapshot, renderFeedPng, downloadFeedFile } from "./feedFiles";
export { readFeedPicture } from "./feedFiles";
type Candidate = { label: string; url: string };
const empty = (id: string): Entry => ({ id, title: "", channel: "", picture: null });

/** Only already-saved application media can be selected; no arbitrary remote URL. */
function localCandidate(url: string) {
  try {
    const u = new URL(url, window.location.origin);
    return u.origin === window.location.origin && u.pathname.startsWith("/files/") && !u.username && !u.password ? u.pathname + u.search : null;
  } catch { return null; }
}

function Editor({ entry, own, busy, onChange, onFile, onRemove }: {
  entry: Entry; own?: boolean; busy: boolean; onChange: (patch: Partial<Entry>) => void;
  onFile: (file: File) => void; onRemove: () => void;
}) {
  const name = own ? "Своя обложка" : `Конкурент ${entry.id}`;
  return <div className="min-w-0 space-y-3 rounded-lg border border-border p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><b>{name}</b><Button variant="ghost" disabled={busy} onClick={onRemove} aria-label={own ? "Убрать свою обложку" : `Удалить ${name.toLowerCase()}`}>{own ? "Убрать изображение" : "Удалить"}</Button></div>
    <label className="block space-y-1 text-sm"><span>Изображение · {name.toLowerCase()}</span><input type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Изображение · ${name.toLowerCase()}`} disabled={busy} className="block min-h-11 w-full min-w-0 max-w-full text-sm file:mr-2 file:rounded file:border-0 file:bg-muted file:px-3 file:py-2" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} /></label>
    {entry.picture && <p className="text-sm text-muted-foreground">{entry.picture.width ? `${entry.picture.width} × ${entry.picture.height} px · ` : ""}Показ в рамке 16:9 без обрезки.</p>}
    <label className="block space-y-1 text-sm"><span>Заголовок · {name.toLowerCase()}</span><Input disabled={busy} maxLength={200} value={entry.title} onChange={e => onChange({ title: e.target.value })} /></label>
    <label className="block space-y-1 text-sm"><span>Канал · {name.toLowerCase()}</span><Input disabled={busy} maxLength={100} value={entry.channel} onChange={e => onChange({ channel: e.target.value })} /></label>
  </div>;
}

export function FeedComparison({ candidates = [] }: { candidates?: Candidate[] }) {
  const [own, setOwn] = useState<Entry>(() => empty("own"));
  const [peers, setPeers] = useState<Entry[]>([]);
  const [mobile, setMobile] = useState(false), [light, setLight] = useState(false), [mark, setMark] = useState(true);
  const [position, setPosition] = useState(1), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const generation = useRef(0), nextId = useRef(1);
  useEffect(() => () => { generation.current++; }, []);
  const update = (id: string, patch: Partial<Entry>) => id === "own" ? setOwn(x => ({ ...x, ...patch })) : setPeers(xs => xs.map(x => x.id === id ? { ...x, ...patch } : x));
  const upload = async (id: string, file: File) => {
    const token = ++generation.current;
    setBusy(true); setError(""); setNotice(""); setFeedbackArea("editor");
    try { const picture = await readFeedPicture(file); if (token === generation.current) update(id, { picture }); }
    catch (e) { if (token === generation.current) setError((e as Error).message); }
    finally { if (token === generation.current) setBusy(false); }
  };
  const clear = () => {
    generation.current++; setBusy(false); setError(""); setNotice(""); setOwn(empty("own")); setPeers([]); setPosition(1);
  };
  const [notice, setNotice] = useState("");
  const [feedbackArea, setFeedbackArea] = useState<"editor" | "files">("editor");
  const draft = (): FeedDraft => ({ own, peers, mobile, light, mark, position: Math.min(position, peers.length + 1) });
  const restore = async (file: File) => {
    const token = ++generation.current;
    setBusy(true); setError(""); setNotice(""); setFeedbackArea("files");
    try {
      const snapshot = await importFeedFile(file);
      if (token !== generation.current) return;
      setOwn(snapshot.own); setPeers(snapshot.peers); setMobile(snapshot.mobile); setLight(snapshot.light); setMark(snapshot.mark); setPosition(snapshot.position);
      nextId.current = 1;
      setNotice("Макет восстановлен из JSON локально. Автосохранения нет.");
    } catch (e) { if (token === generation.current) setError((e as Error).message); }
    finally { if (token === generation.current) setBusy(false); }
  };
  const exportFile = async (kind: "json" | "png") => {
    const token = ++generation.current, frozen = structuredClone(draft());
    setBusy(true); setError(""); setNotice(""); setFeedbackArea("files");
    try {
      const snapshot = await prepareFeedSnapshot(frozen);
      if (token !== generation.current) return;
      const blob = kind === "json" ? new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }) : await renderFeedPng(snapshot);
      if (token !== generation.current) return;
      // Pretty JSON can exceed the compact size limit: check the actual download too.
      if (kind === "json" && blob.size > 16 * 1024 * 1024) throw Error("JSON макета больше 16 МиБ. Уменьшите изображения; частичный экспорт не создан.");
      downloadFeedFile(blob, `tubestudio-feed.${kind}`);
      setNotice(`Файл ${kind.toUpperCase()} подготовлен из макета на момент нажатия. Храните изображения и тексты приватно.`);
    } catch (e) { if (token === generation.current) setError((e as Error).message); }
    finally { if (token === generation.current) setBusy(false); }
  };
  const entries = [...peers];
  entries.splice(Math.min(position - 1, entries.length), 0, own);
  const saved = candidates.map(c => ({ ...c, safe: localCandidate(c.url) })).filter(c => c.safe);
  const feedback = <>
{notice && <p role="status" className="break-words text-sm text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      {busy && <p role="status" className="text-sm">Изображение обрабатывается локально…</p>}
  </>;
  return <div className="min-w-0 space-y-6 [&_button]:min-h-11" data-testid="feed-comparison">
    <Card className="min-w-0 space-y-4 p-5">
      <SectionTitle>Своя обложка среди конкурентов</SectionTitle>
      <p className="text-sm text-muted-foreground">Загрузите свою обложку и до пяти изображений для сравнения. Используйте собственные или разрешённые материалы. Файлы обрабатываются только в браузере, без отправки на сервер и AI. Вставки внешних URL и автоматического поиска здесь нет.</p>
      <p className="text-sm text-muted-foreground">Это условный макет, не настоящая выдача YouTube, не прогноз CTR и не A/B-тест. Просмотры, даты и длительность не выдумываются. Автосохранения нет: обновление страницы или уход из раздела очищает черновик. Переключение вкладок «Обложек» сохраняет его до ухода. Для переноса скачайте JSON вручную.</p>
      {saved.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Сохранённые варианты обложки">{saved.map(c => <Button key={c.label} variant="outline" disabled={busy} onClick={() => { setError(""); setOwn(x => ({ ...x, picture: { src: c.safe!, width: 0, height: 0 } })); }}>Взять {c.label}</Button>)}</div>}
      {feedbackArea === "editor" && feedback}
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Editor entry={own} own busy={busy} onChange={p => update("own", p)} onFile={f => void upload("own", f)} onRemove={() => update("own", { picture: null })} />
        {peers.map(p => <Editor key={p.id} entry={p} busy={busy} onChange={patch => update(p.id, patch)} onFile={f => void upload(p.id, f)} onRemove={() => { setPeers(xs => xs.filter(x => x.id !== p.id)); setPosition(x => Math.min(x, peers.length)); }} />)}
      </div>
      <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={peers.length >= 5 || busy} onClick={() => { while (peers.some(p => p.id === String(nextId.current))) nextId.current++; const entry = empty(String(nextId.current++)); setPeers(xs => [...xs, entry]); }}>Добавить конкурента ({peers.length}/5)</Button><Button variant="ghost" onClick={clear}>Очистить сравнение</Button></div>
    </Card>
    <Card className="min-w-0 space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><SectionTitle>Макет ленты</SectionTitle><div className="flex flex-wrap gap-2"><Button variant="outline" aria-pressed={!mobile} disabled={busy} onClick={() => setMobile(false)}>Сетка</Button><Button variant="outline" aria-pressed={mobile} disabled={busy} onClick={() => setMobile(true)}>Мобильная лента</Button><Button variant="outline" aria-pressed={light} disabled={busy} onClick={() => setLight(v => !v)}>{light ? "Тёмный фон" : "Светлый фон"}</Button></div></div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex min-h-11 items-center gap-2"><span>Позиция своей обложки</span><select disabled={busy} aria-label="Позиция своей обложки" className="min-h-11 rounded border border-border bg-background px-3" value={Math.min(position, entries.length)} onChange={e => setPosition(Number(e.target.value))}>{entries.map((_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={busy} checked={mark} onChange={e => setMark(e.target.checked)} />Отмечать свою карточку</label>
      </div>
      <p className="text-sm text-muted-foreground">Одинаковый размер изображений, без оценки победителя. Не-16:9 изображения показаны целиком с полями; YouTube может кадрировать их иначе. На узком экране сетка становится одноколоночной.</p>
      {feedbackArea === "files" && feedback}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" disabled={busy} onClick={() => void exportFile("json")}>Скачать макет JSON</Button>
        <Button variant="outline" disabled={busy} onClick={() => void exportFile("png")}>Скачать макет PNG</Button>
      </div>
      <label className="block space-y-2 text-sm"><span>Восстановить макет JSON (заменит текущий черновик)</span><input type="file" aria-label="Восстановить макет JSON" accept=".json,application/json" disabled={busy} className="block min-h-11 w-full min-w-0 max-w-full file:mr-2 file:rounded file:border-0 file:bg-muted file:px-3 file:py-2" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void restore(f); }} /></label>
      <p className="text-sm text-muted-foreground">JSON v1 — до 16 МиБ, встроенные PNG до 5 МиБ каждый и 1280 px по стороне; внешние ссылки и SVG не принимаются. Импорт заменяет макет только после полной проверки. PNG: колонка 360 px или сетка до трёх колонок по 360 px независимо от ширины экрана; заголовки и каналы до двух строк. Выбранный вариант проекта читается с локального сервера только для явного экспорта. Ни AI, ни YouTube не вызываются.</p>
      <div className={cn("min-w-0 rounded-lg p-3 sm:p-4", light ? "bg-white text-zinc-950" : "bg-[#0f0f0f] text-white")} data-testid="feed-mockup">
        <div className={cn("mx-auto grid min-w-0 gap-x-4 gap-y-6", mobile ? "max-w-[360px] grid-cols-1" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3")} data-testid="feed-cards">
          {entries.map(e => <article key={e.id} className="min-w-0" data-testid={e.id === "own" ? "feed-own-card" : "feed-peer-card"}>
            <div className={cn("aspect-video overflow-hidden rounded-lg", light ? "bg-zinc-100" : "bg-zinc-900")}>{e.picture ? <img src={e.picture.src} alt={e.id === "own" ? "Своя обложка в макете" : `Обложка конкурента ${e.id} в макете`} className="h-full w-full object-contain" onError={() => setError("Не удалось показать одну из обложек. Выберите изображение повторно; остальные карточки не изменены.")} /> : <div className="grid h-full place-items-center px-4 text-center text-sm">{e.id === "own" ? "Загрузите свою обложку" : "Загрузите обложку конкурента"}</div>}</div>
            <h3 dir="auto" className="mt-3 line-clamp-2 break-words text-base font-semibold leading-snug [overflow-wrap:anywhere]">{e.title || (e.id === "own" ? "Заголовок своего видео" : "Заголовок конкурента")}</h3>
            <p dir="auto" className={cn("mt-1 break-words text-sm [overflow-wrap:anywhere]", light ? "text-zinc-600" : "text-zinc-400")}>{e.channel || "Название канала не указано"}</p>
            {mark && e.id === "own" && <p className={cn("mt-2 text-sm font-medium", light ? "text-blue-700" : "text-blue-300")}>Своя карточка</p>}
          </article>)}
        </div>
      </div>
    </Card>
  </div>;
}