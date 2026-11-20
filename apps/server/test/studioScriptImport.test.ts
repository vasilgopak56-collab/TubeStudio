// «Сохранить в ролик»: свой текст становится сценарием ролика. Без сети и платных запросов, данные во временной папке.
import {before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {dataPath} from '../src/lib/storage.js';
import {createChannel} from '../src/services/studio/channels.js';
import {importStudioScript} from '../src/services/studio/scriptFlow.js';
import {getProject} from '../src/services/projects.js';

const id='22222222-3333-4444-8555-666666666666',old='2026-01-01T00:00:00.000Z';
const text='Minus thirty-five Fahrenheit. Rifles jammed.\n\nThe way out was a frozen mountain road. '.repeat(5);
let channelId='',otherId='';

async function seed(extra:Record<string,unknown>={}){
 await fs.mkdir(dataPath('projects'),{recursive:true});
 await fs.writeFile(dataPath('projects',`${id}.json`),JSON.stringify({id,title:'Chosin',createdAt:old,updatedAt:old,artifacts:[{id:'a1',kind:'script',title:'old',createdAt:old,data:{script:'Old text. '.repeat(10)}}],...extra}));
}
before(async()=>{channelId=(await createChannel({name:'Test',niche:'history',language:'en'})).id;otherId=(await createChannel({name:'Other',niche:'history',language:'en'})).id;});
beforeEach(()=>seed());

test('текст сохраняется новым сценарием ролика, прежний остаётся, ролик привязан к каналу',async()=>{
 const r=await importStudioScript({channelId,projectId:id,script:`  ${text}  `});
 const p=await getProject(id);
 assert.equal(p.channelId,channelId);
 const scripts=p.artifacts.filter(a=>a.kind==='script');
 assert.equal(scripts.length,2);
 assert.equal(scripts[0].id,'a1');
 const last=scripts[1] as {id:string;data:{script:string;studio:{channelId:string;imported:boolean;lint:unknown;factCheck:unknown}}};
 assert.equal(last.id,r.artifactId);
 assert.equal(last.data.script,text.trim());
 assert.equal(last.data.studio.channelId,channelId);
 assert.equal(last.data.studio.imported,true);
 assert.equal(last.data.studio.factCheck,null);
 assert.ok(last.data.studio.lint);
 assert.deepEqual(r.lint,last.data.studio.lint);
});

test('пустой или короткий текст, лишнее поле и ролик другого канала не принимаются',async()=>{
 await assert.rejects(importStudioScript({channelId,projectId:id,script:'   '}),/слишком короткий/);
 await assert.rejects(importStudioScript({channelId,projectId:id,script:'short'}),/слишком короткий/);
 await assert.rejects(importStudioScript({channelId,projectId:id,script:text,extra:1}));
 await seed({channelId:otherId});
 await assert.rejects(importStudioScript({channelId,projectId:id,script:text}),/другому каналу/);
 const p=await getProject(id);
 assert.equal(p.artifacts.length,1);
});

test('несуществующий ролик или канал — ошибка, ничего не создаётся',async()=>{
 await assert.rejects(importStudioScript({channelId,projectId:'33333333-4444-4555-8666-777777777777',script:text}));
 await assert.rejects(importStudioScript({channelId:'44444444-5555-4666-8777-888888888888',projectId:id,script:text}));
 assert.equal((await getProject(id)).artifacts.length,1);
});
