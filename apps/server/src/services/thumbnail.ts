import { isFinancialError } from "../lib/errors.js";
import { rethrowCancelled } from "../lib/taskContext.js";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import type { JobCtx } from "../lib/jobs.js";
import { ApiError } from "../lib/errors.js";
import { fetchRetry } from "../lib/http.js";
import { dataPath } from "../lib/storage.js";
import { generateJson, LANG_NAME } from "./llm.js";
import { readPrompt } from "./prompts.js";
import { generateImage, type RefImage } from "./imageGen.js";
import { addArtifact, getProject, safe } from "./projects.js";

/** Варианты шагов (§6.8). Значение "ai" = «Пусть решит AI», "skip" = «Пропустить», иначе id или свой текст */
export const THUMB_META = {
  styles: [["realism", "Реализм 4K", "photorealistic 4K, hyper-detailed, cinematic photo"], ["aaa3d", "3D AAA-рендер", "AAA game 3D render, Unreal Engine 5, subsurface scattering"], ["darkdoc", "Тёмная документалистика", "dark documentary, moody desaturated, film grain, dramatic shadows"], ["pop", "Яркий поп", "vibrant pop style, saturated colors, punchy, clean"], ["vector", "2.5D-вектор", "2.5D flat vector illustration, layered depth, bold shapes"], ["stickman", "Стикмен", "simple stickman cartoon, thick black lines, white background accents"], ["faceless", "Безликий персонаж", "faceless featureless character, smooth blank face, stylized"], ["anime", "Аниме", "anime key visual, cel shading, expressive"]],
  emotions: [["shock", "Шок", "shocked, wide eyes, open mouth"], ["rage", "Ярость", "furious rage, clenched teeth"], ["smirk", "Хитрая ухмылка", "sly smirk, raised eyebrow"], ["fear", "Страх", "terrified, fear"], ["joy", "Восторг", "ecstatic joy, huge smile"], ["skeptic", "Скепсис", "skeptical, squinting, doubtful"], ["focus", "Фокус", "intense focus, serious stare"], ["tears", "Слёзы недоверия", "tears of disbelief"], ["confused", "Растерянность", "confused, puzzled"], ["heartbreak", "Разбитое сердце", "heartbroken, devastated"]],
  compositions: [["split", "Сплит-контраст", "split-screen contrast composition, two halves"], ["leftright", "Субъект слева / объект справа", "subject on the left third, key object on the right"], ["closeup", "Экстремальный крупный план", "extreme close-up, face fills the frame"], ["spotlight", "Центр-прожектор", "centered subject under a spotlight, dark surroundings"]],
  palettes: [["neon", "Неоновый жар", "neon magenta, electric blue and hot orange", ["#ff2bd6", "#1f6bff", "#ff7a00"]], ["luxury", "Тёмная роскошь", "black, deep gold and burgundy", ["#0b0b0b", "#c9a227", "#6b0f1a"]], ["cyber", "Кибер-зелень", "matrix green, black and teal", ["#00ff66", "#050a05", "#00b3a4"]], ["ocean", "Океанская тайна", "deep navy, turquoise and pale cyan", ["#0a1f44", "#00a6a6", "#bff7ff"]], ["fire", "Пылающий огонь", "fiery red, orange and yellow on black", ["#e10600", "#ff8c00", "#ffd60a"]], ["pastel", "Мягкая пастель", "soft pastel pink, mint and lavender", ["#ffc8dd", "#bde0c6", "#cdb4db"]]] as [string, string, string, string[]][],
  lights: [["rim", "Контровой свет", "strong rim light"], ["fog", "Туман/дым", "volumetric fog and smoke"], ["sparks", "Искры", "flying sparks and embers"], ["studio", "Мягкий студийный", "soft studio lighting"], ["neon", "Неоновое свечение", "neon glow"]],
  textPositions: [["top", "Сверху"], ["bottom", "Снизу"], ["left", "Слева"], ["right", "Справа"]],
};

