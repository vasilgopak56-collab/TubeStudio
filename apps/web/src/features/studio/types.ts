// Выпуск 1 «Темы и сценарий»: типы ответов сервера /api/studio/*.
export type RadarSettings = { seeds: string[]; maxSubs: number; minMultiplier: number; minViews: number; minDurationSec: number; maxQueries: number; region: string };
export type VoiceService = "elevenlabs" | "cartesia" | "heygen" | "fishaudio";
export type VoiceSettings = { provider: "none" | "lumean"; service: VoiceService; voiceId: string; voiceName: string; modelId: string; templateId: string; templateKey: string; mode: "whole" | "paragraph"; speed: number };
export type Channel = {
  id: string; name: string; language: string; niche: string; audience: string; format: string; lengthMin: number;
  style: string; skills: string; samples: string[]; ownChannel: string;
  radar: RadarSettings; voice: VoiceSettings; models: { author: string; critic: string }; budgetUsd: number;
  createdAt: string; updatedAt: string; archived?: boolean;
};
export type ChannelDraft = Omit<Channel, "id" | "createdAt" | "updatedAt" | "archived" | "voice"> & { voice?: Partial<VoiceSettings> };
export type Spend = { usd: number; operations: number; unknown: number };
export type ChannelList = { activeId: string | null; channels: Channel[]; spend: Record<string, Spend> };

export type IdeaView = {
  videoId: string; title: string; url: string; thumb: string; views: number; durationSec?: number; ageDays?: number;
  channel: { id: string; name: string; handle?: string; url: string; subs: number; medianViews?: number; firstLongAgeDays?: number; firstLongExact?: boolean; format?: string; type?: "yes" | "no" | "unsure"; typeReason?: string };
  multiplier: number; outlier?: number; score: number; relevance: number; status: "new" | "hidden" | "taken"; projectId?: string;
  version?: { title: string; angle: string; model?: string; at: string }; foundBy: string[]; firstSeen?: string;
};
export type RadarRun = { id: string; startedAt: string; finishedAt?: string; queries: string[]; stats: Record<string, number>; notes: string[]; stopped?: string };
export type Sample = { key: string; id: string; name: string; subs?: number; topTitles: string[]; topVideoIds: string[]; at: string };
export type IdeasResponse = { ideas: IdeaView[]; counts: { active: number; hidden: number; taken: number; rejected: number }; lastRun: RadarRun | null; samples: Sample[]; running: boolean; videos: number; channels: number };
export type RunSummary = { runId: string; queries: string[]; stats: Record<string, number>; notes: string[]; stopped?: string; ideas: number; top: IdeaView[] };
export type IdeaSort = "new" | "multiplier" | "views" | "best";
export type IdeaPeriod = "month" | "year" | "all";
export type IdeaShow = "active" | "hidden" | "taken" | "rejected";

export type LintItem = { paragraph: number; at: string; quote: string; match?: string };
export type LintIssue = { rule: string; severity: "error" | "warn" | "info"; title: string; advice: string; paragraph?: number; at?: string; quote?: string; items?: LintItem[] };
export type LintReport = {
  language: "en" | "ru"; words: number; paragraphs: number; wpm: number; minutes: number; duration: string;
  targetWords?: number; sentences: { count: number; avgWords: number; long: number }; hedges: { count: number; allowed: number };
  issues: LintIssue[]; errors: number; warnings: number; passed: string[];
};
export type CriticReport = {
  model: string; family: string; sameFamily: boolean; scores: { q: number; question: string; score: number; note: string }[];
  average: number; min: number; passed: boolean; problems: { paragraph: number; problem: string; before: string; after: string }[];
};
export type DonorBrief = { url: string; title: string; channel: string; words: number; hook: string; structure: string[]; devices: string[]; pacing: string; ending: string; avoid: string[]; model?: string };
export type FactVerdict = "true" | "false" | "misleading" | "unverified";
export type FactSource = { title: string; url: string };
export type FactItem = {
  id: string; paragraph: number; at: string; quote: string; claims: { text: string; kind: string; verdict: FactVerdict; why: string }[]; verdict: FactVerdict;
  fix: string | null; applied: boolean; sources: FactSource[]; mode: "web" | "model"; note?: string;
};
export type FactCheckReport = {
  mode: "web" | "model" | "mixed"; models: string[]; at: string; items: FactItem[];
  summary: { total: number; true: number; false: number; misleading: number; unverified: number };
  changed: number; removed: number; remaining: number; passed: boolean; checked: number; skipped: number;
  sources: FactSource[]; notes: string[]; hash: string; words: number;
};
export type FactCheckJobResult = { report: FactCheckReport; script: string; lint: LintReport; beforeFacts?: string; projectId?: string; artifactId?: string };
export type StudioScriptResult = {
  projectId: string; artifactId: string; title: string; script: string; draft: string;
  lint: LintReport; lintDraft: LintReport; critic: CriticReport | null; criticAfter: CriticReport | null;
  donor: DonorBrief | null; revised: boolean; notes: string[]; models: { author: string; critic: string | null };
  factCheck?: FactCheckReport | null; beforeFacts?: string;
};

export type VoiceItem = { service: VoiceService; voiceId: string; name: string; language?: string; gender?: string; accent?: string; description?: string; previewUrl?: string; clone?: boolean };
export type LumeanAccount = {
  plan: string | null; tokensRemaining: number | null; tokenAllowance: number | null; periodEnd: string | null;
  balance: { value: number; locked: number; asset: string }[]; usage: { service: string; type: string; used: number; limit: number; remaining: number }[];
};
export type OrderRec = {
  hash: string; orderId?: string; templateId: string; mode: "whole" | "paragraph"; channelId: string; projectId?: string; name: string; chars: number;
  createdAt: string; status: string; uncertain?: boolean; files?: { path: string; local: string; bytes: number }[]; artifactId?: string; tokens?: number | null; durationMs?: number | null; error?: string;
};
export type VoiceEstimate = { chars: number; paragraphs: number; mode: "whole" | "paragraph"; preview: { summary?: Record<string, unknown>; status?: string; error?: string } | null; account: LumeanAccount | null; existing: OrderRec | null; textPreview: string };
export type VoiceResult = { orderId: string; reused: boolean; status: string; files: { path: string; local: string; bytes: number }[]; artifactId?: string; partial?: boolean };
