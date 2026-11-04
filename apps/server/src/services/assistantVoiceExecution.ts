import {SpeechSelection,describeSpeechConnection,callCompatibleSpeech} from './ttsConnections.js';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {ffmpegPath} from './audioFx.js';
import {taskSignal,cancellation} from '../lib/taskContext.js';
/** One explicitly confirmed TTS part; durable attempt BEFORE dispatch, immutable audio/receipt. */
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {z} from 'zod';
import {config} from '../config.js';
import {ApiError} from '../lib/errors.js';
import {dataPath} from '../lib/storage.js';
import {checkCancelled,withTaskSignal} from '../lib/taskContext.js';
import type {JobCtx} from '../lib/jobs.js';
import {assistantProjectSnapshot,assistantSafeDir} from './assistant.js';
import {VoicePreparationAsk} from './assistantVoice.js';
import {cleanForTts,chunkText,mp3Duration} from './tts.js';
import {amSpeech,hasAnymodel} from './anymodel.js';
import {assertBudget} from './usage.js';
import {withProjectMutation} from './projects.js';
const ID=z.string().uuid(),Hash=z.string().regex(/^[a-f0-9]{64}$/),MAX=20*1024*1024;
const digest=(o:unknown)=>crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const sha=(b:Buffer)=>crypto.createHash('sha256').update(b).digest('hex');
const problem=(s:string)=>new ApiError('VALIDATION',s,409);
const Preparation=z.object({source:z.literal('assistant-voice-preparation'),version:z.literal(1),preparationKey:Hash,input:VoicePreparationAsk,sourceArtifact:z.object({id:ID,title:z.string(),version:z.number().nullable(),hash:Hash}).strict(),originalText:z.string().min(1).max(120000),cleanedText:z.string().min(1).max(120000),chunks:z.array(z.string().min(1).max(1800)).min(1).max(1000),chars:z.number().int().min(1).max(120000),receiver:z.string(),modelVerified:z.literal(false),audioGenerated:z.literal(false),confirmedPreviewHash:Hash}).strict();
export const VoicePartAsk=z.object({projectId:ID,preparationId:ID,part:z.number().int().min(1).max(1000)}).strict();
export const VoicePartSend=VoicePartAsk.extend({previewHash:Hash,confirmed:z.literal(true)}).strict();
const Attempt=z.object({version:z.literal(1),id:ID,input:VoicePartAsk,preparationHash:Hash,accountBinding:Hash,receiver:z.string(),model:z.string().min(1).max(160),text:z.string().min(1).max(1800),createdAt:z.string().datetime(),requestHash:Hash,tts:SpeechSelection.optional()}).strict();
const Receipt=z.object({version:z.literal(1),attemptId:ID,attemptHash:Hash,audioHash:Hash,bytes:z.number().int().min(1).max(MAX),seconds:z.number().positive(),model:z.string(),chars:z.number().int().positive(),createdAt:z.string().datetime(),tts:SpeechSelection.optional()}).strict();
type A=z.infer<typeof Attempt>;
let tail:Promise<unknown>=Promise.resolve();function exclusive<T>(fn:()=>Promise<T>){const p=tail.catch(()=>{}).then(fn);tail=p;return p;}
const active=new Set<string>();
function partId(d:z.infer<typeof VoicePartAsk>){const h=digest(d);return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);}
function recordPath(id:string,type:string){ID.parse(id);return dataPath('assistant-voice',id+'.'+type+'.json');}
function audioPath(a:A){return dataPath('files',a.input.projectId,'assistant_voice_'+a.id+'.mp3');}
function audioUrl(a:A){return '/files/'+a.input.projectId+'/assistant_voice_'+a.id+'.mp3';}
async function read(full:string,max:number):Promise<Buffer|null>{
 if(!await assistantSafeDir(path.dirname(full)))return null;
 const st=await fs.lstat(full).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return null;throw e;});if(!st)return null;
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>max)throw problem('Небезопасная или слишком большая запись озвучки.');
 const fd=await fs.open(full,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await fd.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>max)throw problem('Небезопасная запись озвучки.');const b=await fd.readFile();if(b.length>max)throw problem('Запись озвучки слишком велика.');return b;}finally{await fd.close();}
}
async function load<T>(full:string,schema:z.ZodType<T>){const raw=await read(full,1024*1024);if(!raw)return null;try{return schema.parse(JSON.parse(raw.toString('utf8')));}catch{throw problem('Запись озвучки повреждена, повторная генерация запрещена.');}}
async function publish(full:string,bytes:Buffer|string){await assistantSafeDir(path.dirname(full),true);const tmp=full+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(tmp,bytes,{flag:'wx',mode:0o600});await fs.link(tmp,full);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw problem('Операция уже зарегистрирована. Обновите состояние, не отправляйте повторно.');throw e;}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}}
async function preparation(projectId:string,preparationId:string){
 const snap=await assistantProjectSnapshot(ID.parse(projectId)),items=snap.project.artifacts.filter(a=>a.id===ID.parse(preparationId));
 if(items.length!==1||items[0].kind!=='note')throw problem('Не найдена конкретная подготовка озвучки.');
 const parsed=Preparation.safeParse(items[0].data);if(!parsed.success)throw problem('Подготовка повреждена или имеет неподдержанный формат.');
 const p=parsed.data;
 if(p.input.projectId!==projectId||p.sourceArtifact.id!==p.input.sourceArtifactId||p.chars!==p.cleanedText.length||p.preparationKey!==digest({input:p.input,sourceHash:p.sourceArtifact.hash})||cleanForTts(p.originalText,{headings:false})!==p.cleanedText||JSON.stringify(chunkText(p.cleanedText,!p.input.tts&&p.input.model.startsWith('fish-farm/')?1200:1800))!==JSON.stringify(p.chunks))throw problem('Снимок подготовки не прошёл проверку.');
 return {...snap,preparation:p,preparationId,preparationHash:digest(items[0])};
}
export async function voicePreparations(projectId:string){const snap=await assistantProjectSnapshot(ID.parse(projectId));return snap.project.artifacts.filter(a=>a.kind==='note'&&(a.data as any)?.source==='assistant-voice-preparation').map(a=>({id:a.id,title:a.title}));}
async function attempt(d:z.infer<typeof VoicePartAsk>){const id=partId(d),a=await load(recordPath(id,'attempt'),Attempt);if(a&&(a.id!==id||digest(a.input)!==digest(d)))throw problem('Идентификатор попытки не совпадает.');return a;}
function validateAudio(bytes:Buffer,max=MAX){
 const invalid=()=>problem('Полученный файл не прошёл структурную проверку MP3. Повтор не выполняется.');
 if(bytes.length<417||bytes.length>max)throw invalid();
 let at=0,frames=0,format='';
 if(bytes.toString('latin1',0,3)==='ID3'){
  if(bytes.length<10||[bytes[6],bytes[7],bytes[8],bytes[9]].some(x=>x&128))throw invalid();
  at=10+((bytes[6]<<21)|(bytes[7]<<14)|(bytes[8]<<7)|bytes[9])+((bytes[5]&16)?10:0);
 }
 const rates:Record<number,number[]>={3:[44100,48000,32000],2:[22050,24000,16000],0:[11025,12000,8000]};
 const high=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320],low=[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
 while(at<bytes.length){
  if(bytes.length-at===128&&bytes.toString('latin1',at,at+3)==='TAG'){at+=128;break;}
  if(at+4>bytes.length||bytes[at]!==255||(bytes[at+1]&224)!==224)throw invalid();
  const ver=(bytes[at+1]>>3)&3,layer=(bytes[at+1]>>1)&3,br=(bytes[at+2]>>4)&15,sr=(bytes[at+2]>>2)&3,pad=(bytes[at+2]>>1)&1;
  if(ver===1||layer!==1||!br||br===15||sr===3)throw invalid();
  const current=ver+':'+rates[ver][sr]+':'+(((bytes[at+3]>>6)&3)===3?1:2);if(format&&format!==current)throw invalid();format=current;
  const len=Math.floor(((ver===3?1152:576)/8)*(ver===3?high:low)[br]*1000/rates[ver][sr])+pad;
  if(at+len>bytes.length)throw invalid();at+=len;frames++;
 }
 const v=mp3Duration(bytes);if(!frames||v.seconds<=0)throw invalid();return {...v,format};
}
async function partState(d:z.infer<typeof VoicePartAsk>,preparationHash:string){
 const a=await attempt(d);if(!a)return {part:d.part,status:'ready' as const};if(a.preparationHash!==preparationHash)throw problem('Подготовка была изменена после регистрации попытки.');
 const bytes=await read(audioPath(a),MAX),receipt=await load(recordPath(a.id,'receipt'),Receipt);
 if(receipt){if(!bytes||receipt.attemptId!==a.id||receipt.attemptHash!==digest(a)||receipt.audioHash!==sha(bytes)||receipt.bytes!==bytes.length||receipt.model!==a.model||receipt.chars!==a.text.length||digest(receipt.tts??null)!==digest(a.tts??null))throw problem('Аудио или квитанция повреждены. Повторная генерация заблокирована.');validateAudio(bytes);const accounted=await load(recordPath(a.id,'accounted'),z.object({attemptHash:Hash}).strict());if(accounted&&accounted.attemptHash!==digest(a))throw problem('Запись учёта не совпадает с попыткой.');return {part:d.part,status:'saved' as const,url:audioUrl(a),receipt,accounted:!!accounted};}
 if(bytes){validateAudio(bytes);if(active.has(a.id))return {part:d.part,status:'running' as const};return {part:d.part,status:'recoverable' as const};}
 return {part:d.part,status:active.has(a.id)?'running' as const:'unknown' as const};
}
export async function voiceExecutionState(projectId:string,preparationId:string){const p=await preparation(projectId,preparationId),parts=[];for(let part=1;part<=p.preparation.chunks.length;part++)parts.push(await partState({projectId,preparationId,part},p.preparationHash));return {projectId,preparationId,title:p.preparation.input.title,model:p.preparation.input.model,language:p.preparation.input.language,speed:p.preparation.input.speed,pitch:p.preparation.input.pitch,parts,...(p.preparation.input.tts?{tts:p.preparation.input.tts}:{})};}
function accountBinding(){return crypto.createHmac('sha256',config.keys.anymodel||'missing').update('assistant-voice-account-v1').digest('hex');}
function receiver(){let u:URL;try{u=new URL(config.anymodelBase);}catch{throw problem('Проверьте адрес TTS в настройках сервера.');}if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw problem('Для запуска помощником нужен HTTPS TTS без учётных данных в URL.');return config.anymodelBase+'/audio/speech';}
async function voiceTarget(tts?:z.infer<typeof SpeechSelection>){if(!tts)return {target:receiver(),binding:accountBinding(),keyConfigured:hasAnymodel()};const c=await describeSpeechConnection(tts);return {target:c.baseUrl+'/audio/speech',binding:c.hash,keyConfigured:c.keyConfigured};}
async function partPlan(input:z.infer<typeof VoicePartAsk>){
 const d=VoicePartAsk.parse(input),p=await preparation(d.projectId,d.preparationId),text=p.preparation.chunks[d.part-1];if(!text)throw problem('Такой части нет в подготовке.');
 if(p.preparation.input.speed!==1||p.preparation.input.pitch!==0)throw problem('В .84 поддержаны только скорость 1 и тон 0. Создайте отдельную подготовку; параметры не меняются автоматически.');
 if((await partState(d,p.preparationHash)).status!=='ready')throw problem('Часть уже запускалась. Обновите состояние или восстановите файл, не генерируйте повторно.');
 if(d.part>1&&(await partState({...d,part:d.part-1},p.preparationHash)).status!=='saved')throw problem('Сначала получите и проверьте предыдущую часть.');
 const destination=await voiceTarget(p.preparation.input.tts),target=destination.target,binding=destination.binding;
 const hash=digest({input:d,preparationHash:p.preparationHash,snapshot:p.snapshot,target,model:p.preparation.input.model,text,accountBinding:binding});
 return {...p,input:d,text,target,hash,accountBinding:binding,keyConfigured:destination.keyConfigured};
}
export async function previewVoicePart(input:z.infer<typeof VoicePartAsk>){const p=await partPlan(input);return {input:p.input,hash:p.hash,receiver:p.target,model:p.preparation.input.model,language:p.preparation.input.language,text:p.text,chars:p.text.length,totalParts:p.preparation.chunks.length,keyConfigured:p.keyConfigured,...(p.preparation.input.tts?{tts:p.preparation.input.tts}:{}),notice:'Один запрос только этой части. Может быть платным. Нет автоматических повторов, редиректов, подмены голоса или запуска следующей части. Отмена не возвращает оплату. При неизвестном исходе повтор заблокирован.'};}
export async function reserveVoicePart(input:z.infer<typeof VoicePartSend>){const d=VoicePartSend.parse(input);return exclusive(async()=>{
 const p=await partPlan({projectId:d.projectId,preparationId:d.preparationId,part:d.part});if(p.hash!==d.previewHash)throw problem('Параметры, аккаунт или проект изменились. Обновите предпросмотр.');
 if(!p.keyConfigured)throw new ApiError('KEY_MISSING','Для этой озвучки нужен ключ AnyModel.',400);await assertBudget();checkCancelled();
 await assistantSafeDir(dataPath('assistant-voice'),true);if((await fs.readdir(dataPath('assistant-voice'))).filter(n=>n.endsWith('.attempt.json')).length>=500)throw problem('Лимит 500 попыток озвучки. Новая отправка запрещена.');
 const a=Attempt.parse({version:1,id:partId(p.input),input:p.input,preparationHash:p.preparationHash,accountBinding:p.accountBinding,receiver:p.target,model:p.preparation.input.model,text:p.text,createdAt:new Date().toISOString(),requestHash:p.hash,...(p.preparation.input.tts?{tts:p.preparation.input.tts}:{})});
 await publish(recordPath(a.id,'attempt'),JSON.stringify(a));return a;
 });}
