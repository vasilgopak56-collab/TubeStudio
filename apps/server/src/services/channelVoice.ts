// «Голос канала» — паспорт стиля автора по его собственным сценариям. Считается без нейросети (детерминированно),
// затем подмешивается в промпты Сценариста и «Живого голоса», чтобы тексты звучали как автор, а не как «средний ИИ».
import crypto from "node:crypto";
import { z } from "zod";
import { readJson, writeJson } from "../lib/storage.js";
import { voiceReport } from "./humanVoice.js";

const STOP_RU = new Set("и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее её мне было вот от меня еще ещё нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее неё сейчас были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно всю между это эта эти это свои своих своей который которые которая которых также очень просто".split(" "));
const STOP_EN = new Set("the a an and or but if then of to in on at by for with from as is are was were be been being it its this that these those he she they we you i me my our your their his her them us not no so do does did have has had will would can could should may might just than too very into about over after before there here what which who whom when where why how all any each more most other some such only own same also out up down off again once".split(" "));

const PERSON: Record<string, Record<string, RegExp>> = {
  ru: { ty: /^(ты|тебя|тебе|тобой|твой|твоя|твоё|твое|твои|твоих|твоим)$/, vy: /^(вы|вас|вам|вами|ваш|ваша|ваше|ваши|ваших|вашим)$/, my: /^(мы|нас|нам|нами|наш|наша|наше|наши|наших|нашим)$/, ya: /^(я|меня|мне|мной|мой|моя|моё|мое|мои|моих)$/ },
  en: { ty: /^$/, vy: /^(you|your|yours|yourself)$/, my: /^(we|us|our|ours)$/, ya: /^(i|me|my|mine|myself)$/ },
};

