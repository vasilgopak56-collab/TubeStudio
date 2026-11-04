import crypto from "node:crypto";
import { z } from "zod";
import { readJson, writeJson } from "../lib/storage.js";
import { createProject } from "./projects.js";

export const SavedTopicInput = z.object({
  title: z.string().min(3).max(300),
  niche: z.string().max(200).optional(),
  score: z.number().min(0).max(100).optional(),
  source: z.enum(["analysis", "topic-finder", "research", "digest", "comments", "manual"]).default("manual"),
  notes: z.string().max(5000).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type SavedTopic = z.infer<typeof SavedTopicInput> & { id: string; createdAt: string; status: "idea" | "script" | "done"; projectId?: string };

const FILE = "topics.json";
export const listTopics = () => readJson<SavedTopic[]>(FILE, []);
export async function addTopic(input: unknown) {
  const t = SavedTopicInput.parse(input);
  const all = await listTopics();
  const dup = all.find((x) => x.title.trim().toLowerCase() === t.title.trim().toLowerCase());
  if (dup) return dup;
  // Проект создаётся автоматически при сохранении темы (ТЗ §6.13)
  const project = await createProject({ title: t.title, niche: t.niche, artifact: { kind: "topic", title: t.title, data: { score: t.score, source: t.source, ...(t.meta ?? {}) } } });
  const row: SavedTopic = { ...t, id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: "idea", projectId: project.id };
  await writeJson(FILE, [row, ...all]);
  return row;
}
export async function updateTopic(id: string, patch: Partial<SavedTopic>) {
  const all = await listTopics();
  const i = all.findIndex((x) => x.id === id);
  if (i < 0) return null;
  all[i] = { ...all[i], ...patch, id };
  await writeJson(FILE, all);
  return all[i];
}
export async function deleteTopic(id: string) { await writeJson(FILE, (await listTopics()).filter((x) => x.id !== id)); }
