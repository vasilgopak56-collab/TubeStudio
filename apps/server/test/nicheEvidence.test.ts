import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Channel, Video } from '../src/services/youtube.js';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-niche-evidence-'));
process.env.DATA_DIR = dir;
const { buildNicheRow, NicheInput, loadNicheRun, listNicheRuns, summarizeNiche } = await import('../src/services/niches.js');
const { nichesRoute } = await import('../src/routes/niches.js');
const now = Date.parse('2026-02-01T12:00:00Z'), DAY=86400000;
const cid='UC'+'a'.repeat(22), foreign='UC'+'b'.repeat(22);
const ch: Channel={id:cid,title:'Рим <img src=x onerror=alert(1)> עברית 日本語',description:'Вода и быт',publishedAt:'2020-01-01T00:00:00Z',subscribers:0,subscriberCountKnown:true,hiddenSubscribers:false,totalViews:0,videoCount:0,uploadsPlaylistId:'UU'};
const input=NicheInput.parse({q:'Рим вода',force:true}),rpm={long:{niche:'Test',min:4,max:8},shorts:{niche:'Shorts',min:.05,max:.1}};
const video=(id:string,days:number,views:number|null,duration=600):Video=>({id,title:'Рим вода',description:'',channelId:cid,channelTitle:ch.title,publishedAt:new Date(now-days*DAY).toISOString(),durationSec:duration,isShort:duration<=180,views:views??0,viewsKnown:views!==null,likes:0,comments:0,tags:[]});
const videos=[video('aaaaaaaaaaa',10,100),video('bbbbbbbbbbb',6,0),video('ccccccccccc',3,null),video('ddddddddddd',1,999),video('eeeeeeeeeee',-1,500),{...video('fffffffffff',7,500),publishedAt:'invalid'},video('ggggggggggg',8,200,60),video('hhhhhhhhhhh',9,300,0)];
const row=()=>buildNicheRow(ch,videos,input,input.q,rpm,now);
const run=()=>({version:2 as const,id:randomUUID(),createdAt:new Date(now).toISOString(),input,query:input.q,language:'ru',seed:null,searchIds:[cid],rows:[row()],warnings:[],quotaEstimate:121,rpm,summary:summarizeNiche([row()])});
async function write(r:any){await fs.mkdir(dir+'/niche-runs',{recursive:true});await fs.writeFile(dir+'/niche-runs/'+r.id+'.json',JSON.stringify(r));return r.id;}
after(()=>fs.rm(dir,{recursive:true,force:true}));
test('niche evidence independent raw arithmetic and exact view/frequency membership',()=>{
 const r=row(),included=videos.filter(v=>v.viewsKnown&&Date.parse(v.publishedAt)<=now-2*DAY&&Date.parse(v.publishedAt)<=now);
 const values=included.map(v=>v.views).sort((a,b)=>a-b);const mean=values.reduce((a,b)=>a+b,0)/values.length,median=(values[1]+values[2])/2;
 assert.equal(r.averageViews,mean);assert.equal(r.medianViews,median);assert.equal(mean,150);assert.equal(median,150);
 assert.equal(r.mature,4);assert.equal(r.selected,6);assert.equal(r.uploadsPerWeek,3.89);assert.equal(r.basis!.frequency.spanDays,9);
 assert.deepEqual(r.basis!.entries.map(x=>x.viewsIncluded),[true,true,false,false,false,false,true,true]);
 assert.deepEqual(r.basis!.entries.map(x=>x.frequencyIncluded),[true,true,true,true,false,false,true,true]);
 assert.equal(r.evidence!.uploads[2].views,null);assert.equal(r.evidence!.uploads[1].views,0);assert.equal(r.revenuePerVideo,null);assert.equal(r.evidence!.subscriberStatus,'known');
});
test('niche evidence duration groups derive from duration, not cached isShort flag',()=>{
 const r=buildNicheRow(ch,[{...video('aaaaaaaaaaa',10,100,60),isShort:false},video('bbbbbbbbbbb',4,200,600),video('ccccccccccc',3,500,0)],{...input,type:'shorts'},input.q,rpm,now);
 assert.equal(r.averageViews,100);assert.equal(r.selected,1);assert.equal(r.revenuePerVideo!.min,.01);
 assert.match(r.basis!.entries[1].reasons.join(' '),/группа/);assert.match(r.basis!.entries[2].reasons.join(' '),/неизвестна/);
});
test('niche evidence excludes duplicate and foreign video from all numerical/text inputs',()=>{
 const r=buildNicheRow(ch,[video('aaaaaaaaaaa',10,100),video('aaaaaaaaaaa',4,900),{...video('bbbbbbbbbbb',4,800),channelId:foreign}],input,'уникальное',rpm,now);
 assert.equal(r.averageViews,100);assert.equal(r.selected,1);assert.equal(r.uploadsPerWeek,null);assert.match(r.basis!.entries[1].reasons.join(' '),/Повтор/);assert.match(r.basis!.entries[2].reasons.join(' '),/Другой/);
});
test('niche evidence unknown durationKnown and invalid counters do not produce false knownness',()=>{
 const r=buildNicheRow({...ch,subscribers:Infinity},[{...video('aaaaaaaaaaa',5,100),durationKnown:false},{...video('bbbbbbbbbbb',4,100),views:NaN}],input,input.q,rpm,now);
 assert.equal(r.subscribers,null);assert.equal(r.evidence!.subscriberStatus,'missing');assert.equal(r.evidence!.uploads[0].durationSec,null);assert.equal(r.evidence!.uploads[1].views,null);assert.equal(r.revenuePerVideo,null);
 const cache=buildNicheRow({...ch,hiddenSubscribers:true},[],{...input,force:false},input.q,rpm,now);assert.equal(cache.evidence!.source,'cache-possible');assert.equal(cache.evidence!.subscriberStatus,'hidden');
});
test('niche evidence UTC 48-hour boundary and one-day frequency threshold',()=>{
 const r=buildNicheRow(ch,[video('aaaaaaaaaaa',2,0),video('bbbbbbbbbbb',1,100)],input,input.q,rpm,now);
 assert.equal(r.mature,1);assert.equal(r.averageViews,0);assert.equal(r.uploadsPerWeek,7);assert.equal(r.basis!.frequency.spanDays,1);
 assert.equal(buildNicheRow(ch,[video('aaaaaaaaaaa',2,0),video('bbbbbbbbbbb',1.5,100)],input,input.q,rpm,now).uploadsPerWeek,null);
});
test('niche evidence v2 history rederives aggregates and membership from frozen raw values',async()=>{
 const r=run();await write({...r,rows:[{...r.rows[0],averageViews:999999,medianViews:999,uploadsPerWeek:999,textMatchPct:0,basis:{malicious:true}}],summary:{...r.summary,label:'untrusted cached aggregate'}});
 const got=await loadNicheRun(r.id);assert.deepEqual(got,r);assert.equal(got!.rows[0].evidence!.uploads[0].title,'Рим вода');
});
test('niche evidence history rejects missing/bad evidence, unsupported versions, ID mismatch, unknown fields and duplicate channel rows',async()=>{
 const r=run();for(const change of [{version:3},{version:1},{rows:[{...r.rows[0],evidence:undefined}]},{rows:[r.rows[0],r.rows[0]]},{searchIds:[]},{rows:[{...r.rows[0],evidence:{...r.rows[0].evidence,subscriberStatus:'missing'}}]},{extra:1}]){const bad={...r,...change,id:randomUUID()};await write(bad);assert.equal(await loadNicheRun(bad.id),null);}
 const id=randomUUID();await fs.writeFile(dir+'/niche-runs/'+id+'.json',JSON.stringify(r));assert.equal(await loadNicheRun(id),null);
});
test('niche evidence legacy history readable without invented source inputs',async()=>{
 const r=run(),{evidence,basis,...legacyRow}=r.rows[0];const legacy={...r,version:1,rows:[legacyRow],id:randomUUID()};delete (legacy as any).searchIds;await write(legacy);assert.deepEqual(await loadNicheRun(legacy.id),legacy);
});
test('niche evidence failed upstream marker remains failed on local reread',async()=>{
 const r=run();r.rows=[buildNicheRow(ch,[],input,input.q,rpm,now)];r.rows[0].evidence!.uploadsState='failed';r.rows[0].warnings=['Не удалось получить загрузки. Показатели видео неизвестны; повторите поиск с обновлением кеша.'];r.summary=summarizeNiche(r.rows);await write(r);assert.deepEqual(await loadNicheRun(r.id),r);
});
test('niche evidence bounded history ignores corrupt, symlink and oversized files; no destructive cleanup',async()=>{
 const r=run();await write(r);const id=randomUUID(),other=randomUUID(),big=randomUUID();await fs.writeFile(dir+'/niche-runs/'+id+'.json','broken');await fs.symlink(dir+'/niche-runs/'+r.id+'.json',dir+'/niche-runs/'+other+'.json');await fs.writeFile(dir+'/niche-runs/'+big+'.json',' '.repeat(4*1024*1024+1));for(const key of [id,other,big])assert.equal(await loadNicheRun(key),null);const list=await listNicheRuns();assert.ok(list.some(x=>x.id===r.id));assert.ok(!list.some(x=>[id,other,big].includes(x.id)));assert.equal((await fs.lstat(dir+'/niche-runs/'+other+'.json')).isSymbolicLink(),true);
});
test('niche evidence HTTP validates unknown fields, oversized and malformed JSON before enqueue',async()=>{
 for(const data of [{q:'ok',unexpected:true},{q:'ok',language:''},{q:'ok',sample:11}]){const r=await nichesRoute.request('/niches',{method:'POST',body:JSON.stringify(data)});assert.equal(r.status,400);}
 assert.equal((await nichesRoute.request('/niches',{method:'POST',body:'{'})).status,400);
 assert.equal((await nichesRoute.request('/niches',{method:'POST',body:'x'.repeat(9000)})).status,413);
 assert.equal((await nichesRoute.request('/niche-runs/'+randomUUID())).status,404);
});

test('niche evidence rejects a symlink history root without following external files',async()=>{
 const original=dir+'/niche-runs',hold=dir+'/niche-runs-hold';await fs.rename(original,hold);await fs.symlink(hold,original);try{await assert.rejects(listNicheRuns(),(e:any)=>e.code==='VALIDATION');await assert.rejects(loadNicheRun(randomUUID()),(e:any)=>e.code==='VALIDATION');}finally{await fs.unlink(original);await fs.rename(hold,original);}
});
