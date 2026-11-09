import { useEffect, useState } from "react";
import { Settings as SettingsIcon, RefreshCw, Plus, Trash2, Check, KeyRound, Database, Download, Upload, Pencil, X, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useHealth, useRecheckKeys, useSaveSettings, useSettings } from "@/lib/queries";
import type { Settings as S } from "@/lib/api";
import { CONTENT_LANGUAGES, TIMEZONES } from "@/lib/constants";
import { applyTheme } from "@/lib/theme";
import { ResearchSettingsCard } from "@/features/research/ResearchSettings";
import { Badge, Button, Card, Chip, ErrorAlert, Input, Label, SectionTitle, Select, Skeleton, StatusDot, Switch, ToolHeader } from "@/components/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const KEY_LINKS: Record<string, string> = {
  anymodel: "https://anymodel.org/app/providers",
  youtube: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
  youtube2: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
  youtube3: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
  gemini: "https://aistudio.google.com/apikey",
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  lumean: "https://lumean.net",
};

/** Проверка связи с G-Labs по сохранённому адресу и ключу. */
function GlabsCheck({ dirty }: { dirty: boolean }) {
  const q = useQuery({ queryKey: ["glabs-check"], queryFn: () => api<{ ok: boolean; message: string }>("/studio/visual/glabs"), enabled: false, retry: false });
  return <div className="space-y-1">
    <Button type="button" variant="outline" className="min-h-10" disabled={dirty} title={dirty ? "Сначала сохраните адрес" : undefined} loading={q.isFetching} loadingText="Проверяю…" onClick={() => void q.refetch()}><RefreshCw className="h-3.5 w-3.5" />Проверить связь</Button>
    {q.data && <p role="status" className={`max-w-md text-[12px] ${q.data.ok ? "text-success" : "text-accent"}`}>{q.data.message}</p>}
    {q.error && <p role="alert" className="max-w-md text-[12px] text-accent">{(q.error as Error).message}</p>}
  </div>;
}

type UnpricedOp = { id: string; completedAt: string; model: string; kind: string; estimateUsd: number | null };
/** Ручная сверка операций без цены: пока такая операция есть, платные вызовы в режиме блокировки остановлены. */
function UnpricedOperations() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["usage-unpriced"], queryFn: () => api<{ operations: UnpricedOp[] }>("/usage/unpriced") });
  const save = useMutation({
    mutationFn: (o: UnpricedOp) => api(`/usage/unpriced/${o.id}/reconcile`, { method: "POST", json: { expectedUsd: o.estimateUsd } }),
    onSettled: () => { void qc.invalidateQueries({ queryKey: ["usage-unpriced"] }); void qc.invalidateQueries({ queryKey: ["usage"] }); },
  });
  const ops = q.data?.operations ?? [];
  if (!ops.length && !q.error) return null;
  return <div className="mb-4 space-y-2 rounded-lg border border-amber-500/40 p-3" data-testid="unpriced-operations">
    <p className="text-[13px] text-muted-foreground">Эти операции прошли, но провайдер не сообщил расход. Пока они не сверены, платные вызовы в режиме блокировки остановлены. Оценка — самая крупная операция той же модели из того же задания; сумма записывается как оценка и только один раз.</p>
    {ops.map((o) => <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="font-mono">{o.model} · {new Date(o.completedAt).toLocaleString("ru-RU")}</span>
      {o.estimateUsd === null
        ? <span className="text-[13px] text-muted-foreground">Оценить не с чем, сверка недоступна</span>
        : <Button size="sm" variant="outline" className="min-h-10" loading={save.isPending && save.variables?.id === o.id} loadingText="Записываю…" disabled={save.isPending} onClick={() => save.mutate(o)}>Оценить по похожим: записать ${o.estimateUsd.toFixed(4)}</Button>}
    </div>)}
    {q.error && <ErrorAlert error={q.error} />}
    {save.error && <ErrorAlert error={save.error} />}
  </div>;
}

const envName = (p: string) => { const m = p.match(/^youtube(\d)$/); return m ? `YOUTUBE_API_KEY_${m[1]}` : `${p.toUpperCase()}_API_KEY`; };

