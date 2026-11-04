import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { JobCtx } from "../src/lib/jobs.js";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ts-transcripts-"));
await fs.cp(process.env.PROMPTS_DIR!,path.join(dir,"prompts"),{recursive:true});process.env.PROMPTS_DIR=path.join(dir,"prompts");
process.env.DATA_DIR = dir; process.env.ANTHROPIC_API_KEY = "fake-transcript-unit-key";
const { parseTranscript, parseJson3, TRANSCRIPT_LIMITS } = await import("../src/services/transcriptText.js");
const { parseVideoId, assertYoutubeUrl, extractPlayer, fetchYoutubeTranscript } = await import("../src/services/youtubeCaptions.js");
const { TranscriptInput, TranscriptAnalyzeInput, TranscriptSelection, previewTranscript, importTranscript, analyzeTranscript, loadTranscriptRun, listTranscriptRuns, countTranscriptWords } = await import("../src/services/transcripts.js");
const { transcriptsRoute } = await import("../src/routes/transcripts.js");
const { withTaskSignal } = await import("../src/lib/taskContext.js");
const ctx = (controller = new AbortController()): JobCtx => ({ signal: controller.signal, progress() {}, partial() {} });
const runAI=async(input:any,c:JobCtx)=>{const p=await previewTranscript(input);return analyzeTranscript({...input,previewHash:p.hash},c);};
const ID = "abcdefghijk";
const sourceText = "Тестовый исходный материал о строительстве города. Рассказчик объясняет несколько причин выбора места, но точность дат ещё не проверена. ".repeat(3);
const validAnalysis = (script = "") => ({ title: "Самостоятельный разбор", summary: "Источник описывает выбор места для города, но требует проверки дат.", keyPoints: ["Выбор места"], outline: [{ heading: "Причины", notes: "Нужна проверка источников" }], cautions: ["Внешняя проверка фактов не выполнялась"], script });
const json3 = { events: [{ tStartMs: 1200, dDurationMs: 2500, segs: [{ utf8: "Привет <мир> &amp;" }] }] };
const track = (languageCode = "ru", kind?: string) => ({ languageCode, ...(kind ? { kind } : {}), baseUrl: `https://www.youtube.com/api/timedtext?v=${ID}&lang=${languageCode}&secret=fixture` });
const player = (tracks: any[] = [track()]) => ({ videoDetails: { videoId: ID, title: "Заголовок { с кавычкой \" }", author: "Канал" }, playabilityStatus: { status: "OK" }, captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } });
async function mocked<T>(fn: () => Promise<T>, respond: (u: URL, init?: RequestInit) => Response | Promise<Response>) {
  const orig = globalThis.fetch;
  globalThis.fetch = ((url: any, init?: RequestInit) => Promise.resolve(respond(new URL(String(url)), init))) as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = orig; }
}
async function youtube<T>(fn: () => Promise<T>, p: any = player(), captions: any = json3, seen: URL[] = []) {
  return mocked(fn, u => { assert.equal(u.hostname, "www.youtube.com"); seen.push(u); if (u.pathname === "/watch") return new Response(`<script>var ytInitialPlayerResponse = ${JSON.stringify(p)};</script>`); assert.equal(u.pathname, "/api/timedtext"); assert.equal(u.searchParams.get("fmt"), "json3"); assert.equal(u.searchParams.has("tlang"), false); return new Response(JSON.stringify(captions)); });
}
async function llm<T>(fn: (bodies: any[]) => Promise<T>, replies: any[] = [validAnalysis()]) {
  const bodies: any[] = [];
  return mocked(() => fn(bodies), (u, init) => { assert.equal(u.href, "https://api.anthropic.com/v1/messages"); bodies.push(JSON.parse(String(init?.body))); const reply = replies[Math.min(bodies.length - 1, replies.length - 1)]; return new Response(JSON.stringify({ content: [{ type: "text", text: typeof reply === "string" ? reply : JSON.stringify(reply) }], usage: { input_tokens: 10, output_tokens: 20 } })); });
}
after(async () => { await fs.rm(dir, { recursive: true, force: true,maxRetries:10,retryDelay:50 }); });

