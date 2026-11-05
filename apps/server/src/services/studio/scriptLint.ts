// Автопроверка сценария без ИИ (Выпуск 1, карточки 100, 120, 130, 150).
// Меряет то, что можно измерить кодом: длину, хук, вступление, оговорки, повторы,
// финал, призывы, длину предложений, стоп-слова, упоминания ИИ и то, что диктор
// прочитает вслух лишнего (скобки, метки). Каждая находка — с абзацем, временем и советом.

export type LintSeverity = "error" | "warn" | "info";
export type LintItem = { paragraph: number; at: string; quote: string; match?: string };
export type LintIssue = { rule: string; severity: LintSeverity; title: string; advice: string; paragraph?: number; at?: string; quote?: string; items?: LintItem[] };
export type LintReport = {
  language: "en" | "ru"; words: number; paragraphs: number; wpm: number; minutes: number; duration: string;
  targetWords?: number; sentences: { count: number; avgWords: number; long: number };
  hedges: { count: number; allowed: number };
  issues: LintIssue[]; errors: number; warnings: number; passed: string[];
};
export type LintOptions = { language?: string; targetMinutes?: number; wpm?: number };

/** Темп по умолчанию (карточка 120): EN 140–155, RU 110–130 слов в минуту. */
export const DEFAULT_WPM = { en: 150, ru: 120 } as const;

