import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), BASE = 'http://127.0.0.1:8851', PASSWORD = 'donor-local-test';
const VERSION = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8')).version;
const OUT = process.env.TEST_ARTIFACTS_DIR || '/data/ts52-qa';
let server, browser, dir;
const dna = Object.fromEntries(['audience', 'promise', 'hooks', 'pov', 'pacing', 'stakes', 'explanation', 'humor', 'endings', 'avoid', 'evidence'].map(k => [k, `Референс 1: наблюдение о драматургии (${k}), не вывод о всём канале.`]));
const idea = (i = 1) => ({ title: `Инвестор и срочная покупка ${i}`, premise: 'Условный герой вложил резерв и вынужден продать актив ради срочной покупки.', difference: 'Другая тема и конфликт ликвидности, у донора были банковские комиссии.', conflict: 'Герой пытается получить наличные и сталкивается с убытком.', payoff: 'Резерв и рискованные вложения решают разные задачи.', questions: ['Что означает ликвидность?', 'Какие риски подтверждены источником?'] });
const initial = { name: 'Маршрут QA', channel: 'Канал QA', refs: [{ title: 'Чужой заголовок про комиссии', url: 'https://www.youtube.com/watch?v=abcdefghijk', transcript: 'Условный герой пытается перевести деньги и видит комиссию. '.repeat(8) }], notebookAnalysis: '', dna, dnaApproval: '', mode: 'own', direction: 'Инвестирование', ideas: [], selected: null, topicApproval: '', research: { sources: [], facts: '', uncertain: '', reconstruction: '', boundaries: '' }, outline: '', outlineBasis: '', outlineApproval: '', language: 'ru', words: 500 };
before(async () => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-donor-e2e-')); fs.mkdirSync(OUT, { recursive: true }); server = spawn(process.execPath, ['dist/index.js'], { cwd: ROOT + '/apps/server', env: { PATH: process.env.PATH, HOST: '127.0.0.1', PORT: '8851', DATA_DIR: dir, ENV_FILE: dir + '/absent.env', APP_PASSWORD: PASSWORD }, stdio: 'ignore' }); let ready = false; for (let i = 0; i < 100; i++) {
    try {
        if ((await fetch(BASE + '/api/auth/status')).ok) {
            ready = true;
            break;
        }
    }
    catch { }
    await new Promise(r => setTimeout(r, 100));
} assert.ok(ready); browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/local/bin/chromium', args: ['--no-sandbox'] }); });
after(async () => { await browser?.close(); server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
async function page(width = 1440, draft = null) { const ctx = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' }); await ctx.request.post(BASE + '/api/auth/login', { data: { password: PASSWORD } }); const p = await ctx.newPage(); p.errors = []; p.external = []; p.on('pageerror', e => p.errors.push(e.message)); if (draft)
    await p.addInitScript(d => { if (!sessionStorage.getItem('donor-seeded')) {
        localStorage.setItem('ts:draft:donor-workflow:v1', JSON.stringify(d));
        sessionStorage.setItem('donor-seeded', '1');
    } }, draft); await p.route('**/*', r => { const u = new URL(r.request().url()); if (u.origin !== BASE) {
    p.external.push(u.href);
    return r.abort();
} if (u.pathname === '/api/health')
    return r.fulfill({ json: { ok: true, data: { version: VERSION, node: 'test', keys: [], llm: null } } }); return r.continue(); }); return p; }
async function shot(p, name) { await p.waitForTimeout(550); assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no page overflow'); await p.screenshot({ path: OUT + '/' + name + '.png' }); assert.deepEqual(p.errors, []); assert.deepEqual(p.external, []); }
async function mock(p, stage, data) { await p.route(`**/api/donor-workflow/${stage}`, r => r.fulfill({ json: { ok: true, data: { jobId: 'mock-' + stage } } })); await p.route(`**/api/jobs/mock-${stage}/stream`, r => r.fulfill({ contentType: 'text/event-stream', body: 'event: done\ndata: ' + JSON.stringify({ data }) + '\n\n' })); }
async function approveDNA(p) { await p.getByRole('button', { name: 'Подтвердить ДНК', exact: true }).click(); await p.getByRole('button', { name: 'К новым темам', exact: true }).waitFor(); await p.getByRole('button', { name: 'К новым темам', exact: true }).click(); }
test('donor UI: initial/manual fields, responsive and error states; no URL watching or automatic paid calls', async () => {
    for (const width of [1440, 390]) {
        const p = await page(width);
        let ai = 0;
        p.on('request', r => { if (/\/api\/donor-workflow\/(analyze|ideas|outline)$/.test(new URL(r.url()).pathname))
            ai++; });
        await p.goto(BASE + '/donor-workflow');
        await p.getByRole('heading', { name: 'ДНК канала → сценарий', exact: true }).waitFor();
        assert.equal(await p.getByRole('button', { name: 'Разобрать ДНК · AI', exact: true }).isDisabled(), true);
        await shot(p, 'donor-empty-' + width);
        await p.getByRole('button', { name: 'Подтвердить ДНК', exact: true }).click();
        await p.getByRole('alert').waitFor();
        await p.getByRole('alert').scrollIntoViewIfNeeded();
        await shot(p, 'donor-error-' + width);
        assert.equal(ai, 0);
        await p.context().close();
    }
});
test('donor UI: analyze → exactly five topics → research → approved plan → explicit script handoff', async () => {
    const p = await page(1440, initial);
    await p.goto(BASE + '/donor-workflow');
    await p.getByRole('heading', { name: 'ДНК канала → сценарий', exact: true }).waitFor();
    await mock(p, 'analyze', { dna, model: 'mock' });
    await p.getByRole('button', { name: 'Разобрать ДНК · AI', exact: true }).click();
    await p.getByRole('status').filter({ hasText: 'ДНК подготовлена' }).waitFor();
    await approveDNA(p);
    await mock(p, 'ideas', { ideas: Array.from({ length: 5 }, (_, i) => ({...idea(i+1), premise:['Условный герой вложил резерв и вынужден продать актив ради срочной покупки.','Новичок выбирает единственную компанию и переживает её неудачу.','Семья откладывает начало накоплений и сравнивает цену упущенного времени.','Сотрудник сталкивается с обещаниями гарантированной прибыли и проверяет мошенника.','Друзья сравнивают комиссии и понимают скрытую цену частых сделок.'][i]})), model: 'mock' });
    await p.getByRole('button', { name: 'Предложить 5 новых тем · AI', exact: true }).click();
    await p.getByTestId('donor-idea').first().waitFor();
    assert.equal(await p.getByTestId('donor-idea').count(), 5);
    await p.getByRole('heading', { name: '02 · Новая история, а не рерайт', exact: true }).scrollIntoViewIfNeeded();
    await shot(p, 'donor-ideas-desktop');
    await p.getByRole('button', { name: 'Выбрать тему 1', exact: true }).click();
    await p.getByRole('button', { name: 'Подтвердить новую тему', exact: true }).click();
    await p.getByRole('button', { name: 'К исследованию', exact: true }).click();
    await p.getByRole('button', { name: 'Добавить источник', exact: true }).click();
    await p.getByLabel('Название · R1', { exact: true }).fill('Учебный тестовый источник о риске');
    await p.getByLabel('URL (необязательно) · R1', { exact: true }).fill('https://example.org/risk');
    await p.getByLabel('Выдержка / страница / раздел · R1', { exact: true }).fill('Учебная выдержка: инвестиции связаны с риском потери капитала и ограничениями ликвидности.');
    await p.getByLabel('Фактическая опора: утверждение → R# → подтверждение', { exact: true }).fill('R1: вложения связаны с риском потери капитала. Доходность не гарантирована; цифры будущего не установлены.');
    await p.getByLabel('Допустимая реконструкция / условные примеры', { exact: true }).fill('Безымянный инвестор и условная срочная покупка.');
    await p.getByRole('button', { name: 'Подготовить запросы NotebookLM', exact: true }).click();
    await p.getByRole('heading', { name: 'Запросы для ручной работы в NotebookLM', exact: true }).waitFor();
    assert.match(await p.locator('pre').last().innerText(), /Инвестор и срочная покупка 1/);
    await p.getByRole('heading', { name: '03 · Фактическая опора новой темы', exact: true }).scrollIntoViewIfNeeded();
    await shot(p, 'donor-research-desktop');
    await p.getByRole('button', { name: 'К драматургии', exact: true }).click();
    await p.waitForTimeout(500);
    const outline = 'Герой хочет вложить деньги, но оставляет себя без резерва. Он нажимает купить и радуется. Возникает срочная покупка. Попытка продать заставляет столкнуться с риском убытка R1. Реакция — досада, затем понимание различия резерва и долгосрочных вложений. Бытовые события — условная реконструкция. Финал закрывает начальное обещание.';
    const basis = await p.evaluate(async (w) => (await (await fetch('/api/donor-workflow/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: localStorage.getItem('ts:draft:donor-workflow:v1') })).json()).data.keys.research);
    await mock(p, 'outline', { outline, basis, checks: ['Проверить качество источника R1 вручную.'], model: 'mock' });
    await p.getByRole('button', { name: 'Подготовить драматургию · AI', exact: true }).click();
    await p.getByRole('status').filter({ hasText: 'Драматургия готова' }).waitFor();
    await p.getByRole('button', { name: 'Утвердить драматургию', exact: true }).click();
    await p.getByRole('button', { name: 'Открыть сценарист с брифом', exact: true }).waitFor();
    await p.getByRole('heading', { name: '04 · Герой пытается — мир отвечает — зритель понимает', exact: true }).scrollIntoViewIfNeeded();
    await shot(p, 'donor-plan-desktop');
    await p.getByRole('button', { name: 'Открыть сценарист с брифом', exact: true }).click();
    await p.waitForURL('**/script?donorBrief=*');
    await p.getByRole('button', { name: 'Применить бриф ДНК', exact: true }).waitFor();
    p.once('dialog', d => d.accept());
    await p.getByRole('button', { name: 'Применить бриф ДНК', exact: true }).click();
    await p.getByRole('status').filter({ hasText: 'Бриф применён' }).waitFor();
    await p.waitForTimeout(2200);
    const scriptDraft = await p.evaluate(() => JSON.parse(localStorage.getItem('ts:draft:script')));
    assert.equal(scriptDraft.topic, 'Инвестор и срочная покупка 1');
    assert.equal(scriptDraft.research, false);
    assert.equal(scriptDraft.humanize, false);
    assert.equal(scriptDraft.channelVoice, false);
    assert.ok(scriptDraft.donorBriefId);
    await shot(p, 'donor-script-handoff');
    const snap = await p.context().request.get(BASE + `/api/donor-workflow/snapshots/${scriptDraft.donorBriefId}`);
    const saved = (await snap.json()).data;
    assert.equal(saved.outline, outline);
    assert.match(saved.research.facts, /R1/);
    const list = await p.context().request.get(BASE + '/api/donor-workflow/snapshots');
    assert.ok((await list.json()).data.some(x => x.id === saved.id && x.ready));
    await p.context().close();
});
test('donor UI: manual own theme, stale approval, JSON roundtrip, light/mobile research and plan', async () => {
    const p = await page(390, initial);
    await p.goto(BASE + '/donor-workflow');
    await approveDNA(p);
    await p.getByRole('button', { name: 'Ввести свою конкретную тему', exact: true }).click();
    const i = idea(8);
    for (const [label, key] of [['Заголовок новой темы', 'title'], ['Суть новой истории', 'premise'], ['Чем тема и конфликт отличаются от донора', 'difference'], ['Проблема, попытка и цена решения', 'conflict'], ['Какую развязку обещаем', 'payoff']])
        await p.getByLabel(label, { exact: true }).fill(i[key]);
    await p.getByLabel('Вопросы для исследования (по одному в строке, минимум два)', { exact: true }).fill(i.questions.join('\n'));
    await p.getByRole('button', { name: 'Подтвердить новую тему', exact: true }).click();
    await p.waitForTimeout(500);
    assert.equal(await p.getByRole('button', { name: 'К исследованию', exact: true }).isEnabled(), true);
    await p.getByLabel('Моя идея / направление', { exact: true }).fill('Личные инвестиции, новая версия');
    await p.waitForTimeout(500);
    assert.equal(await p.getByRole('button', { name: 'К исследованию', exact: true }).isDisabled(), true);
    await p.getByRole('heading', { name: '02 · Новая история, а не рерайт', exact: true }).scrollIntoViewIfNeeded();
    await shot(p, 'donor-own-mobile');
    const dl = p.waitForEvent('download');
    await p.getByRole('button', { name: 'Экспорт JSON', exact: true }).click();
    const exported = JSON.parse(fs.readFileSync(await (await dl).path(), 'utf8'));
    assert.equal(exported.work.selected.title, i.title);
    p.once('dialog', d => d.accept());
    await p.getByLabel('Импорт маршрута JSON', { exact: true }).setInputFiles({ name: 'draft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
    await p.waitForTimeout(500);
    await p.getByRole('button', { name: '03 Исследование', exact: false }).click();
    await p.getByRole('button', { name: 'Добавить источник', exact: true }).click();
    await p.getByRole('heading', { name: '03 · Фактическая опора новой темы', exact: true }).scrollIntoViewIfNeeded();
    await shot(p, 'donor-research-mobile');
    await p.getByRole('button', { name: '04 Драматургия', exact: false }).click();
    await p.getByRole('heading', { name: '04 · Герой пытается — мир отвечает — зритель понимает', exact: true }).scrollIntoViewIfNeeded();
    await shot(p, 'donor-plan-mobile');
    await p.evaluate(() => document.documentElement.classList.remove('dark'));
    await shot(p, 'donor-plan-light-mobile');
    await p.context().close();
});
test('donor UI: corrupt draft is recoverable and not overwritten; snapshots reopen; cancellation ignores late result', async () => {
    const broken = await page();
    await broken.addInitScript(() => localStorage.setItem('ts:draft:donor-workflow:v1', JSON.stringify({ dna: {}, research: {}, refs: null })));
    await broken.goto(BASE + '/donor-workflow');
    await broken.getByRole('alert').filter({ hasText: 'Сохранённый черновик повреждён' }).waitFor();
    await broken.waitForTimeout(600);
    assert.equal(await broken.evaluate(() => JSON.parse(localStorage.getItem('ts:draft:donor-workflow:v1')).refs), null);
    await shot(broken, 'donor-draft-recovery');
    await broken.context().close();
    const p = await page(1440, initial);
    await p.goto(BASE + '/donor-workflow');
    await p.route('**/api/donor-workflow/analyze', r => r.fulfill({ json: { ok: true, data: { jobId: 'mock-late' } } }));
    await p.route('**/api/jobs/mock-late/stream', async (r) => { await new Promise(resolve => setTimeout(resolve, 1000)); await r.fulfill({ contentType: 'text/event-stream', body: 'event: done\ndata: ' + JSON.stringify({ data: { dna: { ...dna, humor: 'Не должен применяться поздний ответ' }, model: 'mock' } }) + '\n\n' }).catch(() => { }); });
    await p.route('**/api/jobs/mock-late/cancel', r => r.fulfill({ json: { ok: true, data: {} } }));
    await p.getByRole('button', { name: 'Разобрать ДНК · AI', exact: true }).click();
    await p.getByRole('button', { name: 'Остановить AI', exact: true }).waitFor();
    assert.equal(await p.getByLabel('Канал-донор / ссылка', { exact: true }).isDisabled(), true);
    await shot(p, 'donor-running');
    await p.getByRole('button', { name: 'Остановить AI', exact: true }).click();
    await p.waitForTimeout(1200);
    assert.equal(await p.getByLabel('Юмор и эмоция', { exact: true }).inputValue(), dna.humor);
    assert.equal(await p.getByLabel('Канал-донор / ссылка', { exact: true }).isEnabled(), true);
    const records = (await (await p.context().request.get(BASE + '/api/donor-workflow/snapshots')).json()).data;
    const saved = records.find(s => s.ready);
    assert.ok(saved);
    p.once('dialog', d => d.accept());
    await p.getByLabel('Открыть сохранённый снимок', { exact: true }).selectOption(saved.id);
    await p.getByRole('status').filter({ hasText: 'Снимок загружен' }).waitFor();
    await p.getByRole('button', { name: '04 Драматургия', exact: false }).click();
    await p.getByRole('button', { name: 'Открыть сценарист с брифом', exact: true }).waitFor();
    await p.getByRole('button', { name: 'Открыть сценарист с брифом', exact: true }).click({trial:true});
    assert.equal(await p.getByRole('button', { name: 'Открыть сценарист с брифом', exact: true }).isEnabled(), true);
    assert.match(await p.getByLabel('План истории — можно написать или исправить вручную', { exact: true }).inputValue(), /Герой хочет вложить/);
    await p.context().close();
});


const pairs = []; for(let left=1;left<=5;left++)for(let right=left+1;right<=5;right++)pairs.push({left,right,verdict:left===1&&right===2?'similar':'distinct',reason:'Сравнение цели, попытки и последствий. Проверьте конкретный конфликт перед выбором.'});
const ideasReport = {summary:'Тестовый отчёт: две темы требуют разведения конфликтов.',pairs,donor:Array.from({length:5},(_,i)=>({idea:i+1,verdict:'uncertain',reason:'Нужен более подробный разбор донора.'})),model:'mock-review',reviewedAt:'2026-01-01T00:00:00.000Z'};
test('donor reviews: ten-pair explicit report, mobile/light layout and stale report; no automatic calls', async()=>{
  for(const width of [1440,390]){
    const draft={...structuredClone(initial),ideas:Array.from({length:5},(_,i)=>({...idea(i+1),premise:'Отдельная бытовая ситуация '+['поломка машины','потеря работы','покупка жилья','свадьба друга','долгое обучение'][i]}))};
    const p=await page(width,draft);let calls=0;
    p.on('request',r=>{if(new URL(r.url()).pathname==='/api/donor-workflow/review-ideas'&&r.method()==='POST')calls++;});
    await p.goto(BASE+'/donor-workflow');await p.getByRole('button',{name:'02 Новые темы',exact:false}).click();
    await p.getByTestId('donor-ideas-review').waitFor();assert.equal(calls,0);
    await mock(p,'review-ideas',ideasReport);
    await p.getByRole('button',{name:'Проверить различия тем · AI',exact:true}).click();
    await p.getByText(ideasReport.summary,{exact:true}).waitFor();assert.equal(calls,1);
    await p.getByText('Все 10 пар тем',{exact:true}).click();
    const panel=p.getByTestId('donor-ideas-review');await panel.evaluate(el=>{el.scrollIntoView({block:'start'});window.scrollBy(0,-72);});await shot(p,'donor-ideas-review-'+width);
    if(width===390){await p.evaluate(()=>document.documentElement.classList.remove('dark'));await shot(p,'donor-ideas-review-light');}
    await p.getByLabel('Моя идея / направление',{exact:true}).fill('Изменённое направление');
    assert.equal(await p.getByText(ideasReport.summary,{exact:true}).count(),0);
    await p.context().close();
  }
});
async function seedScript(p){
  const req=async(path,data)=>(await (await p.context().request.post(BASE+'/api'+path,{data})).json()).data;
  const w={...structuredClone(initial),selected:idea(),research:{sources:[{id:'R1',title:'Тестовый источник',url:'',excerpt:'Тестовый текст о риске потери капитала и ограничении ликвидности.'}],facts:'R1: тестовая опора о риске потери капитала. Условные примеры не являются рыночной статистикой.',uncertain:'',reconstruction:'Условный герой',boundaries:''},outline:'Герой вкладывает резерв. Внезапно ломается машина. Он пытается продать актив, видит риск убытка R1 и раздражённо останавливается. Он понимает, зачем нужен резерв. Финал закрывается его реакцией, без вопроса для комментариев.'};
  Object.assign(w,await req('/donor-workflow/approve-dna',w));Object.assign(w,await req('/donor-workflow/approve-topic',w));w.outlineBasis=(await req('/donor-workflow/status',w)).keys.research;Object.assign(w,await req('/donor-workflow/approve-outline',w));
  const snap=await req('/donor-workflow/snapshots',w),brief=(await(await p.context().request.get(BASE+'/api/donor-workflow/snapshots/'+snap.id+'/brief')).json()).data;
  const project=await req('/projects',{title:'Тест проверки ДНК'});
  const script='Ты пытаешься продать актив. Но цена ниже, чем вчера. Ты убираешь телефон и наконец понимаешь, зачем нужен резерв.';
  const result={title:w.selected.title,script,plan:{title:w.selected.title,core_question:w.selected.premise,structure_id:'',hook_strikes:{},acts:[{name:'Утверждённая история',summary:w.outline,beats:[w.outline,'Сохранить развязку'],words:500}],open_loops:[],midroll_cta_line:'',ending_question:'',claims_to_verify:[],ctaAct:null},facts:null,check:{metrics:{words:22,chars:script.length,charsNoSpaces:90,minutes:0.2,sentences:3,avgSentence:7,questions:0,ctaPos:null,deviationPct:-95,paragraphs:1},errors:[],warnings:[],passed:true},input:brief,donorBrief:snap,targetWords:500,model:'mock',projectId:project.id,createdAt:new Date().toISOString()};
  const artifact=await req('/projects/'+project.id+'/artifacts',{kind:'script',title:result.title,data:result});return {...result,artifactId:artifact.id};
}
test('donor reviews: explicit script review never changes text; stale, failure, cancellation and mobile',async()=>{
  const p=await page();const result=await seedScript(p);let calls=0;
  p.on('request',r=>{if(new URL(r.url()).pathname==='/api/script/donor-review'&&r.method()==='POST')calls++;});
  await p.goto(BASE+'/script?projectId='+result.projectId+'&artifact='+result.artifactId);
  await p.getByTestId('donor-script-review').waitFor();assert.equal(calls,0);
  assert.equal(await p.getByText('Авто — подобрать под тему',{exact:true}).count(),0);
  const text=p.getByRole('textbox',{name:'Текст сценария',exact:true});assert.equal(await text.inputValue(),result.script);
  const report={summary:'Проверьте реакцию героя и качество источника.',script:result.script,sourceArtifactId:result.artifactId,scriptHash:'mock-hash',reviewedAt:'2026-01-01T00:00:00.000Z',model:'mock-review',findings:['outline','dna','causality','emotion','facts','originality'].map(criterion=>({criterion,verdict:'uncertain',quote:'Ты пытаешься продать актив.',comment:'Тестовая проверка не заменяет чтение автором и не переписывает сценарий.'}))};
  await p.route('**/api/script/donor-review',r=>r.fulfill({json:{ok:true,data:{jobId:'mock-review'}}}));
  await p.route('**/api/jobs/mock-review/stream',r=>r.fulfill({contentType:'text/event-stream',body:'event: done\ndata: '+JSON.stringify({data:report})+'\n\n'}));
  await p.getByRole('button',{name:'Проверить сценарий по ДНК · AI',exact:true}).click();
  await p.getByText(report.summary,{exact:true}).waitFor();assert.equal(calls,1);assert.equal(await text.inputValue(),result.script);
  await p.getByTestId('donor-script-review').scrollIntoViewIfNeeded();await shot(p,'donor-script-review-desktop');
  await p.setViewportSize({width:390,height:1000});await shot(p,'donor-script-review-mobile');await p.evaluate(()=>document.documentElement.classList.remove('dark'));await shot(p,'donor-script-review-light-mobile');await p.evaluate(()=>document.documentElement.classList.add('dark'));
  await text.fill(result.script+' Ты вздыхаешь.');await p.getByText('Текст изменён после проверки.',{exact:false}).waitFor();await p.getByText('Текст изменён после проверки.',{exact:false}).scrollIntoViewIfNeeded();await shot(p,'donor-script-review-stale');
  await p.route('**/api/script/donor-review',r=>r.fulfill({status:400,json:{ok:false,error:{code:'VALIDATION',message:'Тестовая ошибка проверки, сценарий сохранён'}}}));
  await p.getByRole('button',{name:'Проверить сценарий по ДНК · AI',exact:true}).click();await p.getByText('Тестовая ошибка проверки, сценарий сохранён',{exact:false}).waitFor();assert.equal(await text.inputValue(),result.script+' Ты вздыхаешь.');await p.getByText('Тестовая ошибка проверки, сценарий сохранён',{exact:false}).scrollIntoViewIfNeeded();await shot(p,'donor-script-review-error');
  await p.route('**/api/script/donor-review',r=>r.fulfill({json:{ok:true,data:{jobId:'mock-review-late'}}}));
  await p.route('**/api/jobs/mock-review-late/stream',async r=>{await new Promise(res=>setTimeout(res,1300));await r.fulfill({contentType:'text/event-stream',body:'event: done\ndata: '+JSON.stringify({data:{...report,summary:'Запоздалый отчёт'}})+'\n\n'}).catch(()=>{});});
  await p.route('**/api/jobs/mock-review-late/cancel',r=>r.fulfill({json:{ok:true,data:{}}}));
  await p.getByRole('button',{name:'Проверить сценарий по ДНК · AI',exact:true}).click();await p.getByRole('button',{name:'Остановить проверку',exact:true}).click();await p.waitForTimeout(1500);assert.equal(await p.getByText('Запоздалый отчёт',{exact:true}).count(),0);assert.equal(await text.inputValue(),result.script+' Ты вздыхаешь.');await p.context().close();
});
