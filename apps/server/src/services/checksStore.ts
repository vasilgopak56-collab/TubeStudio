import { addArtifact, getProject } from "./projects.js";
/** Сохраняет отчёт проверки в проект (артефакт kind=check); возвращает projectId или undefined */
export async function saveCheck(projectId: string, tool: string, title: string, data: object): Promise<string | undefined> {
  try { await getProject(projectId); await addArtifact(projectId, { kind: "check", title, data: { tool, ...data } }); return projectId; } catch { return undefined; }
}
