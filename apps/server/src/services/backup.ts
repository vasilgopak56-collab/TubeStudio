import { APP_VERSION } from "../lib/version.js";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { strToU8, unzipSync, zipSync } from "fflate";
import { ApiError } from "../lib/errors.js";

export const DATA_FOLDERS = new Set([
  "assistant-voice", "assistant-workflows", "assistant-brainstorm-results", "assistant-brainstorm-brand-results", "assistant-brainstorm-images", "assistant-brainstorm-plans",
  "assistant-runs", "assistant-skills", "assistant-skill-visibility", "assistant-attempts",
  "director-packages", "director-assets", "projects", "files", "reports", "topic-runs", "audio-storyboards", "pipelines",
  "yt-reach-runs", "yt-channel-runs", "yt-revenue-runs", "ab-test-runs", "yt-geography-runs", "ad-break-runs", "profit-runs", "coach-runs", "transcript-runs", "niche-runs", "keyword-runs", "research-runs", "comment-runs", "scorecards", "video-score-runs", "daily-idea-runs", "seo-audit-runs", "comment-samples", "comment-reviews", "keyword-evidence-runs", "research-evidence-runs", "research-comparisons", "prompt-versions",
]);
const MANIFEST = "tubestudio-backup.json";
const PROMPTS = "backup-prompts/";
// ZIP operates in memory. For larger datasets use a stopped-server filesystem copy.
export const BACKUP_LIMITS = { archive: 512 * 1024 ** 2, file: 512 * 1024 ** 2, total: 1024 ** 3, count: 20_000 };
type Roots = { dataDir: string; promptsDir: string };

/** POSIX archive names only; reject Windows drive/ADS/reserved names on every OS. */
export function backupTarget(name: string): "data" | "prompts" | null {
  if (!name || name.includes("\\") || name.length > 1024) return null;
  const parts = name.split("/");
  if (parts.some(p => !p || p === "." || p === ".." || /[\x00-\x1f\x7f<>:"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) return null;
  if (parts.some(p => p.startsWith(".") || p.endsWith(".tmp"))) return null;
  if (name.startsWith(PROMPTS)) return /^[\w/-]+\.md$/.test(name.slice(PROMPTS.length)) ? "prompts" : null;
  if (parts.length === 1) return name !== MANIFEST && /^[\w-]+\.json$/.test(name) ? "data" : null;
  return DATA_FOLDERS.has(parts[0]) ? "data" : null;
}

function limit(message: string): never {
  throw new ApiError("VALIDATION", message + ". Для большого архива используйте файловую копию при остановленной программе.", 413);
}

/** Reject existing links/junctions at the root and its ancestors, including above a missing root.
 * This preflight is not a filesystem lock: stop other writers before backup/restore. */
async function validateRoot(root: string) {
  const absolute = path.resolve(root), parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const st = await fs.lstat(current).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
    if (!st) break;
    if (st.isSymbolicLink() || !st.isDirectory())
      throw new ApiError("VALIDATION", "Каталог резервного копирования содержит ссылку/junction или объект другого типа. Используйте обычный каталог и его физический путь.", 400);
  }
}

export async function exportBackup(roots: Roots): Promise<Uint8Array> {
  await validateRoot(roots.dataDir);
  await validateRoot(roots.promptsDir);
  const files: Record<string, Uint8Array> = Object.create(null);
  const skipped: string[] = [];
  let total = 0, count = 0;
  const walk = async (dir: string, rel: string, kind: "data" | "prompts") => {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT" && !rel) return; throw e; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (kind === "data" && !rel && ["cache", "logs"].includes(e.name)) continue;
      if (e.name.startsWith(".") || e.name.endsWith(".tmp")) continue;
      const name = kind === "prompts" ? PROMPTS + r : r;
      if (e.isSymbolicLink()) { skipped.push(name); continue; }
      if (e.isDirectory()) {
        if (kind === "data" && !rel && !DATA_FOLDERS.has(e.name)) { skipped.push(name + "/"); continue; }
        await walk(path.join(dir, e.name), r, kind);
      } else if (e.isFile()) {
        if (backupTarget(name) !== kind) { skipped.push(name); continue; }
        const st = await fs.stat(path.join(dir, e.name));
        if (st.size > BACKUP_LIMITS.file || total + st.size > BACKUP_LIMITS.total || ++count > BACKUP_LIMITS.count) limit("Превышен лимит резервной копии (1 ГиБ / 20 000 файлов)");
        const data = new Uint8Array(await fs.readFile(path.join(dir, e.name)));
        if (data.length > BACKUP_LIMITS.file || total + data.length > BACKUP_LIMITS.total) limit("Превышен размер резервной копии");
        total += data.length; files[name] = data;
      } else skipped.push(name);
    }
  };
  await walk(roots.dataDir, "", "data");
  await walk(roots.promptsDir, "", "prompts");
  files[MANIFEST] = strToU8(JSON.stringify({ version: 2, appVersion: APP_VERSION, createdAt: new Date().toISOString(), files: count, skipped, confidential: "May contain OAuth tokens and private content; .env is excluded." }));
  const archive = zipSync(files, { level: 6 });
  if (archive.length > BACKUP_LIMITS.archive) limit("ZIP больше 512 МиБ");
  return archive;
}

/** Do not follow pre-existing symlinks/junctions or overwrite non-files. */
async function safeDestination(root: string, rel: string) {
  const parts = rel.split("/");
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const st = await fs.lstat(current).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
    if (!st) continue;
    if (st.isSymbolicLink() || (i < parts.length - 1 ? !st.isDirectory() : !st.isFile()))
      throw new ApiError("VALIDATION", `Нельзя восстановить ${rel}: путь содержит ссылку или объект другого типа`, 400);
  }
  return current;
}

