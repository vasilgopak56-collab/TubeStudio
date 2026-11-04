import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type {JobCtx} from '../src/lib/jobs.js';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-seo-unit-'));
process.env.DATA_DIR=dir;process.env.YOUTUBE_API_KEY='DUMMY_SEO_UNIT_KEY';
const {SeoAuditInput,SeoSearchInput,seoChecklist,createSeoAudit,searchSeoAudit:searchSeoAuditRaw,previewSeoAudit,SeoSearchGenerate,loadSeoAudit,listSeoAudits}=await import('../src/services/seoAudit.js');
const searchSeoAudit=async(d:zSearch,context:JobCtx)=>searchSeoAuditRaw({...d,previewHash:(await previewSeoAudit(d)).hash},context);
type zSearch=ReturnType<typeof SeoSearchInput.parse>;
const {seoAuditRoute}=await import('../src/routes/seoAudit.js');
const {addYoutubeUnits}=await import('../src/services/usage.js');
const input=SeoAuditInput.parse({title:'Как вода попадала в Рим <img src=x onerror=alert(1)> עברית 日本語',description:'Всё об акведуках',tags:['Рим','рим','Вода'],keyword:'ВСЕ'});
const ctx=(a=new AbortController()):JobCtx=>({signal:a.signal,progress(){},partial(){}});
const files=async()=>{try{return (await fs.readdir(path.join(dir,'seo-audit-runs'))).sort();}catch{return [];}};
const rows=['aaaaaaaaaaa','abcdefghijk','bbbbbbbbbbb'].map((videoId,i)=>({id:{videoId},snippet:{title:'Рим '+i+' <img src=x onerror=alert(1)> עברית 日本語',channelTitle:'Канал',publishedAt:'2020-01-01T00:00:00Z',thumbnails:{secret:'NOT_SAVED'}}}));
async function network<T>(fn:(calls:URL[])=>Promise<T>,data:unknown={items:rows,nextPageToken:'more'},status=200,hook?:()=>void){const old=globalThis.fetch,calls:URL[]=[];globalThis.fetch=(async(url:any)=>{calls.push(new URL(String(url)));hook?.();return Response.json(data,{status});}) as typeof fetch;try{return await fn(calls);}finally{globalThis.fetch=old;}}
async function local<T>(fn:()=>Promise<T>){return network(async c=>{const r=await fn();assert.equal(c.length,0);return r;});}
const request=(id:string,extra={})=>SeoSearchInput.parse({auditId:id,query:'Акведуки Рима',language:'ru',region:'US',video:'https://youtu.be/abcdefghijk',...extra});
after(async()=>{await addYoutubeUnits(0);await fs.rm(dir,{recursive:true,force:true});});
test('seo strict schemas, UTF16 bounds, optional ID parsing and language/region validation',()=>{
 for(const x of [{title:''},{...input,extra:1},{...input,title:'x'.repeat(301)},{...input,tags:Array(61).fill('x')},{...input,tags:['']},{...input,description:'x'.repeat(10001)}])assert.equal(SeoAuditInput.safeParse(x).success,false);
 const id=crypto.randomUUID();assert.equal(request(id).targetId,'abcdefghijk');assert.equal(request(id,{video:''}).targetId,null);
 for(const x of [{auditId:'../x'},{language:'xx'},{region:'us'},{query:'x'},{video:'https://evil.test/watch?v=abcdefghijk'},{extra:1}])assert.throws(()=>request(id,x));
});
test('seo deterministic checklist normalizes NFKC/ё, duplicate tags and empty keyword without scoring',()=>{
 const c=seoChecklist(input);assert.equal(c.matches.description,true);assert.equal(c.counts.duplicateTags,1);assert.equal(c.checks.length,6);assert.ok(!('score' in c));
 const n=seoChecklist({...input,title:'ＲＩＭ Ёлка',keyword:'rim елка'});assert.equal(n.matches.title,true);
 assert.equal(seoChecklist({...input,keyword:''}).matches.description,false);assert.equal(seoChecklist({...input,keyword:''}).checks.find(x=>x.key==='keyword')?.state,'manual');
 assert.equal(seoChecklist({...input,title:'😀'.repeat(51)}).counts.title,102);assert.equal(seoChecklist({...input,title:'😀'.repeat(51)}).checks[0].state,'attention');
});
test('seo thresholds and small wording dictionary are observations not publication or ban decisions',()=>{
 const c=seoChecklist({...input,title:'100% без риска',description:'',tags:Array(6).fill('x'.repeat(100))});assert.ok(c.flags.some(f=>f.term==='100%'&&f.field==='title'));assert.equal(c.checks[1].state,'attention');assert.equal(c.checks[2].state,'attention');assert.match(c.checks[4].detail,/не список запрещённых/);assert.equal(c.checks[5].state,'manual');
 assert.equal(seoChecklist({...input,title:'Обычный текст',description:'',tags:[]}).checks[2].state,'observed');
});
test('seo local immutable snapshots require no provider; private file and derived read roundtrip',async()=>local(async()=>{
 const r=await createSeoAudit(input);assert.equal(r.search,null);assert.equal(r.searchPosition,null);assert.deepEqual(await loadSeoAudit(r.id),r);assert.equal((await fs.stat(path.join(dir,'seo-audit-runs',r.id+'.json'))).mode&0o777,0o600);
 input.title='Изменение объекта';assert.notEqual((await loadSeoAudit(r.id))?.input.title,input.title);input.title=r.input.title;assert.ok((await listSeoAudits()).items.some(x=>x.id===r.id));
}));
test('seo search makes one fresh page per click, exact API params, raw order and 100 units',async()=>{
 const r=await createSeoAudit(input);await addYoutubeUnits(0);const before=JSON.parse(await fs.readFile(path.join(dir,'usage.json'),'utf8'));
 await network(async calls=>{for(let i=0;i<2;i++){const out=await searchSeoAudit(request(r.id),ctx());assert.equal(out.searchPosition,2);assert.equal(out.parentId,r.id);assert.deepEqual(out.input,r.input);assert.deepEqual(out.search!.rows.map(x=>x.id),rows.map(x=>x.id.videoId));assert.equal(out.search!.hasMore,true);assert.doesNotMatch(JSON.stringify(out),/NOT_SAVED|DUMMY_/);assert.deepEqual(await loadSeoAudit(out.id),out);}assert.equal(calls.length,2);for(const u of calls){assert.equal(u.origin,'https://www.googleapis.com');assert.equal(u.pathname,'/youtube/v3/search');assert.equal(u.searchParams.get('q'),'Акведуки Рима');assert.equal(u.searchParams.get('maxResults'),'50');assert.equal(u.searchParams.get('order'),'relevance');assert.equal(u.searchParams.get('regionCode'),'US');assert.equal(u.searchParams.get('relevanceLanguage'),'ru');assert.equal(u.searchParams.get('safeSearch'),'moderate');assert.equal(u.searchParams.get('videoId'),null);assert.equal(u.searchParams.size,9);}});
 await addYoutubeUnits(0);const after=JSON.parse(await fs.readFile(path.join(dir,'usage.json'),'utf8'));const sum=(x:any)=>Object.values(x.youtubeUnits).reduce((a:any,b:any)=>a+b,0) as number;assert.equal(sum(after)-sum(before),200);assert.equal((await loadSeoAudit(r.id))?.search,null);
});
test('seo missing match, no target, empty page and no next page stay distinct and null not zero',async()=>{
 const r=await createSeoAudit(input);await network(async()=>{const out=await searchSeoAudit(request(r.id,{video:'zzzzzzzzzzz',region:''}),ctx());assert.equal(out.searchPosition,null);assert.equal(out.search?.hasMore,false);assert.equal(out.search?.region,null);},{items:rows});
 await network(async()=>{const out=await searchSeoAudit(request(r.id,{video:''}),ctx());assert.equal(out.searchPosition,null);assert.deepEqual(out.search?.rows,[]);},{items:[]});
});
test('seo malformed/duplicate pages and provider errors are sanitized, never saved or repaired',async()=>{
 const r=await createSeoAudit(input),before=await files();for(const data of [{},{items:[rows[0],rows[0]]},{items:[{id:{videoId:'bad'},snippet:{}}]},{items:Array(51).fill(rows[0])}])await network(()=>assert.rejects(searchSeoAudit(request(r.id),ctx()),(e:any)=>e.code==='UPSTREAM'),data);
 await network(()=>assert.rejects(searchSeoAudit(request(r.id),ctx()),(e:any)=>e.code==='UPSTREAM'&&!e.message.includes('SECRET_PROVIDER_LEAK')),{error:{message:'SECRET_PROVIDER_LEAK'}},400);assert.deepEqual(await files(),before);
});
test('seo missing source/key abort before network; pre-cancel, response-cancel and commit-cancel leave no files',async()=>{
 const r=await createSeoAudit(input),before=await files();await local(()=>assert.rejects(searchSeoAudit(request(crypto.randomUUID()),ctx()),(e:any)=>e.code==='NOT_FOUND'));
 const {config}=await import('../src/config.js'),old=config.keys.youtube;config.keys.youtube='';try{await local(()=>assert.rejects(searchSeoAudit(request(r.id),ctx()),(e:any)=>e.code==='KEY_MISSING'));}finally{config.keys.youtube=old;}
 const a=new AbortController();a.abort();await local(()=>assert.rejects(searchSeoAudit(request(r.id),ctx(a)),/отмен/i));
 const b=new AbortController();await network(()=>assert.rejects(searchSeoAudit(request(r.id),ctx(b)),/отмен/i),{items:rows},200,()=>b.abort());
 const c=new AbortController(),rename=fs.rename;fs.rename=(async(from:any,to:any)=>{await rename(from,to);if(String(to).includes('seo-audit-runs'))c.abort();}) as typeof fs.rename;try{await network(()=>assert.rejects(searchSeoAudit(request(r.id),ctx(c)),/отмен/i));}finally{fs.rename=rename;}assert.deepEqual(await files(),before);
});
test('seo history rejects invalid/corrupt/version/id/derived fields and symlink, latest fifty',async()=>{
 const original=await createSeoAudit(input),raw=JSON.parse(await fs.readFile(path.join(dir,'seo-audit-runs',original.id+'.json'),'utf8'));
 for(const changed of [{id:crypto.randomUUID()},{version:999},{local:{score:100}},{parentId:crypto.randomUUID()}]){const id=crypto.randomUUID();await fs.writeFile(path.join(dir,'seo-audit-runs',id+'.json'),JSON.stringify({...raw,id,...changed}));assert.equal(await loadSeoAudit(id),null);}
 const linked=crypto.randomUUID();await fs.symlink(path.join(dir,'seo-audit-runs',original.id+'.json'),path.join(dir,'seo-audit-runs',linked+'.json'));assert.equal(await loadSeoAudit(linked),null);
 const huge=crypto.randomUUID();await fs.writeFile(path.join(dir,'seo-audit-runs',huge+'.json'),' '.repeat(256*1024+1));assert.equal(await loadSeoAudit(huge),null);
 for(let i=0;i<51;i++){const id=crypto.randomUUID();await fs.writeFile(path.join(dir,'seo-audit-runs',id+'.json'),JSON.stringify({...raw,id,createdAt:new Date(Date.UTC(2090,0,i+1)).toISOString()}));}const list=await listSeoAudits();assert.equal(list.items.length,50);assert.ok(list.skipped>=6);assert.ok(list.items[0].createdAt.startsWith('2090'));await assert.rejects(loadSeoAudit('../x'),/Неверный/);
});
test('seo route validates raw body before job and enforces limits',async()=>local(async()=>{
 const req=(url:string,body:string)=>seoAuditRoute.request(url,{method:'POST',headers:{'content-type':'application/json'},body});
 for(const body of ['{}','{',JSON.stringify({...input,title:''})])assert.equal((await req('/seo-audit/local',body)).status,400);
 assert.equal((await req('/seo-audit/local','x'.repeat(65537))).status,413);assert.equal((await req('/seo-audit/search','{}')).status,400);assert.equal((await seoAuditRoute.request('/seo-audit/runs/bad')).status,400);
}));
test('seo preview is local exact public params without key or unsent text and hash deterministic',async()=>local(async()=>{
 const r=await createSeoAudit(input),d=request(r.id,{region:''}),before=await files(),p=await previewSeoAudit(d);
 assert.deepEqual(await previewSeoAudit(d),p);assert.equal(p.targetId,'abcdefghijk');assert.equal(p.auditId,r.id);
 assert.deepEqual(p.request.params,{part:'snippet',type:'video',q:'Акведуки Рима',order:'relevance',maxResults:50,relevanceLanguage:'ru',safeSearch:'moderate'});
 assert.doesNotMatch(JSON.stringify(p),/DUMMY_|Как вода|Всё об/);assert.deepEqual(await files(),before);
}));
test('seo guarded search rejects missing hash and stale parameters/source before quota',async()=>local(async()=>{
 const r=await createSeoAudit(input),d=request(r.id),p=await previewSeoAudit(d),before=await files();
 assert.equal(SeoSearchGenerate.safeParse({auditId:r.id,query:'Рим'}).success,false);
 for(const change of [{query:'Другая фраза'},{region:'GB'},{language:'en'},{video:'zzzzzzzzzzz'}])await assert.rejects(searchSeoAuditRaw({...request(r.id,change),previewHash:p.hash},ctx()),(e:any)=>e.status===409);
 const name=path.join(dir,'seo-audit-runs',r.id+'.json'),raw=JSON.parse(await fs.readFile(name,'utf8'));raw.input.description='Изменённый исходник';await fs.writeFile(name,JSON.stringify(raw));
 await assert.rejects(searchSeoAuditRaw({...d,previewHash:p.hash},ctx()),(e:any)=>e.status===409);assert.deepEqual(await files(),before);
}));
test('seo v2 request is pinned, coherent on read and tampering is rejected',async()=>{
 const r=await createSeoAudit(input);let saved:any;
 await network(async()=>{saved=await searchSeoAudit(request(r.id),ctx());assert.equal(saved.version,2);assert.ok(saved.request);assert.equal(saved.request.auditId,r.id);});
 const name=path.join(dir,'seo-audit-runs',saved.id+'.json'),raw=JSON.parse(await fs.readFile(name,'utf8'));
 for(const patch of [()=>{raw.request.request.params.q='Подмена';},()=>{raw.input.title='Подмена';},()=>{raw.search.targetId='zzzzzzzzzzz';},()=>{raw.request=null;}]){
  Object.assign(raw,JSON.parse(JSON.stringify(saved)));delete raw.local;delete raw.searchPosition;
  patch();await fs.writeFile(name,JSON.stringify(raw));assert.equal(await loadSeoAudit(saved.id),null);
 }
});
test('seo legacy v1 stays unchanged and has no fabricated request on read',async()=>{
 const r=await createSeoAudit(input);let saved:any;await network(async()=>{saved=await searchSeoAudit(request(r.id),ctx());});
 const name=path.join(dir,'seo-audit-runs',saved.id+'.json'),raw=JSON.parse(await fs.readFile(name,'utf8'));raw.version=1;delete raw.request;const bytes=JSON.stringify(raw);await fs.writeFile(name,bytes);
 const opened=await loadSeoAudit(saved.id);assert.equal(opened?.version,1);assert.equal(opened?.request,null);assert.equal(await fs.readFile(name,'utf8'),bytes);
});
