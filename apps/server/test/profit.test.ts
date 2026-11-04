import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
const dir = await fs.mkdtemp(path.join(os.tmpdir(),"ts-profit-")); process.env.DATA_DIR = dir;
const { ProfitInput, calculateProfit, workspaceCosts, getWorkspaceCosts, saveProfit, listProfit, loadProfit } = await import("../src/services/profit.js");
const { readUsageSnapshot } = await import("../src/services/usage.js");
const { getSettings, updateSettings } = await import("../src/services/settings.js");
const { writeJson } = await import("../src/lib/storage.js");
const { profitRoute } = await import("../src/routes/profit.js");
const now = new Date("2026-01-15T12:00:00Z"), settings = await getSettings();
const manual = { mode:"manual" as const, title:"Проверка", startDate:"2026-01-01", endDate:"2026-01-15", views:100000, rpm:2.5, aiCosts:10, otherCosts:40 };
const ledger = { month:"2026-01", llm:{}, images:{}, am:{} };
after(async()=>{ await fs.rm(dir,{recursive:true,force:true}); });
test("profit: input validates real dates, integer views, finite amounts, period order and discriminated modes",()=>{
  assert.equal(ProfitInput.safeParse(manual).success,true);
  for (const patch of [{views:-1},{views:1.5},{views:1e13},{rpm:NaN},{rpm:Infinity},{aiCosts:-1},{otherCosts:1e10},{startDate:"2026-02-30"},{startDate:"2026-01-16"},{endDate:"2026-13-01"},{title:"x".repeat(121)},{rpm:"2"},{mode:"other"}]) assert.equal(ProfitInput.safeParse({...manual,...patch}).success,false,JSON.stringify(patch));
  assert.equal(ProfitInput.safeParse({...manual, aiCosts:undefined}).success,false);
  assert.equal(ProfitInput.safeParse({mode:"workspace-month",title:"",views:0,rpm:0,otherCosts:0,month:"2026-13"}).success,false);
});
test("profit: manual revenue, net, margin and break-even match independent arithmetic",()=>{
  const r = calculateProfit(manual,null,now); const n = r.result;
  assert.equal(n.revenueEstimate,250); assert.equal(n.knownTotalCosts,50); assert.equal(n.estimatedProfit,200); assert.equal(n.marginPct,80); assert.equal(n.breakEvenViews,20000); assert.equal(n.costsComplete,true); assert.equal(r.workspace,null); assert.match(r.warnings.join(" "),/не реальные выплаты/);
  const x = calculateProfit({...manual,views:12345,rpm:3,aiCosts:3,otherCosts:4},null,now).result;
  assert.equal(x.revenueEstimate,12345*3/1000); assert.equal(x.estimatedProfit,30.034999999999997); assert.equal(x.breakEvenViews,2334);
});
test("profit: losses and zero revenue have honest undefined margin, zero RPM cannot repay positive costs",()=>{
  const n = calculateProfit({...manual,views:0,rpm:0},null,now).result;
  assert.equal(n.estimatedProfit,-50); assert.equal(n.marginPct,null); assert.equal(n.breakEvenViews,null); assert.equal(n.breakEvenStatus,"zero-rpm");
  const free = calculateProfit({...manual,views:0,rpm:0,aiCosts:0,otherCosts:0},null,now).result; assert.equal(free.breakEvenViews,0); assert.equal(free.estimatedProfit,0);
});
test("profit: extremely small RPM never serializes Infinity or unsafe break-even",()=>{
  const r = calculateProfit({...manual,views:1,rpm:1e-310,aiCosts:100,otherCosts:0},null,now); assert.equal(r.result.breakEvenViews,null); assert.equal(r.result.breakEvenStatus,"out-of-range"); assert.equal(r.result.marginPct,null); assert.doesNotMatch(JSON.stringify(r),/Infinity|NaN/);
});
test("profit: all AnyModel entries count once, including TTS/search/orphan and shared text-image IDs",()=>{
  const raw = {...ledger,llm:{same:{in:1e6,out:1e6,calls:2}},images:{same:3},am:{same:1e6,"web-search":40000,"edge-tts/voice":200000,orphan:60000}};
  const w = workspaceCosts(raw,settings,now); assert.equal(w.amBalanceTokens,1300000); assert.equal(w.amUsd,.065); assert.equal(w.directRows.length,0); assert.equal(w.knownAiUsd,.065); assert.equal(w.complete,true); assert.equal(w.periodStart,"2026-01-01"); assert.equal(w.periodEnd,"2026-01-15");
});
test("profit: direct text and images use current configured rates in addition to AM",()=>{
  const s = {...settings,anymodel:{...settings.anymodel,usdPerMillion:2},budget:{...settings.budget,prices:[{match:"paid",input:3,output:6,image:.2}]}};
  const w = workspaceCosts({...ledger,llm:{paid:{in:1e6,out:500000,calls:2}},images:{"paid-image":3},am:{voice:2e6}},s,now);
  assert.ok(Math.abs(w.directKnownUsd-6.6)<1e-12); assert.equal(w.amUsd,4); assert.equal(w.knownAiUsd,10.6); assert.equal(w.complete,true);
});
test("profit: no matching rate is unknown, does not become zero net or known break-even",()=>{
  const w = workspaceCosts({...ledger,llm:{unknown:{in:100,out:20,calls:1}},am:{voice:1e6}},settings,now);
  assert.equal(w.directRows[0].usd,null); assert.equal(w.complete,false);
  const r = calculateProfit({mode:"workspace-month",title:"",views:10000,rpm:5,otherCosts:2,month:"2026-01"},w,now);
  assert.equal(r.result.revenueEstimate,50); assert.equal(r.result.knownTotalCosts,2.05); assert.equal(r.result.estimatedProfit,null); assert.equal(r.result.breakEvenViews,null); assert.equal(r.result.costsComplete,false); assert.match(r.warnings.join(" "),/нет ставки/);
});
test("profit: absent or old-month ledger is not known zero, no month reset is performed",()=>{
  for (const [raw,coverage] of [[null,"missing"],[{...ledger,month:"2025-12"},"stale"]] as const) { const w=workspaceCosts(raw,settings,now); assert.equal(w.coverage,coverage); assert.equal(w.knownAiUsd,null); assert.equal(w.complete,false); }
  const old={...ledger,month:"2025-12"}; workspaceCosts(old,settings,now); assert.equal(old.month,"2025-12");
});
test("profit: empty current ledger has only recorded zero and warns about missing external costs",()=>{
  const w=workspaceCosts(ledger,settings,now); assert.equal(w.knownAiUsd,0); assert.equal(w.complete,true); assert.match(w.warnings.join(" "),/не доказательство/);
  const zeroActivity=workspaceCosts({...ledger,llm:{unknown:{in:0,out:0,calls:0}}},settings,now); assert.equal(zeroActivity.complete,true);
});
test("profit: malformed, negative and overflowing accounting data is rejected instead of coercion",()=>{
  for (const raw of [{}, {...ledger,llm:{a:{in:-1,out:0,calls:1}}},{...ledger,am:{a:"10"}},{...ledger,am:{a:Infinity}},{...ledger,images:{a:-1}},{...ledger,am:{a:Number.MAX_SAFE_INTEGER,b:Number.MAX_SAFE_INTEGER}}]) assert.throws(()=>workspaceCosts(raw,settings,now));
  assert.throws(()=>workspaceCosts(ledger,{...settings,anymodel:{...settings.anymodel,usdPerMillion:Infinity}},now));
});
test("profit: UTC boundary and stale selected month fail explicitly",()=>{
  const boundary=new Date("2026-02-01T00:00:00Z"), w=workspaceCosts({...ledger,month:"2026-02"},settings,boundary);
  assert.equal(w.month,"2026-02"); assert.equal(w.periodEnd,"2026-02-01");
  assert.throws(()=>calculateProfit({mode:"workspace-month",month:"2026-01",title:"",views:1,rpm:1,otherCosts:0},w,boundary),/Месяц/);
  assert.throws(()=>calculateProfit({mode:"workspace-month",month:"2026-02",title:"",views:1,rpm:1,otherCosts:0},null,boundary),/Месяц/);
});
test("profit: strict ledger read distinguishes missing/corrupt and leaves disk unchanged",async()=>{
  assert.equal(await readUsageSnapshot(),null);
  for (const text of ["not-json","null"]) { await fs.writeFile(path.join(dir,"usage.json"),text); await assert.rejects(readUsageSnapshot(),/повреждён/); assert.equal(await fs.readFile(path.join(dir,"usage.json"),"utf8"),text); }
  await fs.rm(path.join(dir,"usage.json"));
});
test("profit: local snapshot save and history never call network or overwrite earlier run",async()=>{
  const orig=globalThis.fetch; globalThis.fetch=(async()=>{throw new Error("Unexpected network");}) as typeof fetch;
  try { const a=await saveProfit(manual), b=await saveProfit({...manual,rpm:1}); assert.notEqual(a.id,b.id); assert.deepEqual(await loadProfit(a.id),a); assert.deepEqual(await loadProfit(b.id),b); assert.equal((await listProfit()).length,2); assert.equal(await loadProfit("../settings"),null); }
  finally {globalThis.fetch=orig;}
});
test("profit: saved workspace figures pin tokens/rates; later changes do not recalculate history",async()=>{
  const month=new Date().toISOString().slice(0,7); await writeJson("usage.json",{...ledger,month,am:{voice:1e6}});
  const original=await getSettings(); await updateSettings({anymodel:{...original.anymodel,usdPerMillion:2}});
  const a=await saveProfit({mode:"workspace-month",month,title:"workspace",views:10000,rpm:3,otherCosts:4,costsHash:(await getWorkspaceCosts()).reviewHash!}); assert.equal(a.result.knownAiCosts,2); assert.equal(a.result.estimatedProfit,24);
  await writeJson("usage.json",{...ledger,month,am:{voice:5e6}}); await updateSettings({anymodel:{...original.anymodel,usdPerMillion:3}});
  assert.equal((await getWorkspaceCosts()).amUsd,15); assert.deepEqual(await loadProfit(a.id),a); await updateSettings(original);
});
test("profit: history limits display to 50, ignores corrupt snapshots, retains files",async()=>{
  for(let i=0;i<53;i++){const r=calculateProfit(manual,null,new Date(2026,0,i+1));await writeJson(`profit-runs/${r.id}.json`,r);}
  const bad=crypto.randomUUID();await writeJson(`profit-runs/${bad}.json`,{id:bad,version:1,workspace:{}}); assert.equal(await loadProfit(bad),null);
  const rows=await listProfit();assert.equal(rows.length,50);assert.ok(Date.parse(rows[0].createdAt)>=Date.parse(rows[49].createdAt));assert.ok((await fs.readdir(path.join(dir,"profit-runs"))).length>50);
});
test("profit: real route validates body, month, unknown IDs and local save",async()=>{
  const good=await profitRoute.request("/profit/calculate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(manual)});assert.equal(good.status,200);const r=(await good.json()).data;assert.equal(r.result.estimatedProfit,200);
  assert.equal((await profitRoute.request(`/profit/runs/${r.id}`)).status,200);assert.equal((await profitRoute.request("/profit/runs/bad")).status,404);
  assert.equal((await profitRoute.request("/profit/calculate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...manual,views:-1})})).status,400);
  assert.equal((await profitRoute.request("/profit/calculate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({x:"a".repeat(21000)})})).status,413);
});

test("profit basis: per-ID balance tokens, direct counts and first matching configured rates are pinned without arbitrary ledger fields",()=>{
 const s={...settings,anymodel:{...settings.anymodel,usdPerMillion:2},budget:{...settings.budget,prices:[{match:"paid",input:3,output:6,image:.2},{match:"paid-image",input:99,output:99,image:99}]}};
 const w=workspaceCosts({...ledger,llm:{same:{in:1e6,out:2e6,calls:2},paid:{in:1e6,out:500000,calls:3}},images:{same:2,"paid-image":3},am:{same:1e6,"web-search":40000},secret:"DO_NOT_COPY"},s,now);
 assert.equal(w.costBasis!.amRows.length,2);assert.equal(w.costBasis!.amRows[0].text!.calls,2);assert.equal(w.costBasis!.amRows[0].images,2);
 assert.equal(w.costBasis!.directRows[0].price!.match,"paid");assert.equal(w.costBasis!.directRows[0].text!.in,1e6);assert.equal(w.costBasis!.directRows[1].usd,.6000000000000001);
 assert.doesNotMatch(JSON.stringify(w),/DO_NOT_COPY/);assert.match(w.reviewHash!,/^[a-f0-9]{64}$/);
});
test("profit basis: hash ignores read seconds and irrelevant fields but binds day, month, counters, matched rates and missing/stale coverage",()=>{
 const raw={...ledger,llm:{paid:{in:100,out:20,calls:1}},am:{voice:1e6}},s={...settings,budget:{...settings.budget,prices:[{match:"paid",input:1,output:2,image:.1}]}},w=workspaceCosts(raw,s,now);
 assert.equal(workspaceCosts({...raw,extra:"ignored"},s,new Date(+now+5000)).reviewHash,w.reviewHash);
 assert.notEqual(workspaceCosts({...raw,llm:{paid:{in:100,out:20,calls:2}}},s,now).reviewHash,w.reviewHash);
 assert.notEqual(workspaceCosts(raw,{...s,budget:{...s.budget,prices:[{match:"paid",input:2,output:2,image:.1}]}},now).reviewHash,w.reviewHash);
 assert.notEqual(workspaceCosts(raw,s,new Date("2026-01-16T00:00:00Z")).reviewHash,w.reviewHash);
 assert.notEqual(workspaceCosts(null,s,now).reviewHash,workspaceCosts({...ledger,month:"2025-12"},s,now).reviewHash);
});
test("profit basis: missing hash and changed journal or rate reject before new file; refreshing allows exact new basis",async()=>{
 const month=new Date().toISOString().slice(0,7),input={mode:"workspace-month" as const,month,title:"Hash check",views:1000,rpm:2,otherCosts:0};
 await writeJson("usage.json",{...ledger,month,am:{voice:1e6}});const w=await getWorkspaceCosts(),before=(await fs.readdir(path.join(dir,"profit-runs"))).sort();
 await assert.rejects(saveProfit(input));await writeJson("usage.json",{...ledger,month,am:{voice:2e6}});
 await assert.rejects(saveProfit({...input,costsHash:w.reviewHash!}),/Обновите расходы/);assert.deepEqual((await fs.readdir(path.join(dir,"profit-runs"))).sort(),before);
 const current=await getWorkspaceCosts(),run=await saveProfit({...input,costsHash:current.reviewHash!});assert.equal(run.version,2);assert.deepEqual(run.workspace!.costBasis,current.costBasis);assert.deepEqual(await loadProfit(run.id),run);
});
test("profit basis: saved v2 integrity rejects altered formula totals and hashes; archive v1 stays byte-identical",async()=>{
 const month=new Date().toISOString().slice(0,7),w=await getWorkspaceCosts(),run=await saveProfit({mode:"workspace-month",month,title:"Integrity",views:1000,rpm:2,otherCosts:0,costsHash:w.reviewHash!});
 const file=path.join(dir,"profit-runs",run.id+".json"),bytes=await fs.readFile(file);
 for(const patch of [{result:{...run.result,estimatedProfit:999}},{workspace:{...run.workspace!,reviewHash:"a".repeat(64)}},{workspace:{...run.workspace!,costBasis:{...run.workspace!.costBasis!,amRows:[]}}}]){await fs.writeFile(file,JSON.stringify({...run,...patch}));assert.equal(await loadProfit(run.id),null);}
 await fs.writeFile(file,bytes);assert.deepEqual(await loadProfit(run.id),run);
 const old={...run,id:crypto.randomUUID(),version:1,workspace:{...run.workspace!}};delete old.workspace.costBasis;delete old.workspace.reviewHash;const oldFile=path.join(dir,"profit-runs",old.id+".json");await fs.writeFile(oldFile,JSON.stringify(old));const original=await fs.readFile(oldFile);assert.equal((await loadProfit(old.id))!.version,1);assert.deepEqual(await fs.readFile(oldFile),original);
});
test("profit basis: no row truncation, missing rates and known zero retain honest evidence",()=>{
 const w=workspaceCosts({...ledger,llm:{unknown:{in:100,out:0,calls:1},zero:{in:0,out:0,calls:0}},images:{unknownImage:1}},settings,now);assert.equal(w.costBasis!.directRows.find(r=>r.model==="unknown")!.usd,null);assert.equal(w.costBasis!.directRows.find(r=>r.model==="zero")!.usd,0);
 assert.throws(()=>workspaceCosts({...ledger,am:Object.fromEntries(Array.from({length:1001},(_,i)=>["m"+i,0]))},settings,now),/слишком много/);
 assert.throws(()=>workspaceCosts({...ledger,am:{["x".repeat(301)]:0}},settings,now),/длинные/);
});
test("profit basis: guarded files reject symlink and oversized history without traversing",async()=>{
 const id=crypto.randomUUID(),file=path.join(dir,"profit-runs",id+".json"),target=path.join(dir,"outside.json");await fs.writeFile(target,JSON.stringify(calculateProfit(manual,null,now)));await fs.symlink(target,file);assert.equal(await loadProfit(id),null);await fs.rm(file);await fs.writeFile(file," ".repeat(2*1024**2+1));assert.equal(await loadProfit(id),null);await fs.rm(file);
});
test("profit basis: route requires reviewed workspace hash and does not persist stale previews",async()=>{
 const month=new Date().toISOString().slice(0,7),input={mode:"workspace-month",month,title:"HTTP review",views:1,rpm:1,otherCosts:0},post=(body:unknown)=>profitRoute.request("/profit/calculate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
 assert.equal((await post(input)).status,400);const w=(await (await profitRoute.request("/profit/workspace-costs")).json()).data;assert.equal((await post({...input,costsHash:"a".repeat(64)})).status,409);assert.equal((await post({...input,costsHash:w.reviewHash})).status,200);
});
test("profit acceptance: fractional balance counters round-trip regardless of ledger key insertion order",async()=>{
 const month=new Date().toISOString().slice(0,7),am={z:.1,a:.2,m:.3};await writeJson("usage.json",{...ledger,month,am});
 const current=await getWorkspaceCosts(),r=await saveProfit({mode:"workspace-month",month,title:"Fractional roundtrip",views:10000,rpm:1,otherCosts:0,costsHash:current.reviewHash!});
 assert.deepEqual(await loadProfit(r.id),r);
 const reordered=workspaceCosts({...ledger,month,am:{a:.2,m:.3,z:.1}},await getSettings(),new Date(current.asOf));assert.equal(reordered.reviewHash,current.reviewHash);assert.equal(reordered.amBalanceTokens,current.amBalanceTokens);
});