const splitSentences = (t: string) => t.replace(/\[[^\]]*\]/g, " ").split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter((s) => /[\p{L}\d]/u.test(s));
const tokens = (s: string) => (s.toLowerCase().match(/[\p{L}\d][\p{L}\d'’-]*/gu) ?? []);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const per100 = (a: number, w: number) => (w ? Math.round((a / w) * 1000) / 10 : 0);
const quantile = (xs: number[], q: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; };

export type Passport = {
  language: string; samples: number; words: number; sentences: number;
  avgSentence: number; medianSentence: number; p10: number; p90: number; spread: number;
  shortPct: number; longPct: number; questionPct: number; exclamPct: number;
  commasPerSentence: number; dashes: number; colons: number; ellipses: number; parens: number;
  address: "ty" | "vy" | "my" | "ya" | "neutral"; person: Record<"ty" | "vy" | "my" | "ya", number>;
  paragraphSentences: number;
  topWords: { w: string; n: number }[]; phrases: { p: string; n: number }[]; openers: { w: string; n: number }[];
  examples: string[]; aiScore: number;
};

export function analyzeVoice(samples: string[], language = "ru"): Passport {
  const lang = language;
  const stop = lang === "en" ? STOP_EN : lang === "ru" ? STOP_RU : new Set<string>();
  const texts = samples.map((s) => s.trim()).filter(Boolean);
  const all = texts.join("\n\n");
  const sents = texts.flatMap(splitSentences);
  const lens = sents.map((s) => tokens(s).length).filter((n) => n > 0);
  const toks = tokens(all);
  const W = toks.length, S = lens.length || 1;
  const avg = lens.reduce((a, b) => a + b, 0) / S;
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - avg) ** 2, 0) / S);

  const person = { ty: 0, vy: 0, my: 0, ya: 0 } as Record<"ty" | "vy" | "my" | "ya", number>;
  for (const t of toks) for (const k of Object.keys(person) as (keyof typeof person)[]) if (PERSON[lang]?.[k]?.test(t)) person[k]++;
  const perK = Object.fromEntries(Object.entries(person).map(([k, v]) => [k, W ? Math.round((v / W) * 10000) / 10 : 0])) as typeof person;
  const top = (Object.entries(perK) as [keyof typeof person, number][]).sort((a, b) => b[1] - a[1])[0];
  const address = top && top[1] >= 3 ? top[0] : "neutral";

  // частые содержательные слова: встречаются в ≥2 образцах (если образцов ≥2) и ≥3 раз
  const docFreq = new Map<string, Set<number>>(); const freq = new Map<string, number>();
  texts.forEach((t, i) => tokens(t).forEach((w) => {
    if (w.length < 4 || stop.has(w) || /^\d+$/.test(w)) return;
    freq.set(w, (freq.get(w) ?? 0) + 1); (docFreq.get(w) ?? docFreq.set(w, new Set()).get(w)!).add(i);
  }));
  const needDocs = texts.length >= 2 ? 2 : 1;
  const topWords = [...freq].filter(([w, n]) => n >= 3 && docFreq.get(w)!.size >= needDocs).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w, n]) => ({ w, n }));

  // устойчивые обороты (2–3 слова, хотя бы одно содержательное), ≥2 раз
  const ph = new Map<string, number>();
  for (const s of sents) {
    const t = tokens(s);
    for (let n = 2; n <= 3; n++) for (let i = 0; i + n <= t.length; i++) {
      const g = t.slice(i, i + n); if (g.every((x) => stop.has(x) || x.length < 3)) continue;
      const k = g.join(" "); ph.set(k, (ph.get(k) ?? 0) + 1);
    }
  }
  const phrases = [...ph].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .filter(([p], i, arr) => !arr.slice(0, i).some(([q]) => q.includes(p))).slice(0, 10).map(([p, n]) => ({ p, n }));

  const op = new Map<string, number>();
  for (const s of sents) { const w = tokens(s)[0]; if (w) op.set(w, (op.get(w) ?? 0) + 1); }
  const openers = [...op].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w, n]) => ({ w, n }));

  const paras = texts.flatMap((t) => t.split(/\n\s*\n/)).map((p) => splitSentences(p).length).filter(Boolean);

  // примеры: предложения около медианы и чуть короче/длиннее, без признаков ИИ, разные по началу
  const med = quantile(lens, 0.5);
  const clean = sents.filter((s) => { const n = tokens(s).length; return n >= 4 && n <= Math.max(26, med * 2) && voiceReport(s, lang).hits.every((h) => h.strength < 2); });
  const examples: string[] = []; const used = new Set<string>();
  for (const target of [med, quantile(lens, 0.2), quantile(lens, 0.8), med]) {
    const c = clean.filter((s) => !examples.includes(s) && !used.has(tokens(s)[0] ?? "")).sort((a, b) => Math.abs(tokens(a).length - target) - Math.abs(tokens(b).length - target))[0];
    if (c) { examples.push(c.slice(0, 280)); used.add(tokens(c)[0] ?? ""); }
  }

  const count = (re: RegExp) => (all.match(re) ?? []).length;
  return {
    language: lang, samples: texts.length, words: W, sentences: lens.length,
    avgSentence: Math.round(avg * 10) / 10, medianSentence: med, p10: quantile(lens, 0.1), p90: quantile(lens, 0.9), spread: Math.round(sd * 10) / 10,
    shortPct: pct(lens.filter((n) => n <= 6).length, S), longPct: pct(lens.filter((n) => n >= 20).length, S),
    questionPct: pct(sents.filter((s) => /\?["»”)]?$/.test(s)).length, S), exclamPct: pct(sents.filter((s) => /!["»”)]?$/.test(s)).length, S),
    commasPerSentence: Math.round((count(/,/g) / S) * 10) / 10,
    dashes: per100(count(/\s[—–-]\s/g), W), colons: per100(count(/:/g), W), ellipses: per100(count(/…|\.\.\./g), W), parens: per100(count(/\(/g), W),
    address, person: perK,
    paragraphSentences: paras.length ? Math.round((paras.reduce((a, b) => a + b, 0) / paras.length) * 10) / 10 : 0,
    topWords, phrases, openers, examples, aiScore: voiceReport(all, lang).score,
  };
}

