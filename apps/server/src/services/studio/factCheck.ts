// Проверка фактов готового сценария (мастер-промпт, шаг 03 «Проверка фактов»).
// YouTube ограничивает монетизацию роликов с недостоверными фактами, поэтому каждое проверяемое
// утверждение выписывается с точной цитатой и получает вердикт, причину и исправление.
// Предложения режет код (так же, как проверка кодом), модель только находит утверждения и проверяет их
// поиском Google; исправления по предложениям вносит код, дальше в работу идёт исправленный текст.
// Источники — только из выдачи поиска: ссылки, которых поиск не возвращал, отбрасываются.
import { z } from "zod";
import { ApiError, rethrowFinancial } from "../../lib/errors.js";
import { rethrowCancelled } from "../../lib/taskContext.js";
import type { JobCtx } from "../../lib/jobs.js";
import { log } from "../../lib/logging.js";
import { assertChannelBudget, type Channel } from "./channels.js";
import { DEFAULT_WPM } from "./scriptLint.js";

export type FactVerdict = "true" | "false" | "misleading" | "unverified";
export const VERDICT_RU: Record<FactVerdict, string> = { true: "верно", false: "неверно", misleading: "вводит в заблуждение", unverified: "не удалось проверить" };
const RANK: Record<FactVerdict, number> = { true: 0, unverified: 1, misleading: 2, false: 3 };
export type FactSource = { title: string; url: string };
export type FactClaim = { text: string; kind: string; verdict: FactVerdict; why: string };
export type FactItem = {
  /** «3.2» — абзац.предложение. */
  id: string; paragraph: number; at: string; quote: string; claims: FactClaim[]; verdict: FactVerdict;
  /** null — оставить как есть; "" — убрать предложение; иначе — исправленное предложение. */
  fix: string | null; applied: boolean; sources: FactSource[]; mode: "web" | "model"; note?: string;
};
export type FactCheckReport = {
  mode: "web" | "model" | "mixed"; models: string[]; at: string; items: FactItem[];
  summary: { total: number; true: number; false: number; misleading: number; unverified: number };
  /** Предложений исправлено / убрано / осталось с неточностью без исправления. */
  changed: number; removed: number; remaining: number; passed: boolean; checked: number; skipped: number;
  sources: FactSource[]; notes: string[]; hash: string; words: number;
};
export type FactStatus = "none" | "stale" | "issues" | "passed";

