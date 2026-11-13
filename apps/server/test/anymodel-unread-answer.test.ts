// Недочитанный ответ AnyModel (время вышло, обрыв, испорченный текст) — не «пустой ответ»:
// запрос мог быть оплачен, поэтому нет ни повтора, ни другой модели. Поддельный сервер на 127.0.0.1, настоящих ключей и сети нет.
import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import http from 'node:http';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-amunread-'));
type Mode='slow'|'broken'|'garbage'|'empty'|'ok'|'hang';
let mode:Mode='ok';let chats:string[]=[];let headersSent!:()=>void;
const server=http.createServer((q,r)=>{let body='';q.on('data',c=>body+=c);q.on('end',()=>{
 if(q.url?.endsWith('/models')){r.writeHead(200,{'content-type':'application/json'});r.end(JSON.stringify({data:[{id:'same',billing:{unit:'token',coefficient:{input:1,output:1}}},{id:'alt',billing:{unit:'token',coefficient:{input:1,output:1}}}]}));return;}
 chats.push(JSON.parse(body).model);
 r.writeHead(200,{'content-type':'application/json'});r.flushHeaders();headersSent?.();
 if(mode==='slow')setTimeout(()=>{if(!r.destroyed)r.end(JSON.stringify({choices:[{message:{content:'late'}}]}));},1500);
 else if(mode==='broken'){r.write('{"choices":[{"mess');setTimeout(()=>r.destroy(),50);}
 else if(mode==='garbage')r.end('<html>oops</html>');
 else if(mode==='empty')r.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:null}}],usage:{prompt_tokens:5,completion_tokens:7}}));
 else if(mode==='hang')setTimeout(()=>{if(!r.destroyed)r.end('{}');},3000);
 else r.end(JSON.stringify({choices:[{message:{content:'answer'}}],usage:{prompt_tokens:5,completion_tokens:7}}));
});});
await new Promise<void>(res=>server.listen(0,'127.0.0.1',()=>res()));
const port=(server.address() as {port:number}).port;
// Только AnyModel и только поддельный сервер: прямых ключей нет, резервная модель тоже уходила бы сюда и была бы видна в chats.
process.env.DATA_DIR=dir;process.env.ENV_FILE=dir+'/absent.env';process.env.ANYMODEL_API_KEY='fake-local-only';process.env.ANYMODEL_BASE_URL=`http://127.0.0.1:${port}/v1`;
for(const k of ['ANTHROPIC_API_KEY','GEMINI_API_KEY','OPENAI_API_KEY'])delete process.env[k];
const {updateSettings}=await import('../src/services/settings.js');
const {amCatalog,resetAmCatalog,amChat}=await import('../src/services/anymodel.js');
const {generateText}=await import('../src/services/llm.js');
const {getUsage}=await import('../src/services/usage.js');
const {runTask}=await import('../src/lib/taskContext.js');
before(async()=>{await updateSettings({budget:{monthlyUsd:100,mode:'block',warnPct:80,prices:[{match:'same',input:1,output:1},{match:'alt',input:1,output:1}]},anymodel:{enabled:true,priority:'first',text:'same',textAlt:'alt',fast:'same',image:'same',imageAlt:'alt',usdPerMillion:.05}});});
beforeEach(async()=>{chats=[];mode='ok';await fs.rm(dir+'/usage.json',{force:true,recursive:true});resetAmCatalog();await amCatalog();});
after(async()=>{server.closeAllConnections();server.close();const {flushLogs}=await import('../src/lib/logging.js');await flushLogs();await fs.rm(dir,{force:true,recursive:true});});
const uncertain=(re:RegExp)=>(e:any)=>{assert.equal(e.code,'UPSTREAM');assert.equal(e.retryable,false);assert.equal(e.details?.uncertain,true);assert.match(e.message,re);assert.match(e.message,/мог выполниться и быть оплачен/);assert.doesNotMatch(e.message,/пустой ответ/);return true;};

test('ответ пришёл позже времени ожидания: «не дождались», без повтора и без другой модели',async()=>{
 mode='slow';
 await assert.rejects(generateText({system:'',user:'',timeoutMs:300}),uncertain(/ответ не дождались за 0 мин/));
 assert.deepEqual(chats,['same'],'ровно один запрос, к модели alt не уходило');
 const u=await getUsage();assert.equal(u.cost.recordedOperations,1,'попытка записана в расход как неизвестная');assert.equal(u.cost.complete,false);
});
test('время ожидания из вызова доходит до AnyModel: при достаточном сроке медленный ответ принимается',async()=>{
 mode='slow';
 const r=await generateText({system:'',user:'',timeoutMs:5000});
 assert.equal(r.text,'late');assert.deepEqual(chats,['same']);
});
test('ответ оборвался посередине: «оборвался», мог быть оплачен',async()=>{
 mode='broken';
 await assert.rejects(amChat({model:'same',system:'',user:''}),uncertain(/ответ оборвался при получении/));
 assert.deepEqual(chats,['same']);
});
test('испорченный ответ (не JSON) при статусе 200: мог быть оплачен, другой модели нет',async()=>{
 mode='garbage';
 await assert.rejects(generateText({system:'',user:''}),uncertain(/ответ пришёл испорченным/));
 assert.deepEqual(chats,['same']);
});
test('настоящий пустой ответ (прочитан, текста нет) по-прежнему называется пустым',async()=>{
 mode='empty';
 await assert.rejects(amChat({model:'same',system:'',user:''}),(e:any)=>/пустой ответ \(stop\)/.test(e.message));
});
test('отмена задачи во время чтения ответа — обычная отмена, не «не дождались»',async()=>{
 mode='hang';const c=new AbortController();const sent=new Promise<void>(r=>headersSent=r);
 const run=runTask({signal:c.signal},()=>amChat({model:'same',system:'',user:''}));
 await sent;await new Promise(r=>setTimeout(r,50));c.abort();
 await assert.rejects(run,(e:any)=>e.code==='CANCELLED');
});
test('обычный ответ не изменился',async()=>{
 const r=await amChat({model:'same',system:'',user:''});assert.equal(r.text,'answer');assert.equal(r.usage.output,7);
});
test('платная модель ждёт ответ 15 минут; в коде нет других сроков для платных запросов (решение владельца 13.11.2026)',async()=>{
 const {PAID_MODEL_TIMEOUT_MS}=await import('../src/lib/http.js');assert.equal(PAID_MODEL_TIMEOUT_MS,15*60_000);
 for(const f of ['anymodel.ts','llm.ts','imageGen.ts','modelConnections.ts','ttsConnections.ts','studio/factCheck.ts']){
  const src=await fs.readFile(new URL('../src/services/'+f,import.meta.url),'utf8');
  assert.doesNotMatch(src,/timeoutMs: *(120|150|180|240|600)_?000|},180000\)/,f);
 }
});
