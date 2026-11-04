import { z } from "zod";
import type { JobCtx } from "../lib/jobs.js";
import { generateJson } from "./llm.js";
import { saveCheck } from "./checksStore.js";

export const PackagingInput = z.object({
  title: z.string().min(3).max(100),
  about: z.string().max(3000).optional(),
  image: z.object({ mime: z.enum(["image/jpeg", "image/png", "image/webp"]), b64: z.string().min(100).max(6_000_000, "Изображение больше ~4 МБ") }),
  local: z.object({ brightness: z.number(), contrast: z.number(), colorfulness: z.number(), width: z.number(), height: z.number() }).optional(),
  projectId: z.string().optional(),
});
export type PackagingInputT = z.infer<typeof PackagingInput>;

const Llm = z.object({
  viralScore: z.number().min(0).max(100),
  synergy: z.object({ score: z.number().min(0).max(10), text: z.string().max(800) }),
  thumbnailText: z.string().max(200),
  textHeightPct: z.number().min(0).max(100),
  textAreaPct: z.number().min(0).max(100),
  focalPoint: z.string().max(200),
  strengths: z.array(z.string().max(300)).min(1).max(6),
  improvements: z.array(z.string().max(300)).min(1).max(8),
  steps: z.array(z.string().max(300)).min(2).max(8),
});
export type PackagingResult = z.infer<typeof Llm> & {
  checks: { level: "ok" | "warn" | "error"; text: string }[];
  textPxSmall: number; duplicateRatio: number; local?: PackagingInputT["local"]; model: string; title: string; projectId?: string;
};

const toks = (s: string) => new Set((s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []));

export async function runPackaging(input: PackagingInputT, ctx: JobCtx): Promise<PackagingResult> {
  ctx.progress("Смотрим обложку и заголовок", 20);
  const system = `You are "Viral Alchemist" — a YouTube packaging expert (title + thumbnail CTR). Evaluate the thumbnail image together with the title as one package: curiosity gap, clarity at small size, emotion/face, contrast, focal point, text (≤ 4 words is ideal), title–thumbnail synergy (they must complement, not repeat each other).
Return: viralScore 0–100 (strict: 85+ only for top packages), synergy (0–10 + explanation), thumbnailText = exact text visible on the thumbnail ("" if none), textHeightPct = height of the LARGEST text line as % of image height (0 if none), textAreaPct = % of image area covered by text, focalPoint = what the eye sees first, strengths, improvements, steps (ordered action plan). Write all texts in Russian.`;
  const user = `TITLE: ${input.title}\n${input.about ? `ABOUT THE VIDEO: ${input.about}\n` : ""}${input.local ? `Measured locally: brightness ${input.local.brightness.toFixed(0)}/255, RMS contrast ${input.local.contrast.toFixed(0)}, colorfulness ${input.local.colorfulness.toFixed(0)}, size ${input.local.width}×${input.local.height}.\n` : ""}Return JSON {"viralScore","synergy":{"score","text"},"thumbnailText","textHeightPct","textAreaPct","focalPoint","strengths":[],"improvements":[],"steps":[]}`;
  const { data: d, model } = await generateJson({ system, user, images: [input.image], maxTokens: 4000, temperature: 0.3 }, Llm);
  ctx.progress("Локальные проверки", 90);

  const checks: PackagingResult["checks"] = [];
  const l = input.local;
  if (l) {
    checks.push(l.width >= 1280 && Math.abs(l.width / l.height - 16 / 9) < 0.02 ? { level: "ok", text: `Размер ${l.width}×${l.height} (16:9)` } : { level: "warn", text: `Размер ${l.width}×${l.height} — YouTube рекомендует 1280×720 (16:9)` });
    checks.push(l.contrast >= 55 ? { level: "ok", text: `Контраст хороший (${l.contrast.toFixed(0)})` } : l.contrast >= 40 ? { level: "warn", text: `Контраст средний (${l.contrast.toFixed(0)}) — на превью может «потеряться»` } : { level: "error", text: `Низкий контраст (${l.contrast.toFixed(0)})` });
    checks.push(l.brightness < 45 ? { level: "warn", text: `Слишком тёмная (яркость ${l.brightness.toFixed(0)}/255)` } : l.brightness > 215 ? { level: "warn", text: `Слишком светлая (яркость ${l.brightness.toFixed(0)}/255)` } : { level: "ok", text: `Яркость в норме (${l.brightness.toFixed(0)}/255)` });
    checks.push(l.colorfulness >= 35 ? { level: "ok", text: `Насыщенность цвета: ${l.colorfulness.toFixed(0)}` } : { level: "warn", text: `Блёклые цвета (${l.colorfulness.toFixed(0)}) — в ленте выделяются насыщенные обложки` });
  }
  const textPxSmall = +((d.textHeightPct / 100) * 94).toFixed(1);
  if (d.thumbnailText.trim()) {
    const nw = d.thumbnailText.trim().split(/\s+/).length;
    checks.push(textPxSmall >= 12 ? { level: "ok", text: `Текст читается на превью 168×94 (≈${textPxSmall}px)` } : textPxSmall >= 8 ? { level: "warn", text: `Текст мелковат на превью 168×94 (≈${textPxSmall}px)` } : { level: "error", text: `Текст не читается на превью 168×94 (≈${textPxSmall}px)` });
    checks.push(nw <= 4 ? { level: "ok", text: `Слов на обложке: ${nw}` } : { level: "warn", text: `Слов на обложке: ${nw} — лучше ≤ 4` });
    checks.push(d.textAreaPct <= 35 ? { level: "ok", text: `Текст занимает ${d.textAreaPct.toFixed(0)}% площади` } : { level: "warn", text: `Текст занимает ${d.textAreaPct.toFixed(0)}% площади — перегруз` });
  } else checks.push({ level: "ok", text: "На обложке нет текста — читаемость не проверяется" });
  const a = toks(d.thumbnailText), b = toks(input.title); const inter = [...a].filter((x) => b.has(x)).length;
  const duplicateRatio = a.size ? +(inter / a.size).toFixed(2) : 0;
  checks.push(duplicateRatio >= 0.5 ? { level: "warn", text: `Текст обложки дублирует заголовок (${Math.round(duplicateRatio * 100)}% слов) — они должны дополнять друг друга` } : { level: "ok", text: "Текст обложки не дублирует заголовок" });

  const r: PackagingResult = { ...d, viralScore: Math.round(d.viralScore), checks, textPxSmall, duplicateRatio, local: input.local, model, title: input.title };
  if (input.projectId) r.projectId = await saveCheck(input.projectId, "Упаковка", `Упаковка: ${r.viralScore}/100`, r);
  return r;
}
