// Ограничитель платного запуска: одно окно на весь запуск, счёт физических запросов, без резервных моделей и повторов.
// Сети нет: ключи поддельные, fetch подменён, настоящих платных запросов нет.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-paidrun-'));
process.env.DATA_DIR=dir;process.env.ENV_FILE=dir+'/absent.env';process.env.ANTHROPIC_API_KEY='fake-paidrun-only';
const {randomUUID}=await import('node:crypto');
const {runTask}=await import('../src/lib/taskContext.js');
const {priceConsents}=await import('../src/services/priceConsent.js');
const {updateSettings}=await import('../src/services/settings.js');
const {capturePrice}=await import('../src/services/usagePricing.js');
const {paidDispatch,checkPaidLimit}=await import('../src/services/paidDispatch.js');
const {requestPaidRun,withPaidLimit,paidRunQuote,paidRunMessage}=await import('../src/services/paidRun.js');
const {generateJson}=await import('../src/services/llm.js');
const {createChannel}=await import('../src/services/studio/channels.js');
const {scriptRunPlan,StudioScriptInput}=await import('../src/services/studio/scriptFlow.js');
const {z}=await import('zod');
const original=fetch;
after(async()=>{globalThis.fetch=original;await fs.rm(dir,{recursive:true,force:true});});
await updateSettings({anymodel:{enabled:false},models:{anthropic:'same-model'},budget:{prices:[{match:'same',input:1,output:2,image:.1}]}});

const launch=(decision:'approve'|'deny',windows:string[]=[])=>{const owner=randomUUID();return {launch:{owner,requestId:randomUUID(),route:'/api/studio/script'},onPriceConsent:(c:any)=>{windows.push(c.message);queueMicrotask(()=>priceConsents.decide(owner,c.id,c.scopeHash,decision));}};};
const call=(count:number)=>[{step:'текст',provider:'anthropic',model:'same-model',kind:'text' as const,count,inputChars:2000,maxTokens:1000}];

test('без запуска из интерфейса окно не показывается и ничего не отправляется',async()=>{
 await assert.rejects(requestPaidRun('Сценарий',call(3),{}),(e:any)=>e.code==='BUDGET_CONSENT_REQUIRED');
});

test('отказ в окне — ограничитель не выдаётся',async()=>{
 await assert.rejects(runTask(launch('deny'),()=>requestPaidRun('Сценарий',call(3),{})),(e:any)=>e.code==='BUDGET_CONSENT_DENIED');
});

test('окно одно, в нём максимум и модель; ограничитель считает каждый запрос и останавливает сверх максимума',async()=>{
 const windows:string[]=[];
 const limit=await runTask(launch('approve',windows),()=>requestPaidRun('Подтвердите сценарий',call(2),{x:1}));
 assert.equal(windows.length,1);
 assert.match(windows[0],/до 2 запросов к моделям same-model/);
 assert.match(windows[0],/Ориентир цены за максимум/);
 assert.equal(limit.max,2);
 const p=await capturePrice('anthropic','same-model','text');
 await withPaidLimit(limit,async()=>{
  checkPaidLimit([p],1);checkPaidLimit([p],1);
  assert.throws(()=>checkPaidLimit([p],1),/подтверждённый максимум: 2/);
 });
 assert.equal(limit.used,2);
});

test('повтор после сбоя, другая модель и другой тариф не отправляются',async()=>{
 const limit={max:10,used:0,allowed:new Map([['anthropic|same-model|text',(await capturePrice('anthropic','same-model','text')).priceVersion]])};
 await withPaidLimit(limit,async()=>{
  const d=paidDispatch(()=>capturePrice('anthropic','same-model','text'));
  await d.beforeAttempt();
  await assert.rejects(d.beforeAttempt(),/Повтор запроса не отправлен/);
  await assert.rejects(paidDispatch(()=>capturePrice('anthropic','same-other','text')).beforeAttempt(),/нет в подтверждённом окне/);
  const changed={...(await capturePrice('anthropic','same-model','text')),priceVersion:'b'.repeat(64)};
  assert.throws(()=>checkPaidLimit([changed],1),/Тариф модели same-model изменился/);
 });
 assert.equal(limit.used,1);
});

test('под ограничителем неверный ответ модели не переспрашивается',async()=>{
 let sent=0;
 globalThis.fetch=(async(url:string)=>{if(String(url).includes('anthropic.com')){sent++;return new Response(JSON.stringify({content:[{type:'text',text:'not json at all'}],usage:{input_tokens:1,output_tokens:1}}),{status:200,headers:{'content-type':'application/json'}});}throw new Error('unexpected '+url);}) as typeof fetch;
 const limit={max:5,used:0,allowed:new Map([['anthropic|same-model|text',(await capturePrice('anthropic','same-model','text')).priceVersion]])};
 await assert.rejects(withPaidLimit(limit,()=>generateJson({system:'s',user:'u',maxTokens:10},z.object({a:z.string()}))),(e:any)=>e.code==='LLM_INVALID_JSON');
 assert.equal(sent,1,'ровно один запрос, без переспроса');
 globalThis.fetch=original;
});

test('ориентир: сумма по всем запросам, неизвестная цена — «неизвестна»',async()=>{
 const p=await capturePrice('anthropic','same-model','text');
 const price=new Map([['anthropic|same-model|text',p]]);
 const one=paidRunQuote(call(1),price)!,three=paidRunQuote(call(3),price)!;
 assert.ok(one>0);assert.ok(Math.abs(three-one*3)<1e-9);
 assert.equal(paidRunQuote(call(1),new Map()),null);
 assert.match(paidRunMessage('Сценарий',call(4),null),/до 4 запросов.*Цена хотя бы одной модели неизвестна/);
});

test('план сценария: верхняя граница растёт с длиной и выключенными шагами уменьшается',async()=>{
 const ch=await createChannel({name:'Test',niche:'history',language:'en'});
 const total=(c:{kind:string;count:number}[])=>c.filter(x=>x.kind==='text').reduce((n,x)=>n+x.count,0);
 const full=await scriptRunPlan(StudioScriptInput.parse({channelId:ch.id,topic:'Winter of 1816',minutes:10}),ch);
 const long=await scriptRunPlan(StudioScriptInput.parse({channelId:ch.id,topic:'Winter of 1816',minutes:30}),ch);
 const lean=await scriptRunPlan(StudioScriptInput.parse({channelId:ch.id,topic:'Winter of 1816',minutes:10,research:false,critic:false,factCheck:false}),ch);
 assert.ok(total(long)>total(full));
 assert.ok(total(lean)<total(full));
 assert.ok(full.every(c=>c.provider==='anthropic'),'модели — те, что сработают первыми');
 assert.ok(full.some(c=>c.step.startsWith('акты')));
});
