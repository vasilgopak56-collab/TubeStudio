import { rethrowFinancial } from "../lib/errors.js";
import { checkCancelled, rethrowCancelled, taskSignal } from "../lib/taskContext.js";
import { log } from "../lib/logging.js";
// «Живой голос»: отдельная проверка + правка сценария по методу Humanizer (найти признаки → черновик → сверка фактов → чистовик)
import { z } from "zod";
import type { JobCtx } from "../lib/jobs.js";
import { ApiError } from "../lib/errors.js";
import { generateJson, LANG_NAME } from "./llm.js";
import { fill, loadSplitPrompt } from "./prompts.js";
import { words } from "./scriptCheck.js";
import { diffFacts, markersOf, RULES, THRESHOLD, voiceReport, type FactDiff, type Hit, type VoiceReport } from "./humanVoice.js";
import { activeVoicePrompt } from "./channelVoice.js";
import { saveCheck } from "./checksStore.js";

export const HumanizerInput = z.object({
  text: z.string().min(100, "Минимум 100 символов").max(60000, "Максимум 60 000 символов"),
  language: z.string().default("ru"),
  title: z.string().max(300).optional(),
  authorSample: z.string().max(6000).optional(),
  maxPasses: z.number().int().min(1).max(3).default(2),
  maxDelta: z.number().int().min(5).max(25).default(15),
  force: z.boolean().default(false),
  channelVoice: z.boolean().default(true),
  projectId: z.string().optional(),
});
export type HumanizerInputT = z.infer<typeof HumanizerInput>;

export type Edit = { before: string; rules: string[]; after: string };
export type SceneResult = {
  i: number; before: string; after: string; status: "clean" | "edited" | "rejected";
  reason?: string; scoreBefore: number; scoreAfter: number; hitsBefore: Hit[]; hitsAfter: Hit[];
  edits: Edit[]; kept: { quote: string; why: string }[]; facts: FactDiff | null; factsToCheck: string[]; wordsBefore: number; wordsAfter: number;
};
export type HumanizerResult = {
  before: VoiceReport; after: VoiceReport; scenes: SceneResult[]; text: string; original: string; report: string;
  factsToCheck: string[]; passes: number; threshold: number; model: string; language: string; title?: string; projectId?: string;
  score: number; label: string; summary: string;
};

const Llm = z.object({
  scenes: z.array(z.object({
    id: z.coerce.number().int(), text: z.string(),
    edits: z.array(z.object({ before: z.string().max(1500), rules: z.array(z.string().max(8)).default([]), after: z.string().max(1500) })).max(20).default([]),
    kept: z.array(z.object({ quote: z.string().max(400), why: z.string().max(300) })).max(10).default([]),
    facts_to_check: z.array(z.string().max(400)).max(10).default([]),
  })),
});

/** Сцены: по меткам [[SCENE n]] или абзацам, сгруппированным по 120–280 слов */
export function splitScenes(text: string): string[] {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (/\[\[SCENE \d+\]\]/i.test(t)) return t.split(/(?=\[\[SCENE \d+\]\])/i).map((s) => s.trim()).filter(Boolean);
  const paras = t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = []; let cur: string[] = [], n = 0;
  for (const p of paras) {
    const w = words(p);
    if (cur.length && n + w > 280) { out.push(cur.join("\n\n")); cur = []; n = 0; }
    cur.push(p); n += w;
    if (n >= 120) { out.push(cur.join("\n\n")); cur = []; n = 0; }
  }
  if (cur.length) { if (out.length && n < 60) out[out.length - 1] += "\n\n" + cur.join("\n\n"); else out.push(cur.join("\n\n")); }
  return out;
}

const needsWork = (r: VoiceReport, force: boolean) => force || r.score < THRESHOLD || r.strong > 0;
const label = (s: number) => (s >= THRESHOLD ? "Звучит как человек" : s >= 65 ? "Есть следы ИИ" : "Много признаков ИИ");

