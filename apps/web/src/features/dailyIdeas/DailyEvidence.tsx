import type { DailyPreview } from "./types";

type Context=DailyPreview["context"];
/** Only the frozen AI projection is rendered. Opening a row never fetches its source. */
export function DailyEvidence({context,refs}:{context:Context;refs?:string[]}){
 const rows=refs?refs.map(ref=>context.evidence.find(e=>e.ref===ref)).filter((e):e is Context["evidence"][number]=>!!e):context.evidence;
 return <div className="min-w-0 space-y-3 break-words text-sm [overflow-wrap:anywhere]" data-testid="daily-evidence">
  <p className="text-muted-foreground">{refs?"Строки, на которые ссылается идея":"Первые строки сохранённой проекции"}. Это показанные AI данные, не доказательство его вывода. Просмотры не обновляются при раскрытии.</p>
  {rows.map(e=><details key={e.ref} className="min-w-0 rounded-lg border border-border px-3" data-testid="daily-evidence-row">
   <summary className="min-h-11 cursor-pointer py-3 font-medium"><span className="text-primary">{e.ref}</span> · <span dir="auto">{e.title}</span></summary>
   <div className="space-y-3 border-t border-border py-3">
    <p className="text-muted-foreground">Строка {context.evidence.findIndex(x=>x.ref===e.ref)+1} из {context.evidence.length}, показанных AI; всего в сохранённом источнике: {context.total}. Порядок файла, не рейтинг.</p>
    <dl className="space-y-3">
     <div><dt className="font-medium">ID видео</dt><dd className="mt-1 text-muted-foreground">{e.videoId?<><code>{e.videoId}</code><a href={`https://www.youtube.com/watch?v=${e.videoId}`} target="_blank" rel="noreferrer" className="mt-1 block min-h-11 py-3 text-primary hover:underline">Открыть исходное видео ↗</a></>:"Не передан: строка может быть фразой, а не видео."}</dd></div>
     <div><dt className="font-medium">Дата публикации из источника</dt><dd className="mt-1 text-muted-foreground" dir="auto">{e.publishedAt??"Неизвестна (null)"}</dd></div>
     <div><dt className="font-medium">Просмотры в сохранённой строке</dt><dd className="mt-1 text-muted-foreground" data-testid="daily-evidence-views">{e.views===null?"Неизвестно (null)":e.views.toLocaleString("ru-RU")}</dd></div>
     <div><dt className="font-medium">Теги, переданные в AI</dt><dd className="mt-1 text-muted-foreground">{e.tags.length?<ul className="list-disc space-y-1 pl-5">{e.tags.map((tag,i)=><li key={i} dir="auto">{tag}</li>)}</ul>:"Пустой список: не доказывает отсутствие тегов в YouTube."}</dd></div>
    </dl>
    <p className="text-muted-foreground">Название — до 300 единиц UTF-16; до 8 тегов по 80. Это сохранённая проекция, не полный исходник. По длине нельзя определить, был ли текст обрезан. Дата — значение источника без внешней проверки; просмотры могут быть получены раньше даты сохранения источника.</p>
   </div>
  </details>)}
 </div>;
}

export function DailyEvidenceSource({context}:{context:Context}){
 return <div className="min-w-0 space-y-2 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]" data-testid="daily-evidence-source"><p>ID источника: <code>{context.source.id}</code></p><p>Сохранён источник: {context.source.savedAt} · это не дата обновления всех счётчиков.</p><p>Показано AI: {context.evidence.length} из {context.total} строк. Никакого нового ранжирования или внешней проверки.</p></div>;
}
