import { useEffect } from "react";
import { useSettings } from "./queries";

const KEY = "ts:theme";
export function applyTheme(t: "dark" | "light") {
  document.documentElement.classList.toggle("dark", t === "dark");
  localStorage.setItem(KEY, t);
}
export function initTheme() { applyTheme((localStorage.getItem(KEY) as "dark" | "light") || "dark"); }
export function useThemeSync() {
  const { data } = useSettings();
  useEffect(() => { if (data?.theme) applyTheme(data.theme); }, [data?.theme]);
}
