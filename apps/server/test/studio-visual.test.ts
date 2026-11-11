// Выпуск 2: «Визуал через G-Labs». Поддельный G-Labs: квота не тратится; проверяются нарезка, промпты со стилевым
// ключом дословно, картинки и клипы, продолжение после перезапуска и квоты, остановка, переделка, выгрузка файлов.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ts-visual-"));
process.env.DATA_DIR = dir;
const { config } = await import("../src/config.js");
config.dataDir = dir;
config.keys.glabs = "gl-key";
const G = await import("../src/services/studio/glabs.js");
const S = await import("../src/services/studio/scenes.js");
const V = await import("../src/services/studio/visual.js");
const L = await import("../src/services/studio/lumean.js");
const ch = await import("../src/services/studio/channels.js");
const projects = await import("../src/services/projects.js");
const { resolveVisualStyle } = await import("../src/services/visualStyles.js");
const VP = await import("../src/services/studio/visualPrompts.js");
const { runTask } = await import("../src/lib/taskContext.js");
const { priceConsents } = await import("../src/services/priceConsent.js");
/** Платные промпты идут только после окна цены: здесь «Подтвердить» нажимается автоматически, тексты окон собираются. */
const approved = <T>(fn: () => Promise<T>, windows: string[] = []) => { const owner = crypto.randomUUID(); return runTask({ launch: { owner, requestId: crypto.randomUUID(), route: "/api/studio/visual/projects/x/prompts" }, onPriceConsent: (c) => { windows.push(c.message); queueMicrotask(() => priceConsents.decide(owner, c.id, c.scopeHash, "approve")); } }, fn); };
G.GLABS_POLL.ms = 2;
after(async () => { G.setGlabsFetcher(null); L.setLumeanFetcher(null); VP.setPromptAi(null); await fs.rm(dir, { recursive: true, force: true }); });

