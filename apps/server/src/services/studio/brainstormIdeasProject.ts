// Internal project-aware coordinator. Not yet a user-facing route.
import {createHash} from 'node:crypto';import {z} from 'zod';
import {ApiError} from '../../lib/errors.js';import {checkCancelled,rethrowCancelled,taskContext,withStoryboardGuard,withTaskSignal} from '../../lib/taskContext.js';import type {JobCtx} from '../../lib/jobs.js';
import {getChannel} from './channels.js';import {loadBrainstormProjectEvidence} from './brainstormProjectEvidence.js';
import {previewBrainstormIdeas,runBrainstormIdeas} from './brainstormIdeas.js';import {saveBrainstormIdeaReport} from './brainstormReportSave.js';import {stageBrainstormResult} from './brainstormRecovery.js';
const Ask=z.object({projectId:z.string().uuid(),evidenceArtifactId:z.string().uuid(),attemptId:z.string().uuid(),model:z.string().trim().min(1).max(180).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/)}).strict();
const Send=Ask.extend({previewHash:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)}).strict();
type AskT=z.infer<typeof Ask>;type ModelIO=NonNullable<Parameters<typeof runBrainstormIdeas>[4]>;
type IO={model?:ModelIO;save:typeof saveBrainstormIdeaReport;stage?:typeof stageBrainstormResult};const defaults:IO={save:saveBrainstormIdeaReport};
const digest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function prepare(raw:AskT,io:IO){
 const input=Ask.parse(raw),loaded=await loadBrainstormProjectEvidence(input.projectId,input.evidenceArtifactId);
 const cid=loaded.project.channelId;if(cid!==undefined&&typeof cid!=='string')throw new ApiError('VALIDATION','Связь с каналом повреждена. Модель не запускалась.',409);
 const ch=cid?await getChannel(cid):null,channel=ch?{name:ch.name,niche:ch.niche,language:ch.language,format:ch.format}:null;
 const modelInput={projectId:input.projectId,attemptId:input.attemptId,task:loaded.task,channel,model:input.model};
 const p=await previewBrainstormIdeas(modelInput,loaded.scan,loaded.topics,io.model),hash=digest({input,projectSnapshot:loaded.projectSnapshot,channelId:cid??null,modelPreview:p.previewHash});
 return {input,loaded,modelInput,p,hash};
}
export async function previewBrainstormProjectIdeas(raw:AskT,io:IO=defaults){
 const p=await prepare(raw,io);return {input:p.input,project:{id:p.loaded.project.id,title:p.loaded.project.title},channel:p.modelInput.channel,context:p.p.context,cost:p.p.cost,hash:p.hash,notice:'Один текстовый запрос к AnyModel по сохранённым наблюдениям; затем отчёт добавится в этот проект. Это не полная стоимость мозгового штурма. Канал, календарь и G-Labs не изменяются.'};
}
export async function runBrainstormProjectIdeas(raw:z.infer<typeof Send>,ctx:JobCtx,io:IO=defaults){
 const {previewHash,confirmed,...ask}=Send.parse(raw);
 return withTaskSignal(ctx.signal,async()=>{
  checkCancelled();const p=await prepare(ask,io);if(p.hash!==previewHash)throw new ApiError('VALIDATION','Проект, канал, данные или тариф изменились. Обновите просмотр; модель не запускалась.',409);
  const previous=taskContext()?.verifyStoryboard;
  const guard=async()=>{checkCancelled();await previous?.();const current=await prepare(ask,io);if(current.hash!==p.hash)throw new ApiError('VALIDATION','Проект, канал, данные или тариф изменились во время ожидания. Модель не запускалась.',409);};
  const result=await withStoryboardGuard(guard,()=>runBrainstormIdeas({...p.modelInput,previewHash:p.p.previewHash,confirmed:true},p.loaded.scan,p.loaded.topics,ctx,io.model));
  const recovery={projectId:ask.projectId,attemptId:ask.attemptId,evidenceArtifactId:ask.evidenceArtifactId,evidenceHash:result.evidenceHash,proposal:result.proposal};
  ctx.partial({stage:'report-save',recovery,unsavedReport:result.report});
  try{checkCancelled();await (io.stage??stageBrainstormResult)(recovery,result.model);}catch(e){rethrowCancelled(e,ctx.signal);return {status:'unsaved' as const,recovery,report:result.report,notice:'Ответ модели получен, но его не удалось сохранить на диск. Не запускайте модель повторно; сохраните показанный результат. Он может исчезнуть при закрытии программы.'};}
  try{checkCancelled();ctx.progress('Сохраняю отчёт в проект',98);const saved=await io.save(recovery);ctx.progress('Отчёт сохранён',100);return {status:'saved' as const,projectId:saved.projectId,artifactId:saved.artifact.id,model:result.model,notice:'Отчёт с идеями сохранён. Оценки — предположения, данные могут быть неполными.'};}
  catch(e){rethrowCancelled(e,ctx.signal);return {status:'recoverable' as const,attemptId:ask.attemptId,notice:'Ответ модели сохранён на диске, но пока не добавлен в проект. Его можно восстановить без повторного платного запроса; исходные данные исследования должны оставаться доступными.'};}
 });
}
