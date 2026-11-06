import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scanBrainstorm, ScanPlan} from '../src/services/studio/brainstormScan.js';
import {ApiError} from '../src/lib/errors.js';
import type {WebVideo,WebChannel} from '../src/services/studio/ytweb.js';
const c='UCabcdefghijklmnopqrstuv', c2='UC1234567890123456789012';
const v=(id:string,channelId=c,views=120000):WebVideo=>({id,title:'Video',channelId,views,ageDays:2});
const ch=(id:string):WebChannel=>({id,name:'Channel',subs:1000,longVideos:[],hasMoreLong:false});
const ctx=()=>({signal:new AbortController().signal,progress:()=>{},partial:()=>{}});
const plan={queries:[{direction:'Winter',query:'snow'}],region:'US'};
const clock=()=>new Date('2026-11-06T12:00:00.000Z');
test('two free searches, candidates deduplicated, coverage and samples retained',async()=>{
 const calls:string[]=[];const r=await scanBrainstorm(plan,ctx(),{now:clock,search:async(q,o)=>{calls.push(`${q}:${o?.period}:${o?.pages}`);return [v('aaaaaaaaaaa'),v('bbbbbbbbbbb',c2,2000)];},channel:async id=>ch(id)});
 assert.deepEqual(calls,['snow:week:1','snow:month:1']);assert.equal(r.coverage.completedSearches,2);assert.equal(r.coverage.candidates,1);assert.equal(r.coverage.channelsRead,1);assert.equal(r.directions[0].videoCount,2);assert.equal(r.directions[0].smallChannelHits,1);assert.equal(r.directions[0].unknownSubscriberVideos,1);
});
test('search failure and an empty direction are visible, not presented as complete',async()=>{
 const r=await scanBrainstorm(plan,ctx(),{now:clock,search:async(_q,o)=>{if(o?.period==='week')throw Error('unavailable');return [];},channel:async id=>ch(id)});
 assert.equal(r.coverage.searchErrors,1);assert.equal(r.coverage.completedSearches,1);assert.equal(r.directions[0].videoCount,0);assert.equal(r.directions[0].incomplete,true);
});
test('YouTube throttling stops without running more searches or channel lookups',async()=>{
 let n=0; const r=await scanBrainstorm(plan,ctx(),{now:clock,search:async()=>{n++;throw new ApiError('UPSTREAM','limited',429,true,{ytLimited:true});},channel:async()=>{throw Error('must not call');}});
 assert.equal(n,1);assert.equal(r.coverage.stoppedByYoutube,true);assert.equal(r.coverage.completedSearches,0);
});
test('channel mismatch and failure are visible, unknown subscribers are not invented',async()=>{
 const r=await scanBrainstorm(plan,ctx(),{now:clock,search:async()=>[v('aaaaaaaaaaa')],channel:async()=>ch(c2)});
 assert.equal(r.coverage.channelErrors,1);assert.equal(r.directions[0].unknownSubscriberVideos,1);assert.equal(r.directions[0].smallChannelHits,0);
});
test('duplicate plans and overlong plans are rejected before any network',()=>{
 assert.equal(ScanPlan.safeParse({queries:[...plan.queries,...plan.queries]}).success,false);
 assert.equal(ScanPlan.safeParse({queries:Array.from({length:71},(_,i)=>({direction:'x',query:`q${i}`}))}).success,false);
});
test('cancellation halts before any request',async()=>{
 const ac=new AbortController();ac.abort();let called=false;
 await assert.rejects(scanBrainstorm(plan,{...ctx(),signal:ac.signal},{now:clock,search:async()=>{called=true;return[];},channel:async id=>ch(id)}));assert.equal(called,false);
});

test('incomplete search stays visible even when the returned sample is large',async()=>{
 const videos=Array.from({length:20},(_,i)=>v(String(i).padStart(11,'0')));
 const r=await scanBrainstorm(plan,ctx(),{now:clock,search:async(_q,o)=>{if(o?.period==='week')throw Error('failed');return videos;},channel:async id=>ch(id)});
 assert.equal(r.directions[0].videoCount,20);assert.equal(r.directions[0].incomplete,true);
});

test('invalid, unknown, future or out-of-period observations do not nominate channels',async()=>{
 const seen:string[]=[];const invalid={...v('bad'),ageDays:1},unknown={...v('aaaaaaaaaaa'),ageDays:undefined},future={...v('bbbbbbbbbbb'),ageDays:1,publishedAt:'2026-11-07T12:00:00Z'},old={...v('ccccccccccc'),ageDays:40}, valid={...v('ddddddddddd',c2),ageDays:3};
 const r=await scanBrainstorm(plan,ctx(),{now:clock,search:async()=>[invalid,unknown,future,old,valid],channel:async id=>{seen.push(id);return ch(id);}});
 assert.deepEqual(seen,[c2]);assert.equal(r.coverage.candidates,1);
});