const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(300, 7)]);
const MP4 = Buffer.concat([Buffer.from("000000206674797069736f6d", "hex"), Buffer.alloc(300, 9)]);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
type Fate = "ok" | "quota" | "lost" | "policy" | "slow" | "path";
type Task = { id: string; kind: "image" | "video"; body: any; polls: number; fate: Fate };
type World = { calls: { method: string; path: string; body?: any }[]; tasks: Map<string, Task>; fates: Fate[]; stops: string[]; seq: number; online: boolean; plan: boolean; key: string; chars: Map<string, any>; onSubmit?: () => void };
let w: World;
function glabs(world: World) {
  return async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (!world.online) throw new TypeError("fetch failed");
    world.calls.push({ method, path: u.pathname, body });
    if (u.pathname === "/api/health") return json(200, { status: "ok", server: "G-Labs Webhook", uptime: 9, tasks_pending: 0, tasks_running: 0 });
    if (u.pathname.startsWith("/api/files/")) return new Response(u.pathname.endsWith(".mp4") ? MP4 : PNG, { status: 200 });
    if ((init?.headers as Record<string, string>)?.["X-API-Key"] !== world.key) return json(401, { error: "Invalid or missing API key" });
    if (!world.plan) return json(403, { error: "Webhook requires MAX plan" });
    if (u.pathname === "/api/tasks") return json(200, { tasks: [] });
    if (method === "POST" && (u.pathname === "/api/image/generate" || u.pathname === "/api/video/generate")) {
      const id = `task-${++world.seq}`;
      world.tasks.set(id, { id, kind: u.pathname.includes("video") ? "video" : "image", body, polls: 0, fate: world.fates.shift() ?? "ok" });
      world.onSubmit?.();
      return json(202, { task_id: id, status: "pending" });
    }
    const st = /^\/api\/status\/(.+)$/.exec(u.pathname);
    if (st) {
      const t = world.tasks.get(decodeURIComponent(st[1]));
      if (!t) return json(404, { error: "Task not found" });
      t.polls++;
      if (t.fate === "lost") { world.tasks.delete(t.id); return json(404, { error: "Task not found" }); }
      if (t.fate === "quota") return json(200, { task_id: t.id, status: "failed", error_code: 429, error: "Quota exceeded", error_detail: "RESOURCE_EXHAUSTED" });
      if (t.fate === "policy") return json(200, { task_id: t.id, status: "failed", error_code: 400, error: "Prompt blocked by policy" });
      if (t.fate === "path" && t.body.reference_images?.some((r: any) => r.path)) return json(200, { task_id: t.id, status: "failed", error_code: 0, error: "Reference path not found" });
      if (t.fate === "slow" || t.polls < 2) return json(200, { task_id: t.id, status: "running" });
      return json(200, { task_id: t.id, status: "completed", results: [`http://192.168.0.5:8765/api/files/${t.id}.${t.kind === "video" ? "mp4" : "png"}`], final_prompt: t.body.prompt, prompt_rewrites: 0 });
    }
    const sp = /^\/api\/stop\/(.+)$/.exec(u.pathname);
    if (sp && method === "POST") { world.stops.push(decodeURIComponent(sp[1])); return json(200, { ok: true }); }
    if (u.pathname === "/api/characters" && method === "POST") {
      if (world.chars.has(body.name)) return json(409, { error: "Name already taken", error_code: "NAME_TAKEN" });
      world.chars.set(body.name, body); return json(201, { name: body.name, character_id: "c1" });
    }
    const pc = /^\/api\/characters\/(.+)$/.exec(u.pathname);
    if (pc && method === "PATCH") { world.chars.set(decodeURIComponent(pc[1]), body); return json(200, { ok: true }); }
    return json(404, { error: "Not found" });
  };
}
const ctx = { progress: () => {}, partial: () => {}, signal: new AbortController().signal };
const submits = (kind: "image" | "video") => w.calls.filter((c) => c.method === "POST" && c.path === `/api/${kind}/generate`);
const SCRIPT = [
  "## Hook",
  "In the winter of 1816 the snow never stopped falling on the mountain villages. Farmers watched their fields turn white in June. Nobody knew that a volcano on the other side of the world had caused it.",
  "Prices for bread doubled in a single month. Families sold their horses because there was no hay. The old king ordered the granaries to be opened, but the stores lasted only three weeks.",
  "Then a young clerk found a ledger hidden in the cellar of the palace. It listed every sack of grain the nobles had secretly kept for themselves. What he did next changed the fate of the whole kingdom.",
].join("\n\n");
let channelId = "", projectId = "", anchor = "";
const board = async () => (await V.visualState(projectId)).board!;
beforeEach(() => { w = { calls: [], tasks: new Map(), fates: [], stops: [], seq: 0, online: true, plan: true, key: "gl-key", chars: new Map() }; G.setGlabsFetcher(glabs(w)); });

test("нарезка: «Ритм» держит сцены до 8 с, «Предложение» — по фразе; субтитры дают время озвучки", () => {
  const rhythm = S.cutScenes(L.voiceText(SCRIPT), { language: "en", mode: "rhythm", maxSec: 8 });
  assert.ok(rhythm.length >= 6, `сцен ${rhythm.length}`);
  for (const s of rhythm) assert.ok(s.words / S.wordsPerSecond("en") <= 8.5, `сцена длиннее 8 с: ${s.text}`);
  assert.ok(!rhythm.some((s) => s.text.includes("##")), "заголовки не попадают в озвучку");
  const sentence = S.cutScenes(L.voiceText(SCRIPT), { language: "en", mode: "sentence", maxSec: 8 });
  assert.ok(sentence.length >= rhythm.length - 2);
  const cues = S.parseSubtitles("1\n00:00:00,000 --> 00:00:04,000\nIn the winter of 1816 the snow never stopped\n\n2\n00:00:04,000 --> 00:00:09,500\nfalling on the mountain villages.\n");
  assert.equal(cues.length, 2);
  assert.equal(cues[1].end, 9.5);
});

