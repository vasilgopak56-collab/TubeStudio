import { z } from "zod";
import type { JobCtx } from "../lib/jobs.js";
import { generateJson, LANG_NAME } from "./llm.js";
import { readPrompt, STYLES } from "./prompts.js";
import { checkScript, sentences, spokenText, words, WPM, type CheckResult } from "./scriptCheck.js";
import { saveCheck } from "./checksStore.js";

export const RaterInput = z.object({ script: z.string().min(300, "Минимум 300 символов").max(60000, "Максимум 60 000 символов"), style: z.string().max(60).optional(), niche: z.string().max(500).optional(), language: z.string().default("ru"), projectId: z.string().optional() });
export type RaterInputT = z.infer<typeof RaterInput>;

const TRIG = ["open_loop", "twist", "question", "stakes", "reveal", "emotion", "pattern_interrupt", "cliffhanger"] as const;
export const GENIUS = [
  ["novelty", "Новизна", "the viewer learns something new or sees the familiar differently"],
  ["click", "Неизбежность клика", "the topic/promise creates a question impossible not to close (judge from the script's premise)"],
  ["confirm", "Подтверждение клика", "the first 15 seconds deliver the promise of the packaging"],
  ["question", "Центральный вопрос", "one central question, stated in one sentence, runs through the whole video"],
  ["density", "Плотность", "every paragraph does work: fact, stakes, or opens/closes a loop"],
  ["escalation", "Эскалация", "each act is sharper, more personal or more surprising than the previous"],
  ["honesty", "Честность", "no inventions, disputed points flagged, no deceptive clickbait"],
  ["signature", "Авторская форма", "a signature device that can't be copied by swapping the topic"],
  ["visual", "Визуальная мысль", "scenes explain rather than decorate; at least 5 memorable shots are implied"],
  ["finale", "Финал", "closes the main loop, leaves a thought and gives a reason to comment"],
] as const;
const GID = GENIUS.map((g) => g[0]) as unknown as [string, ...string[]];
const Llm = z.object({
  genius: z.array(z.object({ id: z.enum(GID), score: z.number().min(0).max(10), note: z.string().max(300).default("") })).max(10).default([]),
  score: z.number().min(0).max(100),
  summary: z.string().max(800),
  emotionalArc: z.array(z.string().max(40)).min(3).max(10),
  hook: z.object({ score: z.number().min(0).max(10), analysis: z.string().max(1200), rewrite: z.string().max(1200).optional() }),
  triggers: z.array(z.object({ quote: z.string().min(3).max(300), type: z.enum(TRIG), note: z.string().max(200) })).max(20),
  problems: z.array(z.object({ quote: z.string().min(3).max(300), reason: z.string().max(300), severity: z.number().int().min(1).max(3) })).max(12),
  improvements: z.array(z.object({ quote: z.string().min(3).max(1200), issue: z.string().max(300), rewrite: z.string().min(3).max(1500) })).min(2).max(8),
});

export type TimedQuote = { quote: string; pos: number; time: number; found: boolean };
export type RaterResult = {
  score: number; label: string; summary: string; emotionalArc: string[];
  hook: { score: number; analysis: string; rewrite?: string; text: string; warnings?: string[] };
  pace: { i: number; time: number; len: number }[]; avgSentence: number;
  triggers: (TimedQuote & { type: string; note: string })[];
  problems: (TimedQuote & { reason: string; severity: number })[];
  improvements: (TimedQuote & { issue: string; rewrite: string; warnings?: string[] })[];
  retention: { t: number; v: number }[]; minutes: number; analysis?: CheckResult;
  genius?: { items: { id: string; name: string; score: number; note: string }[]; avg: number; min: number; pass: boolean };
  model: string; script: string; language: string; projectId?: string;
};

