import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Промпты лежат в apps/server/prompts и читаются при каждом вызове — правятся без пересборки */
export const PROMPTS_DIR = process.env.PROMPTS_DIR ? path.resolve(process.env.PROMPTS_DIR) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../prompts");

export async function readPrompt(rel: string) { return fs.readFile(path.join(PROMPTS_DIR, rel), "utf8"); }

/** Файл формата ===SYSTEM=== … ===USER=== … */
export async function loadSplitPrompt(rel: string) {
  const raw = await readPrompt(rel);
  const m = raw.match(/===SYSTEM===\s*([\s\S]*?)\s*===USER===\s*([\s\S]*)$/);
  return m ? { system: m[1].trim(), user: m[2].trim() } : { system: "", user: raw.trim() };
}

export function fill(tpl: string, vars: Record<string, string | number>) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? String(vars[k]) : `{{${k}}}`));
}

export const STYLES: { id: string; name: string; hint: string }[] = [
  { id: "weird_history", name: "Странная история быта", hint: "Быт до медицины, санитарии и технологий" },
  { id: "animated_2d_history", name: "2D-анимация: история", hint: "Анимированные исторические эссе" },
  { id: "epic_history", name: "Эпическая история", hint: "Империи, битвы, великие личности" },
  { id: "mind_bending_history", name: "Невероятная история", hint: "Парадоксы и загадки прошлого" },
  { id: "sacred_history", name: "Священная история", hint: "Религии, мифы, священные тексты" },
  { id: "lost_relics", name: "Утерянные реликвии", hint: "Артефакты, находки, исчезнувшие сокровища" },
  { id: "dark_3d_crime", name: "Мрачный 3D true crime", hint: "Преступления и расследования" },
  { id: "mind_bending_science", name: "Невероятная наука", hint: "Наука, которая ломает интуицию" },
  { id: "science_2d_animation", name: "Наука: 2D-анимация", hint: "Объяснение научных механизмов" },
  { id: "economics_of", name: "Экономика чего-либо", hint: "Как устроены деньги в отрасли" },
  { id: "finance_2d_documentary", name: "Финансы: 2D-документалка", hint: "Истории компаний и рынков" },
  { id: "finance_animation", name: "Финансы: анимация", hint: "Личные финансы и экономика просто" },
];
