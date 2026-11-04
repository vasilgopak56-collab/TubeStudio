/** Isolated production packages. No video generation, no URL fetching, no changes to old workflows. */
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { zipSync, strToU8 } from "fflate";
import { config } from "../config.js";
import { ApiError } from "../lib/errors.js";
import type { JobCtx } from "../lib/jobs.js";
import { checkCancelled } from "../lib/taskContext.js";
import { generateJson } from "./llm.js";
import { readPrompt } from "./prompts.js";
import { addArtifact, getProject } from "./projects.js";
const text = (max: number) => z.string().trim().max(max).default("");
const id = z.string().regex(/^[A-Z][A-Z0-9_]{0,31}$/);
const uuid = z.string().uuid();
const keys = ["title", "story", "ending", "seconds", "styleDNA", "sourceScript"] as const;
export const DirectorBrief = z.object({ title: z.string().trim().min(1).max(200), story: text(6000), ending: text(2000), seconds: z.number().finite().min(4).max(600), styleDNA: text(4000), sourceScript: text(60000), mode: z.enum(["fiction", "documentary", "ad"]).default("fiction"), dialogue: z.enum(["none", "minimal", "scripted"]).default("none"), music: text(500), locked: z.array(z.enum(keys)).max(6).default([]) }).strict();
export const DirectorAsset = z.object({ id, kind: z.enum(["character", "location", "prop", "product", "frame"]), name: z.string().trim().min(1).max(120), description: text(3000), fixedFacts: text(2000), referenceId: uuid.optional() }).strict();
const State = z.object({ assetId: id, state: z.string().trim().min(1).max(500) }).strict();
export const DirectorShot = z.object({ id, blockId: id, seconds: z.number().finite().min(.1).max(30), action: z.string().trim().min(1).max(2000), camera: text(500), audio: text(1000), soundMode: z.enum(["generate", "post", "silent"]).default("silent"), refs: z.array(id).max(12).default([]), before: z.array(State).max(12).default([]), after: z.array(State).max(12).default([]) }).strict();
export const DirectorBlock = z.object({ id, transition: z.enum(["cut", "continue", "new_scene"]).default("cut"), previousBlockId: id.optional(), refs: z.array(id).max(12).default([]), frameAssetId: id.optional(), tailPad: z.number().finite().min(0).max(2).default(0) }).strict();
export const DirectorWork = z.object({ schema: z.literal(1), brief: DirectorBrief, profile: z.object({ name: z.string().trim().min(1).max(120), maxSeconds: z.number().finite().min(1).max(30) }).strict(), assets: z.array(DirectorAsset).max(40), shots: z.array(DirectorShot).max(200), blocks: z.array(DirectorBlock).max(100), assumptions: z.array(z.string().max(800)).max(30).default([]), projectId: uuid.optional(), approval: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
export type DirectorWorkT = z.infer<typeof DirectorWork>;
export type DirectorAssetT = z.infer<typeof DirectorAsset>;
export type DirectorShotT = z.infer<typeof DirectorShot>;
export type DirectorBlockT = z.infer<typeof DirectorBlock>;
export const directorHash = (w: DirectorWorkT) => createHash("sha256").update(JSON.stringify({ ...w, approval: undefined })).digest("hex");
export function directorReport(input: unknown) {
 const w = DirectorWork.parse(input), errors: string[] = [], warnings: string[] = [];
 const unique = (list: string[], name: string) => { if (new Set(list).size !== list.length) errors.push(`Повтор ID: ${name}`); };
 unique(w.assets.map(x=>x.id),"ассеты"); unique(w.shots.map(x=>x.id),"кадры"); unique(w.blocks.map(x=>x.id),"блоки");
 const assets = new Map(w.assets.map(a=>[a.id,a])), blocks = new Map(w.blocks.map(b=>[b.id,b]));
 if (!w.brief.story.trim() && !w.brief.sourceScript.trim()) errors.push("Добавьте историю или утверждённый сценарий");
 if (!w.brief.ending.trim()) warnings.push("Финал не описан: утвердите его до генерации");
 if (!w.brief.styleDNA.trim()) warnings.push("Визуальный стиль не задан");
 if (!w.shots.length || !w.blocks.length) errors.push("Нужен хотя бы один кадр и блок");
 const total = Math.round(w.shots.reduce((s,x)=>s+x.seconds,0)*1000)/1000;
 if (Math.abs(total-w.brief.seconds)>.001) errors.push(`Монтаж: ${total} с вместо ${w.brief.seconds} с. Запас генерации в эту сумму не входит.`);
 for (const a of w.assets) { if (!a.referenceId) warnings.push(`${a.id}: референс не загружен`); if ((a.kind==="product" || a.kind==="prop") && /текст|надпис|label|text/i.test(a.description+" "+a.fixedFacts)) warnings.push(`${a.id}: точные надписи проверяйте и при необходимости накладывайте в монтаже`); }
 let lastBlockIndex=-1;
 const states = new Map<string,string>();
 for (const [bi,b] of w.blocks.entries()) {
  unique(b.refs,`${b.id}: референсы`);
  const rows=w.shots.filter(s=>s.blockId===b.id), duration=rows.reduce((n,s)=>n+s.seconds,0), render=Math.round((duration+b.tailPad)*1000)/1000;
  if (!rows.length) errors.push(`${b.id}: пустой блок`);
  if (render>w.profile.maxSeconds+.001) errors.push(`${b.id}: ${render} с с запасом превышает профиль ${w.profile.maxSeconds} с`);
  if (b.transition==="continue") { if (!bi || b.previousBlockId!==w.blocks[bi-1].id) errors.push(`${b.id}: продолжение должно ссылаться на предыдущий блок`); if (!b.frameAssetId) warnings.push(`${b.id}: для продолжения не выбран финальный кадр предыдущего блока`); }
  else if (b.previousBlockId || b.frameAssetId) errors.push(`${b.id}: ссылка/кадр продолжения разрешены только для «продолжение»`);
  if (b.frameAssetId && (assets.get(b.frameAssetId)?.kind!=="frame" || b.refs.includes(b.frameAssetId))) errors.push(`${b.id}: финальный кадр должен быть отдельным ассетом типа frame, не дублирующим refs`);
  for (const ref of b.refs) if (!assets.has(ref)) errors.push(`${b.id}: неизвестный референс ${ref}`);
  if (b.transition==="new_scene") states.clear();
  for (const shot of rows) {
   const global=w.shots.indexOf(shot); if(global<lastBlockIndex) errors.push("Порядок кадров не совпадает с порядком блоков");lastBlockIndex=global;
   unique(shot.refs,`${shot.id}: референсы`); unique(shot.before.map(x=>x.assetId),`${shot.id}: состояния до`);unique(shot.after.map(x=>x.assetId),`${shot.id}: состояния после`);
   for(const ref of shot.refs) if(!b.refs.includes(ref))errors.push(`${shot.id}: ${ref} отсутствует в порядке загрузки ${b.id}`);
   for(const state of [...shot.before,...shot.after])if(!assets.has(state.assetId)||!b.refs.includes(state.assetId))errors.push(`${shot.id}: ассет состояния ${state.assetId} отсутствует в референсах блока`);
   for(const state of shot.before){const prev=states.get(state.assetId);if(prev && prev!==state.state)warnings.push(`${shot.id}: состояние ${state.assetId} изменилось «${prev}» → «${state.state}». Проверьте причинность/склейку.`);}
   for(const state of [...shot.before,...shot.after])states.set(state.assetId,state.state);
   if(shot.seconds<2)warnings.push(`${shot.id}: кадр короче 2 с — возможен сложный для модели быстрый переход`);
   if(shot.soundMode==="generate" && w.brief.sourceScript)warnings.push(`${shot.id}: генерируемый звук может конфликтовать с готовой озвучкой; отдельно проверьте речь и микс`);
  }
 }
 for(const shot of w.shots)if(!blocks.has(shot.blockId))errors.push(`${shot.id}: неизвестный блок ${shot.blockId}`);
 if(w.brief.mode==="documentary")warnings.push("Документальный режим: факты и реконструкцию проверяет автор. План не подтверждает достоверность.");
 if(w.brief.mode==="ad")warnings.push("Реклама: права, маркировку, свойства товара и точность надписей проверяет автор. Комедия не обязательна.");
 if(w.assumptions.length)warnings.push("Есть предложения/неизвестные сведения AI: прочитайте перед утверждением");
 return {errors:[...new Set(errors)],warnings:[...new Set(warnings)],totalSeconds:total,approved:w.approval===directorHash(w)};
}
const safeName=(s:string)=>s.replace(/[^\p{L}\p{N}_.-]/gu,"_").slice(0,80)||"asset";
export function directorCompile(input:unknown, requireApproval=true) {
 const w=DirectorWork.parse(input),report=directorReport(w);
 if(report.errors.length)throw new ApiError("VALIDATION",report.errors.join("\n"),400);
 if(requireApproval && !report.approved)throw new ApiError("VALIDATION","Пакет изменён или не утверждён. Проверьте и утвердите заново.",409);
 let global=0;
 const shotList=w.shots.map(s=>{const start=global;global+=s.seconds;return {id:s.id,blockId:s.blockId,start:+start.toFixed(3),end:+global.toFixed(3),seconds:s.seconds,action:s.action};});
 const blocks=w.blocks.map(b=>{
  const refIds=[...b.refs,...(b.frameAssetId?[b.frameAssetId]:[])];const refs=refIds.map((a,i)=>({slot:`@image${i+1}`,assetId:a,name:w.assets.find(x=>x.id===a)!.name,referenceId:w.assets.find(x=>x.id===a)!.referenceId,file:w.assets.find(x=>x.id===a)!.referenceId?`references/${a}_${w.assets.find(x=>x.id===a)!.referenceId}.jpg`:undefined}));
  const slot=(id:string)=>refs.find(x=>x.assetId===id)?.slot ?? id;
  let t=0;const rows=w.shots.filter(x=>x.blockId===b.id);
  const lines=rows.map(s=>{const start=t;t+=s.seconds;return `${+start.toFixed(3)}-${+t.toFixed(3)}s: ${s.refs.map(slot).join(" ")} ${s.action}\nCamera: ${s.camera||"only if needed; no substitute for action"}\nState before: ${s.before.map(x=>`${slot(x.assetId)} ${x.state}`).join("; ")||"as established"}\nState after: ${s.after.map(x=>`${slot(x.assetId)} ${x.state}`).join("; ")||"as directed"}\nAudio (${s.soundMode}): ${s.soundMode==="silent"?"No generated dialogue, music or sound.":s.soundMode==="post"?"No generated sound. Sound will be added separately in post.":s.audio}`;});
  const fixed=refs.map(r=>{const a=w.assets.find(x=>x.id===r.assetId)!;return `${r.slot}: ${a.description}; FIXED: ${a.fixedFacts}`;}).join("\n");
  const prompt=`REFERENCE KEY — upload exactly in this block's order:\n${refs.map(r=>`${r.slot} = ${r.assetId} (${r.name})`).join("\n")}\n${b.transition==="continue"?`CONTINUATION of ${b.previousBlockId}; ${b.frameAssetId?slot(b.frameAssetId):"[previous final frame not supplied]"} is a STILL IMAGE reference, not a video-extension command.`:b.transition==="new_scene"?"HARD CUT / NEW SCENE. Do not inherit previous-frame layout or prop state.":"CUT. Preserve established identity and causal prop state; do not silently reset."}\nFIXED FACTS:\n${fixed}\nDialogue: ${w.brief.dialogue}. Music direction: ${w.brief.music||"none specified"}.\n${lines.join("\n\n")}\n${b.tailPad?`GENERATION HANDLE: ${b.tailPad}s extra after ${+t.toFixed(3)}s. Hold the final state; no new plot. Trim handle for final edit.\n`:""}STYLE DNA (literal shared suffix):\n${w.brief.styleDNA}`;
  return {id:b.id,refs,postProduction:rows.filter(s=>s.soundMode==="post").map(s=>({shotId:s.id,audio:s.audio})),editSeconds:+t.toFixed(3),renderSeconds:+(t+b.tailPad).toFixed(3),prompt};
 });
 const assetPrompts=w.assets.filter(a=>a.kind!=="frame").map(a=>({id:a.id,name:a.name,portrait:a.kind==="character"?`4:5 neutral chest-up identity portrait. Plain grey backdrop, even studio light. ${a.description}. Invariants: ${a.fixedFacts}. Empty hands, no performance, no text. ${w.brief.styleDNA}`:undefined,sheet:a.kind==="character"?`Optional 16:9 three-view sheet using the approved portrait as a reference: one chest-up portrait; a collar-down wardrobe display (only this panel intentionally omits the head); complete rear view from head to feet. One identity, neutral posture, same outfit, empty hands. ${a.description}. Invariants: ${a.fixedFacts}. Plain grey backdrop, no text. This is an optional layout, not a guarantee of consistency.`:undefined,prompt:a.kind==="location"?`16:9 location reference, no people. ${a.description}. Invariants: ${a.fixedFacts}. ${w.brief.styleDNA}`:a.kind==="character"?undefined:`Neutral ${a.kind} reference. ${a.description}. Invariants: ${a.fixedFacts}. Preserve silhouette, colour and label layout. Exact text/logo should be composited and checked in post. ${w.brief.styleDNA}`}));
 return {schema:1 as const,briefHash:directorHash(w),report,shotList,blocks,assetPrompts};
}
export function directorApprove(input:unknown){const w=DirectorWork.parse(input),r=directorReport(w);if(r.errors.length)throw new ApiError("VALIDATION",r.errors.join("\n"),400);return {...w,approval:directorHash(w)};}
const MAX=3*1024*1024;
let queue:Promise<unknown>=Promise.resolve();
function mutate<T>(fn:()=>Promise<T>){const next=queue.then(fn);queue=next.catch(()=>{});return next;}
async function folder(name:string){const root=config.dataDir;await fs.mkdir(root,{recursive:true});const rst=await fs.lstat(root);if(rst.isSymbolicLink()||!rst.isDirectory())throw new ApiError("VALIDATION","Небезопасная папка данных",409);const p=path.join(root,name);await fs.mkdir(p,{recursive:true});const st=await fs.lstat(p);if(st.isSymbolicLink()||!st.isDirectory())throw new ApiError("VALIDATION","Небезопасная папка режиссёрского пакета",409);return p;}
async function safeRead(p:string,max=MAX){const before=await fs.lstat(p);if(before.isSymbolicLink()||!before.isFile())throw new Error("unsafe");const fh=await fs.open(p,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{const st=await fh.stat();if(!st.isFile()||st.ino!==before.ino||st.dev!==before.dev||st.size>max)throw new Error("unsafe");return await fh.readFile();}finally{await fh.close();}}
const SavedRecord=z.object({id:uuid,revision:z.number().int().min(1),updatedAt:z.string(),work:DirectorWork});
const History=z.object({version:z.literal(1),versions:z.array(SavedRecord).min(1).max(30)});
async function history(id:string){uuid.parse(id);try{const h=History.parse(JSON.parse((await safeRead(path.join(await folder("director-packages"),id+".json"))).toString()));if(h.versions.some((v,i)=>v.id!==id || (i>0 && v.revision!==h.versions[i-1].revision+1)))throw new Error("invalid history");return h;}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")throw new ApiError("NOT_FOUND","Пакет не найден",404);throw new ApiError("VALIDATION","Пакет повреждён или недоступен. Он не перезаписан; восстановите резервную копию.",409);}}
export async function listDirector(){const files=(await fs.readdir(await folder("director-packages"))).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f));return Promise.all(files.map(async file=>{const h=await history(file.slice(0,-5)),v=h.versions.at(-1)!;return {id:v.id,revision:v.revision,title:v.work.brief.title,updatedAt:v.updatedAt};}));}
export async function loadDirector(id:string,revision?:number){const h=await history(id);const v=revision?h.versions.find(v=>v.revision===revision):h.versions.at(-1);if(!v)throw new ApiError("NOT_FOUND","Версия не найдена",404);return {...v,history:h.versions.map(v=>({revision:v.revision,updatedAt:v.updatedAt,title:v.work.brief.title}))};}
export const DirectorSave=z.object({id:uuid.optional(),revision:z.number().int().min(1).optional(),work:DirectorWork,unlock:z.array(z.enum(keys)).max(6).default([])}).strict();
export function saveDirector(input:unknown){const data=DirectorSave.parse(input);return mutate(async()=>{
 const dir=await folder("director-packages");let versions:z.infer<typeof SavedRecord>[]=[];let identifier=data.id;
 if(identifier){const h=await history(identifier);versions=h.versions;const prev=versions.at(-1)!;if(data.revision!==prev.revision)throw new ApiError("VALIDATION","Конфликт версии: пакет изменён в другой вкладке. Откройте последнюю версию; текущий ввод не потерян.",409);
 for(const key of prev.work.brief.locked){if((prev.work.brief[key]!==data.work.brief[key]||!data.work.brief.locked.includes(key))&&!data.unlock.includes(key))throw new ApiError("VALIDATION",`Поле ${key} закреплено. Сначала явно разблокируйте его.`,409);}
 }else{if(data.revision)throw new ApiError("VALIDATION","Нельзя задать версию нового пакета",400);if((await fs.readdir(dir)).filter(f=>f.endsWith(".json")).length>=100)throw new ApiError("VALIDATION","Максимум 100 пакетов",409);identifier=randomUUID();}
 for(const asset of data.work.assets)if(asset.referenceId)await readDirectorAsset(asset.referenceId);
 const work={...data.work,approval:data.work.approval===directorHash(data.work)?data.work.approval:undefined};
 const record={id:identifier,revision:(versions.at(-1)?.revision??0)+1,updatedAt:new Date().toISOString(),work};
 const body=JSON.stringify(History.parse({version:1,versions:[...versions,record].slice(-30)}));if(Buffer.byteLength(body)>MAX)throw new ApiError("VALIDATION","История пакета превышает 3 МиБ. Сохраните копию как новый пакет.",413);
 const tmp=path.join(dir,identifier+"."+randomUUID()+".tmp");try{await fs.writeFile(tmp,body,{flag:"wx",mode:0o600});await fs.rename(tmp,path.join(dir,identifier+".json"));}finally{await fs.rm(tmp,{force:true});}return record;
 });}
export async function uploadDirectorAsset(input:unknown){const data=z.object({b64:z.string().min(10).max(7_000_000)}).strict().parse(input);if(!/^[A-Za-z0-9+/]*={0,2}$/.test(data.b64))throw new ApiError("VALIDATION","Некорректный base64",400);const raw=Buffer.from(data.b64,"base64");if(raw.length>5*1024*1024)throw new ApiError("VALIDATION","Референс больше 5 МиБ",413);let image:Buffer;try{const pipeline=sharp(raw,{limitInputPixels:20_000_000});const meta=await pipeline.metadata();if(!["jpeg","png","webp"].includes(meta.format??""))throw new Error();image=await pipeline.rotate().resize({width:1600,height:1600,fit:"inside",withoutEnlargement:true}).jpeg({quality:88}).toBuffer();}catch{throw new ApiError("VALIDATION","Нужен корректный JPG/PNG/WebP до 20 мегапикселей",400);}return mutate(async()=>{const dir=await folder("director-assets");if((await fs.readdir(dir)).filter(f=>f.endsWith(".jpg")).length>=1000)throw new ApiError("VALIDATION","Максимум 1000 референсов",409);const id=randomUUID();await fs.writeFile(path.join(dir,id+".jpg"),image,{mode:0o600,flag:"wx"});return {id,url:`/api/director/assets/${id}`,bytes:image.length};});}
export async function readDirectorAsset(id:string){uuid.parse(id);try{return await safeRead(path.join(await folder("director-assets"),id+".jpg"),5*1024*1024);}catch{throw new ApiError("NOT_FOUND","Файл референса не найден или недоступен",404);}}
export async function directorZip(input:unknown){const w=DirectorWork.parse(input),compiled=directorCompile(w);const files:Record<string,Uint8Array>={"package.json":strToU8(JSON.stringify(w,null,2)),"manifest.json":strToU8(JSON.stringify(compiled,null,2)),"README.txt":strToU8("TubeStudio: пакет подготовки, не готовое видео.\nРеференсы: JPEG, нормализованы до 1600 px. Прочитайте warnings в manifest.json.\nПорядок @image задан отдельно для каждого блока. Финальный кадр — изображение, не команда продления видео.\nЗвук post добавляется в редакторе. Точные надписи и логотипы проверяются в монтаже.\nПакет может содержать личные изображения и сценарий — не публикуйте его без проверки.\n")};
 for(const a of w.assets)if(a.referenceId)files[`references/${a.id}_${a.referenceId}.jpg`]=await readDirectorAsset(a.referenceId);
 for(const b of compiled.blocks)files[`blocks/${safeName(b.id)}.txt`]=strToU8(b.prompt);
 files["asset-prompts.json"]=strToU8(JSON.stringify(compiled.assetPrompts,null,2));const bytes=zipSync(files);if(bytes.length>80*1024*1024)throw new ApiError("VALIDATION","Экспорт больше 80 МиБ. Уменьшите число референсов.",413);return bytes;
}
export async function directorToProject(input:unknown){const w=DirectorWork.parse(input),compiled=directorCompile(w);if(!w.projectId)throw new ApiError("VALIDATION","Выберите проект",400);await getProject(w.projectId);return addArtifact(w.projectId,{kind:"note",title:`Режиссёрский пакет: ${w.brief.title}`,data:{tool:"director",package:w,compiled,notice:"Снимок пакета; референсы скачайте отдельным ZIP. Последующие правки не обновляют этот снимок."}});}
const Proposal=z.object({shots:z.array(DirectorShot).min(1).max(200),blocks:z.array(DirectorBlock).min(1).max(100),assumptions:z.array(z.string().max(800)).max(30)}).strict();
export async function generateDirector(input:unknown,ctx:JobCtx,gen=generateJson){const w=DirectorWork.parse(input);if(!w.brief.story && !w.brief.sourceScript)throw new ApiError("VALIDATION","Добавьте историю или сценарий",400);ctx.progress("Подготовка предложения; закреплённый бриф не меняется",10);const instructions=await readPrompt("director/plan.md");const{data,model}=await gen({system:instructions,user:JSON.stringify({brief:w.brief,assets:w.assets.map(({referenceId,...a})=>a),profile:w.profile,existingShots:w.shots,existingBlocks:w.blocks,output:{shots:[{id:"S1",blockId:"B1",seconds:4,action:"Видимое действие",camera:"",audio:"",soundMode:"silent",refs:[],before:[],after:[]}],blocks:[{id:"B1",transition:"cut",refs:[],tailPad:0}],assumptions:[]}}),maxTokens:18000,temperature:.5},Proposal,0);checkCancelled();const proposed={...w,...data,approval:undefined};ctx.progress("Предложение готово; проверьте перед применением",100);return {work:proposed,report:directorReport(proposed),baseHash:directorHash(w),model};}

export function deleteDirector(id:string,revision:number){return mutate(async()=>{const h=await history(id);if(h.versions.at(-1)!.revision!==revision)throw new ApiError("VALIDATION","Конфликт версии: обновите пакет перед удалением",409);await fs.unlink(path.join(await folder("director-packages"),id+".json"));return {deleted:true,notice:"Файлы референсов сохранены: они могут использоваться другими пакетами и резервными копиями."};});}
