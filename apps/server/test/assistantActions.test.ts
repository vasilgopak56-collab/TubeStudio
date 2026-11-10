// Помощник по всей программе, шаг 1: бесплатная справка, ориентир цены и действия только на чтение.
// Сети и платных запросов нет: у каждого теста своя пустая папка данных и нет ключей.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ASSISTANT_PAGES,assistantHelpAnswer,assistantQuote,runAssistantAction} from '../src/services/assistantActions.js';
import {AssistantOutput} from '../src/services/assistant.js';
import {createProject,getProject} from '../src/services/projects.js';

test('справка знает страницы Монтаж, Публикация и Shorts',()=>{
 for(const r of ['/studio/montage','/studio/publish','/studio/shorts'])assert.ok(ASSISTANT_PAGES.has(r),r);
});

test('бесплатный ответ: раздел текущей страницы первым, по словам находятся другие разделы',()=>{
 assert.equal(assistantHelpAnswer({query:'',currentPath:'/studio/shorts'}).sections[0]?.id,'studio-shorts');
 const r=assistantHelpAnswer({query:'монтаж',currentPath:'/'});
 assert.ok(r.sections.some(s=>s.id==='studio-montage'));
 assert.ok(r.sections.length<=3);
 assert.ok(r.sections.every(s=>Array.isArray(s.steps)&&typeof s.cost==='string'));
});

test('действие без подтверждения или не из списка не выполняется',async()=>{
 await assert.rejects(runAssistantAction({action:{kind:'open-page',route:'/studio/shorts'}}),/не подтверждено/);
 await assert.rejects(runAssistantAction({action:{kind:'publish-seo',projectId:crypto.randomUUID()},confirmed:true}),/нет в списке/);
 await assert.rejects(runAssistantAction({action:{kind:'montage-check',projectId:crypto.randomUUID(),extra:1},confirmed:true}),/нет в списке/);
});

test('открыть можно только страницу из справки',async()=>{
 await assert.rejects(runAssistantAction({action:{kind:'open-page',route:'/studio/unknown'},confirmed:true}),/нет в справке/);
 assert.deepEqual(await runAssistantAction({action:{kind:'open-page',route:'/studio/shorts'},confirmed:true}),{kind:'open-page',title:'Открыть страницу',ok:true,navigate:'/studio/shorts',lines:[]});
});

test('проверки только читают: проект без раскадровки не меняется',async()=>{
 const p=await createProject({title:'Проверка Помощника'}),before=JSON.stringify(await getProject(p.id));
 const m=await runAssistantAction({action:{kind:'montage-check',projectId:p.id},confirmed:true});
 assert.equal(m.ok,false);
 assert.equal(m.lines[0]?.message,'Сборку начинать нельзя.');
 assert.ok(m.lines.some(l=>l.level==='block'&&/Раскадровки нет/.test(l.message)));
 const c=await runAssistantAction({action:{kind:'publish-readiness',projectId:p.id},confirmed:true});
 assert.equal(c.ok,false);
 assert.equal(c.lines[0]?.message,'Карточка не готова.');
 assert.equal(JSON.stringify(await getProject(p.id)),before);
});

test('ориентир цены: для совместимого подключения цена неизвестна, без ключей ошибки нет',async()=>{
 assert.equal(await assistantQuote({provider:'compatible',model:'x'},1000,4000),null);
 const v=await assistantQuote({provider:'anymodel',model:'unknown-model'},1000,4000);
 assert.ok(v===null||typeof v==='number');
});

test('неизвестное предложение модели не губит ответ: проверка списка — при выполнении',()=>{
 const base={reply:'Ответ',brief:'',questions:[],steps:[],deliverable:''};
 assert.ok(AssistantOutput.safeParse({...base,action:{kind:'delete-everything'}}).success);
 assert.ok(AssistantOutput.safeParse({...base,action:{kind:'open-page',route:'/studio/montage'}}).success);
 assert.equal(AssistantOutput.safeParse({...base,action:{kind:'open-page',route:'/x',projectId:'y'}}).success,false);
});
