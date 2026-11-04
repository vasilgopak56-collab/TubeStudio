import { checkCancelled } from "../lib/taskContext.js";
import { seoToText } from "./seoText.js";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { zipSync, strToU8 } from "fflate";
import { ApiError } from "../lib/errors.js";
import { dataPath, writeJson } from "../lib/storage.js";

export const KINDS = ["topic", "analysis", "script", "audio", "seo", "thumbnail", "storyboard", "check", "note", "video", "shorts"] as const;
export const ArtifactInput = z.object({
  kind: z.enum(KINDS),
  title: z.string().min(1).max(300),
  data: z.unknown().optional(),
  files: z.array(z.string()).optional(), // пути относительно data/files/<projectId>/
});
export type Artifact = z.infer<typeof ArtifactInput> & { id: string; createdAt: string; version?: number };
export type Project = { id: string; title: string; niche?: string; createdAt: string; updatedAt: string; artifacts: Artifact[] };
export type ProjectSummary = Omit<Project, "artifacts"> & { counts: Partial<Record<(typeof KINDS)[number], number>>; last?: { kind: string; title: string; createdAt: string } };

export const safe = (id: string) => id.replace(/[^\w-]/g, "");
const file = (id: string) => `projects/${safe(id)}.json`;

// Проверяем минимальную структуру, которая нужна для чтения и безопасного изменения.
// Дополнительные поля старых версий сохраняются как есть; это не полная проверка артефактов.
function validProject(value: unknown, id: string): value is Project {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  if (p.id !== id || typeof p.title !== "string" || typeof p.createdAt !== "string" || typeof p.updatedAt !== "string" || !Array.isArray(p.artifacts)) return false;
  return p.artifacts.every((v: unknown) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    const a = v as Record<string, unknown>;
    return typeof a.id === "string" && typeof a.kind === "string" && typeof a.title === "string" && typeof a.createdAt === "string";
  });
}
const projectFileLabel = (name: string) => /^[\w-]{1,100}\.json$/.test(name) ? `«${name}»` : "с некорректным именем";
const storeError = (message: string) => new ApiError("PROJECT_STORE", message, 503, false);
const unavailable = () => storeError("Папка проектов недоступна или отсутствует. Проверьте диск, папку данных и права доступа. Не заменяйте файлы до создания копии.");
async function assertProjectsFolder() {
  try { if (!(await fs.stat(dataPath("projects"))).isDirectory()) throw new Error("not directory"); }
  catch { throw unavailable(); }
}
async function readProject(name: string, missingIsNotFound: boolean): Promise<Project> {
  let text: string;
  try { text = await fs.readFile(dataPath("projects", name), "utf8"); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT" && missingIsNotFound) {
      // ENOENT может означать оборванную ссылку, а не отсутствие записи.
      let entryExists = false;
      try { await fs.lstat(dataPath("projects", name)); entryExists = true; }
      catch (statError) { if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw storeError(`Не удалось проверить файл проекта ${projectFileLabel(name)}. Сначала создайте копию папки данных.`); }
      if (entryExists) throw storeError(`Файл проекта ${projectFileLabel(name)} существует, но недоступен для чтения. Сначала создайте копию папки данных.`);
      await assertProjectsFolder();
      throw new ApiError("NOT_FOUND", "Проект не найден", 404);
    }
    throw storeError(`Не удалось прочитать файл проекта ${projectFileLabel(name)}. Проверьте доступ к диску и файлу; сначала создайте копию папки данных.`);
  }
  let p: unknown;
  try { p = JSON.parse(text); } catch { throw storeError(`Файл проекта ${projectFileLabel(name)} содержит некорректный JSON. Он не изменён. Сначала сохраните копию папки данных, затем проверьте резервную копию.`); }
  if (!validProject(p, name.slice(0, -5))) throw storeError(`Файл проекта ${projectFileLabel(name)} имеет неподдерживаемую или повреждённую структуру. Он не изменён. Сначала сохраните копию папки данных, затем проверьте резервную копию.`);
  return p;
}
export async function getProject(id: string) {
  return readProject(`${safe(id)}.json`, true);
}
async function save(p: Project) { checkCancelled(); p.updatedAt = new Date().toISOString(); await writeJson(file(p.id), p); return p; }

