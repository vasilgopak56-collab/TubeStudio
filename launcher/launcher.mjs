// TubeStudio — лаунчер портативной версии для Windows (Выпуск 1).
//
// Что делает при запуске:
//  1. Находит папку данных TubeStudioData (рядом с папкой программы).
//  2. Если TubeStudio уже запущена — просто открывает браузер с новым ключом входа.
//  3. Если работает старая версия (0.12.x) — мягко останавливает её.
//  4. Один раз переносит данные и ключи из старой версии (копирует, оригинал не трогает).
//  5. Запускает сервер в фоне и открывает браузер со ссылкой входа.
//
// Флаги: --stop (остановить), --status (состояние в JSON), --no-browser.
// Без зависимостей: работает на встроенном node.exe.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const programDir = path.dirname(appDir);
const args = new Set(process.argv.slice(2));
const env = process.env;
const NO_BROWSER = args.has("--no-browser") || env.TUBESTUDIO_NO_BROWSER === "1";
const FROM_CMD = args.has("--from-cmd");
// Started from the .cmd file the console shows every message; from the hidden shortcut errors need a window.
const NO_DIALOGS = env.TUBESTUDIO_NO_DIALOGS === "1" || process.platform !== "win32" || FROM_CMD;
const PRINT_LINK = env.TUBESTUDIO_PRINT_LINK === "1";
const VERSION = readJsonSafe(path.join(appDir, "package.json"))?.version ?? "?";
const DEFAULT_PORT = 8787;

function readJsonSafe(file) { try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// ---------- папка данных и журнал ----------
export function resolveDataDir() {
  if (env.TUBESTUDIO_DATA_DIR) return path.resolve(env.TUBESTUDIO_DATA_DIR);
  const custom = path.join(programDir, "data-location.txt");
  if (exists(custom)) {
    const line = fs.readFileSync(custom, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).map((s) => s.trim()).find((s) => s && !s.startsWith("#"));
    if (line && path.isAbsolute(line)) return path.resolve(line);
  }
  return path.join(path.dirname(programDir), "TubeStudioData");
}
const dataDir = resolveDataDir();
const controlDir = path.join(dataDir, ".tubestudio-control");
const logsDir = path.join(dataDir, "logs");
const pending = [];
function log(line) {
  const text = `${new Date().toISOString()} ${line}\n`;
  try { fs.mkdirSync(logsDir, { recursive: true }); for (const p of pending.splice(0)) fs.appendFileSync(path.join(logsDir, "launcher.log"), p); fs.appendFileSync(path.join(logsDir, "launcher.log"), text); }
  catch { pending.push(text); }
}
function say(line) { console.log(line); log(line); }

function powershell(script, extraEnv = {}, timeout = 60_000) {
  const exe = path.join(env.SystemRoot || env.windir || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return spawnSync(exe, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    env: { ...env, ...extraEnv }, windowsHide: true, timeout, encoding: "utf8",
  });
}
function popup(text, icon = 16) {
  if (NO_DIALOGS) return;
  powershell("$s=New-Object -ComObject WScript.Shell; [void]$s.Popup($env:TS_MSG, 0, 'TubeStudio', [int]$env:TS_ICON)", { TS_MSG: text, TS_ICON: String(icon) }, 30 * 60_000);
}
function fail(text, code = 1) {
  say(`ОШИБКА: ${text}`);
  popup(`${text}\n\nЖурнал: ${path.join(logsDir, "launcher.log")}`);
  process.exit(code);
}

// ---------- канал управления ----------
function controlCall(desc, cmd, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port: desc.controlPort });
    let text = "";
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs, () => done({ ok: false, error: "TIMEOUT" }));
    socket.once("error", (e) => done({ ok: false, error: e.code || "ERROR" }));
    socket.on("data", (c) => { text += c.toString("utf8"); });
    socket.once("connect", () => socket.write(`${cmd} ${desc.token}\n`));
    socket.once("end", () => done({ ok: true, reply: text.trim() }));
  });
}
function descriptors(dir) {
  if (!isDir(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => ({ file: path.join(dir, f), ...readJsonSafe(path.join(dir, f)) }))
    .filter((d) => Number.isInteger(d.controlPort) && /^[0-9a-f]{64}$/.test(d.token ?? ""));
}
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}
/** Running server of THIS data folder (new versions answer PING). */
async function findRunning() {
  for (const d of descriptors(controlDir)) {
    const r = await controlCall(d, "PING");
    if (r.ok && r.reply.startsWith("PONG ")) { const [, version] = r.reply.split(" "); return { ...d, version }; }
    if (!pidAlive(d.pid)) { try { fs.rmSync(d.file, { force: true }); } catch { /* not ours to fix */ } }
  }
  return null;
}
async function stopServer(desc, why) {
  say(`Останавливаю TubeStudio ${desc.version ?? ""} (${why})…`);
  const r = await controlCall(desc, "STOP", 30_000);
  const reply = r.ok ? r.reply : r.error;
  if (reply !== "STOPPED") return reply || "NO_REPLY";
  for (let i = 0; i < 100 && pidAlive(desc.pid); i++) await sleep(200);
  return pidAlive(desc.pid) ? "STILL_RUNNING" : "STOPPED";
}

