// Internal one-attempt model stage. No route/UI until end-to-end release is ready.
// Evidence input must be loaded and validated by the future trusted coordinator.
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ApiError} from '../../lib/errors.js';
import {checkCancelled,withTaskSignal,withStoryboardGuard,taskContext} from '../../lib/taskContext.js';
import type {JobCtx} from '../../lib/jobs.js';
import {amCached,amCatalogFresh} from '../anymodel.js';
import {capturePrice,type PriceSnapshot} from '../usagePricing.js';
import {generatePinnedText,extractJson} from '../llm.js';
import {reserveBrainstormAttempt} from './brainstormCollection.js';
import {buildBrainstormModelContext} from './brainstormModelContext.js';
import {estimateBrainstormModelCall} from './brainstormCost.js';
import {BrainstormProposal,composeBrainstormReport} from './brainstormReport.js';
import type {ScanResult} from './brainstormScan.js';
import type {TopicResult} from './brainstormTopics.js';
const Ask=z.object({projectId:z.string().uuid(),attemptId:z.string().uuid(),task:z.string().trim().min(2).max(10000),channel:z.object({name:z.string().trim().max(80),niche:z.string().trim().max(300),language:z.string().trim().max(20),format:z.string().trim().max(300)}).strict().nullable(),model:z.string().trim().min(1).max(180).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/)}).strict();
type AskT=z.infer<typeof Ask>;
type IO={price:(model:string)=>Promise<PriceSnapshot>;send:typeof generatePinnedText;reserve:typeof reserveBrainstormAttempt};
const defaults:IO={price:model=>capturePrice('anymodel',model,'text',amCached(model)?.billing,{catalogFresh:amCatalogFresh()}),send:generatePinnedText,reserve:reserveBrainstormAttempt};
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const outputLimit=4000;
export async function previewBrainstormIdeas(raw:AskT,scan:ScanResult,topics:TopicResult[],io:Pick<IO,'price'>=defaults){
 const input=Ask.parse(raw),context=buildBrainstormModelContext({task:input.task,channel:input.channel},scan,topics),price=await io.price(input.model);
 const cost=estimateBrainstormModelCall({model:input.model,contextHash:context.hash,characters:context.characters,outputLimit},price);
 const evidenceHash=hash({scan,topics}),previewHash=hash({input,evidenceHash,costHash:cost.previewHash});
 return {input,context,cost,evidenceHash,previewHash,notice:'Один текстовый запрос в AnyModel по показанной выборке. Сформированные идеи и оценки — предложения модели. Эта оценка не включает остальные этапы выпуска и не является лимитом списания.'};
}
/** Frozen data and exact tariff are checked again inside the provider queue before dispatch. */
export async function runBrainstormIdeas(raw:AskT & {previewHash:string;confirmed:true},scan:ScanResult,topics:TopicResult[],ctx:JobCtx,io:IO=defaults){
 const send=z.object({previewHash:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)}).passthrough().parse(raw),{previewHash,confirmed,...askRaw}=send,input=Ask.parse(askRaw);
 const frozenScan=JSON.parse(JSON.stringify(scan)) as ScanResult,frozenTopics=JSON.parse(JSON.stringify(topics)) as TopicResult[];
 return withTaskSignal(ctx.signal,async()=>{
  checkCancelled();const p=await previewBrainstormIdeas(input,frozenScan,frozenTopics,io);if(p.previewHash!==previewHash)throw new ApiError('VALIDATION','Данные или тариф изменились. Обновите просмотр; модель не запускалась.',409);
  await io.reserve(input.attemptId,input.projectId,p.previewHash,'brainstorm-ideas');checkCancelled();
  const previousGuard=taskContext()?.verifyStoryboard;
  const guard=async()=>{checkCancelled();await previousGuard?.();const latest=await previewBrainstormIdeas(input,frozenScan,frozenTopics,io);if(latest.previewHash!==p.previewHash)throw new ApiError('BUDGET_PRICE_UNKNOWN','Тариф или данные изменились после подтверждения. Запрос модели не отправлен.',402);};
  ctx.progress('Проверяю тариф и готовлю идеи',20);
  const response=await withStoryboardGuard(guard,()=>io.send({system:p.context.system,user:p.context.user,maxTokens:outputLimit,temperature:.2},{provider:'anymodel',model:input.model}));checkCancelled();
  let rawOutput:unknown;try{rawOutput=extractJson(response.text);}catch{throw new ApiError('LLM_INVALID_JSON','Модель вернула некорректный ответ. Автоматического повтора нет; запрос мог быть оплачен.',502);}
  let report;try{report=composeBrainstormReport(frozenScan,frozenTopics,rawOutput);}catch{throw new ApiError('LLM_INVALID_JSON','Идеи не прошли проверку формата или источников. Автоматического повтора нет; запрос мог быть оплачен.',502);}
  ctx.partial({unsavedReport:report,attemptId:input.attemptId});ctx.progress('Идеи подготовлены, ещё не сохранены',90);
  return {report,proposal:BrainstormProposal.parse(rawOutput),evidenceHash:p.evidenceHash,attemptId:input.attemptId,model:input.model,notice:'Черновик в задаче, ещё не сохранён в проект. Данные — ограниченная выборка; оценки и объяснения требуют проверки.'};
 });
}
