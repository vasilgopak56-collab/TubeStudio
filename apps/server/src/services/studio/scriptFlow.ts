// Сценарий канала (Выпуск 1): донор → план → черновик → автопроверка кодом →
// критик другой семьи моделей → правка автором → повторная проверка.
// Черновик пишет существующий конвейер runScript (ресёрч, план по актам, объём, живой голос);
// здесь — профиль канала, разбор донора, проверка, критик и правка. Всё сохраняется в проект.
import { z } from "zod";
import { ApiError, rethrowFinancial } from "../../lib/errors.js";
import { rethrowCancelled } from "../../lib/taskContext.js";
import type { JobCtx } from "../../lib/jobs.js";
import { log } from "../../lib/logging.js";
import { assertChannelBudget, getChannel, type Channel } from "./channels.js";
import { lintScript, DEFAULT_WPM, type LintReport } from "./scriptLint.js";

export const StudioScriptInput = z.object({
  channelId: z.string().uuid(),
  projectId: z.string().trim().max(80).optional(),
  topic: z.string().trim().min(3, "Укажите тему").max(1000),
  /** «Ваша версия» из Радара или свой угол. */
  angle: z.string().trim().max(2000).default(""),
  /** Ролик-донор: берём структуру и приёмы, не текст. */
  donorUrl: z.string().trim().max(500).default(""),
  minutes: z.number().min(1).max(120).optional(),
  research: z.boolean().default(true),
  critic: z.boolean().default(true),
  notes: z.string().trim().max(8000).default(""),
}).strict();
export type StudioScriptInputT = z.infer<typeof StudioScriptInput>;

/** Семья модели по её названию: критик должен быть из другой семьи, чем автор. */
export function modelFamily(model: string): "claude" | "gpt" | "gemini" | "other" {
  const m = model.toLowerCase();
  if (/claude|^cc\/|anthropic|opus|sonnet|haiku/.test(m)) return "claude";
  if (/gpt|^cx\/|openai|\bo[134]\b|^o[134]-/.test(m)) return "gpt";
  if (/gemini|^ag\/|google/.test(m)) return "gemini";
  return "other";
}
/** Критик по умолчанию: GPT для автора-Claude, Claude для остальных. */
export function pickCritic(author: string, s: { textAlt: string; text: string; script: string }) {
  const fam = modelFamily(author);
  const candidates = [s.textAlt, s.text, s.script, "cx/gpt-5.6-terra", "cc/claude-sonnet-5"].filter(Boolean);
  return candidates.find((m) => modelFamily(m) !== fam && modelFamily(m) !== "other") ?? (fam === "claude" ? "cx/gpt-5.6-terra" : "cc/claude-sonnet-5");
}

const Donor = z.object({
  hook: z.string().max(600), structure: z.array(z.string().max(300)).min(2).max(12), devices: z.array(z.string().max(300)).max(10),
  pacing: z.string().max(400), ending: z.string().max(400), avoid: z.array(z.string().max(300)).max(8),
});
export type DonorBrief = z.infer<typeof Donor> & { url: string; title: string; channel: string; words: number; model?: string };

