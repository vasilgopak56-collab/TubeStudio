import { isFinancialError } from "../lib/errors.js";
/**
 * Shorts из длинного видео: LLM выбирает 3–5 самодостаточных фрагментов сценария и переписывает их в вертикальный формат
 * (хук за 1–2 с, 30–55 с ≈ 75–130 слов, текст на экране, CTA на основное видео, цитата-источник).
 * По желанию: озвучка каждого Short и вертикальный видео-черновик (обложки/карточки).
 */
import { z } from "zod";
import type { JobCtx } from "../lib/jobs.js";
import { ApiError } from "../lib/errors.js";
import { generateJson } from "./llm.js";
import { addArtifact, getProject, updateArtifactData } from "./projects.js";
import { getSettings } from "./settings.js";

export const ShortsInput = z.object({
  projectId: z.string().min(1),
  scriptArtifactId: z.string().optional(),
  script: z.string().max(80000).optional(),
  count: z.number().int().min(1).max(5).default(3),
  language: z.string().max(5).optional(),
  voice: z.boolean().default(false),
  video: z.boolean().default(false),
  model: z.string().max(160).optional(),
});
export type ShortsInputT = z.input<typeof ShortsInput>;
const Short = z.object({
  title: z.string().min(3).max(120), hook: z.string().min(3).max(300), script: z.string().min(80).max(1500),
  onScreen: z.array(z.string().max(80)).max(8).default([]), cta: z.string().max(200).default(""),
  quote: z.string().max(600).default(""), why: z.string().max(400).default(""), hashtags: z.array(z.string().max(40)).max(6).default([]),
});
export type ShortItem = z.infer<typeof Short> & { words: number; seconds: number; audioUrl?: string; audioArtifactId?: string; videoUrl?: string; error?: string };
export type ShortsResult = { shorts: ShortItem[]; model: string; projectId: string; artifactId?: string; sourceTitle: string };

const wc = (s: string) => s.split(/\s+/).filter(Boolean).length;

export async function runShorts(raw: ShortsInputT, ctx: JobCtx): Promise<ShortsResult> {
  const i = ShortsInput.parse(raw);
  const p = await getProject(i.projectId);
  const art = i.scriptArtifactId ? p.artifacts.find((a) => a.id === i.scriptArtifactId) : [...p.artifacts].reverse().find((a) => a.kind === "script");
  const script = i.script || ((art?.data as any)?.script as string | undefined);
  if (!script || wc(script) < 150) throw new ApiError("VALIDATION", "Нужен сценарий длинного видео (от 150 слов) — сначала напишите его в проекте", 400);
  const lang = i.language || (await getSettings()).contentLanguage;
  ctx.progress("Ищем самые сильные фрагменты", 10);
  const { data, model } = await generateJson({
    system: "You are a YouTube Shorts producer. You cut long-form scripts into standalone vertical Shorts that hook in the first 1–2 seconds, deliver one complete idea, and drive viewers to the full video. Write in a natural spoken voice: no clichés, no AI filler, short sentences.",
    user: `Language of all text fields: ${lang}.
From the long-form script below pick the ${i.count} strongest SELF-CONTAINED moments (surprising fact, conflict, twist, strong claim, practical tip). Different moments, no overlap.
For each write:
- "title": Shorts title ≤ 60 chars, curiosity-driven, no clickbait lies
- "hook": the first spoken sentence (≤ 15 words) that stops the scroll
- "script": the full spoken text INCLUDING the hook at the start, 75–130 words (30–55 s), one idea, ends with the CTA
- "onScreen": 2–5 short on-screen captions (≤ 6 words each)
- "cta": one short line inviting to watch the full video (e.g. «Полная история — в видео на канале»)
- "quote": the exact sentence(s) from the source script this Short is based on
- "why": why this moment works as a Short (1 sentence)
- "hashtags": 3 hashtags incl. #shorts

SCRIPT («${p.title}»):
${script.slice(0, 30000)}

Return JSON {"shorts":[{"title","hook","script","onScreen":[],"cta","quote","why","hashtags":[]}]}`,
    maxTokens: 6000, temperature: 0.7,
  }, z.object({ shorts: z.array(Short).min(1).max(6) }));
  const shorts: ShortItem[] = data.shorts.slice(0, i.count).map((s) => { const w = wc(s.script); return { ...s, words: w, seconds: Math.round((w / 150) * 60) }; });
  ctx.partial({ shorts });
  const a = await addArtifact(p.id, { kind: "shorts", title: `Shorts · ${shorts.length} шт. · ${p.title}`.slice(0, 300), data: { shorts, model, sourceArtifactId: art?.id } });
  const res: ShortsResult = { shorts, model, projectId: p.id, artifactId: a.id, sourceTitle: p.title };

  if (i.voice || i.video) {
    const { runTts } = await import("./tts.js");
    for (const [k, s] of shorts.entries()) {
      ctx.signal.throwIfAborted();
      try {
        ctx.progress(`Short ${k + 1}: озвучка`, 30 + Math.round((k / shorts.length) * 65));
        const t = await runTts({ text: s.script, model: i.model, title: `Short · ${s.title}`, projectId: p.id, headings: false, actNames: [], speed: 1, pitch: 0 } as any, { ...ctx, progress: () => {} });
        Object.assign(s, { audioUrl: t.url, audioArtifactId: t.artifactId });
        if (i.video) {
          ctx.progress(`Short ${k + 1}: вертикальное видео`, 30 + Math.round(((k + 0.5) / shorts.length) * 65));
          const { runDraft } = await import("./draft.js");
          const d = await runDraft({ projectId: p.id, audioArtifactId: t.artifactId, images: 0, vertical: true, subtitles: true }, { ...ctx, progress: () => {} });
          s.videoUrl = d.url;
        }
      } catch (e) { if (ctx.signal.aborted) throw e; s.error = (e as Error).message.slice(0, 300); if (isFinancialError(e)) { await updateArtifactData(p.id, a.id, d => ({ ...d, shorts })); ctx.partial({ shorts }); throw e; } }
      ctx.partial({ shorts });
    }
    await updateArtifactData(p.id, a.id, (d) => ({ ...d, shorts }));
  }
  ctx.progress("Готово", 100);
  return res;
}