// ---------- старая версия (0.12.x) ----------
function legacyRoots() {
  const parent = path.dirname(programDir);
  const roots = new Set([parent]);
  const kids = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name)); } catch { return []; } };
  for (const a of kids(parent)) {
    if (path.resolve(a) === path.resolve(programDir) || path.resolve(a) === path.resolve(dataDir)) continue;
    roots.add(a);
    for (const b of kids(a)) roots.add(b);
  }
  return [...roots].filter((r) => exists(path.join(r, "apps", "server")) && exists(path.join(r, "package.json")));
}
function legacyDataDirOf(root) {
  const envFile = path.join(root, ".env");
  let dataSetting = "";
  if (exists(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?DATA_DIR\s*=\s*["']?([^"'#\r\n]*?)["']?\s*(?:#.*)?$/.exec(line);
      if (m) dataSetting = m[1].trim();
    }
  }
  const serverDir = path.join(root, "apps", "server");
  return path.resolve(serverDir, dataSetting || "../../data");
}
const looksLikeData = (dir) => isDir(dir) && ["projects", "settings.json", "usage.json", "reports"].some((n) => exists(path.join(dir, n)));
function newestMtime(dir) {
  let t = 0;
  for (const n of ["settings.json", "usage.json", "projects", "reports"]) { try { t = Math.max(t, fs.statSync(path.join(dir, n)).mtimeMs); } catch { /* absent */ } }
  return t;
}
export function findLegacy() {
  const found = [];
  for (const root of legacyRoots()) {
    const version = readJsonSafe(path.join(root, "package.json"))?.version ?? "";
    for (const dir of new Set([legacyDataDirOf(root), path.join(root, "apps", "server", "data"), path.join(root, "data")])) {
      if (path.resolve(dir) === path.resolve(dataDir) || !looksLikeData(dir)) continue;
      found.push({ root, dir, version, env: exists(path.join(root, ".env")) ? path.join(root, ".env") : null, mtime: newestMtime(dir) });
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}
async function stopLegacyServers() {
  for (const root of legacyRoots()) {
    for (const d of descriptors(path.join(root, ".tubestudio-control"))) {
      if (!pidAlive(d.pid)) continue;
      const result = await stopServer({ ...d, version: readJsonSafe(path.join(root, "package.json"))?.version }, "старая версия");
      if (result === "BUSY") fail("Старая версия TubeStudio сейчас выполняет задачу. Дождитесь её окончания и запустите TubeStudio снова.");
      if (result !== "STOPPED") fail(`Не удалось остановить старую версию TubeStudio (${result}). Закройте её окно или перезагрузите компьютер и запустите снова.`);
      say("Старая версия остановлена.");
    }
  }
}

// ---------- перенос данных ----------
function dataIsFresh() {
  if (exists(path.join(dataDir, "migration.json")) || exists(path.join(dataDir, "settings.json"))) return false;
  try { return !fs.readdirSync(path.join(dataDir, "projects")).length; } catch { return true; }
}
const SKIP = /(^|[\\/])(\.tubestudio-server\.lock|\.tubestudio-control)([\\/]|$)|\.tmp$/;
function tally(dir) {
  let files = 0, bytes = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (SKIP.test(path.relative(dir, p))) continue; if (e.isDirectory()) walk(p); else if (e.isFile()) { files++; bytes += fs.statSync(p).size; } } };
  walk(dir);
  return { files, bytes };
}
// Plain recursive copy that never overwrites. Not fs.cpSync: its native fast path in Node 22
// aborts the process on Windows for folders with non-ASCII names (e.g. «Программы»).
function copyMissing(src, dst, rel = "") {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const r = rel ? path.join(rel, e.name) : e.name;
    if (SKIP.test(r)) continue;
    const from = path.join(src, e.name), to = path.join(dst, e.name);
    if (e.isDirectory()) copyMissing(from, to, r);
    else if (e.isFile() && !exists(to)) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  }
}
function migrate(legacy) {
  if (exists(path.join(legacy.dir, ".tubestudio-server.lock"))) {
    const owner = readJsonSafe(path.join(legacy.dir, ".tubestudio-server.lock", "owner.json"));
    if (owner && pidAlive(owner.pid)) fail("Старая версия TubeStudio всё ещё работает с данными. Закройте её и запустите снова.");
  }
  say(`Переношу данные из старой версии: ${legacy.dir}`);
  const before = tally(legacy.dir);
  fs.mkdirSync(dataDir, { recursive: true });
  copyMissing(legacy.dir, dataDir);
  const record = { schema: 1, from: legacy.dir, fromVersion: legacy.version, legacyEnv: legacy.env, envImported: false, copiedAt: new Date().toISOString(), files: before.files, bytes: before.bytes, originalKept: true };
  fs.writeFileSync(path.join(dataDir, "migration.json"), JSON.stringify(record, null, 2) + "\n");
  say(`Перенесено файлов: ${before.files} (${(before.bytes / 1048576).toFixed(1)} МБ). Старая папка не изменена.`);
}

