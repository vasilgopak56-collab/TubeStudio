// Local isolated language-selection coverage. All paid requests are intercepted.
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {chromium} from 'playwright-core';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),PORT=8802,BASE=`http://127.0.0.1:${PORT}`;
const CODES=['ru','uk','sr','fr','pt','es','it','en','de','he','ar','vi','ja','ko','zh','id','hi','tr','pl'];
let srv,browser,dir;
before(async()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'ts-language-e2e-'));srv=spawn('node',['dist/index.js'],{cwd:ROOT+'/apps/server',env:{PATH:process.env.PATH,PORT:String(PORT),HOST:'127.0.0.1',DATA_DIR:dir,ENV_FILE:dir+'/.env'},stdio:'ignore'});let ready=false;for(let i=0;i<60;i++){try{if((await fetch(BASE+'/api/auth/status')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready);browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();srv?.kill();fs.rmSync(dir,{recursive:true,force:true});});
async function page(width=1440){const p=await browser.newPage({viewport:{width,height:1000}});p.errors=[];p.on('pageerror',e=>p.errors.push(e.message));await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==BASE)return r.abort();if(u.pathname==='/api/tts/voices'){const l=u.searchParams.get('lang');return r.fulfill({json:{ok:true,data:{selected:`edge-tts/${l}-XX-TestNeural`,voices:[{model:`edge-tts/${l}-XX-TestNeural`,name:`Test ${l}`,lang:l,gender:'Male',provider:'edge-tts'}]}}});}return r.continue();});return p;}
const languageSelect=p=>p.locator('select').filter({has:p.locator('option[value="he"]')}).first();
test('all content language selectors expose 18 requested codes and retain Polish',async()=>{
 const p=await page();for(const route of ['/topics','/script','/seo','/thumbnail','/check/ai-detector','/check/humanizer','/check/script-rater','/voice','/voice-profile','/pipeline','/settings']){
  await p.goto(BASE+route);const s=languageSelect(p);await s.waitFor();assert.deepEqual(await s.locator('option').evaluateAll(os=>os.map(o=>o.value).filter(Boolean)),CODES,route);
  for(const c of CODES){await s.selectOption(c);assert.equal(await s.inputValue(),c,route+':'+c);}
 }
 await p.goto(BASE+'/settings#research');await p.getByRole('combobox',{name:'Язык выдачи',exact:true}).waitFor();const rs=p.getByRole('combobox',{name:'Язык выдачи',exact:true});assert.deepEqual(await rs.locator('option').evaluateAll(os=>os.map(o=>o.value)),['',...CODES]);await rs.selectOption('vi');assert.equal(await rs.inputValue(),'vi');assert.deepEqual(p.errors,[]);await p.close();
});
test('settings round-trip preserves all requested codes',async()=>{
 for(const contentLanguage of CODES){const put=await fetch(BASE+'/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({contentLanguage})});assert.equal(put.status,200);const j=await(await fetch(BASE+'/api/settings')).json();assert.equal(j.data.contentLanguage,contentLanguage);}
 await fetch(BASE+'/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({contentLanguage:'ru'})});
});
test('script, voice and pipeline submit selected languages; voice list follows language',async()=>{
 const p=await page();let script,voice,pipe;
 const mock=(name,cb)=>p.route(`**/api/${name}`,r=>{cb(r.request().postDataJSON());return r.fulfill({json:{ok:true,data:{jobId:'language-mock'}}});});
 await p.route('**/api/jobs/language-mock/stream',r=>r.fulfill({headers:{'content-type':'text/event-stream'},body:'event: error\ndata: {"type":"error","error":{"code":"MOCK","message":"Local test"}}\n\n'}));
 await mock('script',x=>script=x);await p.goto(BASE+'/script');await languageSelect(p).selectOption('he');await p.locator('input[list="saved-topics-dl"]').fill('История старого города');await p.getByRole('button',{name:/Написать сценарий/}).click();await p.waitForFunction(()=>document.body.textContent.includes('Local test'));assert.equal(script.language,'he');
 await mock('tts',x=>voice=x);await p.goto(BASE+'/voice');const arResponse=p.waitForResponse(r=>r.url().includes('/tts/voices?lang=ar'));await languageSelect(p).selectOption('ar');await arResponse;await p.locator('textarea[placeholder^="Вставьте сценарий."]').fill('هذه قصة قصيرة عن مدينة قديمة.');await p.getByRole('button',{name:'Озвучить',exact:true}).click();await p.waitForFunction(()=>document.body.textContent.includes('Local test'));assert.equal(voice.language,'ar');assert.ok(voice.model.startsWith('edge-tts/ar-'));
 await mock('pipeline',x=>pipe=x);await p.goto(BASE+'/pipeline');await p.getByRole('combobox',{name:'Язык контента',exact:true}).selectOption('ja');await p.getByPlaceholder('Почему средневековые люди боялись купаться').fill('История японского города');await p.getByRole('button',{name:/Запустить/}).click();await p.waitForFunction(()=>document.body.textContent.includes('Local test'));assert.equal(pipe.language,'ja');assert.deepEqual(p.errors,[]);await p.close();
});
test('language selectors and RTL labels fit desktop/mobile; screenshots for visual review',async()=>{
 const p=await page();fs.mkdirSync('/data/language-release/ui',{recursive:true});for(const width of [1440,390]){
  await p.setViewportSize({width,height:1000});
  for(const [route,c] of [['/pipeline','ja'],['/voice-profile','he'],['/voice','ar'],['/check/humanizer','sr'],['/check/ai-detector','vi'],['/settings#research','id']]){
   await p.goto(BASE+route);const s=route.includes('#')?p.getByRole('combobox',{name:'Язык выдачи',exact:true}):languageSelect(p);await s.waitFor();await s.selectOption(c);await s.scrollIntoViewIfNeeded();await p.screenshot({path:`/data/language-release/ui/${route.split('#')[0].replaceAll('/','_')}-${width}.png`});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,route+':'+width);
  }
 }assert.deepEqual(p.errors,[]);await p.close();
});
