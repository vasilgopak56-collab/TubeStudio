/** Guarded one-time project commit for one audio storyboard run. */
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {dataPath} from '../lib/storage.js';
import {ApiError} from '../lib/errors.js';
import {checkCancelled} from '../lib/taskContext.js';
import {withProjectMutation} from './projects.js';
const Id=z.string().uuid(), MAX=32*1024*1024;
const Artifact=z.object({id:z.string(),kind:z.string(),title:z.string(),createdAt:z.string(),data:z.unknown().optional()}).passthrough();
const Project=z.object({id:Id,title:z.string(),createdAt:z.string(),updatedAt:z.string(),artifacts:z.array(Artifact)}).passthrough();
const digest=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=()=>new ApiError('VALIDATION','Проект недоступен, изменён или неоднозначен. Сохранение остановлено; проверьте проект и резервную копию.',409);
async function readProject(projectId:string){
 Id.parse(projectId);const folder=dataPath('projects'),file=path.join(folder,`${projectId}.json`);let h;
 try {for(const p of [folder,file]){const st=await fs.lstat(p);if(st.isSymbolicLink())throw fail();}h=await fs.open(file,constants.O_RDONLY|(process.platform==='win32'?0:(constants.O_NOFOLLOW||0)));const st=await h.stat();if(!st.isFile()||st.nlink!==1||st.size<1||st.size>MAX)throw fail();const b=Buffer.alloc(st.size+1);let n=0;while(n<b.length){const r=await h.read(b,n,b.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead;}if(n!==st.size)throw fail();const bytes=b.subarray(0,n),parsed=Project.safeParse(JSON.parse(bytes.toString('utf8')));if(!parsed.success||parsed.data.id!==projectId)throw fail();return {project:parsed.data,file,bytesHash:crypto.createHash('sha256').update(bytes).digest('hex')};
 }catch{throw fail();}finally{await h?.close();}
}
export async function inspectAudioProject(projectId:string,runId:string){
 Id.parse(runId);const {project,bytesHash,file}=await readProject(projectId);const matches=project.artifacts.filter(a=>a.id===runId);if(matches.length>1)throw fail();
 const {updatedAt,...withoutTime}=project;void updatedAt;
 const basisHash=digest({...withoutTime,artifacts:project.artifacts.filter(a=>a.id!==runId)});
 return {project,bytesHash,file,basisHash,artifact:matches[0]??null};
}
export const audioArtifactHash=(artifact:unknown)=>digest(Artifact.parse(artifact));
export function buildAudioProjectArtifact(runId:string,data:unknown,rows:number,version:number){return {id:runId,kind:"storyboard",title:`Из озвучки · ${rows} сцен`,createdAt:new Date().toISOString(),version,data};}
export function validateAudioProjectArtifact(artifact:Awaited<ReturnType<typeof inspectAudioProject>>['artifact'],runId:string,resultHash:string,artifactHash:string,rows:number){
 if(!artifact||artifact.id!==runId||artifact.kind!=='storyboard'||artifact.title!==`Из озвучки · ${rows} сцен`||artifact.data===undefined||digest(artifact.data)!==resultHash||audioArtifactHash(artifact)!==artifactHash)throw fail();
 return artifact;
}
/** Create only on first attempt. Recovery never calls this if a save-start marker exists. */
export async function commitAudioProject(projectId:string,runId:string,expectedBasis:string,artifact:ReturnType<typeof buildAudioProjectArtifact>){
 return withProjectMutation(async()=>{checkCancelled();const current=await inspectAudioProject(projectId,runId);if(current.basisHash!==expectedBasis||current.artifact)throw fail();
  const version=current.project.artifacts.filter(x=>x.kind==='storyboard').length+1;
  if(artifact.id!==runId||artifact.version!==version)throw fail();
  const next={...current.project,updatedAt:new Date().toISOString(),artifacts:[...current.project.artifacts,artifact]};const bytes=Buffer.from(JSON.stringify(next,null,2));if(bytes.length>MAX)throw fail();
  const tmp=`${current.file}.${crypto.randomUUID()}.tmp`;let handle;
  try{handle=await fs.open(tmp,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=undefined;checkCancelled();const latest=await readProject(projectId);if(latest.bytesHash!==current.bytesHash)throw fail();await fs.rename(tmp,current.file);return artifact;}
  finally{await handle?.close();await fs.rm(tmp,{force:true}).catch(()=>{});}
 });
}
