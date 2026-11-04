import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {ApiError,fail,ok} from '../lib/errors.js';
import {listCandidates,saveCandidate,patchCandidate,removeCandidate,observeCandidate,candidateProject,loadCandidateBrief} from '../services/researchWorkflow.js';
export const researchWorkflowRoute=new Hono();
researchWorkflowRoute.use('/research-workflow/*',bodyLimit({maxSize:16384,onError:c=>c.json({ok:false,error:{code:'VALIDATION',message:'Слишком большой запрос'}},413)}));
const h=(fn:(c:any)=>Promise<unknown>)=>async(c:any)=>{try{return ok(c,await fn(c));}catch(e){return fail(c,e);}};
async function body(c:any){try{return await c.req.json();}catch{throw new ApiError('VALIDATION','Некорректный JSON');}}
researchWorkflowRoute.get('/research-workflow/candidates',h(()=>listCandidates()));
researchWorkflowRoute.post('/research-workflow/candidates',h(async c=>saveCandidate(await body(c))));
researchWorkflowRoute.patch('/research-workflow/candidates/:id',h(async c=>patchCandidate(c.req.param('id'),await body(c))));
researchWorkflowRoute.delete('/research-workflow/candidates/:id',h(c=>removeCandidate(c.req.param('id'))));
researchWorkflowRoute.post('/research-workflow/candidates/:id/observe',h(c=>observeCandidate(c.req.param('id'),c.req.raw.signal)));
researchWorkflowRoute.post('/research-workflow/candidates/:id/project',h(c=>candidateProject(c.req.param('id'))));
researchWorkflowRoute.get('/research-workflow/candidates/:id/brief',h(c=>loadCandidateBrief(c.req.param('id'),c.req.query('projectId')??'')));