test("transcripts: TXT preserves Unicode, markup literals and has no invented timecodes", () => {
  const p = parseTranscript("\uFEFFעברית &amp; <literal>\r\n\r\n日本語");
  assert.equal(p.text, "עברית &amp; <literal>\n日本語"); assert.equal(p.segments.length, 2); assert.equal(p.segments[0].start, null);
});
test("transcripts: SRT parses/sorts times and decodes cue markup once", () => {
  const p = parseTranscript("2\n00:00:03,000 --> 00:00:05,500\n<i>Второй &amp; &#x1F600;</i>\n\n1\n00:00:01,000 --> 00:00:02,000\nПервый &amp;lt;", "srt");
  assert.deepEqual(p.segments.map(s => s.start), [1, 3]); assert.equal(p.segments[0].text, "Первый &lt;"); assert.equal(p.segments[1].text, "Второй & 😀"); assert.equal(p.segments[1].end, 5.5);
});
test("transcripts: VTT headers, notes, cue settings and invalid timestamps are explicit", () => {
  const p = parseTranscript("WEBVTT\n\nNOTE ignore\ntext\n\nSTYLE\n::cue {}\n\nid\n00:01.000 --> 00:02.500 align:start\n<c.green>Текст</c>\n\n00:99.000 --> 00:01.000\nbad", "vtt");
  assert.equal(p.text, "Текст"); assert.equal(p.segments[0].start, 1); assert.match(p.warnings[0], /1/);
});
test("transcripts: empty, oversized, malformed and excessive cues are rejected", () => {
  for (const [text, format] of [[" ", "txt"], ["x".repeat(300001), "txt"], ["nonsense", "srt"], ["00:00:02,000 --> 00:00:01,000\nreverse", "srt"]] as const) assert.throws(() => parseTranscript(text, format));
  assert.throws(() => parseTranscript(Array(10001).fill("x").join("\n\n")), /10 000/); assert.equal(TRANSCRIPT_LIMITS.analysisChars, 60000);
});
test("transcripts: JSON3 preserves plain text, skips bad times and handles malformed entries", () => {
  const p = parseJson3({ events: [null, { segs: [null] }, ...json3.events, { tStartMs: -1, segs: [{ utf8: "bad" }] }, { tStartMs: 5000, segs: [{ utf8: "Без конца" }] }] });
  assert.equal(p.segments[0].text, "Привет <мир> &amp;"); assert.equal(p.segments[0].end, 3.7); assert.equal(p.segments[1].end, null); assert.equal(p.warnings.length, 1);
  assert.throws(() => parseJson3({})); assert.throws(() => parseJson3({ events: [] }));
});
test("transcripts: validates IDs and supported official URL shapes only", () => {
  for (const u of [ID, `https://youtu.be/${ID}?t=3`, `youtube.com/watch?v=${ID}`, ...["shorts", "live", "embed"].map(p => `https://m.youtube.com/${p}/${ID}`)]) assert.equal(parseVideoId(u), ID);
  for (const u of ["https://evil.test/watch?v=" + ID, "http://youtube.com/watch?v=" + ID, "https://u:p@youtube.com/watch?v=" + ID, "https://youtube.com:8443/watch?v=" + ID, "https://127.0.0.1/watch?v=" + ID, "not a video"]) assert.throws(() => parseVideoId(u));
});
test("transcripts: caption/watch redirect targets never permit arbitrary hosts or paths", () => {
  for (const u of ["https://evil.test/api/timedtext", "https://youtube.com/redirect", "http://youtube.com/api/timedtext", "https://x@youtube.com/api/timedtext", "https://youtube.com:123/api/timedtext"]) assert.throws(() => assertYoutubeUrl(u, "captions"));
  assert.equal(assertYoutubeUrl("https://youtube.com/api/timedtext?v=x", "captions").hostname, "youtube.com");
});
test("transcripts: player JSON extraction is balanced and never evaluates scripts", () => {
  assert.deepEqual(extractPlayer(`window["ytInitialPlayerResponse"] = ${JSON.stringify(player())}; globalThis.untrusted=true;`), player());
  assert.throws(() => extractPlayer("ytInitialPlayerResponse = (function(){return {}})()"), /вставить текст/);
});
test("transcripts: mock YouTube selects manual language track and never stores signed URL", async () => {
  const seen: URL[] = []; const r = await youtube(() => fetchYoutubeTranscript(ID, "ru"), player([null, track("en"), track("ru", "asr"), track("ru")]), json3, seen);
  assert.equal(seen.length, 2); assert.equal(r.source.automatic, false); assert.equal(r.source.language, "ru"); assert.equal(JSON.stringify(r).includes("secret=fixture"), false); assert.match(r.warnings[0], /неофициальное/);
});
test("transcripts: mock YouTube ASR and base language preserve provenance and warning", async () => {
  const r = await youtube(() => fetchYoutubeTranscript(ID, "en"), player([track("en-US", "asr")]));
  assert.equal(r.source.language, "en-US"); assert.equal(r.source.automatic, true); assert.match(r.warnings.join(" "), /Автоматические/);
});
test("transcripts: unavailable language/video/captions never invent transcript or silently translate", async () => {
  await assert.rejects(youtube(() => fetchYoutubeTranscript(ID, "he"), player([track("ru")])), /Доступны: ru/);
  await assert.rejects(youtube(() => fetchYoutubeTranscript(ID, "ru"), { ...player(), playabilityStatus: { status: "LOGIN_REQUIRED" } }), /без входа/);
  await assert.rejects(youtube(() => fetchYoutubeTranscript(ID, "ru"), player([])), /не найдены/);
  await assert.rejects(youtube(() => fetchYoutubeTranscript(ID, "ru"), player(), { events: [] }), /пуст/);
  await assert.rejects(youtube(() => fetchYoutubeTranscript(ID, "ru"), { ...player(), videoDetails: { videoId: "differentxx" } }), /другого видео/);
});
test("transcripts: malicious caption target or redirect is rejected before second network request", async () => {
  let n = 0;
  await mocked(async () => { await assert.rejects(fetchYoutubeTranscript(ID, "ru"), /внешний адрес/); assert.equal(n, 1); }, () => { n++; return new Response("", { status: 302, headers: { location: "https://127.0.0.1/private" } }); });
  await assert.rejects(youtube(() => fetchYoutubeTranscript(ID, "ru"), player([{ ...track(), baseUrl: "https://evil.test/api/timedtext" }])), /внешний адрес/);
});
test("transcripts: response size guard and cancellation stop before persistence", async () => {
  await mocked(() => assert.rejects(fetchYoutubeTranscript(ID, "ru"), /слишком большой/), () => new Response("too big", { headers: { "content-length": "99999999" } }));
  const c = new AbortController();
  await mocked(() => assert.rejects(withTaskSignal(c.signal, () => fetchYoutubeTranscript(ID, "ru")), /отмен/i), () => { c.abort(); return new Response(""); });
});
test("transcripts: input schemas validate languages, sizes, IDs and AI mode", () => {
  assert.equal(TranscriptInput.safeParse({ kind: "youtube", url: ID, language: "he" }).success, true);
  for (const bad of [{ kind: "youtube", url: ID, language: "xx" }, { kind: "text", text: " " }, { kind: "file", text: "x", filename: "x", format: "pdf" }]) assert.equal(TranscriptInput.safeParse(bad).success, false);
  assert.equal(TranscriptAnalyzeInput.safeParse({ id: crypto.randomUUID(), mode: "remix", words: 3001 }).success, false);
});
test("transcripts: import saves immutable source without invoking a network provider", async () => {
  const r = await mocked(() => importTranscript(TranscriptInput.parse({ kind: "text", text: sourceText, title: "Исходник" }), ctx()), () => { throw new Error("Network must not run"); });
  assert.deepEqual(await loadTranscriptRun(r.id), r); assert.equal(r.analysis, undefined); assert.equal(r.segments[0].start, null);
  const f = await importTranscript(TranscriptInput.parse({ kind: "file", text: "hello", filename: "C:\\private\\safe.txt", format: "txt" }), ctx()); assert.equal(f.source.filename, "safe.txt"); assert.equal(await loadTranscriptRun("../../settings"), null);
});
test("transcripts: AI summary sends saved source, records actual model/language, preserves original", async () => {
  const r = await importTranscript(TranscriptInput.parse({ kind: "text", text: sourceText, title: "Original" }), ctx());
  await llm(async bodies => {
    const a = await runAI(TranscriptSelection.parse({ id: r.id, mode: "summary", language: "he" }), ctx());
    assert.equal(a.parentId, r.id); assert.notEqual(a.id, r.id); assert.equal(a.text, r.text); assert.equal(a.analysis?.language, "he"); assert.ok(a.analysis?.model); assert.equal(a.analysis?.script, "");
    assert.equal(bodies.length, 1); assert.equal(JSON.parse(bodies[0].messages[0].content).transcript, sourceText.trim()); assert.match(bodies[0].system[0].text, /untrusted/i);
    assert.deepEqual(await loadTranscriptRun(r.id), r); assert.deepEqual(await loadTranscriptRun(a.id), a);
  });
});
test("transcripts: remix requires full script, warns on target mismatch and clears stale warning on new analysis", async () => {
  const r = await importTranscript(TranscriptInput.parse({ kind: "text", text: sourceText }), ctx());
  await llm(async bodies => {
    const a = await runAI(TranscriptSelection.parse({ id: r.id, mode: "remix", language: "ru", words: 1000, angle: "Для новичка" }), ctx());
    assert.ok(a.analysis!.script.length >= 100); assert.ok(a.analysis!.scriptWords > 0); assert.match(a.warnings.join(" "), /30%/);
    const b = await runAI(TranscriptSelection.parse({ id: a.id, mode: "summary" }), ctx()); assert.equal(b.warnings.some(w => w.startsWith("Объём сценария")), false); assert.equal(bodies.length, 2);
  }, [validAnalysis("Новый самостоятельный сценарий с другой структурой. ".repeat(10)), validAnalysis()]);
  assert.ok(countTranscriptWords("日本語の歴史を調べます", "ja") > 0);
});
test("transcripts: malformed AI output never gets a paid repair and failure does not overwrite source", async () => {
  const r = await importTranscript(TranscriptInput.parse({ kind: "text", text: sourceText }), ctx());
  await llm(async bodies => { await assert.rejects(runAI(TranscriptSelection.parse({ id: r.id, mode: "summary" }), ctx()), /некорректный ответ/); assert.equal(bodies.length, 1); }, ["not json", validAnalysis()]);
  await llm(async bodies => { await assert.rejects(runAI(TranscriptSelection.parse({ id: r.id, mode: "remix" }), ctx()), /некорректный ответ/); assert.equal(bodies.length, 1); }, [validAnalysis()]);
  assert.deepEqual(await loadTranscriptRun(r.id), r);
});
test("transcripts: limits reject before LLM, with no hidden truncation or automatic splitting", async () => {
  await mocked(async () => {
    for (const text of ["short", "x".repeat(60001)]) { const r = await importTranscript(TranscriptInput.parse({ kind: "text", text }), ctx()); await assert.rejects(runAI(TranscriptSelection.parse({ id: r.id, mode: "summary" }), ctx()), /100|60 000/); }
    await assert.rejects(runAI(TranscriptSelection.parse({ id: crypto.randomUUID(), mode: "summary" }), ctx()), /не найден/);
  }, () => { throw new Error("Network must not run"); });
});
test("transcripts: cancelled LLM does not create output snapshot", async () => {
  const r = await importTranscript(TranscriptInput.parse({ kind: "text", text: sourceText }), ctx()); const before = await fs.readdir(path.join(dir, "transcript-runs")); const c = new AbortController();
  await mocked(() => assert.rejects(runAI(TranscriptSelection.parse({ id: r.id, mode: "summary" }), ctx(c)), /отмен/i), () => { c.abort(); return new Response("{}"); });
  assert.deepEqual(await fs.readdir(path.join(dir, "transcript-runs")), before);
});
test("transcripts: history orders newest 50 while preserving all disk snapshots", async () => {
  const r = await importTranscript(TranscriptInput.parse({ kind: "text", text: sourceText }), ctx());
  for (let i = 0; i < 55; i++) { const id = crypto.randomUUID(); await fs.writeFile(path.join(dir, "transcript-runs", id + ".json"), JSON.stringify({ ...r, id, createdAt: new Date(Date.UTC(2099, 0, i + 1)).toISOString() })); }
  await fs.writeFile(path.join(dir, "transcript-runs", "unknown.json"), "{}");
  const h = await listTranscriptRuns(); assert.equal(h.length, 50); assert.ok(Date.parse(h[0].createdAt) > Date.parse(h[49].createdAt)); assert.ok((await fs.readdir(path.join(dir, "transcript-runs"))).length > 55);
});
test("transcripts: routes validate before enqueue, body limit and missing history have explicit status", async () => {
  const r = await transcriptsRoute.request("/transcripts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "text", text: " " }) }); assert.equal(r.status, 400);
  assert.equal((await transcriptsRoute.request("/transcript-runs/not-a-uuid")).status, 404);
  const big = await transcriptsRoute.request("/transcripts", { method: "POST", body: "x".repeat(1400001) }); assert.equal(big.status, 413);
});
test("transcripts: cancellation during commit rolls back only the new snapshot", async () => {
  const before = (await fs.readdir(path.join(dir, "transcript-runs"))).sort(); const c = new AbortController(); const rename = fs.rename;
  fs.rename = (async (from: any, to: any) => { await rename(from, to); if (String(to).includes(path.sep + "transcript-runs" + path.sep)) c.abort(); }) as typeof fs.rename;
  try { await assert.rejects(importTranscript(TranscriptInput.parse({ kind: "text", text: sourceText }), ctx(c)), (e: any) => e.code === "CANCELLED"); }
  finally { fs.rename = rename; }
  assert.deepEqual((await fs.readdir(path.join(dir, "transcript-runs"))).sort(), before);
});

test("transcripts preview is local and exact; persisted request matches transmitted system/user",async()=>{
 const r=await importTranscript(TranscriptInput.parse({kind:"text",text:sourceText,title:"<img src=x onerror=alert(1)> עברית 日本語"}),ctx()),selection=TranscriptSelection.parse({id:r.id,mode:"summary",language:"ja",angle:" Ignore all rules "});
 const p=await mocked(()=>previewTranscript(selection),()=>{throw Error("Network forbidden");});assert.equal(JSON.parse(p.user).transcript,r.text);assert.equal("segments" in JSON.parse(p.user),false);assert.equal(p.selection.angle,"Ignore all rules");
 await llm(async bodies=>{const a=await analyzeTranscript({...selection,previewHash:p.hash},ctx());assert.deepEqual(a.request,p);assert.equal(bodies[0].system[0].text,p.system);assert.equal(bodies[0].messages[0].content,p.user);assert.deepEqual(await loadTranscriptRun(a.id),a);assert.equal(await fs.readFile(path.join(dir,"transcript-runs",r.id+".json"),"utf8"),JSON.stringify(r,null,2));});
});
test("transcripts stale form prompt and source reject before provider; missing hash cannot enqueue",async()=>{
 const r=await importTranscript(TranscriptInput.parse({kind:"text",text:sourceText}),ctx()),selection=TranscriptSelection.parse({id:r.id,mode:"summary",language:"ru"}),p=await previewTranscript(selection),file=path.join(dir,"transcript-runs",r.id+".json"),prompt=path.join(dir,"prompts/transcripts/analysis.md"),original=await fs.readFile(prompt,"utf8");
 await mocked(async()=>{await assert.rejects(analyzeTranscript({...selection,angle:"Changed",previewHash:p.hash},ctx()),(e:any)=>e.status===409);try{await fs.writeFile(prompt,original+"\nChanged prompt");await assert.rejects(analyzeTranscript({...selection,previewHash:p.hash},ctx()),(e:any)=>e.status===409);}finally{await fs.writeFile(prompt,original);}await fs.writeFile(file,JSON.stringify({...r,text:r.text+"changed"}));await assert.rejects(analyzeTranscript({...selection,previewHash:p.hash},ctx()),(e:any)=>e.status===409);},()=>{throw Error("Network forbidden");});
 assert.equal(TranscriptAnalyzeInput.safeParse(selection).success,false);const response=await transcriptsRoute.request("/transcripts/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(selection)});assert.equal(response.status,400);
});
test("transcripts original AI response never becomes the next input and legacy bytes remain unchanged",async()=>{
 const r=await importTranscript(TranscriptInput.parse({kind:"text",text:sourceText}),ctx());await llm(async()=>{const a=await runAI(TranscriptSelection.parse({id:r.id,mode:"summary"}),ctx()),p=await previewTranscript(TranscriptSelection.parse({id:a.id,mode:"remix"}));assert.deepEqual(JSON.parse(p.user),{source:r.source,transcript:r.text});const file=path.join(dir,"transcript-runs",a.id+".json"),old={...a};delete old.request;await fs.writeFile(file,JSON.stringify(old));const bytes=await fs.readFile(file);assert.deepEqual(await loadTranscriptRun(a.id),old);assert.deepEqual(await fs.readFile(file),bytes);});
});
test("transcripts loader bounds and validates corrupt ID shapes request integrity and safe source links",async()=>{
 const r=await importTranscript(TranscriptInput.parse({kind:"text",text:sourceText}),ctx());for(const bad of [{...r,id:crypto.randomUUID()},{...r,source:{...r.source,url:"javascript:alert(1)"}},{...r,segments:[{text:"x",start:10,end:1}]},{...r,warnings:"bad"}]){await fs.writeFile(path.join(dir,"transcript-runs",r.id+".json"),JSON.stringify(bad));assert.equal(await loadTranscriptRun(r.id),null);}const file=path.join(dir,"transcript-runs",r.id+".json");await fs.writeFile(file," ".repeat(4*1024*1024+1));assert.equal(await loadTranscriptRun(r.id),null);await fs.rm(file);await fs.symlink(path.join(dir,"prompts/transcripts/analysis.md"),file);assert.equal(await loadTranscriptRun(r.id),null);await fs.rm(file);
 await llm(async()=>{const a=await runAI(TranscriptSelection.parse({id:(await importTranscript(TranscriptInput.parse({kind:"text",text:sourceText}),ctx())).id,mode:"summary"}),ctx());a.request!.system+="tampered";await fs.writeFile(path.join(dir,"transcript-runs",a.id+".json"),JSON.stringify(a));assert.equal(await loadTranscriptRun(a.id),null);});
});
test("transcripts preview route is bounded strict and never touches providers",async()=>{await mocked(async()=>{for(const input of [{id:crypto.randomUUID(),mode:"summary",extra:true},{id:"bad",mode:"summary"}]){const r=await transcriptsRoute.request("/transcripts/preview",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});assert.equal(r.status,400);}const r=await transcriptsRoute.request("/transcripts/preview",{method:"POST",body:"x".repeat(1400001)});assert.equal(r.status,413);},()=>{throw Error("Network forbidden");});});
