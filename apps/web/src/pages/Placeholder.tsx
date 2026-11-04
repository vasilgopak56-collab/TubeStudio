import { useLocation } from "react-router-dom";
import { Construction } from "lucide-react";
import { findItem } from "@/lib/nav";
import { Card, ToolHeader } from "@/components/ui";

export default function Placeholder() {
  const { pathname } = useLocation();
  const item = findItem(pathname);
  if (!item) return null;
  return (
    <div>
      <ToolHeader icon={item.icon} title={item.label} subtitle={item.description} badge="Супер-инструмент" />
      <Card brackets className="flex items-start gap-4">
        <Construction className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <div className="font-semibold">Раздел в разработке — этап {item.stage}</div>
          <p className="mt-1 text-sm text-muted-foreground">Каркас, маршрут и дизайн готовы. Функциональность появится на этапе {item.stage} по ТЗ (§14).</p>
        </div>
      </Card>
    </div>
  );
}
