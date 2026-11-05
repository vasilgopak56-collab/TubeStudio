// Нарезка озвучки на сцены (Выпуск 2, карточка 200): одна сцена — фраза на 4–8 секунд под длину клипа Flow/Veo.
// «Ритм» — короткие фразы объединяются, длинные делятся по смыслу; «Предложение» — сцена на предложение.
// Текст не пропускается, не пересказывается и не переставляется. Границы — по реальным субтитрам Lumean,
// а без озвучки — по скорости речи (английский 2,6 слова в секунду, русский 2,0).

export type SceneMode = "rhythm" | "sentence";
export type SceneCut = { text: string; words: number; paragraph: number };
export type TimedScene = SceneCut & { start: number; end: number; seconds: number };
export type Cue = { start: number; end: number; text: string };

/** Слов в секунду для оценки длительности. */
export const wordsPerSecond = (language: string) => (language.toLowerCase().startsWith("ru") ? 2.0 : 2.6);
const countWords = (s: string) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’.,-]*/gu) ?? []).length;

const ABBR = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|vs|etc|e\.g|i\.e|approx|No|Vol|Fig|Inc|Ltd|Co|Corp|Gen|Col|Capt|Lt|Sgt|Rev|Gov|Sen|Rep|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|т\.е|т\.д|т\.п|др|см|г|гг|ул|им)\.|\b\p{Lu}\.)$/u;
/** Предложения абзаца: деление после . ! ? … (с кавычкой/скобкой), кроме сокращений и инициалов. */
export function sentences(paragraph: string): string[] {
  const out: string[] = [];
  const re = /[.!?…]+["'”’»)\]]*(?=\s+|$)/gu;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(paragraph))) {
    const end = m.index + m[0].length;
    const piece = paragraph.slice(last, end);
    if (m[0] === "." && ABBR.test(piece.trimEnd())) continue;
    if (piece.trim()) out.push(piece.trim());
    last = end;
  }
  const tail = paragraph.slice(last).trim();
  if (tail) out.push(tail);
  return out;
}

/** Делит длинный отрывок по знакам препинания ближе к середине; без знаков — поровну по словам. */
function splitLong(text: string, maxWords: number): string[] {
  const n = countWords(text);
  if (n <= maxWords) return [text];
  const tokens = text.split(/\s+/).filter(Boolean);
  const parts = Math.ceil(n / maxWords);
  const ideal = tokens.length / parts;
  // Точки деления: после запятой, точки с запятой, двоеточия, тире.
  const cuts: number[] = [];
  tokens.forEach((t, i) => { if (i < tokens.length - 1 && /[,;:]$|^[—–-]$/.test(t)) cuts.push(i + 1); });
  let best = -1, bestDist = Infinity;
  for (const c of cuts) { const d = Math.abs(c - ideal); if (c >= 3 && tokens.length - c >= 3 && d < bestDist && d <= ideal * 0.6) { best = c; bestDist = d; } }
  const at = best > 0 ? best : Math.round(ideal);
  const head = tokens.slice(0, at).join(" "), rest = tokens.slice(at).join(" ");
  return [head, ...splitLong(rest, maxWords)];
}

/** Нарезка текста озвучки. */
export function cutScenes(text: string, o: { language: string; mode: SceneMode; maxSec: number }): SceneCut[] {
  const wps = wordsPerSecond(o.language);
  const maxWords = Math.max(6, Math.floor(wps * o.maxSec));
  const minWords = Math.max(3, Math.ceil(wps * 3));
  const target = Math.max(minWords, Math.round(maxWords * 0.8));
  const paragraphs = clean(text).split(/\n\s*\n+/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const out: SceneCut[] = [];
  const push = (t: string, paragraph: number) => { const s = t.trim(); if (s) out.push({ text: s, words: countWords(s), paragraph }); };
  paragraphs.forEach((para, pi) => {
    const sents = sentences(para);
    if (o.mode === "sentence") {
      // Сцена на предложение; длиннее 20 слов (или лимита клипа) — две и более сцены; очень короткие — к соседу.
      const limit = Math.min(20, maxWords);
      let carry = "";
      for (const s of sents) {
        const t = carry ? `${carry} ${s}` : s;
        if (countWords(t) < 4 && countWords(s) < 4) { carry = t; continue; }
        carry = "";
        for (const piece of splitLong(t, limit)) push(piece, pi + 1);
      }
      if (carry) { const prev = out[out.length - 1]; if (prev && prev.paragraph === pi + 1 && prev.words + countWords(carry) <= maxWords) { prev.text += ` ${carry}`; prev.words = countWords(prev.text); } else push(carry, pi + 1); }
      return;
    }
    // «Ритм»: собираем фразы до целевой длины, не превышая лимит клипа; конец абзаца — конец сцены.
    let cur: string[] = [], curWords = 0;
    const flush = () => { if (cur.length) push(cur.join(" "), pi + 1); cur = []; curWords = 0; };
    for (const s of sents) {
      const pieces = splitLong(s, maxWords);
      for (const [k, piece] of pieces.entries()) {
        const w = countWords(piece);
        const sentenceEnd = k === pieces.length - 1;
        if (curWords && curWords + w > maxWords) flush();
        cur.push(piece); curWords += w;
        if (sentenceEnd && curWords >= target) flush();
      }
    }
    // Хвост абзаца короче минимума: присоединяется к предыдущей сцене того же абзаца, если влезает,
    // иначе две последние сцены делятся заново по границе предложений ближе к середине.
    if (cur.length && curWords < minWords) {
      const prev = out[out.length - 1];
      if (prev && prev.paragraph === pi + 1) {
        const merged = `${prev.text} ${cur.join(" ")}`, mw = countWords(merged);
        if (mw <= Math.round(maxWords * 1.15)) { prev.text = merged; prev.words = mw; cur = []; curWords = 0; }
        else {
          const ss = sentences(merged);
          let best = -1, bestD = Infinity, acc = 0;
          for (let k = 0; k < ss.length - 1; k++) { acc += countWords(ss[k]); const d = Math.abs(acc - mw / 2); if (acc <= maxWords && mw - acc <= maxWords && d < bestD) { best = k; bestD = d; } }
          if (best >= 0) {
            const a = ss.slice(0, best + 1).join(" "), b = ss.slice(best + 1).join(" ");
            prev.text = a; prev.words = countWords(a); cur = [b]; curWords = countWords(b);
          }
        }
      }
    }
    flush();
  });
  return out;
}

/** Убирает служебные пометки, которых нет в звуке: паузы {{pause=1s}}, разметку. */
export function clean(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\{\{[^}]{0,80}\}\}/g, " ").replace(/[ \t]+/g, " ").replace(/ +([,.!?…:;])/g, "$1");
}

