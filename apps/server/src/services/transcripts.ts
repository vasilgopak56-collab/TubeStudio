import { rethrowFinancial } from "../lib/errors.js";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import type { JobCtx } from "../lib/jobs.js";
import { dataPath } from "../lib/storage.js";
import { checkCancelled, rethrowCancelled, withTaskSignal } from "../lib/taskContext.js";
import { LANG_NAME } from "./languages.js";
import { generateText, extractJson } from "./llm.js";
import { fill, readPrompt } from "./prompts.js";
import { getSettings } from "./settings.js";
import { fetchYoutubeTranscript } from "./youtubeCaptions.js";
import { parseTranscript, TRANSCRIPT_LIMITS } from "./transcriptText.js";
const Language = z.string().refine(v => Object.hasOwn(LANG_NAME, v), "Неизвестный язык");
export const TranscriptInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("youtube"), url: z.string().trim().min(3).max(500), language: Language }).strict(),
  z.object({ kind: z.literal("text"), text: z.string().trim().min(1).max(TRANSCRIPT_LIMITS.inputChars), title: z.string().trim().max(300).default(""), format: z.enum(["txt", "srt", "vtt"]).default("txt") }).strict(),
  z.object({ kind: z.literal("file"), text: z.string().trim().min(1).max(TRANSCRIPT_LIMITS.inputChars), filename: z.string().trim().min(1).max(300), format: z.enum(["txt", "srt", "vtt"]) }).strict(),
]);
export const TranscriptSelection = z.object({ id: z.string().uuid(), mode: z.enum(["summary", "remix"]), language: Language.optional(), words: z.number().int().min(300).max(3000).default(1000), angle: z.string().trim().max(1000).default("") }).strict();
export const TranscriptAnalyzeInput = TranscriptSelection.extend({previewHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const Analysis = z.object({ title: z.string().min(1).max(300), summary: z.string().min(1).max(8000), keyPoints: z.array(z.string().min(1).max(1500)).min(1).max(15), outline: z.array(z.object({ heading: z.string().max(300), notes: z.string().max(1500) })).max(20), cautions: z.array(z.string().max(1500)).min(1).max(15), script: z.string().max(100000) }).strict();
const Source=z.object({kind:z.enum(["youtube","text","file"]),title:z.string().max(1000),url:z.string().max(500).optional(),videoId:z.string().regex(/^[\w-]{11}$/).optional(),channel:z.string().max(1000).optional(),language:z.string().max(100).optional(),automatic:z.boolean().optional(),availableLanguages:z.array(z.string().max(100)).max(100).optional(),filename:z.string().max(300).optional(),format:z.string().max(20).optional()}).strict();
const Segment=z.object({start:z.number().finite().nonnegative().nullable(),end:z.number().finite().nonnegative().nullable(),text:z.string().max(300000)}).strict();
const Preview=z.object({selection:TranscriptSelection.extend({language:Language}),sourceCreatedAt:z.string().datetime(),system:z.string().max(20000),user:z.string().max(400000),hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type TranscriptPreview=z.infer<typeof Preview>;
const Run=z.object({version:z.literal(1),id:z.string().uuid(),parentId:z.string().uuid().optional(),createdAt:z.string().datetime(),source:Source,text:z.string().min(1).max(300000),segments:z.array(Segment).min(1).max(10000),warnings:z.array(z.string().max(2000)).max(100),analysis:Analysis.extend({mode:z.enum(["summary","remix"]),model:z.string().min(1).max(500),language:Language,requestedWords:z.number().int().min(300).max(3000),scriptWords:z.number().int().nonnegative(),angle:z.string().max(1000)}).optional(),request:Preview.optional()}).strict();
export type TranscriptRun=z.infer<typeof Run>;
const digest=(p:Omit<TranscriptPreview,"hash">)=>crypto.createHash("sha256").update(JSON.stringify([p.selection,p.sourceCreatedAt,p.system,p.user])).digest("hex");
const sourceUser=(r:Pick<TranscriptRun,"source"|"text">)=>JSON.stringify({source:r.source,transcript:r.text});
function validRun(r:TranscriptRun){
 if(r.source.url){try{if(!r.source.videoId||r.source.url!==`https://www.youtube.com/watch?v=${r.source.videoId}`)return false;}catch{return false;}}
 if(r.segments.some(x=>x.start===null?x.end!==null:x.end!==null&&x.end<x.start))return false;
 if(!r.request)return true;
 const p=r.request,a=r.analysis;return !!a&&r.parentId===p.selection.id&&digest(p)===p.hash&&p.user===sourceUser(r)&&a.mode===p.selection.mode&&a.language===p.selection.language&&a.angle===p.selection.angle&&a.requestedWords===p.selection.words&&a.scriptWords===countTranscriptWords(a.script,a.language)&&(a.mode==="summary"?a.script==="":a.script.trim().length>=100);
}
const MAX_BYTES=4*1024*1024;
async function folder(create=false){const p=dataPath("transcript-runs");if(create)await fs.mkdir(p,{recursive:true,mode:0o700});try{const st=await fs.lstat(p);if(st.isSymbolicLink()||!st.isDirectory())throw new ApiError("VALIDATION","Каталог транскриптов недоступен");return p;}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return null;throw e;}}
async function saveSnapshot(run:TranscriptRun,ctx:JobCtx){
 checkCancelled(ctx.signal);const parsed=Run.parse(run);if(!validRun(parsed))throw new ApiError("VALIDATION","Несогласованный снимок транскрипта");const dir=await folder(true),dest=dir+"/"+run.id+".json",temp=dest+".tmp",json=JSON.stringify(parsed,null,2);if(Buffer.byteLength(json)>MAX_BYTES)throw new ApiError("VALIDATION","Снимок транскрипта слишком большой");
 try{await fs.writeFile(temp,json,{flag:"wx",mode:0o600});checkCancelled(ctx.signal);await fs.rename(temp,dest);checkCancelled(ctx.signal);}catch(e){await fs.rm(temp,{force:true});await fs.rm(dest,{force:true});throw e;}return parsed;
}
export async function importTranscript(input: z.infer<typeof TranscriptInput>, ctx: JobCtx): Promise<TranscriptRun> {
  return withTaskSignal(ctx.signal, async () => {
    checkCancelled(); ctx.progress(input.kind === "youtube" ? "Получаю доступные субтитры YouTube" : "Разбираю текст и таймкоды", 15);
    let data: Pick<TranscriptRun, "source" | "text" | "segments" | "warnings">;
    if (input.kind === "youtube") data = await fetchYoutubeTranscript(input.url, input.language);
    else {
      const parsed = parseTranscript(input.text, input.format);
      const filename = input.kind === "file" ? input.filename.split(/[\\/]/).pop()! : undefined;
      data = { ...parsed, source: { kind: input.kind, title: input.kind === "file" ? filename! : input.title || "Вставленный транскрипт", ...(filename ? { filename } : {}), format: input.format } };
    }
    checkCancelled(); ctx.progress("Сохраняю исходный транскрипт без вызова нейросети", 90);
    return saveSnapshot({ ...data, version: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString() }, ctx);
  });
}
export function countTranscriptWords(text: string, language: string) {
  const segmenter = new Intl.Segmenter(language, { granularity: "word" });
  return [...segmenter.segment(text)].filter(s => s.isWordLike).length;
}
export async function previewTranscript(input:z.infer<typeof TranscriptSelection>):Promise<TranscriptPreview>{
 const selection=TranscriptSelection.parse(input),original=await loadTranscriptRun(selection.id);
 if(!original)throw new ApiError("NOT_FOUND","Транскрипт не найден или повреждён",404);
 if(original.text.length>TRANSCRIPT_LIMITS.analysisChars)throw new ApiError("VALIDATION","Для одного AI-разбора доступно до 60 000 символов. Скопируйте нужную часть в новый текст; автоматическое обрезание не выполняется.");
 if(original.text.trim().length<100)throw new ApiError("VALIDATION","Для AI-разбора нужно хотя бы 100 символов текста.");
 const language=selection.language??(await getSettings()).contentLanguage;
 const system=fill(await readPrompt("transcripts/analysis.md"),{language:LANG_NAME[language]??language,mode:selection.mode,words:selection.words,angle:JSON.stringify(selection.angle||"Use a distinct explanatory angle appropriate to the source.")}),user=sourceUser(original);
 if(system.length>20000||user.length>400000)throw new ApiError("VALIDATION","Предпросмотр слишком большой: сократите промпт");
 const p={selection:TranscriptSelection.extend({language:Language}).parse({...selection,language}),sourceCreatedAt:original.createdAt,system,user};return Preview.parse({...p,hash:digest(p)});
}
export async function analyzeTranscript(input:z.infer<typeof TranscriptAnalyzeInput>,ctx:JobCtx):Promise<TranscriptRun>{return withTaskSignal(ctx.signal,async()=>{
 const {previewHash,...selection}=TranscriptAnalyzeInput.parse(input);checkCancelled();const preview=await previewTranscript(selection);
 if(preview.hash!==previewHash)throw new ApiError("VALIDATION","Источник, форма, язык или промпт изменились. Обновите предпросмотр перед AI.",409);
 const original=await loadTranscriptRun(selection.id);if(!original||sourceUser(original)!==preview.user||original.createdAt!==preview.sourceCreatedAt)throw new ApiError("VALIDATION","Источник изменился. Обновите предпросмотр.",409);
 const language=preview.selection.language;checkCancelled();ctx.progress(selection.mode==="remix"?"Пишу новый сценарий по показанному исходнику (AI)":"Готовлю краткий разбор показанного исходника (AI)",35);
 let response;try{response=await generateText({system:preview.system,user:preview.user,role:selection.mode==="remix"?"script":undefined,temperature:selection.mode==="remix"?.6:.2,maxTokens:selection.mode==="remix"?16000:6000});}catch(e){rethrowCancelled(e); rethrowFinancial(e);if(e instanceof ApiError&&["KEY_MISSING","BUDGET_LIMIT","LLM_RATE_LIMIT"].includes(e.code))throw new ApiError(e.code,e.code==="KEY_MISSING"?"Укажите ключ текстовой модели.":e.code==="BUDGET_LIMIT"?"Лимит бюджета исчерпан.":"Модель ограничила запросы.",e.status);throw new ApiError("UPSTREAM","Не удалось получить AI-разбор. Прежние снимки не изменены; запрос мог быть оплачен.",502);}
 checkCancelled();let data;try{if(response.text.length>150000)throw Error("large");data=Analysis.parse(extractJson(response.text));if(selection.mode==="remix"?data.script.trim().length<100:data.script!=="")throw Error("mode");}catch{throw new ApiError("LLM_INVALID_JSON","Модель вернула некорректный ответ. Разбор не сохранён; запрос мог быть оплачен. Автоисправление не запускается.",502);}
 const scriptWords=countTranscriptWords(data.script,language),warnings=original.warnings.filter(w=>!w.startsWith("Объём сценария отличается от цели"));if(selection.mode==="remix"&&Math.abs(scriptWords-selection.words)>selection.words*.3)warnings.push(`Объём сценария отличается от цели более чем на 30%: ${scriptWords} вместо ~${selection.words} слов. Автодописание не запускалось.`);
 const run:TranscriptRun={...original,id:crypto.randomUUID(),parentId:original.id,createdAt:new Date().toISOString(),warnings,request:preview,analysis:{...data,mode:selection.mode,model:response.model,language,requestedWords:selection.words,scriptWords,angle:selection.angle}};
 ctx.progress("Сохраняю новую версию; исходный текст не изменяется",95);return saveSnapshot(run,ctx);
});}
export async function listTranscriptRuns(){
 const dir=await folder();if(!dir)return [];const names=await fs.readdir(dir);if(names.length>5000)throw new ApiError("VALIDATION","Более 5000 файлов: архивируйте часть при остановленном сервере");const rows=[];
 for(const name of names){if(!/^[\da-f-]{36}\.json$/i.test(name))continue;const r=await loadTranscriptRun(name.slice(0,-5));if(r)rows.push({id:r.id,createdAt:r.createdAt,title:r.analysis?.title??r.source.title,kind:r.source.kind,mode:r.analysis?.mode??"source",chars:r.text.length});}
 return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)).slice(0,50);
}
export async function loadTranscriptRun(id:string):Promise<TranscriptRun|null>{
 if(!z.string().uuid().safeParse(id).success||!await folder())return null;let file;try{const p=dataPath("transcript-runs",id+".json"),s=await fs.lstat(p);if(!s.isFile()||s.isSymbolicLink()||s.size>MAX_BYTES)return null;file=await fs.open(p,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const st=await file.stat();if(!st.isFile()||s.ino!==st.ino||s.dev!==st.dev||st.size>MAX_BYTES)return null;const b=Buffer.alloc(MAX_BYTES+1);let n=0;while(n<b.length){const r=await file.read(b,n,b.length-n,null);if(!r.bytesRead)break;n+=r.bytesRead;}if(n>MAX_BYTES)return null;const r=Run.safeParse(JSON.parse(b.subarray(0,n).toString("utf8")));return r.success&&r.data.id===id&&validRun(r.data)?r.data:null;
 }catch(e){if(e instanceof SyntaxError||["ENOENT","ELOOP"].includes((e as NodeJS.ErrnoException).code??""))return null;throw e;}finally{await file?.close();}
}
