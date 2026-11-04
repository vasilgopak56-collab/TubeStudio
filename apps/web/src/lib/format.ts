export const compact = (n: number) => new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: n < 10_000 ? 1 : 0 }).format(n).replace(/\s/g, "");
export const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n));
export const money = (n: number) => "$" + new Intl.NumberFormat("en-US").format(Math.round(n));
export const pct = (n: number, d = 1) => `${n > 0 ? "+" : ""}${n.toFixed(d)}%`;
export const dur = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
export const date = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
export const ago = (iso: string) => { const d = Math.floor((Date.now() - +new Date(iso)) / 86400_000); return d < 1 ? "сегодня" : d < 30 ? `${d} дн. назад` : d < 365 ? `${Math.floor(d / 30)} мес. назад` : `${Math.floor(d / 365)} г. назад`; };
