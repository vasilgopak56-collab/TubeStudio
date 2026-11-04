import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import {isIP} from 'node:net';
import {z} from 'zod';
import {dataPath} from '../lib/storage.js';
import {ApiError} from '../lib/errors.js';
import {checkCancelled,taskSignal,taskContext} from '../lib/taskContext.js';
import {queued} from '../lib/queue.js';
import {paidDispatch} from './paidDispatch.js';
import type {PriceSnapshot} from './usagePricing.js';
import {recordOperation,assertBudget} from './usage.js';

const ID=z.string().uuid(),Hash=z.string().regex(/^[a-f0-9]{64}$/);
export const PinnedModel=z.object({provider:z.enum(['anthropic','gemini','anymodel','compatible']),model:z.string().trim().min(1).max(180).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/),connectionId:ID.optional(),connectionHash:Hash.optional()}).strict().refine(m=>m.provider==='compatible'?!!m.connectionId&&!!m.connectionHash:!m.connectionId&&!m.connectionHash,'Совместимой модели нужен закреплённый профиль подключения');
export type Model=z.infer<typeof PinnedModel>;
export const ConnectionInput=z.object({name:z.string().trim().min(2).max(100),baseUrl:z.string().trim().min(1).max(400),local:z.boolean(),auth:z.enum(['bearer','none']),apiKey:z.string().max(1000).regex(/^[^\r\n\x00]*$/),tokenParameter:z.enum(['max_tokens','max_completion_tokens']),sendTemperature:z.boolean(),confirmed:z.literal(true)}).strict();
const Stored=ConnectionInput.omit({confirmed:true}).extend({id:ID,createdAt:z.string().datetime()}).strict();
type Connection=z.infer<typeof Stored>;
const hash=(c:Connection)=>crypto.createHash('sha256').update(JSON.stringify(c)).digest('hex');
const invalid=(text:string)=>new ApiError('VALIDATION',text,400);
export function connectionUrl(baseUrl:string,local:boolean){
 let u:URL;try{u=new URL(baseUrl);}catch{throw invalid('Нужен полный base URL API.');}
 if(u.username||u.password||u.search||u.hash||!/^\/[a-zA-Z0-9._/-]*$/.test(u.pathname)||u.pathname.split('/').includes('..'))throw invalid('Base URL без логина, пароля, параметров и фрагмента; ключ вводится отдельно.');
 if(/\/(chat\/completions|models)\/?$/.test(u.pathname))throw invalid('Укажите base URL, например https://api.example.com/v1, без /chat/completions.');
 if(local){if(!['127.0.0.1','[::1]','localhost'].includes(u.hostname)||u.protocol!=='http:')throw invalid('Локальный профиль: только HTTP loopback 127.0.0.1, ::1 или localhost на компьютере TubeStudio.');if(u.hostname==='localhost')u.hostname='127.0.0.1';}
 else if(u.protocol!=='https:'||u.port&&u.port!=='443'||u.hostname==='localhost'||u.hostname.endsWith('.localhost')||isIP(u.hostname.replace(/[\[\]]/g,''))===6)throw invalid('Внешний профиль: HTTPS на стандартном порту, с публичным IPv4/DNS-адресом. LAN и внешние IPv6 пока не поддержаны.');
 return u.href.replace(/\/+$/,'');
}
export function publicV4(ip:string){if(isIP(ip)!==4)return false;const [a,b,c]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19)||a===192&&b===0||a===198&&b===51&&c===100||a===203&&b===0&&c===113);}
const dir=()=>dataPath('.model-connections');
async function safeDir(create=false){const absolute=path.resolve(dir()),root=path.parse(absolute).root;let at=root;for(const part of absolute.slice(root.length).split(path.sep).filter(Boolean)){at=path.join(at,part);let st=await fs.lstat(at).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return null;throw e;});if(!st&&create){await fs.mkdir(at).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='EEXIST')throw e;});st=await fs.lstat(at);}if(!st)return false;if(!st.isDirectory()||st.isSymbolicLink())throw invalid('Хранилище подключений содержит ссылку или объект другого типа.');}return true;}
async function load(id:string){ID.parse(id);if(!await safeDir())throw invalid('Подключение отсутствует. Создайте профиль и явно переназначьте модели диалога.');const file=path.join(dir(),id+'.json'),st=await fs.lstat(file).catch(()=>null);if(!st||!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>16000)throw invalid('Профиль отсутствует или повреждён; замена провайдера не выполнялась.');let c:Connection;try{c=Stored.parse(JSON.parse(await fs.readFile(file,'utf8')));}catch{throw invalid('Профиль подключения повреждён.');}if(c.id!==id||connectionUrl(c.baseUrl,c.local)!==c.baseUrl)throw invalid('Профиль подключения изменён или повреждён.');return c;}
function view(c:Connection){return {id:c.id,name:c.name,baseUrl:c.baseUrl,local:c.local,auth:c.auth,keyConfigured:!!c.apiKey,tokenParameter:c.tokenParameter,sendTemperature:c.sendTemperature,createdAt:c.createdAt,hash:hash(c)};}
export async function listModelConnections(){if(!await safeDir())return {connections:[],warnings:[] as string[]};const connections:ReturnType<typeof view>[]=[],warnings:string[]=[];for(const name of (await fs.readdir(dir())).filter(n=>/^[a-f0-9-]{36}\.json$/i.test(n)).slice(0,100)){try{connections.push(view(await load(name.slice(0,-5))));}catch{warnings.push('Повреждённый профиль пропущен, файл не изменён.');}}return {connections,warnings};}
let tail:Promise<unknown>=Promise.resolve();
export async function createModelConnection(input:z.infer<typeof ConnectionInput>){const d=ConnectionInput.parse(input);const work=tail.catch(()=>{}).then(async()=>{
 const baseUrl=connectionUrl(d.baseUrl,d.local);if(!d.local&&isIP(new URL(baseUrl).hostname)===4&&!publicV4(new URL(baseUrl).hostname))throw invalid('Приватный адрес нельзя использовать как внешнее подключение.');
 if(d.auth==='bearer'&&!d.apiKey.trim())throw invalid('Для Bearer нужен ключ.');if(d.auth==='none'&&d.apiKey)throw invalid('Для режима без авторизации поле ключа должно быть пустым.');
 await safeDir(true);if((await fs.readdir(dir())).filter(n=>n.endsWith('.json')).length>=100)throw invalid('Лимит 100 неизменяемых профилей подключения.');
 const {confirmed,...fields}=d,c=Stored.parse({...fields,baseUrl,id:crypto.randomUUID(),createdAt:new Date().toISOString()}),file=path.join(dir(),c.id+'.json'),tmp=file+'.tmp';
 try{await fs.writeFile(tmp,JSON.stringify(c),{flag:'wx',mode:0o600});await fs.link(tmp,file);}finally{await fs.rm(tmp,{force:true});}return view(c);
 });tail=work;return work;}
