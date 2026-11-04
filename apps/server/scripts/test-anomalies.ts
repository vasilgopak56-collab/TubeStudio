// Live smoke: YouTube API only; no LLM calls. Run from apps/server:
// DATA_DIR=/tmp/ts-anomaly-smoke node --env-file-if-exists=../../.env --import tsx scripts/test-anomalies.ts
import { ANOMALY_FILTERS, ResearchInput, runResearch } from "../src/services/explore.js";
const input = ResearchInput.parse({ mode: "anomalies", q: "нейросети", filters: { ...ANOMALY_FILTERS, ageDays: 90 }, sort: "ratio", order: "viewCount", pages: 2 });
try {
  const result = await runResearch(input, { progress(stage, pct) { console.log(pct + "% " + stage); }, partial() {}, signal: new AbortController().signal });
  console.log(JSON.stringify({ ok: true, fetched: result.stats.fetched, shown: result.stats.shown, channelsWithHits: new Set(result.rows.map((r) => r.channelId)).size, approximateUnits: result.stats.units, allMatch: result.rows.every((r) => !r.hiddenSubs && r.subs > 0 && r.subs <= 10000 && r.views >= 50000 && r.ratio! >= 10 && r.ageDays <= 90) }));
} catch (e) { console.error('Live smoke failed:', (e as Error).message); process.exitCode = 1; }
