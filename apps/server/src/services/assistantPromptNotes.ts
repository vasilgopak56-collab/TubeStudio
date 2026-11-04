/** Read-only, explicitly selected assistant prompt note for a storyboard draft. */
import crypto from 'node:crypto';
import {z} from 'zod';
import {ApiError} from '../lib/errors.js';
import {assistantProjectSnapshot} from './assistant.js';
const ID=z.string().uuid(),Hash=z.string().regex(/^[a-f0-9]{64}$/),digest=(x:unknown)=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=(s:string)=>new ApiError('VALIDATION',s,409);
export const PromptNotesListAsk=z.object({projectId:ID,sourceSnapshot:Hash}).strict();
export const PromptNoteAsk=PromptNotesListAsk.extend({noteId:ID,field:z.enum(['image','video'])}).strict();
export function promptNoteInfo(a:any){
 const data=a?.data;if(a?.kind!=='note'||data?.source!=='assistant'||!['imagePrompt','animationPrompt'].includes(data?.task))return null;
 const meta=z.object({id:ID,title:z.string().max(300),version:z.number().int().nonnegative().optional(),data:z.object({deliverable:z.string(),task:z.enum(['imagePrompt','animationPrompt'])}).passthrough()}).passthrough().safeParse(a);
 if(!meta.success)throw fail('Сохранённая заметка промпта повреждена.');return meta.data;
}
async function snapshot(projectId:string,sourceSnapshot:string){const snap=await assistantProjectSnapshot(projectId);if(snap.snapshot!==sourceSnapshot)throw fail('Проект изменился. Загрузите сцену заново.');return snap;}
export async function listPromptNotes(input:z.infer<typeof PromptNotesListAsk>){const d=PromptNotesListAsk.parse(input),snap=await snapshot(d.projectId,d.sourceSnapshot);const rows=snap.project.artifacts.map(promptNoteInfo).filter(x=>x!==null);if(rows.length>1000)throw fail('Более 1000 заметок с промптами. Список не обрезан.');const counts=new Map<string,number>();for(const a of snap.project.artifacts)counts.set(a.id,(counts.get(a.id)??0)+1);const ids=new Set<string>();const notes=rows.map(r=>{if(ids.has(r.id)||counts.get(r.id)!==1)throw fail('Повтор ID заметки. Выбор остановлен.');ids.add(r.id);return {id:r.id,title:r.title,version:r.version??null,task:r.data.task,chars:r.data.deliverable.length,usable:!!r.data.deliverable.trim()&&r.data.deliverable.length<=10000};});return {project:{id:snap.project.id,title:snap.project.title},notes};}
export async function previewPromptNote(input:z.infer<typeof PromptNoteAsk>){const d=PromptNoteAsk.parse(input),snap=await snapshot(d.projectId,d.sourceSnapshot),matches=snap.project.artifacts.filter(a=>a.id===d.noteId);if(matches.length!==1)throw fail('Нужна одна сохранённая заметка этого проекта.');const note=promptNoteInfo(matches[0]);if(!note)throw fail('Нужна сохранённая авторская заметка с image- или animation-промптом.');const text=note.data.deliverable;if(!text.trim()||text.length>10000)throw fail('Нужен непустой текст до 10 000 символов; текст не обрезан.');const sourceHash=digest(matches[0]),hash=digest({input:d,sourceHash,text});return {input:d,note:{id:note.id,title:note.title,version:note.version??null,task:note.data.task,chars:text.length,sourceHash},text,hash};}
