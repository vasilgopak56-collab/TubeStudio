import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-project-safety-'));process.env.DATA_DIR=dir;
const P=await import('../src/services/projects.js');
const {content}=await import('../src/routes/content.js');
await fs.mkdir(path.join(dir,'projects'));
const projectFile=(id:string)=>path.join(dir,'projects',id+'.json');
after(async()=>fs.rm(dir,{recursive:true,force:true}));
const code=(expected:string)=>(e:unknown)=>{assert.equal((e as any).code,expected);return true;};
test('projects: valid list, individual read, updates and true missing project',async()=>{
 const p=await P.createProject({title:'Проект'});assert.equal((await P.getProject(p.id)).title,'Проект');assert.equal((await P.listProjects()).length,1);
 await P.addArtifact(p.id,{kind:'note',title:'Тест',data:'содержимое'});await P.updateProject(p.id,{title:'Новая версия'});assert.equal((await P.getProject(p.id)).artifacts.length,1);
 await assert.rejects(P.getProject(randomUUID()),code('NOT_FOUND'));await P.deleteProject(p.id);assert.deepEqual(await P.listProjects(),[]);
});
test('projects: invalid JSON and damaged structure fail closed, preserve both original project and media',async()=>{
 const valid=await P.createProject({title:'Исправный'}), broken=await P.createProject({title:'Другой'});const file=projectFile(broken.id),media=path.join(dir,'files',broken.id,'audio.mp3');await fs.mkdir(path.dirname(media),{recursive:true});await fs.writeFile(media,'original media');
 for(const raw of ['{SECRET_SENTINEL', 'null', JSON.stringify({id:broken.id,title:'x',createdAt:'x',updatedAt:'x',artifacts:[null]}), JSON.stringify({...broken,id:valid.id})]) {
  await fs.writeFile(file,raw);await assert.rejects(P.getProject(broken.id),code('PROJECT_STORE'));await assert.rejects(P.listProjects(),code('PROJECT_STORE'));
  await assert.rejects(P.updateProject(broken.id,{title:'no'}),code('PROJECT_STORE'));await assert.rejects(P.addArtifact(broken.id,{kind:'note',title:'no'}),code('PROJECT_STORE'));await assert.rejects(P.deleteProject(broken.id),code('PROJECT_STORE'));
  assert.equal(await fs.readFile(file,'utf8'),raw);assert.equal(await fs.readFile(media,'utf8'),'original media');assert.equal((await P.getProject(valid.id)).title,'Исправный');
  const r=await content.request('/projects');const body=await r.text();assert.equal(r.status,503);assert.match(body,/PROJECT_STORE/);assert.doesNotMatch(body,/SECRET_SENTINEL/);
 }
 await fs.rm(file);await P.deleteProject(valid.id);
});
test('projects: unreadable file, vanished enumerated file, inaccessible and missing folder do not become empty list or 404',async()=>{
 const p=await P.createProject({title:'Доступ'}),file=projectFile(p.id),before=await fs.readFile(file,'utf8');const read=fs.readFile;
 try{fs.readFile=(async (...args:any[])=>{if(args[0]===file)throw Object.assign(new Error('PRIVATE_OS_MESSAGE'),{code:'EACCES'});return (read as any)(...args);}) as typeof fs.readFile;
 await assert.rejects(P.getProject(p.id),e=>{assert.equal((e as any).code,'PROJECT_STORE');assert.doesNotMatch(String(e),/PRIVATE_OS_MESSAGE/);return true;});await assert.rejects(P.listProjects(),code('PROJECT_STORE'));await assert.rejects(P.deleteProject(p.id),code('PROJECT_STORE'));
 }finally{fs.readFile=read;}assert.equal(await fs.readFile(file,'utf8'),before);
 try{fs.readFile=(async (...args:any[])=>{if(args[0]===file)throw Object.assign(new Error('lost'),{code:'ENOENT'});return (read as any)(...args);}) as typeof fs.readFile;await assert.rejects(P.listProjects(),code('PROJECT_STORE'));}finally{fs.readFile=read;}
 const readdir=fs.readdir;try{fs.readdir=(async (...args:any[])=>{if(args[0]===path.join(dir,'projects'))throw Object.assign(new Error('PRIVATE_OS_MESSAGE'),{code:'EACCES'});return (readdir as any)(...args);}) as typeof fs.readdir;await assert.rejects(P.listProjects(),code('PROJECT_STORE'));}finally{fs.readdir=readdir;}
 await fs.rm(path.join(dir,'projects'),{recursive:true});await assert.rejects(P.listProjects(),code('PROJECT_STORE'));await assert.rejects(P.getProject(randomUUID()),code('PROJECT_STORE'));await fs.mkdir(path.join(dir,'projects'));
});

test('projects: a dangling link is an unreadable entry, not a missing project',async t=>{
 const id=randomUUID(),file=projectFile(id);
 try{await fs.symlink(path.join(dir,'missing-target'),file);}catch(e){if(['EPERM','EACCES','ENOSYS'].includes((e as NodeJS.ErrnoException).code??'')){t.skip('symlink creation unavailable');return;}throw e;}
 try{await assert.rejects(P.getProject(id),code('PROJECT_STORE'));await assert.rejects(P.deleteProject(id),code('PROJECT_STORE'));assert.equal((await fs.lstat(file)).isSymbolicLink(),true);}finally{await fs.rm(file,{force:true});}
});
