// Prompt Studio: просмотр и правка промптов из интерфейса с версиями и откатом.
// Промпты читаются при каждом вызове, поэтому правка действует сразу, без пересборки.
import fs from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../lib/errors.js";
import { dataPath } from "../lib/storage.js";
import { PROMPTS_DIR, STYLES } from "./prompts.js";

const STYLE_NAME = Object.fromEntries(STYLES.map((s) => [s.id, s.name]));
const FIXED: Record<string, [string, string]> = {
  "comment-review/review.md": ["Комментарии — проверяемый разбор", "Метки и идеи по явной выборке, ссылки C1–C50 без выдуманных цитат"],
  "daily-ideas/ideas.md": ["Daily Ideas — идеи по сохранённым данным", "Пять гипотез с источниками, без выдуманных метрик и прогноза успеха"],
  "coach/chat.md": ["AI Coach — советы по контексту", "Чат по закреплённым источникам без инструментов и выдуманных метрик"],
  "transcripts/analysis.md": ["Транскрипт — разбор и новый сценарий", "Правила точного резюме, новой структуры и сохранения неопределённости"],
  "universal/1_ideas.md": ["Поиск тем — генерация идей", "Как нейросеть придумывает темы: линзы, эмоциональное ядро, скоринг-карта"],
  "universal/2_script.md": ["Сценарист — главные правила", "10 законов сценария, акты, хук, живой голос, длина предложений"],
  "topic_finder_grounded.md": ["Поиск тем на данных YouTube", "Как темы опираются на реальные видео-доказательства"],
  "script/structures.md": ["Структуры сюжета S1–S20", "Библиотека из 20 шаблонов повествования"],
  "visual/presets.md": ["Визуальные пресеты P1–P18", "18 стилей картинки для раскадровки"],
  "visual/universal.md": ["Раскадровка — универсальный стиль", "Базовые правила промптов для картинок и видео"],
  "seo/seo.md": ["SEO-пакет", "Заголовки по архетипам, описание, теги, комментарии"],
  "thumbnail/concepts.md": ["Обложки — 3 концепта", "Как придумываются варианты A/B/C и их промпты"],
  "humanizer/rewrite.md": ["Живой голос — правка текста", "Правила §/T, ограничения на факты и длину, 4 шага правки"],
};
const GROUP: Record<string, string> = { "comment-review": "Комментарии", "daily-ideas": "Daily Ideas", coach: "AI Coach", transcripts: "Транскрипты", universal: "Главные", ideation: "Поиск тем: стили ниш", script: "Сценарист: стили ниш", visual: "Раскадровка", seo: "SEO", thumbnail: "Обложки", humanizer: "Живой голос", "": "Главные" };

export const varsOf = (t: string) => [...new Set((t.match(/\{\{\w+\}\}/g) ?? []))].sort();
const words = (t: string) => (t.match(/\S+/g) ?? []).length;

function resolve(rel: string) {
  const clean = String(rel ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!/^[\w\-/]+\.md$/.test(clean) || clean.includes("..")) throw new ApiError("VALIDATION", "Недопустимый путь промпта", 400);
  const abs = path.resolve(PROMPTS_DIR, clean);
  if (!abs.startsWith(PROMPTS_DIR + path.sep)) throw new ApiError("VALIDATION", "Недопустимый путь промпта", 400);
  return { clean, abs };
}
const verDir = (clean: string) => dataPath("prompt-versions", clean.replace(/\//g, "__").replace(/\.md$/, ""));

async function walk(dir: string, base = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...await walk(path.join(dir, e.name), rel));
    else if (e.name.endsWith(".md")) out.push(rel);
  }
  return out;
}

