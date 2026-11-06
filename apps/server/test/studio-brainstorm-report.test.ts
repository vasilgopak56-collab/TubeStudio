import {test} from 'node:test';import assert from 'node:assert/strict';
import {composeBrainstormReport} from '../src/services/studio/brainstormReport.js';
import {summarizeDirections} from '../src/services/studio/brainstormResearch.js';
import type {ScanResult} from '../src/services/studio/brainstormScan.js';
const observedAt='2026-11-06T12:00:00.000Z';
const dirs=summarizeDirections([{direction:'Winter',query:'snow',period:'week',video:{id:'aaaaaaaaaaa',title:'Real',views:123456,ageDays:2}}],[],observedAt);
const scan:ScanResult={observedAt,region:'US',plan:[{direction:'Winter',query:'snow'}],coverage:{plannedSearches:2,completedSearches:2,searchErrors:0,truncatedSearches:0,foundRows:1,candidates:0,channelsRequested:0,channelsRead:0,channelErrors:0,channelLimitReached:false,stoppedByYoutube:false,onePagePerQuery:true},directions:dirs,channels:[]};
const proposal=()=>({ideas:Array.from({length:8},(_,i)=>({title:`Idea ${i}`,score:7,reason:'Предположение модели',dimensions:Object.fromEntries(['demand','competition','production','monetization','topicSupply','revenue'].map(k=>[k,{score:7,reason:'Предположение'}])),direction:'Winter',topicQuery:null as string|null}))});
test('report copies measurements and links from observations, not model',()=>{const r=composeBrainstormReport(scan,[],proposal());assert.equal(r.ideas.length,8);assert.equal(r.ideas[0].evidence.medianViews,123456);assert.equal(r.ideas[0].evidence.sources[0].url,'https://www.youtube.com/watch?v=aaaaaaaaaaa');assert.equal(r.ideas[0].evidence.incomplete,true);assert.match(r.notice,/предложения модели/);});
test('unknown or empty direction rejects entire report',()=>{const p=proposal();p.ideas[2].direction='Imaginary';assert.throws(()=>composeBrainstormReport(scan,[],p));assert.throws(()=>composeBrainstormReport({...scan,directions:[{...dirs[0],sources:[]}]},[],proposal()));});
test('unknown, failed and ambiguous topic checks rejected',()=>{const p=proposal();p.ideas[0].topicQuery='snow';assert.throws(()=>composeBrainstormReport(scan,[],p));assert.throws(()=>composeBrainstormReport(scan,[{query:'snow',status:'failed',sample:null}],p));});
test('model metrics, links, duplicates, wrong scores, extra or fewer ideas rejected',()=>{let p:any=proposal();p.ideas[0].views=1000000;assert.throws(()=>composeBrainstormReport(scan,[],p));p=proposal();p.ideas[1].title=p.ideas[0].title;assert.throws(()=>composeBrainstormReport(scan,[],p));p=proposal();p.ideas[0].score=11;assert.throws(()=>composeBrainstormReport(scan,[],p));p=proposal();p.ideas.pop();assert.throws(()=>composeBrainstormReport(scan,[],p));});

test('zero is a valid subjective score on the agreed 0–10 scale',()=>{const p=proposal();p.ideas[0].score=0;assert.equal(composeBrainstormReport(scan,[],p).ideas[0].score,0);});
test('report limits inline sources while disclosing total',()=>{const source=dirs[0].sources[0];const larger={...scan,directions:[{...dirs[0],sources:Array.from({length:6},(_,i)=>({...source,videoId:String(i).padStart(11,'0'),url:`https://www.youtube.com/watch?v=${String(i).padStart(11,'0')}`}))}]};const r=composeBrainstormReport(larger,[],proposal());assert.equal(r.ideas[0].evidence.sources.length,5);assert.equal(r.ideas[0].evidence.sourcesTotal,6);assert.equal(r.ideas[0].evidence.sourcesTruncated,true);});
test('six independently explained dimensions survive in report, including unknowns',()=>{
 const p:any=proposal();p.ideas[0].dimensions.demand={score:9,reason:'В выборке есть просмотры'};p.ideas[0].dimensions.revenue={score:null,reason:'Нет данных о доходе'};
 const idea=composeBrainstormReport(scan,[],p).ideas[0];assert.equal(idea.dimensions.demand.score,9);assert.equal(idea.dimensions.revenue.score,null);assert.equal(idea.dimensions.revenue.reason,'Нет данных о доходе');
});
test('reject missing or invalid dimension and unsupported model data',()=>{
 let p:any=proposal();delete p.ideas[0].dimensions.demand;assert.throws(()=>composeBrainstormReport(scan,[],p));
 p=proposal();p.ideas[0].dimensions.competition.score=11;assert.throws(()=>composeBrainstormReport(scan,[],p));
 p=proposal();p.ideas[0].dimensions.revenue.reason='';assert.throws(()=>composeBrainstormReport(scan,[],p));
 p=proposal();p.ideas[0].dimensions.revenue.amount=500;assert.throws(()=>composeBrainstormReport(scan,[],p));
});
