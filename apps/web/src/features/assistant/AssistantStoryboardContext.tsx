import {useEffect,useRef,useState} from 'react';
import {api} from '@/lib/api';
import {Button,ErrorAlert,Input,Select} from '@/components/ui';
type Doc={name:string;text:string};
type Board={id:string;title:string;version:number|null;rows:number|null;source:string;done:boolean|null};
type Ask={projectId:string;artifactId:string;from:number;to:number};
type View={input:Ask;hash:string;project:{id:string;title:string};artifact:{id:string;title:string;version:number|null;totalRows:number;done:boolean|null;source:string};document:Doc;chars:number};
export function AssistantStoryboardContext({projects,disabled,documents,onAdd,onBusy,onPending}:{projects:{id:string;title:string}[];disabled:boolean;documents:Doc[];onAdd:(doc:Doc)=>void;onBusy:(busy:boolean)=>void;onPending:(pending:boolean)=>void}){
 const [open,setOpen]=useState(false),[project,setProject]=useState(''),[boards,setBoards]=useState<Board[]|null>(null),[board,setBoard]=useState('');
 const [from,setFrom]=useState('1'),[to,setTo]=useState('1'),[view,setView]=useState<View|null>(null),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
 const [consentFingerprint,setConsentFingerprint]=useState('');
 const docFingerprint=JSON.stringify(documents);
 const alive=useRef(true),epoch=useRef(0),docRef=useRef(documents);docRef.current=documents;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;epoch.current++;onBusy(false);onPending(false);};},[]); // eslint-disable-line
 useEffect(()=>{setConsent(false);setConsentFingerprint('');},[docFingerprint]);
 function begin(){setBusy(true);onBusy(true);setError(null);}
 function finish(t:number){if(alive.current&&epoch.current===t){setBusy(false);onBusy(false);}}
 function resetPreview(){setView(null);setConsent(false);setConsentFingerprint('');onPending(false);setError(null);}
 function cancel(){++epoch.current;setBusy(false);onBusy(false);setProject('');setBoards(null);setBoard('');setFrom('1');setTo('1');resetPreview();}
 async function choose(id:string){const t=++epoch.current;setProject(id);setBoards(null);setBoard('');setFrom('1');setTo('1');resetPreview();if(!id){setBusy(false);onBusy(false);return;}begin();try{const r=await api<{storyboards:Board[]}>('/assistant/storyboards/'+encodeURIComponent(id));if(alive.current&&epoch.current===t)setBoards(r.storyboards);}catch(e){if(alive.current&&epoch.current===t)setError(e);}finally{finish(t);}}
 const chosen=boards?.find(x=>x.id===board),a=Number(from),b=Number(to);
 const rangeOk=!!chosen&&chosen.rows!==null&&Number.isInteger(a)&&Number.isInteger(b)&&a>=1&&b>=a&&b<=chosen.rows&&b-a<100;
 async function review(){if(!rangeOk||busy||disabled)return;const t=++epoch.current;resetPreview();begin();try{const v=await api<View>('/assistant/storyboard-excerpt-preview',{method:'POST',json:{projectId:project,artifactId:board,from:a,to:b}});if(alive.current&&epoch.current===t){setView(v);onPending(true);}}catch(e){if(alive.current&&epoch.current===t)setError(e);}finally{finish(t);}}
 async function add(){if(!view||!consent||consentFingerprint!==JSON.stringify(docRef.current)||busy||disabled)return;const t=++epoch.current,before=JSON.stringify(docRef.current);begin();try{
  const v=await api<View>('/assistant/storyboard-excerpt-preview',{method:'POST',json:view.input});
  if(v.hash!==view.hash||v.document.text!==view.document.text||v.document.name!==view.document.name)throw new Error('Проект или раскадровка изменились. Выберите и проверьте сцены заново.');
  if(JSON.stringify(docRef.current)!==before)throw new Error('Список материалов изменился во время проверки. Проверьте его и подтвердите заново.');
  const list=docRef.current;if(list.length>=4||list.reduce((n,d)=>n+d.text.length,0)+v.document.text.length>40000)throw new Error('Не более 4 материалов и 40 000 символов суммарно. Уберите лишние материалы или выберите меньший диапазон.');
  if(list.some(d=>d.name===v.document.name))throw new Error('Этот диапазон уже добавлен. Выберите другой диапазон или уберите материалы.');
  if(alive.current&&epoch.current===t){onAdd(v.document);resetPreview();setProject('');setBoards(null);setBoard('');setFrom('1');setTo('1');}
 }catch(e){if(alive.current&&epoch.current===t){setError(e);setConsent(false);}}finally{finish(t);}}
 const locked=disabled||busy;
 return <section className="space-y-3 rounded border p-3" aria-label="Сцены раскадровки для помощника">
  <h4 className="font-semibold">Сцены и промпты из раскадровки</h4>
  <p className="text-xs text-muted-foreground">Для нового диалога выберите сохранённую запись и позиции сцен. Добавится текстовая копия фразы, концепта и image/video-промптов, без библии стиля, таймингов, настроек и полного сценария. Это не генерация и не изменение проекта.</p>
  <Button type="button" size="sm" variant="outline" disabled={locked} onClick={()=>{if(open)cancel();setOpen(!open);}}>{open?'Скрыть выбор сцен':'Выбрать сцены для диалога'}</Button>
  {open&&<div className="space-y-3">
   <label className="block text-sm">Проект<Select aria-label="Проект раскадровки для помощника" disabled={locked} value={project} onChange={e=>void choose(e.target.value)}><option value="">Выберите проект</option>{projects.map(p=><option value={p.id} key={p.id}>{p.title}</option>)}</Select></label>
   <label className="block text-sm">Сохранённая раскадровка<Select aria-label="Раскадровка для помощника" disabled={locked||!boards} value={board} onChange={e=>{setBoard(e.target.value);setFrom('1');setTo('1');resetPreview();}}><option value="">Выберите запись</option>{boards?.map(x=><option key={x.id} value={x.id}>{x.title} · {x.version?`v${x.version}`:'без номера'} · {x.rows===null?'нет списка':`${x.rows} сцен`} · {x.id.slice(0,8)}</option>)}</Select></label>
   {boards&&!boards.length&&<p className="text-xs">В проекте нет сохранённых раскадровок.</p>}
   {chosen&&<><p className="text-xs">Сохранено позиций: {chosen.rows??'список недоступен'} · {chosen.source==='audio'?'из озвучки':'текстовая или прежняя запись'} · {chosen.done===true?'завершена':chosen.done===false?'частичный результат':'статус завершения неизвестен'}. Позиции — порядок записанных строк, не номера сцен.</p><div className="grid grid-cols-2 gap-2"><label className="text-xs">С позиции<Input aria-label="Первая позиция сцены" type="number" min={1} max={chosen.rows??1} disabled={locked} value={from} onChange={e=>{setFrom(e.target.value);resetPreview();}}/></label><label className="text-xs">По позицию<Input aria-label="Последняя позиция сцены" type="number" min={1} max={chosen.rows??1} disabled={locked} value={to} onChange={e=>{setTo(e.target.value);resetPreview();}}/></label></div><p className="text-xs">До 100 позиций за один выбор, до 30 000 символов вместе с оформлением; без обрезания.</p></>}
   <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={locked||!rangeOk} onClick={()=>void review()}>Проверить выбранные сцены</Button>{project&&<Button type="button" size="sm" variant="ghost" onClick={cancel}>Отменить выбор сцен</Button>}</div>
   {busy&&<p role="status" className="text-xs">Проверяем проект без AI…</p>}
   {view&&<div className="space-y-2 rounded border p-3"><p className="text-sm"><b>{view.project.title}</b> · {view.artifact.title} · {view.input.from}–{view.input.to} из {view.artifact.totalRows} · {view.chars} символов</p><p className="break-all text-xs">SHA-256 проверки: {view.hash}</p><p className="text-xs">Сохранится копия показанного текста в новом диалоге и приватной резервной копии. Она не обновится при изменении проекта. После создания диалога текст попадёт к выбранной модели только при отдельном подтверждении AI-запроса.</p><details open><summary>Полная копия для диалога</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">{view.document.text}</pre></details><label className="flex gap-2 text-xs"><input type="checkbox" aria-label="Подтверждаю выбранные сцены" disabled={locked} checked={consent&&consentFingerprint===docFingerprint} onChange={e=>{setConsent(e.target.checked);setConsentFingerprint(e.target.checked?docFingerprint:'');}}/>Проверил выбранные сцены и промпты; добавить эту копию в новый диалог.</label><Button type="button" size="sm" disabled={locked||!consent||consentFingerprint!==docFingerprint} onClick={()=>void add()}>Добавить сцены в материалы</Button></div>}
   {error?<ErrorAlert error={error}/>:null}
  </div>}
 </section>;
}