const QUESTIONS = [
  "Новизна: зритель узнает новое или посмотрит иначе?",
  "Неизбежность клика: тема создаёт вопрос, который нельзя не закрыть?",
  "Подтверждение клика: первые 15 секунд выполняют обещание?",
  "Центральный вопрос: одной фразой и через всё видео?",
  "Плотность: каждый абзац работает?",
  "Эскалация: каждый акт острее, личнее или удивительнее?",
  "Честность: нет выдумок, спорное помечено, нет обманного кликбейта?",
  "Авторская форма: есть фирменный приём?",
  "Визуальная мысль: кадры объясняют, а не иллюстрируют настроение?",
  "Финал: закрывает главную петлю, оставляет мысль и повод для комментария?",
] as const;
const Critique = z.object({
  scores: z.array(z.object({ q: z.number().int().min(1).max(10), score: z.number().min(0).max(10), note: z.string().max(300).default("") })).min(8).max(10),
  problems: z.array(z.object({ paragraph: z.number().int().min(0).max(500), problem: z.string().min(3).max(500), before: z.string().max(600).default(""), after: z.string().max(900).default("") })).max(6),
});
export type CriticReport = { model: string; family: string; sameFamily: boolean; scores: { q: number; question: string; score: number; note: string }[]; average: number; min: number; passed: boolean; problems: z.infer<typeof Critique>["problems"] };
const summarize = (d: z.infer<typeof Critique>, model: string, authorFamily: string): CriticReport => {
  const scores = d.scores.map((x) => ({ ...x, question: QUESTIONS[x.q - 1] }));
  const values = scores.map((x) => x.score);
  const average = Math.round((values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)) * 10) / 10;
  const min = Math.min(...values);
  return { model, family: modelFamily(model), sameFamily: modelFamily(model) === authorFamily, scores, average, min, passed: average >= 8 && min >= 6, problems: d.problems };
};
const numbered = (text: string) => text.split(/\n\s*\n+/).map((p, i) => `[${i + 1}] ${p.trim()}`).join("\n\n");
const lintBrief = (r: LintReport) => r.issues.filter((i) => i.severity !== "info").slice(0, 12).map((i) => `- (${i.severity}) ${i.title}${i.items?.length ? ` — абзацы ${[...new Set(i.items.map((x) => x.paragraph))].slice(0, 6).join(", ")}` : ""}. ${i.advice}`).join("\n") || "- нет";

export type StudioScriptResult = {
  projectId: string; artifactId: string; title: string; script: string; draft: string;
  lint: LintReport; lintDraft: LintReport; critic: CriticReport | null; criticAfter: CriticReport | null;
  donor: DonorBrief | null; revised: boolean; notes: string[]; models: { author: string; critic: string | null };
};