export async function listProjects(): Promise<ProjectSummary[]> {
  let names: string[];
  try { names = (await fs.readdir(dataPath("projects"))).filter((n) => n.endsWith(".json")).sort(); }
  catch { throw unavailable(); }
  const all = await Promise.all(names.map((n) => readProject(n, false)));
  return all.map(({ artifacts, ...p }) => {
    const counts: ProjectSummary["counts"] = {};
    for (const a of artifacts) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
    const l = artifacts.at(-1);
    return { ...p, counts, last: l && { kind: l.kind, title: l.title, createdAt: l.createdAt } };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function createProjectUnlocked(input: { title: string; niche?: string; artifact?: z.infer<typeof ArtifactInput> }) {
  const now = new Date().toISOString();
  const p: Project = { id: crypto.randomUUID(), title: input.title.slice(0, 300), niche: input.niche, createdAt: now, updatedAt: now, artifacts: [] };
  if (input.artifact) p.artifacts.push({ ...input.artifact, id: crypto.randomUUID(), createdAt: now });
  return save(p);
}
async function updateProjectUnlocked(id: string, patch: { title?: string; niche?: string }) {
  const p = await getProject(id);
  if (patch.title) p.title = patch.title.slice(0, 300);
  if (patch.niche !== undefined) p.niche = patch.niche;
  return save(p);
}
async function deleteProjectUnlocked(id: string) {
  await getProject(id); // Не удаляем нечитаемый/повреждённый проект и его медиа.
  await fs.rm(dataPath(file(id)), { force: true });
  await fs.rm(dataPath("files", safe(id)), { recursive: true, force: true });
}
async function addArtifactUnlocked(id: string, input: unknown) {
  const a = ArtifactInput.parse(input);
  const p = await getProject(id);
  const version = p.artifacts.filter((x) => x.kind === a.kind).length + 1;
  const row: Artifact = { ...a, id: crypto.randomUUID(), createdAt: new Date().toISOString(), version };
  p.artifacts.push(row);
  await save(p);
  return row;
}
/** Обновляет data артефакта (история версий обложек и т.п.) */
async function updateArtifactDataUnlocked(id: string, aid: string, fn: (d: any) => unknown) {
  const p = await getProject(id);
  const a = p.artifacts.find((x) => x.id === aid);
  if (!a) throw new ApiError("NOT_FOUND", "Артефакт не найден", 404);
  a.data = fn(a.data);
  await save(p);
  return a;
}
async function deleteArtifactUnlocked(id: string, aid: string) {
  const p = await getProject(id);
  p.artifacts = p.artifacts.filter((a) => a.id !== aid);
  return save(p);
}

const KIND_RU: Record<string, string> = { topic: "Тема", analysis: "Анализ", script: "Сценарий", audio: "Озвучка", seo: "SEO", thumbnail: "Обложка", storyboard: "Раскадровка", check: "Проверка", note: "Заметка", video: "Видео", shorts: "Shorts" };

function artifactText(a: Artifact): { ext: string; body: string } {
  const d = a.data as any;
  if (typeof d === "string") return { ext: "txt", body: d };
  if (a.kind === "script" && typeof d?.script === "string") return { ext: "txt", body: d.script };
  if (a.kind === "seo" && d?.titles) return { ext: "txt", body: seoToText(d) };
  if (a.kind === "thumbnail" && Array.isArray(d?.variants)) return { ext: "txt", body: d.variants.map((v: any) => `ВАРИАНТ ${v.variant}: ${v.idea}\nТекст: ${v.text || "—"}\nПочему: ${v.why}\nФайл: ${v.url ?? "—"}\nПромпт: ${v.prompt}\n`).join("\n") };
  if (a.kind === "storyboard" && Array.isArray(d?.rows)) {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = d.source === "audio"
      ? ["n;filename;speech_start_seconds;speech_end_seconds;timeline_start_seconds;timeline_end_seconds;text;concept;image;animation;seconds", ...d.rows.map((r: any) => [r.n,r.filename,r.start,r.end,r.timelineStart,r.timelineEnd,r.text,r.concept,r.image,r.video,r.seconds].map(q).join(";"))]
      : ["n;text;concept;image;video;seconds", ...d.rows.map((r: any) => [r.n, r.text, r.concept, r.image, r.video, r.seconds].map(q).join(";"))];
    return { ext: "csv", body: "\uFEFF" + lines.join("\n") };
  }
  if(a.kind==='note'&&d?.source==='research-comparison'&&d?.scriptBrief)return {ext:'md',body:`# ${a.title}\n\n${d.scriptBrief.notes}\n\n## Закреплённые источники и решение\n\n`+JSON.stringify({snapshot:d.snapshot,review:d.review,summary:d.summary},null,2)};
  if(a.kind==='topic'&&d?.source==='research-workflow'&&d?.scriptBrief)return {ext:'md',body:`# ${a.title}\n\n${d.scriptBrief.notes}\n\n## Исходные данные\n\n`+JSON.stringify({evidence:d.evidence,observations:d.observations},null,2)};
  if (a.kind === "topic" && d) {
    const lines = [`# ${a.title}`, "", d.score != null ? `Оценка: ${d.score}` : "", d.hook ? `\n## Хук\n${d.hook}` : "", d.why ? `\n## Почему сработает\n${d.why}` : "",
      d.audience ? `\n## Аудитория\n${d.audience}` : "", d.thumbnail?.visual ? `\n## Концепт обложки\n${d.thumbnail.visual}${d.thumbnail.text ? `\nТекст: ${d.thumbnail.text}` : ""}` : "",
      d.evidence?.length ? `\n## Похожие видео\n${d.evidence.map((e: any) => `- ${e.title} — https://youtu.be/${e.id}`).join("\n")}` : ""];
    return { ext: "md", body: lines.filter(Boolean).join("\n") };
  }
  if (a.kind === "shorts" && Array.isArray(d?.shorts)) return { ext: "md", body: d.shorts.map((x: any, i: number) => `## Short ${i + 1}: ${x.title}\n\n${x.script}\n\nНа экране: ${(x.onScreen ?? []).join(" · ")}\nCTA: ${x.cta}\nХэштеги: ${(x.hashtags ?? []).join(" ")}\nИсточник: «${x.quote}»\n`).join("\n") };
  return { ext: "json", body: JSON.stringify(d ?? {}, null, 2) };
}

export async function exportZip(id: string) {
  const p = await getProject(id);
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = { "project.json": strToU8(JSON.stringify(p, null, 2)) };
  p.artifacts.forEach((a, i) => {
    const { ext, body } = artifactText(a);
    const name = `${String(i + 1).padStart(2, "0")}_${a.kind}${a.version && a.version > 1 ? `_v${a.version}` : ""}.${ext}`;
    files[name] = strToU8(body);
  });
  const dir = dataPath("files", safe(id));
  const walk = async (d: string, rel = ""): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!/^draft_\d+$/.test(e.name)) await walk(full, r); }
      else { const b = new Uint8Array(await fs.readFile(full)); files[`files/${r}`] = /\.(mp4|mp3|m4a|png|jpe?g|webp)$/i.test(e.name) ? [b, { level: 0 }] : b; }
    }
  };
  await walk(dir);
  return { name: `${p.title.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60) || "project"}.zip`, data: zipSync(files, { level: 6 }) };
}

