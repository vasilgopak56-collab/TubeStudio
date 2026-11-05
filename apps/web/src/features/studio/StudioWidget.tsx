// Блок «Студия» на главной панели: активный канал и четыре шага выпуска.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Lightbulb, Mic, PenLine, Sparkles, Users } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, SectionTitle, Skeleton } from "@/components/ui";
import { ChannelPicker, agoDays, num, plural, useActiveChannel } from "./common";
import type { IdeasResponse } from "./types";

export function StudioWidget() {
  const { channel, list, loading } = useActiveChannel();
  const ideas = useQuery({
    queryKey: ["studio-ideas-summary", channel?.id],
    queryFn: () => api<IdeasResponse>(`/studio/channels/${channel!.id}/ideas?sort=best&show=active&period=all&limit=3`),
    enabled: !!channel,
    staleTime: 30_000,
  });
  if (loading) return <Skeleton className="h-40" />;
  if (!channel) return <Card className="p-5" data-testid="studio-widget">
    <SectionTitle icon={<Sparkles className="h-4 w-4" />}>Студия</SectionTitle>
    <p className="text-sm text-muted-foreground">Начните с канала: ниша, язык, длина ролика и 1–5 каналов-образцов. По ним Радар найдёт темы, которые уже выстрелили у небольших каналов.</p>
    <Link to="/channels" className="mt-4 inline-block"><Button>Добавить канал <ArrowRight className="h-4 w-4" /></Button></Link>
  </Card>;
  const d = ideas.data;
  const last = d?.lastRun?.finishedAt ?? d?.lastRun?.startedAt;
  const lastDays = last ? Math.max(0, Math.floor((Date.now() - Date.parse(last)) / 86_400_000)) : undefined;
  const active = d?.counts.active ?? 0;
  const steps = [
    { to: "/channels", icon: Users, title: "Канал", text: `${channel.name} · ${channel.language.toUpperCase()} · ${channel.lengthMin} мин${(list?.channels.length ?? 0) > 1 ? ` · всего ${list!.channels.length}` : ""}` },
    { to: "/ideas", icon: Lightbulb, title: "Идеи для канала", text: !d ? "…" : d.lastRun ? `${num(active)} ${plural(active, ["новая идея", "новые идеи", "новых идей"])} · поиск ${agoDays(lastDays)}` : "Поиск ещё не запускался" },
    { to: "/studio/script", icon: PenLine, title: "Сценарий", text: "Автор, проверка кодом и второе мнение" },
    { to: "/studio/voice", icon: Mic, title: "Озвучка", text: channel.voice?.voiceName ? `Голос: ${channel.voice.voiceName}` : "Голос канала не выбран" },
  ];
  return <Card className="space-y-4 p-5" data-testid="studio-widget">
    <SectionTitle icon={<Sparkles className="h-4 w-4" />} right={<ChannelPicker />}>Студия</SectionTitle>
    <div className="grid gap-3 md:grid-cols-4">
      {steps.map((s, i) => <Link key={s.to} to={s.to} className="bracket-card group flex flex-col p-4 transition-colors hover:border-primary/60">
        <div className="flex items-center justify-between">
          <span className="grid h-8 w-8 place-items-center rounded-lg border border-primary/50 bg-primary/10 text-primary"><s.icon className="h-4 w-4" /></span>
          <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
        </div>
        <div className="mt-3 flex items-center justify-between text-sm font-bold">{s.title}<ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" /></div>
        <p className="mt-1 text-[13px] text-muted-foreground">{s.text}</p>
      </Link>)}
    </div>
    {d && d.ideas.length > 0 && <div>
      <div className="mono-label mb-2">Лучшие новые идеи</div>
      <ul className="space-y-1">
        {d.ideas.map((x) => <li key={x.videoId} className="flex items-center justify-between gap-3 text-sm">
          <Link to="/ideas" className="truncate hover:text-primary" dir="auto">{x.title}</Link>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{x.multiplier >= 10 ? Math.round(x.multiplier) : String(x.multiplier).replace(".", ",")}× · {num(x.views)} просм.</span>
        </li>)}
      </ul>
    </div>}
  </Card>;
}