/** Проверка правки сцены: длина, метки, цитаты, факты, оценка. Возвращает причину отказа или null */
function validate(before: string, after: string, lang: string, maxDelta: number): { reason: string | null; facts: FactDiff } {
  const facts = diffFacts(before, after);
  const wb = words(before), wa = words(after);
  if (!after.trim()) return { reason: "пустой ответ", facts };
  if (Math.abs(wa - wb) / Math.max(1, wb) > (maxDelta + 2) / 100) return { reason: `длина изменилась на ${Math.round(((wa - wb) / Math.max(1, wb)) * 100)}% (лимит ±${maxDelta}%)`, facts };
  if (markersOf(before).join("|") !== markersOf(after).join("|")) return { reason: "сдвинуты или потеряны служебные метки", facts };
  // цитата сохранена, если её текст есть в новой версии (короткие «термины» — по основам слов, падеж мог измениться)
  const low = after.toLowerCase().replace(/ё/g, "е");
  const keptQuote = (q: string) => { const n = q.toLowerCase().replace(/ё/g, "е"); if (low.includes(n)) return true; const ws = n.match(/[\p{L}\p{N}]+/gu) ?? []; return ws.length <= 4 && ws.every((w) => low.includes(w.slice(0, Math.max(3, w.length - 2)))); };
  const lostQ = facts.lostQuotes.filter((q) => !keptQuote(q));
  if (lostQ.length) return { reason: `изменена цитата «${lostQ[0].slice(0, 60)}»`, facts };
  if (facts.addedQuotes.some((q) => !before.toLowerCase().includes(q.toLowerCase()))) return { reason: "добавлена новая цитата", facts };
  if (facts.addedNumbers.length) return { reason: `добавлены числа, которых не было: ${facts.addedNumbers.join(", ")}`, facts };
  const sb = voiceReport(before, lang).score, sa = voiceReport(after, lang).score;
  if (sa < sb) return { reason: `оценка ухудшилась (${sb} → ${sa})`, facts };
  return { reason: null, facts };
}

export type HumanizeOpts = { language: string; title?: string; authorSample?: string; channelVoice?: boolean; maxPasses: number; maxDelta: number; force: boolean; signal?: AbortSignal; progress?: (stage: string, pct: number) => void };

