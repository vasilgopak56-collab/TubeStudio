// «Живой голос» — детерминированная проверка текста на признаки ИИ.
// Основа: Humanizer (github.com/blader/humanizer, MIT) + адаптация KB YT-Genius (human-voice.md): §1–§26 и группа T (TTS).
// Оценка = 100 − 5 × (штраф на 100 слов); ●●● = 3, ●● = 2, ● = 1. ≥85 — звучит как человек, 65–84 — следы ИИ, <65 — переписать.
import { sentences, words } from "./scriptCheck.js";

export type Strength = 0 | 1 | 2 | 3;
export type Rule = { id: string; group: "A" | "B" | "C" | "D" | "T"; strength: Strength; name: string; fix: string };
export type Hit = { rule: string; strength: Strength; start: number; end: number; quote: string };
export type VoiceReport = {
  score: number; verdict: "human" | "traces" | "rewrite"; words: number; sentences: number; avgSentence: number; maxSentence: number;
  penalty: number; strong: number; hits: Hit[]; counts: { rule: string; name: string; strength: Strength; count: number }[];
};
export const THRESHOLD = 85;

export const RULES: Rule[] = [
  { id: "§1", group: "A", strength: 3, name: "«Не X, а Y» ради веса", fix: "Скажи, что есть. Противопоставление — только если зритель правда думал «X»" },
  { id: "§2", group: "A", strength: 3, name: "Драматичная концовка-однострочник", fix: "Убери или замени фактом, следствием, переходом" },
  { id: "§3", group: "A", strength: 3, name: "Пустая «мудрость»", fix: "Начни сразу с мысли" },
  { id: "§4", group: "A", strength: 3, name: "Разгон перед сутью", fix: "Сразу говори то, к чему подводишь. Интригу создаёт факт" },
  { id: "§4b", group: "A", strength: 2, name: "Повторное «Представьте себе»", fix: "Не чаще 1 раза за ролик и только перед конкретной сценой" },
  { id: "§5", group: "A", strength: 3, name: "Спор с выдуманным зрителем", fix: "Только реальное и подтверждённое заблуждение" },
  { id: "§6", group: "B", strength: 1, name: "Тройки по привычке", fix: "Сколько пунктов по смыслу — столько и пиши" },
  { id: "§7", group: "B", strength: 2, name: "Одинаковые зачины подряд", fix: "Перестрой 1–2 предложения" },
  { id: "§8", group: "B", strength: 1, name: "Тире как универсальная связка", fix: "Точка, запятая, двоеточие, «потому что»" },
  { id: "§9", group: "B", strength: 1, name: "Нагромождение оговорок", fix: "Одна оговорка там, где неуверенность реальна" },
  { id: "§10", group: "B", strength: 2, name: "Канцелярит", fix: "Простые глаголы: «это», «есть», «делает»" },
  { id: "§11", group: "B", strength: 1, name: "Пассив без деятеля", fix: "Назови, кто сделал" },
  { id: "§12", group: "C", strength: 2, name: "Слова-маркеры ИИ и хайп", fix: "Конкретика вместо оценки" },
  { id: "§13", group: "C", strength: 2, name: "Раздувание значимости", fix: "Покажи значимость фактом или убери оценку" },
  { id: "§14", group: "C", strength: 1, name: "Размытая связь", fix: "Скажи, как именно связаны" },
  { id: "§15", group: "C", strength: 1, name: "Деепричастный хвост", fix: "Отрежь или сделай отдельным предложением с фактом" },
  { id: "§16", group: "C", strength: 2, name: "Рекламный язык", fix: "Что конкретно получает зритель" },
  { id: "§17", group: "C", strength: 2, name: "Безымянный авторитет", fix: "Назови источник или пометь [FACT-CHECK]" },
  { id: "§19", group: "D", strength: 3, name: "Разметка в озвучке", fix: "В озвучке только слова" },
  { id: "§21", group: "D", strength: 1, name: "Кавычки не «ёлочки»", fix: "«так»" },
  { id: "§22", group: "D", strength: 3, name: "Остатки чата", fix: "Удалить" },
  { id: "§23", group: "D", strength: 3, name: "Оговорки о пределах знаний", fix: "Удалить, факт — в проверку" },
  { id: "§24", group: "D", strength: 2, name: "Первая фраза повторяет название", fix: "Первая фраза — хук или факт" },
  { id: "§25", group: "D", strength: 2, name: "Текст о видео, а не о теме", fix: "Начни с сути; CTA один раз" },
  { id: "§26", group: "D", strength: 2, name: "Пересказ услышанного", fix: "Вывод, который меняет взгляд, или следующий шаг" },
  { id: "T1", group: "T", strength: 1, name: "Длинное предложение (>22 слов)", fix: "В среднем 8–14 слов, максимум ~22" },
  { id: "T1+", group: "T", strength: 2, name: "Очень длинное предложение (>30 слов)", fix: "Разбей на 2–3 предложения" },
  { id: "T2", group: "T", strength: 1, name: "Символы % № & → / + = ° $", fix: "Пиши так, как читается: «двадцать процентов»" },
  { id: "T3", group: "T", strength: 1, name: "Скобки", fix: "Скобки не слышны — отдельное предложение" },
  { id: "T4", group: "T", strength: 2, name: "Ремарки и таймкоды", fix: "Убрать в указания голоса или раскадровку" },
  { id: "T5", group: "T", strength: 0, name: "Аббревиатура", fix: "Проверить произношение, расшифровать при первом упоминании" },
  { id: "T6", group: "T", strength: 1, name: "Сложное число цифрами", fix: "Важные числа словами или округлить" },
  { id: "T7", group: "T", strength: 2, name: "Эмодзи", fix: "Убрать" },
  { id: "T8", group: "T", strength: 1, name: "Лишние «!»", fix: "1–2 восклицания на ролик" },
  { id: "T9", group: "T", strength: 1, name: "Лишние риторические «?»", fix: "Вопросы — только как ре-хуки" },
  { id: "T10", group: "T", strength: 1, name: "Лишние «…»", fix: "1–2 многоточия на ролик" },
  { id: "T11", group: "T", strength: 2, name: "Все предложения одной длины", fix: "Чередуй 4–8 и 15–22 слова" },
];
const MARKER_RE = /\[\[SCENE \d+\]\]|\[(?:START|END)\]\[IMAGE \d+\]|\[IMAGE \d+\]|\[VISUAL CUE:[^\]]*\]/gi;
const RULE = new Map(RULES.map((r) => [r.id, r]));

