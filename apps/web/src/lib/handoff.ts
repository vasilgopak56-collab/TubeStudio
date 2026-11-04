/** Передача текста между инструментами (сценарий → озвучка/SEO/оценка) */
export type Handoff = { text: string; title?: string; projectId?: string; sourceArtifactId?: string; language?: string };
export const putHandoff = (h: Handoff) => sessionStorage.setItem("ts:handoff", JSON.stringify(h));
export const takeHandoff = (): Handoff | null => { try { const v = sessionStorage.getItem("ts:handoff"); sessionStorage.removeItem("ts:handoff"); return v ? JSON.parse(v) : null; } catch { return null; } };
