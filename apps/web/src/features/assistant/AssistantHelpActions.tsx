import {useEffect,useRef,useState} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {Button,Input,Select,ErrorAlert} from '@/components/ui';
import {useJob,type PriceChallenge} from '@/lib/jobs';
import {JobBox,useActiveChannel} from '@/features/studio/common';

/** **жирный** внутри шагов справки. Своя копия, чтобы панель не тянула всю страницу справки. */
function Rich({text}:{text:string}){return <>{text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p,i)=>p.startsWith('**')?<b key={i}>{p.slice(2,-2)}</b>:<span key={i}>{p}</span>)}</>;}

export type ActionProposal={kind:string;route?:string};
type ActionKind='open-page'|'montage-check'|'publish-readiness'|'publish-texts'|'fact-check'|'radar'|'script-write'|'montage-render'|'shorts-build';
type ActionResult={kind:ActionKind;title:string;ok:boolean;navigate?:string;lines:{level:'ok'|'warn'|'block';message:string}[]};
type HelpSection={id:string;title:string;route:string;short:string;steps:string[];cost:string};
const TITLES:Record<ActionKind,string>={'open-page':'Открыть страницу','montage-check':'Проверить ролик перед монтажом','publish-readiness':'Показать готовность карточки публикации','publish-texts':'Подготовить тексты публикации','fact-check':'Проверить факты сценария','radar':'Запустить Радар','script-write':'Написать сценарий','montage-render':'Собрать монтаж','shorts-build':'Собрать Shorts'};
const KNOWN=(k:string):k is ActionKind=>k in TITLES;
const SECTION_ACTIONS:Record<string,ActionKind[]>={'studio-script':['fact-check','script-write'],'studio-ideas':['radar'],'studio-montage':['montage-check','montage-render'],'studio-publish':['publish-readiness','publish-texts'],'studio-shorts':['shorts-build']};