type YtPool = { active: string | null; resetAt: string; dailyLimitPerKey: number; keys: { slot: string; n: number; configured: boolean; masked: string; unitsToday: number; state: "empty" | "exhausted" | "bad" | "active" | "standby"; lastError?: string }[] };
const YT_STATE: Record<string, [string, string]> = { active: ["работает сейчас", "text-success"], standby: ["в резерве", "text-muted-foreground"], exhausted: ["квота исчерпана", "text-accent"], bad: ["ошибка ключа", "text-destructive"], empty: ["не задан", "text-muted-foreground"] };
/** Пул ключей YouTube: кто активен, сколько квоты потрачено, когда сброс */
export function YtPoolCard() {
  const q = useQuery({ queryKey: ["yt-pool"], queryFn: () => api<YtPool>("/youtube/keys"), refetchInterval: 60_000 });
  if (!q.data) return null;
  const used = q.data.keys.filter((k) => k.configured);
  const total = used.length * q.data.dailyLimitPerKey, spent = used.reduce((s, k) => s + k.unitsToday, 0);
  const reset = new Date(q.data.resetAt).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="mt-4 rounded-lg border p-3" data-testid="yt-pool">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm"><b>Квота YouTube: {spent.toLocaleString("ru")} / {total.toLocaleString("ru")} ед. сегодня</b><span className="text-[12px] text-muted-foreground">ключей: {used.length} из 3 · сброс в {reset}</span></div>
      <p className="mb-3 text-[12px] text-muted-foreground">Когда у ключа кончается квота (10 000 ед./сутки), программа сама берёт следующий. Ключи из <b>разных проектов</b> Google Cloud — у ключей одного проекта общая квота.</p>
      <div className="space-y-2">{q.data.keys.map((k) => { const [t, c] = YT_STATE[k.state]; const pct = Math.min(100, (k.unitsToday / q.data!.dailyLimitPerKey) * 100); return (
        <div key={k.slot} className="grid grid-cols-[70px_minmax(0,1fr)_auto] items-center gap-3 text-[13px]">
          <span className="font-mono text-muted-foreground">ключ {k.n}</span>
          <div className="h-2 overflow-hidden rounded bg-muted"><div className={k.state === "exhausted" ? "h-full bg-accent" : "h-full bg-primary"} style={{ width: `${k.state === "exhausted" ? 100 : pct}%` }} /></div>
          <span className={c} title={k.lastError}>{k.configured ? `${k.unitsToday.toLocaleString("ru")} ед. · ${t}` : t}</span>
        </div>); })}</div>
    </div>
  );
}