// Missing steps stay absent (legacy partial-schema semantics); renderer chooses AI.
const Step = z.string().max(500);
export const ThumbInput = z.object({
  title: z.string().min(3).max(200), summary: z.string().max(3000).optional(), language: z.string().default("ru"),
  steps: z.object({ style: Step, character: Step, emotion: Step, outfit: Step, composition: Step, palette: Step, light: Step, textPos: Step, text: z.string().max(50) }).partial().prefault({}),
  character: z.object({ mime: z.string(), b64: z.string().max(7_200_000) }).optional(), // фото ≤ 5 МБ
  projectId: z.string().optional(),
  /** Ремикс: обложка-референс (YouTube) — берём идею и композицию, не копируем */
  styleRef: z.object({ url: z.string().url().max(500) }).optional(),
});
export type ThumbInputT = z.infer<typeof ThumbInput>;
export type Variant = { variant: "A" | "B" | "C"; idea: string; text: string; prompt: string; why: string; status: "pending" | "done" | "error"; url?: string; bytes?: number; model?: string; error?: string; versions: { url: string; instruction?: string; createdAt: string }[] };

const lookup = (list: string[][], v: string | undefined, kind: string) => {
  if (!v || v === "ai") return `${kind}: AI decides`;
  if (v === "skip") return `${kind}: skip`;
  const hit = list.find((x) => x[0] === v);
  return `${kind}: ${hit ? hit[2] : v}`;
};

/** Приводит картинку к 1280×720 JPEG ≤ 2 МБ (лимит YouTube) */
export async function normalize(b64: string) {
  const src = sharp(Buffer.from(b64, "base64")).rotate().resize(1280, 720, { fit: "cover", position: "attention" });
  for (const q of [92, 86, 80, 72, 64, 55]) { const buf = await src.clone().jpeg({ quality: q, mozjpeg: true }).toBuffer(); if (buf.length <= 2 * 1024 * 1024) return buf; }
  return src.jpeg({ quality: 45 }).toBuffer();
}
export async function storeThumb(projectId: string | undefined, buf: Buffer, prefix: string) {
  const pid = projectId ? safe(projectId) : "_thumbs";
  const name = `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}.jpg`;
  const dir = dataPath("files", pid); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(`${dir}/${name}`, buf);
  return { url: `/files/${pid}/${name}`, bytes: buf.length };
}
/** Читает ранее сохранённую обложку /files/<pid>/<name> */
export async function readThumb(url: string): Promise<RefImage> {
  const m = url.match(/^\/files\/([\w-]+)\/([\w.-]+)$/); if (!m) throw new ApiError("VALIDATION", "Неверный путь к картинке", 400);
  const buf = await fs.readFile(dataPath("files", m[1], m[2])).catch(() => { throw new ApiError("NOT_FOUND", "Картинка не найдена", 404); });
  return { mime: m[2].endsWith(".png") ? "image/png" : "image/jpeg", b64: buf.toString("base64") };
}

export async function renderVariant(prompt: string, o: { projectId?: string; refs?: RefImage[]; prefix: string }) {
  const img = await generateImage(prompt, { aspect: "16:9", refs: o.refs });
  const buf = await normalize(img.b64);
  return { ...(await storeThumb(o.projectId, buf, o.prefix)), model: img.model };
}

const Concepts = z.object({ concepts: z.array(z.object({ variant: z.string(), idea: z.string(), text: z.string().default(""), prompt: z.string().min(20), why: z.string().default("") })).min(3) });

async function fetchStyleRef(url: string) {
  const u = new URL(url);
  if (!/(^|\.)ytimg\.com$|(^|\.)ggpht\.com$|(^|\.)googleusercontent\.com$/.test(u.hostname)) throw new ApiError("VALIDATION", "Референс обложки: поддерживаются только картинки YouTube (i.ytimg.com)", 400);
  const r = await fetchRetry(url.replace(/\/(mq|hq|sd)default\.jpg/, "/hqdefault.jpg"), {}, { timeoutMs: 15_000, retries: 1 });
  if (!r.ok) throw new ApiError("UPSTREAM", `Не удалось скачать обложку-референс (HTTP ${r.status})`, 502);
  return { mime: r.headers.get("content-type") || "image/jpeg", b64: Buffer.from(await r.arrayBuffer()).toString("base64") };
}

