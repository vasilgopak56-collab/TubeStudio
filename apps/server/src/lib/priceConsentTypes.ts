export type ConsentTask = { provider: string; model: string; kind: 'text' | 'image' | 'tts' | 'audio' | 'search' };
/** Owner is a launch capability, never an API key, cookie, setting, or SSE field. */
export type ConsentLaunch = { owner: string; requestId: string; route: string };
export type ConsentSpec = { contextHash: string; tariffHash: string; tasks: ConsentTask[] };
export type PriceChallenge = { version: 1; id: string; scopeHash: string; route: string; jobId?: string; createdAt: string; expiresAt: string; tasks: ConsentTask[]; message: string };
export type ConsentResolution = { id: string; status: 'approved' | 'denied' | 'expired' | 'cancelled' };
