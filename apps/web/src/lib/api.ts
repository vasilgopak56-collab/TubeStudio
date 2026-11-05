export type ApiErrorShape = { code: string; message: string; retryable?: boolean; details?: unknown };

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 0, public retryable = false, public details?: unknown) { super(message); }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...rest,
      credentials: "same-origin",
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError("NETWORK", "Сервер TubeStudio недоступен. Запущен ли npm run dev?");
  }
  const body = await res.json().catch(() => null);
  if (!body) throw new ApiError("BAD_RESPONSE", `Неожиданный ответ сервера (HTTP ${res.status})`, res.status);
  if (!body.ok) {
    const e = body.error as ApiErrorShape;
    if (res.status === 401 && e.code === "UNAUTHORIZED") window.dispatchEvent(new Event("ts:unauthorized"));
    throw new ApiError(e.code, e.message, res.status, !!e.retryable, e.details);
  }
  return body.data as T;
}

export type KeyStatus = {
  provider: "anymodel" | "youtube" | "youtube2" | "youtube3" | "gemini" | "lumean" | "glabs" | "anthropic" | "openai";
  label: string; required: boolean; configured: boolean; ok: boolean; message: string;
  checkState?: "unverified" | "checked" | "stale"; checkedAt?: string; checkKind?: "metadata" | "quota";
  latencyMs?: number; info?: Record<string, unknown>;
};
export type Health = { version: string; node: string; dataDir: string; llm: "anymodel" | "anthropic" | "gemini" | null; keys: KeyStatus[] };

export type Settings = {
  theme: "dark" | "light";
  contentLanguage: string;
  timezone: string;
  llmProvider: "auto" | "anthropic" | "gemini";
  imageProvider: "openai" | "gemini";
  models: { anthropic: string; gemini: string; geminiFast: string; geminiTts: string; geminiImage: string; openaiImage: string };
  rpm: { niche: string; min: number; max: number }[];
  anymodel: AnymodelSettings;
  budget: { monthlyUsd: number; mode: "warn" | "block"; warnPct: number; prices: PriceRowT[] };
  research: ResearchSettingsT;
  /** Выпуск 2: адрес G-Labs Webhook (по умолчанию http://127.0.0.1:8765). */
  glabs: { url: string };
};
export type Filters = {
  outlierMin?: number; outlierMax?: number; vphMin?: number; vphMax?: number; viewsMin?: number; viewsMax?: number; subsMin?: number; subsMax?: number;
  ratioMin?: number; engagementMin?: number; ageDays?: number; durationMin?: number; durationMax?: number; type: "all" | "long" | "shorts"; viralOnly: boolean;
};
export type Level = "low" | "medium" | "high";
export type ResearchSettingsT = {
  region: string; language: string; pages: number; order: "relevance" | "viewCount" | "date"; outlierBase: "median" | "average"; baseVideos: number;
  viral: { outlierMin: number; rules: { maxAgeDays: number; vphMin: number }[] };
  presets: { id: string; name: string; filters: Filters }[];
  keywords: { depth: "fast" | "deep"; analyzeTop: number; minVolume: number; maxCompetition: Level; highCompVolume: number; maxPick: number; separator: string };
  competitors: { refreshHours: number; videosPerChannel: number; alertNew: boolean; alertOutlier: number; alertVphX: number; alertSubsPct: number; digestAuto: boolean; digestDays: number; digestTop: number };
  comments: { perVideo: number; order: "relevance" | "time"; channelVideos: number };
};
export type AnymodelSettings = { enabled: boolean; priority: "first" | "reserve"; text: string; script: string; textAlt: string; fast: string; search: string; image: string; imageAlt: string; imageQuality: "low" | "medium" | "high"; tts: string; usdPerMillion: number };
export type PriceRowT = { match: string; input: number; output: number; image: number };
export type BudgetLevel = "off" | "ok" | "warn" | "over";
export type UsageT = {
  youtubeToday: number;
  youtubeTodayByKey?: Record<string, number>;
  llm: Record<string, { in: number; out: number; calls: number }>;
  images?: Record<string, number>;
  cost: { rows: { model: string; kind: "text" | "image" | "search" | "tts" | "audio"; provider?: string; operationId?: string; valuation?: string; calls: number; in: number; out: number; usd: number | null; priced: boolean; balanceTokens?: number; via?: "anymodel" | "direct" }[]; total: number | null; knownTotal: number; knownTotalRaw: number; complete: boolean; unknownRows: number; valuation: "current-rate-estimate" | "captured-tariff" | "mixed-estimate-and-captured"; recordedOperations?: number; legacyRows?: number; accountingWarning?: string | null; pendingOperations?: number; balanceTokens?: number };
  budget: { limitUsd: number; spentUsd: number | null; knownSpentUsd: number; complete: boolean; unknownRows: number; pct: number; level: BudgetLevel; mode: "warn" | "block"; warnPct: number };
};
