// Детерминированная проверка сценария (ТЗ §6.5 п.4, по мотивам checkScript/analyzeScript из yt-ideation-mcp)
// Темп озвучки по KB YT-Genius: EN 140–155, RU 110–130, ES/PT 140–160, DE 110–125
export const WPM: Record<string, number> = { ru: 120, en: 150, es: 150, de: 118, fr: 145, pt: 150, uk: 120, pl: 125 };
/** Символов на слово (с пробелом) — для режима «символы» */
export const CPW: Record<string, number> = { ru: 7.2, uk: 7.2, pl: 7.4, de: 7.0, en: 6.0, es: 5.8, fr: 5.9, pt: 5.9 };
const CTA_RE: Record<string, RegExp> = {
  sr: /претплат|pretplat/i, it: /iscriv/i, he: /הירש|להירשם|להרשמה|הרשמ/u, ar: /اشتر[اك]|اشتراك/u, vi: /đăng ký/iu, ja: /チャンネル登録|登録/u, ko: /구독/u, zh: /订阅|訂閱/u, id: /berlangganan|subscribe/iu, hi: /सदस्यता|सब्सक्राइब/u, tr: /abone/iu,
  ru: /подпи[сш]/i, uk: /підпи[сш]/i, en: /subscrib/i, es: /suscr[ií]b/i, de: /abonn/i, fr: /abonn/i, pt: /inscrev|assin/i, pl: /subskryb|zasubskryb/i,
};
const CLICHES: Record<string, string[]> = {
  ru: ["в этом видео", "добро пожаловать", "всем привет", "вы не поверите", "шокирующ", "давайте разберёмся", "давайте разберемся", "итак, начнём", "итак, начнем", "не забудьте поставить лайк", "ставьте лайк", "но всё изменилось", "но все изменилось", "мало кто знает", "на протяжении всей истории"],
  en: ["in this video", "welcome back", "you won't believe", "shocking", "insane", "mind-blowing", "smash that like", "little did he know", "throughout history", "but everything was about to change"],
};

export const words = (s: string) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
export const sentences = (s: string) => s.split(/(?<=[.!?…])\s+/).map((x) => x.trim()).filter((x) => words(x) > 0);

export type CheckOpts = { profile?: "standard" | "donor"; language: string; unit?: "words" | "chars"; target?: number; headings?: boolean; visualCues?: boolean; cta?: boolean; actNames?: string[] };
export type CheckResult = {
  metrics: { words: number; chars: number; charsNoSpaces: number; minutes: number; sentences: number; avgSentence: number; questions: number; ctaPos: number | null; deviationPct: number | null; paragraphs: number };
  errors: string[]; warnings: string[]; passed: boolean;
};

