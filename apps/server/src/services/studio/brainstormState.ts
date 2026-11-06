// Compact validated project state for reconnecting to a brainstorm.
import {z} from 'zod';import {ApiError} from '../../lib/errors.js';import {assistantProjectSnapshot} from '../assistant.js';import {loadBrainstormSearchPlan} from './brainstormPlanningSave.js';import {loadBrainstormProjectEvidence} from './brainstormProjectEvidence.js';import {loadBrainstormSelectedIdea} from './brainstormSelectedIdea.js';import {loadBrainstormBrandPlan} from './brainstormBrandPlanLoad.js';import {listBrainstormImageRuns} from './brainstormImages.js';import {loadBrainstormUploadsArtifact} from './brainstormUploadsStore.js';
export async function brainstormProjectState(projectId:string){
 z.string().uuid().parse(projectId);const snap=await assistantProjectSnapshot(projectId);const plans=[],evidence=[],reports=[],brands=[],uploads=[],warnings:string[]=[];
 for(const a of snap.project.artifacts.filter(a=>['brainstorm-search-plan','brainstorm-evidence','brainstorm-ideas','brainstorm-brand-plan','brainstorm-uploads'].includes((a.data as any)?.source)).slice(-100)){
  try{switch((a.data as any).source){
   case 'brainstorm-search-plan':{const v=await loadBrainstormSearchPlan(projectId,a.id);plans.push({id:a.id,createdAt:a.createdAt,plan:v.plan});break;}
   case 'brainstorm-evidence':{const v=await loadBrainstormProjectEvidence(projectId,a.id);evidence.push({id:a.id,createdAt:a.createdAt,observedAt:v.scan.observedAt,coverage:v.scan.coverage,topics:v.topics.length,channels:v.scan.channels.filter(c=>v.scan.channels.filter(x=>x.id===c.id).length===1).slice(0,50).map(c=>({id:c.id,name:c.name}))});break;}
   case 'brainstorm-uploads':{const v=await loadBrainstormUploadsArtifact(projectId,a.id);uploads.push({id:a.id,createdAt:a.createdAt,result:v.result});break;}
   case 'brainstorm-ideas':{const v=await loadBrainstormSelectedIdea(projectId,a.id,0);reports.push({id:a.id,createdAt:a.createdAt,report:v.report});break;}
   case 'brainstorm-brand-plan':{const v=await loadBrainstormBrandPlan(projectId,a.id);brands.push({id:a.id,createdAt:a.createdAt,plan:v.plan});break;}
  }}catch{warnings.push(`Материал «${typeof a.title==='string'?a.title.slice(0,100):'без названия'}» недоступен или повреждён; исходные файлы не изменены.`);}
 }
 const images=await listBrainstormImageRuns(projectId);if((await assistantProjectSnapshot(projectId)).snapshot!==snap.snapshot)throw new ApiError('VALIDATION','Проект изменился при чтении. Обновите страницу.',409);
 return {project:{id:snap.project.id,title:snap.project.title,channelId:typeof snap.project.channelId==='string'?snap.project.channelId:null},plans,evidence,reports,brands,uploads,imageRuns:images.runs,warnings:[...warnings,...images.warnings]};
}
