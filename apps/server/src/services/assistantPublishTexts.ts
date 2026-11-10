// Помощник по всей программе, шаг 2: первое платное действие — тексты публикации.
// Запуск только кнопкой владельца, затем то же окно цены, что на странице «Публикация»: один запрос, без повторов и резервных моделей.
// Попытка записывается на диск ДО запроса. Если итог неизвестен или запрос мог быть оплачен, Помощник повтор не запускает:
// повторить можно только на странице «Публикация», где видно, появились ли новые тексты.
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ApiError} from '../lib/errors.js';
import type {JobCtx} from '../lib/jobs.js';
import {readJson,writeJson} from '../lib/storage.js';
import {runTask,taskContext} from '../lib/taskContext.js';
import {publishState} from './studio/publishCard.js';
import {publishTextBusy,runPublishText} from './studio/publishText.js';

const ID=z.string().uuid();
export const PublishTextsAsk=z.object({projectId:ID,channelId:ID,confirmed:z.literal(true)}).strict();
export type PublishTextsAttempt={version:1;attemptId:string;projectId:string;channelId:string;startedAt:string;status:'started'|'done'|'not-sent'|'maybe-paid';finishedAt?:string;error?:{code:string;message:string}};

const attemptFile=(projectId:string)=>`assistant-actions/publish-texts-${ID.parse(projectId)}.json`;
/** Ролики, для которых запуск через Помощника уже идёт в этом процессе: защита от двойного нажатия. */
const reserving=new Set<string>();

export const readPublishTextsAttempt=(projectId:string)=>readJson<PublishTextsAttempt|null>(attemptFile(projectId),null);

/** Почему повтор через Помощника нельзя. null — можно. Новые тексты после попытки снимают запрет. */
export async function publishTextsBlock(projectId:string):Promise<string|null>{
 const a=await readPublishTextsAttempt(projectId);
 if(!a||a.status==='done'||a.status==='not-sent')return null;
 const proposal=(await publishState(projectId)).proposal;
 if(proposal&&proposal.at>a.startedAt)return null;
 return a.status==='started'
  ?'Прошлый запуск через Помощника не завершился: результат неизвестен, запрос мог быть отправлен и оплачен. Проверьте страницу «Публикация». Повторить можно только там. Новый запрос не отправлен.'
  :'Прошлый запуск через Помощника закончился ошибкой после подтверждения цены: запрос мог быть оплачен. Проверьте страницу «Публикация». Повторить можно только там. Новый запрос не отправлен.';
}

/** Бесплатная проверка и запись попытки до запроса. Ничего не отправляет. */
export async function reservePublishTexts(raw:unknown):Promise<PublishTextsAttempt>{
 const parsed=PublishTextsAsk.safeParse(raw);
 if(!parsed.success)throw new ApiError('VALIDATION','Запуск не подтверждён или не выбран ролик. Запрос не отправлен.');
 const {projectId,channelId}=parsed.data;
 if(reserving.has(projectId)||publishTextBusy(projectId))throw new ApiError('VALIDATION','Тексты для этого ролика уже готовятся. Второй запрос не отправлен.',409);
 reserving.add(projectId);
 try{
  const block=await publishTextsBlock(projectId);
  if(block)throw new ApiError('VALIDATION',block,409);
  const attempt:PublishTextsAttempt={version:1,attemptId:randomUUID(),projectId,channelId,startedAt:new Date().toISOString(),status:'started'};
  await writeJson(attemptFile(projectId),attempt);
  return attempt;
 }catch(e){reserving.delete(projectId);throw e;}
}

type Runner=typeof runPublishText;
/** Один запуск. Итог «не отправлено» ставится, только если цену так и не подтвердили; после подтверждения ошибка — «мог быть оплачен». */
export async function runPublishTextsAction(attempt:PublishTextsAttempt,ctx:JobCtx,run:Runner=runPublishText){
 let approved=false;
 const outer=taskContext();
 const finish=(status:PublishTextsAttempt['status'],error?:PublishTextsAttempt['error'])=>writeJson(attemptFile(attempt.projectId),{...attempt,status,finishedAt:new Date().toISOString(),...(error?{error}:{})}).catch(()=>{});
 try{
  const proposal=await runTask({...outer,onPriceConsentResolved:r=>{if(r.status==='approved')approved=true;outer?.onPriceConsentResolved?.(r);}},()=>run(attempt.projectId,{channelId:attempt.channelId},ctx));
  await finish('done');
  return proposal;
 }catch(e){
  await finish(approved?'maybe-paid':'not-sent',e instanceof ApiError?{code:e.code,message:e.message}:{code:'INTERNAL',message:'Неизвестная ошибка.'});
  throw e;
 }finally{reserving.delete(attempt.projectId);}
}
