import { Hono } from "hono";
import { z } from "zod";
import { ok, fail, ApiError } from "../lib/errors.js";
import { startJob } from "../lib/jobs.js";
import { STYLES } from "../services/prompts.js";
import { TopicInput, deleteTemplate, listRuns, listTemplates, loadRun, runTopicFinder, saveTemplate } from "../services/topicFinder.js";
import { addArtifact, createProject, deleteArtifact, deleteProject, exportZip, getProject, listProjects, updateProject } from "../services/projects.js";

const parse = <T>(schema: z.ZodType<T, unknown>, body: unknown): T => {
  const r = schema.safeParse(body);
  if (!r.success) throw new ApiError("VALIDATION", r.error.issues.map((i) => i.message).join("; "), 400);
  return r.data;
};
const h = (fn: (c: any) => Promise<unknown>) => async (c: any) => { try { return ok(c, await fn(c)); } catch (e) { return fail(c, e instanceof z.ZodError ? new ApiError("VALIDATION", e.issues.map((i) => i.message).join("; ")) : e); } };

export const content = new Hono();

// Поиск тем
content.get("/topics/styles", h(async () => STYLES));
content.post("/topics", h(async (c) => { const input = parse(TopicInput, await c.req.json()); return { jobId: startJob((ctx) => runTopicFinder(input, ctx)) }; }));
content.get("/topics/runs", h(() => listRuns()));
content.get("/topics/runs/:id", h(async (c) => { const r = await loadRun(c.req.param("id")); if (!r) throw new ApiError("NOT_FOUND", "Подборка не найдена", 404); return r; }));
content.get("/topics/templates", h(() => listTemplates()));
content.post("/topics/templates", h(async (c) => saveTemplate(await c.req.json())));
content.delete("/topics/templates/:id", h(async (c) => { await deleteTemplate(c.req.param("id")); return {}; }));

// Проекты
const ProjectInput = z.object({ title: z.string().min(1).max(300), niche: z.string().max(200).optional() });
content.get("/projects", h(() => listProjects()));
content.post("/projects", h(async (c) => createProject(parse(ProjectInput, await c.req.json()))));
content.get("/projects/:id", h((c) => getProject(c.req.param("id"))));
content.patch("/projects/:id", h(async (c) => updateProject(c.req.param("id"), parse(ProjectInput.partial(), await c.req.json()))));
content.delete("/projects/:id", h(async (c) => { await deleteProject(c.req.param("id")); return {}; }));
content.post("/projects/:id/artifacts", h(async (c) => addArtifact(c.req.param("id"), await c.req.json())));
content.delete("/projects/:id/artifacts/:aid", h((c) => deleteArtifact(c.req.param("id"), c.req.param("aid"))));
content.get("/projects/:id/export", async (c) => {
  try {
    const { name, data } = await exportZip(c.req.param("id"));
    return new Response(data, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } });
  } catch (e) { return fail(c, e); }
});
