import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {ApiError,fail,ok} from '../lib/errors.js';
import {startJob} from '../lib/jobs.js';
import {ResearchEvidenceInput,runResearchEvidence,listResearchEvidence,loadResearchEvidence} from '../services/researchEvidence.js';
export const researchEvidenceRoute=new Hono();
researchEvidenceRoute.post('/research-evidence',bodyLimit({maxSize:8192,onError:c=>c.json({ok:false,error:{code:'VALIDATION',message:'Слишком большой запрос'}},413)}),async c=>{try{const input=ResearchEvidenceInput.parse(await c.req.json().catch(()=>{throw new ApiError('VALIDATION','Некорректный JSON');}));return ok(c,{jobId:startJob(ctx=>runResearchEvidence(input,ctx))});}catch(e){return fail(c,e);}});
researchEvidenceRoute.get('/research-evidence/runs',async c=>{try{return ok(c,await listResearchEvidence());}catch(e){return fail(c,e);}});
researchEvidenceRoute.get('/research-evidence/runs/:id',async c=>{try{const r=await loadResearchEvidence(c.req.param('id'));if(!r)throw new ApiError('NOT_FOUND','Исследование не найдено',404);return ok(c,r);}catch(e){return fail(c,e);}});