export async function runStudioScript(raw: StudioScriptInputT, ctx: JobCtx): Promise<StudioScriptResult> {
  const input = StudioScriptInput.parse(raw);
  const ch = await getChannel(input.channelId);
  await assertChannelBudget(ch.id);
  const { getSettings } = await import("../settings.js");
  const { generateJson, generateText } = await import("../llm.js");
  const s = await getSettings();
  const lang = ch.language.slice(0, 2);
  const wpm = (DEFAULT_WPM as Record<string, number>)[lang] ?? 140;
  const minutes = input.minutes ?? ch.lengthMin;
  const words = Math.max(150, Math.round(minutes * wpm));
  const notes: string[] = [];
  const author = ch.models.author || s.anymodel.script;

  // 1. Донор: структура и приёмы ролика-образца (текст не копируется).
  let donor: DonorBrief | null = null;
  if (input.donorUrl) {
    ctx.progress("Разбираю ролик-донор: структура и приёмы", 3);
    try {
      const { fetchYoutubeTranscript } = await import("../youtubeCaptions.js");
      const t = await fetchYoutubeTranscript(input.donorUrl, lang);
      const text = t.text.slice(0, 60_000);
      const r = await generateJson({
        fast: true, maxTokens: 2500, temperature: 0.3,
        system: "You analyse the STRUCTURE of a successful YouTube narration so another channel can make an original video. Describe functions, not content: what each part does for the viewer, which devices hold attention, the pacing and the ending. Never quote or retell the plot. Answer in Russian.",
        user: `Video: «${t.source.title}» (${t.source.channel})\nTranscript (may be auto-generated):\n"""\n${text}\n"""\n\nReturn {"hook":"how the first 15 seconds hook (technique)","structure":["part 1 — its function", "…"],"devices":["attention devices"],"pacing":"…","ending":"how it ends","avoid":["what not to copy"]}`,
      }, Donor);
      donor = { ...r.data, url: input.donorUrl, title: t.source.title, channel: t.source.channel, words: text.split(/\s+/).length, model: r.model };
      ctx.partial({ donor });
    } catch (e) {
      rethrowCancelled(e); rethrowFinancial(e);
      notes.push(`Донор не разобран: ${(e as Error).message.slice(0, 200)}. Сценарий написан без него.`);
    }
  }

  // 2–3. План и черновик — существующий конвейер (ресёрч, акты, объём, живой голос).
  const { runScript, ScriptInput } = await import("../script.js");
  const profile = [
    ch.niche && `Channel niche: ${ch.niche}`, ch.audience && `Audience: ${ch.audience}`, ch.format && `Format: ${ch.format}`,
    ch.skills && `Channel rules (follow them):\n${ch.skills.slice(0, 6000)}`,
    input.angle && `Our angle: ${input.angle}`,
    donor && `DONOR STRUCTURE (reuse techniques and functions only — never its wording, plot, names or examples):\nHook: ${donor.hook}\nParts:\n${donor.structure.map((x) => `- ${x}`).join("\n")}\nDevices: ${donor.devices.join("; ")}\nPacing: ${donor.pacing}\nEnding: ${donor.ending}\nAvoid: ${donor.avoid.join("; ")}`,
    input.notes && `Author notes:\n${input.notes}`,
  ].filter(Boolean).join("\n\n");
  const draft = await runScript(ScriptInput.parse({
    topic: input.topic, language: lang, unit: "words", value: words, style: "universal",
    customStyle: ch.style ? ch.style.slice(0, 3000) : undefined, notes: profile.slice(0, 20000) || undefined,
    research: input.research, humanize: true, cta: true, projectId: input.projectId, model: ch.models.author || undefined,
  }), {
    ...ctx,
    progress: (stage, pct) => ctx.progress(stage, 5 + Math.round(pct * 0.6)),
  });
  const authorModel = draft.model || author;
  const authorFamily = modelFamily(authorModel);

  // 4. Автопроверка кодом.
  ctx.progress("Проверяю сценарий: хук, вступление, оговорки, повторы, финал", 67);
  const lintDraft = lintScript(draft.script, { language: lang, targetMinutes: minutes, wpm });
  ctx.partial({ lintDraft });

  // 5. Критик другой семьи.
  let critic: CriticReport | null = null;
  const criticModel = input.critic ? (ch.models.critic || pickCritic(authorModel, s.anymodel)) : null;
  const askCritic = async (text: string, report: LintReport, scoresOnly: boolean) => {
    const r = await generateJson({
      model: criticModel!, maxTokens: scoresOnly ? 1500 : 4000, temperature: 0.3,
      system: `You are a bored, experienced YouTube showrunner reviewing a narration script in ${lang === "ru" ? "Russian" : lang === "en" ? "English" : lang}. Do not praise. Find where the viewer leaves and fix it. Score each of the 10 questions 0–10 (pass: average ≥ 8 and none below 6). ${scoresOnly ? "Return scores only, problems: []." : "Then give up to 5 main problems with a concrete rewrite: quote the paragraph number [n], the exact sentence to replace (before) and your replacement (after) in the script language. Never invent facts."} Notes and problems in Russian.`,
      user: `Questions:\n${QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nCode checks already found:\n${lintBrief(report)}\n\nChannel: ${ch.name}${ch.niche ? ` — ${ch.niche}` : ""}. Topic: ${input.topic}${input.angle ? `\nAngle: ${input.angle}` : ""}\n\nSCRIPT (paragraphs numbered):\n${numbered(text).slice(0, 60_000)}\n\nReturn {"scores":[{"q":1,"score":7,"note":"…"},…10 items],"problems":[{"paragraph":3,"problem":"…","before":"…","after":"…"}]}`,
    }, Critique);
    return summarize(r.data, r.model, authorFamily);
  };
  if (criticModel) {
    ctx.progress(`Критик (${criticModel}) читает сценарий`, 72);
    try {
      await assertChannelBudget(ch.id);
      critic = await askCritic(draft.script, lintDraft, false);
      if (critic.sameFamily) notes.push(`Критик ${critic.model} из той же семьи, что и автор: модель другой семьи недоступна. Оценку стоит перепроверить.`);
      ctx.partial({ critic });
    } catch (e) {
      rethrowCancelled(e); rethrowFinancial(e);
      notes.push(`Критик не ответил: ${(e as Error).message.slice(0, 200)}. Правка сделана только по автопроверке.`);
      log.warn({ event: "studio_critic_failed", error: (e as Error).message.slice(0, 300) });
    }
  }

  // 6. Правка автором: только найденные места, длина ±5%, без новых фактов.
  let script = draft.script, revised = false, lint = lintDraft;
  const needsFix = lintDraft.errors > 0 || lintDraft.warnings > 0 || (critic && (!critic.passed || critic.problems.length > 0));
  if (needsFix) {
    ctx.progress("Автор правит найденные места", 80);
    try {
      await assertChannelBudget(ch.id);
      const fixes = critic?.problems.map((p) => `- [${p.paragraph}] ${p.problem}${p.before ? `\n  before: «${p.before}»` : ""}${p.after ? `\n  after: «${p.after}»` : ""}`).join("\n") || "- нет";
      const r = await generateText({
        role: "script", model: ch.models.author || undefined, maxTokens: Math.min(30000, words * 6 + 4000), temperature: 0.5,
        system: `You are the author of this narration script. Revise it in the same language. Fix exactly the listed problems; keep everything else, all facts and the paragraph structure. Do not add new facts, numbers or quotes. Length within ±5% of ${words} words. One ending, one call-to-action, a question to the viewer at the end. Output only the full revised narration inside <script></script> — no notes, no headings, no brackets.`,
        user: `Problems found by code checks:\n${lintBrief(lintDraft)}\n\nProblems found by the critic:\n${fixes}\n\nSCRIPT:\n<script>\n${draft.script}\n</script>`,
      });
      const { sanitize } = await import("../scriptCheck.js");
      const text = sanitize(r.text.match(/<script>([\s\S]*?)(?:<\/script>|$)/i)?.[1] ?? r.text, { visualCues: false }).trim();
      const after = lintScript(text, { language: lang, targetMinutes: minutes, wpm });
      const lenOk = Math.abs(after.words - words) / words <= 0.15;
      if (lenOk && (after.errors < lintDraft.errors || (after.errors === lintDraft.errors && after.warnings <= lintDraft.warnings))) { script = text; lint = after; revised = true; }
      else notes.push(`Правка не принята: ${!lenOk ? `длина ${after.words} слов вместо ${words}` : `ошибок стало ${after.errors} (было ${lintDraft.errors})`}. Оставлен черновик — его можно поправить вручную по отчёту.`);
    } catch (e) {
      rethrowCancelled(e); rethrowFinancial(e);
      notes.push(`Правка не удалась: ${(e as Error).message.slice(0, 200)}. Оставлен черновик.`);
    }
  }

  // 7. Повторная оценка критиком (только баллы).
  let criticAfter: CriticReport | null = null;
  if (critic && revised) {
    ctx.progress("Критик оценивает правку", 92);
    try { await assertChannelBudget(ch.id); criticAfter = await askCritic(script, lint, true); }
    catch (e) { rethrowCancelled(e); rethrowFinancial(e); notes.push(`Повторная оценка критика не получена: ${(e as Error).message.slice(0, 160)}.`); }
  }

  // 8. Сохраняем: сценарий проекта получает отчёт, черновик и правку.
  ctx.progress("Сохраняю в проект", 97);
  const { updateArtifactData, updateProject } = await import("../projects.js");
  await updateProject(draft.projectId, { channelId: ch.id }).catch(() => undefined);
  const studio = { channelId: ch.id, minutes, words, lint, lintDraft, critic, criticAfter, donor, revised, notes, draft: revised ? draft.script : undefined, models: { author: authorModel, critic: critic?.model ?? null }, at: new Date().toISOString() };
  await updateArtifactData(draft.projectId, draft.artifactId, (d: Record<string, unknown>) => ({ ...d, script, studio }));
  return { projectId: draft.projectId, artifactId: draft.artifactId, title: draft.title, script, draft: draft.script, lint, lintDraft, critic, criticAfter, donor, revised, notes, models: studio.models };
}

/** Проверка без ИИ — для кнопки «Проверить» и вставленного текста. */
export function lintForChannel(text: string, ch: Pick<Channel, "language" | "lengthMin">, minutes?: number) {
  if (!text.trim()) throw new ApiError("VALIDATION", "Вставьте текст сценария", 400);
  return lintScript(text, { language: ch.language, targetMinutes: minutes ?? ch.lengthMin });
}
