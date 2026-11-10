import {useEffect,useRef,useState} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import {api} from '@/lib/api';
import {Button,Input,Select,ErrorAlert} from '@/components/ui';

/** **жирный** внутри шагов справки. Своя копия, чтобы панель не тянула всю страницу справки. */
function Rich({text}:{text:string}){return <>{text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p,i)=>p.startsWith('**')?<b key={i}>{p.slice(2,-2)}</b>:<span key={i}>{p}</span>)}</>;}

export type ActionProposal={kind:string;route?:string};
type ActionKind='open-page'|'montage-check'|'publish-readiness';
type ActionResult={kind:ActionKind;title:string;ok:boolean;navigate?:string;lines:{level:'ok'|'warn'|'block';message:string}[]};
type HelpSection={id:string;title:string;route:string;short:string;steps:string[];cost:string};
const TITLES:Record<ActionKind,string>={'open-page':'Открыть страницу','montage-check':'Проверить ролик перед монтажом','publish-readiness':'Показать готовность карточки публикации'};
const KNOWN=(k:string):k is ActionKind=>k in TITLES;
const SECTION_CHECK:Record<string,ActionKind>={'studio-montage':'montage-check','studio-publish':'publish-readiness'};
const mark={ok:'✓',warn:'!',block:'✕'} as const;

/** Одно действие из списка Помощника. Выполняется только по нажатию владельца; сервер повторно проверяет список. */
export function AssistantActionCard({proposal,projects,defaultProject,pageTitle,disabled}:{proposal:ActionProposal;projects:{id:string;title:string}[];defaultProject:string;pageTitle?:string;disabled?:boolean}){
 const navigate=useNavigate();
 const [project,setProject]=useState(defaultProject),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[result,setResult]=useState<ActionResult|null>(null);
 const alive=useRef(true);useEffect(()=>()=>{alive.current=false;},[]);
 useEffect(()=>{setProject(defaultProject);},[defaultProject]);
 useEffect(()=>{setResult(null);setError(null);},[project]);
 if(!KNOWN(proposal.kind))return <div className="rounded-lg border border-accent/50 p-3 text-sm" aria-label="Недоступное действие">Помощник предложил действие, которого нет в списке. Оно не выполняется.</div>;
 const kind=proposal.kind,needsProject=kind!=='open-page';
 if(kind==='open-page'&&!proposal.route)return <div className="rounded-lg border border-accent/50 p-3 text-sm">Помощник не указал страницу. Ничего не открыто.</div>;
 async function run(){
  setBusy(true);setError(null);setResult(null);
  try{
   const action=kind==='open-page'?{kind,route:proposal.route}:{kind,projectId:project};
   const r=await api<ActionResult>('/assistant/actions',{method:'POST',json:{action,confirmed:true}});
   if(!alive.current)return;
   if(r.navigate)navigate(r.navigate);else setResult(r);
  }catch(e){if(alive.current)setError(e);}
  finally{if(alive.current)setBusy(false);}
 }
 return <section className="space-y-2 rounded-lg border p-3 text-sm" aria-label={'Действие: '+TITLES[kind]}>
  <h4 className="font-semibold">Действие: {TITLES[kind]}{kind==='open-page'&&<> «{pageTitle??proposal.route}»</>}</h4>
  <p className="text-xs text-muted-foreground">{kind==='open-page'?'Бесплатно. Откроется страница программы, ничего не меняется.':'Бесплатно, только чтение. Ничего не меняется и не запускается.'}</p>
  {needsProject&&<label className="block text-xs">Ролик<Select aria-label="Ролик для проверки" value={project} disabled={busy||disabled} onChange={e=>setProject(e.target.value)}><option value="">Выберите проект</option>{projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</Select></label>}
  <Button size="sm" disabled={busy||disabled||(needsProject&&!project)} onClick={()=>void run()}>{busy?'Выполняю…':'Выполнить'}</Button>
  {error!=null&&<ErrorAlert error={error}/>}
  {result&&<ul className="space-y-1" aria-label="Результат действия">{result.lines.map((l,i)=><li key={i} className={l.level==='block'?'text-accent':l.level==='warn'?'text-crown':'text-success'}>{mark[l.level]} {l.message}</li>)}</ul>}
 </section>;
}

/** Бесплатный ответ из справки: до трёх разделов, нейросеть не вызывается. */
export function AssistantHelpActions({projects,defaultProject}:{projects:{id:string;title:string}[];defaultProject:string}){
 const location=useLocation();
 const [query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[sections,setSections]=useState<HelpSection[]|null>(null);
 const alive=useRef(true);useEffect(()=>()=>{alive.current=false;},[]);
 useEffect(()=>{setSections(null);},[location.pathname]);
 async function find(){
  setBusy(true);setError(null);
  try{const r=await api<{sections:HelpSection[]}>('/assistant/help',{method:'POST',json:{query,currentPath:location.pathname}});if(alive.current)setSections(r.sections);}
  catch(e){if(alive.current)setError(e);}
  finally{if(alive.current)setBusy(false);}
 }
 return <section className="space-y-3 rounded-lg border p-3" aria-label="Где это нажать">
  <h3 className="font-semibold">Где это нажать?</h3>
  <p className="text-xs text-muted-foreground">Бесплатно: ответ из справки программы, нейросеть не вызывается.</p>
  <form className="flex gap-2" onSubmit={e=>{e.preventDefault();void find();}}><Input aria-label="Вопрос к справке" value={query} maxLength={500} disabled={busy} onChange={e=>setQuery(e.target.value)} placeholder="Например: как собрать Shorts"/><Button type="submit" variant="outline" disabled={busy}>{busy?'Ищу…':'Найти в справке'}</Button></form>
  {error!=null&&<ErrorAlert error={error}/>}
  {sections&&!sections.length&&<p className="text-sm">В справке ничего не нашлось. Переформулируйте вопрос или спросите нейросеть ниже.</p>}
  {sections?.map(s=><article key={s.id} className="space-y-2 rounded border p-3 text-sm">
   <h4 className="font-semibold">{s.title}</h4><p>{s.short}</p>
   {s.steps.length>0&&<ol className="list-decimal space-y-1 pl-5">{s.steps.map((t,i)=><li key={i}><Rich text={t}/></li>)}</ol>}
   {s.cost&&<p className="text-xs text-muted-foreground">Цена: {s.cost}</p>}
   {s.route!=='/help'&&s.route!==location.pathname&&<AssistantActionCard proposal={{kind:'open-page',route:s.route}} pageTitle={s.title} projects={projects} defaultProject={defaultProject}/>}
   {SECTION_CHECK[s.id]&&<AssistantActionCard proposal={{kind:SECTION_CHECK[s.id]}} projects={projects} defaultProject={defaultProject}/>}
  </article>)}
 </section>;
}
