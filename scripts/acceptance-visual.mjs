// Release 2 acceptance: «Визуал» with an imitation of the G-Labs Webhook API on this computer — no quota is spent.
// Used by scripts/win-acceptance.mjs (phase N); the same checks run locally against a dev server before CI.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import zlib from "node:zlib";

function crc32(buf) { let crc = 0xffffffff; for (const byte of buf) { let c = (crc ^ byte) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
export function makePng(w, h, [r, g, b]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; raw[i] = (r + x) & 255; raw[i + 1] = (g + y) & 255; raw[i + 2] = b; }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "ascii"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
export async function fakeGlabs() {
  const key = `glabs-ACCEPTANCE-${crypto.randomBytes(8).toString("hex")}`;
  const PNG = makePng(160, 90, [40, 60, 200]);
  const MP4 = Buffer.concat([Buffer.from("000000206674797069736f6d", "hex"), Buffer.alloc(2048, 9)]);
  const w = { key, calls: [], tasks: new Map(), chars: new Map(), stops: [], seq: 0, slow: false, port: 0 };
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    let raw = ""; for await (const c of req) raw += c;
    let body; try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }
    const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    const authed = req.headers["x-api-key"] === key;
    w.calls.push({ method: req.method, path: u.pathname, body, authed });
    if (u.pathname === "/api/health") return send(200, { status: "ok", server: "G-Labs Webhook (имитация приёмки)", uptime: 5, tasks_pending: 0, tasks_running: 0 });
    if (u.pathname.startsWith("/api/files/")) { const vid = u.pathname.endsWith(".mp4"); res.writeHead(200, { "content-type": vid ? "video/mp4" : "image/png" }); return res.end(vid ? MP4 : PNG); }
    if (!authed) return send(401, { error: "Invalid or missing API key" });
    if (u.pathname === "/api/tasks") return send(200, { tasks: [] });
    if (req.method === "POST" && (u.pathname === "/api/image/generate" || u.pathname === "/api/video/generate")) {
      const id = `acc-${++w.seq}`;
      w.tasks.set(id, { id, kind: u.pathname.includes("video") ? "video" : "image", body, polls: 0, slow: w.slow });
      return send(202, { task_id: id, status: "pending" });
    }
    const st = /^\/api\/status\/(.+)$/.exec(u.pathname);
    if (st) {
      const t = w.tasks.get(decodeURIComponent(st[1]));
      if (!t) return send(404, { error: "Task not found" });
      t.polls++;
      if (t.slow || t.polls < 2) return send(200, { task_id: t.id, status: "running" });
      return send(200, { task_id: t.id, status: "completed", results: [`http://127.0.0.1:${w.port}/api/files/${t.id}.${t.kind === "video" ? "mp4" : "png"}`], final_prompt: t.body?.prompt, prompt_rewrites: 0 });
    }
    const sp = /^\/api\/stop\/(.+)$/.exec(u.pathname);
    if (sp && req.method === "POST") { w.stops.push(decodeURIComponent(sp[1])); return send(200, { ok: true }); }
    if (u.pathname === "/api/characters" && req.method === "GET") return send(200, { characters: [...w.chars.values()].map((c) => ({ name: c.name, has_image: true })) });
    if (u.pathname === "/api/characters" && req.method === "POST") {
      if (w.chars.has(body?.name)) return send(409, { error: "Name already taken", error_code: "NAME_TAKEN" });
      w.chars.set(body?.name, body); return send(201, { name: body?.name, character_id: "acc-char-1" });
    }
    const pc = /^\/api\/characters\/(.+)$/.exec(u.pathname);
    if (pc && req.method === "PATCH") { w.chars.set(decodeURIComponent(pc[1]), { name: decodeURIComponent(pc[1]), ...body }); return send(200, { ok: true }); }
    return send(404, { error: "Not found" });
  });
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  w.port = srv.address().port;
  return { ...w, w, url: `http://127.0.0.1:${w.port}`, close: () => new Promise((resolve) => { srv.closeAllConnections?.(); srv.close(() => resolve()); }) };
}
export const FROST = [
  "In the winter of 1816 the snow never stopped falling on the mountain villages. Farmers watched their fields turn white in June. Nobody knew that a volcano on the other side of the world had caused it.",
  "Prices for bread doubled in a single month. Families sold their horses because there was no hay. The old king ordered the granaries to be opened, but the stores lasted only three weeks.",
  "Then a young clerk found a ledger hidden in the cellar of the palace. It listed every sack of grain the nobles had secretly kept for themselves. What he did next changed the fate of the whole kingdom.",
].join("\n\n");

