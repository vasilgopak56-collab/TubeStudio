import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-donor-test-'));
process.env.DATA_DIR = dir;
const svc = await import('../src/services/donorWorkflow.js');
const { config } = await import('../src/config.js');
const { donorWorkflowRoute } = await import('../src/routes/donorWorkflow.js');
const { auth, requireAuth, extToken } = await import('../src/routes/auth.js');
const { getJob } = await import('../src/lib/jobs.js');
const { ScriptInput, runScript } = await import('../src/services/script.js');
const { exportBackup } = await import('../src/services/backup.js');
const { unzipSync } = await import('fflate');
const { PROMPTS_DIR } = await import('../src/services/prompts.js');
const ctx = { signal: new AbortController().signal, progress: () => { }, partial: () => { } };
after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
const idea = (n = 1) => ({ title: `Ловушка первого инвестора ${n}`, premise: 'Герой вкладывает резерв и сталкивается с неожиданным срочным расходом.', difference: 'Новая проблема ликвидности вместо объяснения банковских комиссий донора.', conflict: 'Нужны наличные, но для продажи придётся зафиксировать убыток.', payoff: 'Герой различает долгосрочные вложения и резерв на бытовые расходы.', questions: ['Как работает ликвидность?', 'Что источник говорит о волатильности?'] });
function work(): svc.DonorWork { return svc.Work.parse({ name: 'ДНК инвестирования', channel: 'Тестовый канал', refs: [{ title: 'Как устроены банковские комиссии', url: 'https://www.youtube.com/watch?v=abcdefghijk', transcript: 'Герой пытается перевести деньги и сталкивается с комиссией. '.repeat(8) }], notebookAnalysis: '', dna: Object.fromEntries(['audience', 'promise', 'hooks', 'pov', 'pacing', 'stakes', 'explanation', 'humor', 'endings', 'avoid', 'evidence'].map(k => [k, 'Конкретная наблюдаемая техника; ref 1; вывод по ролику, не по всему каналу.'])), dnaApproval: '', mode: 'own', direction: 'Инвестирование', ideas: [], selected: idea(), topicApproval: '', research: { sources: [{ id: 'R1', title: 'Регулятор: риски вложений', url: 'https://example.org/risk', excerpt: 'Учебная тестовая выдержка: вложения связаны с риском потери капитала.' }], facts: 'Риск потери капитала и ликвидность — фактическая опора R1. Условные суммы не являются рыночной статистикой.', uncertain: 'Реальные доходности не установлены.', reconstruction: 'Условный безымянный инвестор; бытовая комедийная сцена.', boundaries: 'Без обещаний доходности и персональных рекомендаций.' }, outline: 'Герой хочет вложить деньги. Препятствие — срочный расход. Он пытается продать актив. Последствие — возможный убыток R1. Реакция — досада. Объяснение — риск и ликвидность. Все бытовые действия героя условные. Финал закрывает начальный вопрос.', outlineBasis: '', outlineApproval: '', language: 'ru', words: 300 }); }
function ready() { const w = work(); w.dnaApproval = svc.dnaKey(w); w.topicApproval = svc.topicKey(w); w.outlineBasis = svc.researchKey(w); w.outlineApproval = svc.outlineKey(w); return w; }
test('donor: gates bind approvals to evidence, topic, research, language and length', () => {
    const w = ready();
    assert.equal(svc.status(w).ready, true);
    for (const mutate of [(w: svc.DonorWork) => w.refs[0].transcript += 'changed', (w: svc.DonorWork) => w.dna.humor += 'changed', (w: svc.DonorWork) => w.direction += 'changed', (w: svc.DonorWork) => w.selected!.title += 'changed', (w: svc.DonorWork) => w.research.facts += 'changed', (w: svc.DonorWork) => w.language = 'en', (w: svc.DonorWork) => w.words = 500, (w: svc.DonorWork) => w.outline += 'changed']) {
        const copy = structuredClone(w);
        mutate(copy);
        assert.equal(svc.status(copy).ready, false);
        assert.throws(() => svc.requireReady(copy));
    }
    assert.equal(svc.status(work()).dna, false);
});
test('donor: manual own topic path and evidence map validation', () => {
    const w = ready();
    w.ideas = [];
    svc.requireReady(w);
    w.research.facts = ' '.repeat(70);
    assert.throws(() => svc.requireResearch(w));
    w.research.facts = 'Текст исследования R99. '.repeat(5);
    assert.throws(() => svc.requireResearch(w));
    w.research.facts = 'Исследование R1. '.repeat(6);
    w.research.sources.push(w.research.sources[0]);
    assert.throws(() => svc.requireResearch(w));
    w.research.sources.pop();
    w.research.sources[0].excerpt = '';
    assert.throws(() => svc.requireResearch(w));
    const bad = ready();
    bad.selected!.questions = ['один'];
    bad.topicApproval = svc.topicKey(bad);
    assert.throws(() => svc.requireTopic(bad));
});
test('donor: exact titles, duplicates and twelve-word copied fragments rejected, not a plagiarism certificate', () => {
    const w = work();
    assert.throws(() => svc.validateOriginality(w, [{ ...idea(), title: w.refs[0].title }]));
    assert.throws(() => svc.validateOriginality(w, [idea(), idea()]));
    const text = 'один два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать тринадцать';
    w.refs[0].transcript = text;
    assert.throws(() => svc.validateOriginality(w, [{ ...idea(), premise: text }]));
    svc.validateOriginality(w, [idea()]);
});
test('donor: incomplete drafts can be saved and notebook prompts target new topic, not a copied story', async () => {
    const w = work();
    w.research.sources = [{ id: 'R1', title: '', url: '', excerpt: '' }];
    w.selected = { title: '', premise: '', difference: '', conflict: '', payoff: '', questions: [] };
    w.dna.humor = '';
    const r = await svc.saveDonorWork(w);
    assert.equal((await svc.loadDonorWork(r.id)).research.sources[0].title, '');
    await svc.deleteDonorWork(r.id);
    const p = svc.notebookPrompts(ready());
    assert.match(p.research, /Ловушка первого инвестора/);
    assert.match(p.research, /R1/);
    assert.match(p.analysis, /не подтверждение загрузки/);
    assert.throws(() => svc.Work.parse({ ...work(), refs: [{ title: '', url: 'javascript:alert(1)', transcript: '' }] }));
    assert.throws(() => svc.Work.parse({ ...work(), refs: Array(6).fill(work().refs[0]) }));
});
test('donor: URLs alone, missing approvals and cancellation never call a provider', async () => {
    const original = globalThis.fetch;
    let count = 0;
    globalThis.fetch = async () => { count++; throw Error('must not fetch'); };
    try {
        const w = work();
        w.refs[0].transcript = '';
        await assert.rejects(() => svc.analyzeDNA(w, ctx));
        await assert.rejects(() => svc.generateIdeas(work(), ctx));
        await assert.rejects(() => svc.generateOutline(work(), ctx));
        const abort = new AbortController();
        abort.abort();
        await assert.rejects(() => svc.generateIdeas(ready(), { ...ctx, signal: abort.signal }));
        assert.equal(count, 0);
    }
    finally {
        globalThis.fetch = original;
    }
});
test('donor: immutable snapshots, concurrent saves, original source retained and full backup', async () => {
    const w = ready();
    const [a, b] = await Promise.all([svc.saveDonorWork(w), svc.saveDonorWork({ ...w, name: 'Другая версия' })]);
    assert.notEqual(a.id, b.id);
    w.dna.humor = 'changed locally';
    assert.notEqual((await svc.loadDonorWork(a.id)).dna.humor, w.dna.humor);
    const brief = await svc.donorBrief(a.id);
    assert.equal(brief.humanize, false);
    assert.equal(brief.research, false);
    assert.equal(brief.channelVoice, false);
    const context = await svc.donorContext(a.id);
    assert.match(context, /ORIGINAL IMMERSIVE/);
    assert.match(context, /R1/);
    assert.ok(!context.includes('Герой пытается перевести деньги'));
    assert.match(context, /frozen camera/i);
    const zip = unzipSync(await exportBackup({ dataDir: dir, promptsDir: PROMPTS_DIR }));
    assert.ok(zip['donor-workflows.json']);
    const backed = JSON.parse(new TextDecoder().decode(zip['donor-workflows.json']));
    assert.ok(backed.records.some((r: any) => r.id === a.id));
    await svc.deleteDonorWork(b.id);
    assert.ok((await svc.listDonorWorks()).some(r => r.id === a.id));
});
test('donor: corrupt or symlinked store fails closed without overwriting', async () => {
    const filename = path.join(dir, 'donor-workflows.json'), original = await fs.readFile(filename);
    await fs.writeFile(filename, '{broken');
    await assert.rejects(() => svc.saveDonorWork(ready()), { code: 'DONOR_STORE' });
    assert.equal(await fs.readFile(filename, 'utf8'), '{broken');
    await fs.unlink(filename);
    const target = path.join(dir, 'test-source.json');
    await fs.writeFile(target, original);
    await fs.symlink(target, filename);
    await assert.rejects(() => svc.saveDonorWork(ready()), { code: 'DONOR_STORE' });
    assert.deepEqual(await fs.readFile(target), original);
    await fs.unlink(filename);
    await fs.writeFile(filename, original);
});
test('donor: authenticated HTTP approvals/save/brief; extension denied; malformed/oversized rejected', async () => {
    const old = config.password;
    config.password = 'test-donor-password';
    const app = new Hono();
    app.use('/api/*', requireAuth);
    app.route('/api', auth);
    app.route('/api', donorWorkflowRoute);
    const req = (p: string, body?: unknown, cookie?: string) => app.request('/api/donor-workflow/' + p, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    try {
        assert.equal((await req('snapshots')).status, 401);
        assert.equal((await app.request('/api/donor-workflow/snapshots', { headers: { 'x-ts-token': extToken() } })).status, 403);
        const login = await app.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: config.password }), headers: { 'content-type': 'application/json' } }), cookie = login.headers.get('set-cookie')!.split(';')[0];
        const w = work();
        for (const stage of ['dna', 'topic']) {
            const response = await req('approve-' + stage, w, cookie);
            assert.equal(response.status, 200);
            Object.assign(w, (await response.json() as any).data);
        }
        w.outlineBasis = svc.researchKey(w);
        const approved = await req('approve-outline', w, cookie);
        assert.equal(approved.status, 200);
        Object.assign(w, (await approved.json() as any).data);
        const saved = await req('snapshots', w, cookie);
        assert.equal(saved.status, 200);
        const r = (await saved.json() as any).data;
        assert.equal((await req(`snapshots/${r.id}/brief`, undefined, cookie)).status, 200);
        const bad = await app.request('/api/donor-workflow/status', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{broken' });
        assert.ok(bad.status >= 400);
        const large = await req('status', { padding: 'x'.repeat(1500100) }, cookie);
        assert.equal(large.status, 413);
        assert.ok((await req('snapshots/../../secret', undefined, cookie)).status >= 400);
    }
    finally {
        config.password = old;
    }
});
test('donor: mocked AI returns exactly five new topics, honors own direction; no auto-repair calls', async () => {
    const oldFetch = globalThis.fetch, keys = { ...config.keys };
    Object.assign(config.keys, { anthropic: 'test-only', gemini: '', anymodel: '' });
    let requests: any[] = [];
    globalThis.fetch = async (_u, init) => { requests.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ ideas: Array.from({ length: 5 }, (_, i) => ({...idea(i+1), premise: ["Герой вложил резерв и не может оплатить неожиданную поломку автомобиля.","Новичок покупает один популярный актив и зависит от судьбы единственной компании.","Человек доверяет обещанию гарантированной прибыли и разбирается в признаках мошенничества.","Друзья спорят о комиссиях брокера и сравнивают итоговые расходы на длинном горизонте.","Сотрудник откладывает начало накоплений и видит цену потраченного времени."][i]})) }) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }); };
    try {
        const result = await svc.generateIdeas(ready(), ctx);
        assert.equal(result.ideas.length, 5);
        assert.match(requests[0].messages[0].content, /Инвестирование/);
        assert.match(requests[0].system[0].text, /EXACT|exactly five/i);
        assert.equal(requests.length, 1);
        globalThis.fetch = async () => { requests.push({}); return new Response(JSON.stringify({ content: [{ type: 'text', text: 'invalid' }], usage: { input_tokens: 1, output_tokens: 1 } })); };
        await assert.rejects(() => svc.generateIdeas(ready(), ctx));
        assert.equal(requests.length, 2);
    }
    finally {
        globalThis.fetch = oldFetch;
        Object.assign(config.keys, keys);
    }
});
test('donor: script resolves approved full context before providers; mismatched topic/length rejected', async () => {
    const record = await svc.saveDonorWork(ready());
    const brief = await svc.donorBrief(record.id), input = ScriptInput.parse(brief);
    const orig = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw Error('provider forbidden'); };
    try {
        await assert.rejects(() => runScript({ ...input, topic: 'Несогласованная тема' }, ctx), { status: 409 });
        await assert.rejects(() => runScript({ ...input, value: 500 }, ctx), { status: 409 });
        assert.equal(calls, 0);
        const old = ScriptInput.parse({ topic: 'Old workflow' });
        assert.equal(old.donorBriefId, undefined);
        assert.equal(old.humanize, true);
        assert.equal(old.research, true);
    }
    finally {
        globalThis.fetch = orig;
    }
});
test('donor: writing pipeline gets untruncated research and stores full source snapshot, not dry rewrites', async () => {
    const w = ready();
    w.words = 150;
    w.research.facts = 'R1: Фактическая опора. ' + 'подтверждение '.repeat(700) + 'SENTINEL_AFTER_6000';
    w.outlineBasis = svc.researchKey(w);
    w.outlineApproval = svc.outlineKey(w);
    const snap = await svc.saveDonorWork(w), input = ScriptInput.parse(await svc.donorBrief(snap.id));
    const oldFetch = globalThis.fetch, keys = { ...config.keys };
    Object.assign(config.keys, { anthropic: 'test-only', gemini: '', anymodel: '' });
    const calls: any[] = [];
    globalThis.fetch = async (_url, init) => { const body = JSON.parse(String(init?.body)); calls.push(body); const result = '<script>' + ('Ты берёшь монету. '.repeat(50)) + '</script>'; return new Response(JSON.stringify({ content: [{ type: 'text', text: result }], usage: { input_tokens: 1, output_tokens: 1 } })); };
    try {
        const result = await runScript(input, ctx);
        assert.equal(calls.length, 1, "approved outline is not replanned");
        assert.equal(result.plan.acts[0].summary, w.outline);
        assert.equal(result.plan.structure_id, "");
        assert.equal(result.plan.ending_question, "");
        assert.ok(!result.check.errors.some(e => e.includes("вопроса для комментариев")));
        assert.ok(!calls[0].system[0].text.includes("TEN LAWS"));
        assert.ok(!calls[0].system[0].text.includes("LIVE VOICE"));
        assert.ok(!calls[0].messages[0].content.includes("Three strikes"));
        for (const c of calls) {
            assert.match(c.system[0].text, /SENTINEL_AFTER_6000/);
            assert.match(c.system[0].text, /FACT CHECK IS NOT A STYLE REWRITE/);
            assert.match(c.system[0].text, /Camera zoom\/pan is support/);
            assert.ok(!c.system[0].text.includes(w.refs[0].transcript));
        }
        assert.equal(result.donorBrief?.id, snap.id);
        assert.equal(result.donorBrief?.research.facts, w.research.facts);
        assert.equal(result.facts, null);
        assert.equal(result.voice, undefined);
        assert.ok(!result.script.includes('R1'));
        const project = await fs.readFile(path.join(dir, 'projects', result.projectId + '.json'), 'utf8');
        assert.match(project, /SENTINEL_AFTER_6000/);
    }
    finally {
        globalThis.fetch = oldFetch;
        Object.assign(config.keys, keys);
    }
});


