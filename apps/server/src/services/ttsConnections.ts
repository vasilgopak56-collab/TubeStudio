/** Explicit OpenAI-compatible audio/speech profiles. Not a text profile, no auto probes/fallback. */
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import dns from 'node:dns/promises';
import {isIP} from 'node:net';
import http from 'node:http';
import https from 'node:https';
import {z} from 'zod';
import {dataPath} from '../lib/storage.js';
import {ApiError} from '../lib/errors.js';
import {PAID_MODEL_TIMEOUT_MS} from '../lib/http.js';
import {assistantSafeDir} from './assistant.js';
import {connectionUrl,publicV4} from './modelConnections.js';
import {checkCancelled,taskSignal,taskContext,cancellation} from '../lib/taskContext.js';
import {queued} from '../lib/queue.js';
import {paidDispatch} from './paidDispatch.js';
import {assertBudget,recordOperation} from './usage.js';
import type {PriceSnapshot} from './usagePricing.js';
const ID=z.string().uuid(),Hash=z.string().regex(/^[a-f0-9]{64}$/),Token=z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9/._:-]*$/);
export const SpeechSelection=z.object({connectionId:ID,connectionHash:Hash,voice:Token}).strict();
export const SpeechConnectionInput=z.object({name:z.string().trim().min(2).max(100),baseUrl:z.string().trim().min(1).max(400),local:z.boolean(),auth:z.enum(['bearer','none']),apiKey:z.string().max(1000).regex(/^[^\r\n\x00]*$/),confirmed:z.literal(true)}).strict();
const Stored=SpeechConnectionInput.omit({confirmed:true}).extend({id:ID,createdAt:z.string().datetime()}).strict();
type Profile=z.infer<typeof Stored>;type Selection=z.infer<typeof SpeechSelection>;
const invalid=(s:string)=>new ApiError('VALIDATION',s,409),dir=()=>dataPath('.tts-connections');
function binding(p:Profile){const {apiKey,...fields}=p;return crypto.createHmac('sha256',apiKey||'tts-no-auth-v1').update(JSON.stringify(fields)).digest('hex');}
function baseUrl(value:string,local:boolean){const u=connectionUrl(value,local);if(/\/(?:audio\/speech|responses)\/?$/.test(new URL(u).pathname))throw invalid('Укажите base URL без /audio/speech. Адаптер добавляет этот путь сам.');if(!local&&isIP(new URL(u).hostname)===4&&!publicV4(new URL(u).hostname))throw invalid('Для внешнего TTS нужен публичный IPv4/DNS, не приватная сеть.');return u;}
async function load(id:string){ID.parse(id);if(!await assistantSafeDir(dir()))throw invalid('TTS-профиль отсутствует. После переноса настройте отдельный профиль озвучки; автоматической замены нет.');const full=path.join(dir(),id+'.json'),st=await fs.lstat(full).catch(()=>null);if(!st||!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>16000)throw invalid('TTS-профиль отсутствует, повреждён или небезопасен.');const fd=await fs.open(full,constants.O_RDONLY|constants.O_NOFOLLOW);try{const st=await fd.stat();if(!st.isFile()||st.nlink!==1||st.size>16000)throw invalid('Небезопасный TTS-профиль.');const bytes=await fd.readFile();if(bytes.length>16000)throw invalid('Слишком большой TTS-профиль.');let p:Profile;try{p=Stored.parse(JSON.parse(bytes.toString('utf8')));}catch{throw invalid('TTS-профиль повреждён.');}if(p.id!==id||baseUrl(p.baseUrl,p.local)!==p.baseUrl||p.auth==='bearer'&&!p.apiKey.trim()||p.auth==='none'&&!!p.apiKey)throw invalid('TTS-профиль изменён или повреждён.');return p;}finally{await fd.close();}}
function view(p:Profile){return {id:p.id,name:p.name,baseUrl:p.baseUrl,local:p.local,auth:p.auth,keyConfigured:p.auth==='none'||!!p.apiKey,createdAt:p.createdAt,hash:binding(p),protocol:'openai-audio-speech' as const};}
export async function listSpeechConnections(){if(!await assistantSafeDir(dir()))return {connections:[],warnings:[] as string[]};const connections:ReturnType<typeof view>[]=[],warnings:string[]=[];for(const file of (await fs.readdir(dir())).filter(n=>/^[a-f0-9-]{36}\.json$/i.test(n)).slice(0,100)){try{connections.push(view(await load(file.slice(0,-5))));}catch{warnings.push('Повреждённый TTS-профиль пропущен без изменения файла.');}}return {connections,warnings};}
let tail:Promise<unknown>=Promise.resolve();
export function createSpeechConnection(input:z.infer<typeof SpeechConnectionInput>){const d=SpeechConnectionInput.parse(input);const work=tail.catch(()=>{}).then(async()=>{const base=baseUrl(d.baseUrl,d.local);if(d.auth==='bearer'&&!d.apiKey.trim())throw invalid('Для Bearer нужен ключ.');if(d.auth==='none'&&d.apiKey)throw invalid('Без авторизации поле ключа должно быть пустым.');await assistantSafeDir(dir(),true);if((await fs.readdir(dir())).filter(n=>n.endsWith('.json')).length>=100)throw invalid('Лимит 100 неизменяемых TTS-профилей.');const {confirmed,...fields}=d,p=Stored.parse({...fields,baseUrl:base,id:crypto.randomUUID(),createdAt:new Date().toISOString()}),full=path.join(dir(),p.id+'.json'),tmp=full+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(tmp,JSON.stringify(p),{flag:'wx',mode:0o600});await fs.link(tmp,full);}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}return view(p);});tail=work;return work;}
// Creation and removal are serialized in this server process; dispatched requests may finish.
export const SpeechRemovalAsk=z.object({id:ID,connectionHash:Hash}).strict();
export const SpeechRemovalSend=SpeechRemovalAsk.extend({previewHash:Hash,confirmed:z.literal(true)}).strict();
export async function previewSpeechRemoval(input:z.infer<typeof SpeechRemovalAsk>){
 const d=SpeechRemovalAsk.parse(input),profile=await load(d.id);if(binding(profile)!==d.connectionHash)throw invalid('TTS-профиль изменился. Обновите список и повторите просмотр.');
 const connection=view(profile),hash=crypto.createHash('sha256').update(JSON.stringify({purpose:'remove-speech-connection-v1',input:d,connection})).digest('hex');
 return {input:d,connection,hash,notice:'Удалится только локальный TTS-профиль с ключом. Подготовки, части, квитанции и проекты сохраняются, но новые запросы закреплённой подготовки не смогут использовать это подключение. Уже отправленный запрос может завершиться. Не создавайте новую подготовку для обхода неизвестного платного результата: сначала проверьте состояние и расходы у провайдера. Это не отзыв ключа у провайдера и не гарантированное стирание следов или копий.'};
}
export async function removeSpeechConnection(input:z.infer<typeof SpeechRemovalSend>){
 const d=SpeechRemovalSend.parse(input);const work=tail.catch(()=>{}).then(async()=>{checkCancelled();const p=await previewSpeechRemoval({id:d.id,connectionHash:d.connectionHash});if(p.hash!==d.previewHash)throw invalid('Просмотр устарел. Повторите проверку перед удалением.');
 const file=path.join(dir(),d.id+'.json'),before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>16000)throw invalid('TTS-профиль отсутствует или повреждён; удаление остановлено.');
 const current=await load(d.id),after=await fs.lstat(file);if(binding(current)!==d.connectionHash||before.dev!==after.dev||before.ino!==after.ino||!after.isFile()||after.isSymbolicLink()||after.nlink!==1)throw invalid('TTS-профиль изменился; удаление остановлено.');checkCancelled();await fs.unlink(file);return {id:d.id};
 });tail=work;return work;
}
export async function describeSpeechConnection(input:Selection){const d=SpeechSelection.parse(input),p=await load(d.connectionId);if(binding(p)!==d.connectionHash)throw invalid('Закреплённый TTS-профиль изменился. Автоматической замены нет; создайте новый профиль и новую подготовку явно.');return view(p);}
async function destination(p:Profile){const url=new URL(p.baseUrl+'/audio/speech');if(p.local)return {url,address:url.hostname==='[::1]'?'::1':'127.0.0.1',family:url.hostname==='[::1]'?6:4};const addresses=isIP(url.hostname)===4?[{address:url.hostname,family:4}]:await dns.lookup(url.hostname,{all:true,family:4});if(!addresses.length||addresses.some(a=>!publicV4(a.address)))throw invalid('TTS-адрес не разрешён: нужен публичный IPv4. Ключ и запрос не отправлены.');return {url,...addresses[0]};}
async function post(p:Profile,body:string,beforeSend:()=>Promise<void>){
 checkCancelled();let target:Awaited<ReturnType<typeof destination>>;try{target=await destination(p);}catch(e){if(e instanceof ApiError)throw e;throw new ApiError('UPSTREAM','Не удалось определить публичный адрес TTS. Запрос не отправлен.',502);}checkCancelled();await beforeSend();checkCancelled();
 return new Promise<{audio:Buffer;mime:string}>((resolve,reject)=>{const signal=taskSignal();let settled=false;let timer:ReturnType<typeof setTimeout>;const {url,address,family}=target;
  const finish=(error?:Error,value?:{audio:Buffer;mime:string})=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(value!);};
  const req=(url.protocol==='https:'?https:http).request(url,{method:'POST',agent:false,family,headers:{'content-type':'application/json','content-length':Buffer.byteLength(body),accept:'audio/mpeg','accept-encoding':'identity',...(p.auth==='bearer'?{authorization:'Bearer '+p.apiKey}:{})},lookup:((_host:any,options:any,cb:any)=>options?.all?cb(null,[{address,family}]):cb(null,address,family)) as any},res=>{
   const fail=(message:string)=>{finish(new ApiError('UPSTREAM',message,502));req.destroy();res.destroy();};
   if((res.statusCode??502)<200||(res.statusCode??502)>=300){fail(`TTS API: HTTP ${res.statusCode??502}. Тело ошибки скрыто; нет редиректов, повторов или другого голоса. Запрос мог быть оплачен.`);return;}
   const mime=String(res.headers['content-type']??'');if(!/^audio\/(mpeg|mp3)(?:;|$)/i.test(mime)){fail('TTS API вернул не MP3. Автоповтора нет; запрос мог быть оплачен.');return;}
   const MAX=20*1024*1024;if(Number(res.headers['content-length']??0)>MAX){fail('TTS MP3 превышает 20 МиБ. Повтор не выполняется.');return;}
   const chunks:Buffer[]=[];let bytes=0;res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>MAX)fail('TTS MP3 превышает 20 МиБ. Повтор не выполняется.');else if(!settled)chunks.push(chunk);});res.on('error',()=>finish(new ApiError('UPSTREAM','TTS-ответ оборвался; запрос мог быть оплачен. Автоповтора нет.',502)));res.on('end',()=>finish(undefined,{audio:Buffer.concat(chunks),mime}));
  });
  const abort=()=>{finish(cancellation());req.destroy();};timer=setTimeout(()=>{finish(new ApiError('UPSTREAM','Таймаут TTS; запрос мог быть оплачен. Автоповтора нет.',502));req.destroy();},PAID_MODEL_TIMEOUT_MS);
  req.on('error',()=>finish(new ApiError('UPSTREAM','Соединение TTS не завершилось. Запрос мог быть оплачен; повтор не выполняется.',502)));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}req.end(body);
 });
}
export const callCompatibleSpeech=queued('tts',async(selection:Selection,model:string,text:string,safety:{beforeDispatch:()=>Promise<void>;onAudio:(audio:Buffer,mime:string)=>Promise<void>})=>{
 const d=SpeechSelection.parse(selection);Token.parse(model);if(!text.trim()||text.length>1800)throw invalid('Нужна ровно одна часть до 1800 символов.');await assertBudget();await describeSpeechConnection(d);const p=await load(d.connectionId);
 const dispatch=paidDispatch(async()=>{const tariff={version:1 as const,provider:'compatible-tts:'+p.id,model,kind:'tts' as const,currency:'USD' as const,source:'configured-direct' as const,known:false,reason:'Тариф независимого TTS не подтверждён; цены AnyModel и текстовых профилей не переносятся.'};return {...tariff,capturedAt:new Date().toISOString(),priceVersion:crypto.createHash('sha256').update(JSON.stringify(tariff)).digest('hex')} satisfies PriceSnapshot;});
 const r=await post(p,JSON.stringify({model,input:text,voice:d.voice,response_format:'mp3'}),async()=>{await describeSpeechConnection(d);await safety.beforeDispatch();await dispatch.beforeAttempt();});
 // Preserve a complete paid response before cancellation/accounting can hide it.
 let captureError:unknown;try{await safety.onAudio(r.audio,r.mime);}catch(e){captureError=e;}
 const accountingRecorded=await recordOperation(dispatch.prices[0],{chars:text.length,known:true},taskContext()?.jobId);if(captureError)throw captureError;return {accountingRecorded};
});
