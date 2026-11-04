import {Hono} from 'hono';import {bodyLimit} from 'hono/body-limit';
import {ApiError,ok,fail} from '../lib/errors.js';import {startJob} from '../lib/jobs.js';
import {KeywordEvidenceInput,runKeywordSuggestions,runKeywordSearch,listKeywordEvidence,loadKeywordEvidence} from '../services/keywordEvidence.js';
export const keywordEvidenceRoute=new Hono();
keywordEvidenceRoute.use('/keyword-evidence/*',bodyLimit({maxSize:8192,onError:c=>c.json({ok:false,error:{code:'VALIDATION',message:'Слишком большой запрос'}},413)}));
for(const [name,run] of [['suggestions',runKeywordSuggestions],['search',runKeywordSearch]] as const)keywordEvidenceRoute.post('/keyword-evidence/'+name,async c=>{try{const d=KeywordEvidenceInput.parse(await c.req.json());return ok(c,{jobId:startJob(ctx=>run(d,ctx))});}catch(e){return fail(c,e instanceof SyntaxError?new ApiError('VALIDATION','Некорректный JSON'):e);}});
keywordEvidenceRoute.get('/keyword-evidence/runs',async c=>{try{return ok(c,await listKeywordEvidence());}catch(e){return fail(c,e);}});
keywordEvidenceRoute.get('/keyword-evidence/runs/:id',async c=>{try{const r=await loadKeywordEvidence(c.req.param('id')!);if(!r)throw new ApiError('NOT_FOUND','Снимок не найден или повреждён',404);return ok(c,r);}catch(e){return fail(c,e);}});