async function makeReceipt(a:A,bytes:Buffer){const v=validateAudio(bytes),r=Receipt.parse({version:1,attemptId:a.id,attemptHash:digest(a),audioHash:sha(bytes),bytes:bytes.length,seconds:v.seconds,model:a.model,chars:a.text.length,createdAt:new Date().toISOString(),...(a.tts?{tts:a.tts}:{})});await publish(recordPath(a.id,'receipt'),JSON.stringify(r));return r;}
export async function runVoicePart(input:A,ctx:JobCtx){const a=Attempt.parse(input);if(active.has(a.id))throw problem('Эта часть уже выполняется.');active.add(a.id);try{return await withTaskSignal(ctx.signal,async()=>{
 const stored=await attempt(a.input);if(!stored||digest(stored)!==digest(a))throw problem('Нет подтверждённой попытки.');
 if(await read(audioPath(a),MAX)||await load(recordPath(a.id,'receipt'),Receipt))throw problem('Результат уже получен; повтор не отправляется.');
 if((await voiceTarget(a.tts)).target!==a.receiver)throw problem('Адрес сервиса изменился. Попытка не повторяется.');
 const p=await preparation(a.input.projectId,a.input.preparationId);if(p.preparationHash!==a.preparationHash)throw problem('Подготовка изменилась.');
 checkCancelled();await publish(recordPath(a.id,'started'),JSON.stringify({attemptHash:digest(a)}));ctx.progress('Отправляю только выбранную часть без повторов',10);
 const beforeDispatch=async()=>{const target=await voiceTarget(a.tts);if(target.target!==a.receiver||target.binding!==a.accountBinding)throw problem('Подключение или аккаунт изменились в очереди. Запрос не отправлен.');const current=await preparation(a.input.projectId,a.input.preparationId);if(current.preparationHash!==a.preparationHash)throw problem('Подготовка изменилась в очереди.');};const onAudio=async(bytes:Buffer,mime:string)=>{
  if(!/^audio\/(mpeg|mp3)(?:;|$)/i.test(mime))throw problem('Провайдер вернул не MP3. Повтор не выполняется.');validateAudio(bytes);
  // A late cancellation/bookkeeping failure must not discard a fully received paid response.
  await publish(audioPath(a),bytes);await makeReceipt(a,bytes);
 };const result=a.tts?await callCompatibleSpeech(a.tts,a.model,a.text,{beforeDispatch,onAudio}):await amSpeech(a.model,a.text,{singleAttempt:true,maxAudioBytes:MAX,beforeDispatch,onAudio});
 if(result.accountingRecorded)await publish(recordPath(a.id,'accounted'),JSON.stringify({attemptHash:digest(a)}));ctx.progress('Часть сохранена. Следующая не запускается.',100);
 return voiceExecutionState(a.input.projectId,a.input.preparationId);
 });}catch(e){if(e instanceof ApiError&&['BUDGET_LIMIT','BUDGET_PRICE_UNKNOWN','KEY_MISSING','CANCELLED'].includes(e.code))throw e;throw new ApiError('UPSTREAM','Озвучка не подтверждена полностью. Обновите состояние: полученный MP3 можно восстановить без AI. Повтор автоматически не выполняется; исходный запрос мог быть оплачен.',502);}finally{active.delete(a.id);}}
