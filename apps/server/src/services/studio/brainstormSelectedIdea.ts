// Resolve the user's explicit choice against a stored report and its evidence.
import {createHash} from 'node:crypto';import {z} from 'zod';
import {ApiError} from '../../lib/errors.js';import {assistantProjectSnapshot} from '../assistant.js';
import {loadBrainstormProjectEvidence} from './brainstormProjectEvidence.js';import {BrainstormProposal,composeBrainstormReport} from './brainstormReport.js';
const digest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=()=>new ApiError('VALIDATION','Отчёт с идеями или его исходные данные изменены либо повреждены. Запрос не отправлен.',409);
export async function loadBrainstormSelectedIdea(projectId:string,ideasArtifactId:string,selectedIndex:number){
 z.string().uuid().parse(projectId);z.string().uuid().parse(ideasArtifactId);z.number().int().min(0).max(7).parse(selectedIndex);
 const initial=await assistantProjectSnapshot(projectId),items=initial.project.artifacts.filter(a=>a.id===ideasArtifactId&&(a.data as any)?.source==='brainstorm-ideas');if(items.length!==1)throw fail();
 const d=items[0].data as any;if(!z.string().uuid().safeParse(d.evidenceArtifactId).success||!z.string().regex(/^[a-f0-9]{64}$/).safeParse(d.evidenceHash).success)throw fail();
 const loaded=await loadBrainstormProjectEvidence(projectId,d.evidenceArtifactId);if(loaded.projectSnapshot!==initial.snapshot||loaded.evidenceHash!==d.evidenceHash)throw fail();
 const p=BrainstormProposal.safeParse(d.proposal);if(!p.success)throw fail();
 const reportHash=digest({evidenceArtifactId:d.evidenceArtifactId,evidenceHash:d.evidenceHash,proposal:p.data});if(reportHash!==d.reportHash)throw fail();
 let report;try{report=composeBrainstormReport(loaded.scan,loaded.topics,p.data);}catch{throw fail();}if(digest(report)!==digest(d.report))throw fail();
 const idea=report.ideas[selectedIndex];return {project:loaded.project,projectSnapshot:loaded.projectSnapshot,task:loaded.task,selectedIdea:{title:idea.title,direction:idea.direction,reason:idea.reason},ideasHash:reportHash,ideasArtifactId,selectedIndex,report};
}