type Lang = "en" | "ru";
type Rx = RegExp;
type Pack = {
  scene: Rx[]; meta: Rx[]; hedges: Rx[]; cta: Rx[]; farewell: Rx[]; conclusion: Rx[]; contradiction: Rx;
  stop: Rx[]; bureaucratic: Rx[]; suspense: Rx[]; production: Rx[]; rehooks: Rx[]; stopwords: Set<string>;
  longSentence: number;
};
// В JS «\b» понимает только латиницу: для кириллицы граница слова задаётся явно через \p{L}.
const B = "(?:(?<![\\p{L}\\p{N}_])(?=[\\p{L}\\p{N}_])|(?<=[\\p{L}\\p{N}_])(?![\\p{L}\\p{N}_]))";
const w = (s: string) => new RegExp(s.replace(/\\b/g, B), "iu");
const EN: Pack = {
  scene: ["\\b(stands?|standing|sits?|sitting|lies|lying|hangs?|hanging|rests?|leans?|leaning)\\b", "\\bon the (left|right)\\b", "\\bin front of\\b", "\\bthere (is|are|was|were)\\b", "\\b(next to|beside|behind) (him|her|it|them|the)\\b", "\\bwearing\\b"].map(w),
  meta: ["\\bwe('| wi)ll (stay|focus|look|cover|talk|explore|keep|stick|limit|start|go|dive|walk)\\b", "\\bin this (video|episode)\\b", "\\btoday,? (we|i)('ll| will|'re| are)\\b", "\\blet'?s (dive|take a look|talk|explore|get started|begin|start)\\b", "\\bbefore we (start|begin|dive|get into)\\b", "\\bwe('re| are) going to (look|talk|explore|cover)\\b"].map(w),
  hedges: ["\\ba word of caution\\b", "\\breportedly\\b", "\\ballegedly\\b", "\\b(historians|scholars|experts|researchers) (still )?(debate|argue about|argue over|disagree|dispute)\\b", "\\bhistorians still argue\\b", "\\b(the )?details (are|remain) (uncertain|unclear|murky|disputed)\\b", "\\bno single (number|date|answer|figure|source)\\b", "\\bno (neat|clear|exact|precise|single) (date|answer|number|year)\\b", "\\bvaried (by|from) (region|place|country)\\b", "\\bit'?s (hard|difficult|impossible) to (say|know|tell)\\b", "\\bwe (don'?t|do not|can'?t|cannot) (really )?(know|be sure|say for sure)\\b", "\\bsome (historians|scholars|experts|researchers|sources) (say|believe|think|claim|suggest)\\b", "\\baccording to (some|legend|one account)\\b", "\\bit is (said|believed|thought) that\\b", "\\bthe evidence is (thin|mixed|unclear|patchy)\\b", "\\b(remains?|is still) (unclear|debated|uncertain|disputed|a mystery)\\b", "\\bto be fair\\b", "\\bof course,? (not all|some)\\b"].map(w),
  cta: ["\\bsubscrib(e|ing)\\b", "\\bhit the (bell|like)\\b", "\\blike (this|the) video\\b", "\\b(leave|drop) (a|your) (comment|like)\\b", "\\blet me know in the comments\\b", "\\bin the comments\\b", "\\bcomment below\\b"].map(w),
  farewell: ["\\bnext time\\b", "\\bsee you\\b", "\\bthanks for watching\\b", "\\buntil next\\b"].map(w),
  // Голое «So…» — обычная связка рассказа, итог — только «So, in the end…», «So the real story…» и т. п.
  conclusion: ["^(in the end|ultimately|in short|in conclusion|all in all|to sum up|that'?s why|the lesson|the takeaway)\\b", "^so,? (in the end|ultimately|the (real|whole|lesson|takeaway|answer|point))\\b", "\\bthe real (story|answer|lesson|point) (is|was)\\b", "\\bthe (lesson|takeaway|moral) (is|was|here)\\b"].map(w),
  contradiction: w("\\b(but|yet|however|instead|actually|turns out|wrong|myth|never|nobody|no one|until|wasn'?t|isn'?t|didn'?t|don'?t)\\b|\\?"),
  stop: ["\\bthroughout (human )?history\\b", "\\bsince the dawn of (time|man|civili[sz]ation)\\b", "\\blet'?s dive (in|into)\\b", "\\bsurprisingly\\b", "\\bincredibly\\b", "\\bshocking truth\\b", "\\bthis changed everything\\b", "\\bit wasn'?t that simple\\b", "\\bfew people know\\b", "\\bin this video,? we\\b", "\\bguys\\b", "\\bbuckle up\\b", "\\bmind-?blowing\\b", "\\bfascinating\\b"].map(w),
  bureaucratic: ["\\butili[sz]e\\b", "\\bin terms of\\b", "\\bit should be noted\\b", "\\bit is important to note\\b", "\\bin order to\\b", "\\bwith regard(s)? to\\b"].map(w),
  suspense: ["\\blittle did (he|she|they|we|anyone) know\\b", "\\bwhat happened next (shocked|surprised|stunned)\\b", "\\bthe truth (was|is) (darker|worse|scarier|stranger)\\b", "\\beverything was about to change\\b", "\\bthat was only the beginning\\b", "\\bnothing could have prepared\\b"].map(w),
  production: ["\\bas an ai\\b", "\\blanguage model\\b", "\\bchat ?gpt\\b", "\\b(this|the) script\\b", "\\bvoice-?over\\b", "\\bnarrator\\s*:", "\\bb-roll\\b", "\\bsfx\\b", "\\btimestamp\\b", "\\bfact-?check\\b", "\\bon screen\\s*:", "\\bcut to\\b"].map(w),
  rehooks: ["but here'?s where it gets interesting", "here'?s what nobody tells you", "which raises a strange question", "so what changed", "but there'?s a problem", "and that'?s where things get"].map(w),
  stopwords: new Set("a an the and or but so of to in on at by for with from into onto over under about as is are was were be been being it its it's this that these those he she they them his her their you your we our i me my not no yes do does did done have has had can could would should will may might must just also very much more most than then there here what which who whom whose when where why how all any some each every one two".split(" ")),
  longSentence: 25,
};
const RU: Pack = {
  scene: ["\\b(стоит|сидит|лежит|висит|висят|стоят|лежат|опирается)\\b", "\\b(слева|справа|напротив|позади)\\b", "\\bперед (ним|ней|ними)\\b", "\\bна (стене|столе|полу|крюке)\\b", "\\bодет[аоы]? в\\b"].map(w),
  meta: ["\\bв этом (видео|ролике|выпуске)\\b", "\\bсегодня (мы|я) (поговорим|расскажу|разберём|узнаем|посмотрим)\\b", "\\bдавайте (разберёмся|разберемся|посмотрим|начнём|начнем|поговорим)\\b", "\\bмы (остановимся|сосредоточимся|ограничимся|поговорим|рассмотрим)\\b", "\\bречь пойдёт\\b", "\\bречь пойдет\\b"].map(w),
  hedges: ["\\bякобы\\b", "\\bпредположительно\\b", "\\bпо (некоторым|одной из|другим) (данным|версий|версии|сведениям)\\b", "\\b(историки|учёные|ученые|исследователи|эксперты) (до сих пор )?(спорят|расходятся|не сходятся)\\b", "\\bточно (неизвестно|не известно|не установлено)\\b", "\\b(сложно|трудно|невозможно) (сказать|утверждать|судить)\\b", "\\bне существует (единой|точной|однозначной)\\b", "\\bнет (единой|точной|однозначной|чёткой|четкой) (даты|цифры|версии|ответа)\\b", "\\bесть мнение\\b", "\\bсчитается,? что\\b", "\\bкак утверждают\\b", "\\bпо слухам\\b", "\\bпо преданию\\b", "\\bдетали (неясны|спорны|неизвестны)\\b", "\\bоговоримся\\b", "\\bстоит оговориться\\b"].map(w),
  cta: ["\\bподпиш(ись|итесь)\\b", "\\bподписк[уа]\\b", "\\bлайк\\b", "\\bколокольчик\\b", "\\bнапиш(и|ите) в комментариях\\b", "\\bв комментариях\\b"].map(w),
  farewell: ["\\bдо (встречи|скорого|следующего)\\b", "\\bувидимся\\b", "\\bспасибо за просмотр\\b", "\\bв следующий раз\\b"].map(w),
  conclusion: ["^(итак|в итоге|в конце концов|короче говоря|подводя итог|вот почему|таким образом|получается|главный урок|мораль)\\b", "\\bнастоящая история (в том|—)\\b", "\\b(урок|вывод|мораль) (здесь )?(такой|прост|в том)\\b"].map(w),
  contradiction: w("\\b(но|однако|а на самом деле|на деле|оказалось|оказывается|ошибка|миф|никогда|никто|вместо|не так)\\b|\\?"),
  stop: ["\\bна протяжении (всей )?истории\\b", "\\bс незапамятных времён\\b", "\\bс незапамятных времен\\b", "\\bдавайте разберёмся\\b", "\\bдавайте разберемся\\b", "\\bудивительно,? но\\b", "\\bневероятно\\b", "\\bшокирующ(ая|ую) правд[аую]\\b", "\\bэто изменило всё\\b", "\\bно всё было не так просто\\b", "\\bмало кто знает\\b", "\\bв этом видео мы\\b", "\\bребята\\b"].map(w),
  bureaucratic: ["\\bявля(ется|ются|лся|лась|лись)\\b", "\\bосуществля\\p{L}*", "\\bданн(ый|ая|ое|ые|ого|ой|ом|ых)\\b", "\\bв рамках\\b", "\\bв целях\\b", "\\bпроизвод(ить|ится) (оценк|анализ)"].map(w),
  suspense: ["\\b(он|она|они) и не подозрева(л|ла|ли)\\b", "\\bправда оказалась (страшнее|хуже|жутче)\\b", "\\bно всё вот-вот изменится\\b", "\\bто,? что случилось (дальше|потом),? шокировало\\b", "\\bэто было только начало\\b"].map(w),
  production: ["\\bнейросет\\p{L}*", "\\bискусственн(ый|ого) интеллект\\p{L}*", "\\b(этот|данный|наш) сценарий\\b", "\\bдиктор\\s*:", "\\bзакадров\\p{L}*", "\\bтаймкод\\p{L}*", "\\bфакт-?чек\\p{L}*", "\\bна экране\\s*:", "\\bсклейк\\p{L}*"].map(w),
  rehooks: ["и вот тут начинается самое интересное", "запомни эту деталь", "и нет, я это не придумал", "а теперь неудобный вопрос", "но есть проблема", "и вот что из этого следует"].map(w),
  stopwords: new Set("и а но или да нет не ни что как это то этот эта эти тот та те он она оно они его её ее их мы вы ты я мне меня нас вас вам им ему ей в во на по за под над из к ко с со у о об от до для при без через про же ли бы был была были было быть есть так там тут здесь где когда кто чем чтобы если уже ещё еще только очень всё все весь вся".split(" ")),
  longSentence: 22,
};
const PACKS: Record<Lang, Pack> = { en: EN, ru: RU };

