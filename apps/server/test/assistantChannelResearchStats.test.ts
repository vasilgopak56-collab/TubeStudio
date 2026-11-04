import {test} from 'node:test';
import assert from 'node:assert/strict';
import {channelResearchStats} from '../../web/src/features/assistant/channelResearchStats.js';
const doc=(positions:unknown[])=>JSON.stringify({format:'tubestudio-channel-selection',version:1,positions});
const row=(id:string,views:unknown,status='available')=>({id,views,status});
test('snapshot statistics count positions and unique valid IDs, not duplicate views',()=>{
 const r=channelResearchStats(doc([row('abcdefghijk',100),row('abcdefghijk',100),row('lmnopqrstuv',0),row('0123456789a',null),row('bad',999),null]));
 assert.deepEqual(r,{positions:6,validIds:3,repeatedPositions:1,invalidIds:2,usableViews:2,unusableIds:1,minViews:0,maxViews:100});
});
test('snapshot statistics omit conflicting, missing, unavailable and invalid views instead of guessing',()=>{
 const r=channelResearchStats(doc([row('abcdefghijk',1),row('abcdefghijk',2),row('lmnopqrstuv',3),row('lmnopqrstuv',null),row('0123456789a',4,'unavailable'),row('0123456789b',1.5),row('0123456789c',Number.MAX_SAFE_INTEGER+1),row('0123456789d',-1)]))!;
 assert.equal(r.validIds,6);assert.equal(r.repeatedPositions,2);assert.equal(r.usableViews,0);assert.equal(r.unusableIds,6);assert.equal(r.minViews,null);assert.equal(r.maxViews,null);
});
test('snapshot statistics refuse wrong markers or oversized lists',()=>{
 for(const x of ['{','null',JSON.stringify({format:'tubestudio-channel-selection',version:2,positions:[{}]}),doc([]),doc(Array(21).fill({}))])assert.equal(channelResearchStats(x),null);
});
