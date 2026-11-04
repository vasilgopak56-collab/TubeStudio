import { useEffect, useRef, useState } from "react";

/** Черновик формы: автосохранение в localStorage раз в 2 с (ТЗ §11) */
export function useDraft<T extends object>(key: string, initial: T) {
  const k = `ts:draft:${key}`;
  const [v, setV] = useState<T>(() => {
    try { const raw = localStorage.getItem(k); return raw ? { ...initial, ...JSON.parse(raw) } : initial; } catch { return initial; }
  });
  const t = useRef<number>();
  useEffect(() => {
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ } }, 2000);
    return () => window.clearTimeout(t.current);
  }, [k, v]);
  return [v, setV, () => { localStorage.removeItem(k); setV(initial); }] as const;
}
