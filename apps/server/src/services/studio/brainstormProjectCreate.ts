// One caller-chosen ID makes project creation safe to retry after a lost response.
import {createHash,randomUUID} from 'node:crypto';import fs from 'node:fs/promises';import {z} from 'zod';import {ApiError} from '../../lib/errors.js';import {dataPath} from '../../lib/storage.js';import {checkCancelled} from '../../lib/taskContext.js';import {assistantSafeDir} from '../assistant.js';import {getProject,withProjectMutation} from '../projects.js';import {getChannel} from './channels.js';
export const BrainstormProjectCreate=z.object({projectId:z.string().uuid(),channelId:z.string().uuid(),title:z.string().trim().min(1).max(200)}).strict();
const digest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export async function createBrainstormProject(raw:z.infer<typeof BrainstormProjectCreate>){
 const input=BrainstormProjectCreate.parse(raw),marker=digest({version:1,...input});
 return withProjectMutation(async()=>{
  checkCancelled();const folder=dataPath('projects');if(!await assistantSafeDir(folder))throw new ApiError('PROJECT_STORE','Папка проектов недоступна.',503);const target=dataPath('projects',input.projectId+'.json');
  async function existing(){const st=await fs.lstat(target).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return null;throw e;});if(!st)return null;if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>10*1024*1024)throw new ApiError('PROJECT_STORE','Файл проекта недоступен или повреждён. Ничего не изменено.',409);const p=await getProject(input.projectId);if((p as typeof p&{brainstormCreation?:string}).brainstormCreation!==marker)throw new ApiError('VALIDATION','Номер уже занят другим проектом. Ничего не изменено.',409);return {project:p,alreadySaved:true};}
  const found=await existing();if(found)return found;const channel=await getChannel(input.channelId);if(channel.archived)throw new ApiError('VALIDATION','Канал в архиве. Проект не создан.',409);
  const now=new Date().toISOString(),project={id:input.projectId,title:input.title,channelId:input.channelId,createdAt:now,updatedAt:now,artifacts:[],brainstormCreation:marker},tmp=target+'.'+randomUUID()+'.tmp';
  try{const f=await fs.open(tmp,'wx',0o600);try{await f.writeFile(JSON.stringify(project,null,2));await f.sync();}finally{await f.close();}checkCancelled();try{await fs.link(tmp,target);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const found=await existing();if(found)return found;throw e;}return {project,alreadySaved:false};}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
 });
}
