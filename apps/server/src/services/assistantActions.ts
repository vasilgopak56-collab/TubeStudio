// Выпуск 4, Помощник по всей программе, шаг 1.
// Бесплатный ответ из справки, ориентир цены вопроса модели и короткий список бесплатных действий.
// Нейросеть может только предложить действие; выполняет его владелец своей кнопкой, сервер проверяет список.
import {z} from 'zod';
import {ApiError} from '../lib/errors.js';
import {ASSISTANT_KNOWLEDGE} from './assistantKnowledge.js';
import {amCached,amCatalog,amCatalogFresh} from './anymodel.js';
import {capturePrice,operationCost} from './usagePricing.js';
import {checkMontage} from './studio/montageCheck.js';
import {publishState} from './studio/publishCard.js';

const ID=z.string().uuid();
const Path=z.string().max(180).regex(/^\/[a-zA-Z0-9/_-]*$/);

/** Страницы, которые Помощник может открыть: только разделы встроенной справки. */
export const ASSISTANT_PAGES:ReadonlySet<string>=new Set(ASSISTANT_KNOWLEDGE.map(s=>s.route));

/** Что модель может предложить. Проверка по списку — при выполнении, чтобы неверное предложение не губило оплаченный ответ. */
export const AssistantActionProposal=z.object({kind:z.string().trim().min(1).max(40),route:z.string().max(180).optional()}).strict();

export const AssistantAction=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('open-page'),route:Path}).strict(),
 z.object({kind:z.literal('montage-check'),projectId:ID}).strict(),
 z.object({kind:z.literal('publish-readiness'),projectId:ID}).strict(),
]);
export type AssistantActionInput=z.infer<typeof AssistantAction>;
export const AssistantActionRun=z.object({action:AssistantAction,confirmed:z.literal(true)}).strict();

export type AssistantActionResult={kind:AssistantActionInput['kind'];title:string;ok:boolean;navigate?:string;lines:{level:'ok'|'warn'|'block';message:string}[]};

export const ACTION_TITLES:Record<AssistantActionInput['kind'],string>={
 'open-page':'Открыть страницу',
 'montage-check':'Проверить ролик перед монтажом',
 'publish-readiness':'Показать готовность карточки публикации',
};

/** Выполняет одно бесплатное действие только на чтение. Ничего не меняет, платных запросов нет. */
export async function runAssistantAction(raw:unknown):Promise<AssistantActionResult>{
 const parsed=AssistantActionRun.safeParse(raw);
 if(!parsed.success)throw new ApiError('VALIDATION','Такого действия нет в списке Помощника или оно не подтверждено. Ничего не выполнено.');
 const a=parsed.data.action,title=ACTION_TITLES[a.kind];
 if(a.kind==='open-page'){
  if(!ASSISTANT_PAGES.has(a.route))throw new ApiError('VALIDATION','Такой страницы нет в справке программы. Ничего не открыто.');
  return {kind:a.kind,title,ok:true,navigate:a.route,lines:[]};
 }
 if(a.kind==='montage-check'){
  const c=await checkMontage(a.projectId);
  const text=(i:{message:string;scenes:number[]})=>i.message+(i.scenes.length?` Сцены: ${i.scenes.slice(0,20).join(', ')}${i.scenes.length>20?' и другие':''}.`:'');
  const lines:AssistantActionResult['lines']=[...c.blockers.map(i=>({level:'block' as const,message:text(i)})),...c.warnings.map(i=>({level:'warn' as const,message:text(i)}))];
  if(c.ready)lines.unshift({level:'ok',message:`Можно собирать: сцен ${c.summary.scenes}, файлов ${c.summary.files}.`});
  else lines.unshift({level:'block',message:'Сборку начинать нельзя.'});
  return {kind:a.kind,title,ok:c.ready,lines};
 }
 const s=await publishState(a.projectId);
 const lines:AssistantActionResult['lines']=s.checks.map(c=>({level:c.level,message:c.message}));
 lines.unshift(s.ready?{level:'ok',message:'Карточка готова.'}:{level:'block',message:'Карточка не готова.'});
 return {kind:a.kind,title,ok:s.ready,lines};
}

export const AssistantHelpAsk=z.object({query:z.string().trim().max(500),currentPath:Path}).strict();

/** Бесплатный ответ: до трёх разделов справки по словам вопроса и текущей странице. Нейросеть не вызывается. */
export function assistantHelpAnswer(raw:unknown){
 const d=AssistantHelpAsk.parse(raw);
 const words=d.query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[];
 const sections=ASSISTANT_KNOWLEDGE.map(s=>({s,score:(s.route===d.currentPath?30:0)+words.reduce((n,w)=>n+(s.title.toLowerCase().includes(w)?8:0)+(s.short.toLowerCase().includes(w)?3:0)+(s.what.toLowerCase().includes(w)?1:0),0)}))
  .filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,3)
  .map(({s})=>({id:s.id,title:s.title,route:s.route,short:s.short,steps:[...s.steps],cost:s.cost}));
 return {sections};
}

/** Ориентир цены вопроса модели. null — цена неизвестна (нет тарифа или совместимое подключение). */
export async function assistantQuote(selection:{provider:string;model:string},characters:number,maxTokens:number):Promise<number|null>{
 if(selection.provider==='compatible')return null;
 try{
  if(selection.provider==='anymodel')await amCatalog().catch(()=>[]);
  const price=selection.provider==='anymodel'
   ?await capturePrice('anymodel',selection.model,'text',amCached(selection.model)?.billing,{catalogFresh:amCatalogFresh()})
   :await capturePrice(selection.provider,selection.model,'text');
  return operationCost(price,{input:Math.ceil(characters/2),output:maxTokens,known:true}).usd;
 }catch{return null;}
}
