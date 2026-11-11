// Помощник: проверка фактов сценария через окно цены и запись попытки.
// Настоящих запросов нет: вместо нейросети — заглушка, у каждого теста пустая папка данных и нет ключей.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ApiError} from '../src/lib/errors.js';
import type {JobCtx} from '../src/lib/jobs.js';
import {runTask,taskContext} from '../src/lib/taskContext.js';
import {writeJson} from '../src/lib/storage.js';
import {createProject,getProject,updateArtifactData} from '../src/services/projects.js';
import {createChannel} from '../src/services/studio/channels.js';
import {readFactCheckAttempt,reserveFactCheck,runFactCheckAction} from '../src/services/assistantFactCheck.js';

const ctx:JobCtx={signal:new AbortController().signal,progress:()=>{},partial:()=>{}};
const channelId=crypto.randomUUID();
const withScript=(title:string)=>createProject({title,artifact:{kind:'script',title:'Сценарий',data:{script:'Napoleon was born in 1769. He died in 1821.'}}});
/** Пишет отчёт проверки фактов в сценарий ролика, как это делает страница «Сценарий». */
async function markChecked(projectId:string,at:string){
 const p=await getProject(projectId),a=p.artifacts.find(x=>x.kind==='script')!;
 await updateArtifactData(p.id,a.id,(d:Record<string,any>|undefined)=>({...(d??{}),studio:{...(d?.studio??{}),factCheck:{at}}}));
}
/** Заглушка: изображает подтверждение цены в окне и затем результат или сбой. */
const fake=(o:{approve:boolean;fail?:boolean})=>async(raw:{projectId?:string}):Promise<any>=>{
 if(o.approve)taskContext()?.onPriceConsentResolved?.({id:crypto.randomUUID(),status:'approved'});
 if(o.fail)throw new ApiError('UPSTREAM','Таймаут сервиса.',502);
 await markChecked(raw.projectId!,new Date().toISOString());
 return {report:{},script:'',lint:{}};
};
const ask=(projectId:string,extra:object={})=>({projectId,channelId,confirmed:true,...extra});

test('без подтверждения запуска ничего не записывается и не отправляется',async()=>{
 const p=await withScript('Без подтверждения');
 await assert.rejects(reserveFactCheck({projectId:p.id,channelId}),/не подтверждён/);
 await assert.rejects(reserveFactCheck({projectId:p.id,channelId,confirmed:true,text:'вставленный текст'}),/не подтверждён/,'вставленный текст через Помощника не принимается');
 assert.equal(await readFactCheckAttempt(p.id),null);
});

test('попытка записывается до запроса, двойное нажатие даёт один запуск, проверяется сценарий ролика',async()=>{
 const p=await withScript('Двойной клик');
 const a=await reserveFactCheck(ask(p.id));
 assert.equal((await readFactCheckAttempt(p.id))?.status,'started');
 await assert.rejects(reserveFactCheck(ask(p.id)),/уже проверяются/);
 const seen:unknown[]=[];
 await runFactCheckAction(a,ctx,async(raw,c)=>{seen.push(raw);return fake({approve:true})(raw);});
 assert.deepEqual(seen,[{channelId,projectId:p.id}]);
 assert.equal((await readFactCheckAttempt(p.id))?.status,'done');
 await reserveFactCheck(ask(p.id)).then(b=>runFactCheckAction(b,ctx,fake({approve:true})));
});

test('отказ в окне цены или ошибка до подтверждения — «не отправлено», повтор разрешён',async()=>{
 const p=await withScript('Отказ');
 const a=await reserveFactCheck(ask(p.id));
 await assert.rejects(runFactCheckAction(a,ctx,async()=>{throw new ApiError('BUDGET_CONSENT_DENIED','Пользователь отклонил этот платный вызов.',402);}),/отклонил/);
 const r=await readFactCheckAttempt(p.id);
 assert.equal(r?.status,'not-sent');assert.equal(r?.error?.code,'BUDGET_CONSENT_DENIED');
 const b=await reserveFactCheck(ask(p.id));
 await runFactCheckAction(b,ctx,fake({approve:true}));
});

test('сбой после подтверждения цены — «мог быть оплачен», Помощник повтор не запускает',async()=>{
 const p=await withScript('Таймаут');
 const a=await reserveFactCheck(ask(p.id));
 await assert.rejects(runFactCheckAction(a,ctx,fake({approve:true,fail:true})),/Таймаут/);
 assert.equal((await readFactCheckAttempt(p.id))?.status,'maybe-paid');
 await assert.rejects(reserveFactCheck(ask(p.id)),/могли быть оплачены/);
});

test('незавершённая попытка (программу закрыли) блокирует повтор, новая проверка со страницы снимает запрет',async()=>{
 const p=await withScript('Перезапуск'),startedAt=new Date(Date.now()-60_000).toISOString();
 await writeJson(`assistant-actions/fact-check-${p.id}.json`,{version:1,attemptId:crypto.randomUUID(),projectId:p.id,channelId,startedAt,status:'started'});
 await assert.rejects(reserveFactCheck(ask(p.id)),/результат неизвестен/);
 await markChecked(p.id,new Date(Date.now()-120_000).toISOString());
 await assert.rejects(reserveFactCheck(ask(p.id)),/результат неизвестен/,'старая проверка запрет не снимает');
 await markChecked(p.id,new Date().toISOString());
 const a=await reserveFactCheck(ask(p.id));
 await runFactCheckAction(a,ctx,fake({approve:true}));
});

test('настоящий запуск без окна подтверждения: запрос не отправлен, итог «не отправлено»',async()=>{
 const p=await withScript('Настоящий'),real=(await createChannel({name:'Test',niche:'history',language:'en'})).id;
 const a=await reserveFactCheck(ask(p.id,{channelId:real}));
 await assert.rejects(runTask({},()=>runFactCheckAction(a,ctx)));
 const r=await readFactCheckAttempt(p.id);
 assert.equal(r?.status,'not-sent');
 assert.ok(r?.error?.message,'причина записана');
});
