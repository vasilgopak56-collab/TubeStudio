// Каналы (Выпуск 1): у каждого канала своя ниша, язык, длина роликов, стиль,
// навыки, образцы для Радара, голос озвучки, модели и своя часть бюджета.
import crypto from "node:crypto";
import { z } from "zod";
import { readJson, writeJson } from "../../lib/storage.js";
import { ApiError } from "../../lib/errors.js";
import { checkCancelled } from "../../lib/taskContext.js";

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
  /** Выпуск 2: «auto» — TubeStudio создаёт шаблон под голос; «mine» — ваш готовый шаблон Lumean без изменений. */
  templateSource: z.enum(["auto", "mine"]).default("auto"),
  ownTemplateId: Line(80).default(""),
  ownTemplateName: Line(255).default(""),
}).strict();

/** Персонаж, локация или предмет канала: имя = @имя в промптах G-Labs (карточка 230). */
export const CastItem = z.object({
  name: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9]{2,31}$/, "Имя персонажа или локации: латинские буквы и цифры, от 3 символов, без пробелов — например OldKing или ThroneHall"),
  kind: z.enum(["character", "location", "object"]).default("character"),
  description: Line(1500).default(""),
  /** Эталон: путь внутри data/files, например _cast/<канал>/OldKing.png. */
  image: Line(300).default(""),
  /** Отметка последней отправки в библиотеку персонажей G-Labs. */
  glabs: Line(120).default(""),
}).strict();
export type CastItemT = z.infer<typeof CastItem>;

/** Визуал канала (Выпуск 2): стиль, модели G-Labs, анимация, нарезка на сцены, персонажи и локации. */
export const VisualSettings = z.object({
  /** Стиль из Библиотеки стилей; его стилевой ключ дословно стоит в каждом промпте. */
  styleId: Line(120).default(""),
  /** Своя правка стилевого ключа и ключа движения ("" — как в стиле). */
  anchor: Line(2000).default(""),
  motion: Line(1000).default(""),
  negative: Line(1000).default(""),
  palette: Line(300).default(""),
  imageModel: z.enum(["nano_banana_2", "nano_banana_pro", "nano_banana_2_lite"]).default("nano_banana_2"),
  videoModel: z.enum(["veo_31_fast", "veo_31_lite", "veo_31_quality", "omni_flash"]).default("veo_31_fast"),
  /** Длина клипа: Veo 4 и 6 с — только с аккаунтом Ultra; Omni Flash — 4–10 с. */
  clipSec: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(10)]).default(8),
  /** Какие сцены оживлять: никакие, хук и ключевые, каждую N-ю, все. */
  animate: z.enum(["none", "key", "every", "all"]).default("key"),
  animateEvery: z.number().int().min(2).max(10).default(3),
  /** Нарезка (карточка 200): «Ритм» — по смыслу до maxSceneSec; «Предложение» — сцена на предложение. */
  sceneMode: z.enum(["rhythm", "sentence"]).default("rhythm"),
  maxSceneSec: z.number().min(3).max(10).default(8),
  aspect: z.enum(["16:9", "9:16"]).default("16:9"),
  cast: z.array(CastItem).max(30).default([]),
}).strict().superRefine((v, ctx) => {
  const seen = new Set<string>();
  for (const c of v.cast) {
    const k = c.name.toLowerCase();
    if (seen.has(k)) ctx.addIssue({ code: "custom", path: ["cast"], message: `Имя @${c.name} повторяется: у каждого персонажа и локации своё имя` });
    seen.add(k);
  }
});
export type VisualSettingsT = z.infer<typeof VisualSettings>;

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
  visual: VisualSettings.prefault({}),
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
/** internal — правка из самой программы (эталоны, отметки G-Labs). Из интерфейса пути к файлам эталонов
 *  не принимаются: они берутся из сохранённого канала по имени, чтобы старая копия формы не стёрла загрузку. */
