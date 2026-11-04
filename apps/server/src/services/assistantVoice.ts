import {SpeechSelection,describeSpeechConnection} from './ttsConnections.js';
/** Local-only voice preparation. No provider, jobs, secrets, or audio generation. */
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {z} from 'zod';
import {ApiError} from '../lib/errors.js';
import {checkCancelled} from '../lib/taskContext.js';
import {assistantProjectSnapshot} from './assistant.js';
import {withProjectMutation} from './projects.js';
import {cleanForTts,chunkText} from './tts.js';
const ID=z.string().uuid(),Hash=z.string().regex(/^[a-f0-9]{64}$/);
const digest=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const problem=(s:string)=>new ApiError('VALIDATION',s,409);
export const VoicePreparationAsk=z.object({projectId:ID,sourceArtifactId:ID,title:z.string().trim().min(1).max(160),language:z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/),model:z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9/._:-]*$/),headings:z.literal(false),speed:z.number().min(0.5).max(2),pitch:z.number().int().min(-6).max(6),tts:SpeechSelection.optional()}).strict();
export const VoicePreparationSend=VoicePreparationAsk.extend({previewHash:Hash,confirmed:z.literal(true)}).strict();
export async function assistantVoiceScripts(projectId:string){
 const {project}=await assistantProjectSnapshot(ID.parse(projectId));
 return {project:{id:project.id,title:project.title},scripts:project.artifacts.filter(a=>a.kind==='script').map(a=>({id:a.id,title:a.title,version:a.version??null,createdAt:a.createdAt})),notice:'Выберите конкретную версию. Последняя версия не выбирается автоматически.'};
}
async function plan(input:z.infer<typeof VoicePreparationAsk>){
 const d=VoicePreparationAsk.parse(input),connection=d.tts?await describeSpeechConnection(d.tts):null,snap=await assistantProjectSnapshot(d.projectId);
 const matches=snap.project.artifacts.filter(a=>a.id===d.sourceArtifactId);
 if(matches.length!==1||matches[0].kind!=='script')throw problem('Нужна ровно одна выбранная версия сценария в этом проекте.');
 const source=matches[0],raw=source.data as any,text=typeof raw==='string'?raw:raw?.script;
 if(typeof text!=='string'||!text.trim()||text.length>120000)throw problem('Нет корректного текста сценария (до 120 000 символов).');
 const cleaned=cleanForTts(text,{headings:d.headings}),chunks=chunkText(cleaned,!d.tts&&d.model.startsWith('fish-farm/')?1200:1800);
 if(!cleaned.trim()||!chunks.length)throw problem('После очистки не осталось текста для озвучки.');
 const sourceHash=digest(source),key=digest({input:d,sourceHash});
 const payload={source:'assistant-voice-preparation' as const,version:1 as const,preparationKey:key,input:d,sourceArtifact:{id:source.id,title:source.title,version:source.version??null,hash:sourceHash},originalText:text,cleanedText:cleaned,chunks,chars:cleaned.length,receiver:connection?connection.baseUrl+'/audio/speech':'AnyModel (существующий модуль TTS)',modelVerified:false,audioGenerated:false};
 const hash=digest({payload,snapshot:snap.snapshot});
 return {...snap,input:d,payload,hash};
}
export async function previewAssistantVoice(input:z.infer<typeof VoicePreparationAsk>){
 const p=await plan(input);return {hash:p.hash,project:{id:p.project.id,title:p.project.title},...p.payload,notice:'Только локальная подготовка: модель и доступность голоса не проверялись. Аудио не создаётся. Проверьте весь очищенный текст, язык и точный ID голоса. Подключения текстовых моделей здесь не используются.'};
}
export async function saveAssistantVoice(input:z.infer<typeof VoicePreparationSend>){
 const d=VoicePreparationSend.parse(input),{previewHash,confirmed,...ask}=d;
 return withProjectMutation(async()=>{
  const p=await plan(ask);
  const duplicates=p.project.artifacts.filter(a=>(a.data as any)?.source==='assistant-voice-preparation'&&(a.data as any)?.preparationKey===p.payload.preparationKey);
  if(duplicates.length){if(duplicates.length===1&&(duplicates[0].data as any)?.confirmedPreviewHash===previewHash)return {projectId:d.projectId,artifact:duplicates[0],alreadySaved:true};throw problem('Такая подготовка уже сохранена. Откройте проект; повторная запись не выполнена.');}
  if(p.hash!==previewHash)throw problem('Проект или параметры изменились. Обновите предпросмотр; ничего не записано.');
  const artifact={id:crypto.randomUUID(),kind:'note',title:d.title,createdAt:new Date().toISOString(),version:p.project.artifacts.filter(a=>a.kind==='note').length+1,data:{...p.payload,confirmedPreviewHash:previewHash}};
  const bytes=JSON.stringify({...p.project,updatedAt:new Date().toISOString(),artifacts:[...p.project.artifacts,artifact]},null,2);
  if(Buffer.byteLength(bytes)>10*1024*1024)throw problem('Проект превысит 10 МиБ. Ничего не записано.');
  const tmp=p.target+'.'+crypto.randomUUID()+'.tmp';
  try{checkCancelled();await fs.writeFile(tmp,bytes,{flag:'wx',mode:0o600});checkCancelled();if((await assistantProjectSnapshot(d.projectId)).snapshot!==p.snapshot)throw problem('Проект изменился. Обновите предпросмотр.');checkCancelled();await fs.rename(tmp,p.target);}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
  return {projectId:d.projectId,artifact,alreadySaved:false};
 });
}