/** Ядро: правит сцены, возвращает результаты по сценам. Используется страницей «Живой голос» и Сценаристом */
export async function humanizeScenes(scenes: string[], o: HumanizeOpts): Promise<{ scenes: SceneResult[]; model: string; passes: number }> {
  const lang = o.language, L = LANG_NAME[lang] ?? lang;
  const tpl = await loadSplitPrompt("humanizer/rewrite.md");
  const passport = !o.authorSample?.trim() && o.channelVoice !== false ? await activeVoicePrompt(lang) : "";
  const system = fill(tpl.system, { LANGUAGE: L, MAX_DELTA: o.maxDelta, AUTHOR_VOICE: o.authorSample?.trim() ? `\nAUTHOR VOICE SAMPLE (match its sentence length, vocabulary, punctuation, openers and transitions; the sample beats the dash rule):\n"""\n${o.authorSample.trim().slice(0, 5000)}\n"""` : passport ? `\n${passport}\n(The passport beats the dash rule.)` : "" });
  const res: SceneResult[] = scenes.map((s, i) => {
    const r = voiceReport(s, lang, i === 0 ? o.title : undefined);
    return { i, before: s, after: s, status: "clean", scoreBefore: r.score, scoreAfter: r.score, hitsBefore: r.hits, hitsAfter: r.hits, edits: [], kept: [], facts: null, factsToCheck: [], wordsBefore: r.words, wordsAfter: r.words };
  });
  let model = "", passes = 0;
  const rejected = new Map<number, string>();
  for (let pass = 0; pass < o.maxPasses; pass++) {
    const todo = res.filter((s) => needsWork(voiceReport(s.after, lang, s.i === 0 ? o.title : undefined), o.force && pass === 0) && (pass === 0 || s.status !== "clean" || rejected.has(s.i)));
    if (!todo.length) break;
    passes++;
    // пачки до ~1400 слов
    const batches: SceneResult[][] = []; let cur: SceneResult[] = [], n = 0;
    for (const s of todo) { if (cur.length && n + s.wordsAfter > 1400) { batches.push(cur); cur = []; n = 0; } cur.push(s); n += s.wordsAfter; }
    if (cur.length) batches.push(cur);
    for (let b = 0; b < batches.length; b++) {
      checkCancelled(taskSignal(o.signal));
      o.progress?.(`Проход ${pass + 1}: правим сцены ${batches[b].map((s) => s.i + 1).join(", ")}`, 15 + Math.round(((pass * batches.length + b) / (o.maxPasses * batches.length)) * 75));
      const payload = batches[b].map((s) => {
        const hits = voiceReport(s.after, lang, s.i === 0 ? o.title : undefined).hits.filter((h) => h.strength > 0).slice(0, 25);
        const rej = rejected.get(s.i);
        return `### SCENE id=${s.i} (${words(s.after)} words; keep ${Math.round(words(s.after) * (1 - o.maxDelta / 100))}–${Math.round(words(s.after) * (1 + o.maxDelta / 100))})\nFINDINGS: ${hits.length ? hits.map((h) => `${h.rule}: «${h.quote.slice(0, 160)}»`).join("; ") : "none by the detector — check by ear"}${rej ? `\nPREVIOUS EDIT WAS REJECTED: ${rej}. Fix that.` : ""}\nTEXT:\n${s.after}`;
      }).join("\n\n");
      let data: z.infer<typeof Llm>;
      try { const r = await generateJson({ system, user: fill(tpl.user, { SCENES: payload }), maxTokens: Math.min(30000, batches[b].reduce((a, s) => a + s.wordsAfter, 0) * 8 + 3000), temperature: 0.5 }, Llm); data = r.data; model = r.model; }
      catch (e) { rethrowCancelled(e); rethrowFinancial(e); log.warn({ event: "humanizer_batch_failed", pass: pass + 1, batch: b + 1, errorType: (e as Error).name }); if (pass === 0 && b === 0 && !res.some((s) => s.status === "edited")) throw e; continue; }
      for (const out of data.scenes) {
        const s = res.find((x) => x.i === out.id && batches[b].includes(x)); if (!s) continue;
        const after = out.text.trim();
        if (after === s.after.trim()) { log.warn(`[humanizer] сцена ${s.i + 1}: модель вернула текст без изменений`); s.kept.push(...out.kept); s.factsToCheck.push(...out.facts_to_check); continue; }
        const v = validate(s.after, after, lang, o.maxDelta);
        if (v.reason) { log.warn({ event: "humanizer_scene_rejected", scene: s.i + 1 }); rejected.set(s.i, v.reason); if (s.status === "clean") { s.status = "rejected"; s.reason = v.reason; } continue; }
        rejected.delete(s.i);
        s.after = after; s.status = "edited"; s.reason = undefined;
        s.edits.push(...out.edits.filter((e) => e.before.trim() && e.before.trim() !== e.after.trim()));
        s.kept.push(...out.kept); s.factsToCheck.push(...out.facts_to_check);
        s.facts = diffFacts(s.before, s.after);
      }
    }
  }
  for (const s of res) {
    const r = voiceReport(s.after, lang, s.i === 0 ? o.title : undefined);
    s.scoreAfter = r.score; s.hitsAfter = r.hits; s.wordsAfter = r.words;
    if (s.status === "rejected" && rejected.has(s.i)) s.reason = rejected.get(s.i);
    s.factsToCheck = [...new Set(s.factsToCheck)];
    s.kept = s.kept.filter((k, j, a) => a.findIndex((x) => x.quote === k.quote) === j);
  }
  return { scenes: res, model, passes };
}

