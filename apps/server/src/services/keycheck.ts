import { config, type Provider } from "../config.js";
import { fetchRetry } from "../lib/http.js";
import { addYoutubeUnits } from "./usage.js";

export type KeyStatus = {
  provider: Provider;
  label: string;
  required: boolean;
  configured: boolean;
  ok: boolean;
  message: string;
  checkState?: "unverified" | "checked" | "stale";
  checkedAt?: string;
  checkKind?: "metadata" | "quota";
  latencyMs?: number;
  info?: Record<string, unknown>;
};

const META: Record<Provider, { label: string; required: boolean }> = {
  anymodel: { label: "AnyModel (все нейросети)", required: true },
  youtube: { label: "YouTube Data API", required: true },
  youtube2: { label: "YouTube — ключ 2 (резерв квоты)", required: false },
  youtube3: { label: "YouTube — ключ 3 (резерв квоты)", required: false },
  gemini: { label: "Gemini напрямую (резерв)", required: false },
  anthropic: { label: "Claude напрямую (резерв)", required: false },
  openai: { label: "OpenAI напрямую (резерв)", required: false },
  lumean: { label: "Lumean (озвучка)", required: false },
  glabs: { label: "G-Labs (картинки и анимация)", required: false },
};

async function probe(p: Provider, key: string): Promise<Omit<KeyStatus, "provider" | "label" | "required" | "configured">> {
  const opts = { timeoutMs: 12_000, retries: 0 };
  switch (p) {
    case "anymodel": {
      const { amBalance, amCatalog } = await import("./anymodel.js");
      const b = await amBalance();
      const models = await amCatalog(true).catch(() => []);
      const { getSettings } = await import("./settings.js");
      const usd = (b.balance * (await getSettings()).anymodel.usdPerMillion) / 1e6;
      const fmt = b.balance >= 1e6 ? `${(b.balance / 1e6).toFixed(1)} млн` : `${Math.round(b.balance / 1000)} тыс.`;
      if (b.status && b.status !== "active") return { ok: false, message: `Аккаунт: ${b.status}` };
      return {
        ok: b.unlimited || b.balance > 0, message: b.unlimited ? `Безлимит · моделей: ${models.length}` : `Баланс ${fmt} ток. (≈ $${usd.toFixed(2)}) · моделей: ${models.length}`,
        info: { balance: b.balance, usd, models: models.filter((m) => !m.kind).map((m) => m.id), image: models.filter((m) => m.kind === "image").map((m) => m.id), tts: models.filter((m) => m.kind === "tts").map((m) => m.id) },
      };
    }
    case "youtube": case "youtube2": case "youtube3": {
      // 1 ед. квоты: канал YouTube (@YouTube)
      await addYoutubeUnits(1, p);
      const r = await fetchRetry(`https://www.googleapis.com/youtube/v3/channels?part=id&id=UCBR8-60-B28hp2BmDPdntcQ&key=${encodeURIComponent(key)}`, {}, opts);
      const j: any = await r.json().catch(() => ({}));
      if (r.ok) return { ok: true, message: "Ключ работает" };
      const reason = j?.error?.errors?.[0]?.reason ?? j?.error?.status;
      if (reason === "quotaExceeded") return { ok: false, message: "Квота на сегодня исчерпана (сброс в 10:00 МСК)" };
      return { ok: false, message: j?.error?.message ?? `HTTP ${r.status}` };
    }
    case "gemini": {
      const r = await fetchRetry(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`, {}, opts);
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, message: j?.error?.message ?? `HTTP ${r.status}` };
      const names: string[] = (j.models ?? []).map((m: any) => String(m.name).replace("models/", ""));
      return {
        ok: true, message: `Доступно моделей: ${names.length}`,
        info: { tts: names.filter((n) => n.includes("tts")), image: names.filter((n) => n.includes("image")) },
      };
    }
    case "lumean": {
      const r = await fetchRetry("https://api.lumean.app/api/public/usage", { headers: { "X-API-KEY": key } }, opts);
      const j: any = await r.json().catch(() => ({}));
      if (r.status === 401 || r.status === 403) return { ok: false, message: "Ключ недействителен или нет прав (нужен billing.read)" };
      if (!r.ok) return { ok: false, message: j?.message ?? j?.detail ?? `HTTP ${r.status}` };
      return { ok: true, message: "Ключ работает", info: { usage: j } };
    }
    case "glabs": {
      const { checkGlabs } = await import("./studio/glabs.js");
      const r = await checkGlabs();
      return { ok: r.ok, message: r.message, info: r.health ? { health: r.health } : undefined };
    }
    case "openai": {
      const r = await fetchRetry("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` } }, opts);
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, message: j?.error?.message ?? `HTTP ${r.status}` };
      const imageModels = (j.data ?? []).map((m: any) => m.id as string).filter((id: string) => /image|dall-e/i.test(id)).sort();
      return { ok: true, message: imageModels.length ? `Модели картинок: ${imageModels.slice(0, 3).join(", ")}${imageModels.length > 3 ? "…" : ""}` : "Ключ работает, моделей картинок не видно", info: { imageModels } };
    }
    case "anthropic": {
      const h = { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" };
      const r = await fetchRetry("https://api.anthropic.com/v1/models?limit=100", { headers: h }, opts);
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, message: j?.error?.message ?? `HTTP ${r.status}` };
      const models = (j.data ?? []).map((m: any) => m.id) as string[];
      return { ok: true, message: `Метаданные доступны · моделей: ${models.length}. Генерация и баланс не проверялись.`, info: { models } };
    }
  }
}

