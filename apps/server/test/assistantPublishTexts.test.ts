// Помощник, шаг 2: тексты публикации через окно цены и запись попытки.
// Настоящих запросов нет: вместо нейросети — заглушка, у каждого теста пустая папка данных и нет ключей.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ApiError} from '../src/lib/errors.js';
import type {JobCtx} from '../src/lib/jobs.js';
import {runTask,taskContext} from '../src/lib/taskContext.js';
import {writeJson} from '../src/lib/storage.js';
import {createProject} from '../src/services/projects.js';
import {createChannel} from '../src/services/studio/channels.js';
import {writeProposal,type Proposal} from '../src/services/studio/publishCard.js';
import {readPublishTextsAttempt,reservePublishTexts,runPublishTextsAction} from '../src/services/assistantPublishTexts.js';

const ctx:JobCtx={signal:new AbortController().signal,progress:()=>{},partial:()=>{}};
const channelId=crypto.randomUUID();
const proposal=(at:string):Proposal=>({at,model:'fake',keyword:'',titles:['T'],description:'D',tags:[],pinnedComments:[],chapters:[]});
/** Заглушка: изображает подтверждение цены в окне и затем результат или сбой. */
const fake=(o:{approve:boolean;fail?:boolean})=>async(projectId:string)=>{
 if(o.approve)taskContext()?.onPriceConsentResolved?.({id:crypto.randomUUID(),status:'approved'});
 if(o.fail)throw new ApiError('UPSTREAM','Таймаут сервиса.',502);
 const p=proposal(new Date().toISOString());await writeProposal(projectId,p);return p;
};
const ask=(projectId:string,extra:object={})=>({projectId,channelId,confirmed:true,...extra});

test('без подтверждения запуска ничего не записывается и не отправляется',async()=>{
 const p=await createProject({title:'Без подтверждения'});
 await assert.rejects(reservePublishTexts({projectId:p.id,channelId}),/не подтверждён/);
 assert.equal(await readPublishTextsAttempt(p.id),null);
});

test('попытка записывается до запроса, двойное нажатие даёт один запуск',async()=>{
 const p=await createProject({title:'Двойной клик'});
 const a=await reservePublishTexts(ask(p.id));
 assert.equal((await readPublishTextsAttempt(p.id))?.status,'started');
 await assert.rejects(reservePublishTexts(ask(p.id)),/уже готовятся/);
 let calls=0;
 await runPublishTextsAction(a,ctx,async(id,raw,c)=>{calls++;return fake({approve:true})(id);});
 assert.equal(calls,1);
 assert.equal((await readPublishTextsAttempt(p.id))?.status,'done');
 await reservePublishTexts(ask(p.id)).then(b=>runPublishTextsAction(b,ctx,fake({approve:true})));
});

test('отказ в окне цены или ошибка до подтверждения — «не отправлено», повтор разрешён',async()=>{
 const p=await createProject({title:'Отказ'});
 const a=await reservePublishTexts(ask(p.id));
 await assert.rejects(runPublishTextsAction(a,ctx,async()=>{throw new ApiError('BUDGET_CONSENT_DENIED','Пользователь отклонил этот платный вызов.',402);}),/отклонил/);
 const r=await readPublishTextsAttempt(p.id);
 assert.equal(r?.status,'not-sent');assert.equal(r?.error?.code,'BUDGET_CONSENT_DENIED');
 const b=await reservePublishTexts(ask(p.id));
 await runPublishTextsAction(b,ctx,fake({approve:true}));
});

test('сбой после подтверждения цены — «мог быть оплачен», Помощник повтор не запускает',async()=>{
 const p=await createProject({title:'Таймаут'});
 const a=await reservePublishTexts(ask(p.id));
 await assert.rejects(runPublishTextsAction(a,ctx,fake({approve:true,fail:true})),/Таймаут/);
 assert.equal((await readPublishTextsAttempt(p.id))?.status,'maybe-paid');
 await assert.rejects(reservePublishTexts(ask(p.id)),/мог быть оплачен/);
});

test('незавершённая попытка (программу закрыли) блокирует повтор, новые тексты со страницы снимают запрет',async()=>{
 const p=await createProject({title:'Перезапуск'}),startedAt=new Date(Date.now()-60_000).toISOString();
 await writeJson(`assistant-actions/publish-texts-${p.id}.json`,{version:1,attemptId:crypto.randomUUID(),projectId:p.id,channelId,startedAt,status:'started'});
 await assert.rejects(reservePublishTexts(ask(p.id)),/результат неизвестен/);
 await writeProposal(p.id,proposal(new Date(Date.now()-120_000).toISOString()));
 await assert.rejects(reservePublishTexts(ask(p.id)),/результат неизвестен/,'старые тексты запрет не снимают');
 await writeProposal(p.id,proposal(new Date().toISOString()));
 const a=await reservePublishTexts(ask(p.id));
 await runPublishTextsAction(a,ctx,fake({approve:true}));
});

test('настоящий запуск без принятого монтажа: деньги не потрачены, итог «не отправлено»',async()=>{
 const p=await createProject({title:'Без монтажа'}),real=(await createChannel({name:'Test',niche:'history',language:'en'})).id;
 const a=await reservePublishTexts(ask(p.id,{channelId:real}));
 await assert.rejects(runTask({},()=>runPublishTextsAction(a,ctx)),/Деньги не потрачены/);
 assert.equal((await readPublishTextsAttempt(p.id))?.status,'not-sent');
});