// ---------- запуск сервера ----------
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen({ host: "127.0.0.1", port, exclusive: true }, () => s.close(() => resolve(true)));
  });
}
function getJson(port, p) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: p, timeout: 3000, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      let body = ""; res.setEncoding("utf8"); res.on("data", (c) => { body += c; });
      res.on("end", () => { try { resolve({ status: res.statusCode, json: JSON.parse(body) }); } catch { resolve({ status: res.statusCode, json: null }); } });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}
async function choosePort() {
  const wanted = Number(env.TUBESTUDIO_PORT || DEFAULT_PORT);
  for (let port = wanted; port < wanted + 20; port++) if (await portFree(port)) return port;
  fail("Не найден свободный порт для TubeStudio (8787–8806). Перезагрузите компьютер и попробуйте снова.");
}
function rotate(file, maxBytes = 5 * 1048576) {
  try { if (fs.statSync(file).size > maxBytes) fs.renameSync(file, `${file}.1`); } catch { /* absent */ }
}
async function startServer(port, token) {
  const serverDir = path.join(appDir, "apps", "server");
  const entry = path.join(serverDir, "dist", "index.js");
  if (!exists(entry) || !exists(path.join(appDir, "apps", "web", "dist", "index.html"))) fail("Программа распакована не полностью: нет файлов сервера или интерфейса. Распакуйте архив заново.");
  fs.mkdirSync(logsDir, { recursive: true });
  const consoleLog = path.join(logsDir, "server-console.log");
  rotate(consoleLog);
  const out = fs.openSync(consoleLog, "a");
  const childEnv = { ...env, DATA_DIR: dataDir, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "production", TUBESTUDIO_PORTABLE: "1",
    TUBESTUDIO_LAUNCH_TOKEN: token, TUBESTUDIO_CONTROL_DIR: controlDir, TUBESTUDIO_PROGRAM_DIR: programDir, ENV_FILE: path.join(dataDir, "no-env-file.env") };
  delete childEnv.APP_PASSWORD;
  const child = spawn(process.execPath, [entry], { cwd: serverDir, env: childEnv, detached: true, windowsHide: true, stdio: ["ignore", out, out] });
  let exited = null;
  child.once("exit", (code) => { exited = code ?? -1; });
  child.unref();
  for (let i = 0; i < 180; i++) {
    if (exited !== null) break;
    const r = await getJson(port, "/api/auth/status");
    if (r?.status === 200 && r.json?.ok) return child.pid;
    await sleep(500);
  }
  let tail = "";
  try { tail = fs.readFileSync(consoleLog, "utf8").split(/\r?\n/).filter(Boolean).slice(-6).join("\n"); } catch { /* none */ }
  if (/Папка данных уже занята/.test(tail)) fail("Папка данных занята другой копией TubeStudio. Закройте её (кнопка «Выход») и запустите снова.");
  fail(`Сервер TubeStudio не запустился${exited !== null ? ` (код ${exited})` : " вовремя"}.\n${tail}`);
}
function openBrowser(url) {
  if (PRINT_LINK) console.log(`LINK ${url}`);
  if (NO_BROWSER) return;
  if (process.platform === "win32") spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  else spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

// ---------- ярлык ----------
function ensureShortcut() {
  if (process.platform !== "win32" || env.TUBESTUDIO_NO_SHORTCUT === "1") return;
  const marker = path.join(dataDir, ".shortcut-target");
  let current = "";
  try { current = fs.readFileSync(marker, "utf8").trim(); } catch { /* first run */ }
  if (current === programDir && !FROM_CMD) return;
  const r = powershell(fs.readFileSync(path.join(appDir, "windows", "create-shortcut.ps1"), "utf8").replace(/^\uFEFF/, ""), { TS_PROGRAM_DIR: programDir });
  if (r.status === 0) { fs.writeFileSync(marker, programDir); say("Ярлык TubeStudio на рабочем столе обновлён."); }
  else say(`Ярлык не создан: ${(r.stdout || "") + (r.stderr || "")}`.trim().slice(0, 400));
}

// ---------- один лаунчер за раз ----------
function takeLauncherLock() {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, ".launcher.lock");
  for (let i = 0; i < 2; i++) {
    try { const fd = fs.openSync(file, "wx"); fs.writeSync(fd, String(process.pid)); fs.closeSync(fd); return () => { try { fs.rmSync(file, { force: true }); } catch { /* ignore */ } }; }
    catch {
      let other = 0, age = 0;
      try { other = Number(fs.readFileSync(file, "utf8")); age = Date.now() - fs.statSync(file).mtimeMs; } catch { /* vanished */ }
      if (!pidAlive(other) || age > 3 * 60_000) { try { fs.rmSync(file, { force: true }); } catch { /* ignore */ } continue; }
      return null;
    }
  }
  return null;
}