export async function importBackup(buf: Uint8Array, roots: Roots) {
  if (buf.length < 22) throw new ApiError("VALIDATION", "Пустой файл или это не ZIP-архив", 400);
  if (buf.length > BACKUP_LIMITS.archive) limit("ZIP больше 512 МиБ");
  const skipped: string[] = [], seen = new Set<string>();
  let total = 0, count = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(buf, { filter: f => {
      if (f.name.endsWith("/")) return false;
      if (++count > BACKUP_LIMITS.count + 1) limit("Слишком много файлов в архиве");
      if (seen.has(f.name.toLowerCase())) throw new ApiError("VALIDATION", "Архив содержит повторяющиеся имена файлов", 400);
      seen.add(f.name.toLowerCase());
      if (f.name !== MANIFEST && !backupTarget(f.name)) { skipped.push(f.name); return false; }
      if (f.originalSize > BACKUP_LIMITS.file || (total += f.originalSize) > BACKUP_LIMITS.total) limit("Распакованный архив больше допустимого размера");
      return true;
    } });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("VALIDATION", "Это не ZIP-архив или он повреждён", 400);
  }
  if (!entries[MANIFEST]) throw new ApiError("VALIDATION", "Архив не похож на резервную копию TubeStudio", 400);
  let manifest;
  try { manifest = JSON.parse(new TextDecoder().decode(entries[MANIFEST])); } catch { /* validated below */ }
  if (!manifest || ![1, 2].includes(manifest.version)) throw new ApiError("VALIDATION", "Неизвестная версия резервной копии", 400);
  const warnings: string[] = [];
  if (Array.isArray(manifest.skipped) && manifest.skipped.length) warnings.push(`При экспорте не включено объектов: ${manifest.skipped.length}. Проверьте skipped в tubestudio-backup.json.`);
  if (manifest.version === 1) warnings.push("Старая копия v1 может не содержать текущие тексты пользовательских промптов.");
  // Validate all destinations before the first write. Restore merges; it does not delete other files.
  await validateRoot(roots.dataDir);
  await validateRoot(roots.promptsDir);
  const plan: { name: string; full: string; data: Uint8Array }[] = [];
  for (const [name, data] of Object.entries(entries)) {
    if (name === MANIFEST) continue;
    const kind = backupTarget(name)!;
    const root = kind === "prompts" ? roots.promptsDir : roots.dataDir;
    const rel = kind === "prompts" ? name.slice(PROMPTS.length) : name;
    const full = await safeDestination(path.resolve(root), rel);
    plan.push({ name, full, data });
  }
  const planned = new Set(plan.map(p => p.full.toLowerCase()));
  if (planned.size !== plan.length) throw new ApiError("VALIDATION", "Архив содержит разные имена для одного назначения; проверьте DATA_DIR и PROMPTS_DIR", 400);
  for (const { full } of plan) {
    let parent = path.dirname(full);
    while (parent !== path.dirname(parent)) {
      if (planned.has(parent.toLowerCase())) throw new ApiError("VALIDATION", "Архив содержит конфликт файла и каталога", 400);
      parent = path.dirname(parent);
    }
  }
  let imported = 0;
  try {
    for (const { full, data } of plan) {
      await fs.mkdir(path.dirname(full), { recursive: true });
      const tmp = `${full}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(tmp, data, { mode: 0o600, flag: "wx" });
        await fs.rename(tmp, full);
        // Commit happened even if subsequent temporary-file cleanup fails.
        imported++;
      } finally { await fs.rm(tmp, { force: true }); }
    }
  } catch (e) {
    const state = imported > 0
      ? "Часть файлов уже обновлена; автоматического отката нет."
      : "Ни один файл из архива не установлен; могли остаться временные файлы или пустые каталоги.";
    throw new ApiError("INTERNAL", `Восстановление прервано после ${imported} файлов. ${state} Сохраните исходную копию и проверьте свободное место и права доступа.`, 500, false, { imported, skipped });
  }
  return { imported, skipped, warnings };
}
