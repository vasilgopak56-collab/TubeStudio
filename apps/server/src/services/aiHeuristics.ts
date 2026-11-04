import { sentences, words } from "./scriptCheck.js";

/** Словарь AI-маркеров (§8.6). Строки — подстроки в нижнем регистре, RegExp — шаблоны */
export const AI_MARKERS: Record<string, (string | RegExp)[]> = {
  en: ["delve", "tapestry", "testament to", "moreover", "it's important to note", "it is important to note", "in today's world", "in today's fast-paced", "unlock", "embark", "realm", "game-changer", "navigate the", "furthermore", "in conclusion", "a rich history", "plays a crucial role", "plays a pivotal role", "ever-evolving", "seamless", "showcasing", "underscores", "multifaceted", "not just", "it's worth noting", "dive into", "let's dive",
    "pivotal", "crucial", "landscape", "vibrant", "intricate", "meticulous", "the truth is", "at the end of the day", "here's the kicker", "and that changes everything", "studies show", "serves as", "utilize"],
  ru: ["в современном мире", "важно отметить", "стоит отметить", "давайте разберёмся", "давайте разберемся", "погрузимся", "погрузиться в", "играет ключевую роль", "играет важную роль", "в заключение", "таким образом", "кроме того", "более того", "неотъемлемой частью", "в эпоху", "уникальная возможность", "открывает новые горизонты", "богатая история", /не просто[^.!?]{1,60}?,\s*а\s/, "следует подчеркнуть", "является свидетельством", "в мире, где",
    // из human-voice.md (Humanizer RU, KB YT-Genius)
    "правда в том, что", "в конечном счёте", "в конечном счете", "а теперь самое интересное", "вы не поверите", "но есть нюанс", "вы наверняка думаете", "представляет собой", "раскрыть потенциал", "захватывающ", "неотъемлем", "настоящая магия", "и это меняет всё", "вот в чём суть", "как мы уже говорили", "подведём итоги", "исследования показывают", "учёные доказали", "одно из самых", "тесно связан", "так или иначе"],
};

export type Metric = { id: string; name: string; value: number; score: number; weight: number; hint: string };
export type MarkerHit = { phrase: string; index: number; length: number };

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const tokens = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

export function findMarkers(text: string, lang: string): MarkerHit[] {
  const low = text.toLowerCase(), hits: MarkerHit[] = [];
  for (const m of AI_MARKERS[lang] ?? []) {
    if (typeof m === "string") { let i = low.indexOf(m); while (i >= 0) { hits.push({ phrase: text.slice(i, i + m.length), index: i, length: m.length }); i = low.indexOf(m, i + m.length); } }
    else for (const x of low.matchAll(new RegExp(m.source, "giu"))) hits.push({ phrase: text.slice(x.index!, x.index! + x[0].length), index: x.index!, length: x[0].length });
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** Детерминированные метрики «человечности» 0–1 (1 = похоже на человека) */
export function heuristics(text: string, lang: string) {
  const sents = sentences(text), lens = sents.map(words), tok = tokens(text), nWords = Math.max(1, tok.length);
  const burst = lens.length > 2 ? sd(lens) / Math.max(1, mean(lens)) : 0.5;
  // MATTR, окно 50
  let mattr = tok.length ? new Set(tok).size / tok.length : 0;
  if (tok.length > 50) { const r: number[] = []; for (let i = 0; i + 50 <= tok.length; i += 5) r.push(new Set(tok.slice(i, i + 50)).size / 50); mattr = mean(r); }
  const [mLo, mHi] = lang === "en" || lang === "es" || lang === "fr" || lang === "pt" ? [0.68, 0.85] : [0.82, 0.95];
  // одинаковые зачины (первые 2 слова)
  const openers = sents.map((s) => tokens(s).slice(0, 2).join(" ")).filter(Boolean);
  const cnt = new Map<string, number>(); openers.forEach((o) => cnt.set(o, (cnt.get(o) ?? 0) + 1));
  const repShare = openers.length ? openers.filter((o) => (cnt.get(o) ?? 0) > 1).length / openers.length : 0;
  const markers = findMarkers(text, lang), per1k = (markers.length / nWords) * 1000;
  const dashes = ((text.match(/—|–| - /g) ?? []).length / nWords) * 100;
  const paras = text.split(/\n\s*\n/).map(words).filter((n) => n > 0);
  const pcv = paras.length >= 3 ? sd(paras) / Math.max(1, mean(paras)) : null;
  const three = ((text.match(/[\p{L}-]+,\s+[\p{L}-]+,?\s+(и|и\s|and|y|et|e|und)\s+[\p{L}-]+/giu) ?? []).length / nWords) * 1000;

  const metrics: Metric[] = [
    { id: "burstiness", name: "Взрывность (разброс длины предложений)", value: +burst.toFixed(2), score: clamp((burst - 0.2) / 0.3), weight: 0.22, hint: "У людей обычно > 0.45: короткие и длинные предложения вперемешку" },
    { id: "mattr", name: "Лексическое разнообразие (MATTR-50)", value: +mattr.toFixed(2), score: clamp((mattr - mLo) / (mHi - mLo)), weight: 0.13, hint: "Доля уникальных слов в скользящем окне 50 слов" },
    { id: "openers", name: "Повторяющиеся зачины", value: +(repShare * 100).toFixed(0), score: clamp(1 - repShare / 0.25), weight: 0.12, hint: "% предложений с одинаковыми первыми 2 словами" },
    { id: "markers", name: "AI-маркеры", value: markers.length, score: clamp(1 - per1k / 6), weight: 0.2, hint: `${per1k.toFixed(1)} на 1000 слов (словарь RU/EN)` },
    { id: "dashes", name: "Плотность тире", value: +dashes.toFixed(2), score: clamp(1 - (dashes - 0.3) / 1.5), weight: 0.1, hint: "«—» на 100 слов; AI злоупотребляет тире" },
    { id: "paragraphs", name: "Однородность абзацев", value: pcv == null ? 0 : +pcv.toFixed(2), score: pcv == null ? 0.5 : clamp((pcv - 0.15) / 0.35), weight: pcv == null ? 0 : 0.1, hint: pcv == null ? "Мало абзацев для оценки" : "Коэф. вариации длины абзацев; одинаковые абзацы — признак AI" },
    { id: "three", name: "«Правило трёх»", value: +three.toFixed(1), score: clamp(1 - three / 8), weight: 0.13, hint: "Перечисления «A, B и C» на 1000 слов" },
  ];
  const wsum = metrics.reduce((s, m) => s + m.weight, 0);
  const score = metrics.reduce((s, m) => s + m.score * m.weight, 0) / wsum;
  return { metrics, score, markers, words: tok.length, sentenceLengths: lens };
}