test('donor: same story under renamed titles is rejected; old checker keeps standard ending rules', async () => {
    const w = ready();
    assert.throws(() => svc.validateOriginality(w, [idea(1), idea(2)]), /одну и ту же историю/);
    const {checkScript} = await import('../src/services/scriptCheck.js');
    assert.ok(checkScript('Герой закрыл дверь. Наконец он понял цену своей ошибки.', {language:'ru',cta:false}).errors.includes('В финале нет вопроса для комментариев'));
    assert.ok(!checkScript('Герой закрыл дверь. Наконец он понял цену своей ошибки.', {language:'ru',cta:false,profile:'donor'}).errors.includes('В финале нет вопроса для комментариев'));
});

test('donor: protected mode rejects added transforms before provider; legacy tone does not override DNA', async () => {
    const snap = await svc.saveDonorWork(ready());
    const input = ScriptInput.parse(await svc.donorBrief(snap.id));
    for(const flag of ['research','humanize','channelVoice','cta','headings','visualCues'] as const) await assert.rejects(()=>runScript({...input,[flag]:true},ctx), /дополнительные преобразования/);
    await assert.rejects(()=>runScript({...input,structure:'S1'},ctx), /дополнительные преобразования/);
    assert.equal(input.tone,'custom');
});

test('donor: explicit idea review covers all ten pairs and five donors; incomplete model report rejected', async () => {
    const {reviewIdeas} = await import('../src/services/donorReview.js');
    const w=ready(); w.ideas=Array.from({length:5},(_,i)=>({...idea(i+1),premise:'Разный конфликт с уникальной бытовой ситуацией '+['машина','работа','отпуск','школа','переезд'][i]}));
    const oldFetch=globalThis.fetch,keys={...config.keys};
    Object.assign(config.keys,{anthropic:'test-only',gemini:'',anymodel:''});
    const pairs:any[]=[];for(let left=1;left<=5;left++)for(let right=left+1;right<=5;right++)pairs.push({left,right,verdict:'uncertain',reason:'Нужна проверка различия причин и последствий.'});
    const report={summary:'Это мнение модели, не сертификат.',pairs,donor:Array.from({length:5},(_,i)=>({idea:i+1,verdict:'uncertain',reason:'Недостаточно референсов.'}))};
    let calls=0;
    globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({content:[{type:'text',text:JSON.stringify(report)}],usage:{input_tokens:1,output_tokens:1}}));};
    try{
        const out=await reviewIdeas(w,ctx);assert.equal(out.pairs.length,10);assert.equal(calls,1);
        report.pairs[9]=report.pairs[0];await assert.rejects(()=>reviewIdeas(w,ctx), /не сравнила все пары/);assert.equal(calls,2);
        const cancelled={...ctx,signal:AbortSignal.abort()};await assert.rejects(()=>reviewIdeas(w,cancelled));assert.equal(calls,2);
    }finally{globalThis.fetch=oldFetch;Object.assign(config.keys,keys);}
});

