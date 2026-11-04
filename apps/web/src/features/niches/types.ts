export type NicheRow = {
  id: string; title: string; url: string; seed: boolean; subscribers: number | null;
  ageDays: number | null; lastUploadDays: number | null; sampled: number; selected: number; mature: number;
  averageViews: number | null; medianViews: number | null; uploadsPerWeek: number | null;
  textMatchPct: number; monetization: "unknown"; revenuePerVideo: { min: number; max: number } | null; warnings: string[];
  evidence?: { evaluatedAt: string; source: "fresh" | "cache-possible"; uploadsState: "available" | "failed"; channelPublishedAt: string; channelDescription: string; subscriberStatus: "known" | "hidden" | "missing"; uploads: { id: string; title: string; channelId: string; publishedAt: string; durationSec: number | null; views: number | null }[] };
  basis?: { entries: { position: number; id: string; viewsIncluded: boolean; frequencyIncluded: boolean; reasons: string[] }[]; frequency: { count: number; first: string | null; last: string | null; spanDays: number | null } };
};
export type NicheForm = { mode: "topic" | "channel"; q: string; channel: string; language?: string; limit: number; sample: number; type: "all" | "long" | "shorts"; rpmNiche?: string; force: boolean };
export type NicheRun = {
  id: string; version: 1 | 2; createdAt: string; input: NicheForm; query: string; language: string;
  seed: { id: string; title: string } | null; rows: NicheRow[]; warnings: string[]; searchIds?: string[]; quotaEstimate: number;
  rpm: { long: { niche: string; min: number; max: number }; shorts: { niche: string; min: number; max: number } };
  summary: { candidates: number; knownSubscribers: number; establishedPct: number | null; label: string };
};
export type NicheBrief = { id: string; createdAt: string; query: string; channels: number; warnings: number };
