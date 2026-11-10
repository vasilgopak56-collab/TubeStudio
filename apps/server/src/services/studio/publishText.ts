// Выпуск 4, шаг 2: тексты публикации. Один платный запрос к одной модели после отдельного подтверждения автора.
// При сбое, таймауте или неверном ответе запрос не повторяется и другая модель не запускается: повторить может только сам автор.
import { z } from "zod";
import { ApiError } from "../../lib/errors.js";
import type { JobCtx } from "../../lib/jobs.js";
import { withPaidConsent } from "../../lib/taskContext.js";
import { amCached, amCatalog, amCatalogFresh, hasAnymodel } from "../anymodel.js";
import { readPrompt } from "../prompts.js";
import { getProject } from "../projects.js";
import { SEO_MAX_TOKENS, runSeo, type SeoResult } from "../seo.js";
import { getSettings } from "../settings.js";
import { capturePrice, operationCost } from "../usagePricing.js";
import { getChannel } from "./channels.js";
import { exportState } from "./montageExport.js";
import { chapterClock, currentChapters, serial, writeProposal, type Chapter, type ChapterRow, type Proposal } from "./publishCard.js";

export const PublishTextInput = z.object({ channelId: z.string().uuid("Неверный номер канала") }).strict();

/** Ориентир цены. Вход считается с запасом (2 знака на токен), выход — по верхней границе ответа. */
export async function textQuote(model: string, inputChars: number, maxOutput: number): Promise<number | null> {
  await amCatalog().catch(() => []);
  const price = await capturePrice("anymodel", model, "text", amCached(model)?.billing, { catalogFresh: amCatalogFresh() });
  return operationCost(price, { input: Math.ceil(inputChars / 2), output: maxOutput, known: true }).usd;
}

export function consentMessage(model: string, usd: number | null) {
  const price = usd === null ? "Цена этой модели неизвестна." : `Ориентир цены: примерно $${usd < 0.01 ? "0.01" : usd.toFixed(2)} или меньше.`;
  return `Подтвердите один запрос к модели ${model} для текстов публикации. ${price} Точная сумма заранее неизвестна, согласие не ограничивает списание. Автоматических повторов и резервных моделей не будет.`;
}

/** Текст, который звучит внутри каждой главы: модель называет главы по их настоящему содержанию. */
export function chapterSegments(rows: ChapterRow[], chapters: Chapter[]) {
  return chapters.map((c, i) => {
    const next = chapters[i + 1]?.scene ?? Infinity;
    return { time: chapterClock(c.start), text: rows.filter((r) => r.n >= c.scene && r.n < next).map((r) => r.text).join(" ") };
  });
}

/** Что сохранить из ответа модели. Описание без глав: главы добавляются по времени монтажа. */
export function proposalOf(seo: SeoResult, chapters: Chapter[], at: string): Proposal {
  return {
    at, model: seo.model, keyword: seo.keyword, titles: seo.titles.map((t) => t.title),
    description: [seo.description.hook.join("\n"), seo.description.body.join("\n\n"), seo.description.cta, seo.hashtags.join(" ")].filter(Boolean).join("\n\n"),
    tags: seo.tags.filter((t) => t.selected).map((t) => t.tag), pinnedComments: seo.pinnedComments,
    chapters: chapters.map((c, i) => ({ scene: c.scene, excerpt: c.excerpt, title: seo.description.chapters[i]?.title ?? "" })),
  };
}

const running = new Set<string>();
export const publishTextBusy = (projectId: string) => running.has(projectId);

export async function runPublishText(projectId: string, raw: unknown, ctx: JobCtx): Promise<Proposal> {
  if (running.has(projectId)) throw new ApiError("VALIDATION", "Тексты для этого ролика уже готовятся.", 409);
  running.add(projectId);
  try {
    const { channelId } = PublishTextInput.parse(raw);
    const [p, channel, exported, current] = await Promise.all([getProject(projectId), getChannel(channelId), exportState(projectId), currentChapters(projectId, [])]);
    if (!current.montage.result || !exported.accepted) throw new ApiError("VALIDATION", "Сначала соберите и примите ролик в разделе «Монтаж». Деньги не потрачены.");
    const script = ([...p.artifacts].reverse().find((a) => a.kind === "script")?.data as { script?: string } | undefined)?.script ?? "";
    if (script.length < 200) throw new ApiError("VALIDATION", "В проекте нет сценария. Деньги не потрачены.");
    const settings = await getSettings(), model = settings.anymodel.text;
    if (!hasAnymodel() || !settings.anymodel.enabled || !model) throw new ApiError("KEY_MISSING", "Нужен включённый AnyModel с выбранной текстовой моделью. Другая модель не запускалась. Деньги не потрачены.", 400);
    const rows = current.visual.board?.rows ?? [];
    const segments = chapterSegments(rows, current.chapters);
    const language = current.visual.board?.language ?? channel.language;
    const prompt = await readPrompt("seo/seo.md");
    const extra = segments.reduce((n, s) => n + Math.min(s.text.length, 260) + 12, 0);
    const usd = await textQuote(model, prompt.length + script.length + extra + 4000, SEO_MAX_TOKENS);
    const seo = await withPaidConsent(consentMessage(model, usd), () => runSeo(
      { niche: channel.niche || undefined, script, language, projectId },
      ctx,
      { call: { model, noFallback: true, singleAttempt: true }, jsonRetries: 0, chapters: segments },
    ));
    const proposal = proposalOf(seo, current.chapters, new Date().toISOString());
    await serial(projectId, () => writeProposal(projectId, proposal));
    return proposal;
  } finally { running.delete(projectId); }
}