/** Every check of phase N against a running TubeStudio (signed-in page and its session cookie). */
export async function visualChecks({ port, cookie, page, gl, dataDir, out, errors }, { check, api, waitFor, exists, readJson, samePathCI, treeContains }) {
  const shot = (n) => page.screenshot({ path: path.join(out, `visual-${n}.png`), fullPage: true }).catch(() => {});
  const seen = (loc, ms = 20_000) => loc.first().waitFor({ timeout: ms }).then(() => true, () => false);
  const go = (route) => page.goto(`http://127.0.0.1:${port}${route}`);
  const call = (method, p, body) => api(port, method, `/api${p}`, { cookie, body });

  // Address and key — as the user does in Settings.
  const set = await call("PUT", "/settings", { glabs: { url: gl.url } });
  check("N: адрес G-Labs сохранён в Настройках", set.status === 200 && set.json?.data?.glabs?.url === gl.url, set.text.slice(0, 300));
  const g0 = await call("GET", "/studio/visual/glabs");
  check("N: без ключа — подсказка «вкладка Webhook → API key»", g0.json?.data?.ok === false && g0.json?.data?.code === "KEY_MISSING" && /Webhook/.test(g0.json?.data?.message ?? ""), g0.text.slice(0, 300));
  const k = await call("PUT", "/settings/keys", { glabs: gl.key });
  check("N: ключ G-Labs сохранён", k.status === 200 && (k.json?.data?.saved ?? []).includes("glabs"), k.text.slice(0, 300));
  const g1 = await call("GET", "/studio/visual/glabs");
  check("N: G-Labs на связи, на этом же компьютере", g1.json?.data?.ok === true && g1.json?.data?.local === true && /на связи/.test(g1.json?.data?.message ?? ""), g1.text.slice(0, 300));
  check("N: ключ G-Labs не лежит открытым текстом в данных", treeContains(dataDir, [gl.key]).length === 0, treeContains(dataDir, [gl.key]).join("\n"));

  // Channel with style 19 and a reference character.
  const made = await call("POST", "/studio/channels", { name: "The Frost Ledger — проверка", language: "en", niche: "dark history of famines and kingdoms", lengthMin: 10 });
  const channelId = made.json?.data?.id;
  if (!check("N: канал создан", made.status === 200 && !!channelId, made.text.slice(0, 300))) return;
  const vis = await call("PATCH", `/studio/channels/${channelId}`, { visual: { styleId: "builtin-obs-storybook-pencil", cast: [{ name: "OldKing", kind: "character", description: "An old king with a grey beard and a heavy fur cloak" }] } });
  check("N: стиль канала и персонаж OldKing сохранены", vis.status === 200 && vis.json?.data?.visual?.styleId === "builtin-obs-storybook-pencil" && vis.json?.data?.visual?.cast?.[0]?.name === "OldKing", vis.text.slice(0, 300));
  await call("POST", `/studio/channels/${channelId}/activate`);
  const castPng = makePng(64, 64, [180, 120, 60]);
  const up = await call("POST", `/studio/channels/${channelId}/cast/OldKing/image`, { image: `data:image/png;base64,${castPng.toString("base64")}` });
  const castRel = up.json?.data?.visual?.cast?.[0]?.image ?? "";
  const castAbs = path.join(dataDir, "files", ...castRel.split("/"));
  check("N: эталон OldKing загружен в папку данных", up.status === 200 && /^_cast\/.+\/OldKing\.png$/.test(castRel) && exists(castAbs), `${up.status} ${up.text.slice(0, 300)}`);
  const sync = await call("POST", `/studio/channels/${channelId}/cast/sync`);
  const sent = gl.w.chars.get("OldKing");
  check("N: эталон отправлен в библиотеку персонажей G-Labs путём к файлу, файл по пути найден", sync.status === 200 && !!sent?.image?.path && exists(sent.image.path) && samePathCI(sent.image.path, castAbs), `${sync.text.slice(0, 300)} | ${JSON.stringify(sent ?? null).slice(0, 300)}`);

  // Project with a script → scenes → free draft prompts.
  const proj = await call("POST", "/projects", { title: "The Frost Ledger — проверка Визуала" });
  const projectId = proj.json?.data?.id;
  if (!check("N: проект создан", proj.status === 200 && !!projectId, proj.text.slice(0, 300))) return;
  const art = await call("POST", `/projects/${projectId}/artifacts`, { kind: "script", title: "Сценарий", data: { script: FROST } });
  check("N: сценарий добавлен в проект", art.status === 200, art.text.slice(0, 300));
  const cut = await call("POST", `/studio/visual/projects/${projectId}/scenes`, { channelId });
  const rows = cut.json?.data?.rows ?? [];
  check("N: сценарий нарезан на сцены (бесплатно)", cut.status === 200 && rows.length >= 4, `${cut.status} сцен ${rows.length} ${cut.text.slice(0, 200)}`);
  const draft = await call("POST", `/studio/visual/projects/${projectId}/prompts`, { channelId, free: true });
  check("N: черновые промпты для всех сцен (бесплатно)", draft.status === 200 && draft.json?.data?.result?.written === rows.length, draft.text.slice(0, 300));
  const state = async () => (await call("GET", `/studio/visual/projects/${projectId}`)).json?.data ?? null;
  let s = await state();
  // The code puts the anchor in one line without the final full stop (as the unit tests check it).
  const anchor = (s?.board?.style?.anchor ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().replace(/[.;,\s]+$/, "");
  check("N: стилевой ключ стиля 19 дословно в каждом промпте картинки", anchor.length > 20 && (s?.board?.rows ?? []).every((x) => x.image.includes(anchor)), `${anchor.slice(0, 80)} | ${(s?.board?.rows ?? []).find((x) => !x.image.includes(anchor))?.image?.slice(0, 200) ?? ""}`);
  const ed = await call("PATCH", `/studio/visual/projects/${projectId}/scenes/1`, { concept: "@OldKing counts sacks of grain by candlelight in a frozen cellar", animate: true });
  check("N: правка сцены 1 — персонаж @OldKing и анимация", ed.status === 200 && JSON.stringify(ed.json?.data?.rows?.[0]?.cast) === '["OldKing"]' && ed.json?.data?.rows?.[0]?.animate === true, ed.text.slice(0, 300));

  // Pictures for scenes 1–2: the reference goes by its path on this disk.
  const idle = (fn, ms = 120_000) => waitFor(async () => { const v = await state(); return v && !v.running && fn(v) ? v : null; }, ms, 1000);
  const img = await call("POST", `/studio/visual/projects/${projectId}/render`, { channelId, what: "images", scenes: [1, 2] });
  check("N: картинки запущены задачей", img.status === 200 && !!img.json?.data?.jobId, img.text.slice(0, 300));
  s = await idle((v) => v.board.rows.slice(0, 2).every((x) => x.picture.state === "done" || x.picture.state === "failed"));
  const pics = s?.board?.rows?.slice(0, 2) ?? [];
  const visualDir = path.join(dataDir, "files", projectId, "visual");
  check("N: картинки сцен 1 и 2 готовы и лежат в папке проекта (001.png, 002.png)", pics.length === 2 && pics.every((x) => x.picture.state === "done") && exists(path.join(visualDir, "001.png")) && exists(path.join(visualDir, "002.png")), JSON.stringify(pics.map((x) => x.picture)).slice(0, 500));
  const imgSubmits = gl.w.calls.filter((c) => c.method === "POST" && c.path === "/api/image/generate");
  const sub1 = imgSubmits.find((c) => c.body?.prompt?.includes("OldKing"));
  const ref = sub1?.body?.reference_images?.[0]?.path ?? "";
  check("N: в G-Labs ушли 2 картинки, модель Nano Banana 2, 16:9, стилевой ключ в промпте", imgSubmits.length === 2 && imgSubmits.every((c) => c.body?.model === "nano_banana_2" && c.body?.aspect_ratio === "16:9" && c.body?.prompt?.includes(anchor)), JSON.stringify(imgSubmits.map((c) => ({ model: c.body?.model, aspect: c.body?.aspect_ratio, p: c.body?.prompt?.slice(0, 80) }))));
  check("N: сцена с @OldKing получила эталон путём к файлу, и G-Labs нашёл этот файл", !!ref && exists(ref) && samePathCI(ref, castAbs), ref || JSON.stringify(sub1?.body ?? null).slice(0, 300));
  const acc = await call("PATCH", `/studio/visual/projects/${projectId}/scenes/1`, { picture: { verdict: "accepted" } });
  check("N: картинка сцены 1 принята", acc.status === 200 && acc.json?.data?.rows?.[0]?.picture?.verdict === "accepted", acc.text.slice(0, 300));

  // A clip for scene 1 from its own picture.
  const clip = await call("POST", `/studio/visual/projects/${projectId}/render`, { channelId, what: "clips", scenes: [1] });
  check("N: оживление запущено задачей", clip.status === 200 && !!clip.json?.data?.jobId, clip.text.slice(0, 300));
  s = await idle((v) => ["done", "failed"].includes(v.board.rows[0].clip.state));
  const vid = gl.w.calls.find((c) => c.method === "POST" && c.path === "/api/video/generate");
  check("N: клип сцены 1 готов (001_anim.mp4)", s?.board?.rows?.[0]?.clip?.state === "done" && exists(path.join(visualDir, "001_anim.mp4")), JSON.stringify(s?.board?.rows?.[0]?.clip ?? null).slice(0, 300));
  check("N: клип сделан из картинки сцены (start_image, Veo 3.1 Fast, 8 с)", vid?.body?.mode === "start_image" && vid?.body?.model === "veo_31_fast" && vid?.body?.video_length === 8 && samePathCI(vid?.body?.reference_images?.[0]?.path, path.join(visualDir, "001.png")), JSON.stringify(vid?.body ?? null).slice(0, 400));

  // Files for montage and the TXT fallback.
  const scenesJson = readJson(path.join(visualDir, "scenes.json"));
  check("N: scenes.json для монтажа: картинка, клип и «принято» у сцены 1", scenesJson?.schema === 1 && scenesJson.scenes?.[0]?.image === "visual/001.png" && scenesJson.scenes?.[0]?.clip === "visual/001_anim.mp4" && scenesJson.scenes?.[0]?.accepted === true, JSON.stringify(scenesJson?.scenes?.[0] ?? null).slice(0, 300));
  const txt = exists(path.join(visualDir, "prompts_images.txt")) ? fs.readFileSync(path.join(visualDir, "prompts_images.txt"), "utf8") : "";
  check("N: prompts_images.txt — 1 строка = 1 промпт, по строке на сцену", txt.trim().split("\n").length === rows.length, `${txt.trim().split("\n").length} строк из ${rows.length}`);
  const ex = await call("GET", `/studio/visual/projects/${projectId}/export/images.txt`);
  check("N: выгрузка TXT отдаётся файлом", ex.status === 200 && ex.text.split("\n")[0] === s?.board?.rows?.[0]?.image, `${ex.status} ${ex.text.slice(0, 120)}`);

  // Stop: a long task in G-Labs is stopped there too.
  gl.w.slow = true;
  const before = gl.w.seq;
  const long = await call("POST", `/studio/visual/projects/${projectId}/render`, { channelId, what: "images", scenes: [3] });
  const jobId = long.json?.data?.jobId;
  const submitted = await waitFor(() => gl.w.seq > before, 30_000, 300);
  const cancel = jobId ? await call("POST", `/jobs/${jobId}/cancel`) : null;
  const released = await idle(() => true, 30_000);
  check("N: «Остановить» снимает задание и в G-Labs", !!jobId && submitted && cancel?.json?.data?.cancelled === true && !!released && gl.w.stops.includes(`acc-${before + 1}`), `job=${jobId} submitted=${submitted} cancel=${cancel?.text?.slice(0, 120)} stops=${gl.w.stops.join(",")}`);
  gl.w.slow = false;

  // The page as the user sees it.
  await go(`/studio/visual?project=${encodeURIComponent(projectId)}`);
  check("N: страница «Визуал» открылась", await seen(page.getByTestId("studio-visual")));
  check("N: страница: «G-Labs на связи»", await seen(page.getByTestId("glabs-status").filter({ hasText: "G-Labs на связи" })));
  check("N: страница: настройки визуала и персонаж OldKing", await seen(page.getByTestId("visual-settings")) && await seen(page.getByTestId("visual-cast").filter({ hasText: "OldKing" })));
  check("N: страница: карточки всех сцен", await waitFor(async () => (await page.getByTestId("visual-scene").count()) === rows.length, 20_000), `${await page.getByTestId("visual-scene").count()} из ${rows.length}`);
  const pic = page.locator('img[alt="Сцена 1"]');
  if (await seen(pic)) await pic.first().scrollIntoViewIfNeeded().catch(() => {});
  const loaded = await waitFor(() => pic.first().evaluate((el) => el.complete && el.naturalWidth > 0), 20_000, 500);
  check("N: страница: картинка сцены 1 показывается", !!loaded);
  check("N: страница: клип сцены 1 на карточке", await seen(page.locator('video[aria-label="Клип сцены 1"]')));
  await shot("page");
  await go("/settings");
  const btn = page.getByRole("button", { name: "Проверить связь" });
  if (check("N: Настройки: карточка G-Labs с кнопкой «Проверить связь»", await seen(btn))) {
    await btn.first().scrollIntoViewIfNeeded().catch(() => {});
    await btn.first().click();
    check("N: Настройки: «Проверить связь» — G-Labs на связи", await seen(page.getByRole("status").filter({ hasText: "G-Labs на связи" })));
    await page.locator("#glabs").scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: path.join(out, "visual-settings.png") }).catch(() => {});
  }
  await go("/help");
  check("N: Справка: раздел «Визуал (G-Labs)»", await seen(page.getByText("Визуал (G-Labs)")));
  check("N: нет ошибок JavaScript", errors.length === 0, errors.join("\n"));
}
