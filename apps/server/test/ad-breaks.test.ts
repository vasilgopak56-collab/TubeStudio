import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
const dir=await fs.mkdtemp(path.join(os.tmpdir(),"ts-adbreaks-"));process.env.DATA_DIR=dir;
const {AdInput,AdOptions,AdSelection,adCandidates,makeAdPlan,validateAdSelection,saveAdPlan,saveAdSelection,loadAdPlan,listAdPlans,listAdSources}=await import("../src/services/adBreaks.js");
const {writeJson}=await import("../src/lib/storage.js");
const {adBreaksRoute}=await import("../src/routes/adBreaks.js");
const {detectPauses}=await import("../src/services/audioStoryboard.js");
const {adTime,adText}=await import("../../web/src/features/ad-breaks/types.js");
const id=crypto.randomUUID(),at="2026-01-15T12:00:00.000Z";
const source={id,name:"Тест עברית 日本語",revision:4,updatedAt:at,duration:600,fragments:[{n:1,start:0,end:100,text:"before"},{n:2,start:102,end:200,text:"after"},{n:3,start:204,end:400,text:"третий"},{n:4,start:403,end:600,text:"четвёртый"}],pauses:[{start:100,end:102},{start:200,end:204},{start:400,end:403}]};
const options={minPause:.5,intro:60,outro:30,minGap:120,targetCount:3};
after(async()=>{await fs.rm(dir,{recursive:true,force:true});});
test("adbreaks: strict input, finite numbers, bounds, UUIDs and defaults",()=>{
 assert.equal(AdInput.safeParse({audioId:id,revision:4,options:{}}).success,true);assert.deepEqual(AdOptions.parse({}),options);
 for(const patch of [{minPause:0},{minPause:61},{intro:-1},{outro:1801},{minGap:0},{minGap:Infinity},{targetCount:21},{targetCount:1.5},{surprise:1}])assert.equal(AdOptions.safeParse({...options,...patch}).success,false);
 assert.equal(AdInput.safeParse({audioId:"../x",revision:4,options}).success,false);assert.equal(AdInput.safeParse({audioId:id,revision:-1,options}).success,false);assert.equal(AdSelection.safeParse({id,selectedN:Array(21).fill(1)}).success,false);
});
test("adbreaks: candidates are exact original-time midpoints, chronological and never in speech",()=>{
 const c=adCandidates(source,options);assert.deepEqual(c.map(x=>x.at),[101,202,401.5]);assert.deepEqual(c.map(x=>[x.before,x.after]),[[1,2],[2,3],[3,4]]);for(const x of c){assert.ok(x.at>x.start&&x.at<x.end);assert.ok(!source.fragments.some(f=>x.at>=f.start&&x.at<=f.end));}
});
test("adbreaks: pause must intersect a genuine positive fragment gap; overlapping pause cannot cut speech",()=>{
 const c=adCandidates({...source,pauses:[{start:50,end:101},{start:203,end:300}]},options);assert.deepEqual(c.map(x=>[x.start,x.end,x.at]),[[100,101,100.5],[203,204,203.5]]);
 assert.deepEqual(adCandidates({...source,pauses:[{start:10,end:20}]},options),[]);
});
test("adbreaks: no stored pause, touching fragments, too-short intervals and protected edges produce no invented points",()=>{
 assert.deepEqual(adCandidates({...source,pauses:[]},options),[]);assert.deepEqual(adCandidates({...source,pauses:[{start:100,end:100}]},options),[]);assert.deepEqual(adCandidates({...source,fragments:[{n:1,start:0,end:100,text:""},{n:2,start:100,end:600,text:""}]},options),[]);
 assert.deepEqual(adCandidates(source,{...options,minPause:5}),[]);assert.deepEqual(adCandidates(source,{...options,intro:500,outro:200}),[]);
 assert.deepEqual(adCandidates(source,{...options,intro:150,outro:200}).map(c=>c.at),[202]);
});
test("adbreaks: longest-first deterministic greedy selection respects spacing and target, may return fewer",()=>{
 const r=makeAdPlan(source,options);assert.deepEqual(r.selectedN,[2,3]);assert.equal(r.rootId,r.id);assert.equal(r.parentId,null);assert.deepEqual(makeAdPlan(source,{...options,targetCount:1}).selectedN,[2]);
 assert.deepEqual(makeAdPlan(source,{...options,minGap:1}).selectedN,[1,2,3]);assert.deepEqual(makeAdPlan(source,{...options,minGap:1000}).selectedN,[2]);
});
test("adbreaks: manual choice allows empty, rejects duplicate/unknown/close points, sorts chronologically",()=>{
 const c=adCandidates(source,options);assert.deepEqual(validateAdSelection(c,[],120),[]);assert.deepEqual(validateAdSelection(c,[3,1],120),[1,3]);
 for(const x of [[1,1],[99],[1,2]])assert.throws(()=>validateAdSelection(c,x,120));
});
test("adbreaks: corrupt segments, nonfinite duration and overlaps fail instead of manufacturing timing",()=>{
 for(const d of [{...source,duration:Infinity},{...source,fragments:[{n:1,start:0,end:200,text:""},{n:2,start:100,end:600,text:""}]},{...source,pauses:[{start:4,end:3}]}])assert.throws(()=>adCandidates(d,options));
});
test("adbreaks: millisecond rounding stays strictly inside an interval and timestamps carry correctly",()=>{
 const d={...source,duration:2,fragments:[{n:1,start:0,end:.9996,text:""},{n:2,start:1.01,end:2,text:""}],pauses:[{start:.9996,end:1.01}]};const c=adCandidates(d,{...options,minPause:.01,intro:0,outro:0,minGap:1});assert.equal(c[0].at,1.005);assert.equal(adTime(59.9996),"00:01:00.000");assert.equal(adTime(3600),"01:00:00.000");
});
test("adbreaks: acoustic detector output feeds planner locally on synthetic PCM",()=>{
 const pcm=Buffer.alloc(4*16000*2);for(let i=0;i<4*16000;i++){const t=i/16000;if(t>=.2&&t<1.5||t>=2&&t<3.7)pcm.writeInt16LE(Math.round(16000*Math.sin(i/10)),i*2);}
 const d=detectPauses(pcm,{thresholdDb:-35,minPause:.12,minSpeech:.12,targetFragments:2});const r=makeAdPlan({...source,...d}, {...options,intro:0,outro:0,minGap:1,targetCount:1});assert.equal(r.candidates.length,1);assert.ok(r.candidates[0].at>1.45&&r.candidates[0].at<2.05);assert.equal(r.selectedN.length,1);
});
test("adbreaks: snapshots pin source revision; stale and missing sources do not create plans",async()=>{
 await writeJson(`audio-storyboards/${id}.json`,source);const r=await saveAdPlan({audioId:id,revision:4,options});assert.equal(r.source.revision,4);assert.equal(r.source.updatedAt,at);
 await writeJson(`audio-storyboards/${id}.json`,{...source,revision:5});await assert.rejects(saveAdPlan({audioId:id,revision:4,options}),/Версия аудио/);await assert.rejects(saveAdPlan({audioId:crypto.randomUUID(),revision:0,options}),/не найдено/);assert.deepEqual(await loadAdPlan(r.id),r);
});
test("adbreaks: source/history listings skip malformed JSON, ID mismatch and unsafe names",async()=>{
 await writeJson("audio-storyboards/bad.json",{});const wrong=crypto.randomUUID();await writeJson(`audio-storyboards/${wrong}.json`,source);const rows=await listAdSources();assert.equal(rows.length,1);assert.equal(rows[0].revision,5);assert.equal(await loadAdPlan("../../x"),null);
 await writeJson(`ad-break-runs/${crypto.randomUUID()}.json`,{garbage:true});assert.ok((await listAdPlans()).every(r=>r.id));
});
test("adbreaks: manual saves branch immutably, including empty choice, with source untouched",async()=>{
 const r=await saveAdPlan({audioId:id,revision:5,options});const before=await fs.readFile(path.join(dir,"audio-storyboards",id+".json"),"utf8");const next=await saveAdSelection({id:r.id,selectedN:[1,3]});assert.notEqual(next.id,r.id);assert.equal(next.rootId,r.id);assert.equal(next.parentId,r.id);assert.deepEqual(await loadAdPlan(r.id),r);assert.deepEqual(next.selectedN,[1,3]);const empty=await saveAdSelection({id:next.id,selectedN:[]});assert.equal(empty.rootId,r.id);assert.equal(empty.parentId,next.id);assert.deepEqual(empty.selectedN,[]);assert.equal(await fs.readFile(path.join(dir,"audio-storyboards",id+".json"),"utf8"),before);
});
test("adbreaks: failed selection neither writes a snapshot nor mutates the previous one",async()=>{
 const r=await saveAdPlan({audioId:id,revision:5,options});const before=await fs.readdir(path.join(dir,"ad-break-runs"));await assert.rejects(saveAdSelection({id:r.id,selectedN:[1,2]}),/ближе/);assert.deepEqual(await fs.readdir(path.join(dir,"ad-break-runs")),before);assert.deepEqual(await loadAdPlan(r.id),r);
});
test("adbreaks: exports use saved selected points, include source and limitations, preserve Unicode",()=>{
 const r=makeAdPlan(source,options);const txt=adText(r),md=adText(r,true);assert.match(txt,/00:03:22.000/);assert.doesNotMatch(txt,/00:01:41.000/);assert.match(md,/третий/);assert.match(txt,/עברית 日本語/);assert.match(txt,/не вставка рекламы/);assert.equal(JSON.parse(JSON.stringify(r)).candidates.length,3);
});
test("adbreaks: real route HTTP contracts: create, stale conflict, selection, history, missing and invalid",async()=>{
 const request=async(url:string,json?:unknown)=>adBreaksRoute.request("http://localhost/ad-breaks"+url,json===undefined?{}:{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(json)});
 const response=await request("/plan",{audioId:id,revision:5,options});assert.equal(response.status,200);const r=(await response.json()).data;assert.equal((await request("/plan",{audioId:id,revision:4,options})).status,409);assert.equal((await request("/selection",{id:r.id,selectedN:[99]})).status,400);assert.equal((await request("/runs/"+r.id)).status,200);assert.equal((await request("/runs/"+crypto.randomUUID())).status,404);assert.equal((await request("/sources")).status,200);assert.equal((await request("/runs")).status,200);
});
test("adbreaks: history bounded to 50 latest without deleting files; malformed candidates rejected",async()=>{
 const r=makeAdPlan(source,options);const bad=crypto.randomUUID();await writeJson(`ad-break-runs/${bad}.json`,{...r,id:bad,selectedN:[99]});assert.equal(await loadAdPlan(bad),null);
 const ids=[];for(let i=0;i<55;i++){const id=crypto.randomUUID();ids.push(id);await writeJson(`ad-break-runs/${id}.json`,{...r,id,createdAt:new Date(Date.UTC(2027,0,1,0,i)).toISOString()});}const rows=await listAdPlans();assert.equal(rows.length,50);assert.equal(rows[0].id,ids[54]);assert.equal(rows[49].id,ids[5]);assert.ok(await fs.stat(path.join(dir,"ad-break-runs",ids[0]+".json")));
});
test("adbreaks v2: pins bounded source projection and exact greedy rejection reasons",()=>{
 const r=makeAdPlan({...source,fragments:source.fragments.map(f=>({...f,text:"Ж".repeat(200)}))},options),b=r.basis!;
 assert.equal(r.version,2);assert.equal(b.algorithm,"saved-gap-midpoint-greedy-v1");assert.match(b.sourceHash,/^[a-f0-9]{64}$/);assert.ok(b.fragments.every(f=>f.text.length===160));
 assert.deepEqual(b.autoSelectedN,[2,3]);assert.deepEqual(b.auto,[{n:2,status:"selected",conflicts:[]},{n:3,status:"selected",conflicts:[]},{n:1,status:"too-close",conflicts:[2]}]);
 assert.ok(b.gaps.every(g=>g.reason==="candidate"));assert.deepEqual(makeAdPlan(source,{...options,targetCount:1}).basis!.auto.map(a=>a.status),["selected","target-reached","target-reached"]);
});
test("adbreaks v2: explains exclusions without inventing silence",()=>{
 assert.ok(makeAdPlan({...source,pauses:[]},options).basis!.gaps.every(g=>g.reason==="no-minimum-overlap"));
 assert.ok(makeAdPlan(source,{...options,intro:599}).basis!.gaps.every(g=>g.reason==="outside-margin"));
 const touching={...source,fragments:[{n:1,start:0,end:100,text:""},{n:2,start:100,end:600,text:""}]};assert.equal(makeAdPlan(touching,options).basis!.gaps[0].reason,"no-positive-gap");
});
test("adbreaks v2: hash deterministic, binds metadata/options/boundaries, ignores unretained text tail",()=>{
 const base=makeAdPlan(source,options).basis!.sourceHash;assert.equal(makeAdPlan(source,options).basis!.sourceHash,base);
 for(const d of [{...source,name:"renamed"},{...source,revision:99},{...source,pauses:[]}])assert.notEqual(makeAdPlan(d,options).basis!.sourceHash,base);
 assert.notEqual(makeAdPlan(source,{...options,targetCount:2}).basis!.sourceHash,base);
 const long={...source,fragments:source.fragments.map(f=>({...f,text:"x".repeat(160)+"tailA"}))};assert.equal(makeAdPlan(long,options).basis!.sourceHash,makeAdPlan({...long,fragments:long.fragments.map(f=>({...f,text:"x".repeat(160)+"tailB"}))},options).basis!.sourceHash);
});
test("adbreaks v2: manual branches retain original auto evidence and work without original source",async()=>{
 const r=makeAdPlan(source,options);await writeJson(`ad-break-runs/${r.id}.json`,r);
 const branch=await saveAdSelection({id:r.id,selectedN:[1,3]});assert.deepEqual(branch.basis,r.basis);assert.deepEqual(branch.selectedN,[1,3]);assert.deepEqual((await loadAdPlan(branch.id))?.basis?.autoSelectedN,[2,3]);
});
test("adbreaks v2: reject missing or tampered evidence, options, candidates and source projection",async()=>{
 const r=makeAdPlan(source,options);
 const variants=[{...r,basis:undefined},{...r,basis:{...r.basis,sourceHash:"0".repeat(64)}},{...r,options:{...r.options,minGap:1}},{...r,basis:{...r.basis,autoSelectedN:[1]}},{...r,candidates:r.candidates.slice(1)},{...r,basis:{...r.basis,pauses:[]}}];
 for(const v of variants){const id=crypto.randomUUID();await writeJson(`ad-break-runs/${id}.json`,{...v,id});assert.equal(await loadAdPlan(id),null);}
});
test("adbreaks legacy: loads and branches v1 without fabricating evidence",async()=>{
 const {basis,...r}=makeAdPlan(source,options);const legacy={...r,version:1};await writeJson(`ad-break-runs/${r.id}.json`,legacy);const loaded=await loadAdPlan(r.id);assert.equal(loaded?.version,1);assert.equal(loaded?.basis,undefined);const next=await saveAdSelection({id:r.id,selectedN:[]});assert.equal(next.version,1);assert.equal(next.basis,undefined);assert.match(adText(next,true),/Старый снимок/);
});
test("adbreaks v2: Markdown includes bounded evidence in a safe fence; TXT remains selected-only",()=>{
 const r=makeAdPlan({...source,fragments:source.fragments.map(f=>({...f,text:"```json </script> עברית 日本語"}))},options);const md=adText(r,true),txt=adText(r);
 assert.match(md,/````json/);assert.match(md,/sourceHash/);assert.match(md,/autoSelectedN/);assert.doesNotMatch(txt,/sourceHash/);assert.doesNotMatch(txt,/00:01:41.000/);
});