/** Текст для озвучки: без заголовков актов и [VISUAL CUE] */
export function spokenText(script: string, o: Pick<CheckOpts, "headings" | "actNames">) {
  let t = script.replace(/\[VISUAL CUE:[^\]]*\]/gi, " ");
  if (o.headings) { const names = new Set((o.actNames ?? []).map((n) => n.trim().toLowerCase())); t = t.split("\n").filter((l) => !names.has(l.trim().replace(/^#+\s*/, "").toLowerCase())).join("\n"); }
  return t;
}

export function checkScript(script: string, o: CheckOpts): CheckResult {
  const lang = o.language;
  const errors: string[] = [], warnings: string[] = [];
  const spoken = spokenText(script, o);
  const w = words(spoken), sents = sentences(spoken);
  const chars = spoken.replace(/\s+/g, " ").trim().length, charsNoSpaces = spoken.replace(/\s/g, "").length;
  const avg = sents.length ? w / sents.length : 0;
  const questions = (spoken.match(/\?/g) ?? []).length;
  const low = spoken.toLowerCase();
  const ctaPattern = CTA_RE[lang];
  const ctaIdx = ctaPattern ? low.search(ctaPattern) : -1;
  if (!(lang in WPM)) warnings.push("Темп и длительность приблизительны: для выбранного языка нет отдельной калибровки. Для текстов без пробелов используйте объём в символах и проверяйте готовую озвучку.");
  const ctaPos = ctaIdx < 0 ? null : +(ctaIdx / Math.max(1, low.length) * 100).toFixed(0);
  const actual = o.unit === "chars" ? chars : w;
  const dev = o.target ? +(((actual - o.target) / o.target) * 100).toFixed(1) : null;

  if (dev != null && Math.abs(dev) > 5) errors.push(`Объём ${actual} ${o.unit === "chars" ? "симв." : "слов"} — отклонение ${dev > 0 ? "+" : ""}${dev}% от цели ${o.target} (допуск ±5%)`);
  if (!o.visualCues && /\[[^\]]{2,}\]/.test(script)) errors.push(`Квадратные скобки/ремарки в тексте: ${script.match(/\[[^\]]{2,}\]/)![0].slice(0, 60)}`);
  if (/\((music|музыка|sfx|звук|пауза|pause|narrator|диктор)[^)]*\)/i.test(script)) errors.push("Ремарки в круглых скобках (музыка/пауза/диктор)");
  if (!o.headings && /^\s*#{1,6}\s/m.test(script)) errors.push("Markdown-заголовки (#) — выключены в настройках");
  if (/^\s*([-*•]|\d+\.)\s+/m.test(script)) errors.push("Списки/нумерация в тексте для озвучки");
  if (/\*\*[^*]+\*\*|__[^_]+__/.test(script)) errors.push("**Жирный** или другая markdown-разметка");
  if (/^\s*(narrator|диктор|ведущий|vo|v\.o\.|host)\s*:/im.test(script)) errors.push("Метки говорящего (Диктор:)");
  if (/\b\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}\b/.test(script)) errors.push("Таймкоды в тексте");
  const tail = spoken.slice(Math.floor(spoken.length * 0.9));
  if (o.profile !== "donor" && !tail.includes("?")) errors.push("В финале нет вопроса для комментариев");
  if (o.cta) {
    if (ctaPos == null) errors.push("Нет призыва подписаться (CTA) около 40% текста");
    else if (ctaPos < 25) errors.push(`CTA слишком рано — на ${ctaPos}% (цель ≈ 40%)`);
    else if (ctaPos > 55) warnings.push(`CTA на ${ctaPos}% текста (цель ≈ 40%)`);
  }
  if (o.profile !== "donor" && avg && (avg < 8 || avg > 20)) warnings.push(`Средняя длина предложения ${avg.toFixed(1)} слов (комфортно для озвучки 10–18)`);
  const long = sents.filter((s) => words(s) > 35).length;
  if (long) warnings.push(`Очень длинных предложений (> 35 слов): ${long} — трудно читать вслух`);
  if (o.profile !== "donor" && w > 600 && (!questions || w / questions > 400)) warnings.push(`Мало открытых вопросов: 1 на ${questions ? Math.round(w / questions) : "∞"} слов (цель — каждые 250–350)`);
  const excl = (spoken.match(/!/g) ?? []).length;
  if (excl > Math.max(3, w / 200)) warnings.push(`Много восклицательных знаков: ${excl}`);
  for (const c of [...(CLICHES[lang] ?? []), ...(lang !== "en" ? [] : [])]) { const n = low.split(c).length - 1; if (n) warnings.push(`Клише «${c}» ×${n}`); }
  if (o.profile !== "donor" && sents.length > 6) {
    const grams = (s: string) => { const x = s.toLowerCase().match(/[\p{L}]{3,}/gu) ?? []; return new Set(x); };
    const open = grams(sents.slice(0, 3).join(" ")), end = grams(sents.slice(-4).join(" "));
    if ([...end].filter((g) => open.has(g)).length < 2) warnings.push("Финал не перекликается с открытием (callback)");
  }
  return {
    metrics: { words: w, chars, charsNoSpaces, minutes: +(w / (WPM[lang] ?? 140)).toFixed(1), sentences: sents.length, avgSentence: +avg.toFixed(1), questions, ctaPos, deviationPct: dev, paragraphs: script.split(/\n\s*\n/).filter((p) => p.trim()).length },
    errors, warnings, passed: errors.length === 0,
  };
}

/** Чистка вывода модели: теги, markdown, скобки (если ремарки выключены) */
export function sanitize(text: string, o: { visualCues?: boolean }) {
  let t = text.replace(/<\/?script>/gi, "").replace(/<meta>[\s\S]*?<\/meta>/gi, "");
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1").replace(/^\s*#{1,6}\s+.*$/gm, "").replace(/^\s*[-*•]\s+/gm, "").replace(/^\s*---+\s*$/gm, "");
  t = t.replace(/^\s*(narrator|диктор|ведущий|vo|host)\s*:\s*/gim, "");
  if (!o.visualCues) t = t.replace(/\[[^\]]*\]/g, "").replace(/\((?:music|музыка|sfx|звук|пауза|pause)[^)]*\)/gi, "");
  return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}
