/**
 * Оценка видео перед публикацией: заголовок + обложка + хук + описание + теги + ключи → балл 0–100 и что исправить.
 * Локальные проверки (бесплатно, детерминированно) + один вызов LLM (с картинкой, если есть) + опционально анализ ключа (≈102 ед.).
 */
import crypto from "node:crypto";
import { z } from "zod";
import type { JobCtx } from "../lib/jobs.js";
import { readJson, writeJson } from "../lib/storage.js";
import { generateJson, LANG_NAME } from "./llm.js";
import { getSettings } from "./settings.js";
import { analyzeKeyword, type KwMetrics } from "./keywords.js";
import { saveCheck } from "./checksStore.js";

export const ScorecardInput = z.object({
  title: z.string().min(3).max(100),
  description: z.string().max(5000).default(""),
  tags: z.array(z.string().max(100)).max(60).default([]),
  keywords: z.array(z.string().max(100)).max(10).default([]),
  hook: z.string().max(3000).default(""),
  format: z.enum(["long", "short"]).default("long"),
  minutes: z.number().min(0).max(600).optional(),
  niche: z.string().max(300).optional(),
  image: z.object({ mime: z.enum(["image/jpeg", "image/png", "image/webp"]), b64: z.string().min(100).max(6_000_000, "Изображение больше ~4 МБ") }).optional(),
  local: z.object({ brightness: z.number(), contrast: z.number(), colorfulness: z.number(), width: z.number(), height: z.number() }).optional(),
  checkKeyword: z.boolean().default(false),
  language: z.string().max(5).optional(),
  projectId: z.string().optional(),
});
export type ScorecardInputT = z.infer<typeof ScorecardInput>;
export type Check = { level: "ok" | "warn" | "error"; text: string };
export type Area = "title" | "thumbnail" | "hook" | "seo" | "promise";

