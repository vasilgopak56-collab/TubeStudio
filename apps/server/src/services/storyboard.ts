import { withStoryboardGuard } from "../lib/taskContext.js";
import { config } from "../config.js";
import { getSettings } from "./settings.js";
import { APP_VERSION } from "../lib/version.js";
import crypto from "node:crypto";
import { assistantProjectSnapshot } from "./assistant.js";
import { resolveVisualStyle, visualStyleGuide, type VisualStyle } from "./visualStyles.js";
import { z } from "zod";
import type { JobCtx } from "../lib/jobs.js";
import { ApiError } from "../lib/errors.js";
import { generateJson } from "./llm.js";
import fs from "node:fs";
import path from "node:path";
import { PROMPTS_DIR, readPrompt, STYLES } from "./prompts.js";

/** 18 визуальных пресетов KB YT-Genius (prompts/visual/presets.md): P1–P18 */
export function visualPresets(): { id: string; name: string; body: string }[] {
  try {
    const raw = fs.readFileSync(path.join(PROMPTS_DIR, "visual/presets.md"), "utf8");
    return [...raw.matchAll(/^## (P\d+) · (.+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)].map((m) => ({ id: m[1], name: m[2].trim(), body: m[3].trim() }));
  } catch { return []; }
}
import { addArtifact, getProject } from "./projects.js";

// ---------- конфиг ниш (из yt-ideation-mcp/visual.ts) ----------
type Niche = { cameraOptional?: boolean; batch: number; unit: "sentence" | "scene_unit"; wps: number; imageAnchors?: string[]; videoAnchors?: string[]; banned?: string[]; faceless?: boolean; noText?: boolean; assets?: boolean; guide: string };
const NICHES: Record<string, Niche> = {
  universal: { batch: 20, unit: "sentence", wps: 2.4, guide: "universal" },
  lost_relics: { batch: 20, unit: "sentence", wps: 2.5, imageAnchors: ["cinematic 35mm still photograph", "photorealistic, 8k"], videoAnchors: ["smooth cinematic documentary pacing"], guide: "lost_relics" },
  mind_bending_science: { batch: 20, unit: "sentence", wps: 2.5, imageAnchors: ["2D hand-drawn digital illustration style", "clean bold black ink linework"], videoAnchors: ["smooth 2D motion", "no morphing"], banned: ["photorealistic", "hyper-realistic"], guide: "mind_bending_science" },
  science_2d_animation: { batch: 20, unit: "sentence", wps: 2.5, imageAnchors: ["2D flat educational animation style"], videoAnchors: ["smooth 2D motion"], banned: ["photorealistic"], guide: "universal" },
  finance_2d_documentary: { batch: 20, unit: "sentence", wps: 2.5, imageAnchors: ["2D vector cartoon illustration"], videoAnchors: ["flat vector animation motion"], banned: ["photorealistic", "3D render"], guide: "finance_2d_documentary" },
  animated_2d_history: { batch: 20, unit: "sentence", wps: 2.5, noText: true, assets: true, guide: "animated_2d_history" },
  dark_3d_crime: { batch: 15, unit: "sentence", wps: 2.6, faceless: true, guide: "dark_3d_crime" },
  economics_of: { batch: 30, unit: "sentence", wps: 2.5, imageAnchors: ["full bleed 16:9"], banned: ["photorealistic", "3D render", "unreal engine", "hyper-detailed"], guide: "economics_of" },
  mind_bending_history: { batch: 20, unit: "scene_unit", wps: 130 / 60, guide: "mind_bending_history" },
  sacred_history: { batch: 20, unit: "sentence", wps: 2.5, imageAnchors: ["cinematic oil painting style"], videoAnchors: ["slow push-in"], guide: "sacred_history" },
  weird_history: { batch: 20, unit: "sentence", wps: 2.5, imageAnchors: ["photorealistic 35mm film still"], videoAnchors: ["smooth 24fps cinematic realism"], guide: "weird_history" },
  epic_history: { batch: 20, unit: "sentence", wps: 2.5, imageAnchors: ["epic cinematic historical realism"], guide: "epic_history" },
  finance_animation: { batch: 20, unit: "sentence", wps: 2.5, imageAnchors: ["A 16:9 individual scene layout"], banned: ["3D render", "photorealistic"], guide: "finance_animation" },
};

export const IMAGE_MODELS = { midjourney: "Midjourney", flux: "Flux", gpt_image: "GPT Image", whisk: "Google Whisk", imagen: "Imagen" } as const;
export const VIDEO_MODELS = { kling: { name: "Kling", clips: [5, 10] }, runway: { name: "Runway", clips: [5, 10] }, veo: { name: "Veo", clips: [8] }, seedance: { name: "Seedance", clips: [5, 10, 12] } } as const;
const IMAGE_FMT: Record<keyof typeof IMAGE_MODELS, string> = {
  midjourney: "Midjourney: one dense comma-separated descriptive line, most important subject first; END every image prompt with the parameters \"--ar 16:9 --v 7\" (add \"--style raw\" for photoreal styles).",
  flux: "Flux: one or two natural-language sentences, very concrete, describing subject, setting, light, lens; no parameters or weights.",
  gpt_image: "GPT Image: natural full sentences like briefing a photographer/illustrator; mention \"16:9 landscape frame\"; no parameters.",
  whisk: "Google Whisk: one raw descriptive paragraph, no numbering, no labels, no parameters.",
  imagen: "Imagen: clear natural-language description with style, subject, setting, lighting and \"16:9\" composition; no parameters.",
};
const VIDEO_FMT: Record<keyof typeof VIDEO_MODELS, string> = {
  kling: "Kling (image-to-video): camera movement + subject micro-action + environment motion, 1–2 sentences.",
  runway: "Runway Gen-4 (image-to-video): \"[camera movement]: [what moves and how]. [atmosphere/light change]\".",
  veo: "Veo (image-to-video, 8 s): cinematic motion description; you may add short ambient sound cues in parentheses.",
  seedance: "Seedance (image-to-video): may contain 1–3 shots with time ranges like \"0–4s: …; 4–8s: …\" matching the clip length.",
};

export const StoryboardInput = z.object({
  script: z.string().min(200, "Сценарий слишком короткий").max(60000, "Сценарий длиннее 60 000 символов"),
  style: z.string().default("universal"), customStyle: z.string().max(2000).optional(),
  preset: z.string().max(5).optional(),
  visualStyleId: z.string().max(96).optional(),
  imageModel: z.enum(Object.keys(IMAGE_MODELS) as [keyof typeof IMAGE_MODELS]).default("midjourney"),
  videoModel: z.enum(Object.keys(VIDEO_MODELS) as [keyof typeof VIDEO_MODELS]).default("kling"),
  clip: z.number().int().min(3).max(15).default(5),
  maxBatches: z.number().int().min(1).max(40).optional(),
  projectId: z.string().optional(),
});
export type StoryboardInputT = z.infer<typeof StoryboardInput>;

const hashSnapshot=(v:unknown)=>crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function makeStoryboardInputSnapshot(input:StoryboardInputT) {
  const parsed=StoryboardInput.strict().safeParse(input);
  if(!parsed.success) return undefined;
  const value=parsed.data;
  return {version:1 as const,input:value,hash:hashSnapshot(value)};
}
export const SavedStoryboardAsk=z.object({projectId:z.string().uuid(),artifactId:z.string().uuid()}).strict();
export async function previewSavedStoryboardInput(ask:z.infer<typeof SavedStoryboardAsk>) {
  const d=SavedStoryboardAsk.parse(ask),snap=await assistantProjectSnapshot(d.projectId);
  const matches=snap.project.artifacts.filter(a=>a.id===d.artifactId);
  if(matches.length!==1||matches[0].kind!=="storyboard")throw new ApiError("VALIDATION","Нужна ровно одна сохранённая раскадровка этого проекта.",409);
  const artifact=matches[0],raw=(artifact.data as any)?.inputSnapshot;
  if(raw===undefined)return {status:"legacy" as const,project:{id:snap.project.id,title:snap.project.title},artifact:{id:artifact.id,title:artifact.title,version:artifact.version??null}};
  const parsed=z.object({version:z.literal(1),input:StoryboardInput.strict(),hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().safeParse(raw);
  if(!parsed.success||parsed.data.hash!==hashSnapshot(parsed.data.input)||parsed.data.input.projectId!==d.projectId)throw new ApiError("VALIDATION","Снимок входа повреждён или относится к другому проекту; автоматическое восстановление запрещено.",409);
  const value=parsed.data.input, stylePresent=!value.visualStyleId || !!(await resolveVisualStyle(value.visualStyleId).catch(()=>undefined));
  const supported=value.script.trim().length>=200&&(value.style==="universal"||STYLES.some(s=>s.id===value.style))&&(!value.preset||visualPresets().some(p=>p.id===value.preset))&&stylePresent&&(value.maxBatches===undefined||value.maxBatches===1)&&(VIDEO_MODELS[value.videoModel].clips as readonly number[]).includes(value.clip);
  return {status:"available" as const,project:{id:snap.project.id,title:snap.project.title},artifact:{id:artifact.id,title:artifact.title,version:artifact.version??null},snapshot:parsed.data,reviewHash:hashSnapshot({ask:d,snapshot:snap.snapshot,artifact}),restorable:supported};
}


// ---------- сегментация ----------
export type Unit = { n: number; text: string; words: number; seconds: number; start: number };
const wc = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
export function cleanScript(s: string) {
  return s.replace(/\[[^\]]*\]/g, " ").replace(/^\s*(#{1,6}\s.*|[-*]{3,}|act\s+[ivx\d]+\b.*)$/gim, " ").replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();
}
export function segment(script: string, style: string) {
  const cfg = NICHES[style] ?? NICHES.universal;
  const sents = cleanScript(script).split(/(?<=[.!?…]["”’»)]?)\s+(?=["“‘«(]?[\p{Lu}0-9])/u).map((x) => x.trim()).filter(Boolean);
  const groups: string[][] = [];
  if (cfg.unit === "scene_unit") {
    let cur: string[] = [];
    for (const s of sents) { const w = wc(cur.join(" ")); if (cur.length && (cur.length >= 4 || ((cur.length >= 2 || w >= 15) && w + wc(s) > 30))) { groups.push(cur); cur = []; } cur.push(s); }
    if (cur.length) groups.push(cur);
  } else {
    // очень короткие предложения (< 4 слов) склеиваем с соседним — отдельный кадр на «Да.» не нужен
    for (const s of sents) { const last = groups[groups.length - 1]; if (last && (wc(s) < 4 || wc(last.join(" ")) < 4)) last.push(s); else groups.push([s]); }
  }
  let t = 0;
  const units: Unit[] = groups.map((g, i) => { const text = g.join(" "), words = wc(text), seconds = +(words / cfg.wps).toFixed(1); const u = { n: i + 1, text, words, seconds, start: +t.toFixed(1) }; t += seconds; return u; });
  const batches: { n: number; from: number; to: number }[] = [];
  for (let i = 0; i < units.length; i += cfg.batch) batches.push({ n: batches.length + 1, from: i + 1, to: Math.min(i + cfg.batch, units.length) });
  return { units, batches, totalSeconds: Math.round(t), cfg };
}

// ---------- валидаторы (checkImageBatch / checkVideoBatch) ----------
type Scene = { n: number; concept: string; image: string; video: string };
const stripNeg = (s: string) => s.replace(/\b(no|without|not|avoid|never)\s+[\w\s-]{0,30}?(photorealistic|hyper-realistic|3d render(ing)?|unreal engine|hyper-detailed)/gi, " ");
export function checkImageBatch(scenes: Scene[], units: Unit[], cfg: Niche, model: string) {
  const errors: string[] = [], warnings: string[] = [];
  const ns = scenes.map((s) => s.n), want = units.map((u) => u.n);
  const missing = want.filter((n) => !ns.includes(n)); if (missing.length) errors.push(`Нет сцен для строк: ${missing.join(", ")}`);
  const dup = ns.filter((n, i) => ns.indexOf(n) !== i); if (dup.length) errors.push(`Повтор сцен: ${[...new Set(dup)].join(", ")}`);
  if (ns.some((n, i) => i && n < ns[i - 1])) warnings.push("Нарушен порядок сцен");
  for (const s of scenes) {
    const low = s.image.toLowerCase();
    if (s.image.length < 60) errors.push(`#${s.n}: слишком короткий image-промпт`);
    for (const b of cfg.banned ?? []) if (new RegExp(`\\b${b}\\b`, "i").test(stripNeg(s.image))) errors.push(`#${s.n}: запрещённый термин «${b}»`);
    if (/same (character|man|woman|person)|as before|as above|same as/i.test(s.image)) errors.push(`#${s.n}: «same as before» запрещено — опишите полностью`);
    if (cfg.faceless && /\b(man|woman|person|figure|people|men|women|child|officer|detective|victim|suspect)\b/i.test(s.image) && !/faceless|featureless/i.test(s.image)) errors.push(`#${s.n}: люди без faceless-описания`);
    if (cfg.noText && /\b(text reading|caption|typography|title card|sign that says)\b/i.test(stripNeg(s.image))) warnings.push(`#${s.n}: текст в кадре`);
    if (model === "midjourney" && !/--ar 16:9/.test(s.image)) warnings.push(`#${s.n}: нет --ar 16:9`);
    if (model !== "midjourney" && /--\w+/.test(s.image)) warnings.push(`#${s.n}: параметры «--» не нужны для этой модели`);
    if (cfg.assets && !/\[(CHARACTER|LOCATION|ASSET)_?\w*:/i.test(s.image)) warnings.push(`#${s.n}: нет ссылки на ассет [CHARACTER: …]`);
    void low;
  }
  return { errors, warnings };
}
export function checkVideoBatch(scenes: Scene[], cfg: Niche, model: string, clip: number) {
  const errors: string[] = [], warnings: string[] = [];
  for (const s of scenes) {
    if (s.video.length < 25) errors.push(`#${s.n}: слишком короткий video-промпт`);
    if (!cfg.cameraOptional && !/(push|pull|pan|tilt|dolly|zoom|track|orbit|crane|static|handheld|drift|arc|truck|rack focus|slow|camera|close|follow|rotat|move|glide|sweep|reveal|hold|locked)/i.test(s.video)) warnings.push(`#${s.n}: не указано движение камеры`);
    if (/morph/i.test(s.video) && !/no morph/i.test(s.video)) warnings.push(`#${s.n}: морфинг — частая причина артефактов`);
    if (model === "seedance") { const ends = [...s.video.matchAll(/(\d+(?:\.\d+)?)\s*s?\s*[–-]\s*(\d+(?:\.\d+)?)\s*s/g)].map((m) => +m[2]); if (ends.length && Math.abs(Math.max(...ends) - clip) > 0.5) warnings.push(`#${s.n}: таймлайн до ${Math.max(...ends)}s при клипе ${clip}s`); }
  }
  void cfg;
  return { errors, warnings };
}
const ensureAnchors = (p: string, anchors: string[] = [], tail = "") => {
  let r = p.trim(); const missing = anchors.filter((a) => !r.toLowerCase().includes(a.toLowerCase()));
  if (missing.length) { const m = r.match(/\s(--\w[\s\S]*)$/); const params = m ? m[1] : ""; if (m) r = r.slice(0, m.index).trim(); r = `${r.replace(/[.,;\s]+$/, "")}, ${missing.join(", ")}${params ? " " + params : ""}`; }
  if (tail && !r.includes(tail.split(" ")[0])) r = `${r} ${tail}`;
  return r;
};

// ---------- генерация ----------
const Bible = z.object({
  medium: z.string().max(600), palette: z.string().max(400), lighting: z.string().max(400), camera: z.string().max(400), mood: z.string().max(300), negative: z.string().max(400),
  characters: z.array(z.object({ id: z.string().max(40), name: z.string().max(80), description: z.string().max(2000) })).max(12),
  locations: z.array(z.object({ id: z.string().max(40), name: z.string().max(80), description: z.string().max(2000) })).max(12),
});
export type StyleBible = z.infer<typeof Bible>;
const BatchOut = z.object({ scenes: z.array(z.object({ n: z.number().int(), concept: z.string().min(3).max(400), image: z.string().min(20).max(2500), video: z.string().min(10).max(1500) })) });

export type StoryRow = Unit & { concept: string; image: string; video: string; clip: number; clips: number; batch: number };
export type StoryboardResult = {
  visualStyle?: VisualStyle; rows: StoryRow[]; bible: StyleBible; batches: { n: number; from: number; to: number; errors: string[]; warnings: string[]; retried: boolean }[];
  totalUnits: number; totalSeconds: number; done: boolean; input: StoryboardInputT; model: string; projectId?: string; artifactId?: string;
};

type ResumeEvent = {type:string;data:any};
type AudioJournal = {append:(type:string,data:unknown)=>Promise<void>;seed:unknown;resumeEvents?:ResumeEvent[];expectedHash?:string;checkSeed?:()=>Promise<unknown>};
async function storyboardPlan(input:StoryboardInputT,timedUnits?:Unit[]) {
  const style = NICHES[input.style] ? input.style : "universal";
  const segmented = segment(input.script, style);
  const visualStyle = await resolveVisualStyle(input.visualStyleId);
  // Explicit library selection replaces rendering directives only; segmentation/timing stay intact.
  const cfg = visualStyle ? { ...segmented.cfg, cameraOptional: true, imageAnchors: undefined, videoAnchors: undefined, banned: undefined, faceless: false, noText: false } : segmented.cfg;
  const units = timedUnits ?? segmented.units;
  const totalSeconds = timedUnits ? Math.max(...timedUnits.map(u => u.start + u.seconds), 0) : segmented.totalSeconds;
  const batches = timedUnits ? Array.from({length: Math.ceil(units.length / cfg.batch)}, (_, i) => ({n:i+1,from:i*cfg.batch+1,to:Math.min(units.length,(i+1)*cfg.batch)})) : segmented.batches;
  if (!units.length) throw new ApiError("VALIDATION", "Не удалось разбить сценарий на предложения", 400);
  const vm = VIDEO_MODELS[input.videoModel], clip = (vm.clips as readonly number[]).includes(input.clip) ? input.clip : vm.clips.reduce((a, b) => (Math.abs(b - input.clip) < Math.abs(a - input.clip) ? b : a));
  const guide = visualStyle ? visualStyleGuide(visualStyle) : (await readPrompt(`visual/${cfg.guide}.md`).catch(() => "")).slice(0, 9000);
  const styleName = STYLES.find((s) => s.id === style)?.name ?? "Универсальный";
  const use = batches.slice(0, input.maxBatches ?? batches.length);
  const sys = `You are an elite art director and AI image/video prompt engineer for YouTube documentaries.\n\nSTYLE GUIDE (follow its visual directives; ignore its instructions about chat flow, batching, confirmations or output formatting — the output format is defined by the user message):\n${guide}${(() => { const p = !visualStyle && input.preset ? visualPresets().find((x) => x.id === input.preset) : undefined; return p ? `\n\nVISUAL PRESET ${p.id} «${p.name}» (overrides the guide's rendering style, palette and lighting; keep it identical in every prompt):\n${p.body.slice(0, 2500)}` : ""; })()}${input.customStyle ? `\n\nAUTHOR'S CUSTOM STYLE (highest priority):\n${input.customStyle}` : ""}`;
  return {style, segmented, visualStyle, cfg, units, totalSeconds, batches, clip, use, sys, styleName};
}
async function planHash(input:StoryboardInputT, timedUnits:Unit[]|undefined, seed:unknown) {
  const p=await storyboardPlan(input,timedUnits), settings=await getSettings();
  const hash=hashSnapshot({version:APP_VERSION,input,units:p.units,cfg:p.cfg,batches:p.batches,clip:p.clip,sys:p.sys,visualStyle:p.visualStyle??null,seed,provider:{llmProvider:settings.llmProvider,models:settings.models,anymodel:settings.anymodel,base:config.anymodelBase,keys:{anymodel:config.keys.anymodel,anthropic:config.keys.anthropic,gemini:config.keys.gemini}}});
  return {p,hash};
}
const corrupted=()=>new ApiError("VALIDATION","Промежуточные данные не подходят для безопасного продолжения. Используйте ручной экспорт или проверьте резервную копию.",409);
const EventReport=z.object({n:z.number().int(),from:z.number().int(),to:z.number().int(),errors:z.array(z.string()).max(1000),warnings:z.array(z.string()).max(1000),retried:z.boolean()}).strict();
const Row=z.object({n:z.number().int(),text:z.string(),words:z.number(),seconds:z.number(),start:z.number(),concept:z.string().min(3).max(400),image:z.string().min(20).max(2500),video:z.string().min(10).max(1500),clip:z.number(),clips:z.number(),batch:z.number()}).strict();
function replay(events:ResumeEvent[], p:Awaited<ReturnType<typeof storyboardPlan>>, input:StoryboardInputT, hash:string) {
  if(events[0]?.type!=="begin"||events[0]?.data?.schema!==2||events[1]?.type!=="prepared"||events[1].data?.version!==1||events[1].data?.hash!==hash)throw corrupted();
  let bible:StyleBible|undefined,model="",pending:string|undefined;let projectSave:{projectId:string;artifactId:string;resultHash:string;artifactHash:string;done:boolean}|undefined;const rows:StoryRow[]=[],reports:StoryboardResult["batches"]=[];
  for(const e of events.slice(2)) {
    if(e.type==="resume") { if(e.data?.acknowledged!==true || typeof e.data?.reviewHash!=="string")throw corrupted();pending=undefined;continue; }
    if(e.type==="started") { if(pending||projectSave)throw corrupted(); const next=bible?p.use[reports.length]:undefined; if(!bible ? e.data?.step!=="bible" : !next||e.data?.step!=="batch"||e.data.n!==next.n||e.data.from!==next.from||e.data.to!==next.to)throw corrupted();pending=bible?"batch":"bible";continue; }
    if(e.type==="bible") { if(pending!=="bible"||bible)throw corrupted();const parsed=Bible.safeParse(e.data?.bible);if(!parsed.success||typeof e.data?.model!=="string"||!e.data.model||e.data.model.length>300)throw corrupted();bible=parsed.data;model=e.data.model;pending=undefined;continue; }
    if(e.type==="batch") {
      const next=p.use[reports.length], rp=EventReport.safeParse(e.data?.report),rs=z.array(Row).max(30).safeParse(e.data?.rows);
      if(pending!=="batch"||!bible||!next||!rp.success||!rs.success||rp.data.errors.length||rp.data.n!==next.n||rp.data.from!==next.from||rp.data.to!==next.to)throw corrupted();
      const bu=p.units.slice(next.from-1,next.to);if(rs.data.length!==bu.length)throw corrupted();
      for(let i=0;i<bu.length;i++){const u=bu[i],r=rs.data[i];if(r.n!==u.n||r.text!==u.text||r.words!==u.words||r.seconds!==u.seconds||r.start!==u.start||r.clip!==p.clip||r.clips!==Math.max(1,Math.ceil(u.seconds/p.clip-0.15))||r.batch!==next.n)throw corrupted();}
      const ci=checkImageBatch(rs.data,bu,p.cfg,input.imageModel),cv=checkVideoBatch(rs.data,p.cfg,input.videoModel,p.clip);if(ci.errors.length||cv.errors.length||JSON.stringify([...ci.warnings,...cv.warnings])!==JSON.stringify(rp.data.warnings))throw corrupted();
      rows.push(...rs.data);reports.push(rp.data);pending=undefined;continue;
    }
    if(e.type==="project-save-start") {const v=z.object({projectId:z.string().uuid(),artifactId:z.string().uuid(),resultHash:z.string().regex(/^[a-f0-9]{64}$/),artifactHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().safeParse(e.data);if(!v.success||projectSave||pending||!bible||reports.length!==p.use.length)throw corrupted();projectSave={...v.data,done:false};continue;}
    if(e.type==="project-save-done") {if(!projectSave||projectSave.done||e.data?.artifactId!==projectSave.artifactId)throw corrupted();projectSave.done=true;continue;}
    throw corrupted(); // invalid, complete, unknown and legacy records never silently resume
  }
  return {bible,model,rows,reports,pending,projectSave};
}
export async function inspectStoryboardResume(input:StoryboardInputT,units:Unit[],seed:unknown,events:ResumeEvent[]) {
  const {p,hash}=await planHash(input,units,seed),state=replay(events,p,input,hash);
  return {hash,completedBatches:state.reports.length,totalBatches:p.use.length,bible:!!state.bible,pending:state.pending??null,projectSave:state.projectSave??null};
}
export async function runStoryboard(input: StoryboardInputT, ctx: JobCtx, timedUnits?: Unit[], journal?: AudioJournal): Promise<StoryboardResult> {
  const {p,hash}=journal?await planHash(input,timedUnits,journal.seed):{p:await storyboardPlan(input,timedUnits),hash:""};
  const {style,segmented,visualStyle,cfg,units,totalSeconds,batches,clip,use,sys,styleName}=p;
  ctx.progress(`План: ${units.length} сцен, ${batches.length} батч(ей) · ${Math.round(totalSeconds / 60)} мин`, 5);
  const recovered=journal?.resumeEvents?replay(journal.resumeEvents,p,input,hash):undefined;
  if(journal?.expectedHash && hash!==journal.expectedHash)throw corrupted();
  if(journal&&!recovered)await journal.append("prepared",{version:1,hash});
  const check=async()=>{if(journal?.checkSeed){const current=await planHash(input,timedUnits,await journal.checkSeed());if(current.hash!==hash)throw corrupted();}};
  await check();
  ctx.progress("Шаг 3a: библия стиля и ассеты", 8);

  let bible:StyleBible,model:string;
  if(recovered?.bible){bible=recovered.bible;model=recovered.model;}else{
  await journal?.append("started", { step: "bible" });
  const generated = await withStoryboardGuard(journal?check:undefined,()=>generateJson({ system: sys, user: `Create a concise STYLE BIBLE. Keep each descriptive field below 400 characters; character/location descriptions below 600 characters. This video must keep all prompts consistent: medium/rendering style, colour palette, lighting, camera language, mood, negative (what to avoid), recurring characters (id like CHAR_1, name, full visual description: age, build, face, hair, clothing — ${cfg.faceless ? "faceless mannequin-free featureless faces as the guide requires" : "period accurate"}) and recurring locations (id like LOC_1). English. Only characters/locations that really recur.\n\nSCRIPT:\n${cleanScript(input.script).slice(0, 14000)}\n\nReturn JSON {"medium","palette","lighting","camera","mood","negative","characters":[{"id","name","description"}],"locations":[{"id","name","description"}]}`, maxTokens: 4000, temperature: 0.5 }, Bible));
  bible=generated.data;model=generated.model;
  await journal?.append("bible", { bible, model });
  }
  ctx.partial({ bible });

  const rows: StoryRow[] = [...(recovered?.rows??[])], reports: StoryboardResult["batches"] = [...(recovered?.reports??[])];
  if(rows.length)ctx.partial({rows:[...rows],batches:[...reports]});
  const bibleText = `MEDIUM: ${bible.medium}\nPALETTE: ${bible.palette}\nLIGHTING: ${bible.lighting}\nCAMERA: ${bible.camera}\nMOOD: ${bible.mood}\nAVOID: ${bible.negative}\nCHARACTERS:\n${bible.characters.map((c) => `- [${c.id}] ${c.name}: ${c.description}`).join("\n") || "-"}\nLOCATIONS:\n${bible.locations.map((l) => `- [${l.id}] ${l.name}: ${l.description}`).join("\n") || "-"}`;
  for (const b of use.slice(reports.length)) {
    await check();
    const bu = units.slice(b.from - 1, b.to);
    ctx.progress(`Шаги 3b/3c: батч ${b.n} из ${use.length} (сцены ${b.from}–${b.to})`, 12 + Math.round(((b.n - 1) / use.length) * 80));
    const prevCtx = rows.slice(-2).map((r) => `#${r.n} ${r.concept}`).join("; ");
    let user = `STYLE BIBLE:\n${bibleText}\n\nIMAGE MODEL FORMAT — ${IMAGE_FMT[input.imageModel]}\nVIDEO MODEL FORMAT — ${visualStyle ? (visualStyle.motionKind === "action" ? "Action-first image-to-video: Start; Action; Result; Reaction; Camera (optional); Continuity. One feasible action, no new props, preserve identity. " : "Follow SELECTED NATIVE VISUAL STYLE motion, preserve identities and geometry. ") + (input.videoModel === "seedance" ? "Use time ranges matching clip length." : "Use concise natural language suitable for " + input.videoModel + ".") : VIDEO_FMT[input.videoModel]} Clip length: ${clip} s.\n${cfg.imageAnchors ? `Every image prompt MUST contain these exact anchors: ${cfg.imageAnchors.map((a) => `"${a}"`).join(", ")}.\n` : ""}${cfg.videoAnchors ? `Every video prompt MUST contain: ${cfg.videoAnchors.map((a) => `"${a}"`).join(", ")}.\n` : ""}${cfg.banned ? `Never use: ${cfg.banned.join(", ")} (except as "no X").\n` : ""}${cfg.faceless ? "All humans must be explicitly described as faceless with featureless faces.\n" : ""}${cfg.assets ? "Reference recurring assets inline as [CHARACTER: CHAR_1] / [LOCATION: LOC_1].\n" : ""}Write the full description of a recurring character every time (no "same as before").${prevCtx ? `\nPrevious scenes for continuity: ${prevCtx}` : ""}

For EACH numbered narration line below create exactly one scene: "concept" (short Russian description of what we see, ≤ 20 words), "image" (English image prompt), "video" (English image-to-video motion prompt for that image, ${clip} s).
LINES:
${bu.map((u) => `${u.n}. ${timedUnits ? `[audio ${u.start.toFixed(3)}s–${(u.start+u.seconds).toFixed(3)}s; speech ${u.seconds.toFixed(3)}s] ` : ""}${u.text}`).join("\n")}

Return JSON {"scenes":[{"n","concept","image","video"}]} with ${bu.length} scenes, n = line number.`;
    await journal?.append("started", { step: "batch", ...b });
    let scenes: Scene[] = [], rep = { errors: [] as string[], warnings: [] as string[] }, retried = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data } = await withStoryboardGuard(journal?check:undefined,()=>generateJson({ system: sys, user, maxTokens: Math.min(30000, 900 * bu.length + 2000), temperature: 0.7 }, BatchOut));
      // авто-исправления: якоря и суффиксы, затем валидация
      scenes = data.scenes.filter((s) => s.n >= b.from && s.n <= b.to).map((s) => ({ ...s,
        image: ensureAnchors(s.image, cfg.imageAnchors, input.imageModel === "midjourney" ? "--ar 16:9 --v 7" : ""),
        video: ensureAnchors(s.video, cfg.videoAnchors) }));
      const i = checkImageBatch(scenes, bu, cfg, input.imageModel), v = checkVideoBatch(scenes, cfg, input.videoModel, clip);
      rep = { errors: [...i.errors, ...v.errors], warnings: [...i.warnings, ...v.warnings] };
      if (!rep.errors.length || attempt) break;
      retried = true; ctx.progress(`Батч ${b.n}: исправляем ${rep.errors.length} ошибок валидатора`, 12 + Math.round(((b.n - 0.5) / use.length) * 80));
      user += `\n\nYOUR PREVIOUS ANSWER FAILED VALIDATION — fix ALL of these and return the full batch again:\n- ${rep.errors.slice(0, 20).join("\n- ")}`;
    }
    for (const u of bu) {
      const s = scenes.find((x) => x.n === u.n);
      rows.push({ ...u, concept: s?.concept ?? "—", image: s?.image ?? "", video: s?.video ?? "", clip, clips: Math.max(1, Math.ceil(u.seconds / clip - 0.15)), batch: b.n });
    }
    reports.push({ ...b, ...rep, retried });
    if (!rep.errors.length) await journal?.append("batch", { report: reports.at(-1), rows: rows.slice(-bu.length) });
    else await journal?.append("invalid", { report: reports.at(-1) });
    ctx.partial({ rows: [...rows], batches: [...reports] });
    ctx.signal.throwIfAborted();
  }

  const result: StoryboardResult = { ...(visualStyle ? { visualStyle } : {}), rows, bible, batches: reports, totalUnits: units.length, totalSeconds, done: use.length === batches.length, input: { ...input, script: input.script }, model };
  void styleName;
  if (input.projectId) {
    try { await getProject(input.projectId); ctx.progress("Сохраняем в проект", 97); const inputSnapshot = !timedUnits ? makeStoryboardInputSnapshot(input) : undefined; const a = await addArtifact(input.projectId, { kind: "storyboard", title: `Раскадровка · ${rows.length} сцен`, data: { ...result, input: { ...input, script: undefined }, ...(inputSnapshot ? { inputSnapshot } : {}) } }); result.projectId = input.projectId; result.artifactId = a.id; } catch { /* нет проекта */ }
  }
  return result;
}

export const STORYBOARD_META = () => ({
  styles: [{ id: "universal", name: "Свой / универсальный" }, ...STYLES.map((s) => ({ id: s.id, name: s.name }))],
  presets: visualPresets().map(({ id, name, body }) => ({ id, name, hint: body.replace(/\*\*/g, "").slice(0, 200) })),
  imageModels: Object.entries(IMAGE_MODELS).map(([id, name]) => ({ id, name })),
  videoModels: Object.entries(VIDEO_MODELS).map(([id, v]) => ({ id, name: v.name, clips: v.clips })),
});
