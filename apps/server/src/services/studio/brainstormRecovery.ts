// Durable model result staging; never triggers the model or changes channel settings.
import {constants} from 'node:fs';import fs from 'node:fs/promises';import {randomUUID,createHash} from 'node:crypto';import {z} from 'zod';
import {ApiError} from '../../lib/errors.js';import {dataPath} from '../../lib/storage.js';import {checkCancelled} from '../../lib/taskContext.js';import {assistantSafeDir} from '../assistant.js';
import {BrainstormProposal} from './brainstormReport.js';import {saveBrainstormIdeaReport} from './brainstormReportSave.js';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),dir=()=>dataPath('assistant-brainstorm-results');
const Recovery=z.object({projectId:uuid,attemptId:uuid,evidenceArtifactId:uuid,evidenceHash:hash,uploadsArtifactId:uuid.optional(),uploadsHash:hash.optional(),proposal:BrainstormProposal}).strict().refine(x=>!!x.uploadsArtifactId===!!x.uploadsHash);
const Stored=z.object({version:z.literal(1),createdAt:z.string().datetime(),model:z.string().min(1).max(180),recovery:Recovery,hash}).strict();
const digest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const problem=(message:string)=>new ApiError('VALIDATION',message,409);
/** Reserve already belongs to a paid attempt. Publish the response as an immutable complete file. */
export async function stageBrainstormResult(input:z.infer<typeof Recovery>,model:string){
 const recovery=Recovery.parse(input),base={version:1 as const,createdAt:new Date().toISOString(),model:z.string().min(1).max(180).parse(model),recovery},record={...base,hash:digest(base)};
 await assistantSafeDir(dir(),true);checkCancelled();if((await fs.readdir(dir())).filter(n=>/^[0-9a-f-]{36}\.json$/i.test(n)).length>=500)throw problem('Хранилище результатов заполнено. Результат пока только в задаче.');
 const full=dataPath('assistant-brainstorm-results',recovery.attemptId+'.json'),tmp=full+'.'+randomUUID()+'.tmp';
 try{await fs.writeFile(tmp,JSON.stringify(record),{flag:'wx',mode:0o600});checkCancelled();await fs.link(tmp,full);}
 catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw problem('Результат этой попытки уже существует. Проверьте сохранённый результат.');throw e;}
 finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
 return {attemptId:recovery.attemptId};
}
export async function loadBrainstormResult(attemptId:string){
 uuid.parse(attemptId);if(!await assistantSafeDir(dir()))throw problem('Сохранённый результат не найден.');
 const file=dataPath('assistant-brainstorm-results',attemptId+'.json'),st=await fs.lstat(file).catch(()=>null);
 if(!st||!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>128*1024)throw problem('Сохранённый результат недоступен или повреждён. Исходный файл не изменён.');
 const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);let raw:Buffer;try{const s=await h.stat();if(!s.isFile()||s.nlink!==1||s.size>128*1024)throw problem('Небезопасный файл результата.');raw=await h.readFile();if(raw.length>128*1024)throw problem('Слишком большой файл результата.');}finally{await h.close();}
 let r:z.infer<typeof Stored>;try{r=Stored.parse(JSON.parse(raw.toString('utf8')));}catch{throw problem('Сохранённый результат повреждён. Исходный файл не изменён.');}
 const {hash:stored,...base}=r;if(r.recovery.attemptId!==attemptId||digest(base)!==stored)throw problem('Сохранённый результат изменился или повреждён. Исходный файл не изменён.');return r;
}
/** Safe repeated attachment: saveBrainstormIdeaReport is idempotent and validates evidence again. */
export async function recoverBrainstormResult(attemptId:string){checkCancelled();const r=await loadBrainstormResult(attemptId);checkCancelled();return saveBrainstormIdeaReport(r.recovery);}