test("G-Labs: понятные ошибки связи, ключа и тарифа", async () => {
  w.online = false;
  let r = await G.checkGlabs();
  assert.equal(r.ok, false); assert.equal(r.code, "GLABS_OFFLINE"); assert.match(r.message, /Webhook/);
  w.online = true; w.key = "other";
  r = await G.checkGlabs();
  assert.equal(r.code, "KEY_MISSING"); assert.match(r.message, /Ключ G-Labs не подходит/);
  w.key = "gl-key"; w.plan = false;
  r = await G.checkGlabs();
  assert.equal(r.code, "GLABS_PLAN"); assert.match(r.message, /MAX/);
  w.plan = true;
  r = await G.checkGlabs();
  assert.equal(r.ok, true); assert.equal(r.local, true);
  assert.equal(G.failKind({ error_code: 429, error: "x" }), "quota");
  assert.equal(G.failKind({ error_code: 0, error: "No active accounts available" }), "accounts");
  assert.equal(G.failKind({ error_code: 499, error: "STOPPED_BY_CLIENT" }), "stopped");
  assert.equal(G.failKind({ error_code: 400, error: "blocked by policy" }), "policy");
  assert.equal(G.failKind({ error: "Reference path not found: C:/x.png" }), "path");
});

test("сцены и бесплатные промпты: стилевой ключ стоит дословно в каждом промпте", async () => {
  const c = await ch.createChannel({ name: "The Frost Ledger", language: "en" });
  channelId = c.id;
  await ch.updateChannel(c.id, { visual: { styleId: "builtin-obs-storybook-pencil", cast: [{ name: "OldKing", kind: "character", description: "Elderly king with a white beard, crimson cloak and a tarnished crown" }] } });
  anchor = (await resolveVisualStyle("builtin-obs-storybook-pencil"))!.anchor.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().replace(/[.;,\s]+$/, "");
  const p = await projects.createProject({ title: "1816", channelId, artifact: { kind: "script", title: "Сценарий", data: { script: SCRIPT } } as any });
  projectId = p.id;
  const b = await V.buildScenes(projectId, { channelId });
  assert.ok(b.rows.length >= 6);
  assert.equal(b.timing, "estimate");
  assert.equal(b.rows[0].start, 0);
  assert.ok(b.rows.every((r, k) => k === 0 || r.start >= b.rows[k - 1].end - 0.01), "сцены идут по порядку без наложений");
  const res = await V.writePrompts(projectId, { channelId, free: true });
  assert.equal(res.written, b.rows.length);
  const after = await board();
  for (const r of after.rows) {
    assert.ok(r.concept.length > 20);
    assert.ok(r.image.includes(anchor), `нет стилевого ключа в сцене ${r.n}`);
    assert.ok(!/[\r\n]/.test(r.image));
    if (r.animate) assert.match(r.video, /No dialogue, no narration, no music\.$/);
  }
  assert.ok(after.rows[0].animate && after.rows[1].animate, "хук оживляется");
  const txt = await fs.readFile(path.join(dir, "files", projectId, "visual", "prompts_images.txt"), "utf8");
  assert.equal(txt.trim().split("\n").length, after.rows.length, "1 строка = 1 промпт, без заголовка");
});

test("эталон персонажа: загрузка, @имя в описании → эталон уходит в G-Labs", async () => {
  await assert.rejects(V.saveCastImage(channelId, "OldKing", "data:image/png;base64," + Buffer.from("not an image at all, just text that is long enough to pass the size check....................................").toString("base64")), /не похож/);
  const saved = await V.saveCastImage(channelId, "oldking", "data:image/png;base64," + PNG.toString("base64"));
  const item = saved.visual.cast[0];
  assert.equal(item.image, `_cast/${channelId}/OldKing.png`);
  await fs.access(path.join(dir, "files", "_cast", channelId, "OldKing.png"));
  // Сохранение формы с пустым путём не стирает эталон.
  const again = await ch.updateChannel(channelId, { visual: { cast: [{ name: "OldKing", kind: "character", description: "Elderly king with a white beard", image: "" }] } });
  assert.equal(again.visual.cast[0].image, item.image);
  const e = await V.editScene(projectId, 1, { concept: "@oldking lifts a lantern in the frozen throne hall, @Stranger behind him" });
  const r1 = e.rows[0];
  assert.match(r1.concept, /^@OldKing lifts/);
  assert.ok(!r1.concept.includes("@Stranger"), "неизвестное имя теряет @");
  assert.deepEqual(r1.cast, ["OldKing"]);
  const sync = await V.syncCast(channelId);
  assert.deepEqual(sync.results.map((x) => x.result), ["created"]);
  assert.equal((await V.syncCast(channelId)).results[0].result, "skipped", "без изменений второй раз не отправляется");
});

