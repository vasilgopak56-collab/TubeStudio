// Save a generated plan only after validating the report that the user chose.
import {createHash,randomUUID} from 'node:crypto';import fs from 'node:fs/promises';import {z} from 'zod';
import {ApiError} from '../../lib/errors.js';import {checkCancelled} from '../../lib/taskContext.js';import {assistantProjectSnapshot} from '../assistant.js';import {withProjectMutation} from '../projects.js';
import {BrandPlanProposal,buildBrandPlan} from './brainstormBrandPlan.js';import {loadBrainstormSelectedIdea} from './brainstormSelectedIdea.js';
const uuid=z.string().uuid();export const BrandRecovery=z.object({projectId:uuid,attemptId:uuid,ideasArtifactId:uuid,selectedIndex:z.number().int().min(0).max(7),ideasHash:z.string().regex(/^[a-f0-9]{64}$/),startDate:z.string(),proposal:BrandPlanProposal}).strict();
const digest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');const fail=(m:string,status:409|413=409)=>new ApiError('VALIDATION',m,status);
async function commitFile(from:string,to:string){for(let i=0;;i++){checkCancelled();try{await fs.rename(from,to);return;}catch(e){if(!['EPERM','EBUSY','EACCES'].includes((e as NodeJS.ErrnoException).code??'')||i>=7)throw e;await new Promise(r=>setTimeout(r,25*2**i));}}}
export async function saveBrainstormBrandPlan(raw:z.infer<typeof BrandRecovery>){
 const d=BrandRecovery.parse(raw),plan=buildBrandPlan(d.proposal,d.startDate),planHash=digest(d);
 return withProjectMutation(async()=>{
  checkCancelled();const selected=await loadBrainstormSelectedIdea(d.projectId,d.ideasArtifactId,d.selectedIndex);if(selected.ideasHash!==d.ideasHash)throw fail('Выбранная идея или её источники изменились. Черновик не добавлен.');
  const snap=await assistantProjectSnapshot(d.projectId);if(snap.snapshot!==selected.projectSnapshot)throw fail('Проект изменился. Черновик не добавлен.');
  const existing=snap.project.artifacts.filter(a=>(a.data as any)?.source==='brainstorm-brand-plan'&&(a.data as any)?.attemptId===d.attemptId);
  if(existing.length){if(existing.length!==1||(existing[0].data as any)?.planHash!==planHash)throw fail('Этот запуск уже сохранён с другими данными.');return {projectId:d.projectId,artifact:existing[0],alreadySaved:true};}
  const now=new Date().toISOString(),artifact={id:randomUUID(),kind:'analysis' as const,title:'Мозговой штурм: оформление и план',createdAt:now,version:snap.project.artifacts.filter(a=>a.kind==='analysis').length+1,data:{source:'brainstorm-brand-plan',attemptId:d.attemptId,ideasArtifactId:d.ideasArtifactId,selectedIndex:d.selectedIndex,ideasHash:d.ideasHash,startDate:d.startDate,proposal:d.proposal,planHash,plan}};
  const bytes=JSON.stringify({...snap.project,updatedAt:now,artifacts:[...snap.project.artifacts,artifact]},null,2);if(Buffer.byteLength(bytes)>10*1024*1024)throw fail('Проект превысит 10 МиБ. Черновик не добавлен.',413);
  const tmp=snap.target+'.'+randomUUID()+'.tmp';try{checkCancelled();await fs.writeFile(tmp,bytes,{flag:'wx',mode:0o600});if((await assistantProjectSnapshot(d.projectId)).snapshot!==snap.snapshot)throw fail('Проект изменился во время сохранения. Черновик не добавлен.');checkCancelled();await commitFile(tmp,snap.target);}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
  return {projectId:d.projectId,artifact,alreadySaved:false};
 });
}
