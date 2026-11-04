// Desktop-only copy for documentation audit. Historical mobile suite is not run.
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';import {unzipSync,zipSync} from 'fflate';
const ROOT=process.cwd(),PORT=8842,BASE=`http://127.0.0.1:${PORT}`,OUT='/data/ts68-coach-qa';let dir,prompts,control,server,browser;
const mode=m=>fs.writeFileSync(control,JSON.stringify({mode:m}));
const calls=()=>fs.existsSync(control+'.calls')?fs.readFileSync(control+'.calls','utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
async function json(url,body){const r=await fetch(BASE+'/api'+url,{...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),headers:{'content-type':'application/json'}});return {status:r.status,body:await r.json()};}
async function done(id){const s=await(await fetch(BASE+`/api/jobs/${id}/stream`)).text();return s.split('\n\n').flatMap(e=>e.split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)))).find(x=>x.type==='done'||x.type==='error');}
const create=async(title='Review conversation')=>(await json('/coach/conversations',{title})).body.data;
const preview=async(id,question='Что проверить первым?',language='ru')=>(await json('/coach/preview',{id,question,language})).body.data;
async function send(p,overrides={}){const r=await json('/coach/ask',{...p.selection,previewHash:p.hash,...overrides});assert.equal(r.status,200);return done(r.body.data.jobId);}
const files=()=>fs.readdirSync(path.join(dir,'coach-runs')).sort();
before(async()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'ts-coach-review-'));prompts=path.join(dir,'prompts');fs.cpSync(path.join(ROOT,'apps/server/prompts'),prompts,{recursive:true});control=path.join(dir,'control.json');mode('normal');
 server=spawn(process.execPath,['--import',path.join(ROOT,'tests/e2e/fixtures/coach-review-provider.mjs'),'dist/index.js'],{cwd:ROOT+'/apps/server',env:{PATH:process.env.PATH,HOST:'127.0.0.1',PORT:String(PORT),DATA_DIR:dir,PROMPTS_DIR:prompts,ENV_FILE:path.join(dir,'absent.env'),ANTHROPIC_API_KEY:'DUMMY_COACH_KEY',TS_NO_SCHEDULER:'1',TS_TEST_COACH_CONTROL:control},stdio:'ignore'});
 let ready=false;for(let i=0;i<70;i++){try{if((await fetch(BASE+'/api/auth/status')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready);
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'/usr/local/bin/chromium',args:['--no-sandbox']});fs.mkdirSync(OUT,{recursive:true});});
after(async()=>{await browser?.close();server?.kill();fs.rmSync(dir,{recursive:true,force:true});});
async function page(width=1440){const p=await browser.newPage({viewport:{width,height:1000}});p.errors=[];p.on('pageerror',e=>p.errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===BASE?r.continue():r.abort());await p.goto(BASE+'/coach');return p;}
async function shot(p,name){await p.evaluate(()=>scrollTo(0,0));await p.waitForTimeout(100);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' overflow');await p.screenshot({path:OUT+'/'+name+'.png',fullPage:true});assert.deepEqual(p.errors,[]);}
test('coach review: HTTP preview is local, missing hash rejected, stale form and prompt never call provider',async()=>{
 const c=await create(),p=await preview(c.id),n=calls().length,before=files();assert.ok(p.system);assert.equal(JSON.parse(p.user).question,p.selection.question);assert.equal((await json('/coach/ask',p.selection)).status,400);
 for(const d of [{question:'Другой вопрос'},{language:'he'}])assert.equal((await send(p,d)).error.code,'VALIDATION');
 const file=path.join(prompts,'coach/chat.md'),old=fs.readFileSync(file,'utf8');try{fs.writeFileSync(file,old+'\nChanged');assert.equal((await send(p)).error.code,'VALIDATION');}finally{fs.writeFileSync(file,old);}
 assert.equal(calls().length,n);assert.deepEqual(files(),before);
});
test('coach review: real HTTP/SSE pins exact system/user, follow-up history and independent branches',async()=>{
 const c=await create(),p=await preview(c.id),a=(await send(p)).data;assert.deepEqual(a.lastRequest,p);assert.equal(calls().at(-1).system[0].text,p.system);assert.equal(calls().at(-1).messages[0].content,p.user);
 const next=await preview(a.id,'Как проверить гипотезу?','he');assert.equal(JSON.parse(next.user).conversation.length,2);const b=(await send(next)).data;assert.equal(b.messages.length,4);assert.deepEqual(b.lastRequest,next);
 const branch=(await send(await preview(c.id,'Другой вариант'))).data;assert.equal(branch.parentId,c.id);assert.equal(branch.messages.length,2);assert.deepEqual((await json('/coach/runs/'+b.id)).body.data,b);assert.equal((await json('/coach/runs/'+c.id)).body.data.lastRequest,undefined);
});
test('coach review: desktop manual preview, saved request, safe rendering and pinned JSON/Markdown exports',async()=>{
 for(const width of [1440]){const p=await page(width),n=calls().length;await p.getByRole('button',{name:'Создать диалог с этим контекстом',exact:true}).click();await p.getByTestId('coach-context').waitFor();await p.getByLabel('Вопрос AI Coach',{exact:true}).fill('Что проверить первым?');
 assert.equal(await p.getByRole('button',{name:'Отправить в AI',exact:true}).isDisabled(),true);await p.getByRole('button',{name:'Предпросмотр запроса',exact:true}).click();await p.getByTestId('coach-exact-request').waitFor();assert.equal(calls().length,n);const exact=JSON.parse(await p.getByTestId('coach-exact-request').innerText());await shot(p,'preview-'+width);
 await p.getByRole('button',{name:'Отправить в AI',exact:true}).click();await p.getByTestId('coach-assistant').waitFor();assert.equal(calls().length,n+1);await p.getByText('Сохранённый точный запрос',{exact:true}).click();const stored=JSON.parse(await p.getByTestId('coach-saved-request').innerText());assert.equal(stored.system,exact.system);assert.equal(stored.user,exact.user);assert.equal(await p.evaluate(()=>window.coachInjected),undefined);
 await p.getByLabel('Вопрос AI Coach',{exact:true}).fill('НЕСОХРАНЁННЫЙ ВОПРОС');await p.getByLabel('Язык ответа',{exact:true}).selectOption('he');let [dl]=await Promise.all([p.waitForEvent('download'),p.getByRole('button',{name:'Диалог JSON',exact:true}).click()]);const exported=JSON.parse(fs.readFileSync(await dl.path(),'utf8'));assert.deepEqual(exported.lastRequest,stored);assert.doesNotMatch(JSON.stringify(exported),/НЕСОХРАНЁННЫЙ ВОПРОС/);
 [dl]=await Promise.all([p.waitForEvent('download'),p.getByRole('button',{name:'Диалог Markdown',exact:true}).click()]);const md=fs.readFileSync(await dl.path(),'utf8');assert.ok(md.includes(stored.system));assert.ok(md.includes(stored.user));await shot(p,'saved-'+width);await p.close();}
});
test('coach review: provider errors and cancellation preserve original snapshot and unsent question',async()=>{
 const p=await page();await p.getByRole('button',{name:'Создать диалог с этим контекстом',exact:true}).click();await p.getByTestId('coach-context').waitFor();await p.getByLabel('Вопрос AI Coach',{exact:true}).fill('Сохранить вопрос');await p.getByRole('button',{name:'Предпросмотр запроса',exact:true}).click();await p.getByTestId('coach-preview').waitFor();const before=files();mode('empty');await p.getByRole('button',{name:'Отправить в AI',exact:true}).click();await p.getByRole('alert').waitFor();assert.equal(await p.getByLabel('Вопрос AI Coach',{exact:true}).inputValue(),'Сохранить вопрос');assert.deepEqual(files(),before);
 mode('slow');const n=calls().length;await p.getByRole('button',{name:'Отправить в AI',exact:true}).click();for(let i=0;i<50&&calls().length===n;i++)await p.waitForTimeout(30);assert.equal(calls().length,n+1);await p.getByRole('button',{name:'Остановить',exact:true}).click();await p.waitForTimeout(200);assert.deepEqual(files(),before);assert.equal(await p.getByTestId('coach-assistant').count(),0);assert.equal(await p.getByLabel('Вопрос AI Coach',{exact:true}).inputValue(),'Сохранить вопрос');
 const k=calls().length;await p.getByRole('button',{name:'Отправить в AI',exact:true}).click();for(let i=0;i<50&&calls().length===k;i++)await p.waitForTimeout(30);assert.equal(calls().length,k+1);await p.getByRole('link',{name:'Панель',exact:true}).click();await p.waitForTimeout(200);assert.deepEqual(files(),before);assert.equal(new URL(p.url()).pathname,'/');assert.deepEqual(p.errors,[]);await p.close();mode('normal');
});
test('coach review: old snapshots remain honest; source deletion and prompt edits do not rewrite saved request; ZIP round trip',async()=>{
 const id=randomUUID();fs.mkdirSync(path.join(dir,'reports'),{recursive:true});const report={id,createdAt:'2025-01-01T00:00:00Z',channel:{id:'UCfixture',title:'Источник',subscribers:0},videos:[]};fs.writeFileSync(path.join(dir,'reports',id+'.json'),JSON.stringify(report));
 const c=(await json('/coach/conversations',{title:'Pinned source',reportId:id})).body.data,r=(await send(await preview(c.id))).data,n=calls().length;fs.rmSync(path.join(dir,'reports',id+'.json'));
 const file=path.join(prompts,'coach/chat.md'),old=fs.readFileSync(file,'utf8');try{fs.writeFileSync(file,old+'\nLATER PROMPT');assert.deepEqual((await json('/coach/runs/'+r.id)).body.data,r);}finally{fs.writeFileSync(file,old);}
 const p=await page(1440);await p.getByRole('button',{name:/Pinned source.*0 ответов/}).click();await p.getByTestId('coach-request-unavailable').waitFor();await p.close();assert.equal((await json('/coach/runs/'+c.id)).body.data.lastRequest,undefined);
 const exp=await fetch(BASE+'/api/data/export'),z=unzipSync(new Uint8Array(await exp.arrayBuffer()));assert.ok(z['coach-runs/'+r.id+'.json']);assert.ok(z['backup-prompts/coach/chat.md']);fs.rmSync(path.join(dir,'coach-runs'),{recursive:true});const imp=await fetch(BASE+'/api/data/import',{method:'POST',headers:{'content-type':'application/zip'},body:zipSync(z)});assert.equal(imp.status,200);assert.deepEqual((await json('/coach/runs/'+r.id)).body.data,r);assert.equal(calls().length,n);
});

