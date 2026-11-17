/** Расширение Chrome, YouTube Studio: только чтение сохранённых карточек «Публикации», без запросов в сеть. */
import { listProjects } from "./projects.js";
import { publishState, readCard } from "./studio/publishCard.js";

const MAX_CARDS = 30;

/** Ролики с сохранённым названием в карточке, свежие сверху. */
export async function extPublishCards() {
  const projects = await listProjects();
  const out: { projectId: string; project: string; title: string; updatedAt: string }[] = [];
  for (const p of projects) {
    const card = await readCard(p.id);
    if (card.title?.trim()) out.push({ projectId: p.id, project: p.title, title: card.title.trim(), updatedAt: p.updatedAt });
    if (out.length >= MAX_CARDS) break;
  }
  return out;
}

/** Поля для окна «Сведения» в YouTube Studio: то же описание с главами, что на странице «Публикация». */
export async function extPublishCard(projectId: string) {
  const s = await publishState(projectId);
  return {
    projectId,
    project: s.project.title,
    title: s.card.title ?? "",
    description: s.finalDescription,
    tags: s.card.tags,
    language: s.card.language,
    category: s.categories.find((c) => c.id === s.card.categoryId)?.name ?? null,
    madeForKids: s.card.madeForKids,
    syntheticMedia: s.card.syntheticMedia,
    thumbnail: !!s.card.thumbnail,
  };
}