test("картинки: отправка, опрос, скачивание; потерянное задание отправляется заново; ссылка G-Labs переписывается", async () => {
  const total = (await board()).rows.length;
  w.fates = ["lost"];
  const sum = await V.runRender(projectId, { channelId, what: "images" }, ctx);
  assert.equal(sum.done, total); assert.equal(sum.failed, 0); assert.equal(sum.stop, null);
  assert.equal(submits("image").length, total + 1, "одна повторная отправка после 404");
  const first = submits("image").find((c) => c.body.prompt.startsWith("@OldKing"))!;
  assert.equal(first.body.model, "nano_banana_2"); assert.equal(first.body.aspect_ratio, "16:9");
  assert.equal(first.body.use_characters, false);
  assert.match(first.body.reference_images[0].path, /OldKing\.png$/);
  assert.ok(w.calls.some((c) => c.path.startsWith("/api/files/task-")), "файл скачан по адресу из настроек, а не по IP из ответа");
  const b = await board();
  for (const r of b.rows) { assert.equal(r.picture.state, "done"); assert.equal(r.picture.file, `visual/${String(r.n).padStart(3, "0")}.png`); }
  await fs.access(path.join(dir, "files", projectId, "visual", "001.png"));
  // Повторный запуск ничего не отправляет: всё готово.
  w.calls = [];
  const again = await V.runRender(projectId, { channelId, what: "images" }, ctx);
  assert.equal(again.total, 0); assert.equal(submits("image").length, 0);
});

test("переделка с причиной меняет одну вещь в промпте; старый файл уходит в visual/old", async () => {
  const e = await V.editScene(projectId, 2, { picture: { verdict: "redo", reason: "artifacts" } });
  assert.match(e.rows[1].concept, /five fingers/);
  assert.match(e.rows[1].image, /five fingers/);
  const sum = await V.runRender(projectId, { channelId, what: "images" }, ctx);
  assert.equal(sum.total, 1); assert.equal(submits("image").length, 1);
  const r2 = (await board()).rows[1];
  assert.equal(r2.picture.verdict, undefined); assert.equal(r2.picture.old?.length, 1);
  await fs.access(path.join(dir, "files", projectId, ...r2.picture.old![0].split("/")));
  await V.editScene(projectId, 1, { picture: { verdict: "accepted" } });
  assert.equal((await board()).rows[0].picture.verdict, "accepted");
});

test("клипы: кадр сцены — первый кадр анимации, файл 001_anim.mp4", async () => {
  const b0 = await board();
  const animated = b0.rows.filter((r) => r.animate).length;
  const sum = await V.runRender(projectId, { channelId, what: "clips" }, ctx);
  assert.equal(sum.done, animated);
  const v = submits("video")[0].body;
  assert.equal(v.mode, "start_image"); assert.equal(v.model, "veo_31_fast"); assert.equal(v.video_length, 8);
  assert.deepEqual(v.resolution, ["1080p"]);
  assert.match(v.reference_images[0].path, /visual[\\/]001\.png$/);
  assert.match(v.prompt, /No dialogue, no narration, no music\.$/);
  await fs.access(path.join(dir, "files", projectId, "visual", "001_anim.mp4"));
  const json = JSON.parse(await fs.readFile(path.join(dir, "files", projectId, "visual", "scenes.json"), "utf8"));
  assert.equal(json.schema, 1); assert.equal(json.scenes[0].clip, "visual/001_anim.mp4"); assert.equal(json.scenes[0].image, "visual/001.png");
  const motion = await V.exportBoard(projectId, "motion.txt");
  assert.equal(motion.body.trim().split("\n").length, animated);
});

