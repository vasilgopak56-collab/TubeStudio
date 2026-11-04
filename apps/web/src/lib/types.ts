export type Video = {
  id: string; title: string; description: string; publishedAt: string; durationSec: number; isShort: boolean;
  views: number; likes: number; comments: number; tags: string[]; thumbnail?: string;
  engagement: number; outlier: number; viewsPerDay: number; ageDays: number; bestScore: number;
};
export type Bucket = { label: string; total: number; count: number; avg: number };
export type OutlierTopic = { technique: string; type: "replication" | "counter" | "format_shift"; score: number; title: string; basedOnVideoId: string; why: string; howTo: string[] };
export type Insights = {
  niche: { name: string; virality: number; demand: number; saturation: "low" | "moderate" | "high" | "extreme"; trend: "growing" | "stable" | "declining"; monetization: "low" | "medium" | "medium_high" | "high"; bullets: { text: string; highlight: string[] }[]; entryVerdict: string };
  diagnosis: { whyGrowing: string[]; hitsVsFlops: string[]; mistakes: string[]; angles: string[]; plan: string[] };
  top3: { videoId: string; reasons: string[] }[];
};
export type Report = {
  id: string; createdAt: string; niche?: string; model?: string; insightsError?: string;
  channel: { id: string; title: string; handle?: string; avatar?: string; country?: string; publishedAt: string; subscribers: number; hiddenSubscribers: boolean; totalViews: number; videoCount: number };
  params: { count: number; type: "all" | "long" | "shorts"; tz: string };
  stats: { sampleSize: number; avgViews: number; medianViews: number; engagement: number; channelVirality: number; outlierShare: number; shortsShare: number; avgDurationSec: number };
  windows: { last30: number; prev30: number; growthPct: number; uploads30: number; uploadsPrev30: number };
  income: { monthMin: number; monthMax: number; rpm: { niche: string; min: number; max: number }; shortsRpm: { min: number; max: number }; longViews30: number; shortViews30: number };
  schedule: { byDay: Bucket[]; byHour: Bucket[]; bestDay: number; bestHour: number; basis: "30d" | "sample" };
  tags: { golden: { tag: string; count: number; avgViews: number }[]; icebox: { tag: string; count: number; avgViews: number }[] };
  top3: string[];
  videos: Video[];
  insights?: Insights;
  outlierSets: OutlierTopic[][];
};
export type ReportIndexRow = { id: string; createdAt: string; channelId: string; title: string; avatar?: string; videos: number; type: string };
export type Competition = "low" | "medium" | "high";
export type FoundTopic = {
  n: number; title: string; altTitles: string[]; score: number; label: string; competition: Competition | null; bestDay: string | null; bestHour: number | null;
  why: string; hook: string; audience: string; thumbnail: { visual: string; text: string }; coreQuestion: string; angle: string; summary: string;
  evidence: { id: string; title: string; channelTitle: string; views: number; outlier: number | null; thumbnail?: string }[]; searchKeywords: string[]; factCheck: string[];
  lens?: string; emotionalCore?: string; scorecard?: { total: number; items: { id: string; name: string; weight: number; score: number }[] };
};
export type TopicInput = { keywords: string; nicheDescription: string; count: 5 | 10 | 15; format: "long" | "shorts"; minutes: number; language: string; style: string; customStyle?: string; useYouTube: boolean; force?: boolean };
export type TopicGroup = { phrase: string; count: number; n10k: number; medianSubs: number; open: boolean; competition: Competition; bestDay: string; bestHour: number };
export type TopicRun = { id: string; createdAt: string; input: TopicInput; topics: FoundTopic[]; groups: TopicGroup[]; evidenceCount: number; model: string; warning?: string };
export type SavedTopic = { id: string; title: string; niche?: string; score?: number; source: "analysis" | "topic-finder" | "research" | "digest" | "comments" | "manual"; notes?: string; meta?: Record<string, unknown>; createdAt: string; status: "idea" | "script" | "done"; projectId?: string };
export type ArtifactKind = "topic" | "analysis" | "script" | "audio" | "seo" | "thumbnail" | "storyboard" | "check" | "note" | "video" | "shorts";
export type Artifact = { id: string; kind: ArtifactKind; title: string; data?: unknown; files?: string[]; createdAt: string; version?: number };
export type Project = { id: string; title: string; niche?: string; createdAt: string; updatedAt: string; artifacts: Artifact[] };
export type ProjectSummary = Omit<Project, "artifacts"> & { counts: Partial<Record<ArtifactKind, number>>; last?: { kind: ArtifactKind; title: string; createdAt: string } };
export type ScriptInputT = { donorBriefId?: string; topic: string; hook?: string; language: string; unit: "words" | "chars"; value: number; style: string; customStyle?: string; tone: "serious" | "ironic" | "dramatic" | "friendly" | "custom"; customTone?: string; headings: boolean; cta: boolean; visualCues: boolean; research: boolean; structure?: string; humanize?: boolean; channelVoice?: boolean; notes?: string; projectId?: string; model?: string };
export type ScriptPlan = { title: string; core_question: string; acts: { name: string; summary: string; beats: string[]; words: number }[]; open_loops: string[]; midroll_cta_line: string; ending_question: string; ctaAct: number | null; structure_id?: string; hook_strikes?: { image?: string; contradiction?: string; question?: string }; claims_to_verify?: string[] };
export type Dossier = { mode: "web" | "wikipedia" | "notes" | "model"; facts: { claim: string; source: number | null; confidence: "high" | "medium" | "low"; attribution?: "source_text" | "search_summary" | "author_notes" | "unattributed" }[]; disputed: string[]; sources: { title: string; url: string }[]; note?: string };
export type ScriptCheck = { metrics: { words: number; chars: number; charsNoSpaces: number; minutes: number; sentences: number; avgSentence: number; questions: number; ctaPos: number | null; deviationPct: number | null; paragraphs: number }; errors: string[]; warnings: string[]; passed: boolean };
export type VoiceSummary = { before: number; after: number; edited: number; scenes: number; counts: { rule: string; name: string; count: number }[] };
export type ScriptResult = { donorBrief?: { id:string; research:{facts:string;uncertain:string;reconstruction:string;boundaries:string;sources:{id:string;title:string;url:string;excerpt:string}[]}; outline:string }; id: string; title: string; script: string; plan: ScriptPlan; facts: Dossier | null; check: ScriptCheck; voice?: VoiceSummary; input: ScriptInputT; targetWords: number; model: string; projectId: string; artifactId: string; createdAt: string };
export type SeoInputT = { niche?: string; script: string; language: string; projectId?: string; keywords?: string[] };
export type SeoTitle = { title: string; triggers: string[]; hookWord: string; why: string; length: number; level: "ok" | "warn" | "error" };
export type SeoTag = { tag: string; group: "primary" | "secondary" | "longTail"; selected: boolean };
export type SeoResult = {
  keyword: string; titles: SeoTitle[];
  description: { hook: string[]; body: string[]; cta: string; chapters: { time: string; title: string }[]; full: string };
  hashtags: string[]; tags: SeoTag[]; tagsLength: number; pinnedComments: { type: string; text: string }[];
  checks: { level: "ok" | "warn" | "error"; text: string }[]; minutes: number; model: string; input: SeoInputT; projectId?: string; artifactId?: string;
};
