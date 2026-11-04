import { CONTENT_LANGUAGES } from "@/lib/constants";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint, Plus, Trash2, Upload, Wand2 } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Card, CopyButton, ErrorAlert, Input, Label, SectionTitle, Select, Skeleton, Switch, Textarea, ToolHeader } from "@/components/ui";

export type Passport = {
  language: string; samples: number; words: number; sentences: number; avgSentence: number; medianSentence: number; p10: number; p90: number; spread: number;
  shortPct: number; longPct: number; questionPct: number; exclamPct: number; commasPerSentence: number; dashes: number; colons: number; ellipses: number; parens: number;
  address: "ty" | "vy" | "my" | "ya" | "neutral"; person: Record<string, number>; paragraphSentences: number;
  topWords: { w: string; n: number }[]; phrases: { p: string; n: number }[]; openers: { w: string; n: number }[]; examples: string[]; aiScore: number;
};
export type VoiceProfileT = { enabled: boolean; language: string; samples: { id: string; title: string; text: string }[]; passport: Passport | null; updatedAt: string; prompt: string };
type Sample = { id?: string; title: string; text: string };

const ADDRESS: Record<Passport["address"], string> = { ty: "на «ты»", vy: "на «вы»", my: "«мы» — вместе со зрителем", ya: "от первого лица «я»", neutral: "без прямого обращения" };

