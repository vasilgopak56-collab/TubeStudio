import { z } from "zod";
import { readJson, writeJson } from "../lib/storage.js";

export const RpmRow = z.object({ niche: z.string(), min: z.number().min(0), max: z.number().min(0) });

export const PriceRow = z.object({ match: z.string().min(1).max(60), input: z.number().min(0).default(0), output: z.number().min(0).default(0), image: z.number().min(0).default(0) });
/** Ориентировочные цены (проверяйте на сайтах сервисов) */
export const DEFAULT_PRICES: z.infer<typeof PriceRow>[] = [
  { match: "claude-opus", input: 15, output: 75, image: 0 },
  { match: "claude-sonnet", input: 3, output: 15, image: 0 },
  { match: "claude-haiku", input: 1, output: 5, image: 0 },
  { match: "flash-lite", input: 0.1, output: 0.4, image: 0 },
  { match: "flash-image", input: 0, output: 0, image: 0.04 },
  { match: "tts", input: 0.5, output: 10, image: 0 },
  { match: "flash", input: 0.3, output: 2.5, image: 0 },
  { match: "pro", input: 1.25, output: 10, image: 0 },
  { match: "gpt-image", input: 0, output: 0, image: 0.07 },
  { match: "imagen", input: 0, output: 0, image: 0.04 },
];

const Num = (d: number, min = 0, max = 1e12) => z.number().min(min).max(max).default(d);
export const FiltersSchema = z.object({
  outlierMin: z.number().min(0).optional(), outlierMax: z.number().min(0).optional(),
  vphMin: z.number().min(0).optional(), vphMax: z.number().min(0).optional(),
  viewsMin: z.number().min(0).optional(), viewsMax: z.number().min(0).optional(),
  subsMin: z.number().min(0).optional(), subsMax: z.number().min(0).optional(),
  ratioMin: z.number().min(0).optional(), engagementMin: z.number().min(0).optional(),
  ageDays: z.number().int().min(0).max(36500).optional(),
  durationMin: z.number().min(0).optional(), durationMax: z.number().min(0).optional(),
  type: z.enum(["all", "long", "shorts"]).default("all"),
  viralOnly: z.boolean().default(false),
});
export type Filters = z.infer<typeof FiltersSchema>;
export const PresetSchema = z.object({ id: z.string(), name: z.string().min(1).max(60), filters: FiltersSchema });
export const DEFAULT_PRESETS: z.infer<typeof PresetSchema>[] = [
  { id: "viral", name: "Вирусный потенциал", filters: { outlierMin: 20, vphMin: 20, type: "all", viralOnly: true } },
  { id: "small", name: "Новые каналы взлетают", filters: { outlierMin: 20, vphMin: 20, subsMax: 5000, type: "all", viralOnly: false } },
  { id: "history", name: "Маленькие каналы, 50K+", filters: { outlierMin: 50, vphMin: 20, subsMax: 5000, viewsMin: 50000, type: "all", viralOnly: false } },
  { id: "fresh", name: "Свежее (30 дней)", filters: { outlierMin: 5, vphMin: 50, ageDays: 30, type: "long", viralOnly: false } },
];
export const ResearchSettings = z.object({
  /** regionCode для search.list ("" — любой) */
  region: z.string().max(2).default(""),
  /** relevanceLanguage ("" — язык контента из настроек) */
  language: z.string().max(5).default(""),
  /** страниц по 50 видео; каждая = 100 ед. квоты */
  pages: z.number().int().min(1).max(4).default(1),
  order: z.enum(["relevance", "viewCount", "date"]).default("relevance"),
  /** база Outlier Score: медиана последних видео канала (точно, 2 ед./канал) или среднее за всё время (бесплатно) */
  outlierBase: z.enum(["median", "average"]).default("median"),
  baseVideos: z.number().int().min(10).max(50).default(30),
  /** Правило «вирусного потенциала» */
  viral: z.object({
    outlierMin: Num(20),
    rules: z.array(z.object({ maxAgeDays: z.number().int().min(0), vphMin: z.number().min(0) })).min(1).max(6).default([{ maxAgeDays: 90, vphMin: 100 }, { maxAgeDays: 365, vphMin: 50 }, { maxAgeDays: 0, vphMin: 20 }]),
  }).prefault({}),
  presets: z.array(PresetSchema).max(30).default(DEFAULT_PRESETS),
  keywords: z.object({
    depth: z.enum(["fast", "deep"]).default("fast"),
    /** сколько ключей анализировать автоматически (каждый ≈ 102 ед.) */
    analyzeTop: z.number().int().min(0).max(15).default(5),
    /** автовыбор: объём ≥ minVolume и конкуренция ≤ maxCompetition, либо объём ≥ highCompVolume при любой конкуренции */
    minVolume: Num(10000), maxCompetition: z.enum(["low", "medium", "high"]).default("medium"), highCompVolume: Num(1_000_000),
    maxPick: z.number().int().min(1).max(30).default(5),
    separator: z.string().max(5).default(", "),
  }).prefault({}),
  competitors: z.object({
    /** авто-обновление раз в N часов (0 — только вручную) */
    refreshHours: z.number().int().min(0).max(168).default(24),
    videosPerChannel: z.number().int().min(5).max(50).default(15),
    alertNew: z.boolean().default(true),
    alertOutlier: Num(3), alertVphX: Num(2), alertSubsPct: Num(5),
    /** недельный ИИ-дайджест: авто раз в digestDays (тратит 1 вызов LLM) */
    digestAuto: z.boolean().default(false),
    digestDays: z.number().int().min(1).max(60).default(7),
    digestTop: z.number().int().min(3).max(20).default(8),
  }).prefault({}),
  comments: z.object({
    /** комментариев на видео (1 ед. квоты за 100) */
    perVideo: z.number().int().min(20).max(500).default(200),
    order: z.enum(["relevance", "time"]).default("relevance"),
    /** сколько топ-видео канала брать при анализе канала */
    channelVideos: z.number().int().min(1).max(10).default(3),
  }).prefault({}),
});
export type ResearchSettingsT = z.infer<typeof ResearchSettings>;

