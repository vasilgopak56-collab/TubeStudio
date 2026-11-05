// Каналы (Выпуск 1): у каждого канала своя ниша, язык, длина роликов, стиль,
// навыки, образцы для Радара, голос озвучки, модели и своя часть бюджета.
import crypto from "node:crypto";
import { z } from "zod";
import { readJson, writeJson } from "../../lib/storage.js";
import { ApiError } from "../../lib/errors.js";

const FILE = "studio/channels.json";

const Line = (max: number) => z.string().trim().max(max);
export const RadarSettings = z.object({
  /** Свои поисковые запросы (темы, форматы). */
  seeds: z.array(Line(100).min(2)).max(40).default([]),
  /** Подписчиков не больше (ползунок; по умолчанию 60 тыс.). */
  maxSubs: z.number().int().min(100).max(10_000_000).default(60_000),
  /** Множитель «просмотры ÷ подписчики» не меньше. */
  minMultiplier: z.number().min(1).max(1000).default(3),
  minViews: z.number().int().min(0).max(100_000_000).default(10_000),
  /** Длинные ролики: не короче, секунд. */
  minDurationSec: z.number().int().min(0).max(7200).default(240),
  /** Сколько поисковых запросов в одном прогоне (по 2–3 страницы YouTube на запрос). */
  maxQueries: z.number().int().min(5).max(60).default(40),
  region: z.string().trim().max(2).default(""),
}).strict();

export const VoiceSettings = z.object({
  provider: z.enum(["none", "lumean"]).default("none"),
  service: z.enum(["elevenlabs", "cartesia", "heygen", "fishaudio"]).default("elevenlabs"),
  voiceId: Line(200).default(""),
  voiceName: Line(200).default(""),
  modelId: Line(80).default(""),
  /** Шаблон Lumean, созданный TubeStudio под этот голос. */
  templateId: Line(80).default(""),
  templateKey: Line(200).default(""),
  mode: z.enum(["whole", "paragraph"]).default("whole"),
  speed: z.number().min(0.7).max(1.2).default(1),
}).strict();

export const ChannelInput = z.object({
  name: Line(80).min(1, "Укажите название канала"),
  language: z.string().trim().regex(/^[a-z]{2}(-[A-Z]{2})?$/, "Код языка, например ru или en").default("en"),
  niche: Line(300).default(""),
  audience: Line(500).default(""),
  format: Line(300).default(""),
  lengthMin: z.number().min(1).max(120).default(10),
  style: Line(4000).default(""),
  skills: Line(20000).default(""),
  samples: z.array(Line(200).min(2)).max(5).default([]),
  ownChannel: Line(200).default(""),
  radar: RadarSettings.prefault({}),
  voice: VoiceSettings.prefault({}),
  models: z.object({ author: Line(120).default(""), critic: Line(120).default("") }).strict().prefault({}),
  /** Своя часть месячного бюджета, $. 0 — без отдельного лимита (действует общий). */
  budgetUsd: z.number().min(0).max(10_000).default(0),
}).strict();
export type ChannelInputT = z.infer<typeof ChannelInput>;
export type Channel = ChannelInputT & { id: string; createdAt: string; updatedAt: string; archived?: boolean };
type Store = { version: 1; activeId: string | null; channels: Channel[] };

const empty = (): Store => ({ version: 1, activeId: null, channels: [] });
let queue: Promise<unknown> = Promise.resolve();
function mutate<T>(fn: (s: Store) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const s = await load();
    const out = await fn(s);
    await writeJson(FILE, s, { backup: true });
    return out;
  });
  queue = run.catch(() => {});
  return run;
}
async function load(): Promise<Store> {
  const raw = await readJson<Store | null>(FILE, null);
  if (!raw || !Array.isArray(raw.channels)) return empty();
  const channels = raw.channels.map((c) => {
    const parsed = ChannelInput.safeParse(stripMeta(c));
    return parsed.success ? { ...parsed.data, id: c.id, createdAt: c.createdAt, updatedAt: c.updatedAt, ...(c.archived ? { archived: true } : {}) } : null;
  }).filter((c): c is Channel => !!c && typeof c.id === "string");
  return { version: 1, activeId: channels.some((c) => c.id === raw.activeId && !c.archived) ? raw.activeId : channels.find((c) => !c.archived)?.id ?? null, channels };
}
const stripMeta = (c: Record<string, unknown>) => { const { id: _i, createdAt: _c, updatedAt: _u, archived: _a, ...rest } = c; return rest; };

