import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts139-audio-consent-'));process.env.DATA_DIR=dir;process.env.ENV_FILE=dir+'/missing';
const {paidDispatch}=await import('../src/services/paidDispatch.js');
const {priceConsents}=await import('../src/services/priceConsent.js');
const {runTask}=await import('../src/lib/taskContext.js');
const {fetchRetry}=await import('../src/lib/http.js');
const {updateSettings}=await import('../src/services/settings.js');
const launch=()=>({owner:randomUUID(),requestId:randomUUID(),route:'/api/audio-storyboard/transcribe'});
const code=(c:string)=>(e:any)=>e.code===c;
const snapshot=(v='a')=>({version:1 as const,capturedAt:new Date().toISOString(),priceVersion:v.repeat(64),provider:'anymodel',model:'test/audio',kind:'audio' as const,currency:'USD' as const,source:'cached-anymodel' as const,known:false});
after(async()=>{const {flushLogs}=await import('../src/lib/logging.js');await flushLogs();await fs.rm(dir,{recursive:true,force:true});});
test('opted-in transport cannot send without separate current consent; denial, cancel and changed tariff fail closed',async()=>{
 const original=globalThis.fetch;let sends=0,version='a';
 globalThis.fetch=async()=>{sends++;return new Response('{}',{status:200});};
 const invoke=()=>fetchRetry('https://provider.invalid/test',{method:'POST',body:'private audio'}, {retries:0,beforeAttempt:paidDispatch(async()=>snapshot(version),{contextHash:'f'.repeat(64),message:'Подтверждение тестового фрагмента'}).beforeAttempt});
 try{
  await updateSettings({budget:{mode:'warn'}});
  await assert.rejects(invoke(),code('BUDGET_CONSENT_REQUIRED'));assert.equal(sends,0);
  const denied=launch();await assert.rejects(runTask({launch:denied,onPriceConsent:c=>priceConsents.decide(denied.owner,c.id,c.scopeHash,'deny')},invoke),code('BUDGET_CONSENT_DENIED'));assert.equal(sends,0);
  const abort=new AbortController(),cancelled=launch();await assert.rejects(runTask({launch:cancelled,signal:abort.signal,onPriceConsent:()=>abort.abort()},invoke),code('CANCELLED'));assert.equal(sends,0);
  const stale=launch();await assert.rejects(runTask({launch:stale,onPriceConsent:c=>{version='b';priceConsents.decide(stale.owner,c.id,c.scopeHash,'approve');}},invoke),code('BUDGET_CONSENT_STALE'));assert.equal(sends,0);
  let count=0;const allowed=launch();const ok=()=>runTask({launch:allowed,onPriceConsent:c=>{count++;assert.equal(JSON.stringify(c).includes('private audio'),false);priceConsents.decide(allowed.owner,c.id,c.scopeHash,'approve');}},invoke);
  await ok();await ok();assert.equal(sends,2);assert.equal(count,2);
  await updateSettings({budget:{mode:'block'}});await assert.rejects(ok(),code('BUDGET_PRICE_UNKNOWN'));assert.equal(sends,2);assert.equal(count,2);
 }finally{globalThis.fetch=original;}
});
