// Local isolated language-selection coverage. All paid requests are intercepted.
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {chromium} from 'playwright-core';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),PORT=8803,BASE=`http://127.0.0.1:${PORT}`;
const CODES=['ru','uk','sr','fr','pt','es','it','en','de','he','ar','vi','ja','ko','zh','id','hi','tr','pl'];
let srv,browser,dir;
before(async()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'ts-model-id-e2e-'));srv=spawn('node',['dist/index.js'],{cwd:ROOT+'/apps/server',env:{PATH:process.env.PATH,PORT:String(PORT),HOST:'127.0.0.1',DATA_DIR:dir,ENV_FILE:dir+'/.env'},stdio:'ignore'});let ready=false;for(let i=0;i<60;i++){try{if((await fetch(BASE+'/api/auth/status')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready);browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();srv?.kill();fs.rmSync(dir,{recursive:true,force:true});});
async function page(width=1440){const p=await browser.newPage({viewport:{width,height:1000}});p.errors=[];p.on('pageerror',e=>p.errors.push(e.message));await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==BASE)return r.abort();if(u.pathname==='/api/tts/voices'){const l=u.searchParams.get('lang');return r.fulfill({json:{ok:true,data:{selected:`edge-tts/${l}-XX-TestNeural`,voices:[{model:`edge-tts/${l}-XX-TestNeural`,name:`Test ${l}`,lang:l,gender:'Male',provider:'edge-tts'}]}}});}return r.continue();});return p;}

test('manual IDs persist in settings and preserve arbitrary future model IDs',async()=>{
 const p=await page();await p.goto(BASE+'/settings');
 const direct=p.getByRole('combobox',{name:'Claude — тексты и анализ — ID прямого API',exact:true});
 await direct.fill('claude-sonnet-5-5');
 const am=p.getByRole('combobox',{name:'Сценарии — топ-модель (Сценарист) — ID AnyModel',exact:true});await am.fill('cc/claude-opus-5');
 await p.getByRole('button',{name:'Сохранить настройки',exact:true}).click();await p.getByRole('button',{name:'Сохранено',exact:true}).waitFor();await p.reload();
 await direct.waitFor();assert.equal(await direct.inputValue(),'claude-sonnet-5-5');assert.equal(await am.inputValue(),'cc/claude-opus-5');
 assert.ok(await p.getByText('Claude Pro — подписка, а не ID модели.',{exact:true}).isVisible());
 await direct.fill('claude-future-example');await p.getByRole('button',{name:'Сохранить настройки',exact:true}).click();await p.getByRole('button',{name:'Сохранено',exact:true}).waitFor();
 const settings=await(await fetch(BASE+'/api/settings')).json();assert.equal(settings.data.models.anthropic,'claude-future-example');await fetch(BASE+'/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({models:{anthropic:'claude-opus-5-5'}})});assert.deepEqual(p.errors,[]);await p.close();
});
test('script sends trimmed manual ID and empty field uses configured model',async()=>{
 const p=await page();let payload;
 await p.route('**/api/script',r=>{payload=r.request().postDataJSON();return r.fulfill({json:{ok:true,data:{jobId:'model-id-mock'}}});});
 await p.route('**/api/jobs/model-id-mock/stream',r=>r.fulfill({headers:{'content-type':'text/event-stream'},body:'event: error\ndata: {"type":"error","error":{"code":"MOCK","message":"Local model test"}}\n\n'}));
 await p.goto(BASE+'/script');const field=p.getByRole('combobox',{name:'Модель сценария — ручной ввод ID (AnyModel)',exact:true});
 assert.equal(await field.getAttribute('placeholder'),'Например: cc/claude-opus-5');
 await field.fill('  cc/claude-future-example  ');await p.locator('input[list="saved-topics-dl"]').fill('История древнего города');
 await p.waitForTimeout(2200);await p.reload();await field.waitFor();assert.equal(await field.inputValue(),'  cc/claude-future-example  ');
 await p.getByRole('button',{name:/Написать сценарий/}).click();await p.waitForFunction(()=>document.body.textContent.includes('Local model test'));assert.equal(payload.model,'cc/claude-future-example');
 await field.fill('   ');await p.getByRole('button',{name:/Написать сценарий/}).click();await p.waitForTimeout(300);assert.equal(payload.model,undefined);assert.deepEqual(p.errors,[]);await p.close();
});
test('manual model fields fit desktop/mobile and render example help',async()=>{
 const p=await page();fs.mkdirSync('/data/model-id-release/ui',{recursive:true});
 for(const width of [1440,390]){await p.setViewportSize({width,height:1000});
  for(const [route,selector,name] of [['/script','#script-model-id','script'],['/settings','#anymodel','anymodel'],['/settings','#claude-model-help','claude']]){
   await p.goto(BASE+route);const target=p.locator(selector);await target.waitFor();await target.scrollIntoViewIfNeeded();
   await p.screenshot({path:`/data/model-id-release/ui/${name}-${width}.png`});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+':'+width);
  }
 }assert.deepEqual(p.errors,[]);await p.close();
});
