// Под подтверждённым окном цены резервные модели и запасной поиск не запускаются, даже если они есть в окне.
// Сети нет: ключи поддельные, fetch подменён, настоящих платных запросов нет.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-nofallback-'));
process.env.DATA_DIR=dir;process.env.ENV_FILE=dir+'/absent.env';
process.env.ANTHROPIC_API_KEY='fake-nofallback-only';process.env.GEMINI_API_KEY='fake-nofallback-only';process.env.ANYMODEL_API_KEY='fake-nofallback-only';
const {updateSettings}=await import('../src/services/settings.js');
const {capturePrice}=await import('../src/services/usagePricing.js');
const {withPaidLimit}=await import('../src/services/paidRun.js');
const {generateText,geminiGrounded}=await import('../src/services/llm.js');
const original=fetch;
after(async()=>{globalThis.fetch=original;await fs.rm(dir,{recursive:true,force:true});});

type Hits={anthropic:number;gemini:number;anymodel:number};
const network=(hits:Hits)=>{globalThis.fetch=(async(url:string)=>{
 const u=String(url);
 if(u.includes('anthropic.com')){hits.anthropic++;return new Response(JSON.stringify({error:{message:'bad request'}}),{status:400,headers:{'content-type':'application/json'}});}
 if(u.includes('googleapis.com')){hits.gemini++;return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'gemini answer'}]}}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1}}),{status:200,headers:{'content-type':'application/json'}});}
 if(u.includes('anymodel')){if(u.endsWith('/chat/completions'))hits.anymodel++;return new Response(JSON.stringify({error:{message:'search failed'}}),{status:400,headers:{'content-type':'application/json'}});}
 throw new Error('unexpected '+u);
}) as typeof fetch;};
const allow=async(list:[string,string,'text'|'search',any?][])=>{const m=new Map<string,string>();for(const [p,model,kind,o] of list)m.set(`${p}|${model}|${kind}`,(await capturePrice(p,model,kind,undefined,o)).priceVersion);return {max:10,used:0,allowed:m};};

test('модель не ответила под окном цены — другая модель не вызывается, даже если она есть в окне',async()=>{
 await updateSettings({llmProvider:'anthropic',anymodel:{enabled:false},models:{anthropic:'same-model',gemini:'gem-model',geminiFast:'gem-model'},budget:{mode:'warn',prices:[{match:'same',input:1,output:2},{match:'gem',input:1,output:2}]}});
 const hits={anthropic:0,gemini:0,anymodel:0};network(hits);
 const limit=await allow([['anthropic','same-model','text'],['gemini','gem-model','text']]);
 await assert.rejects(withPaidLimit(limit,()=>generateText({system:'s',user:'u',maxTokens:10})),(e:any)=>e.code==='UPSTREAM'&&/same-model не ответила/.test(e.message)&&/к другой модели не отправлялся/.test(e.message));
 assert.deepEqual(hits,{anthropic:1,gemini:0,anymodel:0});
 globalThis.fetch=original;
});

test('без окна цены прежнее поведение: после ошибки идёт следующая модель',async()=>{
 const hits={anthropic:0,gemini:0,anymodel:0};network(hits);
 const r=await generateText({system:'s',user:'u',maxTokens:10});
 assert.equal(r.text,'gemini answer');
 assert.equal(hits.anthropic,1);assert.equal(hits.gemini,1);
 globalThis.fetch=original;
});

test('поиск AnyModel не ответил под окном цены — поиск через Gemini напрямую не запускается',async()=>{
 await updateSettings({anymodel:{enabled:true,search:'same-search'}});
 const hits={anthropic:0,gemini:0,anymodel:0};network(hits);
 const limit=await allow([['anymodel','same-search','text',{catalogFresh:false}],['anymodel','web-search','search'],['gemini','gem-model','text'],['gemini','gem-model','search']]);
 await assert.rejects(withPaidLimit(limit,()=>geminiGrounded('s','u',100)),(e:any)=>/Поиск AnyModel не ответил/.test(e.message)&&/через Gemini напрямую не запускался/.test(e.message)&&e.code!=='BUDGET_PRICE_UNKNOWN'&&e.code!=='BUDGET_CONSENT_LIMIT');
 assert.equal(hits.anymodel,1);assert.equal(hits.gemini,0);
 globalThis.fetch=original;
});