export async function recoverVoicePart(input:z.infer<typeof VoicePartAsk>){return exclusive(async()=>{const d=VoicePartAsk.parse(input),p=await preparation(d.projectId,d.preparationId),state=await partState(d,p.preparationHash);if(state.status==='saved')return voiceExecutionState(d.projectId,d.preparationId);if(state.status!=='recoverable')throw problem('Нет полного локального MP3 для восстановления. Повторной отправки не будет.');const a=(await attempt(d))!,bytes=(await read(audioPath(a),MAX))!;await makeReceipt(a,bytes);return voiceExecutionState(d.projectId,d.preparationId);});}
async function attachment(input:z.infer<typeof VoicePartAsk>){const d=VoicePartAsk.parse(input),p=await preparation(d.projectId,d.preparationId),state=await partState(d,p.preparationHash);if(state.status!=='saved')throw problem('Сначала получите или восстановите MP3 этой части.');const a=(await attempt(d))!,key=a.id,existing=p.project.artifacts.filter(x=>(x.data as any)?.assistantVoicePartKey===key);if(existing.length>1)throw problem('В проекте неоднозначные копии аудио.');
 const artifact={id:key,kind:'audio',title:`Часть ${d.part} · ${p.preparation.input.title}`.slice(0,300),createdAt:state.receipt.createdAt,version:p.project.artifacts.filter(x=>x.kind==='audio').length+1,data:{source:'assistant-voice-part',assistantVoicePartKey:key,preparationId:d.preparationId,sourceArtifactId:p.preparation.sourceArtifact.id,model:a.model,...(a.tts?{tts:a.tts}:{}),title:p.preparation.input.title,url:state.url,bytes:state.receipt.bytes,seconds:state.receipt.seconds,chars:a.text.length,chunks:1,segments:[{n:1,start:0,end:state.receipt.seconds,text:a.text}],balanceTokens:null,audioHash:state.receipt.audioHash,part:d.part,totalParts:p.preparation.chunks.length,projectId:d.projectId},files:[path.basename(audioPath(a))]};
 return {...p,input:d,artifact,existing:existing[0],hash:digest({input:d,snapshot:p.snapshot,receipt:state.receipt,artifact})};}
