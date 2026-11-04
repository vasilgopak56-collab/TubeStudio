import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import * as Icons from "lucide-react";
import { LifeBuoy, ArrowRight, Lightbulb, AlertTriangle, Coins, Search as SearchIcon } from "lucide-react";
import { HELP, type HelpSection } from "@/lib/help";
import { Card, Input, ToolHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

/** **жирный** и `код` внутри строк справки */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return <>{parts.map((p, i) => p.startsWith("**") ? <b key={i} className="text-foreground">{p.slice(2, -2)}</b>
    : p.startsWith("`") ? <code key={i} className="break-all rounded bg-muted px-1 font-mono text-[0.9em] text-foreground">{p.slice(1, -1)}</code> : <span key={i}>{p}</span>)}</>;
}

const Icon = ({ name, className }: { name: string; className?: string }) => {
  const C = (Icons as unknown as Record<string, Icons.LucideIcon>)[name] ?? Icons.Circle;
  return <C className={className} />;
};

const H = ({ children }: { children: ReactNode }) => <h3 className="mb-2 mt-5 text-[13px] font-bold uppercase tracking-wide text-primary">{children}</h3>;

function Pairs({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y rounded-lg border">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-1 p-3 md:grid-cols-[minmax(160px,34%)_1fr] md:gap-4">
          <dt className="text-sm font-semibold"><Rich text={k} /></dt>
          <dd className="text-sm text-muted-foreground"><Rich text={v} /></dd>
        </div>
      ))}
    </dl>
  );
}

function SectionView({ s }: { s: HelpSection }) {
  return (
    <Card id={s.id} className="scroll-mt-6 p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-primary/50 bg-primary/10 text-primary"><Icon name={s.icon} className="h-5 w-5" /></div>
          <div>
            <h2 className="text-xl font-extrabold leading-tight">{s.title}</h2>
            <p className="mt-1 text-[15px] text-muted-foreground"><Rich text={s.short} /></p>
          </div>
        </div>
        {s.route && <Link to={s.route} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-semibold hover:border-primary hover:text-primary">Открыть раздел<ArrowRight className="h-4 w-4" /></Link>}
      </div>

      <H>Простыми словами</H>
      <p className="text-[15px] leading-relaxed"><Rich text={s.what} /></p>

      {s.analogy && (
        <div className="mt-4 flex gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-[14px]">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><b>Это как… </b><Rich text={s.analogy} /></div>
        </div>
      )}

      {s.when?.length ? <><H>Когда пригодится</H><ul className="list-disc space-y-1 pl-5 text-[15px]">{s.when.map((w) => <li key={w}><Rich text={w} /></li>)}</ul></> : null}

      {s.steps && (
        <>
          <H>Как пользоваться</H>
          <ol className="space-y-2">
            {s.steps.map((st, i) => (
              <li key={i} className="flex gap-3 text-[15px]">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground">{i + 1}</span>
                <span className="pt-0.5"><Rich text={st} /></span>
              </li>
            ))}
          </ol>
        </>
      )}

      {s.fields && <><H>{s.id === "glossary" ? "Слова" : "Что значат настройки"}</H><Pairs rows={s.fields} /></>}
      {s.results && <><H>Что вы увидите</H><Pairs rows={s.results} /></>}

      {s.example && (
        <>
          <H>Пример</H>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border bg-muted/40 p-3"><div className="mono-label mb-1">{s.example.title} · вы вводите</div><p className="whitespace-pre-line text-sm">{s.example.input}</p></div>
            <div className="rounded-lg border border-success/40 bg-success/5 p-3"><div className="mono-label mb-1 text-success">получаете</div><p className="whitespace-pre-line text-sm">{s.example.output}</p></div>
          </div>
        </>
      )}

      {s.codeExample && <><H>{s.codeExample.title}</H><pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-4 font-mono text-sm" aria-label={s.codeExample.title}><code>{s.codeExample.code}</code></pre></>}

      {s.tips && <><H>Советы</H><ul className="list-disc space-y-1 pl-5 text-[15px]">{s.tips.map((t) => <li key={t}><Rich text={t} /></li>)}</ul></>}

      {s.details?.length ? <details className="mt-5 rounded-lg border p-4"><summary className="cursor-pointer font-semibold">Точная методика и ограничения — для подробной проверки</summary><div className="mt-3 space-y-3 text-[15px] leading-relaxed text-muted-foreground">{s.details.map((text, i) => <p key={i}><Rich text={text} /></p>)}</div></details> : null}

      {s.problems && (
        <>
          <H>Если не получается</H>
          <div className="space-y-2">
            {s.problems.map(([p, f]) => (
              <div key={p} className="flex gap-3 rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <div><b><Rich text={p} /></b><div className="text-muted-foreground"><Rich text={f} /></div></div>
              </div>
            ))}
          </div>
        </>
      )}

      {s.cost && <p className="mt-4 flex items-start gap-2 text-sm leading-relaxed text-muted-foreground"><Coins className="mt-1 h-4 w-4 shrink-0" /><span><b>Что расходуется: </b><Rich text={s.cost} /></span></p>}
    </Card>
  );
}

const flat = (s: HelpSection) => [s.title, s.short, s.what, s.analogy, ...(s.when ?? []), ...(s.steps ?? []), ...(s.tips ?? []),
  ...(s.fields ?? []).flat(), ...(s.results ?? []).flat(), ...(s.problems ?? []).flat(), ...(s.details ?? []), s.example?.input, s.example?.output, s.codeExample?.title, s.codeExample?.code].join(" ").toLowerCase();

export default function Help() {
  const { hash } = useLocation();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(hash.slice(1) || "intro");
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    return HELP.map((g) => ({ ...g, sections: t ? g.sections.filter((s) => flat(s).includes(t)) : g.sections })).filter((g) => g.sections.length);
  }, [q]);

  useEffect(() => {
    const id = hash.slice(1);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
  }, [hash]);

  useEffect(() => {
    const els = HELP.flatMap((g) => g.sections).map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((en) => { const v = en.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) setActive(v.target.id); }, { rootMargin: "-12% 0px -80% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [groups]);

  return (
    <div>
      <ToolHeader icon={LifeBuoy} title="Справка" eyebrow="// КАК ВСЁ РАБОТАЕТ" subtitle="Каждый раздел программы простыми словами: что делает, как пользоваться, примеры и решения проблем" />
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-auto">
          <div className="relative mb-3">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по справке" aria-label="Поиск по справке" />
          </div>
          <nav className="space-y-4">
            {groups.map((g) => (
              <div key={g.title}>
                <div className="mono-label mb-1.5">{g.title}</div>
                {g.sections.map((s) => (
                  <a key={s.id} href={`#${s.id}`} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted", active === s.id && "bg-primary/10 font-semibold text-primary")}>
                    <Icon name={s.icon} className="h-4 w-4 shrink-0" />{s.title}
                  </a>
                ))}
              </div>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 space-y-5">
          {!groups.length && <Card className="p-6 text-center text-muted-foreground">Ничего не найдено по «{q}». Попробуйте другое слово.</Card>}
          {groups.map((g) => (
            <section key={g.title} className="space-y-5">
              <h2 className="mono-label pt-2 text-primary">// {g.title}</h2>
              {g.sections.map((s) => <SectionView key={s.id} s={s} />)}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
