// Desktop documentation only: no provider credentials or external API calls.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),BASE='http://127.0.0.1:8853';
const OUT=process.env.TEST_ARTIFACTS_DIR||'/data/ts68-help-qa';
const VERSION=JSON.parse(fs.readFileSync(ROOT+'/package.json','utf8')).version;
let browser,server,dir;
function source(){const text=fs.readFileSync(ROOT+'/apps/web/src/lib/help.ts','utf8'),marker='export const HELP: HelpGroup[] = ';return JSON.parse(text.slice(text.indexOf(marker)+marker.length,text.indexOf(';\n\nexport const HELP_SECTIONS')));}
before(async()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'ts-help-'));fs.mkdirSync(OUT,{recursive:true});fs.cpSync(ROOT+'/apps/server/prompts',dir+'/prompts',{recursive:true});server=spawn(process.execPath,['dist/index.js'],{cwd:ROOT+'/apps/server',env:{PATH:process.env.PATH,HOST:'127.0.0.1',PORT:'8853',DATA_DIR:dir,PROMPTS_DIR:dir+'/prompts',ENV_FILE:dir+'/absent.env',APP_PASSWORD:'help-test'},stdio:'ignore'});let ready=false;for(let i=0;i<150;i++){try{if((await fetch(BASE+'/api/auth/status')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();server?.kill();fs.rmSync(dir,{recursive:true,force:true});});
async function page(){const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await context.request.post(BASE+'/api/auth/login',{data:{password:'help-test'}});const p=await context.newPage();p.errors=[];p.calls=[];p.on('pageerror',e=>p.errors.push(e.message));await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==BASE){p.calls.push(u.href);return r.abort();}if(u.pathname==='/api/health')return r.fulfill({json:{ok:true,data:{version:VERSION,node:'test',keys:[],llm:null}}});if(u.pathname.startsWith('/api/')&&r.request().method()==='POST')p.calls.push(u.pathname);return r.continue();});return p;}
async function shot(p,name){await p.waitForTimeout(200);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:OUT+'/'+name+'.png'});assert.deepEqual(p.errors,[]);assert.deepEqual(p.calls,[]);}
test('documentation: every menu route covered; all 63 chapters have specific examples and expenses',()=>{const sections=source().flatMap(g=>g.sections);assert.equal(sections.length,63);assert.equal(new Set(sections.map(s=>s.id)).size,63);for(const s of sections){assert.ok(s.what.length>30,s.id);assert.ok(s.example?.input.length>15,s.id);assert.ok(s.example?.output.length>20,s.id);assert.ok(s.cost?.length>15,s.id);}const nav=fs.readFileSync(ROOT+'/apps/web/src/lib/nav.tsx','utf8');const routes=[...nav.matchAll(/to:\s*"([^"]+)"/g)].map(m=>m[1]);for(const r of routes)assert.ok(sections.some(s=>s.route===r),'missing '+r);assert.equal(JSON.stringify(sections).includes('\ufffd'),false);});
test('documentation: generated manual agrees with the app source and has no old 0.11 title',()=>{const file=path.join(dir,'manual.md');execFileSync(ROOT+'/node_modules/.bin/tsx',['scripts/build-help.mts',file],{cwd:ROOT,env:{PATH:process.env.PATH}});const generated=fs.readFileSync(file,'utf8');assert.equal(generated,fs.readFileSync(ROOT+'/DOCUMENTATION-RU.md','utf8'));for(const s of source().flatMap(g=>g.sections))assert.ok(generated.includes('<a id="'+s.id+'"></a>'));assert.ok(generated.includes(VERSION));assert.ok(!generated.includes('Версия 0.11'));});
test('help desktop: 63 sections, ordinary versus DNA instructions, sidebar and searchable fields',async()=>{const p=await page();await p.goto(BASE+'/help#script');await p.locator('#script').waitFor();for(const s of source().flatMap(g=>g.sections))assert.equal(await p.locator('[id="'+s.id+'"]').count(),1,s.id);
await p.getByLabel('Поиск по справке',{exact:true}).fill('Отключить для этого черновика');await p.locator('#script').evaluate(e=>e.scrollIntoView({block:'start'}));assert.match(await p.locator('#script').innerText(),/Отдельного пункта «Старый сценарист» нет/);await shot(p,'help-script-desktop');
await p.getByLabel('Поиск по справке',{exact:true}).fill('Библиотека стилей: внешний вид и движение');await p.locator('#styles').evaluate(e=>e.scrollIntoView({block:'start'}));assert.match(await p.locator('#styles').innerText(),/negative/);await shot(p,'help-styles-desktop');await p.context().close();});
test('help desktop: exact methodology is collapsed but searchable; expanded readable',async()=>{const p=await page();await p.goto(BASE+'/help#competitors');await p.getByLabel('Поиск по справке',{exact:true}).fill('156–180');const card=p.locator('#competitors'),details=card.locator('details');assert.equal(await details.evaluate(d=>d.open),false);await details.locator('summary').click();assert.equal(await details.evaluate(d=>d.open),true);await details.scrollIntoViewIfNeeded();await shot(p,'help-methodology-desktop');await p.context().close();});
test('help desktop: empty search and source navigation; reading makes no paid requests',async()=>{const p=await page();await p.goto(BASE+'/help');await p.getByLabel('Поиск по справке',{exact:true}).fill('zz-no-such-help-topic-53');await p.getByText(/Ничего не найдено/).waitFor();await shot(p,'help-empty-desktop');await p.getByLabel('Поиск по справке',{exact:true}).fill('Библиотека стилей: внешний вид и движение');await p.locator('#styles').getByRole('link',{name:'Открыть раздел',exact:true}).click();await p.waitForURL(BASE+'/styles');await p.getByRole('heading',{name:'Библиотека стилей',exact:true}).waitFor();assert.deepEqual(p.calls,[]);assert.deepEqual(p.errors,[]);await p.context().close();});

test('help desktop: three practical routes explain checkpoints, costs and original stories',async()=>{const p=await page();await p.goto(BASE+'/help#practice-dna');for(const id of ['practice-script','practice-dna','practice-production']){const card=p.locator('#'+id);await card.scrollIntoViewIfNeeded();assert.match(await card.innerText(),/Что расходуется/);assert.ok((await card.locator('ol li').count())>=8);await card.evaluate(e=>e.scrollIntoView({block:'start'}));await shot(p,'help-'+id+'-desktop');}assert.match(await p.locator('#practice-dna').innerText(),/десять пар/);assert.match(await p.locator('#practice-dna').innerText(),/не заполняйте профиль выдуманными/i);assert.match(await p.locator('#practice-production').innerText(),/не готовые картинки/i);await p.context().close();});

test('documentation: four revised chapters preserve actual limits and save boundaries',()=>{
 const by=Object.fromEntries(source().flatMap(g=>g.sections).map(s=>[s.id,s]));
 for(const id of ['projects','seo','video','pipeline']){assert.ok(by[id].steps.length>=8);assert.ok(by[id].fields.length>=9);assert.ok(by[id].problems.length>=4);}
 const seo=JSON.stringify(by.seo),video=JSON.stringify(by.video),pipe=JSON.stringify(by.pipeline),projects=JSON.stringify(by.projects);
 assert.match(seo,/20 000/);assert.match(seo,/не перезаписывает/);assert.match(seo,/всю группу/);
 assert.match(video,/150 слов/);assert.match(video,/пустым/);assert.match(video,/Ken Burns/);
 assert.match(pipe,/следующий/);assert.match(pipe,/пять этапов/);assert.match(projects,/draft_/);assert.match(projects,/5000/);
 const src=f=>fs.readFileSync(ROOT+'/'+f,'utf8');
 assert.match(src('apps/web/src/pages/Seo.tsx'),/slice\(0, 20000\)/);
 assert.match(src('apps/server/src/services/seo.ts'),/min\(200/);
 assert.match(src('apps/server/src/services/shorts.ts'),/wc\(script\) < 150/);
 assert.match(src('apps/server/src/services/pipeline.ts'),/count: 3/);
 assert.match(src('apps/server/src/services/projects.ts'),/draft_/);
});

test('help desktop: revised chapter fields and pitfalls are readable and searchable',async()=>{
 const p=await page();await p.goto(BASE+'/help');
 for(const [id,q] of [['projects','Внешние ссылки не превращаются'],['seo','маленькая кнопка у отдельной группы'],['video','SRT пустой'],['pipeline','пять этапов']]){
  await p.getByLabel('Поиск по справке',{exact:true}).fill(q);const card=p.locator('#'+id);await card.waitFor();
  await card.locator('dl').first().evaluate(e=>e.scrollIntoView({block:'start'}));await shot(p,'help-'+id+'-fields-desktop');
 }
 await p.context().close();
});

test('SEO desktop: tag copy scope and non-persistence match the manual; no generation',async()=>{
 const p=await page();await p.addInitScript(()=>{window.__copies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window.__copies.push(t)}}});});
 const result={keyword:'резерв',titles:[],description:{full:'Учебный SEO-пакет',hook:[],body:[],chapters:[],cta:''},hashtags:[],tags:[{tag:'резерв',group:'primary',selected:true},{tag:'ликвидность',group:'primary',selected:true}],pinnedComments:[],checks:[],minutes:4,model:'fixture',input:{language:'ru',niche:'учебная'}};
 const project={id:'seo-fixture',title:'Проверка копирования',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',artifacts:[{id:'seo-artifact',kind:'seo',title:'SEO',data:result,createdAt:'2026-01-01T00:00:00Z'}]};
 await p.route('**/api/projects/seo-fixture',r=>r.fulfill({json:{ok:true,data:project}}));
 await p.goto(BASE+'/seo?projectId=seo-fixture&artifact=seo-artifact');
 const block=p.getByRole('heading',{name:'Теги',exact:true}).locator('..').locator('..');
 await block.getByRole('button',{name:'ликвидность',exact:true}).click();
 const copy=block.getByRole('button',{name:'Копировать',exact:true});await copy.nth(0).click();
 assert.equal(await p.evaluate(()=>window.__copies.at(-1)),'резерв');
 await block.locator('button[aria-label=""]').first().click();assert.equal(await p.evaluate(()=>window.__copies.at(-1)),'резерв, ликвидность');
 assert.match(await block.getByRole('button',{name:'ликвидность',exact:true}).getAttribute('class'),/line-through/);
 await p.reload();const tag=p.getByRole('button',{name:'ликвидность',exact:true});await tag.waitFor();
 assert.doesNotMatch(await tag.getAttribute('class'),/line-through/);
 assert.deepEqual(p.calls,[]);assert.deepEqual(p.errors,[]);await p.context().close();
});