// Границы слова для кириллицы: \b в JS работает только с латиницей
const B = "(?<![\\p{L}\\p{N}])", E = "(?![\\p{L}\\p{N}])";
const lex = (list: string[]) => new RegExp(`${B}(?:${list.join("|")})${E}`, "giu");
const stem = (list: string[]) => new RegExp(`${B}(?:${list.join("|")})\\p{L}*`, "giu");

type Lex = Partial<Record<string, RegExp[]>>;
const LEX: Record<"ru" | "en", Lex> = {
  ru: {
    "§1": [/(?<![\p{L}])(?:больше|нечто большее|гораздо больше),? чем (?:просто )?/giu, /(?<![\p{L}])не что иное, как(?![\p{L}])/giu, /(?<![\p{L}])не просто(?![\p{L}])/giu, /(?<![\p{L}])дело не в(?![\p{L}])/giu, /(?<![\p{L}])не столько[^.!?]{1,60}?сколько(?![\p{L}])/giu,
      /(?<![\p{L}])это (?:был[аио]? )?не [^.!?,]{1,40}?[.!]\s+это(?![\p{L}])/giu, /(?<![\p{L}])это (?:был[аио]? )?не [^.!?,—]{1,40}?(?:,|\s—)\s*а(?![\p{L}])/giu],
    "§2": [lex(["и это (?:меняет|изменило|изменит) всё", "и это меняет все", "вот в чём суть", "вот в чем суть", "всё просто", "вот и всё", "и это только начало", "но это ещё не всё", "но это еще не все", "и это не случайно", "и это пугает"])],
    "§3": [lex(["правда в том, что", "суть в том, что", "в конечном счёте", "в конечном счете", "как говорится", "истина в том, что", "по большому счёту", "по большому счету"])],
    "§4": [lex(["а теперь самое интересное", "давайте разберёмся", "давайте разберемся", "спойлер", "но есть нюанс", "вы не поверите", "и вот тут начинается самое интересное", "самое интересное впереди", "но обо всём по порядку", "но обо всем по порядку", "держитесь крепче", "приготовьтесь"])],
    "§4b": [lex(["представьте себе", "представь себе"])],
    "§5": [lex(["вы наверняка думаете", "вы, наверное, думаете", "вы наверное думаете", "многие считают", "многие думают", "кто-то скажет", "вы можете подумать", "вы спросите", "наверняка вы слышали"])],
    "§10": [stem(["являе", "являю", "являл", "представляет собой", "представляют собой", "осуществля", "посредством"]), lex(["в рамках", "данн(?:ый|ая|ое|ые|ого|ой|ом|ых|ым)", "в целях", "с целью", "на сегодняшний день", "в настоящее время", "имеет место"])],
    "§11": [/(?<![\p{L}])(?:было|был|была|были)\s+(?:открыт|найден|доказан|установлен|обнаружен|принят|решен|решён|создан|построен|отмечен|выявлен|показан|замечен)\p{L}*/giu],
    "§12": [lex(["(?:с)?игра(?:ет|ют|л|ла|ли|ло) (?:ключевую|важную|решающую|огромную) роль", "погрузимся", "погрузиться в", "в современном мире", "в эпоху", "неотъемлем\\p{L}*", "раскрыть потенциал", "настоящая магия", "открывает новые горизонты", "богатая история", "поистине", "уникальн\\p{L}*", "невероятн\\p{L}*", "удивительн\\p{L}*", "революционн\\p{L}*", "захватывающ\\p{L}*", "потрясающ\\p{L}*", "в мире, где", "является свидетельством", "краеугольн\\p{L}*"])],
    "§13": [lex(["важно отметить", "стоит отметить", "стоит подчеркнуть", "следует подчеркнуть", "следует отметить", "нельзя не отметить", "одно из самых", "один из самых", "одна из самых", "изменил[аио]? мир", "навсегда изменил\\p{L}*", "вошл[аио]? в историю", "вош[её]л в историю", "трудно переоценить"])],
    "§14": [lex(["тесно связан\\p{L}*", "так или иначе", "в той или иной степени", "в какой-то мере", "в определённой мере", "в определенной мере"])],
    "§15": [/,\s+(?:подчёркивая|подчеркивая|обеспечивая|демонстрируя|отражая|символизируя|открывая путь|позволяя|способствуя|укрепляя|знаменуя)(?![\p{L}])/giu],
    "§16": [lex(["идеальное решение", "на новый уровень", "не упустите", "лучший способ", "must-have", "незаменим\\p{L}*"])],
    "§17": [lex(["учёные доказали", "ученые доказали", "исследования показывают", "исследования показали", "эксперты считают", "по мнению экспертов", "учёные выяснили", "ученые выяснили", "учёные утверждают", "ученые утверждают", "по данным исследований", "специалисты считают"])],
    "§22": [lex(["конечно! вот", "вот ваш сценарий", "вот сценарий", "надеюсь, (?:это )?было полезно", "надеюсь, это поможет", "если хотите, я могу", "как языковая модель", "как ии"])],
    "§23": [lex(["на момент моего", "на момент последнего обновления", "мои данные ограничены", "моих знаний"])],
    "§25": [lex(["в этом видео", "в сегодняшнем видео", "в этом ролике", "привет, друзья", "всем привет", "добро пожаловать", "на нашем канале", "сегодня мы поговорим", "сегодня мы расскажем", "сегодня мы узнаем", "ставьте лайк", "не забудьте подписаться", "не забудьте поставить лайк"])],
    "§26": [lex(["как мы уже говорили", "как я уже говорил", "как мы уже упоминали", "как уже говорилось", "подвед[её]м итоги", "подводя итог\\p{L}*", "таким образом", "в заключение", "итак, подведём", "итак, подведем"])],
  },
  en: {
    "§1": [/\bnot (?:just|only|merely|simply)\b/gi, /\bit'?s not [^.!?,]{1,40}?[,;.—-]\s*it'?s\b/gi, /\bisn'?t (?:just )?about [^.!?]{1,40}?[,;.—-]\s*it'?s about\b/gi, /\bless about [^.!?]{1,40}? and more about\b/gi],
    "§2": [/\b(?:and )?(?:that|this) changes everything\b/gi, /\bthat'?s the point\b/gi, /\bit'?s that simple\b/gi, /\band that'?s just the beginning\b/gi, /\bbut that'?s not all\b/gi],
    "§3": [/\bthe truth is\b/gi, /\bat the end of the day\b/gi, /\bthe reality is\b/gi, /\bultimately,/gi, /\bas they say\b/gi],
    "§4": [/\bhere'?s the kicker\b/gi, /\bhere'?s where it gets interesting\b/gi, /\blet'?s (?:dive|delve|break it down)\b/gi, /\bspoiler\b/gi, /\byou won'?t believe\b/gi, /\bbut here'?s the thing\b/gi, /\bbuckle up\b/gi],
    "§4b": [/\bimagine (?:a world|for a moment|this)\b/gi],
    "§5": [/\byou (?:might|may) (?:think|be thinking)\b/gi, /\byou'?re probably thinking\b/gi, /\bmany people (?:believe|think)\b/gi, /\bsome (?:might|may|would) say\b/gi],
    "§10": [/\bserves? as\b/gi, /\butiliz\w*/gi, /\bleverag\w*/gi, /\bfacilitat\w*/gi, /\bin order to\b/gi, /\bcommenc\w*/gi],
    "§11": [/\b(?:was|were|has been|have been)\s+(?:discovered|found|proven|shown|established|decided|created|built|noted|observed)\b(?!\s+by)/gi],
    "§12": [/\b(?:delv\w*|tapestry|testament|pivotal|crucial|seamless\w*|landscape|realm|unlock\w*|embark\w*|game-changer|ever-evolving|multifaceted|showcas\w*|underscor\w*|vibrant|intricate|meticulous\w*|bustling|in today'?s (?:world|fast-paced)|plays? a (?:crucial|pivotal|key|vital) role)\b/gi],
    "§13": [/\bit'?s (?:important|worth) (?:to note|noting)\b/gi, /\bit is important to note\b/gi, /\bone of the most\b/gi, /\bchanged the world\b/gi, /\bcannot be overstated\b/gi],
    "§14": [/\bclosely (?:linked|connected|tied)\b/gi, /\bin one way or another\b/gi, /\bto some (?:degree|extent)\b/gi],
    "§15": [/,\s+(?:highlighting|underscoring|showcasing|reflecting|emphasizing|ensuring|fostering|symbolizing|paving the way)\b/gi],
    "§16": [/\b(?:take it to the next level|don'?t miss|perfect solution|game-changing|must-have)\b/gi],
    "§17": [/\b(?:studies|research) (?:show|shows|suggest|suggests)\b/gi, /\bexperts (?:say|believe|agree)\b/gi, /\bscientists (?:have )?(?:proven|discovered|say)\b/gi],
    "§22": [/\bcertainly!/gi, /\bhere'?s (?:your|the) script\b/gi, /\bi hope this helps\b/gi, /\blet me know if\b/gi, /\bas an ai\b/gi],
    "§23": [/\bas of my last (?:update|training)\b/gi, /\bknowledge cutoff\b/gi],
    "§25": [/\bin (?:this|today'?s) video\b/gi, /\bwelcome (?:back|to the channel)\b/gi, /\bhey guys\b/gi, /\bdon'?t forget to subscribe\b/gi, /\bsmash that like\b/gi],
    "§26": [/\bas (?:we|i) (?:mentioned|said) (?:earlier|before)\b/gi, /\bto sum (?:it )?up\b/gi, /\bin conclusion\b/gi, /\bto summarize\b/gi],
  },
};
const HEDGE: Record<"ru" | "en", RegExp> = {
  ru: lex(["возможно", "в определённой степени", "в определенной степени", "по сути", "в каком-то смысле", "отчасти", "как бы", "скорее всего", "вероятно", "пожалуй", "по всей видимости"]),
  en: /\b(?:perhaps|arguably|to some extent|in a sense|essentially|potentially|somewhat|possibly|likely)\b/gi,
};
const TRIAD = /[\p{L}-]{3,},\s+[\p{L}-]{3,},?\s+(?:и|а также|and|y|et|e|und)\s+[\p{L}-]{3,}/giu;

/** Диапазоны настоящих цитат «…» — внутри них оборот не правим (KB: «когда НЕ править») */
function quoteRanges(t: string) { return [...t.matchAll(/«[^«»]{1,400}»/g)].map((m) => [m.index!, m.index! + m[0].length] as const); }
const inside = (r: readonly (readonly [number, number])[], s: number, e: number) => r.some(([a, b]) => s >= a && e <= b);

/** Предложения с позициями */
function sentSpans(t: string) {
  const out: { s: number; e: number; text: string; n: number }[] = [];
  const re = /[^.!?…\n]+(?:[.!?…]+["»”)]*|\n|$)/g;
  for (const m of t.matchAll(re)) { const txt = m[0]; const n = words(txt); if (n) { const lead = txt.length - txt.trimStart().length; out.push({ s: m.index! + lead, e: m.index! + txt.trimEnd().length, text: txt.trim(), n }); } }
  return out;
}

/** Найти все признаки. title — для §24 (необязательно) */
export function scanVoice(raw: string, lang = "ru", title?: string): Hit[] {
  // служебные метки маскируем пробелами той же длины — индексы совпадают с исходником
  const text = raw.replace(MARKER_RE, (m) => " ".repeat(m.length));
  const L = lang === "en" || lang === "ru" ? lang : null;
  const hits: Hit[] = [], qr = quoteRanges(text);
  const add = (rule: string, s: number, e: number) => { const r = RULE.get(rule)!; if (rule !== "§21" && inside(qr, s, e)) return; if (hits.some((h) => h.rule === rule && s < h.end && e > h.start)) return; hits.push({ rule, strength: r.strength, start: s, end: e, quote: raw.slice(s, e) }); };
  const lexOn = L ? LEX[L] : {};
  for (const [rule, res] of Object.entries(lexOn)) for (const re of res ?? []) for (const m of text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))) add(rule, m.index!, m.index! + m[0].length);
  // §4b: первое «Представьте» разрешено
  const p4b = hits.filter((h) => h.rule === "§4b").sort((a, b) => a.start - b.start); if (p4b.length) hits.splice(hits.indexOf(p4b[0]), 1);
  // §25 CTA в конце допустим: «не забудьте подписаться/ставьте лайк» штрафуем только в первых 30%
  for (let i = hits.length - 1; i >= 0; i--) { const h = hits[i]; if (h.rule === "§25" && /подпис|лайк|subscribe|like/i.test(h.quote) && h.start > text.length * 0.3) hits.splice(i, 1); }
  const sp = sentSpans(text);
  // §2: короткая драматичная фраза в конце абзаца уже ловится словарём; добавим «И это …» ≤5 слов в конце абзаца
  for (const s of sp) { const after = text.slice(s.e, s.e + 3); if (s.n <= 5 && /^(?:и это|вот это|and that|that'?s)/i.test(s.text) && (/^\s*\n/.test(after) || s.e >= text.trimEnd().length)) add("§2", s.s, s.e); }
  // §6 тройки
  for (const m of text.matchAll(TRIAD)) add("§6", m.index!, m.index! + m[0].length);
  // §7 три предложения подряд с одинаковым первым словом
  const first = sp.map((s) => (s.text.toLowerCase().match(/[\p{L}\p{N}]+/u)?.[0] ?? ""));
  for (let i = 2; i < sp.length; i++) if (first[i] && first[i] === first[i - 1] && first[i] === first[i - 2] && !(i > 2 && first[i] === first[i - 3])) add("§7", sp[i - 2].s, sp[i].e);
  // §8 ≥2 тире в предложении; §9 ≥2 оговорки; T1 длина
  for (const s of sp) {
    if ((s.text.match(/\s[—–]\s|\s-\s/g) ?? []).length >= 2) add("§8", s.s, s.e);
    if (L && (s.text.match(new RegExp(HEDGE[L].source, HEDGE[L].flags)) ?? []).length >= 2) add("§9", s.s, s.e);
    if (s.n > 30) add("T1+", s.s, s.e); else if (s.n > 22) add("T1", s.s, s.e);
  }
  // §19 разметка
  for (const m of text.matchAll(/\*\*[^*\n]+\*\*|^#{1,6}\s.*$|^\s*[-*•]\s+.*$|^\s*\d+[.)]\s+.*$/gm)) add("§19", m.index!, m.index! + m[0].length);
  // §21 прямые кавычки (только RU)
  if (L === "ru") for (const m of text.matchAll(/"[^"\n]{1,120}"|“[^”\n]{1,120}”|„[^“”\n]{1,120}[“”]/g)) add("§21", m.index!, m.index! + m[0].length);
  // §24 первая фраза повторяет название
  if (title && sp[0]) { const tw = new Set(title.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []); const fw: string[] = sp[0].text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []; if (tw.size >= 2 && [...tw].filter((w) => fw.includes(w)).length / tw.size >= 0.7) add("§24", sp[0].s, sp[0].e); }
  // T2 символы, T3 скобки, T4 ремарки/таймкоды, T7 эмодзи
  for (const m of text.matchAll(/[%№&→+=°$€₽£]|(?<=\p{L})\/(?=\p{L})/gu)) add("T2", m.index!, m.index! + m[0].length);
  for (const m of text.matchAll(/\((?!\d{1,4}\))[^()\n]{2,200}\)/g)) add("T3", m.index!, m.index! + m[0].length);
  for (const m of text.matchAll(/^\s*(?:диктор|рассказчик|ведущий|narrator|voice ?over|vo)\s*:|\[(?:пауза|pause|музыка|music|звук|sfx)[^\]]*\]|(?<![\d:])\d{1,2}:\d{2}(?![\d:])/gim)) add("T4", m.index!, m.index! + m[0].length);
  for (const m of text.matchAll(/\p{Extended_Pictographic}/gu)) add("T7", m.index!, m.index! + m[0].length);
  // T5 аббревиатуры (инфо, первое упоминание), T6 сложные числа цифрами (не годы)
  const seen = new Set<string>();
  for (const m of text.matchAll(/(?<![\p{L}])[A-ZА-ЯЁ]{2,6}(?![\p{L}])/gu)) { if (!seen.has(m[0])) { seen.add(m[0]); add("T5", m.index!, m.index! + m[0].length); } }
  for (const m of text.matchAll(/\d[\d\s.,]*\d|\d/g)) { const v = m[0].replace(/\s/g, ""); const isYear = /^(1[0-9]|20)\d\d$/.test(v); if (!isYear && (v.replace(/\D/g, "").length >= 4 || /[.,]\d/.test(v))) add("T6", m.index!, m.index! + m[0].trimEnd().length); }
  // T8–T10 частота знаков
  const nW = Math.max(1, words(text));
  const excess = (re: RegExp, allowed: number, rule: string) => { const ms = [...text.matchAll(re)]; ms.slice(allowed).forEach((m) => add(rule, m.index!, m.index! + m[0].length)); };
  excess(/!/g, 2, "T8"); excess(/…|\.\.\./g, 2, "T10"); excess(/\?/g, Math.max(2, Math.round(nW / 120)), "T9");
  // T11 монотонность длины
  if (sp.length >= 8) { const lens = sp.map((s) => s.n), m = lens.reduce((a, x) => a + x, 0) / lens.length; const sd = Math.sqrt(lens.reduce((a, x) => a + (x - m) ** 2, 0) / lens.length); if (sd / Math.max(1, m) < 0.3) add("T11", sp[0].s, sp[Math.min(sp.length - 1, 2)].e); }
  return hits.sort((a, b) => a.start - b.start || b.strength - a.strength);
}

export const verdictOf = (s: number): VoiceReport["verdict"] => (s >= THRESHOLD ? "human" : s >= 65 ? "traces" : "rewrite");

export function voiceReport(raw: string, lang = "ru", title?: string): VoiceReport {
  const hits = scanVoice(raw, lang, title);
  const text = raw.replace(MARKER_RE, " ");
  const sp = sentences(text), lens = sp.map(words), nW = words(text);
  const penalty = hits.reduce((a, h) => a + h.strength, 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - 5 * (penalty / Math.max(1, nW)) * 100)));
  const cnt = new Map<string, number>(); hits.forEach((h) => cnt.set(h.rule, (cnt.get(h.rule) ?? 0) + 1));
  const counts = [...cnt].map(([rule, count]) => ({ rule, name: RULE.get(rule)!.name, strength: RULE.get(rule)!.strength, count })).sort((a, b) => b.strength - a.strength || b.count - a.count);
  return { score, verdict: verdictOf(score), words: nW, sentences: sp.length, avgSentence: +(nW / Math.max(1, sp.length)).toFixed(1), maxSentence: Math.max(0, ...lens), penalty, strong: hits.filter((h) => h.strength === 3).length, hits, counts };
}

// ---------- Сверка фактов: числа, даты, «цитаты», имена ----------
const normNum = (s: string) => s.replace(/[\s\u00a0]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(/[.,]$/, "");
export type Facts = { numbers: string[]; quotes: string[]; names: string[] };
export function extractFacts(text: string): Facts {
  const numbers = [...text.matchAll(/\d[\d\s\u00a0.,]*\d|\d/g)].map((m) => normNum(m[0])).filter(Boolean);
  const quotes = [...text.matchAll(/«([^«»]{3,400})»/g)].map((m) => m[1].trim());
  // имена: слово с заглавной НЕ в начале предложения; основа 5 символов (склонения)
  const names: string[] = [];
  for (const m of text.matchAll(/(?<=[\p{Ll}\p{N},;:—–-]\s+)\p{Lu}[\p{Ll}’'-]{2,}/gu)) names.push(m[0].toLowerCase().slice(0, 5));
  return { numbers, quotes, names };
}
const multisetDiff = (a: string[], b: string[]) => { const m = new Map<string, number>(); b.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1)); const out: string[] = []; for (const x of a) { const c = m.get(x) ?? 0; if (c > 0) m.set(x, c - 1); else out.push(x); } return [...new Set(out)]; };
export type FactDiff = { lostNumbers: string[]; addedNumbers: string[]; lostQuotes: string[]; addedQuotes: string[]; lostNames: string[]; addedNames: string[]; ok: boolean };
export function diffFacts(before: string, after: string): FactDiff {
  const a = extractFacts(before), b = extractFacts(after);
  const d = { lostNumbers: multisetDiff(a.numbers, b.numbers), addedNumbers: multisetDiff(b.numbers, a.numbers), lostQuotes: multisetDiff(a.quotes, b.quotes), addedQuotes: multisetDiff(b.quotes, a.quotes),
    lostNames: [...new Set(a.names)].filter((x) => !after.toLowerCase().includes(x)), addedNames: [...new Set(b.names)].filter((x) => !before.toLowerCase().includes(x)) };
  return { ...d, ok: !d.lostNumbers.length && !d.addedNumbers.length && !d.lostQuotes.length && !d.addedQuotes.length };
}

/** Служебные метки, которые должны остаться на месте */
export const markersOf = (t: string) => t.match(MARKER_RE) ?? [];