const ruleName = new Map(RULES.map((r) => [r.id, r.name]));
export function formatReport(r: Pick<HumanizerResult, "before" | "after" | "scenes" | "factsToCheck" | "threshold">): string {
  const a = r.after, lines = [
    `ОЦЕНКА: ${r.before.score} → ${a.score}/100 (порог ${r.threshold}) · слов ${r.before.words} → ${a.words} · предложений ${a.sentences} · средняя длина ${a.avgSentence}`,
    `НАЙДЕНО: ${r.before.counts.filter((c) => c.strength > 0).map((c) => `${c.rule} ×${c.count}`).join(" · ") || "—"}`,
    `ОСТАЛОСЬ: ${a.counts.filter((c) => c.strength > 0).map((c) => `${c.rule} ×${c.count}`).join(" · ") || "—"}`,
  ];
  for (const s of r.scenes) for (const e of s.edits) lines.push(`СЦЕНА ${s.i + 1}: «${e.before}» → ${e.rules.join(", ") || "—"} → «${e.after}»`);
  for (const s of r.scenes) if (s.status === "rejected") lines.push(`СЦЕНА ${s.i + 1}: правка отклонена — ${s.reason}`);
  const changed = r.scenes.filter((s) => s.facts && (s.facts.lostNumbers.length || s.facts.lostNames.length || s.facts.addedNames.length));
  lines.push(`ФАКТЫ: ${changed.length ? "изменено: " + changed.map((s) => `сцена ${s.i + 1} (${[s.facts!.lostNumbers.length ? `пропали числа ${s.facts!.lostNumbers.join(", ")}` : "", s.facts!.lostNames.length ? "пропали имена" : "", s.facts!.addedNames.length ? "новые имена" : ""].filter(Boolean).join("; ")})`).join("; ") + " — проверить" : "без изменений"}`);
  if (r.factsToCheck.length) lines.push(`[FACT-CHECK]: ${r.factsToCheck.join(" · ")}`);
  const kept = r.scenes.flatMap((s) => s.kept);
  lines.push(`ОСТАВЛЕНО НАМЕРЕННО: ${kept.length ? kept.map((k) => `«${k.quote}» (${k.why})`).join("; ") : "—"}`);
  return lines.join("\n");
}

export async function runHumanizer(input: HumanizerInputT, ctx: JobCtx): Promise<HumanizerResult> {
  const lang = input.language in LANG_NAME ? input.language : "en";
  ctx.progress("Ищем признаки ИИ (§1–§26, T1–T11)", 5);
  const original = input.text.replace(/\r\n/g, "\n").trim();
  const scenes = splitScenes(original);
  const before = voiceReport(original, lang, input.title);
  ctx.partial({ before, scenes: scenes.length });
  const h = await humanizeScenes(scenes, { language: lang, title: input.title, authorSample: input.authorSample, channelVoice: input.channelVoice, maxPasses: input.maxPasses, maxDelta: input.maxDelta, force: input.force, signal: ctx.signal, progress: ctx.progress });
  ctx.progress("Сверяем факты и считаем итог", 95);
  const text = h.scenes.map((s) => s.after).join("\n\n");
  const after = voiceReport(text, lang, input.title);
  const factsToCheck = [...new Set(h.scenes.flatMap((s) => s.factsToCheck))];
  const base = { before, after, scenes: h.scenes, factsToCheck, threshold: THRESHOLD };
  const edited = h.scenes.filter((s) => s.status === "edited").length;
  const r: HumanizerResult = { ...base, text, original, report: formatReport(base), passes: h.passes, model: h.model, language: lang, title: input.title,
    score: after.score, label: label(after.score), summary: `Живой голос ${before.score} → ${after.score}/100, правок в ${edited} из ${h.scenes.length} сцен` };
  if (input.projectId) r.projectId = await saveCheck(input.projectId, "Живой голос", `Живой голос: ${before.score} → ${after.score}/100`, { ...r, original: undefined });
  return r;
}

export { ruleName };