const label = (s: number) => (s >= 90 ? "Отлично!" : s >= 75 ? "Хорошо" : s >= 60 ? "Средне" : "Слабо");
const norm = (s: string) => s.toLowerCase().replace(/[«»"“”„]/g, "").replace(/\s+/g, " ").trim();

/** Позиция цитаты в тексте → слово № → время по темпу */
function locate(script: string, quote: string, wpm: number): TimedQuote {
  const q = quote.trim().replace(/^["«]|["»]$/g, "").replace(/…$|\.\.\.$/, "");
  let i = script.indexOf(q);
  if (i < 0) i = script.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) { const head = norm(q).split(" ").slice(0, 6).join(" "); const flat = norm(script); const j = flat.indexOf(head); if (j >= 0) i = Math.round((j / flat.length) * script.length); }
  const pos = i >= 0 ? words(script.slice(0, i)) : -1;
  return { quote: i >= 0 ? script.slice(i, i + q.length) : q, pos, time: pos >= 0 ? +((pos / wpm) * 60).toFixed(0) : -1, found: i >= 0 };
}

/** Прогноз удержания (§8.5): модель-оценка, шаг 15 с */
function retention(minutes: number, hook: number, triggers: { time: number }[], problems: { time: number; severity: number }[]) {
  const total = Math.max(60, minutes * 60), pts: { t: number; v: number }[] = [{ t: 0, v: 100 }];
  const loss30 = 45 - (Math.max(0, Math.min(10, hook)) / 10) * 30; // 45% → 15%
  let v = 100;
  for (let t = 15; t <= total + 0.1; t += 15) {
    if (t <= 30) v = 100 - loss30 * (t / 30);
    else {
      v -= (v * 0.012) * (15 / 60) * (t < total * 0.5 ? 1.2 : 0.8); // лёгкий спад
      for (const p of problems) if (p.time > t - 15 && p.time <= t) v -= 3 + (p.severity - 1) * 2.5;
      for (const g of triggers) if (g.time > t - 15 && g.time <= t) v += 2 + Math.min(2, (v < 50 ? 2 : 1));
      if (t > total * 0.93) v -= 2.5; // финальный CTA-спад
    }
    v = Math.max(5, Math.min(100 - loss30 * 0.6, v));
    pts.push({ t: Math.min(t, total), v: +v.toFixed(1) });
  }
  return pts;
}

/** Conservative review hints, not a fact checker. Never silently change the suggestion. */
export function suggestionWarnings(original: string, rewrite: string): string[] {
  const warnings: string[] = [];
  const nums = (s: string) => [...s.matchAll(/\d+(?:[.,:]\d+)*/g)].map(m => m[0]).sort().join("|");
  if (nums(original) !== nums(rewrite)) warnings.push("В замене меняются числа. Сверьте значения с источником перед применением.");
  if (/(?:^|[^\p{L}])(?:год[\p{L}]*|лет|век[\p{L}]*|столет[\p{L}]*|тысячелет[\p{L}]*|years?|centur[\p{L}]*|millenni[\p{L}]*|BCE|BC|AD)(?=$|[^\p{L}])/iu.test(original + " " + rewrite)) warnings.push("Правка затрагивает дату или исторический период. Проверьте хронологию: перефразирование может изменить век.");
  return warnings;
}

/** Format context is derived from measured word count, not from a model's guess. */
export function raterFormatContext(totalWords: number, language: string) {
  const wpm = WPM[language] ?? 140, minutes = totalWords / wpm;
  return minutes <= 2
    ? `SHORT-FORM narration: ${totalWords} words at ${wpm} words/minute is approximately ${minutes.toFixed(1)} minutes. This is a complete short video, not a fragment of a long documentary. Do not penalize word count alone or call it too short merely for having about one minute of narration. Judge a clear promise, one compact explanation and a satisfying closing thought. No mandatory multiple acts, repeated re-hooks, five shots or subscribe/comment CTA. Suggestions must fit the existing duration, preferably replace rather than add words. Actual spoken duration is unknown until audio is measured. A low score is allowed for specific substantive problems, not for being short. Do not infer vertical format or YouTube Shorts from duration alone.`
    : `LONG-FORM narration: ${totalWords} words, approximately ${minutes.toFixed(1)} minutes at ${wpm} words/minute. Evaluate sustained structure, pacing and payoffs in proportion to this duration. Actual spoken duration requires measured audio.`;
}

export async function runRater(input: RaterInputT, ctx: JobCtx): Promise<RaterResult> {
  const lang = input.language in LANG_NAME ? input.language : "en", L = LANG_NAME[lang], wpm = WPM[lang] ?? 140;
  const script = spokenText(input.script, { headings: false }).trim();
  const total = words(script), minutes = total / wpm;
  ctx.progress("Темп и структура", 10);
  const lens = sentences(script).map(words);
  let acc = 0; const pace = lens.map((len, i) => { const p = { i, time: +((acc / wpm) * 60).toFixed(0), len }; acc += len; return p; });
  const hookWords = Math.round(wpm / 4); // ≈ 15 секунд
  const hookText = script.split(/\s+/).slice(0, hookWords).join(" ");
  const style = input.style ? STYLES.find((s) => s.id === input.style) : undefined;
  const guide = style ? (await readPrompt(`script/${style.id}.md`).catch(() => "")).slice(0, 6000) : "";

  ctx.progress("Оцениваем сценарий", 30);
  const system = `You are a top YouTube script doctor and retention analyst. You evaluate narration scripts for watch-time: hook strength (first 15 seconds), open loops, pacing, stakes, payoffs, re-hooks, emotional arc, clarity, ending.
Be strict and specific; scores: 90+ only for exceptional scripts. Quote EXACT substrings copied verbatim from the script (no ellipsis) for triggers, problems and improvements.
- triggers: retention moments (open loop, twist, question, stakes, reveal, emotion, pattern interrupt, cliffhanger), up to 15.
- problems: places where a viewer is likely to leave, with reason; severity 1–3.
- improvements: 3–6 concrete fixes; "quote" = the exact original fragment (1–3 sentences) to replace, "rewrite" = the improved fragment in ${L} that drops in place.
- genius: the "genius test" (YT-Genius quality gates), each 0–10 with a short Russian note: ${GENIUS.map((g, i) => `${i + 1}) ${g[0]} — ${minutes <= 2 && g[0] === "visual" ? "a few clear visual ideas that explain the short narration; no minimum shot count" : minutes <= 2 && g[0] === "escalation" ? "one compact development from question to answer, no mandatory multi-act escalation" : minutes <= 2 && g[0] === "finale" ? "a satisfying closing thought; no mandatory CTA or comment prompt" : g[2]}`).join("; ")}. Publish threshold: average ≥ 8 and none below 6 — be strict.
- emotionalArc: 4–8 short Russian state names in order, e.g. "Интрига", "Напряжение", "Шок", "Облегчение".
${raterFormatContext(total, lang)}
For every rewrite, preserve factual content, qualifications, dates and numbers. Do not change a year to a century or add unsupported superiority claims (e.g. "ahead by millennia"). If you cannot improve style without changing facts, leave the factual wording intact.
No independent fact verification has been performed: flag doubtful claims for checking, never certify historical accuracy from the script alone.
Write summary, analysis, reasons, issues, notes in Russian; rewrites in ${L}.${guide ? `\n\nNiche/style guide the script should follow:\n${guide}` : ""}${input.niche ? `\nChannel niche: ${input.niche}` : ""}`;
  const { data: d, model } = await generateJson({ system, user: `Script length: ${total} words ≈ ${minutes.toFixed(1)} min. First 15 seconds ≈ "${hookText}"\n\nSCRIPT:\n${script.slice(0, 50000)}\n\nReturn JSON {"score","summary","emotionalArc":[...],"hook":{"score":0-10,"analysis","rewrite"},"triggers":[{"quote","type":"${TRIG.join("|")}","note"}],"problems":[{"quote","reason","severity"}],"improvements":[{"quote","issue","rewrite"}],"genius":[{"id":"${GID.join("|")}","score":0-10,"note"}]}`, maxTokens: 9000, temperature: 0.4 }, Llm);

  ctx.progress("Строим прогноз удержания", 85);
  const triggers = d.triggers.map((t) => ({ ...locate(script, t.quote, wpm), type: t.type, note: t.note })).filter((t) => t.found).sort((a, b) => a.time - b.time);
  const problems = d.problems.map((p) => ({ ...locate(script, p.quote, wpm), reason: p.reason, severity: p.severity })).sort((a, b) => a.time - b.time);
  const improvements = d.improvements.map((x) => ({ ...locate(input.script, x.quote, wpm), issue: x.issue, rewrite: x.rewrite, warnings: suggestionWarnings(x.quote, x.rewrite) }));
  const r: RaterResult = {
    score: Math.round(d.score), label: label(d.score), summary: d.summary, emotionalArc: d.emotionalArc,
    hook: { ...d.hook, text: hookText, warnings: d.hook.rewrite ? suggestionWarnings(hookText, d.hook.rewrite) : [] }, pace, avgSentence: +(total / Math.max(1, lens.length)).toFixed(1),
    triggers, problems, improvements,
    retention: retention(minutes, d.hook.score, triggers, problems.filter((p) => p.found)), minutes: +minutes.toFixed(1),
    analysis: style ? checkScript(input.script, { language: lang, cta: minutes > 2 }) : undefined,
    model, script: input.script, language: lang,
  };
  if (d.genius.length) {
    const items = GENIUS.map(([id, name]) => { const g = d.genius.find((x) => x.id === id); return g ? { id, name, score: +g.score.toFixed(1), note: g.note } : null; }).filter((x): x is NonNullable<typeof x> => !!x);
    const avg = +(items.reduce((a, x) => a + x.score, 0) / Math.max(1, items.length)).toFixed(1), min = Math.min(...items.map((x) => x.score));
    r.genius = { items, avg, min, pass: avg >= 8 && min >= 6 };
  }
  if (input.projectId) r.projectId = await saveCheck(input.projectId, "Оценка сценария", `Оценка сценария: ${r.score}/100`, { ...r, script: undefined });
  return r;
}
