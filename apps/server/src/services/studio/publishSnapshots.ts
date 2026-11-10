// Выпуск 4: замеры ролика через 48 часов и 7 дней после публикации.
// Запросы только на чтение к YouTube, без платных моделей. Вставленная на «Публикации» ссылка — согласие автора на эти два замера.
// Замер пишется один раз и не меняется. Если программа не работала в срок, замер делается при следующем запуске с настоящим возрастом ролика.
import path from "node:path";
import { ApiError } from "../../lib/errors.js";
import { log } from "../../lib/logging.js";
import { dataPath, readJson, writeFileAtomic } from "../../lib/storage.js";
import { listLinks, oauthStatus, videoFacts, videoMilestoneReport } from "../ytAnalytics.js";
import { projectFile } from "./montageCheck.js";
import { readCard } from "./publishCard.js";

const FILE = "publish/snapshots.json";
const H = 3600_000;
const TARGET_HOURS = { "48h": 48, "7d": 168 } as const;
export type Kind = keyof typeof TARGET_HOURS;
const KINDS: Kind[] = ["48h", "7d"];
/** После ошибки Google повторяем через час, пока ролик скрыт — проверяем раз в 6 часов. */
const RETRY_MS = H, HIDDEN_MS = 6 * H, TICK_MS = 15 * 60_000;

type Report = Awaited<ReturnType<typeof videoMilestoneReport>>;
export type Snapshot = Report & { kind: Kind; takenAt: string; ageHours: number; lateHours: number };
export type Track = { publishedAt: string | null; nextCheckAt: string | null; waiting: string | null; problem: string | null; skipped48h: boolean; snapshots: Partial<Record<Kind, Snapshot>> };
type Tracks = Record<string, Track>;
export type SnapshotDeps = { connection: typeof oauthStatus; facts: typeof videoFacts; report: typeof videoMilestoneReport };
const realDeps: SnapshotDeps = { connection: oauthStatus, facts: videoFacts, report: videoMilestoneReport };

const blank = (): Track => ({ publishedAt: null, nextCheckAt: null, waiting: null, problem: null, skipped48h: false, snapshots: {} });
const relative = (projectId: string) => path.relative(dataPath(), projectFile(projectId, FILE));
const loadTracks = (projectId: string) => readJson<Tracks>(relative(projectId), {});
const saveTracks = (projectId: string, all: Tracks) => writeFileAtomic(projectFile(projectId, FILE), JSON.stringify(all, null, 2), { backup: true });
const dueMs = (publishedAt: string, kind: Kind) => Date.parse(publishedAt) + TARGET_HOURS[kind] * H;
const iso = (ms: number) => new Date(ms).toISOString();

