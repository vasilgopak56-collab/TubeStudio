// Помощник по всей программе: действие «Запустить Радар» для текущего канала.
// Запуск только кнопкой владельца, затем то же окно цены с ограничителем, что у кнопки Радара на странице «Идеи для канала».
// Отказ в окне — Радар не запускается совсем, квота YouTube не тратится. Без ключа ИИ или при исчерпанном бюджете канала
// окна нет: Радар идёт бесплатно, как и на странице, но тратит квоту YouTube.
// Попытка записывается на диск ДО запуска. Если итог неизвестен или запросы могли быть оплачены, Помощник повтор не запускает:
// повторить можно только на странице «Идеи для канала»; новый прогон Радара там снимает запрет.
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ApiError} from '../lib/errors.js';
import type {JobCtx} from '../lib/jobs.js';
import {readJson,writeJson} from '../lib/storage.js';
import {runTask,taskContext} from '../lib/taskContext.js';
import {getChannel} from './studio/channels.js';
import {loadRadar,radarRunning,runRadar} from './studio/radar.js';

const ID=z.string().uuid();
export const RadarAsk=z.object({channelId:ID,confirmed:z.literal(true)}).strict();
export type RadarAttempt={version:1;attemptId:string;channelId:string;startedAt:string;status:'started'|'done'|'not-sent'|'maybe-paid';finishedAt?:string;error?:{code:string;message:string}};

const attemptFile=(channelId:string)=>`assistant-actions/radar-${ID.parse(channelId)}.json`;
/** Каналы, для которых запуск через Помощника уже идёт в этом процессе: защита от двойного нажатия. */
const reserving=new Set<string>();

export const readRadarAttempt=(channelId:string)=>readJson<RadarAttempt|null>(attemptFile(channelId),null);

/** Почему повтор через Помощника нельзя. null — можно. Новый прогон Радара после попытки снимает запрет. */
export async function radarBlock(channelId:string):Promise<string|null>{
 const a=await readRadarAttempt(channelId);
 if(!a||a.status==='done'||a.status==='not-sent')return null;
 const last=(await loadRadar(channelId)).runs.at(-1);
 if(last&&last.startedAt>a.startedAt)return null;
 return a.status==='started'
  ?'Прошлый запуск Радара через Помощника не завершился: результат неизвестен, запросы могли быть отправлены и оплачены. Проверьте страницу «Идеи для канала». Повторить можно только там. Новый запрос не отправлен.'
  :'Прошлый запуск Радара через Помощника закончился ошибкой после подтверждения цены: запросы могли быть оплачены. Проверьте страницу «Идеи для канала». Повторить можно только там. Новый запрос не отправлен.';
}

/** Бесплатная проверка и запись попытки до запуска. Ничего не отправляет. */
export async function reserveRadar(raw:unknown):Promise<RadarAttempt>{
 const parsed=RadarAsk.safeParse(raw);
 if(!parsed.success)throw new ApiError('VALIDATION','Запуск не подтверждён или не выбран канал. Радар не запущен.');
 const {channelId}=parsed.data;
 if(reserving.has(channelId)||radarRunning(channelId))throw new ApiError('VALIDATION','Радар этого канала уже ищет идеи. Второй запуск не начат.',409);
 reserving.add(channelId);
 try{
  await getChannel(channelId);
  const block=await radarBlock(channelId);
  if(block)throw new ApiError('VALIDATION',block,409);
  const attempt:RadarAttempt={version:1,attemptId:randomUUID(),channelId,startedAt:new Date().toISOString(),status:'started'};
  await writeJson(attemptFile(channelId),attempt);
  return attempt;
 }catch(e){reserving.delete(channelId);throw e;}
}

type Runner=(channelId:string,ctx:JobCtx)=>ReturnType<typeof runRadar>;
/** Один запуск. Итог «не отправлено» ставится, только если цену так и не подтвердили; после подтверждения ошибка — «мог быть оплачен». */
export async function runRadarAction(attempt:RadarAttempt,ctx:JobCtx,run:Runner=(id,c)=>runRadar(id,c)){
 let approved=false;
 const outer=taskContext();
 const finish=(status:RadarAttempt['status'],error?:RadarAttempt['error'])=>writeJson(attemptFile(attempt.channelId),{...attempt,status,finishedAt:new Date().toISOString(),...(error?{error}:{})}).catch(()=>{});
 try{
  const result=await runTask({...outer,onPriceConsentResolved:r=>{if(r.status==='approved')approved=true;outer?.onPriceConsentResolved?.(r);}},()=>run(attempt.channelId,ctx));
  await finish('done');
  return result;
 }catch(e){
  await finish(approved?'maybe-paid':'not-sent',e instanceof ApiError?{code:e.code,message:e.message}:{code:'INTERNAL',message:'Неизвестная ошибка.'});
  throw e;
 }finally{reserving.delete(attempt.channelId);}
}
