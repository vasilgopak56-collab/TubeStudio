// Desktop-only derivative: historical mobile-menu branch omitted; app algorithms unchanged.
// Isolated local server; no inherited credentials or external provider requests.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import crypto from 'node:crypto';
import {chromium} from 'playwright-core';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const VERSION=JSON.parse(fs.readFileSync(ROOT+'/package.json','utf8')).version;
const PORT=8832,BASE=`http://127.0.0.1:${PORT}`,PASSWORD='local-version-test-only';
const OUT=process.env.TEST_ARTIFACTS_DIR||path.join(os.tmpdir(),'ts-version-qa');
let srv,browser,dir;
before(async()=>{
 dir=fs.mkdtempSync(path.join(os.tmpdir(),'ts-version-e2e-'));
 srv=spawn(process.execPath,['dist/index.js'],{cwd:ROOT+'/apps/server',env:{PATH:process.env.PATH,PORT:String(PORT),HOST:'127.0.0.1',DATA_DIR:dir,ENV_FILE:dir+'/.env',APP_PASSWORD:PASSWORD},stdio:'ignore'});
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch(BASE+'/api/auth/status')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready,'local server ready');
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});fs.mkdirSync(OUT,{recursive:true});
});
after(async()=>{await browser?.close();srv?.kill();fs.rmSync(dir,{recursive:true,force:true});});
async function page(width=1440,reply){
 const ctx=await browser.newContext({viewport:{width,height:1000}});
 await ctx.request.post(BASE+'/api/auth/login',{data:{password:PASSWORD}});
 const p=await ctx.newPage();p.errors=[];p.on('pageerror',e=>p.errors.push(e.message));p.external=[];
 await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==BASE){p.external.push(u.origin);return r.abort();}
 if(u.pathname==='/api/health')return r.fulfill({json:{ok:true,data:{version:VERSION,keys:[],node:'test',dataDir:'tmp',llm:null}}});
 if(u.pathname==='/api/version'&&reply)return reply(r);
 return r.continue();});
 await p.goto(BASE+'/profit');await p.getByRole('heading',{name:'Калькулятор прибыли',exact:true}).waitFor();
 return p;
}
async function capture(p,name){await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(100);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:path.join(OUT,name+'.png')});assert.deepEqual(p.errors,[]);assert.deepEqual(p.external,[]);}
test('version endpoint is authenticated, read-only projection and rejects extension token',async()=>{
 assert.equal((await fetch(BASE+'/api/version')).status,401);
 const ext=crypto.createHash('sha256').update(`tubestudio-ext:${PASSWORD}`).digest('hex').slice(0,32);
 assert.equal((await fetch(BASE+'/api/version',{headers:{'x-ts-token':ext}})).status,403);
 const ctx=await browser.newContext();await ctx.request.post(BASE+'/api/auth/login',{data:{password:PASSWORD}});
 const response=await ctx.request.get(BASE+'/api/version');assert.equal(response.status(),200);assert.equal(response.headers()['cache-control'],'no-store');assert.deepEqual(await response.json(),{ok:true,data:{version:VERSION}});await ctx.close();
});
test('build version beside brand is visible at 1440; matching server has no warning',async()=>{
 for(const width of [1440]){let called=0;const p=await page(width,r=>{called++;return r.continue();});await p.waitForTimeout(150);
 const label=p.getByTestId('app-version').filter({visible:true});await label.first().waitFor();assert.equal(await label.first().textContent(),'v'+VERSION);
 await p.waitForTimeout(150);assert.equal(await p.getByTestId('version-notice').count(),0);assert.equal(called,1);await capture(p,'version-match-'+width);await p.context().close();}
});
test('collapsed navigation preserves brand version title and restores visible label',async()=>{
 const p=await page();await p.getByRole('button',{name:'Свернуть меню',exact:true}).click();assert.equal(await p.locator(`a[title="TubeStudio v${VERSION} — интерфейс"]`).count(),1);
 await p.getByRole('button',{name:'Развернуть меню',exact:true}).click();await p.getByTestId('app-version').filter({visible:true}).waitFor();await p.context().close();
});
test('different server version is explicit on desktop; retry can confirm updated server',async()=>{
 for(const width of [1440]){let changed=false;const p=await page(width,r=>r.fulfill({json:{ok:true,data:{version:changed?VERSION:'0.12.41-preview.1'}}}));
 await p.getByTestId('version-notice').waitFor();assert.match(await p.getByTestId('version-notice').innerText(),/Версии различаются/);assert.match(await p.getByTestId('version-notice').innerText(),/сервер v0\.12\.41-preview\.1/);await capture(p,'version-mismatch-'+width);
 changed=true;await p.getByRole('button',{name:'Проверить версии',exact:true}).click();await p.getByTestId('version-notice').waitFor({state:'detached'});await p.context().close();}
});
test('old or unavailable endpoint does not imply matching versions; local UI keeps working',async()=>{
 for(const width of [1440]){const p=await page(width,r=>r.fulfill({status:404,json:{ok:false,error:{code:'NOT_FOUND',message:'Not found'}}}));await p.getByTestId('version-notice').waitFor();assert.match(await p.getByTestId('version-notice').innerText(),/совпадение версий не подтверждено/);await capture(p,'version-unknown-'+width);await p.locator('input').first().fill('Still usable');await p.context().close();}
});
test('malformed version is not rendered as server identity',async()=>{
 const p=await page(1440,r=>r.fulfill({json:{ok:true,data:{version:'<script>window.versionInjected=1</script>'}}}));await p.getByTestId('version-notice').waitFor();assert.match(await p.getByTestId('version-notice').innerText(),/недоступна/);assert.equal(await p.evaluate(()=>window.versionInjected),undefined);assert.equal(await p.getByText('<script>',{exact:false}).count(),0);await p.context().close();
});
