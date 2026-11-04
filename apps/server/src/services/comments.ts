import { rethrowCancelled } from "../lib/taskContext.js";
/**
 * Анализ комментариев: что зрители просят, хвалят, ругают, о чём спрашивают → темы и подсказки для сценария.
 * Квота: 1 ед. за 100 комментариев (+1–3 ед. на поиск видео канала).
 */
import crypto from "node:crypto";
import { z } from "zod";
import type { JobCtx } from "../lib/jobs.js";
import { readJson, writeJson } from "../lib/storage.js";
import { ApiError } from "../lib/errors.js";
import { generateJson, LANG_NAME } from "./llm.js";
import { getSettings } from "./settings.js";
import { getComments, getVideos, latestUploads, parseChannelInput, resolveChannel, type Video, type YtComment } from "./youtube.js";

export const CommentsInput = z.object({
  input: z.string().min(3).max(300),
  perVideo: z.number().int().min(20).max(500).optional(),
  videos: z.number().int().min(1).max(10).optional(),
  focus: z.string().max(300).optional(),
  language: z.string().max(5).optional(),
});
export type CommentsInputT = z.infer<typeof CommentsInput>;

const Item = z.preprocess((x: any) => (x && typeof x === "object" && !x.text ? { ...x, text: x.point ?? x.theme ?? x.topic ?? x.title ?? x.item ?? x.description ?? "" } : typeof x === "string" ? { text: x } : x),
  z.object({ text: z.string().min(1).max(300), share: z.coerce.number().min(0).max(100).catch(0).default(0), quotes: z.array(z.string().max(300)).max(5).catch([]).default([]).transform((q) => q.slice(0, 3)) }));
const Llm = z.object({
  summary: z.string().max(1200),
  audience: z.string().max(600),
  sentiment: z.object({ positive: z.number().min(0).max(100), neutral: z.number().min(0).max(100), negative: z.number().min(0).max(100) }),
  requests: z.array(Item).max(10).default([]),
  praise: z.array(Item).max(8).default([]),
  complaints: z.array(Item).max(8).default([]),
  questions: z.array(z.object({ question: z.string().max(300), answerIdea: z.string().max(400) })).max(10).default([]),
  objections: z.array(z.object({ claim: z.string().max(300), howToHandle: z.string().max(400) })).max(8).default([]),
  ideas: z.array(z.object({ title: z.string().max(140), angle: z.string().max(400), why: z.string().max(400) })).min(1).max(8),
  scriptTips: z.array(z.string().max(300)).max(8).default([]),
  bestQuotes: z.array(z.string().max(300)).max(6).default([]),
});
export type CommentsRun = z.infer<typeof Llm> & {
  id: string; createdAt: string; input: CommentsInputT; model: string;
  videos: { id: string; title: string; channelTitle: string; thumbnail?: string; views: number; comments: number; fetched: number; error?: string }[];
  stats: { total: number; questionsPct: number; avgLikes: number; topLiked: YtComment[] };
  units: number;
};

const isQuestion = (t: string) => /\?|^(how|why|what|when|where|who|can|could|is|are|do|does|как|почему|зачем|когда|где|кто|что|можно|а если)\b/i.test(t.trim());