export default function Settings() {
  const settings = useSettings();
  const save = useSaveSettings();
  const health = useHealth();
  const recheck = useRecheckKeys();
  const [youtubeCheck, setYoutubeCheck] = useState(false);
  const [form, setForm] = useState<S | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (settings.data) setForm(settings.data); }, [settings.data]);
  const loaded = !!form;
  useEffect(() => { if (loaded && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" }); }, [loaded]);

  const set = <K extends keyof S>(k: K, v: S[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const dirty = form && settings.data && JSON.stringify(form) !== JSON.stringify(settings.data);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [keyVal, setKeyVal] = useState("");
  const [keyErr, setKeyErr] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const qcl = useQueryClient();
  const saveKey = async (provider: string, value: string) => {
    setKeyBusy(true); setKeyErr("");
    try { await api("/settings/keys", { method: "PUT", json: { [provider]: value.trim() } }); setEditKey(null); setKeyVal(""); await health.refetch(); qcl.invalidateQueries({ queryKey: ["yt-pool"] }); }
    catch (e) { setKeyErr((e as Error).message); } finally { setKeyBusy(false); }
  };
  const submit = async () => { if (!form) return; await save.mutateAsync(form); setSaved(true); setTimeout(() => setSaved(false), 1500); };

  return (
    <div>
      <ToolHeader icon={SettingsIcon} title="Настройки" subtitle="Ключи, модели, язык, тема и ставки RPM. Всё хранится локально." />

      <div className="space-y-5">
        <Card>
          <SectionTitle icon={<KeyRound className="h-4 w-4" />} right={
            <Button size="sm" variant="outline" onClick={() => { recheck.mutate({ youtube: youtubeCheck }); setYoutubeCheck(false); }} loading={recheck.isPending} loadingText="Проверяем…"><RefreshCw className="h-3.5 w-3.5" />Проверить снова</Button>}>
            Ключи API
          </SectionTitle>
          <p className="mb-4 text-[13px] text-muted-foreground">Нажмите <b>карандаш</b>, вставьте ключ и сохраните — он запишется в файл <code className="font-mono text-foreground">.env</code> на вашем компьютере и заработает сразу, без перезапуска. Обратно в браузер ключ не показывается. Где взять ключи — в <Link to="/help#keys" className="text-primary underline">Справке</Link>.</p>
          <p className="mb-3 text-[13px] text-muted-foreground">Открытие страницы и сохранение ключа не вызывают провайдера. «Проверить снова» запрашивает метаданные/баланс, но не генерацию и не доказывает доступ к выбранной модели.</p>
          <label className="mb-3 flex items-start gap-2 text-[13px]"><input type="checkbox" checked={youtubeCheck} onChange={e => setYoutubeCheck(e.target.checked)} />Разрешить проверку YouTube: до 1 ед. квоты на каждый заданный ключ за попытку</label>
          {recheck.error && <ErrorAlert error={recheck.error} />}
          {health.error ? <ErrorAlert error={health.error} onRetry={() => health.refetch()} /> : (
            <div className="divide-y rounded-lg border">
              {health.isLoading ? <div className="space-y-2 p-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div> :
                health.data!.keys.map((k) => (
                  <div key={k.provider} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="flex items-center gap-2.5">
                      <StatusDot ok={k.ok} muted={k.checkState === "unverified" || k.checkState === "stale" || (!k.configured && !k.required)} />
                      <div>
                        <div className="text-sm font-semibold">{k.label} {k.required ? <Badge>обязательный</Badge> : <Badge>необязательный</Badge>}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{envName(k.provider)}{k.latencyMs != null && ` · ${k.latencyMs} мс`}</div>
                      </div>
                    </div>
                    <div className="flex max-w-[60%] items-center gap-2">
                      <div className={`text-right text-[13px] ${k.ok ? "text-success" : k.configured ? "text-accent" : "text-muted-foreground"}`}>{k.message}{k.checkedAt && <span className="block text-[11px] text-muted-foreground">{k.checkKind === "quota" ? "Проверка квоты" : "Метаданные"} · {new Date(k.checkedAt).toLocaleString("ru")}</span>}</div>
                      <Button size="sm" variant="ghost" title={editKey === k.provider ? "Отмена" : k.configured ? "Заменить ключ" : "Вставить ключ"} onClick={() => { setEditKey(editKey === k.provider ? null : k.provider); setKeyVal(""); setKeyErr(""); }}>
                        {editKey === k.provider ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                      </Button>
                    </div>
                    {editKey === k.provider && (
                      <form className="flex w-full flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); saveKey(k.provider, keyVal); }}>
                        <Input type="password" autoComplete="off" className="min-w-[220px] flex-1 font-mono" value={keyVal} onChange={(e) => setKeyVal(e.target.value)} placeholder={`Вставьте ${envName(k.provider)}`} autoFocus />
                        <Button type="submit" size="sm" loading={keyBusy} loadingText="Сохраняем…" disabled={!keyVal.trim()}><Check className="h-3.5 w-3.5" />Сохранить ключ</Button>
                        {k.configured && <Button type="button" size="sm" variant="ghost" onClick={() => { if (confirm("Удалить ключ из .env?")) saveKey(k.provider, ""); }}><Trash2 className="h-3.5 w-3.5" />Удалить</Button>}
                        {KEY_LINKS[k.provider] && <a className="inline-flex items-center gap-1 text-[12px] text-primary underline" href={KEY_LINKS[k.provider]} target="_blank" rel="noreferrer">Где взять<ExternalLink className="h-3 w-3" /></a>}
                        {k.provider === "glabs" && <span className="text-[12px] text-muted-foreground">Где взять: программа G-Labs → вкладка Webhook → API key (тариф MAX)</span>}
                        {keyErr && <div className="w-full text-[12px] text-accent">{keyErr}</div>}
                      </form>
                    )}
                  </div>
                ))}
            </div>
          )}
          <YtPoolCard />
        </Card>

        {!form ? <Skeleton className="h-64" /> : (
          <>
            <Card>
              <SectionTitle>Интерфейс и контент</SectionTitle>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <Label>Тема</Label>
                  <div className="flex gap-2">
                    {(["dark", "light"] as const).map((t) => (
                      <Chip key={t} active={form.theme === t} onClick={() => { set("theme", t); applyTheme(t); }}>{t === "dark" ? "Тёмная" : "Светлая"}</Chip>
                    ))}
                  </div>
                </div>
                <label><Label>Язык контента по умолчанию</Label>
                  <Select value={form.contentLanguage} onChange={(e) => set("contentLanguage", e.target.value)}>
                    {CONTENT_LANGUAGES.map((l) => <option key={l.value} value={l.value} lang={l.value} dir="auto">{l.label}</option>)}
                  </Select>
                </label>
                <label><Label>Часовой пояс</Label>
                  <Select value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
                    {TIMEZONES.map((t) => <option key={t}>{t}</option>)}
                  </Select>
                </label>
              </div>
            </Card>

            <Card id="glabs">
              <SectionTitle right={<Link to="/studio/visual" className="text-xs text-primary hover:underline">Раздел «Визуал» →</Link>}>G-Labs — картинки и анимация</SectionTitle>
              <p className="mb-3 text-[13px] text-muted-foreground">Программа G-Labs на этом компьютере, тариф MAX. В G-Labs откройте вкладку <b>Webhook</b> → <b>Start</b> (или включите <b>Auto-start</b>), скопируйте <b>API key</b> и вставьте его выше в «Ключи API» → G-Labs.</p>
              <div className="grid items-end gap-3 md:grid-cols-[1fr_auto]">
                <label><Label hint="обычно менять не нужно">Адрес Webhook</Label>
                  <Input className="font-mono text-sm" value={form.glabs?.url ?? ""} autoComplete="off" spellCheck={false} placeholder="http://127.0.0.1:8765" onChange={(e) => set("glabs", { url: e.target.value.trim() })} /></label>
                <GlabsCheck dirty={!!settings.data && (form.glabs?.url ?? "") !== (settings.data.glabs?.url ?? "")} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">G-Labs на другом компьютере в сети — укажите его адрес, например http://192.168.0.5:8765. Новый адрес сохраняется кнопкой «Сохранить» внизу страницы.</p>
            </Card>

            <Card id="anymodel">
              <SectionTitle right={<Link to="/anymodel" className="text-xs text-primary hover:underline">Баланс и калькулятор →</Link>}>AnyModel — один ключ на все нейросети</SectionTitle>
              <p className="mb-3 text-[13px] text-muted-foreground">Тексты, веб-поиск и обложки идут через anymodel.org. Прямые ключи Claude / Gemini / OpenAI ниже — резерв: если AnyModel не ответит или кончится баланс, программа сама переключится.</p>
              <Switch checked={form.anymodel.enabled} onChange={(v) => set("anymodel", { ...form.anymodel, enabled: v })} label="Использовать AnyModel" description={form.anymodel.enabled ? "Включено" : "Выключено — только прямые ключи"} />
              <div className="my-3">
                <Label>Порядок</Label>
                <div className="flex flex-wrap gap-2">
                  {([["first", "AnyModel основной, прямые — резерв"], ["reserve", "Прямые основные, AnyModel — резерв"]] as const).map(([v, l]) => (
                    <Chip key={v} active={form.anymodel.priority === v} onClick={() => set("anymodel", { ...form.anymodel, priority: v })}>{l}</Chip>
                  ))}
                </div>
              </div>
              <p className="mb-4 text-sm text-muted-foreground">Все поля ниже поддерживают ручной ввод ID. Для Claude в AnyModel, например: <code className="inline-block max-w-full break-all align-bottom">cc/claude-opus-5</code> или <code className="inline-block max-w-full break-all align-bottom">cc/claude-sonnet-5</code>. Подсказки из каталога не ограничивают ввод; доступность модели зависит от провайдера. Вводите ID без кавычек и URL.</p>
              <div className="grid gap-4 md:grid-cols-2">
                {([
                  ["text", "Тексты — основная модель", "am-text"],
                  ["script", "Сценарии — топ-модель (Сценарист)", "am-text"],
                  ["textAlt", "Тексты — запасная модель", "am-text"],
                  ["fast", "Быстрые задачи (сегментация, проверки)", "am-text"],
                  ["search", "Веб-ресёрч (Google Search)", "am-text"],
                  ["image", "Обложки и кадры — основная", "am-image"],
                  ["imageAlt", "Обложки и кадры — запасная", "am-image"],
                ] as const).map(([k, l, list]) => (
                  <label key={k}><Label>{l}</Label>
                    <Input aria-label={`${l} — ID AnyModel`} className="font-mono text-sm" value={form.anymodel[k]} list={list}
                      autoComplete="off" autoCapitalize="none" spellCheck={false}
                      placeholder={k === "script" ? "Например: cc/claude-opus-5" : list === "am-text" ? "Например: cc/claude-sonnet-5" : "ID из каталога AnyModel"}
                      onChange={(e) => set("anymodel", { ...form.anymodel, [k]: e.target.value.trim() })} />
                  </label>
                ))}
                <AmDatalists />
                <div><Label>Качество картинок</Label>
                  <div className="flex flex-wrap gap-2">
                    {([["low", "Низкое (×0.25–1)"], ["medium", "Среднее"], ["high", "Высокое (×2–4)"]] as const).map(([v, l]) => (
                      <Chip key={v} active={form.anymodel.imageQuality === v} onClick={() => set("anymodel", { ...form.anymodel, imageQuality: v })}>{l}</Chip>
                    ))}
                  </div>
                </div>
                <label><Label hint="на сайте — 5¢ за 1 млн при ×1">Цена 1 млн балансовых токенов, $</Label>
                  <Input type="number" step="0.01" min={0} value={form.anymodel.usdPerMillion} onChange={(e) => set("anymodel", { ...form.anymodel, usdPerMillion: Math.max(0, +e.target.value) })} />
                </label>
              </div>
            </Card>

            <Card>
              <SectionTitle>Прямые ключи (резерв)</SectionTitle>
              <div className="mb-4 space-y-2 rounded-lg border p-3 text-sm text-muted-foreground" id="claude-model-help">
                <p><b className="text-foreground">Claude Pro — подписка, а не ID модели.</b> Она не включает использование Claude API. Для прямого подключения нужны отдельный API-ключ Anthropic и оплата API; для AnyModel — его ключ и баланс.</p>
                <p>В поле Claude ниже введите, например, <code className="inline-block max-w-full break-all align-bottom">claude-opus-5-5</code> или <code className="inline-block max-w-full break-all align-bottom">claude-sonnet-5-5</code> — без <code>cc/</code>, кавычек и URL. Это примеры, а не гарантия доступа в вашем аккаунте.</p>
                <p>Чтобы прямой Claude использовался первым, выберите порядок «Прямые основные» в AnyModel и «Claude» в генерации текстов. Настройки применятся после сохранения. Резервные модели остаются включены.</p>
              </div>
              <div className="mb-4">
                <Label hint="«Авто» — Claude, если есть ключ, иначе Gemini">Генерация текстов</Label>
                <div className="flex flex-wrap gap-2">
                  {([["auto", "Авто"], ["anthropic", "Claude"], ["gemini", "Gemini"]] as const).map(([v, l]) => (
                    <Chip key={v} active={form.llmProvider === v} onClick={() => set("llmProvider", v)}>{l}</Chip>
                  ))}
                </div>
              </div>
              <div className="mb-4">
                <Label hint="GPT-Image — лучше текст и композиция; Gemini — запасной вариант">Генерация обложек</Label>
                <div className="flex flex-wrap gap-2">
                  {([["openai", "GPT-Image (OpenAI)"], ["gemini", "Gemini Image"]] as const).map(([v, l]) => (
                    <Chip key={v} active={form.imageProvider === v} onClick={() => set("imageProvider", v)}>{l}</Chip>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {([
                  ["anthropic", "Claude — тексты и анализ"],
                  ["gemini", "Gemini — тексты (качество)"],
                  ["geminiFast", "Gemini — быстрые задачи"],
                  ["geminiTts", "Gemini — озвучка"],
                  ["geminiImage", "Gemini — обложки"],
                  ["openaiImage", "OpenAI — обложки"],
                ] as const).map(([k, l]) => (
                  <label key={k}><Label>{l}</Label>
                    <Input aria-label={`${l} — ID прямого API`} className="font-mono text-sm" value={form.models[k]}
                      autoComplete="off" autoCapitalize="none" spellCheck={false}
                      placeholder={k === "anthropic" ? "Например: claude-opus-5-5" : "Введите ID модели провайдера"}
                      aria-describedby={k === "anthropic" ? "claude-model-help" : undefined}
                      onChange={(e) => set("models", { ...form.models, [k]: e.target.value.trim() })}
                      list={k === "anthropic" ? "claude-api-models" : k === "geminiTts" ? "tts-models" : k === "geminiImage" ? "img-models" : undefined} />
                  </label>
                ))}
                <datalist id="claude-api-models">{["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"].map((id) => <option key={id} value={id} />)}</datalist>
                <datalist id="tts-models">{((health.data?.keys.find((x) => x.provider === "gemini")?.info?.tts as string[]) ?? []).map((m) => <option key={m} value={m} />)}</datalist>
                <datalist id="img-models">{((health.data?.keys.find((x) => x.provider === "gemini")?.info?.image as string[]) ?? []).map((m) => <option key={m} value={m} />)}</datalist>
              </div>
            </Card>

            <Card>
              <SectionTitle right={<Button size="sm" variant="ghost" onClick={() => set("rpm", [...form.rpm, { niche: "Новая ниша", min: 3, max: 8 }])}><Plus className="h-3.5 w-3.5" />Добавить</Button>}>
                Ставки RPM для оценки дохода
              </SectionTitle>
              <p className="mb-3 text-[13px] text-muted-foreground">Доход канала на 1000 просмотров, $. Используется в «Анализе канала». Это только оценка.</p>
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_90px_90px_36px] gap-2 px-1 mono-label"><span>Ниша</span><span>Мин, $</span><span>Макс, $</span><span /></div>
                {form.rpm.map((r, i) => (
                  <div key={i} className="grid grid-cols-[1fr_90px_90px_36px] gap-2">
                    <Input value={r.niche} onChange={(e) => set("rpm", form.rpm.map((x, j) => (j === i ? { ...x, niche: e.target.value } : x)))} />
                    <Input type="number" step="0.05" min={0} value={r.min} onChange={(e) => set("rpm", form.rpm.map((x, j) => (j === i ? { ...x, min: +e.target.value } : x)))} />
                    <Input type="number" step="0.05" min={0} value={r.max} onChange={(e) => set("rpm", form.rpm.map((x, j) => (j === i ? { ...x, max: +e.target.value } : x)))} />
                    <button aria-label="Удалить" disabled={i === 0} onClick={() => set("rpm", form.rpm.filter((_, j) => j !== i))}
                      className="grid place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-accent disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            </Card>

            <Card id="budget">
              <SectionTitle right={<Button size="sm" variant="ghost" onClick={() => set("budget", { ...form.budget, prices: [...form.budget.prices, { match: "model-name", input: 0, output: 0, image: 0 }] })}><Plus className="h-3.5 w-3.5" />Цена</Button>}>
                Бюджет
              </SectionTitle>
              <UnpricedOperations />
              <p className="mb-3 text-[13px] text-muted-foreground">Месячный лимит на учитываемые платные API. Расход считается по токенам × цены ниже — это оценка, точная сумма в кабинете провайдера. 0 — без лимита. Неизвестная цена не равна нулю: на Панели показывается известная часть и неполнота итога. Старый журнал оценивается по текущим тарифам; тариф каждой прошлой операции в нём не закреплён. Для новых успешно учтённых вызовов текстов, картинок, озвучки и аудиораспознавания сохраняются провайдер, модель, объём и доступный до отправки тариф; смена настроек их не переоценивает. Неизвестный тариф сохраняется неизвестным. Сравнение лимита выполняется без округления отображаемых сумм. Это не резервирование будущих расходов и не гарантия общего лимита параллельных запросов. В режиме «Блокировать вызовы» перед каждой отправкой, после очереди и перед сетевым повтором проверяется тариф каждой включённой задачи: неизвестный тариф, неполный учёт и повреждённый журнал останавливают отправку без перехода к резервной модели. Это действует и при лимите 0 (он отключает только месячный порог). Каталог автоматически ради проверки не загружается; обновите его отдельно. Режим «Только предупреждать» пока не запрашивает отдельного согласия на неизвестную цену — этот этап ещё не реализован. В .73 подготовлен только серверный протокол одноразового согласия. Он ещё не подключён к генерации и окну подтверждения; открытие этой страницы не выдаёт разрешений.</p>
              <div className="mb-4 grid gap-4 md:grid-cols-3">
                <label><Label>Лимит в месяц, $</Label>
                  <Input type="number" min={0} step="1" value={form.budget.monthlyUsd} onChange={(e) => set("budget", { ...form.budget, monthlyUsd: Math.max(0, +e.target.value) })} />
                </label>
                <label><Label>Предупредить при, %</Label>
                  <Input type="number" min={10} max={99} step="1" value={form.budget.warnPct} onChange={(e) => set("budget", { ...form.budget, warnPct: Math.min(99, Math.max(10, +e.target.value)) })} />
                </label>
                <div><Label>При превышении</Label>
                  <div className="flex flex-wrap gap-2">
                    {([["warn", "Только предупреждать"], ["block", "Блокировать вызовы"]] as const).map(([v, l]) => (
                      <Chip key={v} active={form.budget.mode === v} onClick={() => set("budget", { ...form.budget, mode: v })}>{l}</Chip>
                    ))}
                  </div>
                </div>
              </div>
              <details>
                <summary className="cursor-pointer text-[13px] text-muted-foreground hover:text-foreground">Цены моделей ($ за 1 млн токенов / за картинку) — {form.budget.prices.length} строк</summary>
                <p className="my-2 text-xs text-muted-foreground">Строка подходит, если её текст входит в имя модели. Проверяются сверху вниз — более точные (flash-lite) ставьте выше общих (flash).</p>
                <div className="space-y-2 overflow-x-auto">
                  <div className="grid min-w-[480px] grid-cols-[1fr_80px_80px_80px_36px] gap-2 px-1 mono-label"><span>Модель содержит</span><span>Вход</span><span>Выход</span><span>Картинка</span><span /></div>
                  {form.budget.prices.map((r, i) => {
                    const upd = (patch: Partial<typeof r>) => set("budget", { ...form.budget, prices: form.budget.prices.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                    return (
                      <div key={i} className="grid min-w-[480px] grid-cols-[1fr_80px_80px_80px_36px] gap-2">
                        <Input className="font-mono text-[13px]" value={r.match} onChange={(e) => upd({ match: e.target.value })} />
                        <Input type="number" step="0.01" min={0} value={r.input} onChange={(e) => upd({ input: +e.target.value })} aria-label="Цена входа" />
                        <Input type="number" step="0.01" min={0} value={r.output} onChange={(e) => upd({ output: +e.target.value })} aria-label="Цена выхода" />
                        <Input type="number" step="0.01" min={0} value={r.image} onChange={(e) => upd({ image: +e.target.value })} aria-label="Цена картинки" />
                        <button aria-label="Удалить цену" onClick={() => set("budget", { ...form.budget, prices: form.budget.prices.filter((_, j) => j !== i) })}
                          className="grid place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-accent"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    );
                  })}
                </div>
              </details>
            </Card>

            <ResearchSettingsCard v={form.research} onChange={(r) => set("research", r)} />

            <DataCard />
            <MaintenanceCard />

            {save.error ? <ErrorAlert error={save.error} /> : null}
            <div className="sticky bottom-0 z-10 flex justify-end border-t bg-background py-3">
              <Button size="lg" onClick={submit} disabled={!dirty && !saved} loading={save.isPending} loadingText="Сохраняем…">
                {saved ? <><Check className="h-4 w-4" />Сохранено</> : "Сохранить настройки"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Экспорт / импорт всех данных одним ZIP */
function DataCard() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const imp = async (f?: File) => {
    if (!f) return;
    if (!confirm("Завершите все задания. Сначала сохраните копию текущих данных. Импорт перезапишет совпадающие файлы, настройки, OAuth-подключение и промпты; остальные файлы останутся. После импорта перезапустите TubeStudio. Продолжить?")) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/data/import", { method: "POST", headers: { "content-type": "application/zip" }, body: f, credentials: "same-origin" });
      const j = await r.json();
      if (!j.ok) setMsg({ ok: false, text: j.error.message });
      else {
        const skipped: string[] = j.data.skipped ?? [];
        const warnings: string[] = j.data.warnings ?? [];
        setMsg({ ok: !skipped.length && !warnings.length, text: `Импортировано файлов: ${j.data.imported}. Перезапустите TubeStudio и проверьте данные.${skipped.length ? ` Пропущено: ${skipped.length} (${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? ", …" : ""}).` : ""}${warnings.length ? " " + warnings.join(" ") : ""}` });
      }
    } catch { setMsg({ ok: false, text: "Не удалось загрузить архив" }); } finally { setBusy(false); }
  };
  return (
    <Card className="p-5">
      <SectionTitle icon={<Database className="h-4 w-4" />}>Данные</SectionTitle>
      <p className="mb-3 text-sm text-muted-foreground">Все текущие разделы данных, история аудиораскадровок, конвейеры, файлы и тексты промптов — одним ZIP. Завершите задания перед экспортом и импортом. .env не включён, но архив может содержать OAuth-токены и приватные тексты: не публикуйте его.</p>
      <p className="mb-3 text-xs text-muted-foreground">До 512 МиБ ZIP / 1 ГиБ распакованных данных / 20 000 файлов. Для больших объёмов сохраните DATA_DIR, папку промптов и .env файловой копией при остановленном сервере. Подробнее: BACKUP-README.md.</p>
      <div className="flex flex-wrap gap-2">
        <a href="/api/data/export" className="inline-flex h-10 items-center gap-2 rounded-md border border-primary/50 px-4 text-sm text-primary hover:bg-primary/10"><Download className="h-4 w-4" />Экспорт всех данных</a>
        <label className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-md px-4 text-sm text-muted-foreground hover:bg-muted hover:text-foreground ${busy ? "pointer-events-none opacity-50" : ""}`}><Upload className="h-4 w-4" />{busy ? "Импортируем…" : "Импорт из ZIP"}<input type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => { imp(e.target.files?.[0]); e.target.value = ""; }} /></label>
      </div>
      {msg && <p className={`mt-2 min-w-0 max-w-full text-sm [overflow-wrap:anywhere] ${msg.ok ? "text-emerald-400" : "text-accent"}`}>{msg.text}</p>}
    </Card>
  );
}

function AmDatalists() {
  const q = useQuery({ queryKey: ["am-models"], queryFn: () => api<{ models: { id: string; kind: string }[] }>("/anymodel/models"), staleTime: 10 * 60_000, retry: false });
  const ms = q.data?.models ?? [];
  return (
    <>
      <datalist id="am-text">{ms.filter((m) => m.kind === "text").map((m) => <option key={m.id} value={m.id} />)}</datalist>
      <datalist id="am-image">{ms.filter((m) => m.kind === "image").map((m) => <option key={m.id} value={m.id} />)}</datalist>
    </>
  );
}


type RuntimeStatus = { jobs: number; queues: Record<string, { active: number; waiting: number; limit: number }>; cache: { files: number; bytes: number }; logs: { file: string; maxMiB: number; backups: number } };
function MaintenanceCard() {
  const qcl = useQueryClient();
  const q = useQuery({ queryKey: ["runtime"], queryFn: () => api<RuntimeStatus>("/system/runtime"), refetchInterval: 5000 });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState<Error | null>(null);
  const clear = async () => {
    if (!confirm("Очистить кеш? Проекты, история, файлы, ключи и учёт квоты сохранятся. Повторные запросы могут расходовать квоту YouTube и баланс провайдеров. Продолжить?")) return;
    setBusy(true); setError(null); setMessage("");
    try { const r = await api<{ message: string; removed: { files: number } }>("/system/cache/clear", { method: "POST" }); setMessage(`Удалено файлов кеша: ${r.removed.files}. ${r.message}`); await qcl.invalidateQueries({ queryKey: ["runtime"] }); }
    catch (e) { setError(e as Error); } finally { setBusy(false); }
  };
  return <Card className="p-5" data-testid="maintenance">
    <SectionTitle icon={<Database className="h-4 w-4" />}>Обслуживание и очередь</SectionTitle>
    <p className="mb-3 text-[13px] text-muted-foreground">Общая очередь на все задания: 2 запроса текста/распознавания, 3 изображения и 1 запрос озвучки одновременно. Отмена прерывает ожидание, сетевые запросы и FFmpeg; уже принятый провайдером запрос может быть оплачен.</p>
    {q.error ? <ErrorAlert error={q.error} onRetry={() => q.refetch()} /> : null}
    {q.data ? <div className="mb-4 space-y-2 text-[13px]">
      <p>Активных заданий: {q.data.jobs}</p>
      {Object.entries(q.data.queues).map(([kind, v]) => <p key={kind}>{({ llm: "Текст / распознавание", image: "Изображения", tts: "Озвучка" } as Record<string, string>)[kind] ?? kind}: {v.active}/{v.limit} · в очереди: {v.waiting}</p>)}
      <p>Кеш: {q.data.cache.files} файлов · {(q.data.cache.bytes / 1024 ** 2).toFixed(2)} МиБ</p>
      <p className="break-words text-muted-foreground">Журнал: <code>{q.data.logs.file}</code> · до {q.data.logs.maxMiB} МиБ на файл и {q.data.logs.backups} предыдущих файлов. Ключи, OAuth-токены и тексты заданий в журнал не записываются.</p>
    </div> : null}
    <Button variant="outline" onClick={clear} loading={busy} loadingText="Очищаем…" disabled={!q.data}><Trash2 className="h-4 w-4" />Очистить кеш</Button>
    {message ? <p role="status" className="mt-3 text-sm">{message}</p> : null}
    {error ? <ErrorAlert error={error} /> : null}
  </Card>;
}