/** Проверяет один ролик. Возвращает, какой замер снят, или null. */
export async function checkVideo(projectId: string, videoId: string, now = Date.now(), deps: SnapshotDeps = realDeps): Promise<Kind | null> {
  const all = await loadTracks(projectId), t = all[videoId] ?? blank();
  if (t.snapshots["7d"] || (t.nextCheckAt && now < Date.parse(t.nextCheckAt))) return null;
  const finish = async (patch: Partial<Track>, nextCheckAt: number | null) => {
    const next: Track = { ...t, waiting: null, problem: null, ...patch, nextCheckAt: nextCheckAt === null ? null : iso(nextCheckAt) };
    if (JSON.stringify(all[videoId]) === JSON.stringify(next)) return;
    all[videoId] = next;
    await saveTracks(projectId, all);
  };
  const connection = await deps.connection();
  if (!connection.connected || !connection.channel) {
    await finish({ problem: "Канал Google не подключён. Замер подождёт: подключите канал в разделе «Моя аналитика»." }, null);
    return null;
  }
  try {
    const facts = await deps.facts(videoId);
    if (!facts) { await finish({ problem: "YouTube не нашёл этот ролик. Проверьте ссылку. Замер подождёт." }, now + RETRY_MS); return null; }
    if (facts.channelId !== connection.channel.id) {
      await finish({ problem: `Ролик не с подключённого канала «${connection.channel.title}». Замер подождёт: чужие цифры не записываются.` }, now + RETRY_MS);
      return null;
    }
    if (facts.privacy !== "public") {
      await finish({ publishedAt: null, waiting: "Ролик ещё не открыт для всех. Срок замеров начнётся с момента публикации." }, now + HIDDEN_MS);
      return null;
    }
    const publishedAt = facts.publishedAt, week = dueMs(publishedAt, "7d"), twoDays = dueMs(publishedAt, "48h");
    const kind: Kind | null = now >= week ? "7d" : now >= twoDays && !t.snapshots["48h"] ? "48h" : null;
    if (!kind) { await finish({ publishedAt }, t.snapshots["48h"] ? week : twoDays); return null; }
    const report = await deps.report(videoId, projectId);
    const ageHours = Math.round(((now - Date.parse(publishedAt)) / H) * 10) / 10;
    const snapshot: Snapshot = { ...report, kind, takenAt: iso(now), ageHours, lateHours: Math.max(0, Math.round((ageHours - TARGET_HOURS[kind]) * 10) / 10) };
    // Если срок 48 часов прошёл вместе с недельным, второй одинаковый снимок ничего не даст: остаётся один честный замер.
    await finish({ publishedAt, snapshots: { ...t.snapshots, [kind]: snapshot }, skipped48h: kind === "7d" && !t.snapshots["48h"] }, kind === "48h" ? week : null);
    return kind;
  } catch (e) {
    await finish({ problem: e instanceof ApiError ? e.message : "Не удалось получить данные YouTube. Программа повторит попытку позже." }, now + RETRY_MS);
    return null;
  }
}

/** Проходит только по роликам, чья ссылка вставлена на странице «Публикация». */
export async function runDueChecks(now = Date.now(), deps: SnapshotDeps = realDeps) {
  for (const [videoId, projectId] of Object.entries(await listLinks())) {
    if (stopping) return;
    try {
      if ((await readCard(projectId)).video?.id === videoId) await checkVideo(projectId, videoId, now, deps);
    } catch (e) { log.warn({ event: "publish_snapshot_failed", errorType: (e as Error).name }); }
  }
}

export async function snapshotsState(projectId: string) {
  const video = (await readCard(projectId)).video;
  if (!video) return { videoId: null, publishedAt: null, waiting: null, problem: null, rows: [] };
  const t = (await loadTracks(projectId))[video.id] ?? blank();
  return {
    videoId: video.id, publishedAt: t.publishedAt, waiting: t.waiting, problem: t.problem,
    rows: KINDS.map((kind) => ({ kind, dueAt: t.publishedAt ? iso(dueMs(t.publishedAt, kind)) : null, skipped: kind === "48h" && t.skipped48h, snapshot: t.snapshots[kind] ?? null })),
  };
}

// Планировщик устроен как у конкурентов: первая проверка через минуту после запуска, дальше раз в 15 минут.
let timer: NodeJS.Timeout | null = null;
let initialTimer: NodeJS.Timeout | null = null;
let stopping = false;
let running: Promise<void> | null = null;
export function startSnapshotScheduler() {
  if (timer || stopping || process.env.TS_NO_SCHEDULER) return;
  const launch = () => {
    if (stopping || running) return;
    running = runDueChecks().catch((e) => { log.warn({ event: "publish_snapshot_failed", errorType: (e as Error).name }); }).finally(() => { running = null; });
  };
  initialTimer = setTimeout(launch, 60_000); initialTimer.unref();
  timer = setInterval(launch, TICK_MS); timer.unref();
}
export const activeSnapshotChecks = () => (running ? 1 : 0);
export async function stopSnapshotScheduler() {
  stopping = true;
  if (initialTimer) clearTimeout(initialTimer);
  if (timer) clearInterval(timer);
  initialTimer = null; timer = null;
  await running;
}