/** Платное действие: одна задача, внутри — то же окно цены, что на странице «Публикация». Закрытие панели задачу не останавливает. */
function PublishTextsCard({projects,defaultProject,disabled}:{projects:{id:string;title:string}[];defaultProject:string;disabled?:boolean}){
 const {channel}=useActiveChannel();
 const job=useJob<unknown>('/assistant/actions/publish-texts');
 const [project,setProject]=useState(defaultProject),[approved,setApproved]=useState(false);
 const running=job.status==='running';
 useEffect(()=>{if(!running)setProject(defaultProject);},[defaultProject]);
 const decide=(c:PriceChallenge,d:'approve'|'deny')=>{if(d==='approve')setApproved(true);job.decideConsent(c,d);};
 return <section className="space-y-2 rounded-lg border border-primary/40 p-3 text-sm" aria-label={'Действие: '+TITLES['publish-texts']}>
  <h4 className="font-semibold">Действие: {TITLES['publish-texts']}</h4>
  <p className="text-xs">Платно: один запрос к текстовой модели AnyModel из Настроек. Ориентир цены покажет окно подтверждения; без вашего «Подтвердить» запрос не уйдёт. Автоповтора и резервных моделей нет. Готовые тексты заменят прежнее предложение модели на странице «Публикация», сама карточка не меняется.</p>
  <p className="text-xs text-muted-foreground">Канал: {channel?.name??'не выбран'}</p>
  <label className="block text-xs">Ролик<Select aria-label="Ролик для текстов публикации" value={project} disabled={running||disabled} onChange={e=>{setProject(e.target.value);setApproved(false);}}><option value="">Выберите проект</option>{projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</Select></label>
  {!running&&<Button size="sm" disabled={disabled||!project||!channel} onClick={()=>{setApproved(false);void job.start({projectId:project,channelId:channel!.id,confirmed:true},undefined,{serverConsent:true});}}>Выполнить</Button>}
  <JobBox job={{...job,decideConsent:decide}} onCancel={()=>void job.cancel()} note="Обычно занимает меньше минуты."/>
  {job.status==='done'&&<p className="text-success">✓ Готово. Тексты лежат на странице «Публикация» в блоке «Предложение модели». Проверьте их перед тем, как подставлять.</p>}
  {job.status==='error'&&approved&&<p className="text-accent">Цена была подтверждена, поэтому запрос мог быть отправлен и оплачен. Через Помощника повтор не запускается: проверьте страницу «Публикация» и при необходимости повторите там.</p>}
 </section>;
}
type FactCheckDone={report:{summary:{total:number;false:number;misleading:number;unverified:number};changed:number;removed:number;remaining:number;passed:boolean}};
/** Платное действие: проверка фактов сценария ролика. Внутри — то же окно цены с ограничителем, что у кнопки на странице «Сценарий». */
function FactCheckCard({projects,defaultProject,disabled}:{projects:{id:string;title:string}[];defaultProject:string;disabled?:boolean}){
 const {channel}=useActiveChannel();
 const job=useJob<FactCheckDone>('/assistant/actions/fact-check');
 const [project,setProject]=useState(defaultProject),[approved,setApproved]=useState(false);
 const running=job.status==='running';
 useEffect(()=>{if(!running)setProject(defaultProject);},[defaultProject]);
 const decide=(c:PriceChallenge,d:'approve'|'deny')=>{if(d==='approve')setApproved(true);job.decideConsent(c,d);};
 const r=job.status==='done'?job.data?.report:undefined;
 return <section className="space-y-2 rounded-lg border border-primary/40 p-3 text-sm" aria-label={'Действие: '+TITLES['fact-check']}>
  <h4 className="font-semibold">Действие: {TITLES['fact-check']}</h4>
  <p className="text-xs">Платно: несколько запросов к моделям AnyModel, как у кнопки «Проверить факты — платно» на странице «Сценарий». Окно подтверждения покажет «до N запросов» и ориентир цены; без вашего «Подтвердить» ничего не уйдёт. Автоповтора и резервных моделей нет. Проверяется сценарий выбранного ролика, исправленный текст сохраняется в ролик.</p>
  <p className="text-xs text-muted-foreground">Канал: {channel?.name??'не выбран'}</p>
  <label className="block text-xs">Ролик<Select aria-label="Ролик для проверки фактов" value={project} disabled={running||disabled} onChange={e=>{setProject(e.target.value);setApproved(false);}}><option value="">Выберите проект</option>{projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</Select></label>
  {!running&&<Button size="sm" disabled={disabled||!project||!channel} onClick={()=>{setApproved(false);void job.start({projectId:project,channelId:channel!.id,confirmed:true},undefined,{serverConsent:true});}}>Выполнить</Button>}
  <JobBox job={{...job,decideConsent:decide}} onCancel={()=>void job.cancel()} note="Обычно занимает несколько минут."/>
  {job.status==='done'&&<p className="text-success">✓ Готово{r?`: проверено утверждений ${r.summary.total}, неверных ${r.summary.false}, неточных ${r.summary.misleading}, не подтверждено ${r.summary.unverified}; исправлено предложений ${r.changed}, убрано ${r.removed}, осталось с неточностью ${r.remaining}`:''}. Отчёт и исправленный текст — на странице «Сценарий» этого ролика. Проверьте их.</p>}
  {job.status==='error'&&approved&&<p className="text-accent">Цена была подтверждена, поэтому запросы могли быть отправлены и оплачены. Через Помощника повтор не запускается: проверьте страницу «Сценарий» и при необходимости повторите там.</p>}
 </section>;
}
type RadarDone={ideas:number;notes:string[];stopped?:string};
/** Радар текущего канала. Внутри — то же окно цены с ограничителем, что у кнопки Радара на странице «Идеи для канала». */
function RadarCard({disabled}:{disabled?:boolean}){
 const {channel}=useActiveChannel();
 const job=useJob<RadarDone>('/assistant/actions/radar');
 const [approved,setApproved]=useState(false);
 const running=job.status==='running';
 const decide=(c:PriceChallenge,d:'approve'|'deny')=>{if(d==='approve')setApproved(true);job.decideConsent(c,d);};
 const r=job.status==='done'?job.data:undefined;
 return <section className="space-y-2 rounded-lg border border-primary/40 p-3 text-sm" aria-label={'Действие: '+TITLES['radar']}>
  <h4 className="font-semibold">Действие: {TITLES['radar']}</h4>
  <p className="text-xs">Платно, если подключён ИИ: до 7 запросов к быстрой модели AnyModel, как у кнопки Радара на странице «Идеи для канала». Окно подтверждения покажет ориентир цены; без вашего «Подтвердить» Радар не запустится и квота YouTube не потратится. Без ключа ИИ или при исчерпанном бюджете канала окна нет: Радар идёт бесплатно, но тратит квоту YouTube. Автоповтора и резервных моделей нет.</p>
  <p className="text-xs text-muted-foreground">Канал: {channel?.name??'не выбран'}</p>
  {!running&&<Button size="sm" disabled={disabled||!channel} onClick={()=>{setApproved(false);void job.start({channelId:channel!.id,confirmed:true},undefined,{serverConsent:true});}}>Выполнить</Button>}
  <JobBox job={{...job,decideConsent:decide}} onCancel={()=>void job.cancel()} note="Обычно занимает несколько минут."/>
  {r&&<div className="space-y-1"><p className="text-success">✓ Готово: идей в списке {r.ideas}. Сами идеи — на странице «Идеи для канала».</p>{r.stopped&&<p className="text-crown">! {r.stopped}</p>}{r.notes.map((n,i)=><p key={i} className="text-xs text-muted-foreground">{n}</p>)}</div>}
  {job.status==='error'&&approved&&<p className="text-accent">Цена была подтверждена, поэтому запросы могли быть отправлены и оплачены. Через Помощника повтор не запускается: проверьте страницу «Идеи для канала» и при необходимости повторите там.</p>}
 </section>;
}
type ScriptWriteDone={title:string;notes:string[]};
/** Сценарий ролика с настройками страницы по умолчанию. Внутри — то же окно цены с ограничителем, что у кнопки на странице «Сценарий». */
function ScriptWriteCard({projects,defaultProject,disabled}:{projects:{id:string;title:string}[];defaultProject:string;disabled?:boolean}){
 const {channel}=useActiveChannel();
 const job=useJob<ScriptWriteDone>('/assistant/actions/script-write');
 const [project,setProject]=useState(defaultProject),[approved,setApproved]=useState(false);
 const running=job.status==='running';
 useEffect(()=>{if(!running)setProject(defaultProject);},[defaultProject]);
 const decide=(c:PriceChallenge,d:'approve'|'deny')=>{if(d==='approve')setApproved(true);job.decideConsent(c,d);};
 const r=job.status==='done'?job.data:undefined;
 return <section className="space-y-2 rounded-lg border border-primary/40 p-3 text-sm" aria-label={'Действие: '+TITLES['script-write']}>
  <h4 className="font-semibold">Действие: {TITLES['script-write']}</h4>
  <p className="text-xs">Платно: много запросов к моделям AnyModel, как у кнопки «Написать сценарий» на странице «Сценарий». Настройки — те, что страница подставляет сама: тема из идеи ролика (или его название), длина канала, включены сбор фактов, второе мнение и проверка фактов. Другие настройки — на странице. Окно подтверждения покажет «до N запросов» и ориентир цены; без вашего «Подтвердить» ничего не уйдёт. Новый сценарий добавится в ролик, прежний останется.</p>
  <p className="text-xs text-muted-foreground">Канал: {channel?.name??'не выбран'}</p>
  <label className="block text-xs">Ролик<Select aria-label="Ролик для сценария" value={project} disabled={running||disabled} onChange={e=>{setProject(e.target.value);setApproved(false);}}><option value="">Выберите проект</option>{projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</Select></label>
  {!running&&<Button size="sm" disabled={disabled||!project||!channel} onClick={()=>{setApproved(false);void job.start({projectId:project,channelId:channel!.id,confirmed:true},undefined,{serverConsent:true});}}>Выполнить</Button>}
  <JobBox job={{...job,decideConsent:decide}} onCancel={()=>void job.cancel()} note="Обычно занимает несколько минут."/>
  {r&&<div className="space-y-1"><p className="text-success">✓ Готово: «{r.title}». Сценарий и отчёт — на странице «Сценарий» этого ролика.</p>{r.notes.map((n,i)=><p key={i} className="text-xs text-muted-foreground">{n}</p>)}</div>}
  {job.status==='error'&&approved&&<p className="text-accent">Цена была подтверждена, поэтому запросы могли быть отправлены и оплачены. Через Помощника повтор не запускается: проверьте страницу «Сценарий» и при необходимости повторите там.</p>}
 </section>;
}
type MontageDone={seconds:number;width:number;height:number;subtitles?:{problem:string|null}};
/** Бесплатная сборка черновика монтажа: та же, что кнопкой «Собрать» на странице «Монтаж». Закрытие панели сборку не останавливает. */
function MontageRenderCard({projects,defaultProject,disabled}:{projects:{id:string;title:string}[];defaultProject:string;disabled?:boolean}){
 const {channel}=useActiveChannel();
 const job=useJob<MontageDone>('/assistant/actions/montage-render');
 const [project,setProject]=useState(defaultProject);
 const running=job.status==='running';
 useEffect(()=>{if(!running)setProject(defaultProject);},[defaultProject]);
 const r=job.status==='done'?job.data:undefined;
 return <section className="space-y-2 rounded-lg border p-3 text-sm" aria-label={'Действие: '+TITLES['montage-render']}>
  <h4 className="font-semibold">Действие: {TITLES['montage-render']}</h4>
  <p className="text-xs text-muted-foreground">Бесплатно: собирается на этом компьютере, как кнопкой «Собрать» на странице «Монтаж», с теми же проверками файлов. Первая сборка может занять больше часа. Принять ролик и сохранить файлы можно только на странице «Монтаж» после просмотра.</p>
  <label className="block text-xs">Ролик<Select aria-label="Ролик для сборки монтажа" value={project} disabled={running||disabled} onChange={e=>setProject(e.target.value)}><option value="">Выберите проект</option>{projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</Select></label>
  {!running&&<Button size="sm" disabled={disabled||!project||!channel} onClick={()=>void job.start({projectId:project,channelId:channel!.id,confirmed:true})}>Выполнить</Button>}
  <JobBox job={job} onCancel={()=>void job.cancel()} note="Можно закрыть панель: сборка продолжится."/>
  {r&&<div className="space-y-1"><p className="text-success">✓ Готово: черновик {r.width}×{r.height}, {Math.floor(r.seconds/60)}:{String(Math.floor(r.seconds%60)).padStart(2,'0')}. Посмотрите его и примите на странице «Монтаж».</p>{r.subtitles?.problem&&<p className="text-crown">! Субтитры не подготовлены: {r.subtitles.problem}</p>}</div>}
 </section>;
}
type ShortsInfo={blocker:string|null;fragments:{id:string;start:number;end:number;seconds:number;text:string}[];limits:{pick:number}};
/** Бесплатная сборка Shorts: та же, что кнопкой «Собрать отмеченные» на странице «Shorts». Куски отмечает владелец. */
function ShortsBuildCard({projects,defaultProject,disabled}:{projects:{id:string;title:string}[];defaultProject:string;disabled?:boolean}){
 const {channel}=useActiveChannel();
 const job=useJob<{items:unknown[]}>('/assistant/actions/shorts-build');
 const [project,setProject]=useState(defaultProject),[picked,setPicked]=useState<string[]>([]);
 const running=job.status==='running';
 useEffect(()=>{if(!running)setProject(defaultProject);},[defaultProject]);
 useEffect(()=>{setPicked([]);},[project]);
 const info=useQuery({queryKey:['assistant-shorts',project],queryFn:()=>api<ShortsInfo>(`/studio/shorts/projects/${project}`),enabled:!!project,retry:false,refetchOnWindowFocus:false});
 const limit=info.data?.limits.pick??5;
 const toggle=(id:string)=>setPicked(p=>p.includes(id)?p.filter(x=>x!==id):p.length<limit?[...p,id]:p);
 const clock=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
 const done=job.status==='done'?job.data?.items.length??0:null;
 return <section className="space-y-2 rounded-lg border p-3 text-sm" aria-label={'Действие: '+TITLES['shorts-build']}>
  <h4 className="font-semibold">Действие: {TITLES['shorts-build']}</h4>
  <p className="text-xs text-muted-foreground">Бесплатно: собирается на этом компьютере из принятого монтажа, как на странице «Shorts». Отметьте до {limit} кусков. Принять Shorts и сохранить файлы можно только на странице «Shorts» после просмотра.</p>
  <label className="block text-xs">Ролик<Select aria-label="Ролик для Shorts" value={project} disabled={running||disabled} onChange={e=>setProject(e.target.value)}><option value="">Выберите проект</option>{projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</Select></label>
  {info.error!=null&&<ErrorAlert error={info.error}/>}
  {info.data?.blocker&&<p className="text-accent">✕ {info.data.blocker}</p>}
  {info.data&&!info.data.blocker&&info.data.fragments.length===0&&<p className="text-xs">Подходящих кусков не нашлось.</p>}
  {info.data&&!info.data.blocker&&info.data.fragments.length>0&&<ul className="max-h-64 space-y-1 overflow-y-auto">{info.data.fragments.map(f=>{const on=picked.includes(f.id);return <li key={f.id}><label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={on} disabled={running||disabled||(!on&&picked.length>=limit)} onChange={()=>toggle(f.id)}/><span><b>{clock(f.start)}–{clock(f.end)} · {Math.round(f.seconds)} с</b> <span className="text-muted-foreground" dir="auto">{f.text}</span></span></label></li>;})}</ul>}
  {!running&&<Button size="sm" disabled={disabled||!project||!channel||!picked.length||!!info.data?.blocker} onClick={()=>void job.start({projectId:project,channelId:channel!.id,ids:picked,confirmed:true})}>Выполнить ({picked.length})</Button>}
  <JobBox job={job} onCancel={()=>void job.cancel()} note="Можно закрыть панель: сборка продолжится."/>
  {done!==null&&<p className="text-success">✓ Готово: собрано Shorts {done}. Посмотрите и примите их на странице «Shorts».</p>}
 </section>;
}
const mark={ok:'✓',warn:'!',block:'✕'} as const;

/** Одно действие из списка Помощника. Выполняется только по нажатию владельца; сервер повторно проверяет список. */
export function AssistantActionCard({proposal,projects,defaultProject,pageTitle,disabled}:{proposal:ActionProposal;projects:{id:string;title:string}[];defaultProject:string;pageTitle?:string;disabled?:boolean}){
 const navigate=useNavigate();
 const [project,setProject]=useState(defaultProject),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[result,setResult]=useState<ActionResult|null>(null);
 const alive=useRef(true);useEffect(()=>()=>{alive.current=false;},[]);
 useEffect(()=>{setProject(defaultProject);},[defaultProject]);
 useEffect(()=>{setResult(null);setError(null);},[project]);
 if(!KNOWN(proposal.kind))return <div className="rounded-lg border border-accent/50 p-3 text-sm" aria-label="Недоступное действие">Помощник предложил действие, которого нет в списке. Оно не выполняется.</div>;
 if(proposal.kind==='publish-texts')return <PublishTextsCard projects={projects} defaultProject={defaultProject} disabled={disabled}/>;
 if(proposal.kind==='fact-check')return <FactCheckCard projects={projects} defaultProject={defaultProject} disabled={disabled}/>;
 if(proposal.kind==='radar')return <RadarCard disabled={disabled}/>;
 if(proposal.kind==='script-write')return <ScriptWriteCard projects={projects} defaultProject={defaultProject} disabled={disabled}/>;
 if(proposal.kind==='montage-render')return <MontageRenderCard projects={projects} defaultProject={defaultProject} disabled={disabled}/>;
 if(proposal.kind==='shorts-build')return <ShortsBuildCard projects={projects} defaultProject={defaultProject} disabled={disabled}/>;
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
   {(SECTION_ACTIONS[s.id]??[]).map(kind=><AssistantActionCard key={kind} proposal={{kind}} projects={projects} defaultProject={defaultProject}/>)}
  </article>)}
 </section>;
}
