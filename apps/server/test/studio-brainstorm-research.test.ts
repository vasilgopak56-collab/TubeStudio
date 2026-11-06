import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDirections, type BrainstormObservation } from '../src/services/studio/brainstormResearch.js';
import type { WebVideo, WebChannel } from '../src/services/studio/ytweb.js';
const now='2026-11-06T12:00:00.000Z', c='UCabcdefghijklmnopqrstuv', c2='UC1234567890123456789012';
const video=(id:string,views:number|undefined,ageDays:number|undefined,channelId=c):WebVideo=>({id,title:'Sample',channelId,views,ageDays});
const obs=(video:WebVideo,direction='Winter',query='winter'):BrainstormObservation=>({direction,query,period:'month',video});
const channel=(id:string,subs?:number):WebChannel=>({id,name:'Channel',subs,longVideos:[],hasMoreLong:false});
test('deduplicates videos within direction, retains query provenance and computes median and hits',()=>{
 const a=video('aaaaaaaaaaa',120_000,10),b=video('bbbbbbbbbbb',20_000,25);
 const [r]=summarizeDirections([obs(a),obs(a,'Winter','cold'),obs(b)],[channel(c,500)],now);
 assert.equal(r.videoCount,2);assert.equal(r.channelCount,1);assert.equal(r.medianViews,70_000);assert.equal(r.smallChannelHits,1);assert.deepEqual(r.sources[0].queries,['winter','cold']);assert.equal(r.incomplete,true);
});
test('unknown subscribers and views do not become zero or small-channel hits',()=>{
 const [r]=summarizeDirections([obs(video('aaaaaaaaaaa',100_000,2,c2)),obs(video('bbbbbbbbbbb',undefined,2))],[channel(c)],now);
 assert.equal(r.medianViews,100_000);assert.equal(r.knownViewCount,1);assert.equal(r.unknownSubscriberVideos,2);assert.equal(r.smallChannelHits,0);
});
test('excludes future, old, unknown-date, live and short videos',()=>{
 const xs=[video('aaaaaaaaaaa',1,32),video('bbbbbbbbbbb',1,undefined),{...video('ccccccccccc',1,1),live:true},{...video('ddddddddddd',1,1),short:true},{...video('eeeeeeeeeee',1,1),publishedAt:'2026-11-07T12:00:00Z'},video('fffffffffff',1,31)];
 const [r]=summarizeDirections(xs.map(v=>obs(v)),[],now);assert.equal(r.videoCount,1);assert.equal(r.sources[0].videoId,'fffffffffff');
});
test('20 known videos are not labelled a weak sample; separate directions stay separate',()=>{
 const xs=Array.from({length:20},(_,i)=>video(String(i).padStart(11,'0'),i,1));
 const r=summarizeDirections([...xs.map(v=>obs(v)),obs(xs[0],'Other')],[channel(c,100_000)],now);
 assert.equal(r[0].incomplete,false);assert.equal(r[0].smallChannelHits,0);assert.equal(r[1].videoCount,1);
});
test('rejects invalid IDs and timestamps and fills missing data from duplicate observations',()=>{
 assert.throws(()=>summarizeDirections([],[],'wrong'));
 const v=video('aaaaaaaaaaa',undefined,2,'invalid');const b=video('aaaaaaaaaaa',123,2,c);
 const [r]=summarizeDirections([obs({...b,id:'../bad'}),obs(v),obs(b,'Winter','second')],[channel(c,10)],now);
 assert.equal(r.videoCount,1);assert.equal(r.sources[0].views,123);assert.equal(r.sources[0].channelId,c);assert.match(r.sources[0].url,/youtube\.com\/watch\?v=aaaaaaaaaaa$/);
});

test('missing subscribers keeps even a large sample incomplete',()=>{
 const xs=Array.from({length:20},(_,i)=>obs(video(String(i).padStart(11,'0'),100_000,1)));
 const [r]=summarizeDirections(xs,[],now);assert.equal(r.unknownSubscriberVideos,20);assert.equal(r.incomplete,true);assert.equal(r.smallChannelHits,0);
});