export const SettingsSchema = z.object({
  research: ResearchSettings.prefault({}),
  theme: z.enum(["dark", "light"]).default("dark"),
  contentLanguage: z.string().default("ru"),
  timezone: z.string().default("Europe/Moscow"),
  llmProvider: z.enum(["auto", "anthropic", "gemini"]).default("auto"),
  imageProvider: z.enum(["openai", "gemini"]).default("openai"),
  models: z.object({
    anthropic: z.string().default("claude-opus-5-5"),
    gemini: z.string().default("gemini-3.5-flash"),
    geminiFast: z.string().default("gemini-3.1-flash-lite"),
    geminiTts: z.string().default("gemini-3.8-flash-tts"),
    geminiImage: z.string().default("gemini-3.1-flash-image"),
    openaiImage: z.string().default("gpt-image-2.5"),
  }).prefault({}),
  /** AnyModel — один ключ на все модели; прямые ключи остаются резервом */
  anymodel: z.object({
    enabled: z.boolean().default(true),
    /** first — AnyModel основной, прямые ключи резерв; reserve — наоборот */
    priority: z.enum(["first", "reserve"]).default("first"),
    text: z.string().default("cc/claude-sonnet-5"),
    /** Топ-модель для сценариев (план, акты, подгонка объёма) */
    script: z.string().default("cc/claude-opus-5"),
    textAlt: z.string().default("cx/gpt-5.6-terra"),
    fast: z.string().default("ag/gemini-3-flash"),
    search: z.string().default("ag/gemini-3-flash"),
    image: z.string().default("cx/gpt-image-2"),
    imageAlt: z.string().default("ag/gemini-3.1-flash-image"),
    imageQuality: z.enum(["low", "medium", "high"]).default("medium"),
    tts: z.string().default("edge-tts/ru-RU-DmitryNeural"),
    /** $ за 1 млн балансовых токенов при множителе ×1 (на сайте: 5¢) */
    usdPerMillion: z.number().min(0).max(100).default(0.05),
  }).prefault({}),
  budget: z.object({
    /** 0 — без лимита. Портативная версия (Выпуск 1) ставит $20 и «блокировать» — см. migrate(). */
    monthlyUsd: z.number().min(0).max(100000).default(0),
    mode: z.enum(["warn", "block"]).default("warn"),
    warnPct: z.number().min(10).max(99).default(80),
    /** $ за 1 млн токенов (input/output) и $ за картинку; совпадение по подстроке имени модели, сверху вниз */
    prices: z.array(PriceRow).default(DEFAULT_PRICES),
  }).prefault({}),
  /** Выполненные однократные миграции настроек (не редактируется пользователем). */
  migrations: z.array(z.string().max(100)).max(100).default([]),
  rpm: z.array(RpmRow).default([
    { niche: "По умолчанию", min: 3.5, max: 8.5 },
    { niche: "Финансы", min: 8, max: 20 },
    { niche: "История / документалистика", min: 4, max: 9 },
    { niche: "Shorts", min: 0.05, max: 0.1 },
  ]),
});
export type Settings = z.infer<typeof SettingsSchema>;