export async function listPrompts() {
  const files = await walk(PROMPTS_DIR);
  const rows = await Promise.all(files.map(async (rel) => {
    const { abs, clean } = resolve(rel);
    const [txt, st] = await Promise.all([fs.readFile(abs, "utf8"), fs.stat(abs)]);
    const folder = clean.includes("/") ? clean.split("/")[0] : "";
    const id = path.basename(clean, ".md");
    const [title, desc] = FIXED[clean] ?? [
      folder === "ideation" ? `Поиск тем: ${STYLE_NAME[id] ?? id}` : folder === "script" ? `Сценарист: ${STYLE_NAME[id] ?? id}` : folder === "visual" ? `Раскадровка: ${STYLE_NAME[id] ?? id}` : id,
      folder === "ideation" ? "Стиль-пресет ниши для поиска тем" : folder === "script" ? "Стиль ниши: тон, приёмы, ритм для сценария" : folder === "visual" ? "Визуальный стиль ниши для раскадровки" : "",
    ];
    let versions = 0; let edited = false;
    try { const v = await fs.readdir(verDir(clean)); versions = v.filter((x) => x !== "original.md").length; edited = v.includes("original.md") && (await fs.readFile(path.join(verDir(clean), "original.md"), "utf8")) !== txt; } catch { /* нет версий */ }
    return { path: clean, group: GROUP[folder] ?? folder, title, desc, words: words(txt), vars: varsOf(txt), mtime: st.mtime.toISOString(), versions, edited };
  }));
  const order = Object.values(GROUP);
  return rows.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.title.localeCompare(b.title, "ru"));
}

export async function readPromptFile(rel: string) {
  const { clean, abs } = resolve(rel);
  const content = await fs.readFile(abs, "utf8").catch(() => { throw new ApiError("NOT_FOUND", "Промпт не найден", 404); });
  const original = await fs.readFile(path.join(verDir(clean), "original.md"), "utf8").catch(() => null);
  return { path: clean, content, vars: varsOf(content), original };
}

async function snapshot(clean: string, content: string, label: string) {
  const dir = verDir(clean); await fs.mkdir(dir, { recursive: true });
  const orig = path.join(dir, "original.md");
  try { await fs.access(orig); } catch { await fs.writeFile(orig, content); return; } // первая правка: сохраняем заводскую версию
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.writeFile(path.join(dir, `${id}.md`), content);
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({ label }));
}

export async function writePromptFile(rel: string, content: string, force = false) {
  const { clean, abs } = resolve(rel);
  if (typeof content !== "string" || content.trim().length < 20) throw new ApiError("VALIDATION", "Промпт пустой или слишком короткий", 400);
  if (content.length > 400_000) throw new ApiError("VALIDATION", "Промпт слишком большой", 400);
  const cur = await fs.readFile(abs, "utf8");
  if (cur === content) return { path: clean, saved: false };
  const lost = varsOf(cur).filter((v) => !content.includes(v));
  if (lost.length && !force) throw new ApiError("VALIDATION", `В новом тексте пропали переменные ${lost.join(", ")} — без них программа не сможет подставить данные. Верните их или сохраните «всё равно».`, 400, false);
  if (/===SYSTEM===/.test(cur) && !/===SYSTEM===[\s\S]*===USER===/.test(content) && !force) throw new ApiError("VALIDATION", "Пропали разделители ===SYSTEM=== / ===USER===", 400);
  await snapshot(clean, cur, "до правки");
  const tmp = abs + ".tmp"; await fs.writeFile(tmp, content); await fs.rename(tmp, abs);
  return { path: clean, saved: true, lost };
}

export async function listVersions(rel: string) {
  const { clean } = resolve(rel);
  const dir = verDir(clean);
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const rows = await Promise.all(names.filter((n) => n.endsWith(".md")).map(async (n) => {
    const txt = await fs.readFile(path.join(dir, n), "utf8");
    const id = n.replace(/\.md$/, "");
    const meta = await fs.readFile(path.join(dir, `${id}.json`), "utf8").then(JSON.parse).catch(() => ({}));
    const createdAt = id === "original" ? null : id.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1T$2:$3:$4.$5Z");
    return { id, label: id === "original" ? "Заводская версия" : meta.label ?? "версия", createdAt, words: words(txt) };
  }));
  return rows.sort((a, b) => (a.id === "original" ? -1 : b.id === "original" ? 1 : b.id.localeCompare(a.id)));
}
export async function readVersion(rel: string, id: string) {
  const { clean } = resolve(rel);
  if (!/^[\w-]+$/.test(id)) throw new ApiError("VALIDATION", "Неверная версия", 400);
  return fs.readFile(path.join(verDir(clean), `${id}.md`), "utf8").catch(() => { throw new ApiError("NOT_FOUND", "Версия не найдена", 404); });
}
export async function restoreVersion(rel: string, id: string) {
  const content = await readVersion(rel, id);
  return writePromptFile(rel, content, true);
}