// ---------- разбор текста ----------
type Word = { text: string; norm: string; para: number; sent: number };
type Sentence = { text: string; para: number; start: number; words: number };
type Paragraph = { text: string; start: number; words: number };
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

function parse(raw: string) {
  const text = raw.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").trim();
  let blocks = text.split(/\n\s*\n+/).map((t) => t.trim()).filter(Boolean);
  if (blocks.length === 1 && text.includes("\n")) blocks = text.split("\n").map((t) => t.trim()).filter(Boolean);
  const paragraphs: Paragraph[] = [], sentences: Sentence[] = [], words: Word[] = [];
  blocks.forEach((block, pi) => {
    const start = words.length;
    const parts = block.split(/(?<=[.!?…])["»”’)]*\s+(?=["«“„(]?[\p{Lu}\p{N}])/u).map((s) => s.trim()).filter(Boolean);
    for (const s of parts) {
      const ws = s.match(WORD) ?? [];
      sentences.push({ text: s, para: pi, start: words.length, words: ws.length });
      for (const x of ws) words.push({ text: x, norm: x.toLowerCase().replace(/’/g, "'"), para: pi, sent: sentences.length - 1 });
    }
    paragraphs.push({ text: block, start, words: words.length - start });
  });
  return { paragraphs, sentences, words };
}
export function detectLanguage(text: string): Lang {
  const cyr = (text.match(/[а-яё]/giu) ?? []).length, lat = (text.match(/[a-z]/gi) ?? []).length;
  return cyr > lat ? "ru" : "en";
}
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// ---------- проверка ----------
export function lintScript(raw: string, o: LintOptions = {}): LintReport {
  const lang: Lang = o.language?.startsWith("ru") ? "ru" : o.language?.startsWith("en") ? "en" : detectLanguage(raw);
  const P = PACKS[lang];
  const wpm = o.wpm && o.wpm > 40 && o.wpm < 300 ? o.wpm : DEFAULT_WPM[lang];
  const { paragraphs, sentences, words } = parse(raw);
  const total = words.length;
  const at = (wordIndex: number) => mmss((wordIndex / wpm) * 60);
  const issues: LintIssue[] = [];
  const passed: string[] = [];
  const add = (x: LintIssue) => issues.push(x);
  const sentenceAt = (s: Sentence): LintItem => ({ paragraph: s.para + 1, at: at(s.start), quote: clip(s.text) });
  const findAll = (rxs: Rx[], within: Sentence[] = sentences) => {
    const out: { s: Sentence; rx: Rx; match: string }[] = [];
    for (const s of within) for (const rx of rxs) { const m = rx.exec(s.text); if (m) { out.push({ s, rx, match: m[0] }); break; } }
    return out;
  };

  // 1. Длина
  const minutes = total / wpm;
  let targetWords: number | undefined;
  if (o.targetMinutes && o.targetMinutes > 0) {
    targetWords = Math.round(o.targetMinutes * wpm);
    const dev = (total - targetWords) / targetWords;
    if (Math.abs(dev) > 0.1) add({ rule: "length", severity: "error", title: `Длина ${total} слов (≈${mmss(minutes * 60)}) при цели ${targetWords} (${o.targetMinutes} мин): ${dev > 0 ? "+" : ""}${Math.round(dev * 100)}%`, advice: dev > 0 ? "Сократите: уберите абзацы, которые повторяют тему или настроение, и лишние оговорки." : "Добавьте содержание: ещё один поворот или пример, а не воду." });
    else if (Math.abs(dev) > 0.05) add({ rule: "length", severity: "info", title: `Длина ${total} слов при цели ${targetWords}: ${dev > 0 ? "+" : ""}${Math.round(dev * 100)}% — в допуске ±10%`, advice: "Можно оставить." });
    else passed.push("Длина в пределах ±5% от цели");
  }

  // 2. Хук: в первые ~15 секунд — вопрос, противоречие или ставки
  const hookWords = Math.round((15 / 60) * wpm);
  const hookSents = sentences.filter((s) => s.start < hookWords);
  const hookText = hookSents.map((s) => s.text).join(" ");
  const firstQ = sentences.find((s) => s.text.includes("?"));
  const hookOk = P.contradiction.test(hookText) || /\d/.test(hookText);
  if (!hookOk) add({ rule: "hook", severity: "error", title: "Хук не цепляет: в первые 15 секунд нет вопроса, противоречия или ставок", advice: `Начните с удара: образ → противоречие → вопрос${firstQ ? ` (сейчас первый вопрос звучит только на ${at(firstQ.start)})` : ""}. Первая фраза должна подтвердить обещание названия и превью.`, paragraph: 1, at: "0:00", quote: clip(hookText, 220) });
  else passed.push("В первые 15 секунд есть вопрос или противоречие");

  // 3. Описательное вступление: первые фразы рисуют картинку без конфликта
  const opening = sentences.slice(0, 3);
  const sceneHits = opening.filter((s) => P.scene.some((rx) => rx.test(s.text)));
  const openingHasHook = opening.slice(0, 2).some((s) => P.contradiction.test(s.text));
  if (sceneHits.length >= 2 && !openingHasHook) add({ rule: "opening-descriptive", severity: "error", title: "Описательное вступление: зритель слушает описание сцены, а не вопрос", advice: "Не описывайте картинку — её покажет видеоряд. Скажите смысл картинки: в чём конфликт и почему это важно зрителю.", items: sceneHits.map(sentenceAt) });
  else passed.push("Вступление не описательное");

  // 4. Рамки и «в этом видео» в первую минуту
  const firstMinute = sentences.filter((s) => s.start < wpm);
  const metaHits = findAll(P.meta, firstMinute);
  if (metaHits.length) add({ rule: "opening-meta", severity: "warn", title: "Рамки в начале: объявление темы вместо истории", advice: "Уберите «мы остановимся на…/в этом видео…»: рамки покажите картой или подписью на экране, а время — потратьте на хук.", items: metaHits.map((h) => sentenceAt(h.s)) });
  else passed.push("Нет объявлений «в этом видео…» в первую минуту");

  // 5. Оговорки: не больше 1 примерно на 2 минуты
  const allowed = Math.max(1, Math.floor(minutes / 2));
  const hedgeHits = findAll(P.hedges);
  if (hedgeHits.length > allowed) add({ rule: "hedges", severity: "error", title: `Оговорок ${hedgeHits.length} при норме ${allowed} (1 на ~2 минуты)`, advice: "Оставьте оговорку только там, где без неё будет неправда, и одной короткой фразой. Остальное — в отчёт проверки фактов, не в текст.", items: hedgeHits.map((h) => ({ ...sentenceAt(h.s), quote: clip(h.s.text, 140), match: h.match })) });
  else passed.push(`Оговорок ${hedgeHits.length} — в норме (до ${allowed})`);
  const clustered = new Map<number, number>();
  for (const h of hedgeHits) clustered.set(h.s.para, (clustered.get(h.s.para) ?? 0) + 1);
  const clusters = [...clustered.entries()].filter(([, n]) => n >= 2);
  if (clusters.length) add({ rule: "hedges-cluster", severity: "warn", title: `Абзацев с двумя и более оговорками: ${clusters.length}`, advice: "Пачка оговорок звучит как дисклеймер. Оставьте одну у самого спорного утверждения.", items: clusters.map(([para, n]) => ({ paragraph: para + 1, at: at(paragraphs[para].start), quote: clip(paragraphs[para].text, 140), match: `${n} ${n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "оговорки" : "оговорок"}` })) });

  // 6. Повторы фраз (4–7 слов)
  const content = (x: Word) => x.norm.length >= 3 && !P.stopwords.has(x.norm);
  const grams = new Map<string, number[]>();
  for (let n = 7; n >= 4; n--) {
    for (let i = 0; i + n <= total; i++) {
      const slice = words.slice(i, i + n);
      if (slice.some((x) => x.sent !== slice[0].sent)) continue;
      if (slice.filter(content).length < (n >= 5 ? 2 : 3)) continue;
      const key = slice.map((x) => x.norm).join(" ");
      (grams.get(key) ?? grams.set(key, []).get(key)!).push(i);
    }
  }
  // Сначала длинные и ранние; соседние совпадения склеиваются в одну фразу (до 14 слов).
  const repeats: { key: string; pos: number[]; len: number }[] = [];
  const inside = (p: number, r: { pos: number[]; len: number }) => r.pos.some((q) => p >= q && p < q + r.len);
  for (const [key, pos] of [...grams.entries()].sort((a, b) => b[0].split(" ").length - a[0].split(" ").length || a[1][0] - b[1][0])) {
    const n = key.split(" ").length;
    const distinct = pos.filter((p, i) => i === 0 || p - pos[i - 1] >= n);
    if (distinct.length < 2) continue;
    if (repeats.some((r) => distinct.every((p) => inside(p, r)))) continue; // часть уже найденного повтора
    let len = n;
    const same = (off: number) => distinct.every((p, i) => p + off < total && words[p + off].sent === words[p].sent && words[p + off].norm === words[distinct[0] + off].norm && (i === 0 || p - distinct[i - 1] > off));
    while (len < 14 && same(len)) len++;
    repeats.push({ key: words.slice(distinct[0], distinct[0] + len).map((x) => x.norm).join(" "), pos: distinct, len });
  }
  for (const r of repeats.slice(0, 8)) add({ rule: "repeat", severity: "warn", title: `Фраза повторяется ${r.pos.length} раза: «${r.key}»`, advice: "Одна и та же формулировка дважды звучит как повтор вывода. Оставьте одну или скажите по-новому.", items: r.pos.map((p) => sentenceAt(sentences[words[p].sent])) });
  if (!repeats.length) passed.push("Нет повторяющихся фраз");
  for (const rx of P.rehooks) {
    const hits = sentences.filter((s) => rx.test(s.text));
    if (hits.length >= 2) add({ rule: "rehook-repeat", severity: "warn", title: "Один и тот же ре-хук дважды", advice: "Чередуйте ре-хуки: повтор слышен сразу.", items: hits.map(sentenceAt) });
  }

  // 7. Призывы и «ложный финал» в середине
  const ctaHits = findAll(P.cta);
  const pos = (s: Sentence) => (total ? s.start / total : 0);
  const early = ctaHits.filter((h) => pos(h.s) < 0.3);
  const middle = ctaHits.filter((h) => pos(h.s) >= 0.3 && pos(h.s) < 0.85);
  const lastPara = paragraphs.length - 1;
  if (early.length) add({ rule: "cta-early", severity: "warn", title: "Призыв подписаться слишком рано", advice: "До первых 30% зритель ещё не получил пользу. Перенесите мягкий призыв ближе к середине или в конец.", items: early.map((h) => sentenceAt(h.s)) });
  if (middle.length > 1) add({ rule: "cta-many", severity: "warn", title: `${middle.length} призыва в середине`, advice: "Оставьте один мягкий призыв в середине и вопрос для комментариев в конце.", items: middle.map((h) => sentenceAt(h.s)) });
  const falseEnd = findAll(P.farewell).filter((h) => pos(h.s) < 0.85);
  if (falseEnd.length) add({ rule: "false-ending", severity: "warn", title: "В середине звучит прощание («next time», «до встречи»)", advice: "Такие слова сигналят конец ролика — часть зрителей уходит. В середине призыв без прощания, например: «если нравится — подпишитесь, дальше самое интересное».", items: falseEnd.map((h) => sentenceAt(h.s)) });
  const endsWithQuestion = !!paragraphs[lastPara]?.text.trim().endsWith("?") || ctaHits.some((h) => h.s.para === lastPara);
  if (!endsWithQuestion) add({ rule: "cta-end", severity: "info", title: "В конце нет вопроса зрителю", advice: "Закончите вопросом, на который хочется ответить в комментариях.", paragraph: lastPara + 1 });
  else passed.push("В конце есть вопрос или призыв");

  // 8. Один финал: после итогового абзаца не должно быть ещё одного «итога»
  const tailFrom = Math.floor(paragraphs.length * 0.7);
  const isCtaPara = (i: number) => paragraphs[i].text.trim().endsWith("?") && paragraphs[i].words < 45 || ctaHits.some((h) => h.s.para === i && i === lastPara);
  const conclusionIdx = paragraphs.findIndex((p, i) => i >= tailFrom && P.conclusion.some((rx) => rx.test(p.text.trim())));
  if (conclusionIdx >= 0) {
    const after = paragraphs.map((_, i) => i).filter((i) => i > conclusionIdx && !isCtaPara(i));
    if (after.length) add({ rule: "double-ending", severity: "warn", title: `Два финала: после итога ещё ${after.length} ${after.length === 1 ? "абзац с выводом" : "абзаца"}`, advice: "Вывод звучит дважды. Оставьте один финал — сильнейший — и сразу вопрос зрителю.", items: [conclusionIdx, ...after].map((i) => ({ paragraph: i + 1, at: at(paragraphs[i].start), quote: clip(paragraphs[i].text, 180) })) });
    else passed.push("Один финал");
  } else passed.push("Один финал");

  // 9. Длина предложений
  const counted = sentences.filter((s) => s.words > 0);
  const avg = counted.length ? total / counted.length : 0;
  const long = counted.filter((s) => s.words > P.longSentence);
  if (avg > 16) add({ rule: "sentences", severity: "warn", title: `Средняя длина предложения ${avg.toFixed(1)} слова — тяжело на слух`, advice: "Для уха 8–14 слов: одна мысль на предложение." });
  else if (avg && avg < 6) add({ rule: "sentences", severity: "info", title: `Средняя длина предложения ${avg.toFixed(1)} слова — рубленый текст`, advice: "Чередуйте: длинное задаёт сцену, короткое бьёт." });
  else passed.push(`Средняя длина предложения ${avg.toFixed(1)} слова`);
  if (long.length) add({ rule: "long-sentences", severity: long.length > 5 ? "warn" : "info", title: `Длинных предложений (больше ${P.longSentence} слов): ${long.length}`, advice: "Разбейте на два: диктору нужно дышать, зрителю — успевать.", items: long.slice(0, 8).map(sentenceAt) });

  // 10. Слова-штампы, канцелярит, пустой саспенс, упоминания ИИ и производства
  const bag: [Rx[], string, string, LintSeverity][] = [
    [P.stop, "stopwords", "Штампы, которые зритель пропускает", "warn"],
    [P.bureaucratic, "bureaucratic", "Канцелярит", "warn"],
    [P.suspense, "empty-suspense", "Пустой саспенс вместо события", "warn"],
    [P.production, "production", "Упоминания ИИ, сценария или монтажа в тексте диктора", "error"],
  ];
  for (const [rxs, rule, title, severity] of bag) {
    const hits = findAll(rxs);
    if (hits.length) add({ rule, severity, title: `${title}: ${hits.length}`, advice: rule === "empty-suspense" ? "Замените обещание «шока» конкретным событием." : rule === "production" ? "Диктор читает только то, что слышит зритель. Служебное — в заметки." : "Скажите проще и конкретнее.", items: hits.slice(0, 10).map((h) => ({ ...sentenceAt(h.s), quote: clip(h.s.text, 140), match: h.match })) });
    else passed.push(title.replace(/^./, (c) => `Нет: ${c.toLowerCase()}`));
  }
  // Квадратные/круглые скобки и метки диктор прочитает вслух (и озвучка возьмёт за них деньги).
  const isLabel = (s: Sentence) => s.start === paragraphs[s.para].start && /^\s*\p{Lu}[\p{L}-]{1,15}(?: [\p{L}-]{1,15})?\s*:\s/u.test(s.text);
  const brackets = sentences.filter((s) => /[[\]{}]|\([^)]{0,80}\)/u.test(s.text.replace(/\{\{pause\}\}/g, "")) || isLabel(s));
  if (brackets.length) add({ rule: "brackets", severity: "warn", title: `Скобки или метки, которые диктор прочитает вслух: ${brackets.length}`, advice: "Уберите [ ], ( ) и «Диктор:» из текста озвучки; паузы — только {{pause}}.", items: brackets.slice(0, 10).map(sentenceAt) });

  // 11. Долгие отрезки без вопроса или поворота (ре-хук каждые 30–90 с)
  const gapWords = Math.round((120 / 60) * wpm);
  let lastTurn = 0;
  const gaps: LintItem[] = [];
  for (const s of sentences) {
    if (P.contradiction.test(s.text)) { if (s.start - lastTurn > gapWords) gaps.push({ paragraph: s.para + 1, at: `${at(lastTurn)}–${at(s.start)}`, quote: clip(s.text) }); lastTurn = s.start; }
  }
  if (total - lastTurn > gapWords) gaps.push({ paragraph: paragraphs.length, at: `${at(lastTurn)}–${at(total)}`, quote: "" });
  if (gaps.length) add({ rule: "rehook-gap", severity: "info", title: `Отрезков больше 2 минут без вопроса или поворота: ${gaps.length}`, advice: "Каждые 30–90 секунд — новый вопрос, «но» или смена смысла.", items: gaps });

  const order: Record<LintSeverity, number> = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    language: lang, words: total, paragraphs: paragraphs.length, wpm, minutes: Math.round(minutes * 10) / 10, duration: mmss(minutes * 60),
    targetWords, sentences: { count: counted.length, avgWords: Math.round(avg * 10) / 10, long: long.length },
    hedges: { count: hedgeHits.length, allowed },
    issues, errors: issues.filter((x) => x.severity === "error").length, warnings: issues.filter((x) => x.severity === "warn").length, passed,
  };
}
