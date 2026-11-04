import { rethrowFinancial } from "../lib/errors.js";
import { checkCancelled, rethrowCancelled, taskSignal, cancellation } from "../lib/taskContext.js";
/**
 * Видео-черновик: озвучка проекта + картинки сцен (из раскадровки → генерация, иначе обложки, иначе текстовые карточки),
 * эффект Ken Burns (zoompan), субтитры SRT (вшитые по желанию), фоновая музыка −20 дБ. 1280×720 или вертикальный 1080×1920.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { JobCtx } from "../lib/jobs.js";
import { ApiError } from "../lib/errors.js";
import { dataPath } from "../lib/storage.js";
import { addArtifact, getProject, safe, type Artifact } from "./projects.js";
import { ffmpegPath } from "./audioFx.js";

export const DraftInput = z.object({
  projectId: z.string().min(1),
  audioArtifactId: z.string().optional(),
  images: z.number().int().min(0).max(40).default(10),
  vertical: z.boolean().default(false),
  subtitles: z.boolean().default(true),
  burn: z.boolean().optional(),
  music: z.string().max(200).optional(), // имя файла в data/files/<projectId>/
  musicDb: z.number().min(-40).max(0).default(-20),
  fps: z.number().int().min(15).max(30).default(25),
});
export type DraftInputT = z.input<typeof DraftInput>;
export type DraftResult = { url: string; srtUrl: string; width: number; height: number; seconds: number; scenes: number; generated: number; source: "storyboard" | "thumbnails" | "cards" | "mixed"; artifactId?: string; warnings: string[] };

type Seg = { start: number; end: number; text: string };
/** Куски озвучки → строки субтитров: по предложениям, время пропорционально длине текста */
export function buildCues(segments: Seg[], maxChars = 84): Seg[] {
  const out: Seg[] = [];
  for (const sg of segments) {
    const sents = sg.text.replace(/\s+/g, " ").split(/(?<=[.!?…])\s+/).flatMap((s) => splitLine(s.trim(), maxChars)).filter(Boolean);
    const total = sents.reduce((a, s) => a + s.length, 0) || 1;
    let t = sg.start; const dur = Math.max(0, sg.end - sg.start);
    for (const s of sents) { const d = (dur * s.length) / total; out.push({ start: t, end: t + d, text: s }); t += d; }
  }
  return out;
}
function splitLine(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const words = s.split(" "), res: string[] = []; let cur = "";
  for (const w of words) { if ((cur + " " + w).trim().length > max && cur) { res.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
  if (cur) res.push(cur);
  // короткий хвост — к предыдущей строке
  if (res.length > 1 && res[res.length - 1].length < 18) { const t = res.pop()!; res[res.length - 1] += " " + t; }
  return res;
}
const ts = (t: number) => { const ms = Math.max(0, Math.round(t * 1000)); const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4), s = Math.floor((ms % 6e4) / 1000); return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
export const toSrt = (cues: Seg[]) => cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join("\n");

/** Разбивка таймлайна на N сцен по стартам строк раскадровки (масштаб к реальной длине озвучки) */
export function planScenes(total: number, n: number, rows?: { start: number; seconds: number }[]) {
  n = Math.max(1, n);
  if (rows?.length) {
    const sbTotal = rows[rows.length - 1].start + rows[rows.length - 1].seconds || 1, k = total / sbTotal;
    const pick = Array.from({ length: Math.min(n, rows.length) }, (_, i) => Math.floor((i * rows.length) / Math.min(n, rows.length)));
    return pick.map((ri, i) => ({ row: ri, start: i === 0 ? 0 : rows[ri].start * k, end: i === pick.length - 1 ? total : rows[pick[i + 1]].start * k }));
  }
  return Array.from({ length: n }, (_, i) => ({ row: -1, start: (i * total) / n, end: ((i + 1) * total) / n }));
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
/** Текстовая карточка, если картинок нет */
async function card(text: string, w: number, h: number, hue: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" "), lines: string[] = []; let cur = "";
  const per = w > h ? 34 : 22;
  for (const x of words) { if ((cur + " " + x).trim().length > per && cur) { lines.push(cur); cur = x; } else cur = (cur + " " + x).trim(); if (lines.length >= 5) break; }
  if (cur && lines.length < 6) lines.push(cur);
  const fs_ = Math.round(w / 22), y0 = h / 2 - ((lines.length - 1) * fs_ * 1.3) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,18%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},55%,8%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${lines.map((l, i) => `<text x="50%" y="${y0 + i * fs_ * 1.3}" font-family="Arial, Liberation Sans, sans-serif" font-size="${fs_}" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="middle">${esc(l)}</text>`).join("")}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function run(bin: string, args: string[], cwd: string, signal?: AbortSignal) {
  signal = taskSignal(signal); checkCancelled(signal);
  return new Promise<void>((resolve, reject) => {
    const p = spawn(bin, ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd });
    let err = ""; p.stderr.on("data", (d) => (err += d));
    const onAbort = () => p.kill("SIGKILL"); signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    p.on("error", e => { signal?.removeEventListener("abort", onAbort); reject(signal?.aborted ? cancellation() : e); });
    p.on("close", (code) => { signal?.removeEventListener("abort", onAbort); signal?.aborted ? reject(cancellation()) : code === 0 ? resolve() : reject(new ApiError("UPSTREAM", `FFmpeg: ${err.slice(-300) || "код " + code}`, 502)); });
  });
}

export async function runDraft(raw: DraftInputT, ctx: JobCtx): Promise<DraftResult> {
  const i = DraftInput.parse(raw);
  const bin = ffmpegPath();
  if (!bin) throw new ApiError("VALIDATION", "Для видео-черновика нужен FFmpeg (winget install ffmpeg или ffmpeg.org; путь можно задать FFMPEG_PATH в .env)", 400);
  const p = await getProject(i.projectId);
  const latest = (k: string) => [...p.artifacts].reverse().find((a) => a.kind === k);
  const audio: Artifact | undefined = i.audioArtifactId ? p.artifacts.find((a) => a.id === i.audioArtifactId) : latest("audio");
  const ad = audio?.data as { url?: string; seconds?: number; segments?: Seg[] } | undefined;
  if (!ad?.url) throw new ApiError("VALIDATION", "В проекте нет озвучки — сначала сделайте её (Озвучка) или загрузите аудио", 400);
  const dir = dataPath("files", safe(p.id)); const audioFile = path.join(dir, path.basename(ad.url));
  await fs.access(audioFile).catch(() => { throw new ApiError("NOT_FOUND", "Файл озвучки не найден на диске", 404); });
  const total = ad.seconds && ad.seconds > 1 ? ad.seconds : 60;
  const [W, H] = i.vertical ? [1080, 1920] : [1280, 720];
  const warnings: string[] = [];
  const work = path.join(dir, `draft_${Date.now()}`); await fs.mkdir(work, { recursive: true });

  // 1. картинки сцен
  const sb = latest("storyboard")?.data as { rows?: { start: number; seconds: number; image: string; concept: string; text: string }[] } | undefined;
  const rows = sb?.rows?.filter((r) => r.image) ?? [];
  const thumbs = p.artifacts.filter((a) => a.kind === "thumbnail").flatMap((a) => [(a.data as any)?.polished?.url, ...((a.data as any)?.variants ?? []).map((v: any) => v.url)].filter(Boolean) as string[]);
  const n = i.images > 0 ? (rows.length ? Math.min(i.images, rows.length) : thumbs.length ? Math.min(i.images, Math.max(thumbs.length, 3)) : Math.min(i.images, 12)) : Math.max(1, Math.min(thumbs.length || 6, 12));
  const plan = planScenes(total, n, rows.length ? rows : undefined);
  const imgs: (Buffer | null)[] = new Array(plan.length).fill(null);
  let generated = 0;
  if (i.images > 0 && rows.length) {
    const { generateImage } = await import("./imageGen.js");
    let doneN = 0;
    for (let k = 0; k < plan.length; k += 3) {
      ctx.signal.throwIfAborted();
      await Promise.all(plan.slice(k, k + 3).map(async (sc, j) => {
        const prompt = rows[sc.row].image.replace(/--\w+\s+[\w:.]+/g, "").trim();
        try { const g = await generateImage(prompt, { aspect: i.vertical ? "9:16" : "16:9" }); imgs[k + j] = Buffer.from(g.b64, "base64"); generated++; }
        catch (e) { rethrowCancelled(e); rethrowFinancial(e); warnings.push(`Сцена ${k + j + 1}: ${(e as Error).message.slice(0, 120)}`); }
        doneN++; ctx.progress(`Картинки сцен: ${doneN} из ${plan.length}`, Math.round((doneN / plan.length) * 55));
      }));
    }
  }
  // обложки → пустые места
  const thumbBufs: Buffer[] = [];
  for (const u of thumbs.slice(0, 6)) { try { thumbBufs.push(await fs.readFile(path.join(dir, path.basename(u)))); } catch { /* нет файла */ } }
  let usedThumb = 0, usedCard = 0;
  const sents = (ad.segments ?? []).map((s) => s.text).join(" ").split(/(?<=[.!?…])\s+/);
  for (let k = 0; k < imgs.length; k++) {
    if (imgs[k]) continue;
    if (thumbBufs.length && (!rows.length || i.images === 0 || generated === 0)) { imgs[k] = thumbBufs[k % thumbBufs.length]; usedThumb++; continue; }
    const txt = rows[plan[k].row]?.concept || sents[Math.floor((k * sents.length) / imgs.length)] || p.title;
    imgs[k] = await card(txt, W, H, (k * 47) % 360); usedCard++;
  }
  const source: DraftResult["source"] = generated && !usedThumb && !usedCard ? "storyboard" : !generated && usedThumb && !usedCard ? "thumbnails" : !generated && !usedThumb ? "cards" : "mixed";

  // 2. клипы сцен с Ken Burns
  const fps = i.fps;
  for (let k = 0; k < plan.length; k++) {
    ctx.signal.throwIfAborted();
    const f = path.join(work, `s${k}.png`);
    await sharp(imgs[k]!).resize(W * 2, H * 2, { fit: "cover" }).png().toFile(f);
    const dur = Math.max(0.5, plan[k].end - plan[k].start), frames = Math.max(1, Math.round(dur * fps));
    const zin = k % 2 === 0, rate = (0.18 / frames).toFixed(6);
    const z = zin ? `min(1+${rate}*on,1.18)` : `max(1.18-${rate}*on,1)`;
    const pans = ["iw/2-(iw/zoom/2)", "(iw-iw/zoom)*on/" + frames, "(iw-iw/zoom)*(1-on/" + frames + ")"];
    const x = pans[k % 3], y = "ih/2-(ih/zoom/2)";
    await run(bin, ["-i", `s${k}.png`, "-vf", `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${W}x${H}:fps=${fps},format=yuv420p`, "-frames:v", String(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-an", `s${k}.mp4`], work, ctx.signal);
    ctx.progress(`Монтаж сцен: ${k + 1} из ${plan.length}`, 55 + Math.round(((k + 1) / plan.length) * 30));
  }
  await fs.writeFile(path.join(work, "list.txt"), plan.map((_, k) => `file 's${k}.mp4'`).join("\n"));

  // 3. субтитры
  const cues = buildCues(ad.segments?.length ? ad.segments : [{ start: 0, end: total, text: "" }]).filter((c) => c.text);
  const stamp = Date.now(), base = `draft_${stamp}`;
  await fs.writeFile(path.join(dir, `${base}.srt`), toSrt(cues));
  await fs.copyFile(path.join(dir, `${base}.srt`), path.join(work, "subs.srt"));

  // 4. сборка: видео + голос (+ музыка) (+ вшитые субтитры)
  ctx.progress("Сборка MP4", 88);
  const burn = i.burn ?? i.subtitles;
  const args = ["-f", "concat", "-safe", "0", "-i", "list.txt", "-i", audioFile];
  let musicOk = false;
  if (i.music) { const mf = path.join(dir, path.basename(i.music)); if (await fs.access(mf).then(() => true, () => false)) { args.push("-stream_loop", "-1", "-i", mf); musicOk = true; } else warnings.push("Файл музыки не найден — собрано без музыки"); }
  const fsz = i.vertical ? 13 : 20;
  const vf = burn && cues.length ? `subtitles=subs.srt:force_style='FontName=Arial,FontSize=${fsz},PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=${i.vertical ? 120 : 28}'` : "";
  const afMix = musicOk ? `[2:a]volume=${i.musicDb}dB[m];[1:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]` : "";
  const out = path.join(dir, `${base}.mp4`);
  const build = async (withSubs: boolean) => {
    const a = [...args];
    const fc = [withSubs && vf ? `[0:v]${vf}[v]` : "", afMix].filter(Boolean).join(";");
    if (fc) a.push("-filter_complex", fc);
    a.push("-map", withSubs && vf ? "[v]" : "0:v", "-map", musicOk ? "[a]" : "1:a");
    a.push(...(withSubs && vf ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"] : ["-c:v", "copy"]), "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out);
    await run(bin, a, work, ctx.signal);
  };
  try { await build(true); }
  catch (e) { rethrowCancelled(e); rethrowFinancial(e); if (!vf) throw e; warnings.push(`Субтитры не вшиты (${(e as Error).message.slice(0, 120)}) — используйте файл SRT`); await build(false); }
  await fs.rm(work, { recursive: true, force: true });

  const res: DraftResult = { url: `/files/${safe(p.id)}/${base}.mp4`, srtUrl: `/files/${safe(p.id)}/${base}.srt`, width: W, height: H, seconds: Math.round(total * 10) / 10, scenes: plan.length, generated, source, warnings };
  const a = await addArtifact(p.id, { kind: "video", title: `Видео-черновик · ${W}×${H} · ${plan.length} сцен`, data: { ...res, input: i, audioArtifactId: audio!.id }, files: [`${base}.mp4`, `${base}.srt`] });
  res.artifactId = a.id;
  ctx.progress("Готово", 100);
  return res;
}
