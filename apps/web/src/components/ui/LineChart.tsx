/** Простой SVG-график: линия/бары, маркеры событий, подписи оси X в мм:сс */
export type ChartMarker = { x: number; label: string; tone: "good" | "bad" };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
export function LineChart({ points, height = 200, yMax, yLabel = (v) => `${v}%`, markers = [], bars = false, xLabel = mmss }:
  { points: { x: number; y: number }[]; height?: number; yMax?: number; yLabel?: (v: number) => string; markers?: ChartMarker[]; bars?: boolean; xLabel?: (x: number) => string }) {
  if (!points.length) return null;
  const W = 800, H = height, pl = 40, pr = 10, pt = 10, pb = 24;
  const maxX = Math.max(1, ...points.map((p) => p.x)), maxY = yMax ?? Math.max(1, ...points.map((p) => p.y));
  const X = (x: number) => pl + (x / maxX) * (W - pl - pr), Y = (y: number) => pt + (1 - y / maxY) * (H - pt - pb);
  const ticksY = [0, 0.25, 0.5, 0.75, 1].map((k) => +(maxY * k).toFixed(0));
  const ticksX = Array.from({ length: 6 }, (_, i) => (maxX * i) / 5);
  const path = points.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const bw = Math.max(1, (W - pl - pr) / points.length - 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
      {ticksY.map((t) => <g key={t}><line x1={pl} x2={W - pr} y1={Y(t)} y2={Y(t)} className="stroke-border" strokeDasharray="3 4" /><text x={pl - 6} y={Y(t) + 4} textAnchor="end" className="fill-muted-foreground font-mono text-[11px]">{yLabel(t)}</text></g>)}
      {ticksX.map((t, i) => <text key={i} x={X(t)} y={H - 6} textAnchor="middle" className="fill-muted-foreground font-mono text-[11px]">{xLabel(t)}</text>)}
      {bars ? points.map((p, i) => <rect key={i} x={X(p.x) - bw / 2} y={Y(p.y)} width={bw} height={Math.max(0, Y(0) - Y(p.y))} className="fill-primary/50" />)
        : <><path d={`${path} L${X(points[points.length - 1].x)},${Y(0)} L${X(points[0].x)},${Y(0)} Z`} className="fill-primary/10" /><path d={path} className="fill-none stroke-primary" strokeWidth={2.5} /></>}
      {markers.map((m, i) => <g key={i}><line x1={X(m.x)} x2={X(m.x)} y1={pt} y2={H - pb} className={m.tone === "good" ? "stroke-success/60" : "stroke-accent/70"} strokeDasharray="2 3" /><circle cx={X(m.x)} cy={pt + 4} r={4} className={m.tone === "good" ? "fill-success" : "fill-accent"}><title>{`${mmss(m.x)} · ${m.label}`}</title></circle></g>)}
    </svg>
  );
}
