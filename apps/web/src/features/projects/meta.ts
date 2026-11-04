import { BarChart3, Clapperboard, FileText, Gauge, Image, Lightbulb, Mic, Search, StickyNote, Film, Smartphone, type LucideIcon } from "lucide-react";
import type { ArtifactKind } from "@/lib/types";

export const KIND: Record<ArtifactKind, { label: string; icon: LucideIcon; to?: string }> = {
  topic: { label: "Тема", icon: Lightbulb, to: "/topics" },
  analysis: { label: "Анализ", icon: BarChart3, to: "/analysis" },
  script: { label: "Сценарий", icon: FileText, to: "/script" },
  audio: { label: "Озвучка", icon: Mic, to: "/voice" },
  seo: { label: "SEO", icon: Search, to: "/seo" },
  thumbnail: { label: "Обложка", icon: Image, to: "/thumbnail" },
  storyboard: { label: "Раскадровка", icon: Clapperboard, to: "/storyboard" },
  check: { label: "Проверка", icon: Gauge, to: "/check/script-rater" },
  note: { label: "Заметка", icon: StickyNote },
  video: { label: "Видео", icon: Film, to: "/video" },
  shorts: { label: "Shorts", icon: Smartphone, to: "/video" },
};
export const PIPELINE: ArtifactKind[] = ["topic", "script", "audio", "seo", "thumbnail", "storyboard", "video", "shorts"];