test('documentation: production chapters distinguish local actions, generation and storage',()=>{
 const by=Object.fromEntries(source().flatMap(g=>g.sections).map(s=>[s.id,s]));
 for(const id of ['voice','storyboard','thumbnail','transcripts']){assert.ok(by[id].steps.length>=9,id);assert.ok(by[id].fields.length>=10,id);assert.ok(by[id].problems.length>=4,id);}
 const v=JSON.stringify(by.voice),s=JSON.stringify(by.storyboard),t=JSON.stringify(by.thumbnail),tr=JSON.stringify(by.transcripts);
 assert.match(v,/120 000/);assert.match(v,/1200/);assert.match(v,/первые 200/i);assert.match(v,/исходном формате/);
 assert.match(s,/200–60 000/);assert.match(s,/не автоматически продолжает/);assert.match(s,/до трёх/);
 assert.match(t,/1024 px/);assert.match(t,/AnyModel, OpenAI и Gemini/);assert.match(t,/не настоящий A\/B/);
 assert.match(tr,/300 000/);assert.match(tr,/100–60 000/);assert.match(tr,/не вызывает AI/);assert.match(tr,/не переносит исходные таймкоды/);
 const src=f=>fs.readFileSync(ROOT+'/'+f,'utf8');assert.match(src('apps/server/src/routes/voice.ts'),/300 \* 1024 \* 1024/);assert.match(src('apps/server/src/services/storyboard.ts'),/max\(60000/);assert.match(src('apps/server/src/services/transcriptText.ts'),/analysisChars: 60000/);
});

test('help desktop: four production chapters expose detailed fields without generation',async()=>{
 const p=await page();await p.goto(BASE+'/help');
 for(const [id,q] of [['voice','1200 символов'],['storyboard','200–60 000'],['thumbnail','Мой персонаж'],['transcripts','100–60 000']]){
  await p.getByLabel('Поиск по справке',{exact:true}).fill(q);const card=p.locator('#'+id);await card.waitFor();
  await card.locator('dl').first().evaluate(e=>e.scrollIntoView({block:'start'}));await shot(p,'help-'+id+'-fields-desktop');
 }
 await p.context().close();
});

test('documentation: settings, styles, prompt history and audio save boundaries match implementation',()=>{
 const by=Object.fromEntries(source().flatMap(g=>g.sections).map(s=>[s.id,s]));
 for(const id of ['styles','prompts','settings','audio-storyboard']){assert.ok(by[id].steps.length>=10,id);assert.ok(by[id].fields.length>=12,id);assert.ok(by[id].problems.length>=5,id);}
 assert.match(JSON.stringify(by.styles),/4 МиБ/);assert.match(JSON.stringify(by.styles),/От 10 до 8000/);
 assert.match(JSON.stringify(by.prompts),/400 000/);assert.match(JSON.stringify(by.prompts),/несохранённым вводом/);
 assert.match(JSON.stringify(by.settings),/Сохранить настройки/);assert.match(JSON.stringify(by.settings),/Ноль означает отсутствие лимита/);assert.match(JSON.stringify(by.settings),/не банковский/i);
 assert.match(JSON.stringify(by['audio-storyboard']),/6000 символов/);assert.match(JSON.stringify(by['audio-storyboard']),/500 фрагментов/);
 const src=f=>fs.readFileSync(ROOT+'/'+f,'utf8');assert.match(src('apps/server/src/services/visualStyles.ts'),/const MAX = 4 \* 1024 \* 1024/);assert.match(src('apps/server/src/services/promptStudio.ts'),/content.length > 400_000/);assert.match(src('apps/server/src/services/audioStoryboard.ts'),/text: z.string\(\).max\(6000\)/);
});

test('help desktop: settings, prompts, styles and audio chapters are searchable without API generation',async()=>{
 const p=await page();await p.goto(BASE+'/help');
 for(const [id,q] of [['styles','4 МиБ'],['prompts','400 000'],['settings','Ноль означает отсутствие лимита'],['audio-storyboard','500 фрагментов']]){
  await p.getByLabel('Поиск по справке',{exact:true}).fill(q);const card=p.locator('#'+id);await card.waitFor();
  await card.locator('dl').first().evaluate(e=>e.scrollIntoView({block:'start'}));await shot(p,'help-'+id+'-57-fields-desktop');
 }
 const search=p.getByLabel('Поиск по справке',{exact:true});await search.fill('Глубина 1–4 страницы');const detail=p.locator('#settings details');await detail.locator('summary').click();assert.match(await detail.innerText(),/Авто-дайджест/);
 assert.deepEqual(p.calls,[]);assert.deepEqual(p.errors,[]);await p.context().close();
});

test('styles desktop: local create, copy, edit and delete follow documentation; no AI',async()=>{
 const p=await page();await p.goto(BASE+'/styles');await p.getByRole('button',{name:'Добавить стиль',exact:true}).click();
 await p.getByRole('textbox',{name:'Название',exact:true}).fill('Учебный стиль документации 57');
 await p.getByLabel('Изображение: стиль и постоянные признаки').fill('Heavy clean black ink, pale expressive faces, muted colors.');
 await p.getByLabel('Анимация: что происходит в кадре').fill('Intention, physical attempt, visible consequence, emotional reaction.');
 await p.getByRole('button',{name:'Сохранить стиль',exact:true}).click();
 let card=p.locator('article').filter({has:p.getByRole('heading',{name:'Учебный стиль документации 57',exact:true})});await card.waitFor();
 await card.getByRole('button',{name:'Копия',exact:true}).click();await p.getByRole('button',{name:'Сохранить стиль',exact:true}).click();
 const copy=p.locator('article').filter({has:p.getByRole('heading',{name:'Учебный стиль документации 57 · копия',exact:true})});await copy.waitFor();
 await copy.getByRole('button',{name:'Изменить',exact:true}).click();await p.getByRole('textbox',{name:'Название',exact:true}).fill('Учебный стиль 57 изменён');await p.getByRole('button',{name:'Сохранить стиль',exact:true}).click();
 const edited=p.locator('article').filter({has:p.getByRole('heading',{name:'Учебный стиль 57 изменён',exact:true})});await edited.waitFor();await edited.getByRole('button',{name:'Удалить Учебный стиль 57 изменён',exact:true}).click();await edited.getByRole('button',{name:'Подтвердить удаление',exact:true}).click();await edited.waitFor({state:'detached'});
 await p.reload();await p.getByRole('heading',{name:'Учебный стиль документации 57',exact:true}).waitFor();assert.equal(await p.getByRole('heading',{name:'Учебный стиль 57 изменён',exact:true}).count(),0);
 assert.deepEqual(p.calls.filter(x=>!/^\/api\/visual-styles(?:\/|$)/.test(x)),[]);assert.deepEqual(p.errors,[]);await p.context().close();
});

test('prompts desktop: unsaved cancel, local save and historical restore affect only isolated template',async()=>{
 const p=await page();await p.goto(BASE+'/prompts');const editor=p.getByRole('textbox',{name:'Текст промпта',exact:true});await editor.waitFor();await p.waitForFunction(()=>document.querySelector('textarea[aria-label="Текст промпта"]')?.value.length>20);
 const original=await editor.inputValue();await editor.fill(original+'\nУчебная несохранённая инструкция.');await p.getByRole('button',{name:'Отменить',exact:true}).click();assert.equal(await editor.inputValue(),original);
 await editor.fill(original+'\nУчебная сохранённая инструкция 57.');await p.getByRole('button',{name:'Сохранить',exact:true}).click();await p.getByText('Сохранено. Прошлая версия — в истории ниже.',{exact:true}).waitFor();
 await p.reload();await editor.waitFor();await p.waitForFunction(()=>document.querySelector('textarea[aria-label="Текст промпта"]')?.value.includes('Учебная сохранённая инструкция 57.'));
 const row=p.getByText('Заводская версия',{exact:true}).locator('..');p.once('dialog',d=>d.accept());await row.getByRole('button',{name:'Вернуть',exact:true}).click();await p.waitForFunction(text=>document.querySelector('textarea[aria-label="Текст промпта"]')?.value===text,original);
 assert.deepEqual(p.calls.filter(x=>!['/api/prompts/restore'].includes(x)),[]);assert.deepEqual(p.errors,[]);assert.equal(fs.readFileSync(dir+'/prompts/universal/2_script.md','utf8'),original);await p.context().close();
});

test('documentation: checks explain input cutoffs, local selection and non-predictive scores',()=>{
 const by=Object.fromEntries(source().flatMap(g=>g.sections).map(s=>[s.id,s]));
 for(const id of ['ai-detector','humanizer','script-rater','scorecard']){assert.ok(by[id].steps.length>=9,id);assert.ok(by[id].fields.length>=8,id);assert.ok(by[id].problems.length>=5,id);}
 const src=f=>fs.readFileSync(ROOT+'/'+f,'utf8');
 for(const [id,terms] of Object.entries({'ai-detector':['30 000','65','40%','прежнюю'],humanizer:['5000','700','галоч','1400'],'script-rater':['50 000','15 секунд','не YouTube Analytics','не хранится'],scorecard:['1500','2500','50 последних','не сам файл']}))for(const term of terms)assert.ok(JSON.stringify(by[id]).includes(term),id+': '+term);
 assert.match(src('apps/server/src/services/detector.ts'),/input\.text\.slice\(0, 30000\)/);
 assert.match(src('apps/server/src/services/rater.ts'),/script\.slice\(0, 50000\)/);
 assert.match(src('apps/server/src/services/scorecard.ts'),/input\.hook\.slice\(0, 1500\)/);
 assert.match(src('apps/server/src/services/scorecard.ts'),/input\.description\.slice\(0, 2500\)/);
 assert.match(src('apps/server/src/services/humanizer.ts'),/authorSample\.trim\(\)\.slice\(0, 5000\)/);
});
test('help desktop: four check chapters searchable and field explanations readable',async()=>{
 const p=await page();await p.goto(BASE+'/help');
 for(const [id,q] of [['ai-detector','Конец длинного текста'],['humanizer','снятия галочек'],['script-rater','не YouTube Analytics'],['scorecard','не сам файл изображения']]){
  await p.getByLabel('Поиск по справке',{exact:true}).fill(q);const card=p.locator('#'+id);await card.waitFor();await card.locator('dl').first().evaluate(e=>e.scrollIntoView({block:'start'}));await shot(p,'help-'+id+'-58-fields-desktop');
 }
 await p.context().close();
});
test('humanizer desktop: live scan has no LLM; dictionaries and initial controls match documentation',async()=>{
 const p=await page();await p.goto(BASE+'/check/humanizer');
 await p.getByRole('heading',{name:'Живой голос',exact:true}).waitFor();
 await p.getByRole('textbox',{name:/^Сценарий/}).fill('Важно отметить, что финансовая грамотность играет важную роль. Необходимо подчеркнуть, что резерв нужен для срочных расходов. '.repeat(3));
 await p.getByText('без LLM',{exact:true}).waitFor();
 assert.ok(p.calls.includes('/api/check/humanizer/scan'));assert.ok(p.calls.every(x=>x==='/api/check/humanizer/scan'));
 await p.getByText('Голос автора',{exact:true}).click();await p.getByLabel('Образец текста автора').waitFor();
 assert.equal(await p.getByLabel('Образец текста автора').getAttribute('maxlength'),'6000');
 assert.equal(await p.getByLabel('Допустимое изменение длины сцены').inputValue(),'15');
 assert.deepEqual(p.errors,[]);await p.context().close();
});

test('documentation: research chapters separate evidence, quota, AI and frozen snapshots',()=>{
 const by=Object.fromEntries(source().flatMap(g=>g.sections).map(s=>[s.id,s]));
 for(const id of ['keywords','comments','niches','video-scorecard']){const s=by[id];assert.ok(s.steps.length>=8,id);assert.ok(s.fields.length>=9,id);assert.ok(s.problems.length>=4,id);assert.ok(s.details.length>=2,id);}
 const k=JSON.stringify(by.keywords),c=JSON.stringify(by.comments),n=JSON.stringify(by.niches),v=JSON.stringify(by['video-scorecard']);
 assert.match(k,/102/);assert.match(k,/30/);assert.match(k,/частотност/);assert.match(k,/50/);
 assert.match(c,/800/);assert.match(c,/предпросмотр/i);assert.match(c,/C1/);assert.match(c,/отдельн/i);
 assert.match(n,/48/);assert.match(n,/180/);assert.match(n,/RPM/);assert.match(n,/монетизац/);
 assert.match(v,/48/);assert.match(v,/180/);assert.match(v,/VPH/);assert.match(v,/CTR/);
 const src=f=>fs.readFileSync(ROOT+'/'+f,'utf8');
 assert.match(src('apps/web/src/pages/Keywords.tsx'),/keyword-evidence/);assert.match(src('apps/web/src/pages/Comments.tsx'),/comment-review/);
 assert.match(src('apps/server/src/services/keywordEvidence.ts'),/suggestqueries/);assert.match(src('apps/server/src/services/commentReview.ts'),/800/);
});

test('help desktop: four research chapters are searchable in dark and light themes without spending',async()=>{
 const p=await page();await p.goto(BASE+'/help');
 for(const [id,q] of [['keywords','частотности'],['comments','800'],['niches','RPM'],['video-scorecard','VPH']]){
  await p.getByLabel('Поиск по справке',{exact:true}).fill(q);const card=p.locator('#'+id);await card.waitFor();
  await card.locator('dl').first().evaluate(e=>e.scrollIntoView({block:'start'}));await shot(p,'help-'+id+'-60-fields-desktop');
 }
 await p.evaluate(()=>{document.documentElement.classList.remove('dark');document.documentElement.setAttribute('data-theme','light')});
 await p.locator('#video-scorecard details summary').click();await p.locator('#video-scorecard details').evaluate(e=>e.scrollIntoView({block:'start'}));await shot(p,'help-video-scorecard-60-methodology-light-desktop');
 await p.context().close();
});

test('documentation: channel analysis and legacy anomalies are not advertised as evidence or guaranteed income',()=>{
 const by=Object.fromEntries(source().flatMap(g=>g.sections).map(s=>[s.id,s]));
 for(const id of ['analysis','anomalies','research','research-candidates','competitors']){assert.ok(by[id].steps.length>=12,id);assert.ok(by[id].fields.length>=10,id);assert.ok(by[id].problems.length>=5,id);assert.ok(by[id].details.length>=2,id);}
 const a=JSON.stringify(by.analysis),old=JSON.stringify(by.anomalies),r=JSON.stringify(by.research),c=JSON.stringify(by['research-candidates']),t=JSON.stringify(by.competitors);
 assert.match(a,/Аналитика и доход → Анализ канала/);assert.match(a,/автоматически/);assert.match(a,/семь тем/);assert.match(a,/не трафик/);assert.match(a,/6 часов/);assert.match(a,/на 12/);
 assert.match(old,/подмен/);assert.match(old,/auto=1/);assert.match(old,/новый поиск/);
 assert.match(r,/122/);assert.match(r,/не запускает/);assert.match(r,/первых/);
 assert.match(c,/200/);assert.match(c,/два последних/);assert.match(c,/1500/);assert.match(c,/минимум 10/);
 assert.match(t,/156–180/);assert.match(t,/12–36/);assert.match(t,/для самой цели|Для самой цели/);assert.match(t,/авто-дайджест/i);
 const src=f=>fs.readFileSync(ROOT+'/'+f,'utf8');assert.match(src('apps/server/src/services/analysis.ts'),/outlierSets.push\(await generateOutliers/);assert.match(src('apps/server/src/services/metrics.ts'),/const w1 = win\(0, 30\), w2 = win\(30, 60\)/);assert.match(src('apps/server/src/services/researchWorkflow.ts'),/observations.at\(-2\)/);assert.match(src('apps/server/src/services/researchEvidence.ts'),/slice\(0,d.baselineChannels\)/);
});

test('help desktop: five remaining research chapters show controls, examples and methodology without network spending',async()=>{
 const p=await page();await p.goto(BASE+'/help');
 for(const [id,q] of [['analysis','не трафик'],['anomalies','auto=1'],['research','122'],['research-candidates','1500'],['competitors','156–180']]){
  await p.getByLabel('Поиск по справке',{exact:true}).fill(q);const card=p.locator('#'+id);await card.waitFor();await card.locator('dl').first().evaluate(e=>e.scrollIntoView({block:'start'}));await shot(p,'help-'+id+'-61-fields-desktop');
 }
 await p.evaluate(()=>{document.documentElement.classList.remove('dark');document.documentElement.setAttribute('data-theme','light')});
 const d=p.locator('#competitors details');await d.locator('summary').click();await d.evaluate(e=>e.scrollIntoView({block:'start'}));await shot(p,'help-competitors-61-methodology-light-desktop');await p.context().close();
});

test('analysis desktop: stored report opens locally; year switch and Markdown do not run analysis or AI',async()=>{
 const p=await page(),fixture=JSON.parse(fs.readFileSync(ROOT+'/tests/e2e/fixtures/analysis.json','utf8'));
 delete fixture.channel.avatar;for(const v of fixture.videos)delete v.thumbnail;
 await p.route('**/api/youtube/reports/'+fixture.id,r=>r.fulfill({json:{ok:true,data:fixture}}));
 await p.goto(BASE+'/analysis?report='+fixture.id);await p.getByRole('heading',{name:fixture.channel.title,exact:true}).waitFor();
 await p.getByRole('button',{name:'Год',exact:true}).click();await p.getByRole('button',{name:'Месяц',exact:true}).click();
 const [download]=await Promise.all([p.waitForEvent('download'),p.getByRole('button',{name:'Markdown',exact:true}).click()]);assert.match(fs.readFileSync(await download.path(),'utf8'),new RegExp(fixture.channel.title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 await shot(p,'analysis-61-local-history-desktop');await p.context().close();
});

test('documentation: comparison separates lexical hints, saved review, numerical coverage and frozen project copy',()=>{
 const s=source().flatMap(g=>g.sections).find(s=>s.id==='research-comparison'),text=JSON.stringify(s);
 assert.ok(s.steps.length>=18);assert.ok(s.fields.length>=14);assert.ok(s.problems.length>=8);assert.ok(s.details.length>=5);
 for(const re of [/1–8/,/2–80/,/history/,/до 7/,/минимум 3/,/цель тоже не моложе 48/i,/не обновляются/,/не обязательно/,/первые 10/,/20 000/,/1500/,/не процент покрытия/i,/не предусмотрен/,/округлённым/])assert.match(text,re);
 const backend=fs.readFileSync(ROOT+'/apps/server/src/services/researchComparison.ts','utf8'),ui=fs.readFileSync(ROOT+'/apps/web/src/features/researchEvidence/Comparison.tsx','utf8');
 assert.match(backend,/z\.array\(Term\)\.min\(1\)\.max\(8\)/);assert.match(backend,/max\(3\)/);assert.match(backend,/const DIR='research-comparisons',LIMIT=2\*1024\*1024/);assert.match(backend,/c\.counts\.qualifiedConfirmed>0/);assert.match(backend,/refs\.slice\(0,10\)/);assert.match(backend,/old\.revision/);assert.match(backend,/notes\.length>20000/);
 assert.match(ui,/JSON экспортирует сохранённое решение/);assert.match(ui,/useState\('history'\)/);
});
test('help desktop: comparison fields, saved-state warnings and collapsed methodology readable in both themes',async()=>{
 const p=await page();await p.goto(BASE+'/help#research-comparison');
 await p.getByLabel('Поиск по справке',{exact:true}).fill('JSON сохранённого сравнения');
 const card=p.locator('#research-comparison');await card.waitFor();await card.locator('dl').first().evaluate(e=>e.scrollIntoView({block:'start'}));await shot(p,'help-comparison-62-fields-desktop');
 const details=card.locator('details');assert.equal(await details.evaluate(e=>e.open),false);
 await p.getByLabel('Поиск по справке',{exact:true}).fill('expectedRevision');await details.locator('summary').click();assert.equal(await details.evaluate(e=>e.open),true);
 await p.evaluate(()=>{document.documentElement.classList.remove('dark');document.documentElement.dataset.theme='light';localStorage.setItem('ts:theme','light');});
 await details.evaluate(e=>e.scrollIntoView({block:'start'}));await shot(p,'help-comparison-62-methodology-light-desktop');await p.context().close();
});

test('documentation: five ideation chapters disclose AI, formulas, context bounds and save boundaries',()=>{
 const by=Object.fromEntries(source().flatMap(g=>g.sections).map(s=>[s.id,s]));
 for(const id of ['script','donor-workflow','voice-profile','topics','daily-ideas']){assert.ok(by[id].steps.length>=12,id);assert.ok(by[id].fields.length>=14,id);assert.ok(by[id].problems.length>=6,id);assert.ok(by[id].details.length>=2,id);}
 const t=id=>JSON.stringify(by[id]);
 for(const re of [/первые 6000/,/только связь с ДНК/,/20–120 000/,/не восстанавливает/,/могла записаться/,/несохранёнными/,/от одного до семи/])assert.match(t('script'),re);
 for(const re of [/сервер/,/не клонирование/i,/до четырёх/,/метрик|чисел/,/русского и английского/,/не входят|не все исходные/])assert.match(t('voice-profile'),re);
 for(const re of [/первые 10/,/8 МиБ/,/не рейтинг|не рейтинг/i,/409/,/5000 файлов/,/не входит|не передаются|исключены/])assert.match(t('daily-ideas'),re);
 for(const re of [/просмотры.*подписчик/i,/первые три/,/меньше|короче/,/Почти гарантированный вирус/,/минимум 10/,/не перенос/])assert.match(t('topics'),re);
 for(const re of [/11 полей/,/R1–R999/,/300 мс/,/не входит/,/12 слов/,/100–5000/])assert.match(t('donor-workflow'),re);
 const src=f=>fs.readFileSync(ROOT+'/'+f,'utf8');
 assert.match(src('apps/server/src/services/script.ts'),/slice\(0, 6000\)/);assert.match(src('apps/server/src/services/channelVoice.ts'),/v.language !== language/);assert.match(src('apps/server/src/services/dailyIdeas.ts'),/slice\(0,10\)/);assert.match(src('apps/server/src/services/topicFinder.ts'),/v.views \/ s/);assert.match(src('apps/server/src/services/donorWorkflow.ts'),/12 <= s.length/);
});
test('help desktop: all five ideation chapters searchable, fields readable and AI-free in dark/light',async()=>{
 const p=await page();await p.goto(BASE+'/help');
 for(const [id,q] of [['script','первые 6000'],['donor-workflow','R1–R999'],['voice-profile','письменной манеры'],['topics','Почти гарантированный вирус'],['daily-ideas','8 МиБ']]){
  await p.getByLabel('Поиск по справке',{exact:true}).fill(q);const card=p.locator('#'+id);await card.waitFor();await card.locator('dl').first().evaluate(e=>e.scrollIntoView({block:'start'}));await shot(p,'help-'+id+'-63-fields-desktop');
 }
 const card=p.locator('#daily-ideas'),details=card.locator('details');assert.equal(await details.evaluate(e=>e.open),false);await details.locator('summary').click();await p.evaluate(()=>document.documentElement.classList.remove('dark'));await details.evaluate(e=>e.scrollIntoView({block:'start'}));await shot(p,'help-daily-63-methodology-light-desktop');await p.context().close();
});
test('voice passport desktop: server-side deterministic save, exact prompt and matching language, no AI',async()=>{
 const p=await page();await p.goto(BASE+'/voice-profile');await p.getByRole('heading',{name:'Голос канала',exact:true}).waitFor();
 const text='Ты видишь простую задачу. Но где спряталась ошибка? Попробуем проверить её вместе. Сначала проверяем причину. Затем смотрим на результат. Это наш учебный пример без секретов. '.repeat(8);
 await p.getByPlaceholder('Вставьте текст своего сценария…').fill(text);await p.getByRole('button',{name:'Составить паспорт',exact:true}).click();await p.getByText('Что именно получает нейросеть',{exact:true}).waitFor();
 const stored=await p.request.get(BASE+'/api/voice-profile');const v=(await stored.json()).data;assert.equal(v.samples.length,1);assert.equal(v.samples[0].text,text.trim());assert.equal(v.language,'ru');assert.equal(v.enabled,true);assert.ok(v.prompt.includes('CHANNEL VOICE PASSPORT'));assert.ok(v.passport.words>100);
 assert.deepEqual(p.calls,[]);await shot(p,'voice-profile-63-passport-desktop');await p.reload();await p.getByText('Что именно получает нейросеть',{exact:true}).waitFor();assert.equal(await p.getByPlaceholder('Вставьте текст своего сценария…').inputValue(),text.trim());assert.deepEqual(p.calls,[]);await p.context().close();
});

test('documentation: workspace chapters separate records, versions, local actions and diagnosis costs',()=>{
 const by=Object.fromEntries(source().flatMap(g=>g.sections).map(s=>[s.id,s]));
 for(const id of ['dashboard','projects','saved','calendar','coach']){assert.ok(by[id].steps.length>=12,id);assert.ok(by[id].fields.length>=12,id);assert.ok(by[id].problems.length>=6,id);assert.ok(by[id].details.length>=2,id);}
 const t=id=>JSON.stringify(by[id]);
 for(const re of [/без генерации/,/−7/,/до шести/,/не банковский/i])assert.match(t('dashboard'),re);
 for(const re of [/1200/,/5000/,/номер может повториться/,/description.full/,/draft_/,/не является загрузкой/])assert.match(t('projects'),re);
 for(const re of [/3–300/,/только видимые/,/не дополняются/,/CSV может содержать формулы/,/нет импорта/])assert.match(t('saved'),re);
 for(const re of [/все записи/,/не постоянная синхронизация/,/пяти последних/,/30 минут/,/0–14/,/продублировать/])assert.match(t('calendar'),re);
 for(const re of [/12 000/,/22 000/,/60 000/,/10 000/,/восьми ответов/,/409/,/не достраивается/])assert.match(t('coach'),re);
 const src=f=>fs.readFileSync(ROOT+'/'+f,'utf8');assert.doesNotMatch(src('apps/server/src/services/keycheck.ts'),/max_tokens: 1/);assert.match(src('apps/server/src/routes/system.ts'),/settings\/keys\/check/);assert.match(src('apps/server/src/services/calendar.ts'),/slice\(0, 5\)/);assert.match(src('apps/server/src/services/projects.ts'),/length \+ 1/);assert.match(src('apps/server/src/services/coach.ts'),/contextChars: 22000/);
});
test('help desktop: workspace search, field tables and import warnings readable without task calls',async()=>{
 const p=await page();await p.goto(BASE+'/help');
 for(const [id,q] of [['dashboard','Явное получение метаданных'],['projects','номер может повториться'],['saved','только видимые'],['calendar','продублировать'],['coach','22 000']]){
  await p.getByLabel('Поиск по справке',{exact:true}).fill(q);const card=p.locator('#'+id);await card.waitFor();await card.locator('dl').first().evaluate(e=>e.scrollIntoView({block:'start'}));await shot(p,'help-'+id+'-64-fields-desktop');
 }
 await p.getByLabel('Поиск по справке',{exact:true}).fill('30 минут');const d=p.locator('#calendar details');assert.equal(await d.evaluate(e=>e.open),false);await d.locator('summary').click();await p.evaluate(()=>document.documentElement.classList.remove('dark'));await d.evaluate(e=>e.scrollIntoView({block:'start'}));await shot(p,'help-calendar-64-methodology-light-desktop');await p.context().close();
});

test('documentation: seven analytics chapters distinguish OAuth facts, estimates, missing values and local history',()=>{
 const by=Object.fromEntries(source().flatMap(g=>g.sections).map(s=>[s.id,s]));
 for(const id of ['my-analytics','analytics-geography','analytics-revenue','analytics-channels','analytics-ab','analytics-reach','profit']){assert.ok(by[id].steps.length>=12,id);assert.ok(by[id].fields.length>=7,id);assert.ok(by[id].problems.length>=5,id);assert.ok(by[id].details.length>=2,id);}
 const t=id=>JSON.stringify(by[id]);
 for(const re of [/до 25/,/четыре запроса/,/от публикации/,/минимум три/,/8/,/yt-lessons.json/])assert.match(t('my-analytics'),re);
 for(const re of [/250/,/ZZ/,/неизвест/,/5000/])assert.match(t('analytics-geography'),re);
 for(const re of [/не складываются/,/отрицательн/,/366/,/не выплата|не окончательная|не прибыль/,/scope/])assert.match(t('analytics-revenue'),re);
 for(const re of [/oauth-connections/,/не зашифрованы/,/один последний/,/предпросмотр/i,/50 подключений/])assert.match(t('analytics-channels'),re);
 for(const re of [/правый.*минус левый/i,/не определён/,/parentId/,/не автоматический/])assert.match(t('analytics-ab'),re);
 for(const re of [/8 МиБ/,/10 000/,/Pacific/,/без умножения/,/исходное число/,/неизвестном исходе/])assert.match(t('analytics-reach'),re);
 for(const re of [/ceil/,/неизвестн/,/всей установки/,/хеш/])assert.match(t('profit'),re);
 const src=f=>fs.readFileSync(ROOT+'/'+f,'utf8');assert.match(src('apps/server/src/services/ytAnalytics.ts'),/maxResults: "25"/);assert.match(src('apps/server/src/services/ytAnalytics.ts'),/retention.*catch/s);assert.match(src('apps/server/src/services/revenue.ts'),/currency:\s*"USD"/);assert.match(src('apps/server/src/services/reach.ts'),/channel_reach_basic_a1/);assert.match(src('apps/server/src/services/profit.ts'),/Math.ceil/);
});
test('help desktop: seven analytics field tables searchable; financial and Reach methodology readable in light theme',async()=>{
 const p=await page();await p.goto(BASE+'/help');
 for(const [id,q] of [['my-analytics','четыре запроса'],['analytics-geography','ZZ учитывается'],['analytics-revenue','отрицательная корректировка'],['analytics-channels','До 50 подключений'],['analytics-ab','правый CTR минус левый'],['analytics-reach','без умножения/деления'],['profit','ceil']]){
  await p.getByLabel('Поиск по справке',{exact:true}).fill(q);const card=p.locator('#'+id);await card.waitFor();await card.locator('dl').first().evaluate(e=>e.scrollIntoView({block:'start'}));await shot(p,'help-'+id+'-65-fields-desktop');
 }
 for(const id of ['analytics-revenue','analytics-reach']){await p.getByLabel('Поиск по справке',{exact:true}).fill(id==='analytics-reach'?'channel_reach_basic_a1':'estimatedAdRevenue');const d=p.locator('#'+id+' details');assert.equal(await d.evaluate(e=>e.open),false);await d.locator('summary').click();await p.evaluate(()=>document.documentElement.classList.remove('dark'));await d.evaluate(e=>e.scrollIntoView({block:'start'}));await shot(p,'help-'+id+'-65-methodology-light-desktop');}
 await p.context().close();
});

test('documentation: system chapters match paid diagnostics, local estimates, scopes and nontransactional restore',()=>{
 const by=Object.fromEntries(source().flatMap(g=>g.sections).map(s=>[s.id,s]));
 for(const id of ['keys','settings','anymodel','mcp','extension','backup']){const s=by[id];assert.ok(s.steps.length>=12,id);assert.ok(s.fields.length>=8,id);assert.ok(s.problems.length>=5,id);assert.ok(s.details.length>=2,id);}
 const text=id=>JSON.stringify(by[id]);
 for(const re of [/max_tokens:1 удалена/,/без генерации|не генерирует/,/5 минут/,/400 символов/])assert.match(text('keys'),re);
 for(const re of [/10–99/,/не банковский/i,/не останавливает/,/UTC/])assert.match(text('settings'),re);
 for(const re of [/неизвестные коэффициенты/i,/100 000/,/7100/,/Fast/,/120/,/не.*гарантированным доверительным/])assert.match(text('anymodel'),re);
 for(const re of [/expectedListToken/,/STALE_LIST/,/12 000 UTF-16/,/APP_PASSWORD/,/не yt-revenue-runs/])assert.match(text('mcp'),re);
 for(const re of [/42 единиц/,/20 баз/,/chrome.storage.local/,/1.1.0/,/не развивается/])assert.match(text('extension'),re);
 for(const re of [/нетранзакционный/,/512 МиБ/,/oauth-connections/,/LocalStorage/,/остальные/i])assert.match(text('backup'),re);
 const src=f=>fs.readFileSync(ROOT+'/'+f,'utf8');assert.doesNotMatch(src('apps/server/src/services/keycheck.ts'),/max_tokens: 1/);assert.match(src('apps/server/src/routes/system.ts'),/settings\/keys\/check/);assert.match(src('apps/server/src/services/settings.ts'),/warnPct: z.number\(\).min\(10\).max\(99\)/);assert.match(src('apps/server/src/services/backup.ts'),/count: 20_000/);assert.match(src('apps/server/src/routes/anymodel.ts'),/hist.slice\(-120\)/);assert.match(src('extension/shared.js'),/ids.length>50/);
});
test('help desktop: six system chapters searchable, scope and restore methodology readable without task calls',async()=>{
 const p=await page();await p.goto(BASE+'/help');
 for(const [id,q] of [['keys','max_tokens:1'],['settings','10–99'],['anymodel','7100'],['mcp','STALE_LIST'],['extension','42 единиц'],['backup','нетранзакционный']]){
  await p.getByLabel('Поиск по справке',{exact:true}).fill(q);const card=p.locator('#'+id);await card.waitFor();await card.locator('dl').first().evaluate(e=>e.scrollIntoView({block:'start'}));await shot(p,'help-'+id+'-66-fields-desktop');
 }
 for(const [id,q] of [['mcp','12 000 UTF-16'],['backup','preflight']]){
  await p.getByLabel('Поиск по справке',{exact:true}).fill(q);const d=p.locator('#'+id+' details');await d.locator('summary').click();await p.evaluate(()=>document.documentElement.classList.remove('dark'));await d.evaluate(e=>e.scrollIntoView({block:'start'}));await shot(p,'help-'+id+'-66-methodology-light-desktop');
 }
 await p.context().close();
});
