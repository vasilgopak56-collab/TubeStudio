// Помощник: бесплатные действия «Собрать монтаж» и «Собрать Shorts». Сети и платных запросов нет, данные во временной папке.
import {before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {dataPath} from '../src/lib/storage.js';
import {createChannel} from '../src/services/studio/channels.js';
import {lockMontage} from '../src/services/studio/montageRender.js';
import {reserveMontageRender,reserveShortsBuild,runMontageRenderAction,runShortsBuildAction} from '../src/services/assistantStudioBuild.js';

const id='11111111-2222-4333-8444-555555555555',old='2026-01-01T00:00:00.000Z';
const rows=Array.from({length:8},(_,i)=>({n:i+1,text:`Sentence ${i+1}.`,start:i*5,end:(i+1)*5,seconds:5,words:2,paragraph:Math.floor(i/4)+1,shot:'',concept:'',motion:'',image:'',video:'',animate:false,cast:[],picture:{state:'none',attempts:0},clip:{state:'none',attempts:0}}));
const ctx={progress:()=>{},partial:()=>{},signal:new AbortController().signal} as never;
const m=()=>dataPath('files',id,'montage');
let channelId='';

async function seed(accepted=true){
 const board={source:'studio-visual',schema:1,channelId,projectId:id,textHash:'x',language:'en',timing:'audio',matched:8,mode:'sentence',maxSec:8,rows,createdAt:old,updatedAt:old,style:{},input:{}};
 await fs.rm(dataPath('files',id),{recursive:true,force:true});
 await fs.mkdir(dataPath('projects'),{recursive:true});
 await fs.writeFile(dataPath('projects',`${id}.json`),JSON.stringify({id,title:'Frost story',channelId,createdAt:old,updatedAt:old,artifacts:[{id:'a1',kind:'script',title:'s',createdAt:old,data:{script:'Words. '.repeat(40)}},{id:'a2',kind:'storyboard',title:'b',createdAt:old,data:board}]}));
 await fs.mkdir(m(),{recursive:true});
 await fs.writeFile(path.join(m(),'a.mp4'),'x');
 await fs.writeFile(path.join(m(),'draft.json'),JSON.stringify({file:'montage/a.mp4',at:new Date().toISOString(),seconds:40,width:1920,height:1080,bytes:10,parts:1,reused:0,subtitles:{files:{srt:'montage/draft.srt',vtt:'montage/draft.vtt'},cues:8,problem:null}}));
 if(accepted)await fs.writeFile(path.join(m(),'accepted.json'),JSON.stringify({file:'montage/a.mp4',at:old}));
}
before(async()=>{channelId=(await createChannel({name:'Test',niche:'history',language:'en'})).id;});
beforeEach(()=>seed());

test('без подтверждения, без ролика или с лишним полем ничего не запускается',async()=>{
 await assert.rejects(reserveMontageRender({projectId:id,channelId}),/не подтверждена/);
 await assert.rejects(reserveMontageRender({projectId:id,channelId,confirmed:true,extra:1}),/не подтверждена/);
 await assert.rejects(reserveShortsBuild({projectId:id,channelId,ids:['1-4']}),/не подтверждена/);
 await assert.rejects(reserveShortsBuild({projectId:id,channelId,ids:[],confirmed:true}),/от 1 до 5/);
 await assert.rejects(reserveShortsBuild({projectId:id,channelId,ids:['1-1','2-2','3-3','4-4','5-5','6-6'],confirmed:true}),/от 1 до 5/);
 await assert.rejects(reserveShortsBuild({projectId:id,channelId,ids:['1-4','1-4'],confirmed:true}),/дважды/);
});

test('неизвестный канал не принимается',async()=>{
 await assert.rejects(reserveMontageRender({projectId:id,channelId:randomUUID(),confirmed:true}));
 await assert.rejects(reserveShortsBuild({projectId:id,channelId:randomUUID(),ids:['1-4'],confirmed:true}));
});

test('пока идёт сборка этого ролика, второй запуск через Помощника не начинается',async()=>{
 let release=()=>{};
 const held=lockMontage(id,'render',()=>new Promise<void>(r=>{release=r;}));
 try{
  await assert.rejects(reserveMontageRender({projectId:id,channelId,confirmed:true}),/уже идёт/);
  await assert.rejects(reserveShortsBuild({projectId:id,channelId,ids:['1-4'],confirmed:true}),/уже идёт/);
 }finally{release();await held;}
});

test('Shorts: без принятого монтажа и с куском не из списка страницы ничего не запускается',async()=>{
 await assert.rejects(reserveShortsBuild({projectId:id,channelId,ids:['1-3'],confirmed:true}),/изменился/);
 await seed(false);
 await assert.rejects(reserveShortsBuild({projectId:id,channelId,ids:['1-4'],confirmed:true}),/примите ролик[\s\S]*Ничего не запущено/);
});

test('Помощник вызывает ту же сборку, что страницы, с тем же роликом и кусками',async()=>{
 const render=await reserveMontageRender({projectId:id,channelId,confirmed:true});
 const calls:unknown[]=[];
 await runMontageRenderAction(render,ctx,(async(p:string,c:unknown)=>{calls.push(['render',p,c===ctx]);return {} as never;}) as never);
 const shorts=await reserveShortsBuild({projectId:id,channelId,ids:['5-8','1-4'],confirmed:true});
 await runShortsBuildAction(shorts,ctx,(async(p:string,raw:unknown,c:unknown)=>{calls.push(['shorts',p,raw,c===ctx]);return {items:[]};}) as never);
 assert.deepEqual(calls,[['render',id,true],['shorts',id,{ids:['5-8','1-4']},true]]);
});
