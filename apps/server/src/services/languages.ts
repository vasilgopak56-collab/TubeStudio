/** ISO 639-1 content languages. Keep in sync with web CONTENT_LANGUAGES (tested). */
export const LANG_NAME: Record<string, string> = {
  ru: "Russian",
  uk: "Ukrainian",
  sr: "Serbian",
  fr: "French",
  pt: "Portuguese",
  es: "Spanish",
  it: "Italian",
  en: "English",
  de: "German",
  he: "Hebrew",
  ar: "Arabic",
  vi: "Vietnamese",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  id: "Indonesian",
  hi: "Hindi",
  tr: "Turkish",
  pl: "Polish",
};
export type VoiceChoice = { model: string; lang?: string };
/** Keep a matching configured voice or an explicitly multilingual model; never silently select Russian for another language. */
export function defaultTtsModel(language: string, configured: string, voices: VoiceChoice[]) {
  const code = language.toLowerCase().split(/[-_]/)[0];
  if (configured && (!configured.startsWith("edge-tts/") || configured.toLowerCase().startsWith(`edge-tts/${code}-`))) return configured;
  return voices.find(v => v.model.toLowerCase().startsWith(`edge-tts/${code}-`))?.model || "fish-farm/s2.1-pro-free";
}
