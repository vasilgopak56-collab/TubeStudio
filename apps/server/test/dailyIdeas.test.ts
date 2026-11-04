import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type {JobCtx} from '../src/lib/jobs.js';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-daily-unit-'));
process.env.DATA_DIR=dir;process.env.ANTHROPIC_API_KEY='DUMMY_DAILY_KEY';
const {DailySelection,DailyOutput,dailyContext,dailySources,previewDaily,generateDaily,loadDaily,listDaily,latestDaily}=await import('../src/services/dailyIdeas.js');
const {writeJson}=await import('../src/lib/storage.js');
const {PROMPTS_DIR}=await import('../src/services/prompts.js');
const {dailyIdeasRoute}=await import('../src/routes/dailyIdeas.js');
const id=crypto.randomUUID(),date='2025-01-01T00:00:00Z',channel='UC'+'d'.repeat(22);
const selection=DailySelection.parse({kind:'analysis',id,language:'ru'});
const report={id,createdAt:date,channel:{title:'Сохранённый канал',secret:'NEVER_SEND'},videos:Array.from({length:12},(_,i)=>({id:String(i).padStart(11,'a'),title:`Акведук ${i}`,views:i,viewsKnown:i!==1,publishedAt:date,tags:['вода'],description:'NEVER_SEND'})),income:'NEVER_SEND',insights:'NEVER_SEND'};
const output={ideas:Array.from({length:5},(_,i)=>({title:`Путь воды ${i}`,angle:'Инженерия города',hook:'Как работал акведук?',why:'Гипотеза по сохранённым названиям',check:'Проверьте факты и авторские права',evidenceRefs:['E1']}))};
const ctx=(a=new AbortController()):JobCtx=>({signal:a.signal,progress(){},partial(){}});
const files=async()=>{try{return (await fs.readdir(path.join(dir,'daily-idea-runs'))).sort();}catch{return [];}};
async function network<T>(fn:(b:any[])=>Promise<T>,text=JSON.stringify(output),hook?:()=>void){const orig=globalThis.fetch,b:any[]=[];globalThis.fetch=(async(url:any,init?:RequestInit)=>{assert.equal(String(url),'https://api.anthropic.com/v1/messages');b.push(JSON.parse(String(init?.body)));hook?.();return Response.json({content:[{type:'text',text}],usage:{input_tokens:50,output_tokens:100}});}) as typeof fetch;try{return await fn(b);}finally{globalThis.fetch=orig;}}
async function local<T>(fn:()=>Promise<T>){const orig=globalThis.fetch;globalThis.fetch=(async()=>{throw Error('Unexpected network');}) as typeof fetch;try{return await fn();}finally{globalThis.fetch=orig;}}
async function gen(){const p=await previewDaily(selection);return generateDaily({selection,previewHash:p.hash},ctx());}
after(async()=>{await fs.rm(dir,{recursive:true,force:true});});
test('daily schemas: strict IDs, language, lengths, exactly five distinct ideas',()=>{
 for(const v of [{...selection,id:'../settings'},{...selection,language:'xx'},{...selection,extra:1},{...selection,angle:'x'.repeat(501)},{...selection,kind:'competitor'}])assert.equal(DailySelection.safeParse(v).success,false);
 assert.equal(DailySelection.safeParse({...selection,kind:'research',id:'a1b2c3d4'}).success,true);assert.equal(DailySelection.safeParse({...selection,kind:'keywords',id:'a1b2c3d4'}).success,true);assert.equal(DailySelection.safeParse({...selection,kind:'analysis',id:'a1b2c3d4'}).success,false);
 assert.equal(DailyOutput.safeParse(output).success,true);for(const v of [{ideas:output.ideas.slice(1)},{ideas:Array(5).fill(output.ideas[0])},{...output,extra:1},{ideas:output.ideas.map(x=>({...x,evidenceRefs:[]}))}])assert.equal(DailyOutput.safeParse(v).success,false);
});
test('daily analysis projection is bounded, saved-only, strips secrets, unknown is not zero',async()=>local(async()=>{
 await writeJson(`reports/${id}.json`,report);await writeJson('reports/index.json',[{id,createdAt:date,title:'Канал'}]);const c=await dailyContext(selection);
 assert.equal(c.total,12);assert.equal(c.evidence.length,10);assert.equal(c.evidence[0].views,0);assert.equal(c.evidence[1].views,null);assert.equal(c.source.savedAt,date);assert.doesNotMatch(JSON.stringify(c),/NEVER_SEND/);assert.match(c.warnings.join(' '),/первые 10 из 12/);
 assert.equal((await dailySources()).items[0].id,id);
}));
test('daily research, keywords and competitor sources exclude heuristic scores and future counters',async()=>local(async()=>{
 const r=crypto.randomUUID().slice(0,8),k=crypto.randomUUID().slice(0,8);await writeJson(`research-runs/${r}.json`,{id:r,createdAt:date,input:{q:'История'},rows:report.videos.map(v=>({...v,viewsKnown:undefined,score:'NEVER_SEND'}))});await writeJson(`keyword-runs/${k}.json`,{id:k,createdAt:date,input:{seed:'Рим'},keywords:[{keyword:'История воды',volume:999,competition:'NEVER_SEND'}]});
 await writeJson('research-runs/index.json',[{id:r,createdAt:date,q:'История'}]);await writeJson('keyword-runs/index.json',[{id:k,createdAt:date,seed:'Рим'}]);
 const research=await dailyContext({...selection,kind:'research',id:r});assert.ok(research.evidence.every(e=>e.views===null));
 const key=await dailyContext({...selection,kind:'keywords',id:k});assert.equal(key.evidence[0].videoId,null);assert.equal(key.evidence[0].title,'История воды');assert.doesNotMatch(JSON.stringify(key),/NEVER_SEND|"volume"|"competition"/);
 await writeJson('competitors.json',{channels:[{id:channel,title:'Конкурент',lastRefresh:date,videos:[{id:'abcdefghijk',title:'Акведук',publishedAt:date,points:[{t:1,v:0,viewsKnown:true},{t:Date.parse(date)+1,v:999,viewsKnown:true}]}]}]});
 const c=await dailyContext({...selection,kind:'competitor',id:channel});assert.equal(c.evidence[0].views,0);assert.equal(c.source.savedAt,date);
 const listed=(await dailySources()).items;assert.ok(listed.some(s=>s.kind==='competitor'));assert.ok(listed.some(s=>s.kind==='research'&&s.id===r));assert.ok(listed.some(s=>s.kind==='keywords'&&s.id===k));
}));
test('daily missing, empty, oversized and symlink source rejected without network',async()=>local(async()=>{
 const bad=crypto.randomUUID();await assert.rejects(dailyContext({...selection,id:bad}),/не найден/);
 await writeJson(`reports/${bad}.json`,{...report,id:bad,videos:[]});await assert.rejects(dailyContext({...selection,id:bad}),/непустых/);
 await fs.writeFile(path.join(dir,'reports',bad+'.json'),' '.repeat(2*1024*1024+1));await assert.rejects(dailyContext({...selection,id:bad}),/не найден/);await fs.rm(path.join(dir,'reports',bad+'.json'));
 await fs.symlink(path.join(dir,'reports',id+'.json'),path.join(dir,'reports',bad+'.json'));await assert.rejects(dailyContext({...selection,id:bad}),/не найден/);
}));
test('daily unicode clipping and long tags remain within schema bounds',async()=>{
 await writeJson(`reports/${id}.json`,{...report,videos:[{...report.videos[0],title:'😀'.repeat(300),tags:['😀'.repeat(80)]}]});const c=await dailyContext(selection);assert.ok(c.evidence[0].title.length<=300);assert.ok(c.evidence[0].tags[0].length<=80);await writeJson(`reports/${id}.json`,report);
});
test('daily preview is local deterministic exact payload; stale form/source/prompt rejected before provider',async()=>local(async()=>{
 const p=await previewDaily(selection);assert.equal((await previewDaily(selection)).hash,p.hash);assert.deepEqual(JSON.parse(p.user),{context:p.context,authorAngle:''});assert.match(p.system,/Russian/);
 await assert.rejects(generateDaily({selection:{...selection,angle:'Другой ракурс'},previewHash:p.hash},ctx()),/изменились/);
 await writeJson(`reports/${id}.json`,{...report,channel:{title:'Изменение'}});await assert.rejects(generateDaily({selection,previewHash:p.hash},ctx()),/изменились/);await writeJson(`reports/${id}.json`,report);
 const prompt=path.join(PROMPTS_DIR,'daily-ideas/ideas.md'),old=await fs.readFile(prompt,'utf8');try{await fs.writeFile(prompt,old+'\nNew');await assert.rejects(generateDaily({selection,previewHash:p.hash},ctx()),/изменились/);}finally{await fs.writeFile(prompt,old);}
 assert.equal((await files()).length,0);
}));
test('daily one explicit model request uses exact shown system/user and pins immutable snapshot',async()=>network(async bodies=>{
 const p=await previewDaily(selection),r=await generateDaily({selection,previewHash:p.hash},ctx());assert.equal(bodies.length,1);assert.equal(bodies[0].system[0].text,p.system);assert.equal(bodies[0].messages[0].content,p.user);assert.equal(bodies[0].max_tokens,4000);assert.equal(r.ideas.length,5);assert.ok(r.model);assert.equal(r.dayUTC,r.createdAt.slice(0,10));assert.deepEqual(await loadDaily(r.id),r);
 await writeJson(`reports/${id}.json`,{...report,channel:{title:'CHANGED'}});assert.deepEqual(await loadDaily(r.id),r);await writeJson(`reports/${id}.json`,report);assert.equal((await latestDaily())?.id,r.id);assert.equal((await fs.stat(path.join(dir,'daily-idea-runs',r.id+'.json'))).mode&0o777,0o600);
}));
test('daily invalid JSON, duplicates, unknown/duplicate refs and oversize answers never retry or save',async()=>{
 const before=await files();for(const answer of ['{}',JSON.stringify({ideas:Array(5).fill(output.ideas[0])}),JSON.stringify({ideas:output.ideas.map(x=>({...x,evidenceRefs:['E10']}))}).replaceAll('E10','E9'),JSON.stringify({ideas:output.ideas.map(x=>({...x,evidenceRefs:['E1','E1']}))}),'x'.repeat(25001)]){
 // E9 exists in the regular report; use one-row source to make it unavailable.
 await writeJson(`reports/${id}.json`,{...report,videos:report.videos.slice(0,1)});await network(async bodies=>{await assert.rejects(gen(),/не прошёл/);assert.equal(bodies.length,1);},answer);
 }await writeJson(`reports/${id}.json`,report);assert.deepEqual(await files(),before);
});
test('daily cancellation before network, during response and commit saves nothing new',async()=>{
 const before=await files(),p=await previewDaily(selection),a=new AbortController();a.abort();await local(()=>assert.rejects(generateDaily({selection,previewHash:p.hash},ctx(a)),/отмен/i));
 const b=new AbortController();await network(()=>assert.rejects(generateDaily({selection,previewHash:p.hash},ctx(b)),/отмен/i),JSON.stringify(output),()=>b.abort());
 const c=new AbortController(),rename=fs.rename;fs.rename=(async(from:any,to:any)=>{await rename(from,to);if(String(to).includes('daily-idea-runs'))c.abort();}) as typeof fs.rename;try{await network(()=>assert.rejects(generateDaily({selection,previewHash:p.hash},ctx(c)),/отмен/i));}finally{fs.rename=rename;}assert.deepEqual(await files(),before);
});
test('daily history validates hashes and cross-field invariants, skips corrupt/symlink files, latest fifty',async()=>{
 const original=(await latestDaily())!;for(let i=0;i<52;i++){const n=crypto.randomUUID(),at=new Date(Date.UTC(2090,0,i+1)).toISOString();await writeJson(`daily-idea-runs/${n}.json`,{...original,id:n,createdAt:at,dayUTC:at.slice(0,10)});}
 const invalid=crypto.randomUUID();await writeJson(`daily-idea-runs/${invalid}.json`,{...original,id:invalid,preview:{...original.preview,hash:'0'.repeat(64)}});assert.equal(await loadDaily(invalid),null);
 const linked=crypto.randomUUID();await fs.symlink(path.join(dir,'daily-idea-runs',original.id+'.json'),path.join(dir,'daily-idea-runs',linked+'.json'));
 const list=await listDaily();assert.equal(list.items.length,50);assert.equal(list.skipped,2);assert.ok(list.items[0].createdAt.startsWith('2090'));assert.deepEqual(await loadDaily(original.id),original);await assert.rejects(loadDaily('../settings'),/Неверный/);
});
test('daily HTTP validates before starting jobs and enforces body limit',async()=>{
 for(const value of [{...selection,extra:true},{...selection,id:'bad'},{...selection,language:'x'}])assert.equal((await dailyIdeasRoute.request('/daily-ideas/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)})).status,400);
 assert.equal((await dailyIdeasRoute.request('/daily-ideas/generate',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,400);
 assert.equal((await dailyIdeasRoute.request('/daily-ideas/preview',{method:'POST',body:'x'.repeat(9000)})).status,413);
});
test('daily shared budget and missing key stop before provider without saving',async()=>{
 const {config}=await import('../src/config.js'),{getSettings,updateSettings}=await import('../src/services/settings.js'),{addLlmUsage}=await import('../src/services/usage.js');const before=await files(),old=config.keys.anthropic;
 try{config.keys.anthropic='';await local(()=>assert.rejects(gen(),(e:any)=>e.code==='KEY_MISSING'));}finally{config.keys.anthropic=old;}
 const settings=await getSettings();await addLlmUsage(settings.models.anthropic,1000000,1000000);await updateSettings({budget:{monthlyUsd:0.0001,mode:'block'}});
 try{await local(()=>assert.rejects(gen(),(e:any)=>e.code==='BUDGET_LIMIT'));}finally{await updateSettings({budget:settings.budget});}assert.deepEqual(await files(),before);
});
test('daily loaded preview rejects rehashed inconsistent selection, payload or evidence numbering',async()=>{
 const original=(await latestDaily())!,digest=(p:any)=>crypto.createHash('sha256').update(JSON.stringify([p.selection,p.context,p.system,p.user])).digest('hex');
 for(const transform of [(p:any)=>{p.selection.id=crypto.randomUUID();},(p:any)=>{p.user='{}';},(p:any)=>{p.context.evidence[0].ref='E2';p.user=JSON.stringify({context:p.context,authorAngle:p.selection.angle});}]){const r=structuredClone(original);r.id=crypto.randomUUID();transform(r.preview);r.preview.hash=digest(r.preview);await writeJson(`daily-idea-runs/${r.id}.json`,r);assert.equal(await loadDaily(r.id),null);}
});
test('daily saved projection roundtrip keeps literal fields and bytes independent of live source',async()=>network(async()=>{
 const custom={...report,videos:[{...report.videos[0],title:'<img src=x onerror=alert(1)> עברית 日本語',views:0,viewsKnown:true,tags:['<script>not code</script>'],publishedAt:'invalid-source-date'},{...report.videos[1],views:500,viewsKnown:false,tags:[]}]};
 await writeJson(`reports/${id}.json`,custom);try{const r=await gen(),file=path.join(dir,'daily-idea-runs',r.id+'.json'),bytes=await fs.readFile(file,'utf8');await fs.rm(path.join(dir,'reports',id+'.json'));const saved=(await loadDaily(r.id))!;assert.deepEqual(saved,r);assert.equal(saved.preview.context.evidence[0].views,0);assert.equal(saved.preview.context.evidence[1].views,null);assert.equal(saved.preview.context.evidence[0].publishedAt,'invalid-source-date');assert.deepEqual(saved.preview.context.evidence[0].tags,['<script>not code</script>']);assert.equal(await fs.readFile(file,'utf8'),bytes);}finally{await writeJson(`reports/${id}.json`,report);}
}));
test('daily source opened-file size is rechecked and no over-limit projection is read',async()=>local(async()=>{
 await writeJson(`reports/${id}.json`,report);const open=fs.open;let reached=false;
 fs.open=(async(...args:any[])=>{const handle=await (open as any)(...args);if(String(args[0]).endsWith(`/reports/${id}.json`)){const stat=handle.stat.bind(handle);handle.stat=(async()=>{reached=true;return {...await stat(),isFile:()=>true,size:2*1024*1024+1};}) as any;}return handle;}) as typeof fs.open;
 try{await assert.rejects(dailyContext(selection),/не найден/);assert.equal(reached,true);}finally{fs.open=open;}
}));