/** One process queue: also used by confirmed assistant actions. Restore/external writers
 * must run while the application is stopped; this is not an interprocess lock. */
let mutationTail: Promise<unknown> = Promise.resolve();
export function withProjectMutation<T>(fn:()=>Promise<T>):Promise<T> {
 const work=mutationTail.catch(()=>{}).then(()=>{checkCancelled();return fn();});mutationTail=work;return work;
}
export function createProject(...args:Parameters<typeof createProjectUnlocked>){return withProjectMutation(()=>createProjectUnlocked(...args));}
export function updateProject(...args:Parameters<typeof updateProjectUnlocked>){return withProjectMutation(()=>updateProjectUnlocked(...args));}
export function deleteProject(...args:Parameters<typeof deleteProjectUnlocked>){return withProjectMutation(()=>deleteProjectUnlocked(...args));}
export function addArtifact(...args:Parameters<typeof addArtifactUnlocked>){return withProjectMutation(()=>addArtifactUnlocked(...args));}
export function updateArtifactData(...args:Parameters<typeof updateArtifactDataUnlocked>){return withProjectMutation(()=>updateArtifactDataUnlocked(...args));}
export function deleteArtifact(...args:Parameters<typeof deleteArtifactUnlocked>){return withProjectMutation(()=>deleteArtifactUnlocked(...args));}