export async function previewVoiceAttachment(input:z.infer<typeof VoicePartAsk>){const p=await attachment(input);return {input:p.input,hash:p.hash,artifact:p.artifact,alreadySaved:!!p.existing,notice:'Локальное добавление уже полученной части в проект. Не новый синтез, не сборка полного ролика. Старое аудио не заменяется.'};}
export async function attachVoicePart(input:z.infer<typeof VoicePartSend>){const d=VoicePartSend.parse(input);return withProjectMutation(async()=>{const p=await attachment({projectId:d.projectId,preparationId:d.preparationId,part:d.part});if(p.existing)return {projectId:d.projectId,artifact:p.existing,alreadySaved:true};if(p.hash!==d.previewHash)throw problem('Проект изменился. Обновите просмотр добавления аудио.');const bytes=JSON.stringify({...p.project,updatedAt:new Date().toISOString(),artifacts:[...p.project.artifacts,p.artifact]},null,2);if(Buffer.byteLength(bytes)>10*1024*1024)throw problem('Проект превысит 10 МиБ.');const tmp=p.target+'.'+crypto.randomUUID()+'.tmp';try{checkCancelled();await fs.writeFile(tmp,bytes,{flag:'wx',mode:0o600});checkCancelled();if((await assistantProjectSnapshot(d.projectId)).snapshot!==p.snapshot)throw problem('Проект изменился.');await fs.rename(tmp,p.target);}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}return {projectId:d.projectId,artifact:p.artifact,alreadySaved:false};});}

