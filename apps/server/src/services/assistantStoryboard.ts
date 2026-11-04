/** Read-only preparation for an explicit storyboard handoff. */
import crypto from 'node:crypto';
import {z} from 'zod';
import {ApiError} from '../lib/errors.js';
import {assistantProjectSnapshot} from './assistant.js';
const ID=z.string().uuid();
export const StoryboardSourceAsk=z.object({projectId:ID,sourceArtifactId:ID}).strict();
const digest=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function previewStoryboardSource(input:z.infer<typeof StoryboardSourceAsk>){
 const d=StoryboardSourceAsk.parse(input),snap=await assistantProjectSnapshot(d.projectId);
 const matches=snap.project.artifacts.filter(a=>a.id===d.sourceArtifactId);
 if(matches.length!==1||matches[0].kind!=='script')throw new ApiError('VALIDATION','Нужна ровно одна выбранная версия сценария в этом проекте.',409);
 const source=matches[0],raw=source.data as any,text=typeof raw==='string'?raw:raw?.script;
 if(typeof text!=='string'||text.trim().length<200||text.length>60000)throw new ApiError('VALIDATION','Для раскадровки нужен сценарий от 200 непустых до 60 000 символов без обрезания.',409);
 const sourceHash=digest(source),hash=digest({input:d,sourceHash,snapshot:snap.snapshot});
 return {input:d,hash,project:{id:snap.project.id,title:snap.project.title},sourceArtifact:{id:source.id,title:source.title,version:source.version??null,hash:sourceHash},text,chars:text.length};
}
