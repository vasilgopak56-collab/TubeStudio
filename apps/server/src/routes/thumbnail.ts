import { Hono } from "hono";
import { z } from "zod";
import { ok, fail, ApiError } from "../lib/errors.js";
import { startJob } from "../lib/jobs.js";
import { THUMB_META, ThumbInput, runThumbnail, renderVariant, readThumb, normalize, storeThumb, type Variant } from "../services/thumbnail.js";
import { addArtifact, getProject, updateArtifactData } from "../services/projects.js";

export const thumbnailRoute = new Hono();
const parse = <T>(s: z.ZodType<T, unknown>, b: unknown): T => { const r = s.safeParse(b); if (!r.success) throw new ApiError("VALIDATION", r.error.issues.map((i) => i.message).join("; "), 400); return r.data; };
const Img = z.object({ mime: z.string(), b64: z.string().max(7_200_000) });
const Link = { projectId: z.string().optional(), artifactId: z.string().optional(), variant: z.enum(["A", "B", "C"]).optional() };

/** Записывает новую версию варианта в артефакт проекта (если он есть) */
async function pushVersion(o: { projectId?: string; artifactId?: string; variant?: string }, url: string, bytes: number, instruction?: string, prompt?: string) {
  if (!o.projectId || !o.artifactId || !o.variant) return;
  await updateArtifactData(o.projectId, o.artifactId, (d: { variants?: Variant[] }) => {
    const v = d?.variants?.find((x) => x.variant === o.variant);
    if (v) { v.versions = [...(v.versions ?? []), { url, instruction, createdAt: new Date().toISOString() }]; Object.assign(v, { url, bytes, status: "done", error: undefined }, prompt ? { prompt } : {}); }
    return d;
  }).catch(() => {});
}

thumbnailRoute.get("/thumbnail/meta", (c) => ok(c, THUMB_META));
thumbnailRoute.post("/thumbnail/generate", async (c) => {
  try { const i = parse(ThumbInput, await c.req.json()); return ok(c, { jobId: startJob((ctx) => runThumbnail(i, ctx)) }); } catch (e) { return fail(c, e); }
});
// перегенерация одного варианта (можно с правленым промптом)
thumbnailRoute.post("/thumbnail/regenerate", async (c) => {
  try {
    const i = parse(z.object({ prompt: z.string().min(10).max(4000), character: Img.optional(), ...Link }), await c.req.json());
    const r = await renderVariant(i.prompt, { projectId: i.projectId, refs: i.character ? [i.character] : undefined, prefix: `thumb${i.variant ?? ""}` });
    await pushVersion(i, r.url, r.bytes, undefined, i.prompt);
    return ok(c, r);
  } catch (e) { return fail(c, e); }
});
// правка текстом: исходная картинка + инструкция
thumbnailRoute.post("/thumbnail/edit", async (c) => {
  try {
    const i = parse(z.object({ url: z.string().max(300), instruction: z.string().min(3).max(1000), ...Link }), await c.req.json());
    const src = await readThumb(i.url);
    const r = await renderVariant(`Edit this YouTube thumbnail (16:9). Keep everything else identical — composition, characters, identity, style, text — and apply ONLY this change: ${i.instruction}`, { projectId: i.projectId, refs: [src], prefix: `edit${i.variant ?? ""}` });
    await pushVersion(i, r.url, r.bytes, i.instruction);
    return ok(c, r);
  } catch (e) { return fail(c, e); }
});
// сохранение результата Polish Studio (или любой загруженной картинки) → 1280×720 JPEG ≤ 2 МБ
thumbnailRoute.post("/thumbnail/save", async (c) => {
  try {
    const i = parse(z.object({ image: Img, title: z.string().max(200).optional(), projectId: z.string().optional() }), await c.req.json());
    const buf = await normalize(i.image.b64);
    let projectId: string | undefined;
    if (i.projectId) { try { await getProject(i.projectId); projectId = i.projectId; } catch { /* нет проекта */ } }
    const r = await storeThumb(projectId, buf, "polish");
    let artifactId: string | undefined;
    if (projectId) artifactId = (await addArtifact(projectId, { kind: "thumbnail", title: `Polish · ${i.title?.slice(0, 80) || "обложка"}`, data: { polished: r } })).id;
    return ok(c, { ...r, projectId, artifactId });
  } catch (e) { return fail(c, e); }
});