test('donor: final review pins edited text and source snapshot, survives deleted route, never rewrites', async () => {
    const {reviewDonorScript,reviewHash} = await import('../src/services/donorReview.js');
    const {createProject,addArtifact,getProject} = await import('../src/services/projects.js');
    const project=await createProject({title:'Проверка'}),snap=await svc.saveDonorWork(ready());
    const script='Ты пытаешься продать актив. Неожиданная комиссия заставляет тебя остановиться.';
    const artifact=await addArtifact(project.id,{kind:'script',title:'История',data:{script:'Original unchanged',donorBrief:snap}});
    await svc.deleteDonorWork(snap.id);
    const findings=['outline','dna','causality','emotion','facts','originality'].map(criterion=>({criterion,verdict:'uncertain',quote:'Ты пытаешься продать актив.',comment:'Проверьте причинность и опору; текст не переписывается.'}));
    const report={summary:'Нужна проверка автора.',findings};
    const oldFetch=globalThis.fetch,keys={...config.keys};Object.assign(config.keys,{anthropic:'test-only',gemini:'',anymodel:''});let calls=0;
    globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({content:[{type:'text',text:JSON.stringify(report)}],usage:{input_tokens:1,output_tokens:1}}));};
    try{
        const out=await reviewDonorScript({projectId:project.id,artifactId:artifact.id,script},ctx);
        assert.equal(out.scriptHash,reviewHash(script));assert.equal(out.script,script);assert.equal(out.sourceArtifactId,artifact.id);
        const stored=await getProject(project.id);assert.equal((stored.artifacts[0].data as any).script,'Original unchanged');assert.equal(stored.artifacts.filter(a=>a.kind==='check').length,1);
        findings[0].quote='В тексте нет этой цитаты';await assert.rejects(()=>reviewDonorScript({projectId:project.id,artifactId:artifact.id,script},ctx), /неточную цитату/);
        assert.equal((await getProject(project.id)).artifacts.filter(a=>a.kind==='check').length,1);
        await assert.rejects(()=>reviewDonorScript({projectId:project.id,artifactId:artifact.id,script},{...ctx,signal:AbortSignal.abort()}));assert.equal(calls,2);
    }finally{globalThis.fetch=oldFetch;Object.assign(config.keys,keys);}
});

