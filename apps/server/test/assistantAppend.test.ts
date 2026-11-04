import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts77-append-'));
process.env.DATA_DIR=dir;
const a=await import('../src/services/assistant.js');
const p=await import('../src/services/projects.js');
const {withTaskSignal}=await import('../src/lib/taskContext.js');
const roles={routine:null,script:null,imagePrompt:null,animationPrompt:null};
const text='ТОЧНЫЙ АВТОРСКИЙ ТЕКСТ\nНе заменять прежнюю версию.';
async function fixture(task='script',questions:string[]=[],deliverable=text){
 const run=await a.createAssistant({title:'Сохранение версии',roles,documents:[]});
 const at=new Date().toISOString();
 const message={role:'assistant',text:'Готово',at,task,provider:'anthropic',model:'original-author',output:{reply:'Готово',brief:'Авторский результат',questions,steps:[],deliverable}};
 await fs.writeFile(path.join(dir,'assistant-runs',run.id+'.json'),JSON.stringify({...run,messages:[{role:'user',text:'Напиши',at,task},message]}));
 const project=await p.createProject({title:'Исходный проект',artifact:{kind:'script',title:'Прежний сценарий',data:{script:'ПРЕЖНИЙ ТЕКСТ',unknown:'PRESERVE'}}});
 return {run,project,input:{runId:run.id,projectId:project.id,title:'Новая версия'}};
}
async function preview(f:Awaited<ReturnType<typeof fixture>>){const v=await a.previewAssistantAppend(f.input);return {...f.input,previewHash:v.hash,confirmed:true as const};}
after(()=>fs.rm(dir,{recursive:true,force:true}));