const human = (m: string) =>
  /api key not valid|invalid x-api-key|invalid api key|authentication/i.test(m) ? "Ключ недействителен" :
  /permission|forbidden/i.test(m) ? "У ключа нет нужных прав" :
  /has not been used|is disabled/i.test(m) ? "API не включён в Google Cloud для этого ключа" : m;

let cache: { at: number; data: KeyStatus[] } | null = null;
let generation = 0;
export const resetKeyCache = () => { cache = null; generation++; };

/** Read-only by default. A force check is an explicit metadata request; quota needs separate consent. */
export async function checkKeys(force = false, youtube = false): Promise<KeyStatus[]> {
  const previous = cache?.data ?? [];
  const local = (p: Provider): KeyStatus => {
    const key = config.keys[p], base = { provider: p, ...META[p], configured: !!key };
    if (!key) return { ...base, ok: false, checkState: "unverified", message: META[p].required ? "Ключ не задан — вставьте его ниже" : "Не задан (необязательно)" };
    const old = previous.find(k => k.provider === p && k.checkedAt);
    if (!old) return { ...base, ok: false, checkState: "unverified", message: "Ключ задан. Сетевая проверка не выполнялась." };
    if (Date.now() - Date.parse(old.checkedAt!) >= 5 * 60_000) return { ...old, ...base, ok: false, checkState: "stale", message: `Проверка устарела. Предыдущий результат: ${old.message}` };
    return { ...old, ...base };
  };
  if (!force) return (Object.keys(META) as Provider[]).map(local);
  const before = generation;
  const data = await Promise.all((Object.keys(META) as Provider[]).map(async (p): Promise<KeyStatus> => {
    const key = config.keys[p];
    if (!key || (p.startsWith("youtube") && !youtube)) return local(p);
    const base = { provider: p, ...META[p], configured: true, checkState: "checked" as const, checkKind: p.startsWith("youtube") ? "quota" as const : "metadata" as const, checkedAt: new Date().toISOString() };
    const t = Date.now();
    try { const r = await probe(p, key); return { ...base, ...r, message: (r.ok ? r.message : human(r.message)).split(key).join("•••"), latencyMs: Date.now() - t }; }
    catch { return { ...base, ok: false, message: "Не удалось выполнить сетевую проверку. Проверьте подключение и права; доступность генерации не установлена.", latencyMs: Date.now() - t }; }
  }));
  if (before === generation) cache = { at: Date.now(), data };
  // Never return old-key diagnostics to a request racing a committed key change.
  return before === generation ? data : checkKeys();
}

/** Какой LLM реально будет использоваться */
export function activeLlm(pref: "auto" | "anthropic" | "gemini", anymodelFirst = true) {
  // Metadata errors do not prove that generation is unavailable.
  const amOk = !!config.keys.anymodel;
  if (anymodelFirst && amOk) return "anymodel";
  if (pref === "anthropic" && config.keys.anthropic) return "anthropic";
  if (pref === "gemini" && config.keys.gemini) return "gemini";
  if (config.keys.anthropic) return "anthropic";
  if (config.keys.gemini) return "gemini";
  if (amOk) return "anymodel";
  return config.keys.anymodel ? "anymodel" : config.keys.anthropic ? "anthropic" : config.keys.gemini ? "gemini" : null;
}
