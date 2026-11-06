// Read and recompose saved plan before any side-effecting action.
import {createHash} from 'node:crypto';import {z} from 'zod';import {ApiError} from '../../lib/errors.js';import {assistantProjectSnapshot} from '../assistant.js';
import {BrandRecovery} from './brainstormBrandSave.js';import {buildBrandPlan} from './brainstormBrandPlan.js';import {loadBrainstormSelectedIdea} from './brainstormSelectedIdea.js';
const digest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');const fail=()=>new ApiError('VALIDATION','Черновик, выбранная идея или исходные данные изменены либо повреждены. Задания не отправлены.',409);
export async function loadBrainstormBrandPlan(projectId:string,artifactId:string){
 z.string().uuid().parse(projectId);z.string().uuid().parse(artifactId);const snap=await assistantProjectSnapshot(projectId),found=snap.project.artifacts.filter(a=>a.id===artifactId&&(a.data as any)?.source==='brainstorm-brand-plan');if(found.length!==1)throw fail();const d=found[0].data as any;
 const r=BrandRecovery.safeParse({projectId,attemptId:d.attemptId,ideasArtifactId:d.ideasArtifactId,selectedIndex:d.selectedIndex,ideasHash:d.ideasHash,startDate:d.startDate,proposal:d.proposal});if(!r.success||digest(r.data)!==d.planHash)throw fail();
 const selected=await loadBrainstormSelectedIdea(projectId,r.data.ideasArtifactId,r.data.selectedIndex);if(selected.projectSnapshot!==snap.snapshot||selected.ideasHash!==r.data.ideasHash)throw fail();let plan;try{plan=buildBrandPlan(r.data.proposal,r.data.startDate);}catch{throw fail();}if(digest(plan)!==digest(d.plan))throw fail();return {project:snap.project,projectSnapshot:snap.snapshot,plan,planHash:d.planHash,artifactId};
}
