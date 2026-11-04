import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Health, type Settings } from "./api";

export const useHealth = () =>
  useQuery({ queryKey: ["health"], queryFn: () => api<Health>("/health"), staleTime: 5 * 60_000 });

export const useRecheckKeys = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (options?: { youtube?: boolean }) => api<Health>("/settings/keys/check", { method: "POST", json: options ?? {} }),
    onSuccess: (d) => qc.setQueryData(["health"], d),
  });
};

export const useSettings = () =>
  useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings"), staleTime: Infinity });

export const useSaveSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api<Settings>("/settings", { method: "PUT", json: patch }),
    onSuccess: (d) => { qc.setQueryData(["settings"], d); qc.invalidateQueries({ queryKey: ["health"] }); },
  });
};

export type VoiceProfileBrief = { enabled: boolean; language: string; samples: { title: string; text: string }[]; passport: { sentences: number; aiScore: number } | null; prompt: string };
export const useVoiceProfile = () => useQuery({ queryKey: ["voice-profile"], queryFn: () => api<VoiceProfileBrief>("/voice-profile"), staleTime: 30_000 });
export const voiceHint = (v?: VoiceProfileBrief) =>
  !v ? "Проверяем профиль…" : !v.passport ? "Профиль не заполнен — «Мои данные → Голос канала»" : !v.enabled ? "Профиль выключен — включите в «Голос канала»" : "Ритм, длина фраз, обращение и словечки из ваших текстов";
