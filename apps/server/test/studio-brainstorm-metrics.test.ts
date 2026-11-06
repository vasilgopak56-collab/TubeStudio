import {test} from 'node:test';import assert from 'node:assert/strict';
import {topicSample,channelSample} from '../src/services/studio/brainstormMetrics.js';
import type {WebVideo,WebChannel} from '../src/services/studio/ytweb.js';
const v=(n:number,views:number|undefined,ageDays:number|undefined):WebVideo=>({id:String(n).padStart(11,'0'),title:`Video ${n}`,views,ageDays});
const c=(vs:WebVideo[],more=false,subs:number|undefined=1000):WebChannel=>({id:'UCabcdefghijklmnopqrstuv',name:'Sample',subs,longVideos:vs,hasMoreLong:more});
const now='2026-11-06T00:00:00Z';
test('topic takes first 12 unique results and keeps unknowns distinct',()=>{const a=Array.from({length:14},(_,i)=>v(i,i===1?undefined:i*100000,1));const r=topicSample('query',[a[0],a[0],...a.slice(1)]);assert.equal(r.found,12);assert.equal(r.knownViews,11);assert.equal(r.topViews,1100000);assert.equal(r.incomplete,true);assert.equal(r.over100k,10);});
test('channel median, observed oldest and best in 16 days are from sample',()=>{const r=channelSample(c([v(1,20,3),v(2,80,14),v(3,200,20)]),now);assert.equal(r.medianViews,80);assert.equal(r.oldestObservedVideoDays,20);assert.equal(r.oldestCoversVisibleList,true);assert.equal(r.bestRecent?.views,80);assert.equal(r.bestRecent?.viewSubscriberRatio,0.08);});
test('oldest observed video is not advertised as complete for a truncated or undated sample',()=>{let r=channelSample(c([v(1,20,3)],true),now);assert.equal(r.oldestCoversVisibleList,false);r=channelSample(c([v(1,20,undefined)]),now);assert.equal(r.oldestObservedVideoDays,null);assert.equal(r.incomplete,true);});
test('missing subscriber/view counts and future timestamps remain uncertain',()=>{const vid={...v(1,undefined,1),publishedAt:'2026-11-07T00:00:00Z'};const channel=c([vid]);channel.subs=undefined;const r=channelSample(channel,now);assert.equal(r.subscribers,null);assert.equal(r.medianViews,null);assert.equal(r.bestRecent,null);assert.equal(r.oldestCoversVisibleList,false);});
test('caps channel video sample at 60',()=>{const r=channelSample(c(Array.from({length:61},(_,i)=>v(i,i,2))),now);assert.equal(r.sampleSize,60);assert.equal(r.oldestCoversVisibleList,false);assert.equal(r.incomplete,true);});

test('recent video ratio remains unknown when subscribers are zero or missing',()=>{for(const subs of [0,undefined]){const channel=c([v(1,100,3)]);channel.subs=subs;assert.equal(channelSample(channel,now).bestRecent?.viewSubscriberRatio,null);}});