// Only this server process serializes profile creation/removal. Running provider requests are not cancelled.
export const ConnectionRemovalAsk=z.object({id:ID,connectionHash:Hash}).strict();
export const ConnectionRemovalSend=ConnectionRemovalAsk.extend({previewHash:Hash,confirmed:z.literal(true)}).strict();
export async function previewConnectionRemoval(input:z.infer<typeof ConnectionRemovalAsk>){
 const d=ConnectionRemovalAsk.parse(input),c=await load(d.id);if(hash(c)!==d.connectionHash)throw invalid('Профиль изменился. Обновите список подключений и повторите просмотр.');
 const connection=view(c),previewHash=crypto.createHash('sha256').update(JSON.stringify({purpose:'remove-model-connection-v1',input:d,connection})).digest('hex');
 return {input:d,connection,hash:previewHash,notice:'Удалится только локальный файл этого подключения, включая сохранённый ключ. Диалоги и процессы не изменяются: для новых запросов с этой привязкой понадобится новое подключение и явное переназначение. Уже начатые запросы могут завершиться. Это не отзыв ключа у провайдера и не гарантированное стирание копий или следов на диске.'};
}
export async function removeModelConnection(input:z.infer<typeof ConnectionRemovalSend>){
 const d=ConnectionRemovalSend.parse(input);const work=tail.catch(()=>{}).then(async()=>{checkCancelled();const p=await previewConnectionRemoval({id:d.id,connectionHash:d.connectionHash});if(p.hash!==d.previewHash)throw invalid('Просмотр устарел. Повторите сравнение перед удалением.');
  const file=path.join(dir(),d.id+'.json'),before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>16000)throw invalid('Профиль отсутствует или повреждён; удаление остановлено.');
  const current=await load(d.id),after=await fs.lstat(file);if(hash(current)!==d.connectionHash||before.dev!==after.dev||before.ino!==after.ino||!after.isFile()||after.isSymbolicLink()||after.nlink!==1)throw invalid('Профиль изменился; удаление остановлено.');checkCancelled();await fs.unlink(file);return {id:d.id};
 });tail=work;return work;
}
export async function assertModelConnection(model:Model){if(model.provider!=='compatible')return;const c=await load(model.connectionId!);if(hash(c)!==model.connectionHash)throw invalid('Закреплённый профиль изменился. Запрос остановлен; создайте новое подключение и явно переназначьте модель.');return c;}
async function destination(c:Connection){const u=new URL(c.baseUrl+'/chat/completions');if(c.local)return {u,address:u.hostname==='[::1]'?'::1':'127.0.0.1',family:u.hostname==='[::1]'?6:4};
 const addresses=isIP(u.hostname)===4?[{address:u.hostname,family:4}]:await dns.lookup(u.hostname,{all:true,family:4});if(!addresses.length||addresses.some(a=>!publicV4(a.address)))throw invalid('Адрес API не разрешён: нужен публичный IPv4. Запрос и ключ не отправлены.');return {u,...addresses[0]};}
