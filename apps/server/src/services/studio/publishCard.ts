// Выпуск 4, шаг 1: карточка публикации. Без сети и платных сервисов: только файлы проекта.
// Главы ставятся на начало абзацев по настоящим таймингам сцен. Ответы об аудитории и ИИ автор даёт сам: умолчаний нет.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { ApiError } from "../../lib/errors.js";
import { projectFile } from "./montageCheck.js";
import { exportState } from "./montageExport.js";
import { montageState } from "./montageRender.js";
import { visualState } from "./visual.js";

const CARD = "publish/card.json";
/** Требования YouTube к главам: первая с 0:00, минимум три, каждая не короче 10 секунд. */
export const MIN_CHAPTER_SEC = 10;
export const MIN_CHAPTERS = 3;
export const MAX_CHAPTERS = 10;
/** Требования YouTube к обложке. */
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
export const MIN_THUMBNAIL_WIDTH = 640;
export const CATEGORIES = [
  { id: "1", name: "Фильмы и анимация" }, { id: "2", name: "Транспорт" }, { id: "10", name: "Музыка" }, { id: "15", name: "Животные" },
  { id: "17", name: "Спорт" }, { id: "19", name: "Путешествия" }, { id: "20", name: "Игры" }, { id: "22", name: "Люди и блоги" },
  { id: "23", name: "Юмор" }, { id: "24", name: "Развлечения" }, { id: "25", name: "Новости и политика" }, { id: "26", name: "Хобби и стиль" },
  { id: "27", name: "Образование" }, { id: "28", name: "Наука и техника" }, { id: "29", name: "Общественная деятельность" },
] as const;
const LANGUAGE = /^[a-z]{2}(-[A-Z]{2})?$/;

export type ChapterRow = { n: number; start: number; paragraph: number; text: string };
export type Chapter = { scene: number; start: number; excerpt: string; title: string };
type StoredChapter = { scene: number; excerpt: string; title: string };
type Thumbnail = { file: string; width: number; height: number; bytes: number };
export type StoredCard = { language: string | null; categoryId: string | null; madeForKids: boolean | null; syntheticMedia: boolean | null; thumbnail: Thumbnail | null; chapters: StoredChapter[] };
const EMPTY: StoredCard = { language: null, categoryId: null, madeForKids: null, syntheticMedia: null, thumbnail: null, chapters: [] };

export const CardInput = z.object({
  language: z.string().regex(LANGUAGE, "Код языка, например en или ru").nullable(),
  categoryId: z.enum(CATEGORIES.map((c) => c.id) as [string, ...string[]]).nullable(),
  madeForKids: z.boolean().nullable(),
  syntheticMedia: z.boolean().nullable(),
  chapters: z.array(z.object({ scene: z.number().int().positive(), title: z.string().trim().max(80, "Название главы длиннее 80 знаков").refine((t) => !/[<>]/.test(t), "YouTube не принимает знаки < и > в описании") }).strict()).max(MAX_CHAPTERS),
}).strict();
export const ThumbnailInput = z.object({ data: z.string().min(1).max(Math.ceil(MAX_THUMBNAIL_BYTES * 1.4)) }).strict();

