// Помощник по всей программе: платное действие «Написать сценарий» для уже созданного ролика.
// Запуск только кнопкой владельца, затем то же окно цены с ограничителем, что у кнопки «Написать сценарий» на странице «Сценарий».
// Настройки — те, что страница подставляет сама: тема, «ваша версия» и ролик-образец из идеи ролика (иначе тема — название ролика),
// длина канала, включены сбор фактов, второе мнение и проверка фактов. Другие настройки — только на странице.
// Попытка записывается на диск ДО запроса. Если итог неизвестен или запросы могли быть оплачены, Помощник повтор не запускает:
// повторить можно только на странице «Сценарий»; новый сценарий с отчётом, сохранённый позже попытки, снимает запрет.
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ApiError} from '../lib/errors.js';
import type {JobCtx} from '../lib/jobs.js';
import {readJson,writeJson} from '../lib/storage.js';
import {runTask,taskContext} from '../lib/taskContext.js';
import {getProject} from './projects.js';
import {getChannel} from './studio/channels.js';
import {runStudioScript,StudioScriptInput,type StudioScriptInputT} from './studio/scriptFlow.js';

const ID=z.string().uuid();
export const ScriptWriteAsk=z.object({projectId:ID,channelId:ID,confirmed:z.literal(true)}).strict();
export type ScriptWriteAttempt={version:1;attemptId:string;projectId:string;channelId:string;startedAt:string;input:StudioScriptInputT;status:'started'|'done'|'not-sent'|'maybe-paid';finishedAt?:string;error?:{code:string;message:string}};

const attemptFile=(projectId:string)=>`assistant-actions/script-write-${ID.parse(projectId)}.json`;
/** Ролики, для которых запуск через Помощника уже идёт в этом процессе: защита от двойного нажатия. */
const reserving=new Set<string>();

export const readScriptWriteAttempt=(projectId:string)=>readJson<ScriptWriteAttempt|null>(attemptFile(projectId),null);

/** Время последнего сценария с отчётом студии в ролике (его сохраняет запуск сценария). null — такого не было. */
async function lastStudioScriptAt(projectId:string):Promise<string|null>{
 const p=await getProject(projectId).catch(()=>null);
 let last:string|null=null;
 for(const a of p?.artifacts??[]){
  if(a.kind!=='script')continue;
  const at=(a.data as {studio?:{at?:unknown}}|undefined)?.studio?.at;
  if(typeof at==='string'&&(!last||at>last))last=at;
 }
 return last;
}

/** Почему повтор через Помощника нельзя. null — можно. Новый сценарий после попытки снимает запрет. */
export async function scriptWriteBlock(projectId:string):Promise<string|null>{
 const a=await readScriptWriteAttempt(projectId);
 if(!a||a.status==='done'||a.status==='not-sent')return null;
 const at=await lastStudioScriptAt(projectId);
 if(at&&at>a.startedAt)return null;
 return a.status==='started'
  ?'Прошлый запуск сценария через Помощника не завершился: результат неизвестен, запросы могли быть отправлены и оплачены. Проверьте страницу «Сценарий». Повторить можно только там. Новый запрос не отправлен.'
  :'Прошлый запуск сценария через Помощника закончился ошибкой после подтверждения цены: запросы могли быть оплачены. Проверьте страницу «Сценарий». Повторить можно только там. Новый запрос не отправлен.';
}

/** Настройки, которые страница «Сценарий» подставляет для ролика сама. */
async function pageDefaults(projectId:string,channelId:string):Promise<StudioScriptInputT>{
 const p=await getProject(projectId);
 const ch=await getChannel(channelId);
 const topic=[...p.artifacts].reverse().find(a=>a.kind==='topic');
 const t=(topic?.data??{}) as {url?:string;version?:{title?:string;angle?:string}|null};
 const parsed=StudioScriptInput.safeParse({
  channelId,projectId,topic:(topic?(t.version?.title||p.title):p.title).trim(),angle:(topic?t.version?.angle??'':'').trim(),donorUrl:(topic?t.url??'':'').trim(),
  minutes:ch.lengthMin||10,research:true,critic:true,factCheck:true,notes:'',
 });
 if(!parsed.success)throw new ApiError('VALIDATION','У ролика не подходит тема для сценария (нужно от 3 символов) или ссылка на образец. Откройте страницу «Сценарий» и задайте её там. Запрос не отправлен.');
 return parsed.data;
}

/** Бесплатная проверка и запись попытки до запроса. Ничего не отправляет. */
export async function reserveScriptWrite(raw:unknown):Promise<ScriptWriteAttempt>{
 const parsed=ScriptWriteAsk.safeParse(raw);
 if(!parsed.success)throw new ApiError('VALIDATION','Запуск не подтверждён или не выбран ролик. Запрос не отправлен.');
 const {projectId,channelId}=parsed.data;
 if(reserving.has(projectId))throw new ApiError('VALIDATION','Сценарий этого ролика уже пишется. Второй запрос не отправлен.',409);
 reserving.add(projectId);
 try{
  const block=await scriptWriteBlock(projectId);
  if(block)throw new ApiError('VALIDATION',block,409);
  const input=await pageDefaults(projectId,channelId);
  const attempt:ScriptWriteAttempt={version:1,attemptId:randomUUID(),projectId,channelId,startedAt:new Date().toISOString(),input,status:'started'};
  await writeJson(attemptFile(projectId),attempt);
  return attempt;
 }catch(e){reserving.delete(projectId);throw e;}
}

type Runner=typeof runStudioScript;
/** Один запуск. Итог «не отправлено» ставится, только если цену так и не подтвердили; после подтверждения ошибка — «мог быть оплачен». */
export async function runScriptWriteAction(attempt:ScriptWriteAttempt,ctx:JobCtx,run:Runner=runStudioScript){
 let approved=false;
 const outer=taskContext();
 const finish=(status:ScriptWriteAttempt['status'],error?:ScriptWriteAttempt['error'])=>writeJson(attemptFile(attempt.projectId),{...attempt,status,finishedAt:new Date().toISOString(),...(error?{error}:{})}).catch(()=>{});
 try{
  const result=await runTask({...outer,onPriceConsentResolved:r=>{if(r.status==='approved')approved=true;outer?.onPriceConsentResolved?.(r);}},()=>run(attempt.input,ctx));
  await finish('done');
  return result;
 }catch(e){
  await finish(approved?'maybe-paid':'not-sent',e instanceof ApiError?{code:e.code,message:e.message}:{code:'INTERNAL',message:'Неизвестная ошибка.'});
  throw e;
 }finally{reserving.delete(attempt.projectId);}
}
