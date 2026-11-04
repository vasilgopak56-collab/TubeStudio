import { type OutlierBasis, ytUrl } from "./types";

export function OutlierDetails({basis, frozen=false}:{basis:OutlierBasis;frozen?:boolean}) {
 return <details className="mt-2 min-w-0 text-xs" data-testid={frozen?"outlier-alert-evidence":"tracker-outlier-basis"}>
  <summary>{frozen?"Сохранённое основание Outlier":"База Outlier: включения и исключения"}</summary>
  <div className="mt-2 space-y-2 break-all font-sans">
   <p>{basis.asOf} (UTC) · {basis.format===null?"Группа неизвестна":basis.format==="short"?"До 180 с":"Более 180 с"}. Это группы длительности, не подтверждённый статус Shorts.</p>
   <p>Просмотры цели: {basis.targetViews??"нет данных"} · Медиана: {basis.median??"нет данных"} · В базе: {basis.rows.filter(r=>r.included).length} других видео.</p>
   {basis.reason&&<p>{basis.reason}</p>}
   <p>Само видео исключено. Минимум 3 других видео этого канала, ≥48 ч на дату снимка, известные просмотры и длительность; снимок не старше 48 ч. Без подмены базы.</p>
   {frozen&&<p>Порог: {("threshold" in basis)?String(basis.threshold):"—"}×. Основание не пересчитывается после обновления.</p>}
   {basis.rows.map((r,i)=><div key={`${r.id}-${i}`} className="rounded border border-border/50 p-2" data-testid="outlier-basis-row"><a href={ytUrl(r.id)} target="_blank" rel="noreferrer" className="text-primary">{r.title}</a><p>{r.id} · {r.publishedAt} · {r.durationSec??"?"} с · просмотры {r.views??"нет данных"}</p><p>Снимок: {r.observedAt??"неизвестно"} · {r.included?"В базе":r.reason}</p></div>)}
  </div>
 </details>;
}