export async function listChannels(opts: { archived?: boolean } = {}) {
  const s = await load();
  return { activeId: s.activeId, channels: s.channels.filter((c) => opts.archived || !c.archived) };
}
export async function getChannel(id: string): Promise<Channel> {
  const c = (await load()).channels.find((x) => x.id === id);
  if (!c) throw new ApiError("NOT_FOUND", "Канал не найден", 404);
  return c;
}
export async function activeChannel(): Promise<Channel | null> {
  const s = await load();
  return s.channels.find((c) => c.id === s.activeId) ?? null;
}
export async function createChannel(input: unknown): Promise<Channel> {
  const data = ChannelInput.parse(input);
  return mutate((s) => {
    if (s.channels.filter((c) => !c.archived).length >= 30) throw new ApiError("VALIDATION", "Не больше 30 каналов");
    const now = new Date().toISOString();
    const ch: Channel = { ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    s.channels.push(ch);
    if (!s.activeId) s.activeId = ch.id;
    return ch;
  });
}
export function updateChannel(id: string, patch: unknown): Promise<Channel> {
  return mutate((s) => {
    const i = s.channels.findIndex((c) => c.id === id);
    if (i < 0) throw new ApiError("NOT_FOUND", "Канал не найден", 404);
    const cur = s.channels[i];
    const p = (patch ?? {}) as Record<string, unknown>;
    const merged = ChannelInput.parse({
      ...stripMeta(cur), ...p,
      radar: { ...cur.radar, ...((p.radar as object) ?? {}) },
      voice: { ...cur.voice, ...((p.voice as object) ?? {}) },
      models: { ...cur.models, ...((p.models as object) ?? {}) },
    });
    const next: Channel = { ...merged, id: cur.id, createdAt: cur.createdAt, updatedAt: new Date().toISOString(), ...(cur.archived ? { archived: true } : {}) };
    s.channels[i] = next;
    return next;
  });
}
export function archiveChannel(id: string, archived = true): Promise<Channel> {
  return mutate((s) => {
    const c = s.channels.find((x) => x.id === id);
    if (!c) throw new ApiError("NOT_FOUND", "Канал не найден", 404);
    if (archived) c.archived = true; else delete c.archived;
    c.updatedAt = new Date().toISOString();
    if (archived && s.activeId === id) s.activeId = s.channels.find((x) => !x.archived)?.id ?? null;
    if (!archived && !s.activeId) s.activeId = id;
    return c;
  });
}
export function activateChannel(id: string): Promise<Channel> {
  return mutate((s) => {
    const c = s.channels.find((x) => x.id === id && !x.archived);
    if (!c) throw new ApiError("NOT_FOUND", "Канал не найден", 404);
    s.activeId = id;
    return c;
  });
}

/** Задача → канал: по ней журнал расходов делится между каналами. */
const SPEND_FILE = "studio/channel-jobs.json";
type JobMap = { version: 1; jobs: Record<string, { channelId: string; at: string; kind: string }> };
let jobQueue: Promise<unknown> = Promise.resolve();
export function linkJobToChannel(jobId: string, channelId: string, kind: string) {
  const run = jobQueue.then(async () => {
    const m = await readJson<JobMap>(SPEND_FILE, { version: 1, jobs: {} });
    m.jobs[jobId] = { channelId, at: new Date().toISOString(), kind };
    // Храним 6 месяцев: старые записи журнала расходов всё равно сбрасываются помесячно.
    const cutoff = Date.now() - 186 * 86400_000;
    for (const [k, v] of Object.entries(m.jobs)) if (Date.parse(v.at) < cutoff) delete m.jobs[k];
    await writeJson(SPEND_FILE, m);
  });
  jobQueue = run.catch(() => {});
  return run;
}
export async function channelJobs(): Promise<JobMap["jobs"]> {
  return (await readJson<JobMap>(SPEND_FILE, { version: 1, jobs: {} })).jobs;
}

/** Расход по каналам за текущий месяц: операции журнала usage.json с задачами этого канала. */
export async function channelSpend(): Promise<Record<string, { usd: number; operations: number; unknown: number }>> {
  const { getUsage } = await import("../usage.js");
  const [u, jobs] = await Promise.all([getUsage(), channelJobs()]);
  const out: Record<string, { usd: number; operations: number; unknown: number }> = {};
  for (const op of u.pricingV1?.operations ?? []) {
    const id = op.jobId ? jobs[op.jobId]?.channelId : undefined;
    if (!id) continue;
    const r = out[id] ??= { usd: 0, operations: 0, unknown: 0 };
    r.operations++;
    if (op.usd === null) r.unknown++; else r.usd += op.usd;
  }
  for (const r of Object.values(out)) r.usd = Math.round(r.usd * 10_000) / 10_000;
  return out;
}
/** Своя часть бюджета канала (если задана): платная задача не запускается, когда она израсходована. */
export async function assertChannelBudget(channelId: string) {
  const ch = await getChannel(channelId);
  if (!ch.budgetUsd) return;
  const spent = (await channelSpend())[channelId]?.usd ?? 0;
  if (spent >= ch.budgetUsd) throw new ApiError("BUDGET_LIMIT", `Канал «${ch.name}» израсходовал свою часть бюджета: $${spent.toFixed(2)} из $${ch.budgetUsd}. Увеличьте её в профиле канала или дождитесь нового месяца.`, 402);
}
