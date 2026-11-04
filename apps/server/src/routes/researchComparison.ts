import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {ApiError,fail,ok} from '../lib/errors.js';
import {startJob} from '../lib/jobs.js';
import {ComparisonInput,comparisonContext,collectComparison,listComparisons,loadComparison,saveComparisonReview,removeComparison,attachComparison,loadComparisonBrief} from '../services/researchComparison.js';
export const researchComparisonRoute=new Hono();
researchComparisonRoute.use('/research-workflow/comparisons/*',bodyLimit({maxSize:16384,onError:c=>c.json({ok:false,error:{code:'VALIDATION',message:'Слишком большой запрос'}},413)}));
researchComparisonRoute.use('/research-workflow/comparisons',bodyLimit({maxSize:16384,onError:c=>c.json({ok:false,error:{code:'VALIDATION',message:'Слишком большой запрос'}},413)}));
const h=(fn:(c:any)=>Promise<unknown>)=>async(c:any)=>{try{return ok(c,await fn(c));}catch(e){return fail(c,e);}};
async function body(c:any){try{return await c.req.json();}catch{throw new ApiError('VALIDATION','Некорректный JSON');}}
researchComparisonRoute.get('/research-workflow/comparisons/context/:candidateId',h(c=>comparisonContext(c.req.param('candidateId'))));
researchComparisonRoute.get('/research-workflow/comparisons',h(()=>listComparisons()));
researchComparisonRoute.post('/research-workflow/comparisons',h(async c=>{const input=ComparisonInput.parse(await body(c));return {jobId:startJob(ctx=>collectComparison(input,ctx))};}));
researchComparisonRoute.get('/research-workflow/comparisons/:id',h(c=>loadComparison(c.req.param('id'))));
researchComparisonRoute.patch('/research-workflow/comparisons/:id/review',h(async c=>saveComparisonReview(c.req.param('id'),await body(c))));
researchComparisonRoute.delete('/research-workflow/comparisons/:id',h(c=>removeComparison(c.req.param('id'))));
researchComparisonRoute.post('/research-workflow/comparisons/:id/project',h(c=>attachComparison(c.req.param('id'))));
researchComparisonRoute.get('/research-workflow/comparisons/:id/brief',h(c=>loadComparisonBrief(c.req.param('id'),c.req.query('projectId')??'',c.req.query('artifactId')??'')));
