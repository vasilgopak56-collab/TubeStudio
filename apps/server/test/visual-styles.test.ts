import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
const dir=await fs.mkdtemp(path.join(os.tmpdir(),"ts-styles-unit-"));
process.env.DATA_DIR=dir;
const svc=await import("../src/services/visualStyles.js");
const {config}=await import("../src/config.js");
const {visualStylesRoute}=await import("../src/routes/visualStyles.js");
const {requireAuth,auth,extToken}=await import("../src/routes/auth.js");
const {StoryboardInput,runStoryboard,checkVideoBatch}=await import("../src/services/storyboard.js");
const {AudioGenerate,promptJson}=await import("../src/services/audioStoryboard.js");
const {PipelineInput,createPipeline}=await import("../src/services/pipeline.js");
const {exportBackup}=await import("../src/services/backup.js");
const {PROMPTS_DIR}=await import("../src/services/prompts.js");
const {unzipSync}=await import("fflate");
const file=path.join(dir,"visual-styles.json");
const fields={name:"Мой стиль",group:"Мои стили",description:"Тест",anchor:"flat hand drawn purple comic illustration",motion:"hero reaches for the shield and drops it, then looks surprised",negative:"3d render",motionKind:"action" as const};
const ctx={signal:new AbortController().signal,progress:()=>{},partial:()=>{}};
after(async()=>{await fs.rm(dir,{recursive:true,force:true});});
test("native styles: 41 unique seeds, original history guide unchanged and POV is separate",async()=>{
 const s=await svc.listVisualStyles();assert.equal(s.length,41);assert.equal(new Set(s.map(s=>s.id)).size,41);assert.ok(s.every(s=>s.builtin));
 const pov=await svc.resolveVisualStyle("builtin-pov-history");assert.equal(pov?.motionKind,"action");assert.match(pov!.anchor,/era|period/i);
 assert.match(await fs.readFile(path.join(PROMPTS_DIR,"visual/animated_2d_history.md"),"utf8"),/bean-character/);
 const motion=[{n:1,concept:"test",image:"",video:"He drops the shield; it strikes the dirt. His eyes widen in surprise."}];
 assert.equal(checkVideoBatch(motion,{cameraOptional:true} as any,"kling",5).warnings.length,0);
 assert.ok(checkVideoBatch(motion,{} as any,"kling",5).warnings.length>0);
 assert.equal(await svc.resolveVisualStyle(),undefined);await assert.rejects(()=>svc.resolveVisualStyle("missing"),{status:404});
});
test("native styles: CRUD, revision conflicts, read-only builtins and concurrent creates",async()=>{
 const s=await svc.createVisualStyle(fields);assert.equal(s.builtin,false);assert.equal(s.revision,1);
 const next=await svc.updateVisualStyle(s.id,{...fields,name:"Changed",revision:1});assert.equal(next.revision,2);
 await assert.rejects(()=>svc.updateVisualStyle(s.id,{...fields,revision:1}),{status:409});await assert.rejects(()=>svc.deleteVisualStyle(s.id,1),{status:409});
 await assert.rejects(()=>svc.updateVisualStyle("builtin-pov-history",{...fields,revision:1}),{status:404});await assert.rejects(()=>svc.deleteVisualStyle("builtin-pov-history",1),{status:404});
 const created=await Promise.all(Array.from({length:8},()=>svc.createVisualStyle(fields)));const all=await svc.listVisualStyles();for(const s of created)assert.ok(all.some(x=>x.id===s.id));
 await svc.deleteVisualStyle(s.id,2);await assert.rejects(()=>svc.resolveVisualStyle(s.id),{status:404});
 for(const s of created)await svc.deleteVisualStyle(s.id,s.revision);
});
test("native styles: imports are atomic copies, original40 shape supported, limits enforced",async()=>{
 const own=await svc.createVisualStyle(fields);
 const imported=await svc.importVisualStyles({styles:[own]});assert.equal(imported.count,1);assert.notEqual(imported.styles[0].id,own.id);
 const legacy=await svc.importVisualStyles([{...fields,description:undefined,negative:undefined,ru:"Русское описание",neg:"no realism",reveal:"pen",motionKind:undefined}]);assert.equal(legacy.styles[0].description,"Русское описание");assert.equal(legacy.styles[0].negative,"no realism");assert.equal(legacy.styles[0].motionKind,"reveal");
 const before=await fs.readFile(file,"utf8");assert.throws(()=>svc.importVisualStyles([fields,{name:"broken"}]));assert.equal(await fs.readFile(file,"utf8"),before);
 assert.throws(()=>svc.importVisualStyles([]));assert.throws(()=>svc.createVisualStyle({...fields,anchor:"x".repeat(8001)}));
 await svc.importVisualStyles(Array.from({length:197},()=>fields));await assert.rejects(()=>svc.createVisualStyle(fields),{status:409});
 await fs.unlink(file);
});
test("native styles: corrupted or linked store fails closed, never overwrites",async()=>{
 await fs.writeFile(file,"broken-json");await assert.rejects(()=>svc.listVisualStyles(),{status:409});await assert.rejects(()=>svc.createVisualStyle(fields),{status:409});assert.equal(await fs.readFile(file,"utf8"),"broken-json");await fs.unlink(file);
 const target=path.join(dir,"target.json");await fs.writeFile(target,"keep");await fs.symlink(target,file);await assert.rejects(()=>svc.createVisualStyle(fields),{status:409});assert.equal(await fs.readFile(target,"utf8"),"keep");await fs.unlink(file);
});
test("native styles: auth, extension rejection, JSON/body limits, CRUD HTTP and export",async()=>{
 const app=new Hono();app.use("/api/*",requireAuth);app.route("/api",auth);app.route("/api",visualStylesRoute);const old=config.password;config.password="test-only";
 try {
  assert.equal((await app.request("/api/visual-styles")).status,401);assert.equal((await app.request("/api/visual-styles",{headers:{"x-ts-token":extToken()}})).status,403);
  const login=await app.request("/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password:config.password})});const cookie=login.headers.get("set-cookie")!.split(";")[0];
  const req=(url:string,method="GET",body?:unknown)=>app.request("/api"+url,{method,headers:{cookie,"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal((await req("/visual-styles")).status,200);
  const out=await (await req("/visual-styles","POST",fields)).json();assert.ok(out.ok);
  assert.equal((await req(`/visual-styles/${out.data.id}`,"PUT",{...fields,revision:1})).status,200);
  const exp=await (await req("/visual-styles/export")).json();assert.equal(exp.data.styles.length,1);assert.equal(exp.data.styles[0].revision,2);
  assert.equal((await req(`/visual-styles/${out.data.id}`,"DELETE",{revision:2})).status,200);
  assert.equal((await app.request("/api/visual-styles/import",{method:"POST",headers:{cookie,"content-type":"application/json"},body:"{"})).status,400);
  assert.equal((await req("/visual-styles/import","POST",{styles:[{...fields,anchor:"x".repeat(5*1024*1024)}]})).status,413);
 } finally {config.password=old;}
});
test("native styles: root JSON included in backup and deleted selection stops before providers",async()=>{
 await svc.createVisualStyle(fields);const zip=await exportBackup({dataDir:dir,promptsDir:PROMPTS_DIR});assert.ok(unzipSync(zip)["visual-styles.json"]);await fs.unlink(file);
 let calls=0;const old=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw new Error("network forbidden");};
 try {await assert.rejects(()=>runStoryboard(StoryboardInput.parse({script:"A soldier is trying to lift his shield while his opponent approaches. ".repeat(4),visualStyleId:"missing"}),ctx),{status:404});await assert.rejects(()=>createPipeline(PipelineInput.parse({topic:"Test",visualStyleId:"missing",stages:["storyboard"]})),{status:404});assert.equal(calls,0);}finally{globalThis.fetch=old;}
});
test("native styles: selected rendering overrides conflicting niche/preset, action instructions and frozen snapshot",async()=>{
 const old=globalThis.fetch,keys={...config.keys};let bodies:any[]=[];const own=await svc.createVisualStyle(fields);
 config.keys.anthropic="test-only";config.keys.anymodel="";config.keys.gemini="";config.keys.openai="";
 const script="A worried soldier tries to lift the shield while his opponent waits at the gate. ".repeat(4);
 globalThis.fetch=async(url:any,init:any)=>{assert.match(String(url),/api.anthropic.com/);const body=JSON.parse(init.body);bodies.push(body);
  let data:any;
  if(body.messages[0].content.startsWith("Create a concise")) {data={medium:"comic",palette:"purple",lighting:"flat",camera:"locked",mood:"fear",negative:"3d",characters:[],locations:[]};if(bodies.length===1)await svc.updateVisualStyle(own.id,{...fields,anchor:"changed rendering anchor different",revision:1});}
  else {const lines=body.messages[0].content.split("LINES:\n")[1].split("\n\nReturn JSON")[0].split("\n");data={scenes:lines.map((line:string)=>({n:Number(line.match(/^\d+/)![0]),concept:"Воин хватает щит",image:"A frightened soldier reaches for his wooden shield beside the gate in a flat purple hand drawn comic illustration, 16:9 landscape frame.",video:"Start: hand near shield. Action: he grips and drops it. Result: shield hits dirt. Reaction: eyes widen. Camera locked, no morphing."}))};}
  return new Response(JSON.stringify({content:[{type:"text",text:JSON.stringify(data)}],usage:{input_tokens:1,output_tokens:1}}),{headers:{"content-type":"application/json"}});
 };
 try {
  const result=await runStoryboard(StoryboardInput.parse({script,style:"dark_3d_crime",preset:"P1",visualStyleId:own.id,imageModel:"flux"}),ctx);
  assert.equal(result.visualStyle?.anchor,fields.anchor);assert.equal(result.visualStyle?.revision,1);assert.equal((await svc.resolveVisualStyle(own.id))?.revision,2);
  const sys=bodies[0].system[0].text;assert.match(sys,/SELECTED NATIVE VISUAL STYLE/);assert.match(sys,/intention → concrete physical action/);assert.ok(!sys.includes("VISUAL PRESET"));assert.ok(!sys.includes("Photorealistic faceless human characters"));assert.ok(!bodies[1].messages[0].content.includes("All humans must be explicitly"));assert.ok(result.batches.every(b=>!b.errors.length));
  const rows=result.rows;assert.equal(rows[0].text,script.split(". ")[0]+".");
  bodies=[];await runStoryboard(StoryboardInput.parse({script,style:"animated_2d_history",imageModel:"flux"}),ctx);assert.match(bodies[0].system[0].text,/bean-character/);assert.ok(!bodies[0].system[0].text.includes("SELECTED NATIVE VISUAL STYLE"));
  const audio=AudioGenerate.parse({audioId:"12345678-1234-4123-8123-123456789012",revision:0,visualStyleId:own.id});assert.equal(audio.visualStyleId,own.id);
  const clean=promptJson({name:"voice.wav",duration:4,result:{...result,rows:rows.map(r=>({...r,end:r.start+r.seconds,timelineStart:r.start,timelineEnd:r.start+r.seconds,filename:"scene_001"}))}} as any);assert.equal(clean.visual_style?.revision,1);
 }finally{globalThis.fetch=old;Object.assign(config.keys,keys);await fs.unlink(file).catch(()=>{});}
});
