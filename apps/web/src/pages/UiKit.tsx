import { useState } from "react";
import { Palette, Eye, Users, Flame, TrendingUp } from "lucide-react";
import { Badge, Button, Card, Chip, CopyButton, EmptyState, ErrorAlert, ProgressBar, ScoreBar, ScoreRing, SectionTitle, Skeleton, StatTile, StepCard, Switch, TagPill, Textarea, ToolHeader } from "@/components/ui";

/** Витрина компонентов (скрытый маршрут /ui) — для приёмки этапа 1 */
export default function UiKit() {
  const [chip, setChip] = useState("Реализм 4K");
  const [skip, setSkip] = useState(false);
  const [sw, setSw] = useState(true);
  const [text, setText] = useState("");
  return (
    <div className="space-y-6">
      <ToolHeader icon={Palette} title="Дизайн-система" subtitle="Все базовые компоненты TubeStudio на одной странице" badge="UI kit" eyebrow="Служебная страница / ui" />
      <div className="grid gap-3 md:grid-cols-4">
        <StatTile icon={<Users className="h-4 w-4" />} label="Подписчики" value="4.9K" />
        <StatTile icon={<Eye className="h-4 w-4" />} label="Ср. просмотры" value="69K" />
        <StatTile icon={<Flame className="h-4 w-4" />} label="Вовлечённость" value="1.44%" />
        <StatTile icon={<TrendingUp className="h-4 w-4" />} label="Виральность" value="10/10" />
      </div>
      <Card><SectionTitle>Кнопки и бейджи</SectionTitle>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Основная</Button><Button variant="outline">Контурная</Button><Button variant="ghost">Тихая</Button>
          <Button variant="danger">Опасная</Button><Button loading>x</Button>
          <Badge>default</Badge><Badge tone="primary">primary</Badge><Badge tone="success">success</Badge><Badge tone="danger">danger</Badge><Badge tone="crown">лучший</Badge>
          <CopyButton text="TubeStudio" />
        </div>
      </Card>
      <StepCard n={2} title="Художественный стиль" description="Общий вид обложки" skipped={skip} onSkip={setSkip}>
        <div className="flex flex-wrap gap-2">
          {["Реализм 4K", "3D AAA-рендер", "Тёмная документалистика", "Яркий поп", "Стикмен", "Аниме"].map((c) => <Chip key={c} active={chip === c} onClick={() => setChip(c)}>{c}</Chip>)}
        </div>
      </StepCard>
      <Card><SectionTitle>Оценки</SectionTitle>
        <div className="flex flex-wrap items-center gap-8">
          <ScoreRing value={92} label="Сценарий" /><ScoreRing value={8} max={10} label="Виральность ниши" /><ScoreRing value={54} label="Слабо" />
          <div className="w-64 space-y-3"><ScoreBar value={94} /><ScoreBar value={71} /><ProgressBar value={37} label="Часть 3/8" /></div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2"><TagPill kind="gold" tag="humanevolution" value="479K" /><TagPill kind="ice" tag="stoneage" value="1.3K" /></div>
      </Card>
      <Card><SectionTitle>Поля</SectionTitle>
        <Textarea label="Описание ниши" required maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Я делаю документальные видео о…" />
        <div className="mt-3 max-w-md"><Switch checked={sw} onChange={setSw} label="Опираться на реальные данные YouTube" description="~300 ед. квоты за запуск" /></div>
      </Card>
      <ErrorAlert error={new Error("Квота YouTube исчерпана — сброс в 10:00 по Москве")} onRetry={() => {}} />
      <EmptyState title="Пока пусто">Здесь появятся результаты.</EmptyState>
      <div className="grid gap-2"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-24" /></div>
    </div>
  );
}