/** Pinned DNS lookup, no redirects/proxies/retries; arbitrary response errors never reach UI. */
async function post(c:Connection,body:string,beforeSend:()=>Promise<void>){
 checkCancelled();let target:Awaited<ReturnType<typeof destination>>;try{target=await destination(c);}catch(e){if(e instanceof ApiError)throw e;throw new ApiError('UPSTREAM','Не удалось определить публичный адрес API. Запрос не отправлен.',502);}checkCancelled();await beforeSend();checkCancelled();
 return new Promise<{status:number;json:any}>((resolve,reject)=>{const {u,address,family}=target;let settled=false;const signal=taskSignal();let timer:ReturnType<typeof setTimeout>;
 const fail=(e:Error)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(e);};
 const req=(u.protocol==='https:'?https:http).request(u,{method:'POST',agent:false,headers:{'content-type':'application/json','content-length':Buffer.byteLength(body),...(c.auth==='bearer'?{authorization:'Bearer '+c.apiKey}:{})},family,lookup:((_host:any,options:any,cb:any)=>options?.all?cb(null,[{address,family}]):cb(null,address,family)) as any},res=>{
  const chunks:Buffer[]=[];let bytes=0;res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>2*1024*1024){fail(new ApiError('UPSTREAM','Ответ API слишком большой; автоматического повтора нет.',502));req.destroy();res.destroy();}else chunks.push(chunk);});
  res.on('error',()=>fail(new ApiError('UPSTREAM','Ответ API оборвался; запрос мог быть оплачен. Автоповтора нет.',502)));
  res.on('end',()=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);let json:any;try{json=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{reject(new ApiError('UPSTREAM','API вернул не JSON; проверьте протокол. Автоповтора нет.',502));return;}resolve({status:res.statusCode??502,json});});
 });
 const abort=()=>{try{checkCancelled(signal);}catch(e){fail(e as Error);req.destroy();}};
 timer=setTimeout(()=>{fail(new ApiError('UPSTREAM','Таймаут API; запрос мог быть оплачен. Автоповтора нет.',502));req.destroy();},180000);
 req.on('error',()=>fail(new ApiError('UPSTREAM','Ошибка соединения с API; запрос мог быть оплачен. Проверьте профиль, автоматического повтора нет.',502)));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}req.end(body);
 });
}
export const callCompatible=queued('llm',async(c:{system:string;user:string;maxTokens?:number;temperature?:number;images?:unknown[]},selection:Model)=>{
 const profile=await assertModelConnection(selection);if(!profile)throw invalid('Нужен совместимый профиль.');if(c.images?.length)throw invalid('Этот адаптер пока поддерживает только текст.');await assertBudget();
 const dispatch=paidDispatch(async()=>{const tariff={version:1 as const,provider:'compatible:'+profile.id,model:selection.model,kind:'text' as const,currency:'USD' as const,source:'configured-direct' as const,known:false,reason:'Тариф этого совместимого подключения отдельно не подтверждён; цены других сервисов не переносятся.'};return {...tariff,capturedAt:new Date().toISOString(),priceVersion:crypto.createHash('sha256').update(JSON.stringify(tariff)).digest('hex')} satisfies PriceSnapshot;});
 // The existing block barrier runs immediately before the one outbound request.
 checkCancelled();
 const {status,json:j}=await post(profile,JSON.stringify({model:selection.model,messages:[{role:'system',content:c.system},{role:'user',content:c.user}],[profile.tokenParameter]:c.maxTokens??8000,...(profile.sendTemperature?{temperature:c.temperature??.7}:{}),stream:false}),()=>dispatch.beforeAttempt());checkCancelled();
 if(status<200||status>=300||j?.error)throw new ApiError('UPSTREAM',`Совместимый API: HTTP ${status}. Проверьте ключ, model ID и протокол. Тело ошибки скрыто; автоматического повтора и перехода на другую модель нет.`,502);
 await recordOperation(dispatch.prices[0],{input:j?.usage?.prompt_tokens??0,output:j?.usage?.completion_tokens??0,known:Number.isFinite(j?.usage?.prompt_tokens)&&Number.isFinite(j?.usage?.completion_tokens)},taskContext()?.jobId);
 const choice=j?.choices?.[0];if(typeof choice?.message?.content!=='string'||!choice.message.content.trim()||choice.message.tool_calls?.length||choice.message.function_call||choice.finish_reason==='length'||choice.finish_reason==='content_filter')throw new ApiError('UPSTREAM','API вернул пустой, неполный или неподдерживаемый ответ. Автоповтора нет; запрос мог быть оплачен.',502);
 return {text:choice.message.content,model:selection.model};
});

export async function describeModelConnection(model:Model){const c=await assertModelConnection(model);return c?view(c):null;}