const FILE = "settings.json";

/**
 * Выпуск 1 (портативная версия): лимит $20 и режим «блокировать» включаются
 * один раз — и для новых, и для старых настроек, где лимит был выключен (0)
 * или стоял режим «только предупреждать».
 * Потом пользователь может изменить лимит сам — повторно миграция не срабатывает.
 */
export const BUDGET_MIGRATION = "release1-budget-20";
function migrate(raw: unknown): { value: unknown; changed: boolean } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { value: raw, changed: false };
  const obj = raw as Record<string, unknown>;
  const done = Array.isArray(obj.migrations) ? (obj.migrations as unknown[]) : [];
  if (done.includes(BUDGET_MIGRATION)) return { value: raw, changed: false };
  const budget = (obj.budget && typeof obj.budget === "object" ? obj.budget : {}) as Record<string, unknown>;
  const limit = typeof budget.monthlyUsd === "number" ? budget.monthlyUsd : 0;
  const next = { ...budget, monthlyUsd: limit > 0 ? limit : 20, mode: "block" };
  return { value: { ...obj, budget: next, migrations: [...done, BUDGET_MIGRATION] }, changed: true };
}

const portable = () => process.env.TUBESTUDIO_PORTABLE === "1";

export async function getSettings(): Promise<Settings> {
  const raw = await readJson<unknown>(FILE, null);
  if (raw === null) {
    const base = SettingsSchema.parse({});
    if (!portable()) return base;
    return SettingsSchema.parse({ ...base, budget: { ...base.budget, monthlyUsd: 20, mode: "block" }, migrations: [BUDGET_MIGRATION] });
  }
  if (!portable()) return SettingsSchema.parse(raw);
  const { value, changed } = migrate(raw);
  const parsed = SettingsSchema.parse(value);
  if (changed) await writeJson(FILE, parsed, { backup: true });
  return parsed;
}

export async function updateSettings(patch: unknown): Promise<Settings> {
  const cur = await getSettings();
  const next = SettingsSchema.parse({ ...cur, ...(patch as object), models: { ...cur.models, ...((patch as any)?.models ?? {}) }, budget: { ...cur.budget, ...((patch as any)?.budget ?? {}) }, anymodel: { ...cur.anymodel, ...((patch as any)?.anymodel ?? {}) }, research: { ...cur.research, ...((patch as any)?.research ?? {}) } });
  next.migrations = cur.migrations; // служебное поле: клиент его не меняет
  await writeJson(FILE, next, { backup: true });
  return next;
}