export async function runThumbnail(input: ThumbInputT, ctx: JobCtx) {
  const s = input.steps; const L = LANG_NAME[input.language] ?? "Russian";
  ctx.progress("Концепты A/B/C", 5);
  const params = [
    lookup(THUMB_META.styles, s.style, "Art style"),
    input.character ? "Main character: the person from the attached reference photo" : (!s.character || s.character === "ai" ? "Main character: AI decides" : s.character === "skip" ? "Main character: skip (no person)" : `Main character: ${s.character}`),
    lookup(THUMB_META.emotions, s.emotion, "Emotion"),
    !s.outfit || s.outfit === "ai" ? "Outfit: AI decides" : s.outfit === "skip" ? "Outfit: skip" : `Outfit: ${s.outfit}`,
    lookup(THUMB_META.compositions, s.composition, "Composition (use for all variants where it fits, otherwise follow variant rule)"),
    lookup(THUMB_META.palettes as unknown as string[][], s.palette, "Palette"),
    lookup(THUMB_META.lights, s.light, "Light & FX"),
    `Text position: ${!s.textPos || s.textPos === "ai" ? "AI decides" : s.textPos}`,
    `Text: ${!s.text || s.text === "ai" ? "AI writes 1–3 words" : s.text === "skip" ? "skip (no text)" : `use exactly "${s.text}"`}`,
  ].join("\n");
  const system = (await readPrompt("thumbnail/concepts.md")).replaceAll("{{LANGUAGE}}", L);
  const ref = input.styleRef ? await fetchStyleRef(input.styleRef.url) : null;
  const imgs = [...(input.character ? [input.character] : []), ...(ref ? [ref] : [])];
  const remix = ref ? `\n\nREMIX MODE: the ${input.character ? "second" : "attached"} image is a proven high-performing thumbnail. Study WHY it works (layout, focal point, text treatment, contrast, colour logic, emotion) and recreate that idea for OUR title. Do NOT copy its text, people, logos or exact picture — viewers must not think they already watched it. Each image prompt must describe the full new scene.` : "";
  const { data } = await generateJson({ system, user: `VIDEO TITLE: ${input.title}\nSUMMARY: ${input.summary?.slice(0, 3000) || "-"}\n\nPARAMETERS:\n${params}${remix}`, images: imgs.length ? imgs : undefined, maxTokens: 3000, temperature: 0.9 }, Concepts);
  const variants: Variant[] = (["A", "B", "C"] as const).map((v, i) => { const c = data.concepts.find((x) => x.variant.toUpperCase().startsWith(v)) ?? data.concepts[i]; return { variant: v, idea: c.idea, text: s.text === "skip" ? "" : c.text, prompt: c.prompt, why: c.why, status: "pending", versions: [] }; });
  ctx.partial({ variants });
  ctx.progress("Генерация 3 вариантов", 25);
  let doneN = 0;
  let financialError: unknown;
  await Promise.all(variants.map(async (v) => {
    try { const r = await renderVariant(v.prompt, { projectId: input.projectId, refs: imgs.length ? imgs : undefined, prefix: `thumb${v.variant}` }); Object.assign(v, { status: "done", url: r.url, bytes: r.bytes, model: r.model }); v.versions.push({ url: r.url, createdAt: new Date().toISOString() }); }
    catch (e) { rethrowCancelled(e); v.status = "error"; v.error = (e as Error).message; if (isFinancialError(e)) financialError ??= e; }
    doneN++; ctx.progress(`Готово ${doneN}/3`, 25 + doneN * 22); ctx.partial({ variants });
  }));
  const result: { variants: Variant[]; input: Omit<ThumbInputT, "character"> & { hasCharacter: boolean }; projectId?: string; artifactId?: string } = { variants, input: { ...input, character: undefined, hasCharacter: !!input.character } as never };
  if (input.projectId) { try { await getProject(input.projectId); ctx.progress("Сохраняем в проект", 97); const a = await addArtifact(input.projectId, { kind: "thumbnail", title: `Обложки · ${input.title.slice(0, 80)}`, data: result }); result.projectId = input.projectId; result.artifactId = a.id; } catch (e) { rethrowCancelled(e); /* нет проекта */ } }
  if (financialError) throw financialError;
  return result;
}