test('coach review: delayed preview after SPA exit never appears on a new Coach page',async()=>{
 const p=await page(),n=calls().length;let started=0;
 await p.route('**/api/coach/preview',async route=>{const response=await route.fetch();started++;await new Promise(r=>setTimeout(r,600));await route.fulfill({response}).catch(()=>{});});
 await p.getByRole('button',{name:'Создать диалог с этим контекстом',exact:true}).click();await p.getByTestId('coach-context').waitFor();await p.getByLabel('Вопрос AI Coach',{exact:true}).fill('Поздний предпросмотр');await p.getByRole('button',{name:'Предпросмотр запроса',exact:true}).click();
 for(let i=0;i<50&&started===0;i++)await p.waitForTimeout(20);assert.equal(started,1);await p.getByRole('link',{name:'Панель',exact:true}).click();await p.getByTestId('daily-ideas-widget').waitFor();await p.waitForTimeout(750);await p.getByRole('link',{name:'AI Coach',exact:true}).click();await p.getByRole('button',{name:'Создать диалог с этим контекстом',exact:true}).waitFor();assert.equal(await p.getByTestId('coach-preview').count(),0);assert.equal(await p.getByTestId('coach-conversation').count(),0);assert.equal(calls().length,n);assert.deepEqual(p.errors,[]);await p.close();
});
