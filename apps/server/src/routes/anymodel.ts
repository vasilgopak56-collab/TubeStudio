import { Hono } from "hono";
import { ok, fail, ApiError } from "../lib/errors.js";
import { readJson, writeJson } from "../lib/storage.js";
import { amBalance, amCatalog, amVoices, hasAnymodel } from "../services/anymodel.js";
import { getSettings } from "../services/settings.js";
import { getUsage } from "../services/usage.js";

export const anymodelRoute = new Hono();
const HIST = "anymodel-balance.json";
type Snap = { at: string; balance: number };

const need = () => { if (!hasAnymodel()) throw new ApiError("KEY_MISSING", "Не задан ANYMODEL_API_KEY — вставьте ключ в Настройках → Ключи API", 400); };

/** Баланс + история снимков (для графика расхода) */
anymodelRoute.get("/anymodel/balance", async (c) => {
  try {
    need();
    const b = await amBalance();
    const s = await getSettings();
    const hist = await readJson<Snap[]>(HIST, []);
    const last = hist.at(-1);
    if (!last || last.balance !== b.balance || Date.now() - Date.parse(last.at) > 6 * 3600_000) {
      hist.push({ at: new Date().toISOString(), balance: b.balance });
      await writeJson(HIST, hist.slice(-500));
    }
    const u = await getUsage();
    return ok(c, { ...b, usd: (b.balance * s.anymodel.usdPerMillion) / 1e6, usdPerMillion: s.anymodel.usdPerMillion, history: hist.slice(-120), monthTokens: u.cost.balanceTokens ?? 0 });
  } catch (e) { return fail(c, e); }
});

/** Каталог моделей с ценой в $ за 1 млн токенов / за картинку */
anymodelRoute.get("/anymodel/models", async (c) => {
  try {
    need();
    const force = c.req.query("force") === "1";
    const s = await getSettings();
    const rate = s.anymodel.usdPerMillion;
    const models = (await amCatalog(force)).map((m) => {
      const b = m.billing;
      const kind = m.kind ?? "text";
      const coef = b?.coefficient ?? null;
      const unitTokens = b && b.unit !== "token" ? Math.ceil((b.base_tokens ?? 0) * b.coefficient.output) : null;
      return {
        id: m.id, kind, vendor: m.id.includes("/") ? m.id.split("/")[0] : (m.owned_by ?? ""), unit: b?.unit ?? "token",
        coefIn: coef?.input ?? null, coefOut: coef?.output ?? null,
        usdIn: coef && b?.unit === "token" ? coef.input * rate : null, usdOut: coef && b?.unit === "token" ? coef.output * rate : null,
        unitTokens, unitUsd: unitTokens != null ? (unitTokens * rate) / 1e6 : null,
        scales: b?.scales ?? null, context: m.context_length ?? null, vision: !!m.capabilities?.vision, search: !!m.capabilities?.search,
      };
    });
    return ok(c, { rate, models, selected: s.anymodel });
  } catch (e) { return fail(c, e); }
});

anymodelRoute.get("/anymodel/voices", async (c) => {
  try { need(); return ok(c, await amVoices(c.req.query("lang") || undefined)); } catch (e) { return fail(c, e); }
});