export async function runComments(input: CommentsInputT, ctx: JobCtx): Promise<CommentsRun> {
  const st = await getSettings(); const C = st.research.comments;
  const per = input.perVideo ?? C.perVideo;
  const lang = input.language || st.contentLanguage;
  let units = 0;
  ctx.progress("Определяю видео", 5);
  let p: ReturnType<typeof parseChannelInput> | null = null;
  const raw = input.input.trim();
  if (/^[\w-]{11}$/.test(raw) && !raw.startsWith("@")) p = { kind: "video", value: raw };
  else p = parseChannelInput(raw);
  let videos: Video[];
  if (p.kind === "video") { videos = await getVideos([p.value]); units += 1; if (!videos.length) throw new ApiError("YT_NOT_FOUND", "Видео не найдено", 404); }
  else {
    const ch = await resolveChannel(raw); units += 1;
    const up = await latestUploads(ch.uploadsPlaylistId, 20); units += 2;
    const n = input.videos ?? C.channelVideos;
    videos = up.filter((v) => v.comments > 0).sort((a, b) => b.comments - a.comments).slice(0, n);
    if (!videos.length) throw new ApiError("VALIDATION", "У последних видео канала нет комментариев", 400);
  }
  const all: YtComment[] = []; const vout: CommentsRun["videos"] = [];
  for (const [i, v] of videos.entries()) {
    ctx.progress(`Комментарии: ${v.title.slice(0, 50)}`, 10 + Math.round((i / videos.length) * 50));
    if (ctx.signal.aborted) throw new Error("cancelled");
    try {
      const cm = await getComments(v.id, per, C.order); units += Math.max(1, Math.ceil(cm.length / 100));
      all.push(...cm);
      vout.push({ id: v.id, title: v.title, channelTitle: v.channelTitle, thumbnail: v.thumbnail, views: v.views, comments: v.comments, fetched: cm.length });
    } catch (e) { rethrowCancelled(e); vout.push({ id: v.id, title: v.title, channelTitle: v.channelTitle, thumbnail: v.thumbnail, views: v.views, comments: v.comments, fetched: 0, error: (e as Error).message }); }
  }
  if (!all.length) throw new ApiError("VALIDATION", vout[0]?.error ?? "Комментарии не найдены", 400);
  // в LLM — самые залайканные + свежий срез, в пределах ~45 тыс. символов
  const sorted = [...all].sort((a, b) => b.likes - a.likes);
  const pack: string[] = []; let len = 0;
  for (const c of sorted) { const t = c.text.replace(/\s+/g, " ").trim(); if (t.length < 3) continue; const line = `[${c.likes}👍${c.replies ? ` ${c.replies}↩` : ""}] ${t}`; if (len + line.length > 45000) break; pack.push(line); len += line.length; }
  ctx.progress("Разбираю комментарии (ИИ)", 70);
  const L = LANG_NAME[lang] ?? "Russian";
  const { data, model } = await generateJson({
    system: `You analyse YouTube comments for a creator who wants to make better videos in this niche. Comments are prefixed with [likes👍 replies↩] — weight by likes. Extract: summary; who the audience is; sentiment split (percent, sums to 100); requests (what viewers explicitly want next / missing content); praise (what they love — keep doing); complaints (what annoys them: length, ads, errors, voice, clickbait…); questions viewers ask + how our video could answer; objections/myths/disagreements + how to address them in a script; 3–8 video ideas for OUR channel born from this demand (ready title <=70 chars, angle, why — cite the evidence); scriptTips (concrete things to include or avoid in our script); bestQuotes (verbatim short comments that capture the mood). For each request/praise/complaint give share = approx percent of comments mentioning it, and up to 3 verbatim quotes (in the original language). Never invent facts not supported by comments. ${input.focus ? `Pay special attention to: ${input.focus}.` : ""} Write analysis text in ${L}. Return ONLY JSON of exactly this shape:
{"summary":"","audience":"","sentiment":{"positive":0,"neutral":0,"negative":0},"requests":[{"text":"","share":0,"quotes":[""]}],"praise":[{"text":"","share":0,"quotes":[]}],"complaints":[{"text":"","share":0,"quotes":[]}],"questions":[{"question":"","answerIdea":""}],"objections":[{"claim":"","howToHandle":""}],"ideas":[{"title":"","angle":"","why":""}],"scriptTips":[""],"bestQuotes":[""]}`,
    user: `Videos: ${vout.map((v) => `«${v.title}» (${v.channelTitle}, ${v.views} views)`).join("; ")}\nComments (${pack.length} of ${all.length}):\n${pack.join("\n")}`,
    maxTokens: 6000, temperature: 0.4,
  }, Llm);
  const run: CommentsRun = {
    ...data, id: crypto.randomUUID().slice(0, 8), createdAt: new Date().toISOString(), input, model, videos: vout, units,
    stats: { total: all.length, questionsPct: Math.round((all.filter((c) => isQuestion(c.text)).length / all.length) * 100), avgLikes: +(all.reduce((s, c) => s + c.likes, 0) / all.length).toFixed(1), topLiked: sorted.slice(0, 10) },
  };
  await writeJson(`comment-runs/${run.id}.json`, run);
  const idx = await listCommentRuns();
  idx.unshift({ id: run.id, createdAt: run.createdAt, title: vout.length === 1 ? vout[0].title : `${vout[0].channelTitle}: ${vout.length} видео`, total: all.length });
  await writeJson("comment-runs/index.json", idx.slice(0, 50));
  ctx.progress("Готово", 100);
  return run;
}
export const listCommentRuns = () => readJson<{ id: string; createdAt: string; title: string; total: number }[]>("comment-runs/index.json", []);
export const loadCommentRun = (id: string) => readJson<CommentsRun | null>(`comment-runs/${id.replace(/[^\w-]/g, "")}.json`, null);
