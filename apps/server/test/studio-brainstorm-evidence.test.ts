import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ensureDataDirs} from '../src/lib/storage.js';
import {withTaskSignal} from '../src/lib/taskContext.js';
import {createProject,getProject} from '../src/services/projects.js';
import {saveBrainstormEvidence} from '../src/services/studio/brainstormEvidence.js';
import type {ScanResult} from '../src/services/studio/brainstormScan.js';
const research=():ScanResult=>({observedAt:'2026-11-06T12:00:00.000Z',region:'US',plan:[],coverage:{plannedSearches:2,completedSearches:2,searchErrors:0,truncatedSearches:0,foundRows:0,candidates:0,channelsRequested:0,channelsRead:0,channelErrors:0,channelLimitReached:false,stoppedByYoutube:false,onePagePerQuery:true},directions:[],channels:[]});
async function setup(){await ensureDataDirs();const p=await createProject({title:'Тест'});return {projectId:p.id,runId:randomUUID(),task:'Исследовать нишу',research:research()};}
test('stores evidence as one analysis without modifying other artifacts',async()=>{const input=await setup();const r=await saveBrainstormEvidence(input),project=await getProject(input.projectId);assert.equal(r.alreadySaved,false);assert.equal(project.artifacts.length,1);assert.equal(project.artifacts[0].kind,'analysis');assert.equal((project.artifacts[0].data as any).evidence.research.observedAt,input.research.observedAt);});
test('repeated and concurrent saves are idempotent',async()=>{const input=await setup();const results=await Promise.all([saveBrainstormEvidence(input),saveBrainstormEvidence(input),saveBrainstormEvidence(input)]);assert.equal(results.filter(x=>!x.alreadySaved).length,1);assert.equal(new Set(results.map(x=>x.artifact.id)).size,1);assert.equal((await getProject(input.projectId)).artifacts.length,1);});
test('run id cannot be reused for different evidence',async()=>{const input=await setup();await saveBrainstormEvidence(input);await assert.rejects(saveBrainstormEvidence({...input,task:'Другая задача'}));assert.equal((await getProject(input.projectId)).artifacts.length,1);});
test('invalid IDs and oversized results do not change project',async()=>{const input=await setup();await assert.rejects(saveBrainstormEvidence({...input,projectId:'../../invalid'}));await assert.rejects(saveBrainstormEvidence({...input,research:{...input.research,extra:'x'.repeat(4*1024*1024)} as ScanResult}));assert.equal((await getProject(input.projectId)).artifacts.length,0);});
test('cancelled task does not write',async()=>{const input=await setup();const c=new AbortController();c.abort();await assert.rejects(withTaskSignal(c.signal,()=>saveBrainstormEvidence(input)));assert.equal((await getProject(input.projectId)).artifacts.length,0);});
test('queued save keeps the same frozen data as its hash',async()=>{const input=await setup();const save=saveBrainstormEvidence(input);input.research.region='GB';const r=await save;assert.equal((r.artifact.data as any).evidence.research.region,'US');const original={...input,research:{...input.research,region:'US'}};assert.equal((await saveBrainstormEvidence(original)).alreadySaved,true);});