test("квота: остановка с понятным сообщением, «Продолжить» не делает готовое заново", async () => {
  const b = await V.buildScenes(projectId, { channelId, replace: true });
  assert.ok((await fs.readdir(path.join(dir, "files", projectId))).some((f) => f.startsWith("visual-old-")), "старые файлы сохранены");
  assert.ok(b.rows.every((r) => r.picture.state === "none"));
  assert.ok(b.rows[0].concept, "описания сохранились при той же нарезке");
  w.fates = ["ok", "ok", "quota", "ok"];
  const s1 = await V.runRender(projectId, { channelId, what: "images" }, ctx);
  assert.equal(s1.stop, "quota"); assert.equal(s1.done, 3);
  assert.match(s1.message, /Квота аккаунтов G-Labs/); assert.match(s1.message, /Продолжить/);
  assert.ok(s1.waiting >= 1);
  const sent = submits("image").length;
  assert.equal(sent, 4, "после квоты новые задания не отправляются");
  w.calls = [];
  const s2 = await V.runRender(projectId, { channelId, what: "images" }, ctx);
  assert.equal(s2.stop, null);
  assert.equal(submits("image").length, b.rows.length - 3, "готовые три не отправляются снова");
  await assert.rejects(V.buildScenes(projectId, { channelId }), (e: any) => e.details?.needReplace === true && /visual-old/.test(e.message));
});

test("продолжение после перезапуска TubeStudio: сохранённое задание забирается без новой отправки", async () => {
  const pr = await projects.getProject(projectId);
  const art = pr.artifacts.find((a) => a.kind === "storyboard")!;
  w.tasks.set("task-saved", { id: "task-saved", kind: "image", body: { prompt: "x" }, polls: 5, fate: "ok" });
  await projects.updateArtifactData(projectId, art.id, (d: any) => { d.rows[0].picture = { state: "queued", taskId: "task-saved", base: "http://127.0.0.1:8765", attempts: 1, resubmits: 0, verdict: "redo" }; return d; });
  const s = await V.runRender(projectId, { channelId, what: "images", scenes: [1] }, ctx);
  assert.equal(s.done, 1); assert.equal(submits("image").length, 0);
  assert.ok(w.calls.some((c) => c.path === "/api/status/task-saved"));
});

test("остановка: задания в G-Labs тоже останавливаются; запрет политики — понятная причина", async () => {
  await V.editScene(projectId, 3, { picture: { verdict: "redo", reason: "framing" } });
  await V.editScene(projectId, 4, { picture: { verdict: "redo", reason: "line" } });
  w.fates = ["slow", "slow"];
  const ac = new AbortController();
  w.onSubmit = () => { if (w.tasks.size >= 2) setTimeout(() => ac.abort(), 20); };
  await assert.rejects(runTask({ signal: ac.signal }, () => V.runRender(projectId, { channelId, what: "images" }, ctx)), /отменена/);
  assert.equal(w.stops.length, 2);
  const b = await board();
  assert.equal(b.rows[2].picture.state, "waiting"); assert.equal(b.rows[2].picture.error, "Остановлено");
  w.onSubmit = undefined;
  w.fates = ["policy", "ok"];
  const s = await V.runRender(projectId, { channelId, what: "images" }, ctx);
  assert.equal(s.failed, 1); assert.equal(s.done, 1);
  assert.match((await board()).rows.find((r) => r.picture.state === "failed")!.picture.error!, /отклонил промпт/);
});

test("нет связи с G-Labs: работа не начинается, сообщение подсказывает, что делать", async () => {
  w.online = false;
  await assert.rejects(V.runRender(projectId, { channelId, what: "images" }, ctx), (e: any) => e.code === "GLABS_OFFLINE" && /Start/.test(e.message));
});