const low = (s: string) => s.toLowerCase().replace(/ё/g, "е");
const has = (hay: string, kw: string) => !!kw.trim() && low(hay).includes(low(kw.trim()));
const words = (s: string) => (s.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;
const GREET = /^(привет|всем привет|здравствуйте|hi\b|hello\b|hey guys|добро пожаловать|welcome|меня зовут|my name is|в этом видео|in this video|сегодня мы|today we)/i;
const score = (cs: Check[]) => cs.length ? Math.round((cs.reduce((s, c) => s + (c.level === "ok" ? 1 : c.level === "warn" ? 0.5 : 0), 0) / cs.length) * 100) : 0;

/** Детерминированные проверки — без сети */
export function localChecks(i: Pick<ScorecardInputT, "title" | "description" | "tags" | "keywords" | "hook" | "format" | "minutes">) {
  const kw = i.keywords[0] ?? "";
  const T: Check[] = [], S: Check[] = [], H: Check[] = [];
  const tl = i.title.trim().length;
  T.push(tl > 100 ? { level: "error", text: `Заголовок ${tl} символов — YouTube обрежет после 100` } : tl > 70 ? { level: "warn", text: `Заголовок ${tl} символов — на телефоне видно ~60–70` } : tl < 25 ? { level: "warn", text: `Заголовок короткий (${tl}) — мало обещания` } : { level: "ok", text: `Длина заголовка ${tl} — хорошо` });
  if (kw) { const p = low(i.title).indexOf(low(kw)); T.push(p < 0 ? { level: "warn", text: `Главного ключа «${kw}» нет в заголовке` } : p <= 40 ? { level: "ok", text: `Ключ «${kw}» в начале заголовка` } : { level: "warn", text: `Ключ «${kw}» далеко от начала — перенесите в первые 40 символов` }); }
  const letters = i.title.replace(/[^\p{L}]/gu, ""); const caps = letters ? letters.replace(/[^\p{Lu}]/gu, "").length / letters.length : 0;
  T.push(caps > 0.5 && letters.length > 10 ? { level: "warn", text: "Слишком много заглавных — выглядит как спам" } : { level: "ok", text: "Регистр в порядке" });
  if (/[!?]{3,}/.test(i.title)) T.push({ level: "warn", text: "Много !!! / ??? подряд — снижает доверие" });
  if (/\d/.test(i.title)) T.push({ level: "ok", text: "В заголовке есть число — конкретика повышает CTR" });

  const d = i.description.trim();
  if (!d) S.push({ level: "error", text: "Описание пустое" });
  else {
    S.push(d.length >= 250 ? { level: "ok", text: `Описание ${d.length} символов` } : { level: "warn", text: `Описание короткое (${d.length}) — нужно ≥ 250` });
    if (kw) S.push(has(d.slice(0, 160), kw) ? { level: "ok", text: "Ключ в первых 160 символах описания (видно в поиске)" } : { level: "warn", text: `Добавьте «${kw}» в первые 1–2 строки описания` });
    if (i.format === "long" && (i.minutes ?? 0) >= 6) S.push(/(^|\n)\s*0?0:00/.test(d) ? { level: "ok", text: "Есть таймкоды (главы)" } : { level: "warn", text: "Нет таймкодов с 0:00 — главы помогают удержанию и поиску" });
    const hashtags = d.match(/#[\p{L}\p{N}_]+/gu) ?? [];
    if (hashtags.length > 15) S.push({ level: "error", text: `${hashtags.length} хэштегов — при > 15 YouTube игнорирует все` });
    else if (hashtags.length) S.push({ level: "ok", text: `Хэштегов: ${hashtags.length}` });
  }
  const tagsLen = i.tags.join(",").length;
  if (!i.tags.length) S.push({ level: "warn", text: "Нет тегов — добавьте 8–15" });
  else {
    S.push(tagsLen > 500 ? { level: "error", text: `Теги ${tagsLen} символов — лимит 500` } : i.tags.length < 5 ? { level: "warn", text: `Тегов мало (${i.tags.length})` } : { level: "ok", text: `Тегов ${i.tags.length} (${tagsLen}/500 символов)` });
    const dup = i.tags.length - new Set(i.tags.map(low)).size; if (dup) S.push({ level: "warn", text: `Повторяющихся тегов: ${dup}` });
    if (kw) S.push(i.tags.some((t) => low(t) === low(kw)) ? { level: "ok", text: "Главный ключ есть в тегах" } : { level: "warn", text: `Добавьте тег «${kw}»` });
  }
  for (const k of i.keywords.slice(1)) if (!has(`${i.title} ${d} ${i.tags.join(" ")}`, k)) S.push({ level: "warn", text: `Ключ «${k}» не встречается ни в заголовке, ни в описании, ни в тегах` });

  const h = i.hook.trim();
  if (!h) H.push({ level: "warn", text: "Хук не указан — вставьте первые 15 секунд сценария" });
  else {
    const first = h.split(/(?<=[.!?…])\s+/).slice(0, 1).join(" ");
    const w15 = words(h.split(/\s+/).slice(0, i.format === "short" ? 20 : 40).join(" "));
    H.push(GREET.test(h) ? { level: "error", text: "Хук начинается с приветствия/«в этом видео» — первые секунды теряются" } : { level: "ok", text: "Без приветствий в начале" });
    H.push(words(first) > 25 ? { level: "warn", text: `Первая фраза длинная (${words(first)} слов) — лучше ≤ 15` } : { level: "ok", text: `Первая фраза ${words(first)} слов` });
    const tTok = new Set((low(i.title).match(/[\p{L}\p{N}]{4,}/gu) ?? []));
    const hTok = new Set((low(h.split(/\s+/).slice(0, 60).join(" ")).match(/[\p{L}\p{N}]{4,}/gu) ?? []));
    const overlap = [...tTok].filter((x) => [...hTok].some((y) => y.startsWith(x.slice(0, 5)))).length;
    H.push(tTok.size && overlap === 0 ? { level: "warn", text: "Хук не перекликается с заголовком — зритель не видит подтверждения клика" } : { level: "ok", text: "Хук подтверждает тему заголовка" });
    if (w15 < 15) H.push({ level: "warn", text: "Хук очень короткий — проверьте, что это первые 15 секунд" });
  }
  return { title: T, seo: S, hook: H, scores: { title: score(T), seo: score(S), hook: score(H) } };
}

const Llm = z.object({
  areas: z.object({
    title: z.object({ score: z.number().min(0).max(100), note: z.string().max(500) }),
    thumbnail: z.object({ score: z.number().min(0).max(100), note: z.string().max(500) }).optional(),
    hook: z.object({ score: z.number().min(0).max(100), note: z.string().max(500) }),
    promise: z.object({ score: z.number().min(0).max(100), note: z.string().max(500) }),
    seo: z.object({ score: z.number().min(0).max(100), note: z.string().max(500) }),
  }),
  verdict: z.enum(["ready", "fix", "rework"]),
  summary: z.string().max(800),
  fixes: z.array(z.object({ area: z.enum(["title", "thumbnail", "hook", "seo", "promise"]), priority: z.number().int().min(1).max(3), text: z.string().max(400) })).min(1).max(10),
  altTitles: z.array(z.string().max(100)).min(3).max(5),
  hookRewrite: z.string().max(800).optional(),
  thumbnailText: z.string().max(200).optional(),
});
export type ScorecardResult = z.infer<typeof Llm> & {
  id: string; createdAt: string; total: number; label: string; weights: Record<Area, number>;
  local: ReturnType<typeof localChecks>; thumbChecks: Check[]; keyword?: { keyword: string; metrics: KwMetrics }; model: string;
  input: Omit<ScorecardInputT, "image">; hasImage: boolean;
};
const LABEL = { ready: "Готово к публикации", fix: "Поправить мелочи", rework: "Переделать упаковку" } as const;

export async function runScorecard(input: ScorecardInputT, ctx: JobCtx): Promise<ScorecardResult> {
  const st = await getSettings();
  const lang = input.language || st.contentLanguage;
  ctx.progress("Локальные проверки", 10);
  const local = localChecks(input);
  const thumbChecks: Check[] = [];
  const l = input.local;
  if (l) {
    thumbChecks.push(l.width >= 1280 && Math.abs(l.width / l.height - 16 / 9) < 0.03 ? { level: "ok", text: `Размер ${l.width}×${l.height}` } : { level: "warn", text: `Размер ${l.width}×${l.height} — нужно 1280×720 (16:9)` });
    thumbChecks.push(l.contrast >= 55 ? { level: "ok", text: `Контраст ${l.contrast.toFixed(0)}` } : { level: "warn", text: `Контраст низкий (${l.contrast.toFixed(0)}) — на превью сольётся` });
    if (l.brightness < 45 || l.brightness > 215) thumbChecks.push({ level: "warn", text: `Яркость ${l.brightness.toFixed(0)}/255 — слишком ${l.brightness < 45 ? "тёмная" : "светлая"}` });
  }
  let keyword: ScorecardResult["keyword"];
  if (input.checkKeyword && input.keywords[0]) {
    ctx.progress(`Анализ ключа «${input.keywords[0]}»`, 25);
    try { keyword = { keyword: input.keywords[0], metrics: await analyzeKeyword(input.keywords[0], lang, st.research.region || undefined) }; }
    catch (e) { local.seo.push({ level: "warn", text: `Анализ ключа не удался: ${(e as Error).message}` }); }
  }
  ctx.progress("Оценка ИИ", 45);
  const L = LANG_NAME[lang] ?? "Russian";
  const { data, model } = await generateJson({
    system: `You are a strict YouTube pre-publish reviewer. Judge the whole package a viewer meets: title, thumbnail (if attached), first 15 seconds (hook), and how well they promise the same thing (promise = title+thumbnail create one curiosity gap and the hook confirms the click within seconds). SEO = description, tags and target keywords. Scores 0–100, strict (85+ only for truly top packages). Use the local rule checks and keyword metrics given — don't contradict measured facts. Output: areas{title, thumbnail (only if image), hook, promise, seo} each {score, note}; verdict ready|fix|rework; summary; fixes (priority 1 = most important, concrete — say exactly what to change); altTitles (3–5 better titles <=70 chars keeping the target keyword); hookRewrite (a stronger first 1–2 sentences, if the hook can be improved); thumbnailText (the text you see on the thumbnail, "" if none). Write in ${L}. Return ONLY JSON of exactly this shape:
{"areas":{"title":{"score":0,"note":""},"thumbnail":{"score":0,"note":""},"hook":{"score":0,"note":""},"promise":{"score":0,"note":""},"seo":{"score":0,"note":""}},"verdict":"fix","summary":"","fixes":[{"area":"title","priority":1,"text":""}],"altTitles":["","",""],"hookRewrite":"","thumbnailText":""}`,
    user: JSON.stringify({ title: input.title, format: input.format, minutes: input.minutes, niche: input.niche, keywords: input.keywords, description: input.description.slice(0, 2500), tags: input.tags, hook: input.hook.slice(0, 1500), localChecks: { title: local.title, seo: local.seo, hook: local.hook, thumbnail: thumbChecks }, keywordMetrics: keyword ? { volume: keyword.metrics.volume, competition: keyword.metrics.competition, level: keyword.metrics.level, topTitles: keyword.metrics.top?.map((t: any) => t.title) } : undefined }),
    images: input.image ? [input.image] : undefined, maxTokens: 3500, temperature: 0.3,
  }, Llm);
  ctx.progress("Итог", 90);
  // смешиваем: локальные правила (объективно) 40% + ИИ 60% там, где есть оба
  const mix = (ai: number, loc?: number) => Math.round(loc == null ? ai : ai * 0.6 + loc * 0.4);
  const parts: Record<Area, number | null> = {
    title: mix(data.areas.title.score, local.scores.title),
    thumbnail: input.image && data.areas.thumbnail ? mix(data.areas.thumbnail.score, thumbChecks.length ? score(thumbChecks) : undefined) : null,
    hook: input.hook.trim() ? mix(data.areas.hook.score, local.scores.hook) : null,
    promise: Math.round(data.areas.promise.score),
    seo: mix(data.areas.seo.score, local.scores.seo),
  };
  const W: Record<Area, number> = { title: 25, thumbnail: 25, hook: 20, promise: 15, seo: 15 };
  const used = (Object.keys(W) as Area[]).filter((k) => parts[k] != null);
  const wsum = used.reduce((s, k) => s + W[k], 0);
  const weights = Object.fromEntries((Object.keys(W) as Area[]).map((k) => [k, parts[k] != null ? Math.round((W[k] / wsum) * 100) : 0])) as Record<Area, number>;
  const total = Math.round(used.reduce((s, k) => s + (parts[k] as number) * W[k], 0) / wsum);
  for (const k of used) (data.areas as any)[k] = { ...(data.areas as any)[k], score: parts[k] };
  if (!input.image) delete data.areas.thumbnail;
  const verdict = total >= 80 && data.verdict !== "rework" ? "ready" : total < 55 ? "rework" : data.verdict === "ready" ? "fix" : data.verdict;
  const { image: _img, ...rest } = input;
  const r: ScorecardResult = { ...data, verdict, id: crypto.randomUUID().slice(0, 8), createdAt: new Date().toISOString(), total, label: LABEL[verdict], weights, local, thumbChecks, keyword, model, input: rest, hasImage: !!input.image };
  await writeJson(`scorecards/${r.id}.json`, r);
  const idx = await listScorecards(); idx.unshift({ id: r.id, createdAt: r.createdAt, title: input.title, total });
  await writeJson("scorecards/index.json", idx.slice(0, 50));
  if (input.projectId) await saveCheck(input.projectId, "Оценка перед публикацией", `Готовность: ${total}/100`, r);
  return r;
}
export const listScorecards = () => readJson<{ id: string; createdAt: string; title: string; total: number }[]>("scorecards/index.json", []);
export const loadScorecard = (id: string) => readJson<ScorecardResult | null>(`scorecards/${id.replace(/[^\w-]/g, "")}.json`, null);