function Metric({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return <div className="rounded-lg border p-3"><div className="mono-label">{label}</div><div className="mt-0.5 text-xl font-extrabold">{value}</div><div className="text-[12px] leading-snug text-muted-foreground">{hint}</div></div>;
}

export default function VoiceProfile() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["voice-profile"], queryFn: () => api<VoiceProfileT>("/voice-profile") });
  const [samples, setSamples] = useState<Sample[]>([]);
  const [lang, setLang] = useState("ru");
  useEffect(() => { if (q.data) { setSamples(q.data.samples.length ? q.data.samples : [{ title: "", text: "" }]); setLang(q.data.language); } }, [q.data]);
  const save = useMutation({
    mutationFn: (body: { enabled?: boolean; samples?: Sample[]; language?: string }) => api<VoiceProfileT>("/voice-profile", { method: "PUT", json: body }),
    onSuccess: (d) => qc.setQueryData(["voice-profile"], d),
  });
  const filled = samples.filter((s) => s.text.trim().length >= 200);
  const dirty = q.data && JSON.stringify(filled.map((s) => [s.title, s.text])) !== JSON.stringify(q.data.samples.map((s) => [s.title, s.text])) || (q.data && lang !== q.data.language);
  const p = q.data?.passport;
  const upd = (i: number, patch: Partial<Sample>) => setSamples((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const readFile = async (i: number, file?: File) => { if (!file) return; const t = await file.text(); upd(i, { text: t.slice(0, 60000), title: samples[i].title || file.name.replace(/\.\w+$/, "") }); };

  return (
    <div>
      <ToolHeader icon={Fingerprint} title="Голос канала" eyebrow="// МОИ ДАННЫЕ" subtitle="Паспорт вашего стиля по 1–5 своим сценариям — Сценарист и «Живой голос» пишут так, как пишете вы" />
      {q.isLoading ? <Skeleton className="h-64" /> : q.error ? <ErrorAlert error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <Card brackets>
            <SectionTitle icon={<Upload className="h-4 w-4" />}>Ваши тексты</SectionTitle>
            <p className="mb-3 text-[13px] text-muted-foreground">Вставьте 1–5 своих лучших сценариев (от 200 символов, лучше по 800+ слов). Нейросеть здесь не нужна — всё считается на вашем компьютере. Тексты никуда не отправляются, в промпт попадают только цифры стиля и 3–4 коротких примера.</p>
            <p className="mb-3 text-xs text-muted-foreground">Локальные словари и распознавание обращений настроены для русского и английского. Для остальных языков паспорт использует общие метрики; для текстов без пробелов подсчёт слов и ритма приблизительный.</p>
            <div className="mb-3 max-w-[200px]"><Label>Язык текстов</Label><Select value={lang} onChange={(e) => setLang(e.target.value)}>{CONTENT_LANGUAGES.map((l) => <option key={l.value} value={l.value} lang={l.value} dir="auto">{l.label}</option>)}</Select></div>
            <div className="space-y-4">
              {samples.map((s, i) => (
                <div key={i} className="rounded-lg border p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Input value={s.title} onChange={(e) => upd(i, { title: e.target.value })} placeholder={`Образец ${i + 1}: название`} maxLength={200} />
                    <label className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1.5 text-xs hover:border-primary" title="Загрузить .txt / .md"><Upload className="h-3.5 w-3.5" />.txt<input type="file" accept=".txt,.md,text/plain" className="hidden" onChange={(e) => readFile(i, e.target.files?.[0])} /></label>
                    <Button size="sm" variant="ghost" title="Убрать образец" onClick={() => setSamples((xs) => xs.length > 1 ? xs.filter((_, j) => j !== i) : [{ title: "", text: "" }])}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  <Textarea value={s.text} onChange={(e) => upd(i, { text: e.target.value })} maxLength={60000} rows={6} placeholder="Вставьте текст своего сценария…" />
                  {s.text && s.text.trim().length < 200 && <div className="mt-1 text-xs text-accent">Нужно от 200 символов</div>}
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {samples.length < 5 && <Button variant="outline" size="sm" onClick={() => setSamples((xs) => [...xs, { title: "", text: "" }])}><Plus className="h-4 w-4" />Ещё образец</Button>}
              <Button onClick={() => save.mutate({ samples: filled, language: lang, enabled: q.data?.enabled || !q.data?.passport })} loading={save.isPending} loadingText="Считаем…" disabled={!filled.length || !dirty}><Wand2 className="h-4 w-4" />Составить паспорт</Button>
            </div>
            {save.error && <div className="mt-3"><ErrorAlert error={save.error} /></div>}
          </Card>

          <div className="space-y-5">
            {!p ? (
              <Card className="grid min-h-[260px] place-items-center text-center text-muted-foreground"><div><Fingerprint className="mx-auto mb-2 h-8 w-8" />Здесь появится паспорт стиля.<br />Добавьте свои тексты и нажмите «Составить паспорт».</div></Card>
            ) : (
              <>
                <Card>
                  <Switch checked={q.data!.enabled} onChange={(v) => save.mutate({ enabled: v })} label="Применять голос канала"
                    description={<>В <Link to="/script" className="text-primary underline">Сценаристе</Link> и <Link to="/check/humanizer" className="text-primary underline">Живом голосе</Link> (для языка «{CONTENT_LANGUAGES.find(l => l.value === lang)?.label ?? lang}»). Отключить для одного сценария можно там же.</>} />
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground"><Badge>{p.samples} образц.</Badge><Badge>{p.words} слов</Badge><Badge>{p.sentences} предложений</Badge>
                    <Badge tone={p.aiScore >= 85 ? "success" : "danger"} title="Оценка «Живого голоса» для ваших образцов">живой голос образцов {p.aiScore}/100</Badge></div>
                  {p.aiScore < 85 && <p className="mt-2 text-xs text-accent">В образцах есть признаки ИИ — паспорт может их перенять. Лучше взять тексты, написанные вами вручную.</p>}
                </Card>
                <Card>
                  <SectionTitle>Ритм и подача</SectionTitle>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    <Metric label="Длина фразы" value={`${p.avgSentence} сл.`} hint={`обычно от ${p.p10} до ${p.p90} слов`} />
                    <Metric label="Короткие (≤6 сл.)" value={`${p.shortPct}%`} hint="рубленые фразы для акцента" />
                    <Metric label="Длинные (≥20 сл.)" value={`${p.longPct}%`} hint="развёрнутые объяснения" />
                    <Metric label="Разброс ритма" value={p.spread} hint={p.spread >= 7 ? "рваный, живой ритм" : p.spread >= 4 ? "умеренно разный" : "ровный — может утомлять"} />
                    <Metric label="Вопросы" value={`${p.questionPct}%`} hint="доля вопросительных фраз" />
                    <Metric label="Обращение" value={ADDRESS[p.address].split(" ")[0] === "без" ? "нейтрально" : ADDRESS[p.address].split(" —")[0]} hint={ADDRESS[p.address]} />
                    <Metric label="Тире / 100 слов" value={p.dashes} hint={`двоеточия ${p.colons} · многоточия ${p.ellipses} · скобки ${p.parens}`} />
                    <Metric label="Запятых на фразу" value={p.commasPerSentence} hint="сложность предложений" />
                    <Metric label="Абзац" value={`${p.paragraphSentences} пр.`} hint="предложений в абзаце" />
                  </div>
                </Card>
                <Card>
                  <SectionTitle>Ваши слова и обороты</SectionTitle>
                  <Label>Любимые слова</Label>
                  <div className="mb-3 flex flex-wrap gap-1.5">{p.topWords.length ? p.topWords.map((w) => <Badge key={w.w} tone="primary">{w.w} ×{w.n}</Badge>) : <span className="text-sm text-muted-foreground">мало текста — добавьте ещё образцов</span>}</div>
                  <Label>Устойчивые обороты</Label>
                  <div className="mb-3 flex flex-wrap gap-1.5">{p.phrases.length ? p.phrases.map((x) => <Badge key={x.p}>«{x.p}» ×{x.n}</Badge>) : <span className="text-sm text-muted-foreground">не найдено</span>}</div>
                  <Label>Чем начинаете фразы</Label>
                  <div className="mb-3 flex flex-wrap gap-1.5">{p.openers.map((x) => <Badge key={x.w}>{x.w}… ×{x.n}</Badge>)}</div>
                  <Label>Примеры вашего тона (нейросеть не копирует, а ориентируется)</Label>
                  <ul className="space-y-1.5 text-sm">{p.examples.map((e) => <li key={e} className="rounded border-l-2 border-primary bg-muted/40 px-3 py-1.5">«{e}»</li>)}</ul>
                </Card>
                <details className="rounded-lg border bg-card p-4">
                  <summary className="cursor-pointer text-sm font-semibold">Что именно получает нейросеть</summary>
                  <div className="mt-2 flex justify-end"><CopyButton text={q.data!.prompt} /></div>
                  <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-mono text-[12px]">{q.data!.prompt}</pre>
                </details>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