test("«Мой шаблон» Lumean: берётся готовый шаблон без создания нового; список и проверка по номеру", async () => {
  config.keys.lumean = "lm-key";
  const calls: string[] = [];
  L.setLumeanFetcher(async (url, init) => {
    const u = new URL(url); const p = u.pathname.replace("/api/public", "");
    calls.push(`${init?.method ?? "GET"} ${p}${u.search}`);
    if (p === "/templates/browse") return json(200, { success: true, data: { items: [{ type: "folder", id: 7, name: "Голоса", templates_count: 2 }, { type: "template", id: "tpl-david", name: "David — British", service_key: "elevenlabs", config: { tts_settings: { voice_id: "KcYifkkXnm0uVkvvr7rD", mode: "mode_v1" } } }], current_page: 1, last_page: 1, total: 2, current_folder: null, breadcrumbs: [] } });
    if (p === "/templates" && u.searchParams.get("search")) return json(200, { success: true, data: { items: [{ id: "tpl-david", name: "David — British", service_key: "elevenlabs" }], current_page: 1, last_page: 2, total: 31 } });
    if (p === "/templates/tpl-david") return json(200, { success: true, data: { id: "tpl-david", name: "David — British", service_key: "elevenlabs", config: { tts_settings: { voice_id: "KcYifkkXnm0uVkvvr7rD" } } } });
    if (p.startsWith("/templates/")) return json(404, { success: false, message: "Not found" });
    return json(500, { success: false });
  });
  await ch.updateChannel(channelId, { voice: { provider: "lumean", templateSource: "mine", ownTemplateId: "" } });
  await assert.rejects(L.ensureTemplate(channelId), /Мой шаблон/);
  const list = await L.listTemplates({});
  assert.deepEqual(list.items.map((x) => x.type), ["folder", "template"]);
  assert.equal(list.items[1].voiceId, "KcYifkkXnm0uVkvvr7rD");
  const found = await L.listTemplates({ search: "David" });
  assert.equal(found.hasMore, true); assert.equal(found.items[0].id, "tpl-david");
  assert.equal((await L.getTemplate("tpl-david")).name, "David — British");
  await assert.rejects(L.getTemplate("../x"), /неверно/);
  await ch.updateChannel(channelId, { voice: { ownTemplateId: "tpl-david", ownTemplateName: "David — British" } });
  assert.equal(await L.ensureTemplate(channelId), "tpl-david");
  assert.ok(!calls.some((c) => c.startsWith("POST /templates")), "новый шаблон не создаётся");
  config.keys.lumean = "";
});

