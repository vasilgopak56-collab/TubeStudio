import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {z} from 'zod';
import {ApiError} from '../lib/errors.js';
import {checkCancelled} from '../lib/taskContext.js';
import {assistantAppendPlan,assistantProjectSnapshot,loadAssistant} from './assistant.js';
import {loadWorkflow,withWorkflowMutation} from './assistantWorkflow.js';
import {withProjectMutation} from './projects.js';
const ID=z.string().uuid(),Hash=z.string().regex(/^[a-f0-9]{64}$/),digest=(x:unknown)=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=(message:string,status:400|409|413=409)=>new ApiError('VALIDATION',message,status);
const Base=z.object({id:ID,revision:z.number().int().min(1),projectId:ID,items:z.array(z.object({position:z.number().int().min(1).max(6),title:z.string().trim().min(1).max(200)}).strict()).min(1).max(6)}).strict();
const ordered=(d:z.infer<typeof Base>)=>d.items.every((x,i)=>i===0||d.items[i-1].position<x.position);
export const WorkflowBatchAsk=Base.refine(ordered,'Выберите разные позиции по порядку.');
export const WorkflowBatchSend=Base.extend({previewHash:Hash,confirmed:z.literal(true)}).strict().refine(ordered,'Выберите разные позиции по порядку.');
async function plan(raw:z.infer<typeof WorkflowBatchAsk>){
 const input=WorkflowBatchAsk.parse(raw),workflow=await loadWorkflow(input.id);if(workflow.revision!==input.revision)throw fail('Процесс изменился. Обновите контрольную точку.');
 const snap=await assistantProjectSnapshot(input.projectId),seen=new Set<string>(),counts={script:snap.project.artifacts.filter(x=>x.kind==='script').length,note:snap.project.artifacts.filter(x=>x.kind==='note').length};
 const artifacts=[];
 for(const item of input.items){
  const step=workflow.steps[item.position-1],receipt=workflow.accepted[item.position-1];
  if(!step||!receipt||receipt.step!==item.position-1||step.task==='routine')throw fail('Выбирайте только принятые авторские шаги; рутинный или непринятый шаг недоступен.');
  const run=await loadAssistant(receipt.runId),last=run.messages.at(-1);if(run.rootId!==workflow.rootId||!last||last.role!=='assistant'||last.task!==step.task||!last.output||last.output.questions.length||!last.output.deliverable.trim())throw fail('Принятый результат недоступен или не соответствует шагу. Пакет не создан.');
  const candidate=await assistantAppendPlan({runId:run.id,projectId:input.projectId,title:item.title});if(candidate.snapshot!==snap.snapshot)throw fail('Проект изменился. Повторите просмотр.');
  const key=candidate.artifact.data.assistantResultKey;if(seen.has(key)||snap.project.artifacts.some(x=>x.id===candidate.artifact.id))throw fail('Результат или его идентификатор уже присутствует. Пакет не создан.');seen.add(key);
  const kind=candidate.artifact.kind;if(kind!=='script'&&kind!=='note')throw fail('Неподдерживаемый тип результата.');counts[kind]++;
  artifacts.push({...candidate.artifact,version:counts[kind],data:{...candidate.artifact.data,workflowOrigin:{workflowId:workflow.id,revision:workflow.revision,position:item.position,acceptedAt:receipt.acceptedAt}}});
 }
 const again=await loadWorkflow(input.id);if(digest(again)!==digest(workflow))throw fail('Процесс изменился. Повторите просмотр.');
 return {input,workflow,snap,artifacts,hash:digest({input,workflow,projectSnapshot:snap.snapshot,artifacts})};
}
export async function previewWorkflowBatch(input:z.infer<typeof WorkflowBatchAsk>){const p=await plan(input);return {input:p.input,hash:p.hash,project:{id:p.snap.project.id,title:p.snap.project.title},artifacts:p.artifacts,notice:'Выбранные принятые сценарии станут версиями сценария; image/video-промпты — текстовыми заметками. Другие шаги не переносятся. Старые материалы и процесс сохраняются. Пакет не запускает AI или медиа. Источники и сведения об ответе тоже сохраняются; проверьте весь состав и приватность.'};}
export async function saveWorkflowBatch(raw:z.infer<typeof WorkflowBatchSend>){const {previewHash,confirmed,...ask}=WorkflowBatchSend.parse(raw);return withWorkflowMutation(()=>withProjectMutation(async()=>{
 checkCancelled();const p=await plan(ask);if(p.hash!==previewHash)throw fail('Процесс, проект или выбор изменились после просмотра. Повторите просмотр.');
 const project={...p.snap.project,updatedAt:new Date().toISOString(),artifacts:[...p.snap.project.artifacts,...p.artifacts]},bytes=JSON.stringify(project,null,2);if(Buffer.byteLength(bytes)>10*1024*1024)throw fail('Пакет превысит лимит проекта 10 МиБ. Ничего не записано.',413);
 const tmp=p.snap.target+'.'+crypto.randomUUID()+'.tmp';try{checkCancelled();await fs.writeFile(tmp,bytes,{flag:'wx',mode:0o600});const current=await assistantProjectSnapshot(ask.projectId);if(current.snapshot!==p.snap.snapshot)throw fail('Проект изменился. Повторите просмотр.');checkCancelled();await fs.rename(tmp,p.snap.target);}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}return {projectId:project.id,artifacts:p.artifacts};
}));}