// Local assembly only: immutable source parts; no imports or calls to a provider here.
export const VoiceAssemblyAsk=z.object({projectId:ID,preparationId:ID}).strict();
export const VoiceAssemblySend=VoiceAssemblyAsk.extend({previewHash:Hash,confirmed:z.literal(true)}).strict();
const ASSEMBLY_MAX=128*1024*1024;
const AssemblyReceipt=z.object({version:z.literal(1),id:ID,manifestHash:Hash,audioHash:Hash,bytes:z.number().int().positive().max(ASSEMBLY_MAX),seconds:z.number().positive(),createdAt:z.string().datetime()}).strict();
function assemblyId(hash:string){return hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-b'+hash.slice(17,20)+'-'+hash.slice(20,32);}
async function assemblyPlan(input:z.infer<typeof VoiceAssemblyAsk>){
 const d=VoiceAssemblyAsk.parse(input),p=await preparation(d.projectId,d.preparationId),parts=[];let totalBytes=0,format='';
 for(let part=1;part<=p.preparation.chunks.length;part++){
  const ask={...d,part},state=await partState(ask,p.preparationHash);if(state.status!=='saved')throw problem('Для сборки нужны все сохранённые части с проверенными квитанциями. Незавершённые части не генерируются автоматически.');
  const a=(await attempt(ask))!,bytes=(await read(audioPath(a),MAX))!,v=validateAudio(bytes);totalBytes+=bytes.length;
  if(totalBytes>ASSEMBLY_MAX)throw problem('Сумма частей превышает 128 МиБ. Исходники не меняются.');
  if(format&&format!==v.format)throw problem('Форматы частей различаются. Сборка без перекодирования невозможна; автоматического изменения звука нет.');format=v.format;
  parts.push({part,receipt:state.receipt,text:a.text,accounted:state.accounted});
 }
 const manifestHash=digest({input:d,preparationHash:p.preparationHash,receipts:parts.map(x=>x.receipt)}),id=assemblyId(manifestHash),file=dataPath('files',d.projectId,'assistant_assembled_'+id+'.mp3'),url='/files/'+d.projectId+'/assistant_assembled_'+id+'.mp3';
 const hash=digest({input:d,snapshot:p.snapshot,manifestHash});return {...p,input:d,parts,totalBytes,manifestHash,id,file,url,hash};
}
type AssemblyPlan=Awaited<ReturnType<typeof assemblyPlan>>;
async function assemblyResult(p:AssemblyPlan){
 const bytes=await read(p.file,ASSEMBLY_MAX),receipt=await load(recordPath(p.id,'assembly'),AssemblyReceipt),descriptor=await load(recordPath(p.id,'assembly-output'),AssemblyReceipt);
 if(descriptor&&(descriptor.id!==p.id||descriptor.manifestHash!==p.manifestHash))throw problem('Снимок сборки не совпадает с источниками.');
 if(!bytes&&!receipt)return null;
 if(!bytes)throw problem('Итоговый файл отсутствует. Исходные части не отправляются на повторную генерацию.');
 const v=validateAudio(bytes,ASSEMBLY_MAX);if(!descriptor||descriptor.audioHash!==sha(bytes)||descriptor.bytes!==bytes.length||descriptor.seconds!==v.seconds)throw problem('Хеш итогового MP3 не совпадает с предварительно записанным снимком.');if(receipt&&digest(receipt)!==digest(descriptor))throw problem('Квитанция сборки не совпадает со снимком.');if(receipt&&(receipt.id!==p.id||receipt.manifestHash!==p.manifestHash||receipt.audioHash!==sha(bytes)||receipt.bytes!==bytes.length||receipt.seconds!==v.seconds))throw problem('Итоговый файл или квитанция сборки повреждены. Исходники сохранены.');
 return {id:p.id,url:p.url,bytes:bytes.length,seconds:v.seconds,audioHash:sha(bytes),manifestHash:p.manifestHash,receiptComplete:!!receipt,accounted:p.parts.every(x=>x.accounted)};
}
export async function previewVoiceAssembly(input:z.infer<typeof VoiceAssemblyAsk>){const p=await assemblyPlan(input);return {input:p.input,hash:p.hash,title:p.preparation.input.title,model:p.preparation.input.model,...(p.preparation.input.tts?{tts:p.preparation.input.tts}:{}),parts:p.parts.map(x=>({part:x.part,bytes:x.receipt.bytes,seconds:x.receipt.seconds,audioHash:x.receipt.audioHash})),totalBytes:p.totalBytes,existing:await assemblyResult(p),notice:'Локальная сборка всех сохранённых частей по порядку через FFmpeg без перекодирования, эффектов, AI и повторной оплаты. Исходники не заменяются. В проект итог добавляется отдельно. Разные форматы блокируются.'};}
async function concatMp3(p:AssemblyPlan):Promise<Buffer>{
 checkCancelled();const bin=ffmpegPath();if(!bin)throw new ApiError('VALIDATION','Для локальной сборки нужен FFmpeg. Установите его и перезапустите TubeStudio; TTS повторять не нужно.',400);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tubestudio-assembly-'));await fs.chmod(dir,0o700);
 try{
  const lines=[];for(const item of p.parts){checkCancelled();const a=(await attempt({...p.input,part:item.part}))!,bytes=(await read(audioPath(a),MAX))!;if(!bytes||sha(bytes)!==item.receipt.audioHash)throw problem('Исходная часть изменилась. Сборка остановлена.');const name='part_'+item.part+'.mp3';await fs.writeFile(path.join(dir,name),bytes,{flag:'wx',mode:0o600});lines.push("file '"+name+"'");}
  await fs.writeFile(path.join(dir,'list.txt'),lines.join('\n'),{flag:'wx',mode:0o600});
  await new Promise<void>((resolve,reject)=>{
   const signal=taskSignal(),child=spawn(bin,['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist','file','-f','concat','-safe','1','-i','list.txt','-map','0:a:0','-c:a','copy','-map_metadata','-1','-write_xing','1','-id3v2_version','3','-fs',String(ASSEMBLY_MAX+1),'-y','out.mp3'],{cwd:dir,stdio:['ignore','ignore','ignore']});let timedOut=false;
   const stop=()=>{child.kill('SIGKILL');},timer=setTimeout(()=>{timedOut=true;stop();},120000);signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
   const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);};
   child.once('error',()=>{cleanup();reject(signal?.aborted?cancellation():problem('FFmpeg не удалось запустить. Исходники не меняются.'));});
   child.once('close',code=>{cleanup();if(signal?.aborted)reject(cancellation());else if(code!==0||timedOut)reject(problem('Локальная сборка FFmpeg не завершена. Исходники сохранены, запросов к модели нет.'));else resolve();});
  });
  checkCancelled();const st=await fs.stat(path.join(dir,'out.mp3'));if(st.size>ASSEMBLY_MAX)throw problem('Итоговый MP3 превышает 128 МиБ.');const bytes=await fs.readFile(path.join(dir,'out.mp3'));validateAudio(bytes,ASSEMBLY_MAX);return bytes;
 }finally{await fs.rm(dir,{recursive:true,force:true});}
}
export async function assembleVoice(input:z.infer<typeof VoiceAssemblySend>,ctx:JobCtx){const d=VoiceAssemblySend.parse(input);return exclusive(()=>withTaskSignal(ctx.signal,async()=>{
 const ask={projectId:d.projectId,preparationId:d.preparationId},p=await assemblyPlan(ask),existing=await assemblyResult(p);
 // Exact completed/recoverable results can be reused after a lost response, without FFmpeg or AI.
 if(!existing&&p.hash!==d.previewHash)throw problem('Проект или части изменились. Обновите предпросмотр сборки.');
 checkCancelled();if(!existing){ctx.progress('Локальная сборка сохранённых частей без AI',20);const files=await fs.readdir(dataPath('assistant-voice'));if(files.filter(x=>x.endsWith('.assembly-output.json')).length>=500&&!await load(recordPath(p.id,'assembly-output'),AssemblyReceipt))throw problem('Достигнут лимит 500 сборок.');const bytes=await concatMp3(p);checkCancelled();const current=await assemblyPlan(ask);if(current.manifestHash!==p.manifestHash)throw problem('Источники изменились во время сборки.');const descriptor=await load(recordPath(p.id,'assembly-output'),AssemblyReceipt),v=validateAudio(bytes,ASSEMBLY_MAX);if(descriptor&&(descriptor.audioHash!==sha(bytes)||descriptor.bytes!==bytes.length||descriptor.seconds!==v.seconds))throw problem('Повторная локальная сборка отличается от сохранённого снимка. Исходники не меняются.');if(!descriptor)await publish(recordPath(p.id,'assembly-output'),JSON.stringify(AssemblyReceipt.parse({version:1,id:p.id,manifestHash:p.manifestHash,audioHash:sha(bytes),bytes:bytes.length,seconds:v.seconds,createdAt:new Date().toISOString()})));await publish(p.file,bytes);}
 const result=(await assemblyResult(p))!;if(!result.receiptComplete){await publish(recordPath(p.id,'assembly'),JSON.stringify((await load(recordPath(p.id,'assembly-output'),AssemblyReceipt))!));}
 ctx.progress('Единый MP3 сохранён. В проект автоматически не добавлен.',100);return (await assemblyResult(p))!;
 })).catch(e=>{if(e instanceof ApiError)throw e;throw problem('Локальная сборка не завершена. Проверьте сохранённый результат без AI; исходные части не меняются.');});}