test("промпты моделью: @имена, ключевые сцены оживляются, пропущенная сцена получает черновик", async () => {
  const p = await projects.createProject({ title: "1816 — модель", channelId, artifact: { kind: "script", title: "Сценарий", data: { script: SCRIPT } } as any });
  const b = await V.buildScenes(p.id, { channelId });
  const seen: string[] = [];
  VP.setPromptAi(async ({ user, system }) => {
    seen.push(user);
    assert.match(system, /code appends the channel's style anchor verbatim/);
    const scenes = JSON.parse(user.slice(user.indexOf("SCENES:") + 8)) as { n: number }[];
    return { model: "fake-director", data: { scenes: scenes.filter((s) => s.n !== 3).map((s) => ({ n: s.n, concept: s.n === 1 ? "@oldking stares at the snow falling through a broken palace window, frost on the glass" : `Scene ${s.n}: a frozen village street at dawn, a farmer kneels by a dead field`, motion: "Slow push-in while snow drifts past", key: s.n === 5 })) } };
  });
  const r = await approved(() => V.writePrompts(p.id, { channelId, free: false, note: "more snow" }));
  assert.equal(r.model, "fake-director"); assert.equal(r.free, false);
  assert.match(r.notes.join(" "), /Сцена 3/);
  assert.match(seen[0], /FIX REQUEST FROM THE EDITOR: more snow/);
  assert.match(seen[0], /@OldKing \(character\)/);
  const st = (await V.visualState(p.id)).board!;
  assert.deepEqual(st.rows[0].cast, ["OldKing"]);
  assert.equal(st.rows[2].draft, true);
  assert.equal(st.rows[4].key, true); assert.equal(st.rows[4].animate, true);
  assert.equal(st.rows[3].animate, false, "обычная сцена в режиме «хук и ключевые» не оживляется");
  assert.ok(st.rows.every((x) => x.image.includes(anchor)));
  assert.equal(st.prompts?.model, "fake-director");
  assert.ok(b.rows.length === st.rows.length);
});

test("промпты моделью: готовая часть сохраняется при сбое, продолжение дописывает только черновики", async () => {
  const p = await projects.createProject({ title: "1816 — продолжение", channelId, artifact: { kind: "script", title: "Сценарий", data: { script: Array(8).fill(SCRIPT).join("\n\n") } } as any });
  const built = await V.buildScenes(p.id, { channelId });
  assert.ok(built.rows.length > 12, "нужно больше одной части");
  await V.writePrompts(p.id, { channelId, free: true });
  const answer = (user: string, tag: string) => ({ model: "fake-director", data: { scenes: (JSON.parse(user.slice(user.indexOf("SCENES:") + 8)) as { n: number }[]).map((s) => ({ n: s.n, concept: `${tag} scene ${s.n}: a frozen village street at dawn`, motion: "Slow push-in" })) } });
  let calls = 0;
  VP.setPromptAi(async ({ user }) => { if (++calls === 2) throw new Error("пустой ответ"); return answer(user, "first"); });
  await assert.rejects(approved(() => V.writePrompts(p.id, { channelId, free: false })), /пустой ответ/);
  let st = (await V.visualState(p.id)).board!;
  assert.ok(st.rows.slice(0, 12).every((r) => !r.draft && r.concept.startsWith("first")), "первая часть сохранена");
  assert.ok(st.rows.slice(12).every((r) => r.draft), "остальное осталось черновиком");
  const asked: number[] = [];
  VP.setPromptAi(async ({ user }) => { asked.push(...(JSON.parse(user.slice(user.indexOf("SCENES:") + 8)) as { n: number }[]).map((s) => s.n)); return answer(user, "second"); });
  await approved(() => V.writePrompts(p.id, { channelId, free: false, onlyEmpty: true }));
  assert.ok(asked.length > 0 && asked.every((n) => n > 12), "готовая часть не оплачивается второй раз");
  st = (await V.visualState(p.id)).board!;
  assert.ok(st.rows.every((r) => !r.draft));
  assert.ok(st.rows[0].concept.startsWith("first"));
  assert.ok(st.rows[12].concept.startsWith("second"));
});

// ---------- окно цены на весь запуск платных промптов ----------
const { updateSettings } = await import("../src/services/settings.js");
const PC = await import("../src/services/studio/visualPromptsConsent.js");
const fakeAnswer = (user: string) => ({ model: "fake-director", data: { scenes: (JSON.parse(user.slice(user.indexOf("SCENES:") + 8)) as { n: number }[]).map((s) => ({ n: s.n, concept: `consent scene ${s.n}: a frozen village street at dawn`, motion: "slow push in", key: false })) } });
async function longProject(title: string) {
  const p = await projects.createProject({ title, channelId, artifact: { kind: "script", title: "Сценарий", data: { script: Array(8).fill(SCRIPT).join("\n\n") } } as any });
  const b = await V.buildScenes(p.id, { channelId });
  assert.ok(b.rows.length > 12, "нужно больше одной пачки");
  return { p, rows: b.rows.length };
}

test("окно цены: без запуска из интерфейса платные промпты не отправляются", async () => {
  const { p } = await longProject("Окно — без запуска");
  let calls = 0; VP.setPromptAi(async ({ user }) => { calls++; return fakeAnswer(user); });
  await assert.rejects(V.writePrompts(p.id, { channelId, free: false }), (e: any) => e.code === "BUDGET_CONSENT_REQUIRED");
  assert.equal(calls, 0);
});

test("окно цены: отказ — ни одного запроса, раскадровка не меняется", async () => {
  const { p } = await longProject("Окно — отказ");
  const before = JSON.stringify((await V.visualState(p.id)).board!.rows);
  let calls = 0; VP.setPromptAi(async ({ user }) => { calls++; return fakeAnswer(user); });
  const owner = crypto.randomUUID();
  await assert.rejects(runTask({ launch: { owner, requestId: crypto.randomUUID(), route: "/api/studio/visual/projects/x/prompts" }, onPriceConsent: (c) => { queueMicrotask(() => priceConsents.decide(owner, c.id, c.scopeHash, "deny")); } }, () => V.writePrompts(p.id, { channelId, free: false })), (e: any) => e.code === "BUDGET_CONSENT_DENIED");
  assert.equal(calls, 0);
  assert.equal(JSON.stringify((await V.visualState(p.id)).board!.rows), before);
});

test("окно цены: одно окно на весь запуск, запросов ровно столько, сколько в окне", async () => {
  const { p, rows } = await longProject("Окно — одно на запуск");
  let calls = 0; VP.setPromptAi(async ({ user }) => { calls++; return fakeAnswer(user); });
  const windows: string[] = [];
  await approved(() => V.writePrompts(p.id, { channelId, free: false }), windows);
  assert.equal(windows.length, 1, "одно окно");
  const batches = Math.ceil(rows / 12);
  assert.match(windows[0], new RegExp(`Подтвердите ${batches} запрос`));
  assert.match(windows[0], new RegExp(`промптов ${rows} сцен`));
  assert.match(windows[0], /Цена этой модели неизвестна|Ориентир цены за все запросы/);
  assert.equal(calls, batches);
});

test("окно цены: смена модели во время работы останавливает следующие пачки, готовое сохранено", async () => {
  const { p } = await longProject("Окно — смена модели");
  let calls = 0;
  VP.setPromptAi(async ({ user }) => { if (++calls === 1) await updateSettings({ anymodel: { script: "cc/another-model" } }); return fakeAnswer(user); });
  try {
    await assert.rejects(approved(() => V.writePrompts(p.id, { channelId, free: false })), (e: any) => e.code === "BUDGET_CONSENT_STALE");
    assert.equal(calls, 1, "после смены модели новый запрос не отправлен");
    const st = (await V.visualState(p.id)).board!;
    assert.ok(st.rows.slice(0, 12).every((r) => r.concept.startsWith("consent scene")), "первая пачка сохранена");
  } finally { await updateSettings({ anymodel: { script: "cc/claude-opus-5" } }); }
});

test("ориентир: сумма по всем пачкам растёт с числом пачек, неизвестный тариф — цена неизвестна", () => {
  const price: any = { version: 1, provider: "anymodel", model: "m", kind: "text", currency: "USD", source: "cached-anymodel", known: true, usdPerMillion: 1, coefficientInput: 1, coefficientOutput: 1, scale: 1, capturedAt: new Date().toISOString(), priceVersion: "a".repeat(64) };
  const kit: any = { id: "k", name: "Kit", anchor: "pencil", motion: "", negative: "", palette: "" };
  const chan: any = { name: "C", language: "en", visual: { cast: [] } };
  const scene = (n: number) => ({ n, text: "Snow fell on the village.", seconds: 6, shot: "wide" });
  const one = PC.promptsQuote(price, { ch: chan, kit, batches: [[scene(1)]] })!;
  const two = PC.promptsQuote(price, { ch: chan, kit, batches: [[scene(1)], [scene(2)]] })!;
  assert.ok(one > 0 && two > one);
  assert.equal(PC.promptsQuote({ ...price, known: false }, { ch: chan, kit, batches: [[scene(1)]] }), null);
  assert.match(PC.promptsMessage({ model: "m", requests: 3, scenes: 30, usd: null }), /Цена этой модели неизвестна/);
  assert.match(PC.promptsMessage({ model: "m", requests: 3, scenes: 30, usd: 0.4 }), /примерно \$0\.40 или меньше/);
});