const ADDRESS_EN: Record<Passport["address"], string> = {
  ty: 'informal "ты" (second person singular)', vy: 'second person plural / polite "вы" (or "you")', my: 'inclusive "мы" / "we" — narrator and viewer together', ya: "first person — the narrator speaks from personal experience", neutral: "mostly impersonal narration, little direct address",
};

/** Блок для системного промпта (английский — как и остальные промпты) */
export function passportPrompt(p: Passport) {
  const list = (xs: string[]) => xs.length ? xs.join(", ") : "—";
  return `CHANNEL VOICE PASSPORT — measured from ${p.samples} of the author's own scripts (${p.words} words). Imitate this voice. It overrides generic style advice (but never facts, length, format or markers):
- Sentence length: average ${p.avgSentence} words, median ${p.medianSentence}; 10% are ≤${p.p10} words, 10% are ≥${p.p90}. Short punchy sentences (≤6 words): ${p.shortPct}%. Long sentences (≥20 words): ${p.longPct}%. Rhythm spread (std dev): ${p.spread} — ${p.spread >= 7 ? "strongly varied, mix very short and long" : p.spread >= 4 ? "moderately varied" : "fairly even"}.
- Questions: ${p.questionPct}% of sentences; exclamations: ${p.exclamPct}%. Commas per sentence: ${p.commasPerSentence}.
- Punctuation per 100 words: dashes ${p.dashes}, colons ${p.colons}, ellipses ${p.ellipses}, parentheses ${p.parens}. Stay close to these rates.
- Address: ${ADDRESS_EN[p.address]}.
- Paragraphs: about ${p.paragraphSentences || 3} sentences each.
- Signature vocabulary (use naturally where it fits, never force): ${list(p.topWords.slice(0, 12).map((x) => x.w))}.
- Recurring turns of phrase: ${list(p.phrases.slice(0, 8).map((x) => `«${x.p}»`))}.
- Typical sentence openers: ${list(p.openers.slice(0, 6).map((x) => `«${x.w}»`))}.
- Tone reference — sentences in the author's voice (NEVER copy them, only match the feel):
${p.examples.map((e) => `  «${e}»`).join("\n")}`;
}

// ── Хранилище ──
export const VoiceSample = z.object({ id: z.string().optional(), title: z.string().trim().max(200).default(""), text: z.string().trim().min(200, "Образец слишком короткий — нужно от 200 символов").max(60000) });
export const VoiceProfileInput = z.object({
  enabled: z.boolean().optional(),
  language: z.string().max(5).optional(),
  samples: z.array(VoiceSample).max(5, "Не больше 5 образцов").optional(),
});
export type VoiceProfile = { enabled: boolean; language: string; samples: { id: string; title: string; text: string }[]; passport: Passport | null; updatedAt: string };
const FILE = "voice-profile.json";
const EMPTY: VoiceProfile = { enabled: false, language: "ru", samples: [], passport: null, updatedAt: "" };

export const getVoiceProfile = () => readJson<VoiceProfile>(FILE, EMPTY);
export async function saveVoiceProfile(input: unknown) {
  const d = VoiceProfileInput.parse(input); const cur = await getVoiceProfile();
  const samples = d.samples ? d.samples.map((s) => ({ id: s.id || crypto.randomUUID(), title: s.title || s.text.slice(0, 60), text: s.text })) : cur.samples;
  const language = d.language ?? cur.language;
  const passport = samples.length ? analyzeVoice(samples.map((s) => s.text), language) : null;
  const next: VoiceProfile = { enabled: (d.enabled ?? cur.enabled) && !!passport, language, samples, passport, updatedAt: new Date().toISOString() };
  await writeJson(FILE, next); return next;
}
/** Промпт-блок, если «Голос канала» включён (и язык совпадает) */
export async function activeVoicePrompt(language: string) {
  const v = await getVoiceProfile();
  if (!v.enabled || !v.passport) return "";
  if (v.language !== language || v.passport.language !== language) return ""; // Never mix languages or reuse an old RU-coerced passport.
  return passportPrompt(v.passport);
}