async function assemblyAttachment(input:z.infer<typeof VoiceAssemblyAsk>){
 const p=await assemblyPlan(input),result=await assemblyResult(p);if(!result?.receiptComplete)throw problem('Сначала завершите или восстановите локальную сборку.');
 let time=0;const segments=p.parts.map(x=>{const start=time;time+=x.receipt.seconds;return {n:x.part,start:Math.round(start*100)/100,end:Math.round(time*100)/100,text:x.text};});
 const receipt=(await load(recordPath(p.id,'assembly'),AssemblyReceipt))!,existing=p.project.artifacts.filter(x=>(x.data as any)?.assistantVoiceAssemblyKey===p.id);if(existing.length>1)throw problem('Неоднозначные копии итогового аудио.');
 const artifact={id:p.id,kind:'audio',title:('Озвучка целиком · '+p.preparation.input.title).slice(0,300),createdAt:receipt.createdAt,version:p.project.artifacts.filter(x=>x.kind==='audio').length+1,data:{source:'assistant-voice-assembly',assistantVoiceAssemblyKey:p.id,preparationId:p.preparationId,sourceArtifactId:p.preparation.sourceArtifact.id,model:p.preparation.input.model,...(p.preparation.input.tts?{tts:p.preparation.input.tts}:{}),title:p.preparation.input.title,url:p.url,bytes:result.bytes,seconds:result.seconds,chars:p.preparation.chars,chunks:p.parts.length,segments,segmentTiming:'approximate-from-parts',balanceTokens:null,audioHash:result.audioHash,manifestHash:p.manifestHash,projectId:p.input.projectId},files:[path.basename(p.file)]};
 return {...p,result,artifact,existing:existing[0],attachmentHash:digest({input:p.input,snapshot:p.snapshot,receipt,artifact})};
}
export async function previewVoiceAssemblyAttachment(input:z.infer<typeof VoiceAssemblyAsk>){const p=await assemblyAttachment(input);return {input:p.input,hash:p.attachmentHash,artifact:p.artifact,alreadySaved:!!p.existing,notice:'Добавить готовый единый MP3 новой записью. Старые материалы остаются. AI и FFmpeg не вызываются. Таймкоды сегментов приблизительны по длительностям частей, не выравнивание речи.'};}
export async function attachVoiceAssembly(input:z.infer<typeof VoiceAssemblySend>){const d=VoiceAssemblySend.parse(input);return withProjectMutation(async()=>{
 const p=await assemblyAttachment({projectId:d.projectId,preparationId:d.preparationId});if(p.existing)return {projectId:d.projectId,artifact:p.existing,alreadySaved:true};if(p.attachmentHash!==d.previewHash)throw problem('Проект изменился. Обновите просмотр итогового аудио.');
 const bytes=JSON.stringify({...p.project,updatedAt:new Date().toISOString(),artifacts:[...p.project.artifacts,p.artifact]},null,2);if(Buffer.byteLength(bytes)>10*1024*1024)throw problem('Проект превысит 10 МиБ.');const tmp=p.target+'.'+crypto.randomUUID()+'.tmp';try{checkCancelled();await fs.writeFile(tmp,bytes,{flag:'wx',mode:0o600});checkCancelled();if((await assistantProjectSnapshot(d.projectId)).snapshot!==p.snapshot)throw problem('Проект изменился.');await fs.rename(tmp,p.target);}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}return {projectId:d.projectId,artifact:p.artifact,alreadySaved:false};
 });}

// Internal local-only bridge: a verified completed assembly, never a provider selection.
export const voiceLocalIO={read,load,publish,validateAudio,recordPath,exclusive};
export async function voiceAssemblySource(input:z.infer<typeof VoiceAssemblyAsk>){const p=await assemblyPlan(input),result=await assemblyResult(p);if(!result?.receiptComplete)throw problem('Сначала сохраните или восстановите единый MP3. Обработка не запускает TTS.');const bytes=await read(p.file,ASSEMBLY_MAX);if(!bytes||sha(bytes)!==result.audioHash)throw problem('Исходный MP3 изменился.');return {...p,result,bytes};}