// ---------- основной сценарий ----------
async function main() {
  if (args.has("--status")) {
    const running = await findRunning();
    console.log(JSON.stringify({ version: VERSION, programDir, dataDir, running: running ? { version: running.version, pid: running.pid, port: running.appPort } : null }));
    return;
  }
  if (args.has("--stop")) {
    const running = await findRunning();
    if (!running) { say("TubeStudio не запущена."); return; }
    const result = await stopServer(running, "по запросу");
    if (result === "STOPPED") say("TubeStudio остановлена.");
    else if (result === "BUSY") fail("TubeStudio выполняет задачу. Дождитесь окончания или нажмите «Выход» в программе.", 2);
    else fail(`Остановка не подтверждена (${result}).`, 3);
    return;
  }

  say(`TubeStudio ${VERSION}. Данные: ${dataDir}`);
  if (/onedrive|google drive|dropbox|yandex\.?disk/i.test(dataDir)) say("Внимание: папка данных похожа на синхронизируемую (OneDrive и т. п.). Это может блокировать файлы.");

  const release = takeLauncherLock();
  if (!release) {
    // Another launcher is starting the server right now: wait for it and just open the browser.
    for (let i = 0; i < 120; i++) { const r = await findRunning(); if (r) { const link = await controlCall(r, "LINK"); if (link.ok && link.reply.startsWith("LINK ")) openBrowser(link.reply.slice(5)); return; } await sleep(500); }
    fail("TubeStudio уже запускается, но не ответила. Подождите минуту и попробуйте снова.");
  }
  try {
    const running = await findRunning();
    // Same unpacked program folder → reuse it. Another folder (an update or a second copy) → switch to this one.
    const sameProgram = running && (running.program ? path.resolve(running.program) === path.resolve(programDir) : running.version === VERSION);
    if (sameProgram) {
      const link = await controlCall(running, "LINK");
      if (link.ok && link.reply.startsWith("LINK ")) { say("TubeStudio уже запущена — открываю браузер."); openBrowser(link.reply.slice(5)); ensureShortcut(); return; }
    }
    if (running) {
      const result = await stopServer(running, `обновление ${running.version} → ${VERSION}`);
      if (result === "BUSY") fail("Запущенная TubeStudio выполняет задачу. Дождитесь окончания и запустите снова.");
      if (result !== "STOPPED") fail(`Не удалось остановить запущенную TubeStudio (${result}).`);
    }
    await stopLegacyServers();
    if (dataIsFresh()) {
      const legacy = findLegacy();
      if (legacy.length) migrate(legacy[0]);
      else say("Старых данных не найдено — начинаем с чистой папки.");
    }
    const port = await choosePort();
    const token = crypto.randomBytes(32).toString("hex");
    say(`Запускаю сервер на http://127.0.0.1:${port} …`);
    const pid = await startServer(port, token);
    log(`server pid ${pid} port ${port}`);
    ensureShortcut();
    openBrowser(`http://127.0.0.1:${port}/?launch=${token}`);
    say("Готово: TubeStudio открыта в браузере. Закрыть программу — кнопка «Выход» в меню.");
  } finally { release(); }
}

main().catch((e) => fail(`Непредвиденная ошибка лаунчера: ${e?.stack || e}`));
