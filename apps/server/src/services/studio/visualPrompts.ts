// Промпты кадров и анимации (Выпуск 2, карточки 210, 220, 230, 240, 250).
// Стилевой ключ канала (STYLE ANCHOR) код дописывает дословно в каждый промпт — модель его не пишет и не сокращает.
// Каждый промпт самодостаточен: полный стиль, персонажи через @имя, никаких «тот же персонаж».
import { z } from "zod";
import { ApiError } from "../../lib/errors.js";
import type { Channel, CastItemT, VisualSettingsT } from "./channels.js";

export type StyleKit = { id: string; name: string; anchor: string; motion: string; negative: string; palette: string };
/** Стиль канала: выбранный стиль Библиотеки + правки из профиля. */
export async function styleKit(ch: Pick<Channel, "visual">): Promise<StyleKit> {
  const v = ch.visual;
  const { resolveVisualStyle } = await import("../visualStyles.js");
  const st = v.styleId ? await resolveVisualStyle(v.styleId).catch(() => undefined) : undefined;
  const anchor = oneLine(v.anchor || st?.anchor || "");
  if (anchor.length < 10) throw new ApiError("VALIDATION", "Выберите стиль канала: раздел «Визуал» → «Стиль канала» (или впишите свой стилевой ключ).", 400);
  return { id: st?.id ?? "", name: st?.name ?? "Свой стиль", anchor, motion: oneLine(v.motion || st?.motion || ""), negative: oneLine(v.negative || st?.negative || ""), palette: oneLine(v.palette) };
}
const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
const noEnd = (s: string) => oneLine(s).replace(/[.;,\s]+$/, "");

/** Полный промпт картинки: описание кадра + стилевой ключ дословно + палитра + формат + негатив. Одна строка. */
export function imagePrompt(concept: string, kit: StyleKit, aspect: VisualSettingsT["aspect"] = "16:9"): string {
  const c = noEnd(concept);
  if (!c) return "";
  return `${c}. ${noEnd(kit.anchor)}${kit.palette ? `. Palette: ${noEnd(kit.palette)}` : ""}. ${aspect === "9:16" ? "Vertical 9:16" : "Wide 16:9"} composition with one clear focal point${kit.negative ? `. Avoid: ${noEnd(kit.negative)}` : ""}.`;
}
/** Промпт анимации из готового кадра: движение + ключ движения стиля + «без звука» (озвучка у нас своя). */
export function motionPrompt(motion: string, kit: StyleKit): string {
  const m = noEnd(motion.replace(/@(\w+)/g, "$1"));
  return `${m ? `${m}. ` : ""}${kit.motion ? `${noEnd(kit.motion)}. ` : ""}Animate this exact frame: keep composition, characters and colours, stable, no morphing, no new objects. No dialogue, no narration, no music.`;
}
/** @имена: известные приводятся к точному написанию, неизвестные теряют «@» (G-Labs не должен искать чужой эталон). */
export function normalizeTags(concept: string, cast: CastItemT[]): { concept: string; cast: string[] } {
  const by = new Map(cast.map((c) => [c.name.toLowerCase(), c.name]));
  const used = new Set<string>();
  const out = concept.replace(/@([A-Za-z][A-Za-z0-9]*)/g, (_m, name: string) => {
    const real = by.get(name.toLowerCase());
    if (!real) return name;
    used.add(real);
    return `@${real}`;
  });
  return { concept: out, cast: [...used] };
}

/** Какие сцены оживлять по правилу канала. keys — ключевые сцены, отмеченные моделью. */
export function shouldAnimate(n: number, v: Pick<VisualSettingsT, "animate" | "animateEvery">, keys?: Set<number> | null): boolean {
  if (v.animate === "none") return false;
  if (v.animate === "all") return true;
  if (v.animate === "every") return (n - 1) % v.animateEvery === 0;
  return n <= 2 || (keys ? keys.has(n) : (n - 1) % 4 === 0);
}

const SHOT_EN: Record<string, string> = { wide: "Wide establishing shot", medium: "Medium shot", "close-up": "Close-up", detail: "Detail insert shot" };
const CAMERA: Record<string, string> = { wide: "Slow push-in", medium: "Gentle lateral tracking", "close-up": "Subtle focal rack onto the subject", detail: "Locked-off camera, drifting dust in the light" };
/** Черновик без ИИ (бесплатно): фраза озвучки как задача кадра; персонажи — по имени в тексте. */
export function draftScene(text: string, shot: string, cast: CastItemT[]): { concept: string; motion: string; cast: string[] } {
  const named = cast.filter((c) => new RegExp(`\\b${c.name}\\b`, "i").test(text));
  const who = named.length ? ` featuring ${named.map((c) => `@${c.name}${c.description ? ` (${c.description.split(/[.;\n]/)[0].slice(0, 120)})` : ""}`).join(" and ")}` : "";
  return { concept: `${SHOT_EN[shot] ?? "Medium shot"}${who} that shows this narration line as a literal visual metaphor: ${oneLine(text).replace(/["“”«»]/g, "")}`, motion: CAMERA[shot] ?? "Slow push-in", cast: named.map((c) => c.name) };
}

