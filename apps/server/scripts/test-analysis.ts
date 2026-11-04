// Смоук-тест этапа 2 без YouTube: синтетический канал → метрики → LLM-инсайты → outlier-темы
import { computeReport } from "../src/services/metrics.js";
import { generateInsights, generateOutliers, type Report } from "../src/services/analysis.js";
import { ensureDataDirs } from "../src/lib/storage.js";
await ensureDataDirs();
const now = Date.now();
const titles = ["Как люди каменного века делали операции на черепе", "Почему неандертальцы вымерли, хотя мозг был больше", "Жизнь в 10 000 году до н.э.: один день", "Как древние люди хранили еду без холодильника", "Первая война в истории человечества", "Зачем древним людям понадобились боги", "Как люди научились говорить", "Почему 200 000 лет люди ничего не строили", "Ледниковый период: как выжить зимой", "Древнейшая обувь в мире", "Как приручили собаку", "Самая древняя музыка", "Каннибалы каменного века", "Почему люди начали пахать землю", "Как выглядел первый город"];
const views = [954000, 278000, 120000, 76000, 41000, 30000, 25000, 18000, 12000, 9000, 7500, 5200, 3100, 2400, 1900];
const videos = titles.map((t, i) => ({ id: `vid${i}`, title: t, description: "#история #древниелюди", publishedAt: new Date(now - (i * 4 + 1) * 86400_000).toISOString(), durationSec: 900 + i * 30, isShort: false,
  views: views[i], likes: Math.round(views[i] * 0.012), comments: Math.round(views[i] * 0.002), tags: i < 4 ? ["древние люди", "эволюция человека", "история"] : ["история", "каменный век"], thumbnail: "", channelId: "UCx", channelTitle: "Древний мир" }));
const channel = { id: "UCx", title: "Древний мир", description: "Документальные видео о жизни древних людей", publishedAt: "2024-01-01T00:00:00Z", subscribers: 4900, hiddenSubscribers: false, totalViews: 2_000_000, videoCount: 40, uploadsPlaylistId: "UUx" };
const rep = computeReport(channel, videos, { count: 15, type: "all", tz: "Europe/Moscow", rpm: { niche: "По умолчанию", min: 3.5, max: 8.5 }, shortsRpm: { niche: "Shorts", min: 0.05, max: 0.1 } });
console.log("STATS", rep.stats, rep.windows, rep.income.monthMin, rep.income.monthMax, "bestDay", rep.schedule.byDay[rep.schedule.bestDay].label);
console.log("GOLD", rep.tags.golden.map((t) => t.tag), "ICE", rep.tags.icebox.map((t) => t.tag));
const t0 = Date.now();
const { data, model } = await generateInsights(rep, "История каменного века", "ru");
console.log("INSIGHTS via", model, ((Date.now() - t0) / 1000).toFixed(1) + "s", JSON.stringify(data).slice(0, 700));
const r: Report = { ...rep, id: "t", createdAt: "", insights: data, outlierSets: [] };
const t1 = Date.now();
const topics = await generateOutliers(r, "ru");
console.log("OUTLIERS", ((Date.now() - t1) / 1000).toFixed(1) + "s", topics.map((t) => `${t.score} [${t.type}] ${t.title}`).join("\n"));
// Сохраняем демо-отчёт для UI
if (process.argv.includes("--save")) {
  const { writeJson, readJson } = await import("../src/lib/storage.js");
  const id = "demo" + Date.now().toString(36);
  const full: Report = { ...rep, id, createdAt: new Date().toISOString(), niche: "История каменного века", model, insights: data, outlierSets: [topics] };
  await writeJson(`reports/${id}.json`, full);
  const idx = await readJson<unknown[]>("reports/index.json", []);
  await writeJson("reports/index.json", [{ id, createdAt: full.createdAt, channelId: "UCx", title: "Древний мир", videos: rep.stats.sampleSize, type: "all" }, ...idx]);
  console.log("SAVED", id);
}