// ---------- субтитры Lumean (SRT / VTT) ----------
const ts = (s: string) => { const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(s); return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000 : NaN; };
export function parseSubtitles(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "").split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->");
    const start = ts(a), end = ts(b);
    const t = lines.slice(i + 1).join(" ").replace(/<[^>]{0,40}>/g, "").trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && t) cues.push({ start, end, text: t });
  }
  return cues.sort((x, y) => x.start - y.start);
}
const norm = (w: string) => w.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");
type TWord = { w: string; start: number; end: number };
/** Слова субтитров со временем: время фразы делится между словами по длине. */
export function wordTimeline(cues: Cue[]): TWord[] {
  const out: TWord[] = [];
  for (const c of cues) {
    const words = c.text.split(/\s+/).map(norm).filter(Boolean);
    if (!words.length) continue;
    const total = words.reduce((a, w) => a + w.length + 1, 0);
    let t = c.start;
    for (const w of words) { const d = (c.end - c.start) * (w.length + 1) / total; out.push({ w, start: t, end: t + d }); t += d; }
  }
  return out;
}

/** Время сцен: по субтитрам, если слова совпали хотя бы на 60 %; иначе по скорости речи
 *  (а при известной общей длине звука — пропорционально ей). */
export function timeScenes(scenes: SceneCut[], o: { language: string; cues?: Cue[] | null; audioSec?: number | null }): { scenes: TimedScene[]; timing: "audio" | "estimate"; matched: number } {
  const wps = wordsPerSecond(o.language);
  const tl = o.cues?.length ? wordTimeline(o.cues) : [];
  const tokens = scenes.map((s) => s.text.split(/\s+/).map(norm).filter(Boolean));
  if (tl.length) {
    const flat: { scene: number; w: string }[] = [];
    tokens.forEach((t, si) => t.forEach((w) => flat.push({ scene: si, w })));
    const at = new Array<number>(flat.length).fill(-1);
    let i = 0, j = 0, matched = 0;
    while (i < flat.length && j < tl.length) {
      if (flat[i].w === tl[j].w) { at[i++] = j++; matched++; continue; }
      let step = 0;
      for (let k = 1; k <= 6 && !step; k++) {
        if (j + k < tl.length && flat[i].w === tl[j + k].w) { j += k; step = 1; }
        else if (i + k < flat.length && flat[i + k].w === tl[j].w) { i += k; step = 1; }
      }
      if (!step) { at[i++] = j++; }
    }
    const share = flat.length ? matched / flat.length : 0;
    if (share >= 0.6) {
      const firstIdx = scenes.map((_, si) => flat.findIndex((f, k) => f.scene === si && at[k] >= 0));
      const starts = firstIdx.map((k) => (k >= 0 ? tl[at[k]].start : NaN));
      // Пропуски (сцена без сопоставленных слов) — середина между соседями.
      for (let s = 0; s < starts.length; s++) if (!Number.isFinite(starts[s])) starts[s] = s === 0 ? 0 : starts[s - 1];
      const endAll = tl[tl.length - 1].end;
      const timed = scenes.map((sc, s) => {
        const start = Math.max(0, s === 0 ? Math.min(starts[0], tl[0].start) : starts[s]);
        const end = s < scenes.length - 1 ? Math.max(start, starts[s + 1]) : Math.max(start, endAll);
        return { ...sc, start: r2(start), end: r2(end), seconds: r2(end - start) };
      });
      return { scenes: timed, timing: "audio", matched: Math.round(share * 100) };
    }
  }
  const words = scenes.reduce((a, s) => a + s.words, 0) || 1;
  const scale = o.audioSec && o.audioSec > 0 ? o.audioSec / (words / wps) : 1;
  let t = 0;
  const timed = scenes.map((sc) => { const d = (sc.words / wps) * scale; const s = { ...sc, start: r2(t), end: r2(t + d), seconds: r2(d) }; t += d; return s; });
  return { scenes: timed, timing: "estimate", matched: 0 };
}
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Крупность чередуется, два одинаковых плана подряд не ставятся (карточка 200). */
const SHOTS = ["wide", "medium", "close-up", "detail", "medium", "wide", "close-up", "medium"] as const;
export const shotFor = (i: number) => SHOTS[i % SHOTS.length];