const excerptOf = (text: string) => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 90) return clean;
  const cut = clean.slice(0, 90);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : 90)}…`;
};

/** Точки глав: ближайшие к равным долям ролика начала абзацев. Если YouTube не примет такие главы, предложения нет. */
export function proposeChapters(rows: ChapterRow[], duration: number): Chapter[] {
  if (!rows.length || !Number.isFinite(duration) || duration <= 0) return [];
  const want = Math.max(MIN_CHAPTERS, Math.min(MAX_CHAPTERS, Math.round(duration / 60 / 1.5)));
  const starts = rows.filter((r, i) => i > 0 && r.paragraph !== rows[i - 1].paragraph);
  const picked = [rows[0]];
  let last = 0;
  for (let k = 1; k < want; k++) {
    const target = (duration * k) / want;
    let best: ChapterRow | null = null;
    for (const c of starts) {
      const t = Math.floor(c.start);
      if (t < last + MIN_CHAPTER_SEC || t > duration - MIN_CHAPTER_SEC) continue;
      if (!best || Math.abs(t - target) < Math.abs(Math.floor(best.start) - target)) best = c;
    }
    if (best) { picked.push(best); last = Math.floor(best.start); }
  }
  if (picked.length < MIN_CHAPTERS) return [];
  return picked.map((r, i) => ({ scene: r.n, start: i === 0 ? 0 : Math.floor(r.start), excerpt: excerptOf(r.text), title: "" }));
}

/** Название возвращается к главе, только если сцена осталась той же по тексту: после новой нарезки номера значат другое. */
export function mergeChapters(proposed: Chapter[], stored: StoredChapter[]): Chapter[] {
  return proposed.map((c) => ({ ...c, title: stored.find((s) => s.scene === c.scene && s.excerpt === c.excerpt)?.title ?? "" }));
}

export type CardCheck = { code: string; level: "ok" | "warn" | "block"; message: string };
export type CardFacts = {
  hasMontage: boolean; busy: boolean; accepted: boolean; facts: "none" | "stale" | "issues" | "passed"; boardChanged: boolean;
  card: Omit<StoredCard, "chapters">; chapters: Chapter[];
};
const FACTS: Record<Exclude<CardFacts["facts"], "passed">, string> = {
  none: "Программа считает факты сценария непроверенными. Ручная проверка ей неизвестна.",
  stale: "Сценарий меняли после проверки фактов.",
  issues: "После проверки фактов остались неисправленные места.",
};

/** Блокировка — публиковать нельзя. Предупреждение — можно, но автор должен об этом знать. */
export function assessCard(o: CardFacts): { checks: CardCheck[]; ready: boolean } {
  const checks: CardCheck[] = [];
  const need = (code: string, done: boolean, okText: string, blockText: string) => checks.push({ code, level: done ? "ok" : "block", message: done ? okText : blockText });
  if (o.busy) checks.push({ code: "busy", level: "block", message: "Идёт сборка этого ролика. Дождитесь окончания." });
  need("montage", o.hasMontage, "Ролик собран.", "Ролик ещё не собран: сначала соберите его в разделе «Монтаж».");
  need("accepted", o.accepted, "Ролик принят вами.", "Ролик не принят: посмотрите его и нажмите «Принять ролик» в разделе «Монтаж».");
  if (o.facts !== "passed") checks.push({ code: "facts", level: "warn", message: FACTS[o.facts] });
  if (o.boardChanged) checks.push({ code: "board-changed", level: "warn", message: "Раскадровку меняли после сборки. Время глав могло разойтись с видео." });
  need("language", !!o.card.language, "Язык указан.", "Укажите язык ролика.");
  need("category", !!o.card.categoryId, "Категория выбрана.", "Выберите категорию.");
  need("kids", o.card.madeForKids !== null, "Ответ об аудитории дан.", "Ответьте, снят ли ролик для детей.");
  need("synthetic", o.card.syntheticMedia !== null, "Ответ об ИИ дан.", "Ответьте, нужно ли отмечать реалистичный контент, созданный или изменённый ИИ.");
  if (!o.chapters.length) { if (o.hasMontage) checks.push({ code: "chapters", level: "warn", message: "Для этого ролика главы предложить нельзя: YouTube требует минимум три главы по 10 секунд." }); }
  else need("chapters", o.chapters.every((c) => c.title), "Названия глав заполнены.", "Заполните названия всех глав.");
  checks.push(o.card.thumbnail ? { code: "thumbnail", level: "ok", message: "Обложка загружена." } : { code: "thumbnail", level: "warn", message: "Обложки нет: YouTube подставит кадр из видео." });
  return { checks, ready: checks.every((c) => c.level !== "block") };
}

/** Проверка файла обложки по содержимому, а не по расширению. */
export async function inspectThumbnail(buf: Buffer) {
  if (buf.length > MAX_THUMBNAIL_BYTES) throw new ApiError("VALIDATION", "Обложка больше 2 МБ: YouTube такую не примет. Уменьшите файл.");
  const meta = await sharp(buf).metadata().catch(() => null);
  if (!meta || (meta.format !== "jpeg" && meta.format !== "png") || !meta.width || !meta.height) throw new ApiError("VALIDATION", "Обложка должна быть файлом JPG или PNG.");
  if (meta.width < MIN_THUMBNAIL_WIDTH) throw new ApiError("VALIDATION", `Обложка уже ${MIN_THUMBNAIL_WIDTH} пикселей: YouTube такую не примет.`);
  if (Math.abs(meta.width / meta.height - 16 / 9) > 0.02) throw new ApiError("VALIDATION", "Соотношение сторон обложки должно быть 16:9, например 1280×720.");
  return { ext: meta.format === "jpeg" ? "jpg" : "png", width: meta.width, height: meta.height, bytes: buf.length };
}

async function readCard(projectId: string): Promise<StoredCard> {
  const raw = await fs.readFile(projectFile(projectId, CARD), "utf8").catch(() => null);
  if (!raw) return { ...EMPTY };
  try { return { ...EMPTY, ...(JSON.parse(raw) as Partial<StoredCard>) }; } catch { return { ...EMPTY }; }
}
async function writeCard(projectId: string, card: StoredCard) {
  const file = projectFile(projectId, CARD), tmp = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  try { await fs.writeFile(tmp, JSON.stringify(card), "utf8"); await fs.rename(tmp, file); }
  finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
}
// Сохранения одного проекта идут по очереди: форма и обложка не затирают друг друга.
const queues = new Map<string, Promise<unknown>>();
function serial<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const p = (queues.get(projectId) ?? Promise.resolve()).then(fn, fn);
  queues.set(projectId, p.catch(() => {}));
  return p;
}

async function currentChapters(projectId: string, stored: StoredChapter[]) {
  const [v, m] = await Promise.all([visualState(projectId), montageState(projectId)]);
  return { visual: v, montage: m, chapters: m.result ? mergeChapters(proposeChapters(v.board?.rows ?? [], m.result.seconds), stored) : [] };
}

export async function publishState(projectId: string) {
  const stored = await readCard(projectId);
  const [{ visual, montage, chapters }, exported] = await Promise.all([currentChapters(projectId, stored.chapters), exportState(projectId)]);
  const { chapters: _stored, ...rest } = stored;
  const card = { ...rest, language: stored.language ?? visual.board?.language ?? null };
  const r = montage.result;
  const boardChanged = !!r && !!visual.board && visual.board.updatedAt > r.at;
  return {
    project: visual.project,
    montage: r ? { file: r.file, seconds: r.seconds, bytes: r.bytes, width: r.width, height: r.height, at: r.at } : null,
    accepted: exported.accepted, card, chapters, categories: CATEGORIES,
    ...assessCard({ hasMontage: !!r, busy: !!montage.running, accepted: !!exported.accepted, facts: exported.facts, boardChanged, card, chapters }),
  };
}

export function saveCard(projectId: string, raw: unknown) {
  const input = CardInput.parse(raw);
  return serial(projectId, async () => {
    const stored = await readCard(projectId);
    const { chapters } = await currentChapters(projectId, []);
    const chaptersToStore = input.chapters.map((c) => {
      const found = chapters.find((x) => x.scene === c.scene);
      if (!found) throw new ApiError("VALIDATION", "Главы изменились. Обновите страницу.", 409);
      return { scene: c.scene, excerpt: found.excerpt, title: c.title };
    });
    await writeCard(projectId, { ...stored, language: input.language, categoryId: input.categoryId, madeForKids: input.madeForKids, syntheticMedia: input.syntheticMedia, chapters: chaptersToStore });
    return publishState(projectId);
  });
}

export function saveThumbnail(projectId: string, raw: unknown) {
  const { data } = ThumbnailInput.parse(raw);
  const buf = Buffer.from(data, "base64");
  return serial(projectId, async () => {
    await visualState(projectId);
    const info = await inspectThumbnail(buf);
    const stored = await readCard(projectId);
    const file = `publish/thumbnail-${crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12)}.${info.ext}`;
    const full = projectFile(projectId, file);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buf);
    await writeCard(projectId, { ...stored, thumbnail: { file, width: info.width, height: info.height, bytes: info.bytes } });
    if (stored.thumbnail && stored.thumbnail.file !== file) await fs.rm(projectFile(projectId, stored.thumbnail.file), { force: true }).catch(() => {});
    return publishState(projectId);
  });
}

export function removeThumbnail(projectId: string) {
  return serial(projectId, async () => {
    const stored = await readCard(projectId);
    if (stored.thumbnail) {
      await writeCard(projectId, { ...stored, thumbnail: null });
      await fs.rm(projectFile(projectId, stored.thumbnail.file), { force: true }).catch(() => {});
    }
    return publishState(projectId);
  });
}
