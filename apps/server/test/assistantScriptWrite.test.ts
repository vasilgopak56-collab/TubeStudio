// Помощник: «Написать сценарий» через окно цены и запись попытки.
// Настоящих запросов нет: вместо нейросети — заглушка, у каждого теста пустая папка данных и нет ключей.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ApiError} from '../src/lib/errors.js';
import type {JobCtx} from '../src/lib/jobs.js';
import {runTask,taskContext} from '../src/lib/taskContext.js';
import {writeJson} from '../src/lib/storage.js';
import {addArtifact,createProject} from '../src/services/projects.js';
import {createChannel} from '../src/services/studio/channels.js';
import type {StudioScriptInputT} from '../src/services/studio/scriptFlow.js';
import {readScriptWriteAttempt,reserveScriptWrite,runScriptWriteAction} from '../src/services/assistantScriptWrite.js';

const ctx:JobCtx={signal:new AbortController().signal,progress:()=>{},partial:()=>{}};
const channel=()=>createChannel({name:'Test',niche:'history',language:'en',lengthMin:12}).then(c=>c.id);
/** Сохраняет сценарий с отчётом студии, как это делает запуск сценария. */
const saveScript=(projectId:string,at:string)=>addArtifact(projectId,{kind:'script',title:'Сценарий',data:{script:'Text.',studio:{at}}});
/** Заглушка: изображает подтверждение цены в окне и затем результат или сбой. */
const fake=(o:{approve:boolean;fail?:boolean})=>async(input:StudioScriptInputT):Promise<any>=>{
 if(o.approve)taskContext()?.onPriceConsentResolved?.({id:crypto.randomUUID(),status:'approved'});
 if(o.fail)throw new ApiError('UPSTREAM','Таймаут сервиса.',502);
 await saveScript(input.projectId!,new Date().toISOString());
 return {projectId:input.projectId,title:'Сценарий',notes:[]};
};
const ask=(projectId:string,channelId:string)=>({projectId,channelId,confirmed:true});

test('без подтверждения запуска ничего не записывается и не отправляется; лишние настройки не принимаются',async()=>{
 const ch=await channel(),p=await createProject({title:'Без подтверждения'});
 await assert.rejects(reserveScriptWrite({projectId:p.id,channelId:ch}),/не подтверждён/);
 await assert.rejects(reserveScriptWrite({...ask(p.id,ch),topic:'Другая тема'}),/не подтверждён/,'тема через Помощника не задаётся');
 assert.equal(await readScriptWriteAttempt(p.id),null);
});

test('настройки страницы по умолчанию: тема, угол и образец из идеи ролика, длина канала, все шаги включены',async()=>{
 const ch=await channel(),p=await createProject({title:'Ролик из Радара'});
 await addArtifact(p.id,{kind:'topic',title:'Идея',data:{url:'https://www.youtube.com/watch?v=abc',version:{title:'Тема из Радара',angle:'Наш угол'}}});
 const a=await reserveScriptWrite(ask(p.id,ch));
 const seen:StudioScriptInputT[]=[];
 await runScriptWriteAction(a,ctx,async(input,c)=>{seen.push(input);return fake({approve:true})(input);});
 assert.deepEqual(seen,[{channelId:ch,projectId:p.id,topic:'Тема из Радара',angle:'Наш угол',donorUrl:'https://www.youtube.com/watch?v=abc',minutes:12,research:true,critic:true,factCheck:true,notes:''}]);
 const q=await createProject({title:'Свой ролик'});
 const b=await reserveScriptWrite(ask(q.id,ch));
 assert.equal(b.input.topic,'Свой ролик');assert.equal(b.input.angle,'');assert.equal(b.input.donorUrl,'');
 await runScriptWriteAction(b,ctx,fake({approve:true}));
});

test('короткая тема — запуск не начинается и попытка не записывается',async()=>{
 const ch=await channel(),p=await createProject({title:'Ой'});
 await assert.rejects(reserveScriptWrite(ask(p.id,ch)),/не подходит тема/);
 assert.equal(await readScriptWriteAttempt(p.id),null);
 await reserveScriptWrite(ask(crypto.randomUUID(),ch)).then(()=>assert.fail('нет ролика'),()=>{});
});

test('попытка записывается до запроса, двойное нажатие даёт один запуск',async()=>{
 const ch=await channel(),p=await createProject({title:'Двойной клик'});
 const a=await reserveScriptWrite(ask(p.id,ch));
 assert.equal((await readScriptWriteAttempt(p.id))?.status,'started');
 await assert.rejects(reserveScriptWrite(ask(p.id,ch)),/уже пишется/);
 await runScriptWriteAction(a,ctx,fake({approve:true}));
 assert.equal((await readScriptWriteAttempt(p.id))?.status,'done');
 await reserveScriptWrite(ask(p.id,ch)).then(b=>runScriptWriteAction(b,ctx,fake({approve:true})));
});

test('отказ в окне цены — «не отправлено», повтор разрешён',async()=>{
 const ch=await channel(),p=await createProject({title:'Отказ'});
 const a=await reserveScriptWrite(ask(p.id,ch));
 await assert.rejects(runScriptWriteAction(a,ctx,async()=>{throw new ApiError('BUDGET_CONSENT_DENIED','Пользователь отклонил этот платный вызов.',402);}),/отклонил/);
 const r=await readScriptWriteAttempt(p.id);
 assert.equal(r?.status,'not-sent');assert.equal(r?.error?.code,'BUDGET_CONSENT_DENIED');
 await reserveScriptWrite(ask(p.id,ch)).then(b=>runScriptWriteAction(b,ctx,fake({approve:true})));
});

test('сбой после подтверждения цены — «мог быть оплачен», Помощник повтор не запускает',async()=>{
 const ch=await channel(),p=await createProject({title:'Таймаут'});
 const a=await reserveScriptWrite(ask(p.id,ch));
 await assert.rejects(runScriptWriteAction(a,ctx,fake({approve:true,fail:true})),/Таймаут/);
 assert.equal((await readScriptWriteAttempt(p.id))?.status,'maybe-paid');
 await assert.rejects(reserveScriptWrite(ask(p.id,ch)),/могли быть оплачены/);
});

test('незавершённая попытка (программу закрыли) блокирует повтор, новый сценарий со страницы снимает запрет',async()=>{
 const ch=await channel(),p=await createProject({title:'Перезапуск'}),startedAt=new Date(Date.now()-60_000).toISOString();
 await writeJson(`assistant-actions/script-write-${p.id}.json`,{version:1,attemptId:crypto.randomUUID(),projectId:p.id,channelId:ch,startedAt,input:{},status:'started'});
 await assert.rejects(reserveScriptWrite(ask(p.id,ch)),/результат неизвестен/);
 await saveScript(p.id,new Date(Date.now()-120_000).toISOString());
 await assert.rejects(reserveScriptWrite(ask(p.id,ch)),/результат неизвестен/,'старый сценарий запрет не снимает');
 await saveScript(p.id,new Date().toISOString());
 await reserveScriptWrite(ask(p.id,ch)).then(a=>runScriptWriteAction(a,ctx,fake({approve:true})));
});

test('настоящий запуск без окна подтверждения: запрос не отправлен, итог «не отправлено»',async()=>{
 const ch=await channel(),p=await createProject({title:'Настоящий запуск'});
 const a=await reserveScriptWrite(ask(p.id,ch));
 await assert.rejects(runTask({},()=>runScriptWriteAction(a,ctx)));
 const r=await readScriptWriteAttempt(p.id);
 assert.equal(r?.status,'not-sent');
 assert.ok(r?.error?.message,'причина записана');
});
