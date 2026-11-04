import { z } from "zod";
import type { JobCtx } from "../lib/jobs.js";
import { generateJson, LANG_NAME } from "./llm.js";
import { findMarkers, heuristics, type Metric } from "./aiHeuristics.js";
import { saveCheck } from "./checksStore.js";
import { voiceReport } from "./humanVoice.js";

export const DetectorInput = z.object({ text: z.string().min(100, "Минимум 100 символов").max(50000, "Максимум 50 000 символов"), language: z.string().default("ru"), projectId: z.string().optional() });
export type DetectorInputT = z.infer<typeof DetectorInput>;

const Llm = z.object({
  humanScore: z.number().min(0).max(100),
  why: z.string().max(1500),
  patterns: z.array(z.object({ category: z.string().max(80), example: z.string().max(300), count: z.number().int().min(1) })).max(12),
  fragments: z.array(z.object({ quote: z.string().min(3).max(400), category: z.string().max(80), replacements: z.array(z.string().max(500)).min(1).max(2) })).max(30),
  tips: z.array(z.string().max(300)).min(3).max(8),
});

export type Highlight = { start: number; end: number; quote: string; category: string; replacements: string[]; source: "llm" | "dictionary" };
export type DetectorResult = {
  humanPct: number; verdict: "human" | "mixed" | "ai"; heuristicPct: number; llmPct: number;
  why: string; metrics: Metric[]; patterns: { category: string; example: string; count: number }[];
  highlights: Highlight[]; tips: string[]; voice?: { score: number; counts: { rule: string; name: string; count: number }[] }; words: number; chars: number; model: string; text: string; language: string; projectId?: string;
};

const SYSTEM = (L: string) => `You are an expert editor who detects AI-generated text (ChatGPT/Claude/Gemini style) in ${L} narration and articles, and rewrites it to sound like a real human author.
Judge: predictability, generic phrasing, AI-marker vocabulary, symmetrical structure, "rule of three", over-used dashes, hedging, empty transitions, moralising conclusions, lack of concrete personal detail.
Return humanScore 0–100 (100 = certainly human). In "fragments" quote EXACT substrings copied verbatim from the text (5–25 words each, no ellipsis) that look AI-written, each with 2 human-sounding replacements in ${L} that keep the meaning and fit grammatically in place. Up to 20 fragments, most suspicious first. "patterns": categories of AI patterns with one example and how many times it occurs. "tips": 5–7 concrete tips for THIS text. Write "why", categories and tips in Russian; replacements in ${L}.`;

export async function runDetector(input: DetectorInputT, ctx: JobCtx): Promise<DetectorResult> {
  const lang = input.language in LANG_NAME ? input.language : "en";
  ctx.progress("Считаем метрики", 10);
  const h = heuristics(input.text, lang);
  ctx.progress("LLM-анализ стиля", 30);
  const dict = [...new Set(h.markers.map((m) => m.phrase.toLowerCase()))].slice(0, 30);
  const { data: d, model } = await generateJson({ system: SYSTEM(LANG_NAME[lang]), user: `Dictionary markers already found: ${dict.join("; ") || "none"}.\nHeuristic human-likeness: ${(h.score * 100).toFixed(0)}%.\n\nTEXT:\n${input.text.slice(0, 30000)}\n\nReturn JSON {"humanScore","why","patterns":[{"category","example","count"}],"fragments":[{"quote","category","replacements":[a,b]}],"tips":[...]}`, maxTokens: 8000, temperature: 0.4 }, Llm);
  ctx.progress("Собираем отчёт", 90);

  // подсветка: фрагменты LLM (только найденные дословно) + словарные маркеры
  const hl: Highlight[] = [];
  const overlaps = (s: number, e: number) => hl.some((x) => s < x.end && e > x.start);
  for (const f of d.fragments) {
    const q = f.quote.trim().replace(/^["«]|["»]$/g, ""); let i = input.text.indexOf(q);
    if (i < 0) i = input.text.toLowerCase().indexOf(q.toLowerCase());
    if (i >= 0 && !overlaps(i, i + q.length)) hl.push({ start: i, end: i + q.length, quote: input.text.slice(i, i + q.length), category: f.category, replacements: f.replacements, source: "llm" });
  }
  for (const m of findMarkers(input.text, lang)) if (!overlaps(m.index, m.index + m.length)) hl.push({ start: m.index, end: m.index + m.length, quote: m.phrase, category: "AI-маркер из словаря", replacements: [], source: "dictionary" });
  hl.sort((a, b) => a.start - b.start);

  const heuristicPct = Math.round(h.score * 100), llmPct = Math.round(d.humanScore);
  const humanPct = Math.round(0.4 * heuristicPct + 0.6 * llmPct);
  const r: DetectorResult = { humanPct, verdict: humanPct >= 65 ? "human" : humanPct >= 40 ? "mixed" : "ai", heuristicPct, llmPct, why: d.why, metrics: h.metrics, patterns: d.patterns, highlights: hl, tips: d.tips, voice: (() => { const v = voiceReport(input.text, lang); return { score: v.score, counts: v.counts.filter((c) => c.strength > 0).map(({ rule, name, count }) => ({ rule, name, count })) }; })(), words: h.words, chars: input.text.length, model, text: input.text, language: lang };
  if (input.projectId) r.projectId = await saveCheck(input.projectId, "AI-детектор", `AI-детектор: человечность ${humanPct}%`, r);
  return r;
}