// ---------- промпты моделью (платно, AnyModel) ----------
const Out = z.object({ scenes: z.array(z.object({
  n: z.number().int(), concept: z.string().min(10).max(1500), motion: z.string().max(500).default(""), key: z.boolean().default(false),
})).min(1) });
export const PROMPT_SYSTEM = `You are the visual director of a faceless YouTube channel. Generators remember nothing between requests, so every prompt must stand alone.
For each narration scene write:
1. "concept" — ONE self-contained English image description, 35–80 words, full sentences (no keyword soup), in this order: main subject + action; setting, era and micro-details; light and atmosphere; camera (shot size, angle, lens, depth of field).
   - Show exactly THIS line of narration, not the topic in general. Turn abstractions into a literal visual metaphor.
   - One main subject plus 2–5 supporting details. Uncluttered.
   - Never write "the same character" or refer to other scenes: describe everything again.
   - Research and scientists: show the experiment as a scene, never a portrait of a real person. No celebrities, no real living people.
   - Never fake real evidence (photos, documents, maps, headlines): show a generic illustrative object instead.
   - No text in the frame. If the channel style uses hand-lettered captions, allow at most one caption of 2–5 words in quotes.
   - Do NOT describe the art style, medium, palette or a negative list — the code appends the channel's style anchor verbatim.
   - Cast members and locations from the list: write @Name exactly (for example "@OldKing lifts the lantern") and, the first time in each concept, a short appearance reminder from the cast description. Never invent @names. Different characters in one frame need different silhouettes.
2. "motion" — image-to-video direction for animating THIS frame, 8–25 words: camera move with speed + one visible physical action + secondary motion of the environment. Physical verbs (turns, lowers, grips, steps, drifts). The simpler the camera, the more complex the action may be. Do not re-describe the frame. No @names, no sound words.
3. "key" — true only for the 1–3 strongest moments of this batch worth animating (hook, revelation, turning point, vivid action).
Use the suggested shot size unless the line clearly needs another; never the same shot size twice in a row.
Return JSON: {"scenes":[{"n":1,"concept":"...","motion":"...","key":false}]} with every n from the input, in order.`;

export type PromptScene = { n: number; text: string; seconds: number; shot: string };
type PromptAi = (o: { system: string; user: string; maxTokens: number }) => Promise<{ data: unknown; model: string }>;
let promptAi: PromptAi | null = null;
/** Только для тестов: подмена модели. */
export function setPromptAi(f: PromptAi | null) { promptAi = f; }
export async function modelPrompts(o: {
  ch: Pick<Channel, "name" | "language" | "niche" | "audience" | "format" | "visual">; kit: StyleKit; scenes: PromptScene[]; previous?: string; note?: string;
}): Promise<{ items: z.infer<typeof Out>["scenes"]; model: string }> {
  const { generateJson } = await import("../llm.js");
  const cast = o.ch.visual.cast.map((c) => `@${c.name} (${c.kind}): ${oneLine(c.description) || "no description"}`).join("\n");
  const user = [
    `CHANNEL: ${o.ch.name} · narration language ${o.ch.language}${o.ch.niche ? ` · niche: ${o.ch.niche}` : ""}${o.ch.audience ? ` · audience: ${o.ch.audience}` : ""}${o.ch.format ? ` · format: ${o.ch.format}` : ""}`,
    `STYLE (for reference only, do not repeat it): ${o.kit.name} — ${o.kit.anchor}`,
    cast ? `CAST AND LOCATIONS:\n${cast}` : "CAST AND LOCATIONS: none — do not use @names.",
    o.previous ? `PREVIOUS SCENE (continuity only): ${o.previous}` : "",
    o.note ? `FIX REQUEST FROM THE EDITOR: ${o.note}` : "",
    `SCENES:\n${JSON.stringify(o.scenes.map((s) => ({ n: s.n, narration: s.text, seconds: s.seconds, suggested_shot: s.shot })))}`,
  ].filter(Boolean).join("\n\n");
  const maxTokens = Math.min(12_000, 900 + o.scenes.length * 380);
  if (promptAi) { const r = await promptAi({ system: PROMPT_SYSTEM, user, maxTokens }); return { items: Out.parse(r.data).scenes, model: r.model }; }
  // Промпты пишет модель сценариста, без подмены резервной: при сбое задание останавливается, готовые части сохранены.
  const { getSettings } = await import("../settings.js");
  const model = (await getSettings()).anymodel.script;
  const r = await generateJson({ system: PROMPT_SYSTEM, user, maxTokens, temperature: 0.6, model, noFallback: true, singleAttempt: true }, Out);
  return { items: r.data.scenes, model: r.model };
}

/** Промпт эталона (карточка 230): лист персонажа, доска локации или предмета. */
export function referencePrompt(item: CastItemT, kit: StyleKit): string {
  const d = noEnd(item.description) || item.name;
  if (item.kind === "location") return `Location reference board of ${item.name}: one wide establishing view, one medium view and three close-ups of key details, the same place, time of day and light in every view. ${d}. No people. ${noEnd(kit.anchor)}. Clear separation between views, 16:9 reference board${kit.negative ? `. Avoid: ${noEnd(kit.negative)}` : ""}.`;
  if (item.kind === "object") return `Object reference board of ${item.name}: front view, side view, three-quarter view and one detail close-up of the same object. ${d}. Plain neutral background. ${noEnd(kit.anchor)}. Clear separation between views, 16:9 reference board${kit.negative ? `. Avoid: ${noEnd(kit.negative)}` : ""}.`;
  return `Character model turnaround sheet of ${item.name}: full-body front view, three-quarter view, side profile, back view, waist-up view, close-up of the face, plus 3 expression variations. ${d}. ${noEnd(kit.anchor)}. Consistent neutral studio lighting, plain neutral background, clear separation between views, 16:9 reference board${kit.negative ? `. Avoid: ${noEnd(kit.negative)}` : ""}.`;
}
