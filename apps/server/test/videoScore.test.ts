import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { VideoScoreInput, scoreSource, videoScoreReport, runVideoScore, loadVideoScore, listVideoScores } from "../src/services/videoScore.js";
import { dataPath } from "../src/lib/storage.js";
import { runTask } from "../src/lib/taskContext.js";
const now=Date.parse("2026-03-20T12:00:00Z"),channelId="UC"+"s".repeat(22);
const video=(id="abcdefghijk",views=1000):any=>({id,title:"Римские акведуки",description:"Описание",channelId,channelTitle:"История",publishedAt:"2026-03-10T12:00:00Z",durationSec:600,durationKnown:true,isShort:false,views,viewsKnown:true,likes:10,likesKnown:true,comments:5,commentsKnown:true,tags:["Рим"]});
const sample=()=>[scoreSource(video("aaaaaaaaaaa",100)),scoreSource(video("bbbbbbbbbbb",200)),scoreSource(video("ccccccccccc",300))];
const snap=(source=scoreSource(video()),rows:any[]=sample()):any=>({version:1,id:crypto.randomUUID(),createdAt:new Date(now).toISOString(),requestedBaseline:true,source,sample:rows.map(({id,title,publishedAt,durationSec,views,channelId})=>({id,title,publishedAt,durationSec,views,channelId})),baselineStatus:"loaded",baselineNote:"Тестовая выборка"});
const report=(v:any=video(),rows:any[]=sample())=>videoScoreReport(snap(scoreSource(v),rows));
test("video URL schemas accept supported links and reject foreign schemes, credentials and extras",()=>{
  for(const s of ["abcdefghijk","https://youtu.be/abcdefghijk","youtube.com/watch?v=abcdefghijk","https://m.youtube.com/shorts/abcdefghijk","https://youtube.com/live/abcdefghijk"]){assert.equal(VideoScoreInput.parse({video:s}).videoId,"abcdefghijk");}
  for(const s of ["https://evil.test/watch?v=abcdefghijk","http://youtube.com/watch?v=abcdefghijk","https://x:secret@youtube.com/watch?v=abcdefghijk","https://youtube.com:8443/watch?v=abcdefghijk","../oauth","x".repeat(3000)])assert.throws(()=>VideoScoreInput.parse({video:s}));
  assert.throws(()=>VideoScoreInput.parse({video:"abcdefghijk",auto:true}));assert.throws(()=>VideoScoreInput.parse({video:"abcdefghijk",baseline:"true"}));
});
test("video counters require knownness: missing does not become zero",()=>{
  for(const key of ["views","likes","comments"]){const v=video();v[key+"Known"]=undefined;const r=report(v);assert.equal((r.metrics as any)[key],null);assert.equal(r.metrics.engagement,null);}
  for(const val of [NaN,Infinity,-1,.5,Number.MAX_SAFE_INTEGER+1]){const v=video();v.views=val;assert.equal(report(v).metrics.views,null);}
  const r=report(video(undefined,0));assert.equal(r.metrics.views,0);assert.equal(r.metrics.vph,0);assert.equal(r.metrics.outlier,0);assert.equal(r.metrics.engagement,null);
  assert.equal(report({...video(),likes:0,comments:0}).metrics.engagement,0);
});
test("video VPH is lifetime average with 1h floor, future invalid and age zero unavailable",()=>{
  assert.equal(report().metrics.vph,4.17);assert.equal(report().metrics.engagement,1.5);assert.equal(report().metrics.outlier,5);
  for(const d of ["bad","2027-01-01T00:00:00Z",new Date(now).toISOString()])assert.equal(report({...video(),publishedAt:d}).metrics.vph,null);
  const young=report({...video(),publishedAt:new Date(now-1800000).toISOString()});assert.equal(young.metrics.vph,1000);assert.equal(young.metrics.outlier,null);
});
test("video baseline exposes deduplication, same channel, duration, date, age and knownness rules",()=>{
  const r=report(video(),[...sample(),...sample().slice(0,1),scoreSource(video()),{...scoreSource(video("otherchan01",500)),channelId:"UC"+"x".repeat(22)}, {...scoreSource(video("shorts00001",900)),durationSec:60}, {...scoreSource(video("unknown0001",900)),durationSec:null},{...scoreSource(video("unkviews001",900)),views:null},{...scoreSource(video("young000001",900)),publishedAt:new Date(now-3600000).toISOString()},{...scoreSource(video("future00001",900)),publishedAt:"2027-01-01"}]);
  assert.equal(r.baseline.sampleSize,3);assert.equal(r.baseline.median,200);assert.equal(r.metrics.outlier,5);assert.deepEqual(r.baseline.rows.filter(x=>!x.eligible).map(x=>x.reason),["Повтор ID","Само видео","Другой канал","Другая группа длительности","Неизвестная длительность","Просмотры недоступны","Моложе 48 часов","Неверная или будущая дата"]);
});
test("video outlier has no channel-average fallback, needs 3 peers, positive median and known target",()=>{
  assert.equal(report(video(),sample().slice(0,2)).metrics.outlier,null);const z=report(video(),sample().map(x=>({...x,views:0})));assert.equal(z.baseline.median,0);assert.equal(z.metrics.outlier,null);
  assert.equal(report({...video(),viewsKnown:false}).metrics.outlier,null);assert.equal(report({...video(),durationKnown:false}).metrics.outlier,null);
  const s=snap();s.baselineStatus="disabled";assert.equal(videoScoreReport(s).metrics.outlier,null);
  const r=report({...video(),durationSec:60},sample().map(x=>({...x,durationSec:180})));assert.equal(r.metrics.formatGroup,"≤180 с");assert.equal(r.metrics.outlier,5);assert.match(r.notices.join(" "),/не по реальному статусу Shorts/);
});
test("video metadata observations keep literal content, do not score or predict search rankings",()=>{const r=report({...video(),title:"<img onerror=alert(1)> עברית 日本語",description:"",tags:[]});assert.match(r.source.title,/<img/);assert.equal(r.checks[1].value,"0 символов");assert.match(r.checks[2].note,/не прогноз/);assert.equal((r as any).score,undefined);});
test("video service fetches fresh bounded target and baseline, saves immutable raw snapshots; no hidden counters",async()=>{
  const {config}=await import("../src/config.js"),{clearCache}=await import("../src/lib/cache.js");const prev=globalThis.fetch,old=config.keys.youtube;config.keys.youtube="DUMMY_VIDEO_SCORE_KEY";await clearCache();let calls:string[]=[],mode="normal";
  globalThis.fetch=(async(input:any)=>{const u=new URL(String(input));assert.equal(u.origin,"https://www.googleapis.com");const kind=u.pathname.split("/").at(-1)!;calls.push(kind);
    if(mode==="error" && kind==="videos")return new Response(JSON.stringify({error:{message:"SECRET_PROVIDER_LEAK",errors:[{reason:"videoNotFound"}]}}),{status:404});
    if(kind==="videos"){if(mode==="empty")return new Response(JSON.stringify({items:[]}));return new Response(JSON.stringify({items:u.searchParams.get("id")!.split(",").map((id,i)=>({id,snippet:{title:"Рим",description:"Описание",publishedAt:"2020-01-01T00:00:00Z",channelId,channelTitle:"Канал",tags:["Рим"]},statistics:mode==="unknown"?{viewCount:"",likeCount:"-1"}:{viewCount:String((i+1)*100),likeCount:"0"},contentDetails:{duration:mode==="bad-duration"?"PT5Mtrick":"PT5M"}}))}));}
    if(kind==="channels")return new Response(JSON.stringify({items:mode==="no-channel"?[]:[{id:channelId,snippet:{title:"Канал"},statistics:{},contentDetails:{relatedPlaylists:{uploads:"UU"+channelId.slice(2)}}}]}));
    if(kind==="playlistItems"){assert.equal(u.searchParams.get("maxResults"),"50");return new Response(JSON.stringify({items:["aaaaaaaaaaa","bbbbbbbbbbb","ccccccccccc"].map(videoId=>({contentDetails:{videoId}}))}));}throw Error("Unexpected provider");
  }) as typeof fetch;
  const ctx={progress:()=>{},partial:()=>{},signal:new AbortController().signal};
  try{
    const run=()=>runVideoScore(VideoScoreInput.parse({video:"abcdefghijk"}),ctx);
    const a=await run();assert.deepEqual(calls,["videos","channels","playlistItems","videos"]);assert.equal(a.baseline.sampleSize,3);assert.equal(a.metrics.comments,null);assert.equal(a.metrics.engagement,null);assert.equal(a.metrics.likes,0);assert.deepEqual(await loadVideoScore(a.id),a);
    const raw=JSON.parse(await fs.readFile(dataPath("video-score-runs",a.id+".json"),"utf8"));assert.equal(raw.metrics,undefined);assert.ok(!JSON.stringify(raw).includes("DUMMY_VIDEO_SCORE_KEY"));
    calls=[];const b=await run();assert.notEqual(b.id,a.id);assert.deepEqual(calls,["videos","channels","playlistItems","videos"]);assert.equal((await listVideoScores()).items.length,2);
    mode="no-channel";const partial=await run();assert.equal(partial.baselineStatus,"unavailable");assert.equal(partial.metrics.outlier,null);
    mode="unknown";const unknown=await runVideoScore(VideoScoreInput.parse({video:"abcdefghijk",baseline:false}),ctx);assert.equal(unknown.metrics.views,null);assert.equal(unknown.metrics.likes,null);assert.equal(unknown.baselineStatus,"disabled");
    mode="bad-duration";const bad=await runVideoScore(VideoScoreInput.parse({video:"abcdefghijk",baseline:false}),ctx);assert.equal(bad.source.durationSec,null);
    for(const m of ["empty","error"]){mode=m;const before=(await fs.readdir(dataPath("video-score-runs"))).sort();await assert.rejects(run(),e=>e instanceof Error && !e.message.includes("SECRET_PROVIDER_LEAK"));assert.deepEqual((await fs.readdir(dataPath("video-score-runs"))).sort(),before);}
    mode="normal";const c=new AbortController();c.abort();const before=await fs.readdir(dataPath("video-score-runs"));await assert.rejects(runTask({signal:c.signal},()=>runVideoScore(VideoScoreInput.parse({video:"abcdefghijk"}),{...ctx,signal:c.signal})));assert.deepEqual(await fs.readdir(dataPath("video-score-runs")),before);
  }finally{globalThis.fetch=prev;config.keys.youtube=old;}
});
test("video history validates UUID, JSON, version, file bounds and symlinks without reading foreign files",async()=>{
  await assert.rejects(loadVideoScore("../oauth"));assert.equal(await loadVideoScore(crypto.randomUUID()),null);
  await fs.mkdir(dataPath("video-score-runs"),{recursive:true});const ids=Array.from({length:5},()=>crypto.randomUUID());
  const save=(i:number,data:string)=>fs.writeFile(dataPath("video-score-runs",ids[i]+".json"),data);
  await save(0,"{");await save(1,JSON.stringify({...snap(),id:ids[1],version:42}));await save(2," ".repeat(256*1024+1));await fs.symlink(dataPath("oauth.json"),dataPath("video-score-runs",ids[3]+".json"));await save(4,JSON.stringify({...snap(),id:crypto.randomUUID()}));
  for(const id of ids)assert.equal(await loadVideoScore(id),null);assert.ok((await listVideoScores()).skipped>=5);
  for(let i=0;i<52;i++){const id=crypto.randomUUID();await fs.writeFile(dataPath("video-score-runs",id+".json"),JSON.stringify({...snap(),id}));}assert.equal((await listVideoScores()).items.length,50);
});

test("video snapshot directory symlinks are rejected without following their destination",async()=>{
  const dir=dataPath("video-score-runs"),hold=dir+"-hold",foreign=dataPath("foreign-video-score");await fs.mkdir(foreign,{recursive:true});await fs.writeFile(foreign+"/marker","UNCHANGED");
  await fs.rename(dir,hold);await fs.symlink(foreign,dir,"dir");
  try{await assert.rejects(listVideoScores());await assert.rejects(loadVideoScore(crypto.randomUUID()));assert.deepEqual(await fs.readdir(foreign),["marker"]);}finally{await fs.unlink(dir);await fs.rename(hold,dir);}
});
