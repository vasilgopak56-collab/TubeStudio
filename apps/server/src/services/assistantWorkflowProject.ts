import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {z} from 'zod';
import {ApiError} from '../lib/errors.js';
import {checkCancelled} from '../lib/taskContext.js';
import {assistantProjectSnapshot} from './assistant.js';
import {withProjectMutation} from './projects.js';
import {previewWorkflowExport,withWorkflowMutation} from './assistantWorkflow.js';
const ID=z.string().uuid(),Hash=z.string().regex(/^[a-f0-9]{64}$/);
const digest=(x:unknown)=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=(message:string,status:400|409|413=409)=>new ApiError('VALIDATION',message,status);
export const WorkflowProjectAsk=z.object({id:ID,revision:z.number().int().min(1),projectId:ID,title:z.string().trim().min(1).max(200)}).strict();
export const WorkflowProjectSend=WorkflowProjectAsk.extend({previewHash:Hash,confirmed:z.literal(true)}).strict();
async function plan(input:z.infer<typeof WorkflowProjectAsk>){
 const d=WorkflowProjectAsk.parse(input),exp=await previewWorkflowExport({id:d.id,revision:d.revision}),snap=await assistantProjectSnapshot(d.projectId);
 const resultKey=digest({workflowId:d.id,revision:d.revision,exportSha256:exp.sha256});
 if(snap.project.artifacts.some(x=>(x.data as any)?.workflowResultKey===resultKey))throw fail('Этот снимок процесса уже добавлен в проект. Повторная запись не создаётся.');
 const id=resultKey.slice(0,8)+'-'+resultKey.slice(8,12)+'-4'+resultKey.slice(13,16)+'-a'+resultKey.slice(17,20)+'-'+resultKey.slice(20,32);
 const artifact={id,kind:'note' as const,title:d.title,version:snap.project.artifacts.filter(x=>x.kind==='note').length+1,data:{source:'assistant-workflow-results',workflowResultKey:resultKey,workflowId:d.id,revision:d.revision,sha256:exp.sha256,text:exp.text}};
 const hash=digest({input:d,projectSnapshot:snap.snapshot,artifact});
 return {input:d,exp,snap,artifact,hash};
}
export async function previewWorkflowProject(input:z.infer<typeof WorkflowProjectAsk>){const p=await plan(input);return {input:p.input,hash:p.hash,project:{id:p.snap.project.id,title:p.snap.project.title,updatedAt:p.snap.project.updatedAt},artifact:p.artifact,accepted:p.exp.accepted,total:p.exp.total,phase:p.exp.phase,notice:'Создаётся отдельная заметка с точным JSON, а не сценарий или медиа. Старые записи сохраняются; исходный процесс не меняется. Непринятые результаты не включены. Текст может содержать приватные данные.'};}
export async function saveWorkflowProject(input:z.infer<typeof WorkflowProjectSend>){
 const {previewHash,confirmed,...ask}=WorkflowProjectSend.parse(input);
 return withWorkflowMutation(()=>withProjectMutation(async()=>{
  checkCancelled();const p=await plan(ask);if(p.hash!==previewHash)throw fail('Процесс, проект или параметры изменились после просмотра. Повторите просмотр.');
  const artifact={...p.artifact,createdAt:new Date().toISOString()},project={...p.snap.project,updatedAt:new Date().toISOString(),artifacts:[...p.snap.project.artifacts,artifact]},bytes=JSON.stringify(project,null,2);
  if(Buffer.byteLength(bytes)>10*1024*1024)throw fail('После добавления проект превысит 10 МиБ. Ничего не записано.',413);
  const tmp=p.snap.target+'.'+crypto.randomUUID()+'.tmp';
  try{checkCancelled();await fs.writeFile(tmp,bytes,{flag:'wx',mode:0o600});const current=await assistantProjectSnapshot(ask.projectId);if(current.snapshot!==p.snap.snapshot)throw fail('Проект изменился. Повторите просмотр.');checkCancelled();await fs.rename(tmp,p.snap.target);}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
  return {projectId:project.id,artifact};
 }));
}
