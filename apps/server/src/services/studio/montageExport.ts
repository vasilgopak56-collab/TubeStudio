// Выпуск 3, шаг 7: ручное принятие ролика и сохранение готовых файлов в папку автора.
// Принятие привязано к конкретному файлу: после новой сборки его нужно повторить. Существующие файлы не перезаписываются.
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { ApiError } from "../../lib/errors.js";
import type { JobCtx } from "../../lib/jobs.js";
import { checkCancelled, taskSignal } from "../../lib/taskContext.js";
import { factStatus, type FactCheckReport } from "./factCheck.js";
import { projectFile } from "./montageCheck.js";
import { montageBusy, montageState } from "./montageRender.js";
import { SUB_FILES } from "./montageSubtitles.js";

const ACCEPT = "montage/accepted.json", EXPORT = "montage/export.json";
export const AcceptInput = z.object({ file: z.string().min(1).max(400) }).strict();

type Accepted = { file: string; at: string };
type Exported = { folder: string; at: string; files: string[] };
async function readJson<T>(projectId: string, local: string): Promise<T | null> {
  const raw = await fs.readFile(projectFile(projectId, local), "utf8").catch(() => null);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}
async function writeJson(projectId: string, local: string, value: unknown) {
  const file = projectFile(projectId, local);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(value), "utf8");
  await fs.rename(`${file}.tmp`, file);
}

/** Принятие действует только для того файла, который автор смотрел. */
export const acceptedFor = (stored: Accepted | null, draftFile: string | null | undefined) => (stored && draftFile && stored.file === draftFile ? stored : null);

export async function exportState(projectId: string) {
  const { getProject } = await import("../projects.js");
  const p = await getProject(projectId);
  const [{ result }, stored, exported] = await Promise.all([montageState(projectId), readJson<Accepted>(projectId, ACCEPT), readJson<Exported>(projectId, EXPORT)]);
  const script = [...p.artifacts].reverse().find((a) => a.kind === "script")?.data as { script?: string; studio?: { factCheck?: FactCheckReport | null } } | undefined;
  return { accepted: acceptedFor(stored, result?.file), facts: factStatus(script?.script, script?.studio?.factCheck), exported };
}

export async function acceptMontage(projectId: string, raw: z.input<typeof AcceptInput>) {
  const { file } = AcceptInput.parse(raw);
  const { result } = await montageState(projectId);
  if (!result || result.file !== file) throw new ApiError("VALIDATION", "Черновик уже изменился. Обновите страницу и посмотрите новый вариант.", 409);
  const accepted = { file, at: new Date().toISOString() };
  await writeJson(projectId, ACCEPT, accepted);
  return { accepted };
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** Имя файла из названия ролика: без запрещённых в Windows символов. */
export function safeName(title: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "").slice(0, 150).replace(/[. ]+$/g, "");
  return !clean || RESERVED.test(clean) ? "video" : clean;
}
/** Свободное имя: занятое не перезаписывается, новый файл получает номер. */
export async function freeName(folder: string, name: string): Promise<string> {
  const { name: base, ext } = path.parse(name);
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? name : `${base} (${i})${ext}`;
    if (!await fs.stat(path.join(folder, candidate)).then(() => true, () => false)) return candidate;
  }
  throw new ApiError("VALIDATION", "В папке слишком много файлов с таким именем.");
}

export type ExportItem = { from: string; name: string };
/** Что сохранять: видео со вшитым текстом — только если собрано из принятого черновика. */
export function exportList(o: { title: string; draft: string; srt: string; burned?: { file: string; source: string } | null; hasSubtitles: boolean }): { local: string; name: string }[] {
  const base = safeName(o.title);
  return [
    { local: o.draft, name: `${base}.mp4` },
    ...(o.hasSubtitles ? [{ local: o.srt, name: `${base}.srt` }] : []),
    ...(o.burned && o.burned.source === o.draft ? [{ local: o.burned.file, name: `${base} (subtitles).mp4` }] : []),
  ];
}

/** Копирование через временное имя: сбой не оставит обрезанное видео под настоящим названием. */
export async function copyFiles(o: { items: ExportItem[]; folder: string; onProgress?: (done: number, total: number, name: string) => void; signal?: AbortSignal }): Promise<string[]> {
  const sizes = await Promise.all(o.items.map((i) => fs.stat(i.from).then((s) => s.size)));
  const total = sizes.reduce((a, b) => a + b, 0);
  const disk = await fs.statfs(o.folder);
  if (disk.bavail * disk.bsize < total) throw new ApiError("VALIDATION", `На диске не хватает места: нужно ${(total / 1024 ** 3).toFixed(2)} ГБ.`);
  const out: string[] = [], signal = taskSignal(o.signal);
  let done = 0;
  for (const [i, item] of o.items.entries()) {
    checkCancelled(signal);
    const name = await freeName(o.folder, item.name), target = path.join(o.folder, name), part = `${target}.part`;
    try {
      const from = createReadStream(item.from);
      from.on("data", (c) => { done += c.length; o.onProgress?.(done, total, name); });
      await pipeline(from, createWriteStream(part, { flags: "wx" }), signal ? { signal } : {});
      if ((await fs.stat(part)).size !== sizes[i]) throw new ApiError("UPSTREAM", `Файл «${name}» скопирован не полностью.`, 502);
      await fs.rename(part, target);
    } catch (e) {
      await fs.rm(part, { force: true }).catch(() => {});
      checkCancelled(signal);
      if (e instanceof ApiError) throw e;
      throw new ApiError("VALIDATION", `Не удалось сохранить «${name}». Проверьте папку и место на диске.`);
    }
    out.push(target);
  }
  return out;
}

const exporting = new Set<string>();
export const montageExporting = (projectId: string) => exporting.has(projectId);

export async function exportMontage(projectId: string, folder: string, ctx: JobCtx): Promise<Exported> {
  if (exporting.has(projectId)) throw new ApiError("VALIDATION", "Файлы этого ролика уже сохраняются.", 409);
  exporting.add(projectId);
  try {
    if (montageBusy(projectId)) throw new ApiError("VALIDATION", "Идёт сборка этого ролика. Дождитесь окончания.", 409);
    if (!path.isAbsolute(folder) || !await fs.stat(folder).then((s) => s.isDirectory(), () => false)) throw new ApiError("VALIDATION", "Папка не открывается. Выберите другую.");
    const { getProject } = await import("../projects.js");
    const [p, state, stored] = await Promise.all([getProject(projectId), montageState(projectId), readJson<Accepted>(projectId, ACCEPT)]);
    if (!state.result || !acceptedFor(stored, state.result.file)) throw new ApiError("VALIDATION", "Сначала посмотрите ролик и примите его.");
    const list = exportList({ title: p.title, draft: state.result.file, srt: SUB_FILES.srt, burned: state.burned, hasSubtitles: !!state.result.subtitles?.files });
    ctx.progress("Копирование", 1);
    const files = await copyFiles({
      folder, signal: ctx.signal, items: list.map((i) => ({ from: projectFile(projectId, i.local), name: i.name })),
      onProgress: (done, total, name) => ctx.progress(`Копирование: ${name}`, Math.min(99, Math.floor((99 * done) / total))),
    });
    const result = { folder, at: new Date().toISOString(), files };
    await writeJson(projectId, EXPORT, result);
    return result;
  } finally { exporting.delete(projectId); }
}