test('donor: length correction retains locked outline and payoff, never forces a closing question', async () => {
    const w=ready();w.words=150;w.outlineBasis=svc.researchKey(w);w.outlineApproval=svc.outlineKey(w);
    const snap=await svc.saveDonorWork(w),input=ScriptInput.parse(await svc.donorBrief(snap.id));
    const oldFetch=globalThis.fetch,keys={...config.keys};Object.assign(config.keys,{anthropic:'test-only',gemini:'',anymodel:''});
    const calls:any[]=[];
    globalThis.fetch=async(_url,init)=>{calls.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({content:[{type:'text',text:'<script>'+('Ты берёшь монету. '.repeat(calls.length===1?100:50))+'</script>'}],usage:{input_tokens:1,output_tokens:1}}));};
    try{
        const result=await runScript(input,ctx);assert.equal(calls.length,2);
        assert.match(calls[1].system[0].text,/event order.*LOCKED/);
        assert.ok(calls[1].system[0].text.includes(w.outline));
        assert.match(calls[1].messages[0].content,/Preserve the approved payoff and event order/);
        assert.ok(!calls[1].messages[0].content.includes('Keep the closing question'));
        assert.equal(result.plan.acts[0].summary,w.outline);assert.equal(result.check.metrics.words,150);
    }finally{globalThis.fetch=oldFetch;Object.assign(config.keys,keys);}
});
