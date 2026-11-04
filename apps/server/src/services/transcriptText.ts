import { ApiError } from "../lib/errors.js";
export type TranscriptSegment = { start: number | null; end: number | null; text: string };
export const TRANSCRIPT_LIMITS = { inputChars: 300000, segments: 10000, analysisChars: 60000, fileBytes: 1024 * 1024 };
const invalid = (message: string): never => { throw new ApiError("VALIDATION", message, 400); };
const cleaned = (s: string) => s.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
export function decodeCaption(s: string): string {
  // Decode once; never interpret or execute markup/JS.
  return s.replace(/<[^>]*>/g, "").replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
    if (entity.startsWith("#")) {
      const n = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
    }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[entity.toLowerCase()] ?? _;
  }).replace(/[\t ]+/g, " ").trim();
}
function seconds(s: string): number | null {
  const m = /^(?:(\d{1,3}):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(s);
  if (!m || +m[2] > 59 || +m[3] > 59) return null;
  const t = +(m[1] ?? 0) * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
  return t <= 7 * 86400 ? t : null;
}
export function finishTranscript(segments: TranscriptSegment[], warnings: string[] = []) {
  if (segments.length > TRANSCRIPT_LIMITS.segments) invalid("Слишком много фрагментов: максимум 10 000.");
  const nonempty = segments.filter(s => s.text.trim());
  if (!nonempty.length) invalid("Текст субтитров пуст или не распознан. Вставьте текст либо загрузите корректный TXT/SRT/VTT.");
  const text = nonempty.map(s => s.text).join("\n");
  if (text.length > TRANSCRIPT_LIMITS.inputChars) invalid("Транскрипт длиннее 300 000 символов. Разделите его на части.");
  return { segments: nonempty, text, warnings };
}
export function parseTranscript(raw: string, format: "txt" | "srt" | "vtt" = "txt") {
  if (raw.length > TRANSCRIPT_LIMITS.inputChars) invalid("Входной текст длиннее 300 000 символов.");
  const s = cleaned(raw);
  if (format === "txt") return finishTranscript(s.split(/\n\s*\n/).map(text => ({ start: null, end: null, text: text.trim() })));
  const blocks = s.split(/\n\s*\n/); const segments: TranscriptSegment[] = []; let skipped = 0;
  for (const block of blocks) {
    const lines = block.split("\n");
    if (/^(NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(lines[0])) continue;
    const i = lines.findIndex(l => l.includes("-->"));
    if (i < 0) { if (!/^WEBVTT(?:\s|$)/.test(lines[0])) skipped++; continue; }
    const m = /^\s*(\S+)\s+-->\s+(\S+)(?:\s.*)?$/.exec(lines[i]);
    const start = m ? seconds(m[1]) : null, end = m ? seconds(m[2]) : null;
    const text = decodeCaption(lines.slice(i + 1).join("\n"));
    if (start === null || end === null || end <= start || !text) { skipped++; continue; }
    segments.push({ start, end, text });
  }
  return finishTranscript(segments.sort((a, b) => a.start! - b.start!), skipped ? [`Пропущено некорректных блоков: ${skipped}. Проверьте исходный файл.`] : []);
}
export function parseJson3(body: unknown) {
  const events = (body as any)?.events;
  if (!Array.isArray(events)) invalid("YouTube вернул неподдерживаемый формат субтитров. Используйте вставку текста или файл.");
  const segments: TranscriptSegment[] = []; let skipped = 0;
  for (const e of events) {
    if (!e || !Array.isArray(e.segs)) continue;
    // JSON3 utf8 is already plain text. Do not strip a literal '<...>' or decode it twice.
    const text = e.segs.map((s: any) => typeof s?.utf8 === "string" ? s.utf8 : "").join("").trim();
    if (!text) continue;
    const start = typeof e.tStartMs === "number" ? e.tStartMs / 1000 : NaN;
    if (!Number.isFinite(start) || start < 0 || start > 7 * 86400) { skipped++; continue; }
    const duration = typeof e.dDurationMs === "number" ? e.dDurationMs / 1000 : NaN;
    const end = Number.isFinite(duration) && duration > 0 && start + duration <= 7 * 86400 ? start + duration : null;
    segments.push({ start, end, text });
    if (segments.length > TRANSCRIPT_LIMITS.segments) invalid("Субтитры содержат больше 10 000 фрагментов.");
  }
  return finishTranscript(segments.sort((a, b) => a.start! - b.start!), skipped ? [`Пропущено фрагментов с неверным временем: ${skipped}.`] : []);
}