test('append: preview and confirmation preserve old artifacts, exact text, provenance and unknown fields',async()=>{
 const f=await fixture(),file=path.join(dir,'projects',f.project.id+'.json');
 const raw=JSON.parse(await fs.readFile(file,'utf8'));raw.custom={keep:17};await fs.writeFile(file,JSON.stringify(raw));
 const before=await fs.readFile(file,'utf8'),send=await preview(f);assert.equal(await fs.readFile(file,'utf8'),before);
 const orig=globalThis.fetch;globalThis.fetch=(async()=>{throw Error('Network forbidden');}) as typeof fetch;
 try{await a.appendAssistantResult(send);}finally{globalThis.fetch=orig;}
 const saved=JSON.parse(await fs.readFile(file,'utf8'));assert.deepEqual(saved.custom,{keep:17});assert.deepEqual(saved.artifacts[0],raw.artifacts[0]);assert.equal(saved.artifacts[1].data.script,text);assert.equal(saved.artifacts[1].data.model,'original-author');assert.equal(saved.artifacts[1].version,2);assert.equal(saved.artifacts[1].data.runId,f.run.id);
});
for(const change of ['rename','add','delete','update','raw'] as const)test('append: stale '+change+' invalidates even unchanged timestamp',async()=>{
 const f=await fixture(),send=await preview(f);
 if(change==='rename')await p.updateProject(f.project.id,{title:'Changed'});
 if(change==='add')await p.addArtifact(f.project.id,{kind:'note',title:'Concurrent',data:'x'});
 if(change==='delete')await p.deleteArtifact(f.project.id,f.project.artifacts[0].id);
 if(change==='update')await p.updateArtifactData(f.project.id,f.project.artifacts[0].id,()=>({script:'Changed'}));
 const file=path.join(dir,'projects',f.project.id+'.json');if(change==='raw')await fs.appendFile(file,'\n');
 const before=await fs.readFile(file,'utf8');await assert.rejects(a.appendAssistantResult(send),/изменились/);assert.equal(await fs.readFile(file,'utf8'),before);
});
test('append: concurrent duplicate approvals save once and retries never append',async()=>{
 const f=await fixture(),send=await preview(f),results=await Promise.allSettled([a.appendAssistantResult(send),a.appendAssistantResult(send)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);await assert.rejects(a.appendAssistantResult(send),/уже добавлен/);assert.equal((await p.getProject(f.project.id)).artifacts.length,2);
});
test('append: normal concurrent writers do not lose artifacts',async()=>{
 const f=await fixture(),send=await preview(f);
 await Promise.all([a.appendAssistantResult(send),p.addArtifact(f.project.id,{kind:'note',title:'Concurrent note',data:'keep'})]);
 const saved=await p.getProject(f.project.id);assert.equal(saved.artifacts.length,3);assert.equal((saved.artifacts[2].data as string),'keep');
});
for(const [task,questions,deliverable] of [['routine',[],text],['script',['Уточнить?'],text],['script',[],'  ']] as [string,string[],string][])test('append: refuses incomplete or routine '+task+questions.length+deliverable.length,async()=>{
 const f=await fixture(task,questions,deliverable);await assert.rejects(a.previewAssistantAppend(f.input),/завершённый авторский/);
});
for(const task of ['imagePrompt','animationPrompt'])test('append: '+task+' is a note, not generated media',async()=>{const f=await fixture(task),send=await preview(f),r=await a.appendAssistantResult(send);assert.equal(r.artifact.kind,'note');assert.equal(r.artifact.data.task,task);assert.equal('script' in r.artifact.data,false);assert.equal((r.artifact.data as any).deliverable,text);});
test('append: title and target are bound to confirmation; false and extra controls rejected',async()=>{
 const f=await fixture(),send=await preview(f);await assert.rejects(a.appendAssistantResult({...send,title:'Other'}),/изменились/);
 assert.equal(a.AssistantAppendSend.safeParse({...send,confirmed:false}).success,false);assert.equal(a.AssistantAppendSend.safeParse({...send,overwrite:true}).success,false);assert.equal(a.AssistantAppendAsk.safeParse({...f.input,projectId:'../escape'}).success,false);
});
test('append: corrupt, symlink, hardlink and oversize project rejected without writes',async()=>{
 const f=await fixture(),file=path.join(dir,'projects',f.project.id+'.json'),before=await fs.readFile(file);
 await fs.writeFile(file,'corrupt');await assert.rejects(a.previewAssistantAppend(f.input),/повреждён/);assert.equal(await fs.readFile(file,'utf8'),'corrupt');
 await fs.rm(file);const target=path.join(dir,'private.json');await fs.writeFile(target,before);await fs.symlink(target,file);await assert.rejects(a.previewAssistantAppend(f.input),/небезопасен/);assert.deepEqual(await fs.readFile(target),before);
 await fs.rm(file);await fs.link(target,file);await assert.rejects(a.previewAssistantAppend(f.input),/небезопасен/);
 await fs.rm(file);await fs.writeFile(file,' '.repeat(10*1024*1024+1));await assert.rejects(a.previewAssistantAppend(f.input),/10 МиБ/);
});
test('append: cancellation before commit leaves original bytes intact',async()=>{const f=await fixture(),send=await preview(f),file=path.join(dir,'projects',f.project.id+'.json'),before=await fs.readFile(file),c=new AbortController();c.abort();await assert.rejects(withTaskSignal(c.signal,()=>a.appendAssistantResult(send)));assert.deepEqual(await fs.readFile(file),before);});
test('append: rebinding retains original author and cannot duplicate original answer',async()=>{
 const f=await fixture(),send=await preview(f);await a.appendAssistantResult(send);
 const swap=await a.previewAssistantRebind({runId:f.run.id,attemptId:crypto.randomUUID(),roles:{...roles,script:{provider:'anthropic',model:'replacement-author'}}});const branch=await a.rebindAssistant({...swap.input,confirmed:true,previewHash:swap.hash});
 await assert.rejects(a.previewAssistantAppend({...f.input,runId:branch.id}),/уже добавлен/);
 const other=await p.createProject({title:'Other'});const v=await a.previewAssistantAppend({...f.input,runId:branch.id,projectId:other.id});assert.equal(v.artifact.data.model,'original-author');
});

test('append: failed atomic rename keeps original and cleans temporary file',async()=>{
 const f=await fixture(),send=await preview(f),file=path.join(dir,'projects',f.project.id+'.json'),before=await fs.readFile(file),orig=fs.rename;
 fs.rename=async()=>{throw new Error('SYNTHETIC_DISK_FAILURE');};
 try{await assert.rejects(a.appendAssistantResult(send),/SYNTHETIC_DISK_FAILURE/);}finally{fs.rename=orig;}
 assert.deepEqual(await fs.readFile(file),before);assert.equal((await fs.readdir(path.join(dir,'projects'))).some(x=>x.endsWith('.tmp')),false);
 await a.appendAssistantResult(send);assert.equal((await p.getProject(f.project.id)).artifacts.length,2);
});
test('append: original connection identifiers survive rebind and save',async()=>{
 const f=await fixture(),file=path.join(dir,'assistant-runs',f.run.id+'.json'),run=JSON.parse(await fs.readFile(file,'utf8')),id=crypto.randomUUID(),hash='a'.repeat(64);
 Object.assign(run.messages.at(-1),{provider:'compatible',connectionId:id,connectionHash:hash});await fs.writeFile(file,JSON.stringify(run));
 const v=await a.previewAssistantAppend(f.input);assert.equal(v.artifact.data.connectionId,id);assert.equal(v.artifact.data.connectionHash,hash);await a.appendAssistantResult({...f.input,previewHash:v.hash,confirmed:true});
 assert.equal(((await p.getProject(f.project.id)).artifacts.at(-1)?.data as any).connectionId,id);
});
