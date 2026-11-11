// Пустой ответ AnyModel: в журнал пишется только устройство ответа, без текста. Сети нет.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-amempty-'));
process.env.DATA_DIR=dir;process.env.ENV_FILE=dir+'/absent.env';
const {answerShape}=await import('../src/services/anymodel.js');

test('устройство пустого ответа: поля, длины и токены видны, текста нет',()=>{
 const secret='SECRET-REASONING-TEXT';
 const shape=answerShape({id:'x',choices:[{index:0,message:{role:'assistant',content:null,reasoning_content:secret,refusal:null}}],usage:{prompt_tokens:4754,completion_tokens:7183,completion_tokens_details:{reasoning_tokens:7183}}});
 const s=JSON.stringify(shape);
 assert.ok(!s.includes(secret),'текст ответа не попадает в журнал');
 assert.equal(shape.finish,null);
 assert.deepEqual(shape.content,{type:'null',length:undefined,parts:undefined});
 assert.deepEqual((shape.fields as any).reasoning_content,{type:'string',length:secret.length});
 assert.equal((shape.usage as any).completion_tokens,7183);
 assert.equal((shape.completionDetails as any).reasoning_tokens,7183);
});

test('части ответа: видны типы и длины, не текст',()=>{
 const shape=answerShape({choices:[{finish_reason:'stop',message:{content:[{type:'reasoning',summary:'hidden'},{type:'output_text',text:'hello'}]}}]});
 assert.equal(shape.finish,'stop');
 assert.deepEqual(shape.content.parts,[{type:'reasoning',keys:['type','summary'],text:undefined},{type:'output_text',keys:['type','text'],text:5}]);
 assert.ok(!JSON.stringify(shape).includes('hidden')&&!JSON.stringify(shape).includes('hello'));
});

test('странный ответ не ломает запись',()=>{
 assert.doesNotThrow(()=>answerShape(null));
 assert.doesNotThrow(()=>answerShape({choices:'oops'}));
});