// ---------- текст: абзацы и предложения (нумерация как в проверке кодом) ----------
type Sent = { id: string; para: number; text: string; sep: string; word: number };
type Block = { n: number; lead: string; sents: Sent[]; trail: string };
type Doc = { blocks: Block[]; seps: string[] };
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const BOUNDARY = /(?<=[.!?…])(["»”’)]*)(\s+)(?=["«“„(]?[\p{Lu}\p{N}])/gu;
/** Сокращения и инициалы, после которых предложение не кончается: «Dr. Smith», «J. K. Rowling», «1812 г. Наполеон». */
const ABBR = /(?:^|[\s(«"“„])(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|Mt|vs|etc|e\.g|i\.e|г|гг|им|св|ул|см|стр|т\.\s?е|т\.\s?д|т\.\s?п|н\.\s?э|\p{Lu})\.$/u;

export function splitScript(raw: string): Doc {
  const text = raw.replace(/\r\n?/g, "\n");
  let pieces = text.split(/(\n\s*\n+)/);
  if (pieces.filter((x, i) => i % 2 === 0 && x.trim()).length === 1 && text.trim().includes("\n")) pieces = text.split(/(\n+)/);
  const blocks: Block[] = [], seps: string[] = [];
  let n = 0, word = 0;
  pieces.forEach((piece, i) => {
    if (i % 2) { seps.push(piece); return; }
    if (!piece.trim()) { blocks.push({ n: 0, lead: piece, sents: [], trail: "" }); return; }
    n++;
    const lead = piece.match(/^\s*/)![0], trail = piece.slice(lead.length).match(/\s*$/)![0];
    const body = piece.slice(lead.length, piece.length - trail.length);
    const sents: Sent[] = [];
    let start = 0, k = 0;
    const push = (end: number, sep: string, next: number) => {
      const t = body.slice(start, end);
      sents.push({ id: `${n}.${++k}`, para: n, text: t, sep, word });
      word += (t.match(WORD) ?? []).length;
      start = next;
    };
    for (const m of body.matchAll(BOUNDARY)) {
      if (ABBR.test(body.slice(start, m.index))) continue;
      push(m.index! + m[1].length, m[2], m.index! + m[0].length);
    }
    push(body.length, "", body.length);
    blocks.push({ n, lead, sents, trail });
  });
  return { blocks, seps };
}

/** Собирает текст обратно; предложение с текстом "" удаляется, пустой абзац — вместе с разделителем. */
export function joinScript(doc: Doc): string {
  const kept: { body: string; sep: string }[] = [];
  doc.blocks.forEach((b, i) => {
    const sep = doc.seps[i] ?? "";
    if (!b.n) { kept.push({ body: b.lead, sep }); return; }
    const live = b.sents.filter((s) => s.text !== "");
    if (!live.length) return;
    kept.push({ body: b.lead + live.map((s, k) => s.text + (k < live.length - 1 ? s.sep || " " : "")).join("") + b.trail, sep });
  });
  return kept.map((x, k) => x.body + (k < kept.length - 1 ? x.sep || "\n\n" : "")).join("");
}

const numbered = (doc: Doc) => doc.blocks.filter((b) => b.n).map((b) => b.sents.map((s) => `${s.id} ${s.text}`).join("\n")).join("\n\n");
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const countWords = (t: string) => (t.match(WORD) ?? []).length;

/** Отпечаток текста: интерфейс сравнивает его с текущим текстом, чтобы понять, менялся ли сценарий после проверки. */
export function textHash(t: string): string {
  const s = t.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${h.toString(16).padStart(8, "0")}:${s.length}`;
}
export function factStatus(script: string | undefined, report: Pick<FactCheckReport, "hash" | "passed"> | null | undefined): FactStatus {
  if (!report || !script) return "none";
  if (report.hash !== textHash(script)) return "stale";
  return report.passed ? "passed" : "issues";
}

// ---------- обращения к моделям (подменяются в тестах) ----------
export type ClaimIn = { text: string; kind: string };
export type ExtractOut = { items: { id: string; claims: ClaimIn[] }[]; model: string };
export type VerifyBatch = { id: string; sentence: string; context: string; claims: ClaimIn[] }[];
export type VerifyOut = { items: { id: string; claims: { verdict: FactVerdict; why: string }[]; fix: string | null; sources: string[] }[]; model: string; sources: FactSource[] };
export type FactAi = {
  extract(p: { numbered: string; lang: string; topic: string; hints: string[]; model?: string }): Promise<ExtractOut>;
  verifyWeb(p: { batch: VerifyBatch; lang: string; topic: string }): Promise<VerifyOut>;
  verifyModel(p: { batch: VerifyBatch; lang: string; topic: string; reference: string; model?: string }): Promise<VerifyOut>;
};

// Схемы мягкие: лишнее и пустое отбрасывает код, а не повторный платный запрос.
const Id = z.union([z.string(), z.number()]).transform((x) => String(x).replace(/^\[|\]$/g, "").trim());
const Extracted = z.object({ items: z.array(z.object({
  id: Id,
  claims: z.array(z.object({ text: z.coerce.string().default(""), kind: z.coerce.string().default("other") })).default([]),
})) });
const normVerdict = (v: unknown) => {
  const s = String(v ?? "").toLowerCase().trim();
  if (/mislead|partly|partial|half|exaggerat|частично|вводит|преувелич/.test(s)) return "misleading";
  if (/unverif|unknown|unclear|not verified|cannot|can't|insufficient|не удалось|непровер|неизвест/.test(s)) return "unverified";
  if (/^(false|incorrect|wrong|inaccurate|неверно|ложь|ошибка|не верно)$/.test(s)) return "false";
  if (/^(true|correct|accurate|confirmed|verified|верно|правда|подтверждено)$/.test(s)) return "true";
  return s;
};
const Verified = z.object({ items: z.array(z.object({
  id: Id,
  claims: z.array(z.object({ verdict: z.preprocess(normVerdict, z.enum(["true", "false", "misleading", "unverified"])), why: z.coerce.string().default("") })).default([]),
  fix: z.string().nullable().default(null),
  sources: z.array(z.coerce.string()).default([]),
})) });
const SCHEMA = `{"items":[{"id":"3.2","claims":[{"verdict":"true|false|misleading|unverified","why":"…"}],"fix":null,"sources":["https://…"]}]}`;

const langName = async (lang: string) => { const { LANG_NAME } = await import("../llm.js"); return LANG_NAME[lang] ?? lang; };
const rules = (L: string) => `For every sentence give a verdict for each of its claims, in the same order:
- "true" — confirmed by reliable sources;
- "false" — contradicted by reliable sources;
- "misleading" — partly true but creates a wrong impression: missing context, exaggeration, a rare case presented as the rule, correlation presented as cause, outdated figures;
- "unverified" — no reliable confirmation found.
why: 1–2 sentences in Russian — what reliable sources actually say.
fix: null if every claim of the sentence is true. Otherwise the WHOLE corrected sentence in ${L}, ready to be read aloud: the same style, tone and roughly the same length; no brackets, links or footnote marks. Replace a wrong fact with the correct one; for an unverified detail drop it or make it less precise but certainly true; keep a disputed point only as one honest caveat. Prefer dropping or generalising a detail over adding caveats such as "reportedly". Use "" (empty string) to delete the sentence only when it cannot be saved and the neighbouring sentences still read well without it.
Never invent facts, studies, numbers, quotes or sources. A fictional or hypothetical story element is not an error, but real-world facts inside it must be correct.`;
const batchText = (batch: VerifyBatch) => batch.map((x) => `[${x.id}] «${x.sentence}»${x.context ? `\n  context before: «${x.context.slice(0, 400)}»` : ""}\n  claims:\n${x.claims.map((c, k) => `  ${k + 1}) ${c.text}`).join("\n")}`).join("\n\n");

export const llmFactAi: FactAi = {
  async extract({ numbered: text, lang, topic, hints, model }) {
    const { generateJson } = await import("../llm.js");
    const r = await generateJson({
      model, maxTokens: 12000, temperature: 0.1,
      system: "You are a professional fact-checker preparing a YouTube narration script for publication. YouTube limits monetisation of videos with false or misleading claims, so every checkable claim must be found. At this step you only FIND claims — do not judge them.",
      user: `Find every checkable factual claim in the SCRIPT (${await langName(lang)}):
- numbers, statistics, percentages, amounts, durations;
- dates, years, ages, periods;
- people, organisations, places, books, studies and experiments — and what they did, found or said;
- quotes and who said them;
- causes and effects ("X leads to Y", "because of X");
- scientific, medical, psychological and historical facts; records and superlatives ("the first", "the largest", "most people").
Skip opinions, rhetorical questions, addresses to the viewer, obvious metaphors and clearly hypothetical or fictional story elements ("imagine…", an invented character) — but list real-world facts mentioned inside such stories.
Every sentence of the script starts with its id "paragraph.sentence" (for example 3.2). One item per sentence that contains claims. Each claim is a short self-contained statement in Russian (resolve "he", "it", "this" from context) with its kind.${hints.length ? `\nThe author's plan flagged these claims for checking — find where they appear: ${hints.slice(0, 12).join("; ").slice(0, 2000)}` : ""}
Topic: ${topic}
Return {"items":[{"id":"3.2","claims":[{"text":"…","kind":"number|date|name|quote|cause|science|history|other"}]}]}

SCRIPT:
${text}`,
    }, Extracted);
    return { items: r.data.items, model: r.model };
  },
  async verifyWeb({ batch, lang, topic }) {
    const { geminiGrounded, extractJson, generateJson } = await import("../llm.js");
    const g = await geminiGrounded(
      "You are a meticulous fact-checker for YouTube scripts. Verify every claim with Google Search before answering. Answer with JSON only.",
      `Fact-check sentences from a YouTube narration script about: ${topic}
${rules(await langName(lang))}
sources: URLs of the pages that confirm or refute the claims — only pages you actually found in the search.
Return ONLY JSON: ${SCHEMA}

SENTENCES:
${batchText(batch)}`, 8000);
    if (g.text.trim().length < 20) throw new ApiError("UPSTREAM", "Поиск вернул пустой ответ", 502, true);
    let data: z.infer<typeof Verified> | null = null;
    try { const p = Verified.safeParse(extractJson(g.text)); if (p.success) data = p.data; } catch (e) { rethrowCancelled(e); }
    if (!data) {
      const r = await generateJson({
        fast: true, maxTokens: 8000, temperature: 0,
        system: "Convert a fact-checker's answer into JSON exactly per the schema. Keep verdicts, explanations, corrected sentences and URLs as they are; add nothing.",
        user: `Schema: ${SCHEMA}\nSentence ids: ${batch.map((x) => x.id).join(", ")}\n\nANSWER:\n${g.text.slice(0, 40_000)}`,
      }, Verified);
      data = r.data;
    }
    return { items: data.items, model: g.model, sources: g.sources };
  },
  async verifyModel({ batch, lang, topic, reference, model }) {
    const { generateJson } = await import("../llm.js");
    const r = await generateJson({
      model, maxTokens: 8000, temperature: 0.1,
      system: "You are a meticulous fact-checker for YouTube scripts. Web search is NOT available: rely on well-established knowledge only and be strict — anything you are not certain about is \"unverified\".",
      user: `Fact-check sentences from a YouTube narration script about: ${topic}
${rules(await langName(lang))}
sources: [] — you cannot search, never give URLs.${reference ? `\nResearch notes collected before writing (useful hints, not proof):\n${reference.slice(0, 5000)}` : ""}
Return ONLY JSON: ${SCHEMA}

SENTENCES:
${batchText(batch)}`,
    }, Verified);
    return { items: r.data.items, model: r.model, sources: [] };
  },
};
let ai: FactAi = llmFactAi;
/** Для тестов: подмена обращений к моделям. */
export function setFactAi(x: FactAi | null) { ai = x ?? llmFactAi; }

// ---------- источники: только из выдачи поиска ----------
const host = (u: string) => {
  const s = u.trim().toLowerCase();
  try { return new URL(/^https?:\/\//.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, ""); } catch { return ""; }
};
const REDIRECT = /vertexaisearch\.cloud\.google\.com|google\.com\/(?:url|grounding)/i;
const foundHost = (f: FactSource) => REDIRECT.test(f.url) ? host(f.title) : host(f.url);
export function pickSources(cited: string[], found: FactSource[]): FactSource[] {
  const out: FactSource[] = [];
  for (const c of cited) {
    const h = host(c);
    const hit = found.find((f) => f.url === c.trim()) ?? (h ? found.find((f) => { const fh = foundHost(f); return !!fh && (fh === h || fh.endsWith(`.${h}`) || h.endsWith(`.${fh}`)); }) : undefined);
    if (hit && !out.some((x) => x.url === hit.url)) out.push(hit);
  }
  return out.slice(0, 5);
}

/** Исправление модели → одно предложение для озвучки; null — не применять. */
function cleanFix(fix: string | null, quote: string): { fix: string | null; note?: string } {
  if (fix === null) return { fix: null };
  let f = fix.replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g, "").replace(/\s*\(?https?:\/\/\S+\)?/g, "").replace(/\s+/g, " ").trim();
  if (/^null$/i.test(f)) return { fix: null };
  const wrap = f.match(/^[«"“](.*)[»"”]$/s);
  if (wrap && !/^[«"“]/.test(quote)) f = wrap[1].trim();
  if (f === quote.trim()) return { fix: null };
  if (f.length > Math.max(quote.length * 2.5, quote.length + 300)) return { fix: null, note: "Исправление модели оказалось намного длиннее предложения и не применено — поправьте вручную." };
  // Защита от исправления «не того» предложения: у правки и оригинала должны быть общие слова.
  const bag = (t: string) => new Set((t.toLowerCase().match(WORD) ?? []).filter((w) => w.length >= 3 || /\d/.test(w)));
  const a = bag(quote), b = bag(f);
  if (f && a.size >= 4 && b.size >= 4 && [...a].filter((w) => b.has(w)).length / Math.min(a.size, b.size) < 0.25) return { fix: null, note: "Исправление модели не похоже на это предложение и не применено — поправьте вручную." };
  return { fix: f };
}

const BATCH = 12, MAX_ITEMS = 120;
/** Верхняя граница запросов проверки фактов по числу предложений текста. Модели — те, что сработают первыми; резервные не запускаются. */
export async function factCheckPlan(text: string, model: string): Promise<import("../paidRun.js").PlannedCall[]> {
  const { firstModel, groundedModels } = await import("../llm.js");
  const sentences = splitScript(text.replace(/\r\n?/g, "\n")).blocks.reduce((n, b) => n + b.sents.length, 0);
  const batches = Math.max(1, Math.ceil(Math.min(sentences, MAX_ITEMS) / BATCH));
  const critic = await firstModel({ model }), fast = await firstModel({ fast: true });
  const web = await groundedModels(), webText = web.find((x) => x.kind === "text"), webSearch = web.find((x) => x.kind === "search");
  const call = (step: string, m: { provider: string; model: string } | undefined, count: number, inputChars: number, maxTokens: number, kind: "text" | "search" = "text") =>
    m ? [{ step, provider: m.provider, model: m.model, kind, count, inputChars, maxTokens }] : [];
  return [
    ...call("выписать утверждения", critic, 1, Math.min(text.length, 90_000) + 4000, 12_000),
    ...call("поиск Google", webText, batches, 6000, 8000), ...call("поиск", webSearch, batches, 0, 0, "search"),
    ...call("разбор ответа поиска", fast, batches, 20_000, 8000),
    ...call("по знаниям модели", critic, batches, 8000, 8000),
  ];
}
export type FactCheckInput = {
  text: string; channel: Pick<Channel, "id" | "language">; topic: string;
  /** Модель для поиска утверждений и для проверки без поиска (другой семьи, чем автор). */
  model?: string; hints?: string[]; reference?: string;
};

/** Проверка фактов: утверждения → вердикты (поиск Google, иначе знания модели) → исправленный текст. */
export async function checkFacts(i: FactCheckInput, ctx: JobCtx): Promise<{ report: FactCheckReport; script: string }> {
  const text = i.text.replace(/\r\n?/g, "\n");
  if (countWords(text) < 5) throw new ApiError("VALIDATION", "Слишком короткий текст для проверки фактов", 400);
  const lang = i.channel.language.slice(0, 2).toLowerCase();
  const wpm = (DEFAULT_WPM as Record<string, number>)[lang] ?? 140;
  const doc = splitScript(text);
  const sents = doc.blocks.flatMap((b) => b.sents);
  const byId = new Map(sents.map((s, k) => [s.id, { s, k }]));
  const notes: string[] = [];
  const models = new Set<string>();

  await assertChannelBudget(i.channel.id);
  ctx.progress("Проверка фактов: выписываю утверждения", 3);
  const ex = await ai.extract({ numbered: numbered(doc).slice(0, 90_000), lang, topic: i.topic, hints: i.hints ?? [], model: i.model });
  models.add(ex.model);
  const picked = new Map<string, { s: Sent; k: number; claims: ClaimIn[] }>();
  let unknown = 0;
  for (const it of ex.items) {
    const hit = byId.get(it.id);
    if (!hit) { unknown++; continue; }
    const cur = picked.get(hit.s.id) ?? { ...hit, claims: [] };
    for (const c of it.claims) {
      const t = c.text.replace(/\s+/g, " ").trim().slice(0, 500);
      if (t.length >= 2 && !cur.claims.some((x) => x.text === t) && cur.claims.length < 6) cur.claims.push({ text: t, kind: c.kind.trim().slice(0, 30) || "other" });
    }
    if (cur.claims.length) picked.set(hit.s.id, cur);
  }
  if (unknown) notes.push(`Модель указала ${unknown} несуществующих предложений — они пропущены.`);
  let list = [...picked.values()].sort((a, b) => a.k - b.k);
  const skipped = Math.max(0, list.length - MAX_ITEMS);
  if (skipped) { list = list.slice(0, MAX_ITEMS); notes.push(`Проверены первые ${MAX_ITEMS} предложений с фактами, ещё ${skipped} не проверены: сценарий очень длинный — проверьте его частями.`); }

  // Вердикты партиями: поиск Google; если поиск недоступен — знания модели другой семьи.
  type Res = VerifyOut["items"][number] & { mode: "web" | "model"; found: FactSource[] };
  const results = new Map<string, Res>();
  const allSources: FactSource[] = [];
  let webDown: string | null = null, webFails = 0;
  const batches: (typeof list)[] = [];
  for (let k = 0; k < list.length; k += BATCH) batches.push(list.slice(k, k + BATCH));
  for (let b = 0; b < batches.length; b++) {
    const done = b * BATCH;
    ctx.progress(`Проверка фактов ${webDown ? "по знаниям модели" : "поиском Google"}: ${done} из ${list.length} предложений`, 8 + Math.round((88 * b) / batches.length));
    await assertChannelBudget(i.channel.id);
    const batch: VerifyBatch = batches[b].map((x) => ({ id: x.s.id, sentence: x.s.text, context: sents[x.k - 1]?.text ?? "", claims: x.claims }));
    let out: VerifyOut | null = null, mode: "web" | "model" = "web";
    if (!webDown) {
      try { out = await ai.verifyWeb({ batch, lang, topic: i.topic }); webFails = 0; }
      catch (e) {
        rethrowCancelled(e); rethrowFinancial(e);
        const msg = (e as Error).message.slice(0, 200);
        webFails++;
        if ((e instanceof ApiError && (e.code === "KEY_MISSING" || e.code === "LLM_RATE_LIMIT")) || webFails >= 2) webDown = msg;
        else notes.push(`Часть ${b + 1}: поиск не ответил (${msg}) — эти предложения проверены по знаниям модели.`);
        log.warn({ event: "factcheck_web_failed", batch: b, code: e instanceof ApiError ? e.code : "?" });
      }
    }
    if (!out) {
      mode = "model";
      try { out = await ai.verifyModel({ batch, lang, topic: i.topic, reference: i.reference ?? "", model: i.model }); }
      catch (e) { rethrowCancelled(e); rethrowFinancial(e); notes.push(`Не удалось проверить ${batch.length} предложений (${(e as Error).message.slice(0, 160)}) — они отмечены как непроверенные.`); continue; }
    }
    models.add(out.model);
    const found = out.sources.filter((x) => /^https?:\/\//i.test(x.url));
    for (const f of found) if (!allSources.some((x) => x.url === f.url)) allSources.push(f);
    const ids = new Set(batch.map((x) => x.id));
    for (const r of out.items) if (ids.has(r.id) && !results.has(r.id)) results.set(r.id, { ...r, claims: r.claims.map((c) => ({ verdict: c.verdict, why: c.why.replace(/\s+/g, " ").trim().slice(0, 600) })), sources: r.sources.slice(0, 12), mode, found });
  }
  if (webDown) notes.unshift(`Поиск Google недоступен (${webDown}). Факты проверены по знаниям модели — это надёжнее, чем без проверки, но спорное лучше проверить вручную.`);

  // Отчёт и исправления (по одному предложению, остальной текст не трогается).
  const items: FactItem[] = list.map((x) => {
    const r = results.get(x.s.id);
    const claims: FactClaim[] = x.claims.map((c, k) => ({ text: c.text, kind: c.kind, verdict: r?.claims[k]?.verdict ?? "unverified", why: r?.claims[k]?.why ?? (r ? "Модель не дала вердикт по этому утверждению." : "Проверка не выполнена.") }));
    const verdict = claims.reduce<FactVerdict>((w, c) => (RANK[c.verdict] > RANK[w] ? c.verdict : w), "true");
    const f = verdict === "true" ? { fix: null } : cleanFix(r?.fix ?? null, x.s.text);
    return {
      id: x.s.id, paragraph: x.s.para, at: mmss((x.s.word / wpm) * 60), quote: x.s.text, claims, verdict, fix: f.fix, applied: false,
      sources: r?.mode === "web" ? pickSources(r.sources, r.found) : [], mode: r?.mode ?? "model",
      ...(f.note ? { note: f.note } : !r ? { note: "Проверка не выполнена." } : {}),
    };
  });
  const fixes = new Map(items.filter((x) => x.fix !== null).map((x) => [x.id, x.fix as string]));
  for (const b of doc.blocks) for (const s of b.sents) if (fixes.has(s.id)) s.text = fixes.get(s.id)!;
  const script = fixes.size ? joinScript(doc) : text;
  for (const x of items) x.applied = x.fix !== null;
  const claims = items.flatMap((x) => x.claims);
  const count = (v: FactVerdict) => claims.filter((c) => c.verdict === v).length;
  const modes = new Set(items.filter((x) => results.has(x.id)).map((x) => x.mode));
  const remaining = items.filter((x) => x.verdict !== "true" && !x.applied).length;
  if (!list.length) notes.push("Проверяемых утверждений (цифр, дат, имён, причин и следствий) в тексте не найдено.");
  const report: FactCheckReport = {
    mode: modes.size > 1 ? "mixed" : modes.has("model") || (webDown && !modes.size) ? "model" : "web",
    models: [...models].filter(Boolean), at: new Date().toISOString(), items,
    summary: { total: claims.length, true: count("true"), false: count("false"), misleading: count("misleading"), unverified: count("unverified") },
    changed: items.filter((x) => x.applied && x.fix !== "").length, removed: items.filter((x) => x.applied && x.fix === "").length,
    remaining, passed: remaining === 0 && skipped === 0, checked: list.length, skipped,
    sources: allSources.slice(0, 40), notes, hash: textHash(script), words: countWords(script),
  };
  ctx.progress("Проверка фактов: исправления внесены", 98);
  return { report, script };
}

/** Факты досье ресёрча — подсказка для проверки без поиска. */
export function dossierBrief(d: { facts?: { claim: string }[]; disputed?: string[] } | null | undefined): string {
  if (!d?.facts?.length) return "";
  return [...d.facts.map((f) => `- ${f.claim}`), ...(d.disputed ?? []).map((x) => `- disputed: ${x}`)].join("\n").slice(0, 5000);
}
