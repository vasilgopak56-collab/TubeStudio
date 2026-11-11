// Помощник по всей программе: платное действие «Проверить факты сценария».
// Запуск только кнопкой владельца, затем то же окно цены с ограничителем, что у кнопки «Проверить факты — платно» на странице «Сценарий».
// Проверяется только сценарий ролика (вставленный текст — только на странице). Исправленный текст сохраняется в ролик, как на странице.
// Попытка записывается на диск ДО запроса. Если итог неизвестен или запрос мог быть оплачен, Помощник повтор не запускает:
// повторить можно только на странице «Сценарий»; новая проверка фактов там снимает запрет.
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ApiError} from '../lib/errors.js';
import type {JobCtx} from '../lib/jobs.js';
import {readJson,writeJson} from '../lib/storage.js';
import {runTask,taskContext} from '../lib/taskContext.js';
import {getProject} from './projects.js';
import {runFactCheck} from './studio/scriptFlow.js';

const ID=z.string().uuid();
export const FactCheckAsk=z.object({projectId:ID,channelId:ID,confirmed:z.literal(true)}).strict();
export type FactCheckAttempt={version:1;attemptId:string;projectId:string;channelId:string;startedAt:string;status:'started'|'done'|'not-sent'|'maybe-paid';finishedAt?:string;error?:{code:string;message:string}};

const attemptFile=(projectId:string)=>`assistant-actions/fact-check-${ID.parse(projectId)}.json`;
/** Ролики, для которых запуск через Помощника уже идёт в этом процессе: защита от двойного нажатия. */
const reserving=new Set<string>();

export const readFactCheckAttempt=(projectId:string)=>readJson<FactCheckAttempt|null>(attemptFile(projectId),null);

/** Время последней проверки фактов в сценариях ролика. null — проверки не было. */
async function lastFactCheckAt(projectId:string):Promise<string|null>{
 const p=await getProject(projectId).catch(()=>null);
 let last:string|null=null;
 for(const a of p?.artifacts??[]){
  if(a.kind!=='script')continue;
  const at=(a.data as {studio?:{factCheck?:{at?:unknown}}}|undefined)?.studio?.factCheck?.at;
  if(typeof at==='string'&&(!last||at>last))last=at;
 }
 return last;
}

/** Почему повтор через Помощника нельзя. null — можно. Новая проверка фактов после попытки снимает запрет. */
export async function factCheckBlock(projectId:string):Promise<string|null>{
 const a=await readFactCheckAttempt(projectId);
 if(!a||a.status==='done'||a.status==='not-sent')return null;
 const at=await lastFactCheckAt(projectId);
 if(at&&at>a.startedAt)return null;
 return a.status==='started'
  ?'Прошлый запуск через Помощника не завершился: результат неизвестен, запросы могли быть отправлены и оплачены. Проверьте страницу «Сценарий». Повторить можно только там. Новый запрос не отправлен.'
  :'Прошлый запуск через Помощника закончился ошибкой после подтверждения цены: запросы могли быть оплачены. Проверьте страницу «Сценарий». Повторить можно только там. Новый запрос не отправлен.';
}

/** Бесплатная проверка и запись попытки до запроса. Ничего не отправляет. */
export async function reserveFactCheck(raw:unknown):Promise<FactCheckAttempt>{
 const parsed=FactCheckAsk.safeParse(raw);
 if(!parsed.success)throw new ApiError('VALIDATION','Запуск не подтверждён или не выбран ролик. Запрос не отправлен.');
 const {projectId,channelId}=parsed.data;
 if(reserving.has(projectId))throw new ApiError('VALIDATION','Факты этого ролика уже проверяются. Второй запрос не отправлен.',409);
 reserving.add(projectId);
 try{
  const block=await factCheckBlock(projectId);
  if(block)throw new ApiError('VALIDATION',block,409);
  const attempt:FactCheckAttempt={version:1,attemptId:randomUUID(),projectId,channelId,startedAt:new Date().toISOString(),status:'started'};
  await writeJson(attemptFile(projectId),attempt);
  return attempt;
 }catch(e){reserving.delete(projectId);throw e;}
}

type Runner=typeof runFactCheck;
/** Один запуск. Итог «не отправлено» ставится, только если цену так и не подтвердили; после подтверждения ошибка — «мог быть оплачен». */
export async function runFactCheckAction(attempt:FactCheckAttempt,ctx:JobCtx,run:Runner=runFactCheck){
 let approved=false;
 const outer=taskContext();
 const finish=(status:FactCheckAttempt['status'],error?:FactCheckAttempt['error'])=>writeJson(attemptFile(attempt.projectId),{...attempt,status,finishedAt:new Date().toISOString(),...(error?{error}:{})}).catch(()=>{});
 try{
  const result=await runTask({...outer,onPriceConsentResolved:r=>{if(r.status==='approved')approved=true;outer?.onPriceConsentResolved?.(r);}},()=>run({channelId:attempt.channelId,projectId:attempt.projectId},ctx));
  await finish('done');
  return result;
 }catch(e){
  await finish(approved?'maybe-paid':'not-sent',e instanceof ApiError?{code:e.code,message:e.message}:{code:'INTERNAL',message:'Неизвестная ошибка.'});
  throw e;
 }finally{reserving.delete(attempt.projectId);}
}
