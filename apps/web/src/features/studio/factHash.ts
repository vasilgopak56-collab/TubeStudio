// Отпечаток текста для проверки фактов — та же формула, что на сервере (apps/server/src/services/studio/factCheck.ts):
// по нему видно, менялся ли сценарий после проверки.
export function textHash(t: string): string {
  const s = t.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${h.toString(16).padStart(8, "0")}:${s.length}`;
}
export type FactStatus = "none" | "stale" | "issues" | "passed";
export function factStatus(script: string | undefined, report: { hash: string; passed: boolean } | null | undefined): FactStatus {
  if (!report || !script) return "none";
  if (report.hash !== textHash(script)) return "stale";
  return report.passed ? "passed" : "issues";
}