export function updateChannel(id: string, patch: unknown, o: { internal?: boolean } = {}): Promise<Channel> {
  return mutate((s) => {
    const i = s.channels.findIndex((c) => c.id === id);
    if (i < 0) throw new ApiError("NOT_FOUND", "Канал не найден", 404);
    const cur = s.channels[i];
    const p = (patch ?? {}) as Record<string, unknown>;
    let pv = (p.visual ?? {}) as Record<string, unknown>;
    if (!o.internal && Array.isArray(pv.cast)) {
      const old = new Map(cur.visual.cast.map((c) => [c.name.toLowerCase(), c]));
      pv = { ...pv, cast: pv.cast.map((x) => {
        if (!x || typeof x !== "object") return x;
        const was = old.get(String((x as { name?: unknown }).name ?? "").trim().toLowerCase());
        return { ...(x as object), image: was?.image ?? "", glabs: was?.glabs ?? "" };
      }) };
    }
    const merged = ChannelInput.parse({
      ...stripMeta(cur), ...p,
      radar: { ...cur.radar, ...((p.radar as object) ?? {}) },
      voice: { ...cur.voice, ...((p.voice as object) ?? {}) },
      visual: { ...cur.visual, ...pv },
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

// Brainstorm profile application is separate from generation and requires an exact preview.
// The comparison happens inside the same channel mutation queue as ordinary edits.
export const BrainstormProfile=z.object({niche:ChannelInput.shape.niche.unwrap(),audience:ChannelInput.shape.audience.unwrap(),format:ChannelInput.shape.format.unwrap(),style:ChannelInput.shape.style.unwrap(),skills:ChannelInput.shape.skills.unwrap(),language:ChannelInput.shape.language.unwrap(),lengthMin:ChannelInput.shape.lengthMin.unwrap()}).strict();
export const BrainstormProfileAsk=z.object({channelId:z.string().uuid(),profile:BrainstormProfile}).strict();
export const BrainstormProfileSend=BrainstormProfileAsk.extend({previewHash:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)}).strict();
function profilePreview(channel:Channel,d:z.infer<typeof BrainstormProfileAsk>){
 if(channel.archived)throw new ApiError('VALIDATION','Канал в архиве. Профиль не изменён.',409);
 const fields=['niche','audience','format','style','skills','language','lengthMin'] as const;
 const changes=fields.filter(k=>channel[k]!==d.profile[k]).map(k=>({field:k,before:channel[k],after:d.profile[k]}));
 const snapshot=crypto.createHash('sha256').update(JSON.stringify(channel)).digest('hex');
 const hash=crypto.createHash('sha256').update(JSON.stringify({input:d,snapshot})).digest('hex');
 return {channel:{id:channel.id,name:channel.name},changes,hash,notice:'Будут заменены только показанные поля профиля. Голос, стиль визуала, модели, бюджет, Радар и адрес YouTube не меняются. Описание и правила канала могут быть перезаписаны — проверьте сравнение.'};
}
export async function previewBrainstormProfile(raw:z.infer<typeof BrainstormProfileAsk>){const d=BrainstormProfileAsk.parse(raw),ch=await getChannel(d.channelId);return profilePreview(ch,d);}
export async function applyBrainstormProfile(raw:z.infer<typeof BrainstormProfileSend>){
 const {previewHash,confirmed,...d}=BrainstormProfileSend.parse(raw);
 return mutate(s=>{checkCancelled();const i=s.channels.findIndex(c=>c.id===d.channelId);if(i<0)throw new ApiError('NOT_FOUND','Канал не найден.',404);const p=profilePreview(s.channels[i],d);
  if(p.hash!==previewHash)throw new ApiError('VALIDATION','Канал или предлагаемые изменения изменились. Повторите просмотр; ничего не записано.',409);
  if(!p.changes.length)throw new ApiError('VALIDATION','Изменений в профиле нет.',409);
  const next={...s.channels[i],...d.profile,updatedAt:new Date().toISOString()};ChannelInput.parse(stripMeta(next));checkCancelled();s.channels[i]=next;return {channel:next,changed:p.changes.map(c=>c.field)};
 });
}
