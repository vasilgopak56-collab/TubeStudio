// Persist the search proposal separately; it is not a YouTube result.
import {createHash,randomUUID} from 'node:crypto';import fs from 'node:fs/promises';import {z} from 'zod';
import {ApiError} from '../../lib/errors.js';import {checkCancelled} from '../../lib/taskContext.js';import {assistantProjectSnapshot} from '../assistant.js';import {withProjectMutation} from '../projects.js';import {validateBrainstormSearchProposal} from './brainstormPlanning.js';
const uuid=z.string().uuid(),t=(n:number)=>z.string().trim().min(1).max(n);
export const PlanningRecovery=z.object({projectId:uuid,attemptId:uuid,runId:uuid,task:z.string().trim().min(10).max(10000),region:z.string().regex(/^[A-Z]{2}$/),queries:z.array(z.object({direction:t(100),query:t(160)}).strict()).length(70),topics:z.array(t(160)).min(20).max(30),model:t(180)}).strict().refine(x=>x.attemptId!==x.runId);
const digest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex'),problem=(m:string,status:409|413=409)=>new ApiError('VALIDATION',m,status);
async function commit(from:string,to:string){for(let i=0;;i++){checkCancelled();try{await fs.rename(from,to);return;}catch(e){if(!['EPERM','EBUSY','EACCES'].includes((e as NodeJS.ErrnoException).code??'')||i>=7)throw e;await new Promise(r=>setTimeout(r,25*2**i));}}}
export async function saveBrainstormSearchPlan(raw:z.infer<typeof PlanningRecovery>){
 const d=PlanningRecovery.parse(raw),{scan,topics}=validateBrainstormSearchProposal({queries:d.queries,topics:d.topics},d.region),plan={projectId:d.projectId,runId:d.runId,task:d.task,scan,topics},planHash=digest(d);
 return withProjectMutation(async()=>{
  checkCancelled();const snap=await assistantProjectSnapshot(d.projectId);const old=snap.project.artifacts.filter(a=>(a.data as any)?.source==='brainstorm-search-plan'&&(a.data as any)?.attemptId===d.attemptId);
  if(old.length){if(old.length!==1||(old[0].data as any)?.planHash!==planHash)throw problem('Этот запуск уже сохранён с другими данными.');return {projectId:d.projectId,artifact:old[0],alreadySaved:true};}
  if(snap.project.artifacts.some(a=>(a.data as any)?.source==='brainstorm-search-plan'&&(a.data as any)?.plan?.runId===d.runId))throw problem('Для этого поиска уже сохранён план. Ничего не изменено.');
  const now=new Date().toISOString(),artifact={id:randomUUID(),kind:'analysis' as const,title:'Мозговой штурм: план исследования',createdAt:now,version:snap.project.artifacts.filter(a=>a.kind==='analysis').length+1,data:{source:'brainstorm-search-plan',attemptId:d.attemptId,model:d.model,planHash,plan}};
  const bytes=JSON.stringify({...snap.project,updatedAt:now,artifacts:[...snap.project.artifacts,artifact]},null,2);if(Buffer.byteLength(bytes)>10*1024*1024)throw problem('Проект превысит 10 МиБ. План не добавлен.',413);
  const tmp=snap.target+'.'+randomUUID()+'.tmp';try{checkCancelled();await fs.writeFile(tmp,bytes,{flag:'wx',mode:0o600});if((await assistantProjectSnapshot(d.projectId)).snapshot!==snap.snapshot)throw problem('Проект изменился во время сохранения. План не добавлен.');checkCancelled();await commit(tmp,snap.target);}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}return {projectId:d.projectId,artifact,alreadySaved:false};
 });
}
/** Revalidate the stored proposal and its integrity before free YouTube collection. */
export async function loadBrainstormSearchPlan(projectId:string,artifactId:string){
 uuid.parse(projectId);uuid.parse(artifactId);const snap=await assistantProjectSnapshot(projectId),rows=snap.project.artifacts.filter(a=>a.id===artifactId&&(a.data as any)?.source==='brainstorm-search-plan');if(rows.length!==1)throw problem('Сохранённый план исследования не найден.');const d=rows[0].data as any,p=d.plan;
 const r=PlanningRecovery.safeParse({projectId,attemptId:d.attemptId,runId:p?.runId,task:p?.task,region:p?.scan?.region,queries:p?.scan?.queries,topics:p?.topics?.queries,model:d.model});if(!r.success||p?.projectId!==projectId||p?.topics?.region!==r.data.region||digest(r.data)!==d.planHash)throw problem('План исследования изменён или повреждён. Поиск не запущен.');
 let checked;try{checked=validateBrainstormSearchProposal({queries:r.data.queries,topics:r.data.topics},r.data.region);}catch{throw problem('План исследования повреждён. Поиск не запущен.');}
 const plan={projectId,runId:r.data.runId,task:r.data.task,...checked};if(digest(plan)!==digest(p))throw problem('План исследования изменён или повреждён. Поиск не запущен.');return {project:snap.project,projectSnapshot:snap.snapshot,artifactId,plan,planHash:d.planHash};
}
