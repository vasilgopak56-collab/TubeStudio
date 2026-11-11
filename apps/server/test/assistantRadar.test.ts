// Помощник: Радар через окно цены и запись попытки.
// Настоящих запросов нет: вместо Радара — заглушка, YouTube и нейросеть не вызываются, у каждого теста пустая папка данных и нет ключей.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ApiError} from '../src/lib/errors.js';
import type {JobCtx} from '../src/lib/jobs.js';
import {taskContext} from '../src/lib/taskContext.js';
import {readJson,writeJson} from '../src/lib/storage.js';
import {createChannel} from '../src/services/studio/channels.js';
import {readRadarAttempt,reserveRadar,runRadarAction} from '../src/services/assistantRadar.js';

const ctx:JobCtx={signal:new AbortController().signal,progress:()=>{},partial:()=>{}};
const channel=async()=>(await createChannel({name:'Test',niche:'history',language:'en'})).id;
/** Пишет прогон Радара в хранилище, как это делает страница «Идеи для канала». */
async function markRun(channelId:string,startedAt:string){
 const file=`studio/radar/${channelId}.json`;
 const s=await readJson<any>(file,null)??{version:1,channelId,videos:{},channels:{},ideas:{},samples:[],runs:[]};
 s.runs.push({id:crypto.randomUUID(),startedAt,finishedAt:startedAt,queries:[],stats:{},notes:[]});
 await writeJson(file,s);
}
/** Заглушка: изображает подтверждение цены в окне и затем результат или сбой. */
const fake=(o:{approve:boolean;fail?:boolean})=>async(channelId:string):Promise<any>=>{
 if(o.approve)taskContext()?.onPriceConsentResolved?.({id:crypto.randomUUID(),status:'approved'});
 if(o.fail)throw new ApiError('UPSTREAM','Таймаут сервиса.',502);
 await markRun(channelId,new Date().toISOString());
 return {runId:'r',queries:[],stats:{},notes:[],ideas:3,top:[]};
};
const ask=(channelId:string)=>({channelId,confirmed:true});

test('без подтверждения запуска ничего не записывается и не запускается',async()=>{
 const id=await channel();
 await assert.rejects(reserveRadar({channelId:id}),/не подтверждён/);
 await assert.rejects(reserveRadar({channelId:id,confirmed:true,projectId:crypto.randomUUID()}),/не подтверждён/,'лишние поля не принимаются');
 assert.equal(await readRadarAttempt(id),null);
});

test('несуществующий канал: попытка не записывается',async()=>{
 const id=crypto.randomUUID();
 await assert.rejects(reserveRadar(ask(id)));
 assert.equal(await readRadarAttempt(id),null);
});

test('попытка записывается до запуска, двойное нажатие даёт один запуск',async()=>{
 const id=await channel();
 const a=await reserveRadar(ask(id));
 assert.equal((await readRadarAttempt(id))?.status,'started');
 await assert.rejects(reserveRadar(ask(id)),/уже ищет идеи/);
 const seen:string[]=[];
 const r=await runRadarAction(a,ctx,async(cid,c)=>{seen.push(cid);return fake({approve:true})(cid);});
 assert.deepEqual(seen,[id]);assert.equal(r.ideas,3);
 assert.equal((await readRadarAttempt(id))?.status,'done');
 await reserveRadar(ask(id)).then(b=>runRadarAction(b,ctx,fake({approve:true})));
});

test('отказ в окне цены или ошибка до подтверждения — «не отправлено», повтор разрешён',async()=>{
 const id=await channel();
 const a=await reserveRadar(ask(id));
 await assert.rejects(runRadarAction(a,ctx,async()=>{throw new ApiError('BUDGET_CONSENT_DENIED','Пользователь отклонил этот платный вызов.',402);}),/отклонил/);
 const r=await readRadarAttempt(id);
 assert.equal(r?.status,'not-sent');assert.equal(r?.error?.code,'BUDGET_CONSENT_DENIED');
 const b=await reserveRadar(ask(id));
 await runRadarAction(b,ctx,fake({approve:true}));
});

test('сбой после подтверждения цены — «мог быть оплачен», Помощник повтор не запускает',async()=>{
 const id=await channel();
 const a=await reserveRadar(ask(id));
 await assert.rejects(runRadarAction(a,ctx,fake({approve:true,fail:true})),/Таймаут/);
 assert.equal((await readRadarAttempt(id))?.status,'maybe-paid');
 await assert.rejects(reserveRadar(ask(id)),/могли быть оплачены/);
});

test('незавершённая попытка (программу закрыли) блокирует повтор, новый прогон со страницы снимает запрет',async()=>{
 const id=await channel(),startedAt=new Date(Date.now()-60_000).toISOString();
 await writeJson(`assistant-actions/radar-${id}.json`,{version:1,attemptId:crypto.randomUUID(),channelId:id,startedAt,status:'started'});
 await assert.rejects(reserveRadar(ask(id)),/результат неизвестен/);
 await markRun(id,new Date(Date.now()-120_000).toISOString());
 await assert.rejects(reserveRadar(ask(id)),/результат неизвестен/,'старый прогон запрет не снимает');
 await markRun(id,new Date().toISOString());
 const a=await reserveRadar(ask(id));
 await runRadarAction(a,ctx,fake({approve:true}));
});
