// Windows acceptance test for the portable TubeStudio package (Release 1).
//
// Simulates the real user: an old 0.12.x version unpacked straight into
// <Desktop>\Программы\TubeStudio with a .env and data in apps\server\data, running.
// Then the new zip is unpacked next to it and started the way the user starts it.
//
// Usage (on Windows, from the repo root):
//   node scripts/win-acceptance.mjs --zip release\TubeStudio-<ver>-windows.zip --base "<old install folder>" --out ci-out\acceptance
// --base must contain a BUILT old version (apps\server\dist, apps\web\dist, node_modules).
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { fakeGlabs, visualChecks } from "./acceptance-visual.mjs";
import { brainstormChecks } from "./acceptance-brainstorm.mjs";

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const zip = path.resolve(arg("--zip") ?? "");
const base = path.resolve(arg("--base") ?? "");
const out = path.resolve(arg("--out") ?? "ci-out/acceptance");
fs.mkdirSync(out, { recursive: true });
if (process.platform !== "win32") { console.error("Windows only"); process.exit(2); }

const WINDIR = process.env.SystemRoot || process.env.windir || "C:\\Windows";
const POWERSHELL = path.join(WINDIR, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const TITLE = "Проверка переноса — канал «Психология»";
const FAKE = { YOUTUBE_API_KEY: "AIzaSyACCEPTANCE-fake-youtube-0001", ANYMODEL_API_KEY: "am-ACCEPTANCE-fake-anymodel-0002" };
const OLD_PASSWORD = "old-pass-123-acceptance";

// ---------- reporting ----------
const results = [];
const lines = [];
function note(s) { const line = `[${new Date().toISOString().slice(11, 19)}] ${s}`; console.log(line); lines.push(line); }
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail: String(detail ?? "").slice(0, 3000) });
  note(`${ok ? "PASS" : "FAIL"} ${name}${detail && !ok ? " — " + String(detail).slice(0, 600) : ""}`);
  return !!ok;
}
async function phase(name, fn) {
  note(`=== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: без непредвиденных ошибок`, false, e?.stack || e); }
}

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } };
function pidAlive(pid) { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } }
async function waitFor(fn, ms, every = 300) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(every); } return null; }
function ps(script, env = {}, timeout = 120_000) {
  const full = "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;" + script;
  const r = spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(full, "utf16le").toString("base64")],
    { env: { ...process.env, ...env }, encoding: "utf8", timeout, windowsHide: true });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
// Collect output; resolve on process exit (detached grandchildren may keep pipes open).
function run(file, args, { env, cwd, timeout = 240_000, verbatim = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { env, cwd, windowsHide: true, windowsVerbatimArguments: verbatim, stdio: ["ignore", "pipe", "pipe"] });
    let outText = "", errText = "";
    child.stdout.on("data", (c) => { outText += c.toString("utf8"); });
    child.stderr.on("data", (c) => { errText += c.toString("utf8"); });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, timeout);
    child.once("exit", async (code) => { clearTimeout(timer); await sleep(400); resolve({ code, out: outText, err: errText }); });
    child.once("error", (e) => { clearTimeout(timer); resolve({ code: -1, out: outText, err: String(e) }); });
  });
}
async function api(port, method, p, { body, cookie } = {}) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text, setCookie: r.headers.get("set-cookie") || "" };
  } catch (e) { return { status: 0, json: null, text: String(e), setCookie: "" }; }
}
async function portOpen(port) { const r = await api(port, "GET", "/api/auth/status"); return r.status === 200; }
function findLink(text) {
  const m = /LINK (http:\/\/127\.0\.0\.1:(\d+)\/\?launch=([0-9a-f]{64}))/.exec(text);
  return m ? { url: m[1], port: Number(m[2]), token: m[3] } : null;
}
async function session(port, token) {
  const r = await api(port, "POST", "/api/auth/launch", { body: { token } });
  const cookie = /ts_session=[^;]+/.exec(r.setCookie)?.[0] ?? "";
  return { status: r.status, cookie };
}
function treeContains(dir, needles, skipBigger = 20 * 1048576) {
  const hits = [];
  const walk = (d) => {
    let entries = []; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        try { if (fs.statSync(p).size > skipBigger) continue; const t = fs.readFileSync(p).toString("latin1"); for (const n of needles) if (t.includes(n)) hits.push(`${path.relative(dir, p)}: ${n.slice(0, 12)}…`); } catch { /* locked */ }
      }
    }
  };
  walk(dir);
  return hits;
}

// The user's environment: no Node.js on PATH (the package must bring its own).
const KEEP = ["USERPROFILE", "APPDATA", "LOCALAPPDATA", "SystemRoot", "SystemDrive", "windir", "TEMP", "TMP", "COMPUTERNAME", "USERNAME", "USERDOMAIN", "HOMEDRIVE", "HOMEPATH", "ProgramFiles", "ProgramFiles(x86)", "ProgramData", "PATHEXT", "ComSpec", "OS", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "PUBLIC", "ALLUSERSPROFILE", "PSModulePath"];
const userEnv = Object.fromEntries(KEEP.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
userEnv.PATH = [path.join(WINDIR, "System32"), WINDIR, path.join(WINDIR, "System32", "Wbem"), path.join(WINDIR, "System32", "WindowsPowerShell", "v1.0")].join(";");
const ciEnv = { ...userEnv, TUBESTUDIO_CI: "1", TUBESTUDIO_NO_BROWSER: "1", TUBESTUDIO_NO_DIALOGS: "1", TUBESTUDIO_PRINT_LINK: "1" };

// ---------- layout ----------
const versionName = path.basename(zip).replace(/-windows\.zip$/i, "");
const prog = path.join(base, versionName);
const dataDir = path.join(base, "TubeStudioData");
const legacyData = path.join(base, "apps", "server", "data");
const startCmd = (p = prog) => path.join(p, "Запустить TubeStudio.cmd");
const stopCmd = (p = prog) => path.join(p, "Остановить TubeStudio.cmd");
const desktop = ps("[Environment]::GetFolderPath('DesktopDirectory')").out;
const lnkPath = path.join(desktop, "TubeStudio.lnk");
const transcript = [];
async function launch(label, p = prog) {
  const r = await run("cmd.exe", ["/d", "/c", startCmd(p)], { env: ciEnv, cwd: p });
  transcript.push(`----- ${label} (код ${r.code})\n${r.out}\n${r.err}`);
  return { ...r, link: findLink(r.out) };
}
async function stopViaCmd(label, p = prog) {
  const r = await run("cmd.exe", ["/d", "/c", stopCmd(p)], { env: ciEnv, cwd: p });
  transcript.push(`----- ${label} (код ${r.code})\n${r.out}\n${r.err}`);
  return r;
}
function status(p = prog) {
  const r = spawnSync(path.join(p, "runtime", "node.exe"), [path.join(p, "app", "launcher", "launcher.mjs"), "--status"], { env: ciEnv, encoding: "utf8", timeout: 60_000 });
  try { return JSON.parse(r.stdout.trim().split(/\r?\n/).pop()); } catch { return null; }
}
// Read the .lnk through the Unicode shell API (the package's own script in read mode):
// WScript.Shell would show a Cyrillic folder as question marks even when the link is right.
function readShortcut() {
  const script = fs.readFileSync(path.join(prog, "app", "windows", "create-shortcut.ps1"), "utf8").replace(/^\uFEFF/, "");
  const r = ps(script, { TS_LNK_READ: lnkPath });
  try { return JSON.parse(r.out.split(/\r?\n/).filter(Boolean).pop()); } catch { return null; }
}
// Double-click equivalent: the Windows shell opens the .lnk (ShellExecute), no output captured.
function openShortcut() {
  return ps("Start-Process -FilePath $env:TS_LNK", { TS_LNK: lnkPath, TUBESTUDIO_CI: "1", TUBESTUDIO_NO_BROWSER: "1", TUBESTUDIO_NO_DIALOGS: "1" });
}
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name), to = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(from, to); else if (e.isFile()) fs.copyFileSync(from, to);
  }
}
const samePathCI = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
// A port nobody listens on: a service file left by a crash points to such a port.
const closedPort = () => new Promise((resolve) => { const srv = net.createServer().listen(0, "127.0.0.1", () => { const port = srv.address().port; srv.close(() => resolve(port)); }); });
function staleDescriptor(dir, pid, port) {
  fs.mkdirSync(dir, { recursive: true });
  const id = crypto.randomUUID(), file = path.join(dir, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify({ schema: 1, instance: id, pid, appPort: 8787, controlPort: port, token: crypto.randomBytes(32).toString("hex") }) + "\n");
  return file;
}
const descriptorsIn = (dir) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => readJson(path.join(dir, f))).filter(Boolean); } catch { return []; } };

let legacyPid = 0, legacyEnvBefore = "", legacyProjectFile = "";
// Stands in for "some other program": after a reboot Windows gives old process numbers to other programs.
let foreign = null, staleFiles = [];
let current = null; // { port, pid, cookie }

await phase("A. Старая версия 0.12.x запущена с ключами в .env", async () => {
  check("Старая версия собрана", exists(path.join(base, "apps", "server", "dist", "index.js")) && exists(path.join(base, "apps", "web", "dist", "index.html")), base);
  legacyEnvBefore = `# old TubeStudio settings\r\nDATA_DIR=./data\r\nPORT=8787\r\nAPP_PASSWORD=${OLD_PASSWORD}\r\nYOUTUBE_API_KEY=${FAKE.YOUTUBE_API_KEY}\r\nANYMODEL_API_KEY=${FAKE.ANYMODEL_API_KEY}\r\n`;
  fs.writeFileSync(path.join(base, ".env"), legacyEnvBefore);
  const logFd = fs.openSync(path.join(out, "legacy-server.log"), "a");
  const child = spawn(process.execPath, ["--env-file-if-exists=../../.env", "dist/index.js"], { cwd: path.join(base, "apps", "server"), env: { ...userEnv, PATH: process.env.PATH }, detached: true, windowsHide: true, stdio: ["ignore", logFd, logFd] });
  child.unref();
  legacyPid = child.pid;
  check("Старый сервер отвечает на 8787", await waitFor(() => portOpen(8787), 90_000));
  const login = await api(8787, "POST", "/api/auth/login", { body: { password: OLD_PASSWORD } });
  const cookie = login.setCookie.split(";")[0];
  check("Вход в старую версию по паролю", login.status === 200 && cookie, login.text);
  // A real user has saved settings at least once (here: the old defaults, limit off and "warn only").
  const saved = await api(8787, "PUT", "/api/settings", { body: { budget: { monthlyUsd: 0, mode: "warn" } }, cookie });
  check("В старой версии сохранены настройки", saved.status === 200 && exists(path.join(legacyData, "settings.json")), saved.text.slice(0, 300));
  const created = await api(8787, "POST", "/api/projects", { body: { title: TITLE }, cookie });
  check("В старой версии создан проект", created.status === 200 && created.json?.data?.id, created.text);
  legacyProjectFile = path.join(legacyData, "projects", `${created.json?.data?.id}.json`);
  check("Проект старой версии лежит в apps\\server\\data", exists(legacyProjectFile), legacyProjectFile);
  check("Старая версия записала канал остановки", descriptorsIn(path.join(base, ".tubestudio-control")).length >= 1);
});

await phase("A2. Служебные файлы старой версии после выключения компьютера", async () => {
  foreign = spawn(path.join(WINDIR, "System32", "PING.EXE"), ["-n", "3600", "127.0.0.1"], { windowsHide: true, stdio: "ignore", detached: true });
  foreign.unref();
  check("Запущена посторонняя программа (ping.exe)", await waitFor(() => pidAlive(foreign.pid), 10_000), foreign.pid);
  const gonePid = spawnSync(path.join(WINDIR, "System32", "cmd.exe"), ["/d", "/c", "exit 0"], { windowsHide: true }).pid;
  const control = path.join(base, ".tubestudio-control");
  staleFiles = [staleDescriptor(control, foreign.pid, await closedPort()), staleDescriptor(control, gonePid, await closedPort())];
  check("Служебные файлы с чужим и со свободным номером процесса лежат рядом с настоящим", staleFiles.every(exists) && descriptorsIn(control).length >= 3);
});

await phase("B. Распаковка нового архива рядом со старой версией", async () => {
  const r = ps("Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:TS_ZIP, $env:TS_DEST)", { TS_ZIP: zip, TS_DEST: base }, 600_000);
  check("Архив распакован стандартными средствами Windows", r.code === 0, r.err);
  for (const f of ["Запустить TubeStudio.cmd", "Остановить TubeStudio.cmd", "ПРОЧТИ-МЕНЯ.txt", "runtime\\node.exe", "app\\launcher\\launcher.mjs", "app\\apps\\server\\dist\\index.js", "app\\apps\\web\\dist\\index.html", "app\\windows\\start-hidden.ps1"])
    check(`В пакете есть ${f}`, exists(path.join(prog, f)));
  const readme = fs.readFileSync(path.join(prog, "ПРОЧТИ-МЕНЯ.txt"));
  check("ПРОЧТИ-МЕНЯ.txt в UTF-8 с BOM и CRLF", readme[0] === 0xef && readme[1] === 0xbb && readme.includes(Buffer.from("\r\n")));
  const sizeMb = fs.statSync(zip).size / 1048576;
  check(`Размер архива разумный (${sizeMb.toFixed(1)} МБ)`, sizeMb < 95, sizeMb);
});

await phase("C. Первый запуск «Запустить TubeStudio.cmd» (без Node.js в системе)", async () => {
  const where = spawnSync("where.exe", ["node"], { env: userEnv, encoding: "utf8" });
  check("Node.js недоступен в окружении пользователя", where.status !== 0, where.stdout);
  const r = await launch("первый запуск");
  check("Запуск завершился успешно", r.code === 0, r.out + r.err);
  check("Лаунчер напечатал ссылку входа", r.link, r.out);
  check("Старая версия остановлена мягко", await waitFor(() => !pidAlive(legacyPid), 30_000), r.out);
  check("Сообщение о переносе данных", /Перенесено файлов/.test(r.out), r.out);
  const m = readJson(path.join(dataDir, "migration.json"));
  check("migration.json создан", m, dataDir);
  check("Источник переноса — apps\\server\\data старой версии", m && path.resolve(m.from) === path.resolve(legacyData), m?.from);
  check("Версия источника записана", m?.fromVersion === "0.12.148-preview.1", m?.fromVersion);
  check("Ключи из .env импортированы", m?.envImported === true && m.importedNames?.includes("YOUTUBE_API_KEY") && m.importedNames?.includes("ANYMODEL_API_KEY"), JSON.stringify(m));
  check("Пароль старой версии не перенесён", !m?.importedNames?.includes("APP_PASSWORD"), JSON.stringify(m?.importedNames));
  const keys = path.join(dataDir, "secrets", "keys.json");
  const kj = readJson(keys);
  check("Хранилище ключей создано", kj, keys);
  check("Ключи защищены DPAPI Windows", kj?.protection === "dpapi", kj?.protection);
  const hits = treeContains(dataDir, Object.values(FAKE));
  check("Ключей нет открытым текстом нигде в TubeStudioData", hits.length === 0, hits.join("\n"));
  check("Старые данные не тронуты (проект на месте)", exists(legacyProjectFile));
  check("Старый .env не изменён", fs.readFileSync(path.join(base, ".env"), "utf8") === legacyEnvBefore);
  check("Устаревшие служебные файлы старой версии не помешали и не тронуты", staleFiles.length === 2 && staleFiles.every(exists));
  check("Посторонняя программа с номером из служебного файла не тронута", foreign && pidAlive(foreign.pid));
  if (!r.link) return;
  const st = status();
  current = { port: r.link.port, pid: st?.running?.pid };
  check("Статус лаунчера видит запущенный сервер", st?.running?.pid && pidAlive(st.running.pid), JSON.stringify(st));
  const anon = await api(r.link.port, "GET", "/api/auth/status");
  check("Без входа: вход требуется", anon.json?.data?.required === true && anon.json?.data?.authed === false, anon.text);
  check("Без входа: проекты закрыты (401)", (await api(r.link.port, "GET", "/api/projects")).status === 401);
  const pw = await api(r.link.port, "POST", "/api/auth/login", { body: { password: OLD_PASSWORD } });
  check("Старый пароль больше не открывает программу", pw.status !== 200 || !/ts_session=/.test(pw.setCookie), pw.status + " " + pw.text);
  const s1 = await session(r.link.port, r.link.token);
  check("Вход по ключу из ссылки", s1.status === 200 && s1.cookie, s1.status);
  const s2 = await session(r.link.port, r.link.token);
  check("Ключ из ссылки одноразовый", s2.status !== 200, s2.status);
  current.cookie = s1.cookie;
  const projects = await api(r.link.port, "GET", "/api/projects", { cookie: s1.cookie });
  check("Проект старой версии виден в новой", JSON.stringify(projects.json?.data ?? "").includes(TITLE), projects.text.slice(0, 500));
  const settings = await api(r.link.port, "GET", "/api/settings", { cookie: s1.cookie });
  check("Лимит расходов $20 в месяц, режим «блокировать»", settings.json?.data?.budget?.monthlyUsd === 20 && settings.json?.data?.budget?.mode === "block", JSON.stringify(settings.json?.data?.budget));
  const health = await api(r.link.port, "GET", "/api/health", { cookie: s1.cookie });
  const sec = health.json?.data?.secrets;
  check("Сервер подтверждает защиту ключей Windows", sec?.protectedByWindows === true && sec?.names?.includes("YOUTUBE_API_KEY") && sec?.names?.includes("ANYMODEL_API_KEY") && !sec?.error, JSON.stringify(sec));
  const conf = (health.json?.data?.keys ?? []).filter((k) => k.configured).map((k) => k.provider);
  check("Ключи YouTube и AnyModel подключены в программе", conf.includes("youtube") && conf.includes("anymodel"), JSON.stringify(conf));
  const version = await api(r.link.port, "GET", "/api/version", { cookie: s1.cookie });
  note(`Версия сервера: ${version.json?.data?.version}`);
  const lnk = readShortcut();
  check("Ярлык TubeStudio на рабочем столе создан", lnk && /powershell\.exe$/i.test(lnk.target) && lnk.args.includes(path.join(prog, "app", "windows", "start-hidden.ps1")), JSON.stringify(lnk));
  check("Путь в ярлыке с кириллицей без искажений", lnk && lnk.wd === prog && !/\?/.test(lnk.args + lnk.wd + lnk.icon), JSON.stringify(lnk));
  check("У ярлыка есть значок", lnk && lnk.icon.includes("tubestudio.ico") && exists(lnk.icon.replace(/,\d+$/, "")), lnk?.icon);
  check("Журнал лаунчера ведётся", exists(path.join(dataDir, "logs", "launcher.log")));
});

await phase("D. Повторный запуск ярлыком, пока программа открыта", async () => {
  const lnk = readShortcut();
  if (!lnk || !current) return check("Есть ярлык и запущенный сервер", false);
  const r = await run(lnk.target, [lnk.args], { env: ciEnv, cwd: lnk.wd, verbatim: true });
  transcript.push(`----- ярлык повторно (код ${r.code})\n${r.out}\n${r.err}`);
  const link = findLink(r.out);
  check("Ярлык открыл ссылку", r.code === 0 && link, r.out + r.err);
  check("Второй сервер не запущен (тот же порт и процесс)", link?.port === current.port && status()?.running?.pid === current.pid, JSON.stringify(status()));
  check("Новая ссылка даёт вход", link && (await session(link.port, link.token)).status === 200);
  check("Только один канал управления", descriptorsIn(path.join(dataDir, ".tubestudio-control")).length === 1);
});

await phase("E. Кнопка «Выход» (API) останавливает программу", async () => {
  if (!current) return;
  const r = await api(current.port, "POST", "/api/system/exit", { body: {}, cookie: current.cookie });
  check("Выход принят", r.status === 200, r.text);
  check("Процесс сервера завершился", await waitFor(() => !pidAlive(current.pid), 30_000));
  check("Блокировка данных снята", await waitFor(() => !exists(path.join(dataDir, ".tubestudio-server.lock")), 10_000));
  check("Канал управления закрыт", descriptorsIn(path.join(dataDir, ".tubestudio-control")).length === 0);
  current = null;
});

await phase("F. Двойной щелчок по ярлыку и остановка «Остановить TubeStudio.cmd»", async () => {
  const o = openShortcut();
  check("Windows открыл ярлык", o.code === 0, o.out + o.err);
  const st = await waitFor(() => { const s = status(); return s?.running?.pid && pidAlive(s.running.pid) ? s : null; }, 120_000, 1000);
  check("Ярлык запустил программу", st && await portOpen(st.running.port), JSON.stringify(st));
  const pid = st?.running?.pid;
  const s = await stopViaCmd("остановка");
  check("Остановка прошла", s.code === 0 && /остановлена/.test(s.out), s.out + s.err);
  check("Сервер завершился", await waitFor(() => !pidAlive(pid), 30_000));
});

await phase("G. После аварийного завершения программа запускается снова", async () => {
  const r = await launch("запуск перед аварией");
  const pid = status()?.running?.pid;
  check("Запущена", r.code === 0 && pid, r.out);
  spawnSync("taskkill.exe", ["/F", "/PID", String(pid)]);
  check("Процесс убит принудительно", await waitFor(() => !pidAlive(pid), 15_000));
  check("Осталась блокировка от убитого процесса", exists(path.join(dataDir, ".tubestudio-server.lock")));
  const r2 = await launch("запуск после аварии");
  check("Повторный запуск успешен", r2.code === 0 && r2.link && await portOpen(r2.link.port), r2.out + r2.err);
  check("Старая блокировка отложена в сторону", fs.readdirSync(dataDir).some((n) => n.startsWith(".tubestudio-server.lock.stale-")));
  await stopViaCmd("остановка после проверки G");
});

await phase("G2. Блокировка с номером, который Windows отдала другой программе", async () => {
  const r = await launch("запуск перед выключением");
  const pid = status()?.running?.pid;
  check("Запущена", r.code === 0 && pid, r.out);
  spawnSync("taskkill.exe", ["/F", "/PID", String(pid)]);
  check("Процесс убит (как при выключении компьютера)", await waitFor(() => !pidAlive(pid), 15_000));
  const owner = path.join(dataDir, ".tubestudio-server.lock", "owner.json");
  const o = readJson(owner);
  check("Осталась блокировка убитого процесса", o && o.pid === pid, JSON.stringify(o));
  if (!o || !foreign) return;
  // After the reboot the number from the lock and the service file belongs to another program.
  fs.writeFileSync(owner, JSON.stringify({ ...o, pid: foreign.pid }) + "\n");
  const control = path.join(dataDir, ".tubestudio-control");
  for (const f of fs.readdirSync(control).filter((n) => n.endsWith(".json"))) { const d = readJson(path.join(control, f)); if (d) fs.writeFileSync(path.join(control, f), JSON.stringify({ ...d, pid: foreign.pid }) + "\n"); }
  const asideBefore = fs.readdirSync(dataDir).filter((n) => n.startsWith(".tubestudio-server.lock.stale-")).length;
  const r2 = await launch("запуск после выключения");
  check("Запуск успешен, хотя номер из блокировки занят другой программой", r2.code === 0 && r2.link && await portOpen(r2.link.port), r2.out + r2.err);
  check("Старая блокировка отложена в сторону", fs.readdirSync(dataDir).filter((n) => n.startsWith(".tubestudio-server.lock.stale-")).length === asideBefore + 1);
  check("Устаревший служебный файл убран", descriptorsIn(control).every((d) => d.pid !== foreign.pid), JSON.stringify(descriptorsIn(control).map((d) => d.pid)));
  check("Посторонняя программа не тронута", pidAlive(foreign.pid));
  await stopViaCmd("остановка после проверки G2");
});

await phase("H. Повреждённый settings.json восстанавливается из копии", async () => {
  const file = path.join(dataDir, "settings.json");
  check("Есть резервная копия settings.json.bak", exists(`${file}.bak`));
  fs.writeFileSync(file, "{ повреждено");
  const r = await launch("запуск с повреждёнными настройками");
  check("Программа запустилась", r.code === 0 && r.link, r.out + r.err);
  if (!r.link) return;
  const s = await session(r.link.port, r.link.token);
  const settings = await api(r.link.port, "GET", "/api/settings", { cookie: s.cookie });
  check("Настройки читаются", settings.status === 200 && settings.json?.data?.budget?.monthlyUsd === 20, settings.text.slice(0, 300));
  check("Повреждённый файл сохранён для разбора", fs.readdirSync(dataDir).some((n) => n.startsWith("settings.json.damaged-")));
  current = { port: r.link.port, pid: status()?.running?.pid, cookie: s.cookie };
});

await phase("I. Обновление: новая версия распакована рядом и запущена", async () => {
  const next = path.join(base, "TubeStudio-9.9.9-test");
  copyTree(prog, next); // not fs.cpSync: it aborts Node 22 on Windows for non-ASCII paths
  const pkg = path.join(next, "app", "package.json");
  fs.writeFileSync(pkg, JSON.stringify({ ...readJson(pkg), version: "9.9.9-test" }, null, 2));
  const before = current?.pid;
  const r = await launch("запуск новой версии", next);
  check("Новая версия запустилась", r.code === 0 && r.link, r.out + r.err);
  check("Прежняя копия остановлена", before && await waitFor(() => !pidAlive(before), 30_000));
  const st = status(next);
  const desc = descriptorsIn(path.join(dataDir, ".tubestudio-control"));
  check("Работает сервер из новой папки", desc.length === 1 && path.resolve(desc[0].program ?? "") === path.resolve(next), JSON.stringify(desc.map((d) => d.program)));
  const s = r.link ? await session(r.link.port, r.link.token) : { cookie: "" };
  const projects = r.link ? await api(r.link.port, "GET", "/api/projects", { cookie: s.cookie }) : { json: null };
  check("Те же данные после обновления", JSON.stringify(projects.json?.data ?? "").includes(TITLE));
  check("Ярлык переключён на новую папку", (readShortcut()?.args ?? "").includes(next));
  const again = await launch("повторный запуск новой версии", next);
  check("Повторный запуск не перезапускает сервер", again.code === 0 && status(next)?.running?.pid === st?.running?.pid, again.out);
  await stopViaCmd("остановка новой версии", next);
  check("Остановлена", await waitFor(() => !pidAlive(st?.running?.pid), 30_000));
  // Back to the package under test.
  readShortcut();
  fs.rmSync(next, { recursive: true, force: true });
});

await phase("J. Браузер: вход по ссылке и кнопка «Выход»", async () => {
  const r = await launch("запуск для браузера");
  if (!check("Программа запущена", r.code === 0 && r.link, r.out + r.err)) return;
  const pid = status()?.running?.pid;
  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright-core");
  const chrome = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(exists);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const anon = await (await browser.newContext()).newPage();
    await anon.goto(`http://127.0.0.1:${r.link.port}/`);
    check("Без ссылки — подсказка открыть ярлыком", await anon.getByText("Пароль не нужен").first().waitFor({ timeout: 20_000 }).then(() => true, () => false));
    await anon.screenshot({ path: path.join(out, "browser-no-link.png") });
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(r.link.url);
    const exitBtn = page.getByTestId("exit-button");
    check("По ссылке открылась программа", await exitBtn.waitFor({ timeout: 30_000 }).then(() => true, () => false));
    check("Ключ убран из адресной строки", !page.url().includes("launch="), page.url());
    await page.screenshot({ path: path.join(out, "browser-app.png") });
    await page.reload();
    check("После обновления страницы вход сохраняется", await exitBtn.waitFor({ timeout: 20_000 }).then(() => true, () => false));
    // Finish the dashboard’s initial reads before testing an idle exit. Otherwise the
    // intended busy-work confirmation can appear while /api/projects is still loading.
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    await exitBtn.click();
    await page.getByTestId("exit-confirm").click();
    check("Экран «TubeStudio закрыта»", await page.getByText("TubeStudio закрыта").waitFor({ timeout: 30_000 }).then(() => true, () => false));
    await page.screenshot({ path: path.join(out, "browser-closed.png") });
    check("Сервер остановлен кнопкой «Выход»", await waitFor(() => !pidAlive(pid), 30_000));
    check("Нет ошибок JavaScript на странице", errors.length === 0, errors.join("\n"));
  } finally { await browser.close(); }
});

await phase("K. Старая версия осталась нетронутой", async () => {
  check("Старый .env на месте и не изменён", fs.readFileSync(path.join(base, ".env"), "utf8") === legacyEnvBefore);
  check("Старые данные на месте", exists(legacyProjectFile));
  check("Старая версия не запущена", !pidAlive(legacyPid));
  check("Служебные файлы старой версии не тронуты", staleFiles.length === 2 && staleFiles.every(exists));
});

await phase("L. Студия: канал, проверка сценария Shields и новые разделы", async () => {
  const r = await launch("запуск для Студии");
  if (!check("Программа запущена", r.code === 0 && r.link, r.out + r.err)) return;
  const pid = status()?.running?.pid;
  const shields = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "server", "test", "fixtures", "scripts", "shields-v1.txt"), "utf8");
  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright-core");
  const chrome = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(exists);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    const shot = (n) => page.screenshot({ path: path.join(out, `studio-${n}.png`) }).catch(() => {});
    const seen = (loc, ms = 20_000) => loc.first().waitFor({ timeout: ms }).then(() => true, () => false);
    const go = (route) => page.goto(`http://127.0.0.1:${r.link.port}${route}`);
    // The launch key is one-time: sign in once in the browser and reuse its session for API calls.
    await page.goto(r.link.url);
    if (!check("Вход по ссылке", await seen(page.getByTestId("exit-button"), 30_000))) return;
    const sid = (await ctx.cookies()).find((c) => c.name === "ts_session");
    const cookie = sid ? `ts_session=${sid.value}` : "";
    const made = await api(r.link.port, "POST", "/api/studio/channels", { cookie, body: { name: "Проверка Студии — Shields", language: "en", niche: "medieval weapons and armour history", lengthMin: 10 } });
    const channelId = made.json?.data?.id;
    check("Канал создан", made.status === 200 && !!channelId, made.text.slice(0, 300));
    const list = await api(r.link.port, "GET", "/api/studio/channels", { cookie });
    check("Канал в списке и активный", (list.json?.data?.channels ?? []).some((c) => c.id === channelId) && list.json?.data?.activeId === channelId, list.text.slice(0, 300));
    const lint = await api(r.link.port, "POST", "/api/studio/script/lint", { cookie, body: { text: shields, channelId } });
    const rules = new Set((lint.json?.data?.issues ?? []).filter((i) => i.severity === "error" || i.rule === "double-ending").map((i) => i.rule));
    check("Shields: описательное вступление, оговорки и повтор вывода найдены", lint.status === 200 && ["opening-descriptive", "hedges", "double-ending"].every((x) => rules.has(x)), `${lint.status} ${[...rules].join(", ")} ${lint.text.slice(0, 200)}`);
    const ideas = await api(r.link.port, "GET", `/api/studio/channels/${channelId}/ideas?limit=5`, { cookie });
    check("Идеи канала читаются", ideas.status === 200 && Array.isArray(ideas.json?.data?.ideas), ideas.text.slice(0, 300));
    const fcBad = await api(r.link.port, "POST", "/api/studio/script/factcheck", { cookie, body: { channelId } });
    const fcMissing = await api(r.link.port, "POST", "/api/studio/script/factcheck", { cookie, body: { channelId, projectId: "missing-project" } });
    check("Проверка фактов: маршрут отвечает понятными ошибками без платных запросов", fcBad.status === 400 && fcMissing.status === 404, `${fcBad.status} ${fcBad.text.slice(0, 200)} | ${fcMissing.status} ${fcMissing.text.slice(0, 200)}`);
    const acc = await api(r.link.port, "GET", "/api/studio/voice/account", { cookie });
    check("Без ключа Lumean — понятная подсказка", acc.json?.error?.code === "KEY_MISSING", acc.text.slice(0, 300));
    await go("/");
    check("Панель: блок «Студия»", await seen(page.getByTestId("studio-widget")));
    await shot("dashboard");
    await go("/channels");
    check("Каналы: карточка канала", await seen(page.getByTestId("channel-card")));
    await shot("channels");
    await go("/ideas");
    check("Идеи для канала: кнопка «Найти идеи»", await seen(page.getByRole("button", { name: "Найти идеи" })));
    await shot("ideas");
    await go("/studio/script");
    check("Сценарий: переключатель «Проверка фактов готового текста»", await seen(page.getByText("Проверка фактов готового текста")));
    check("Сценарий: кнопка «Проверить факты — платно» для своего текста", await seen(page.getByRole("button", { name: "Проверить факты — платно" })));
    const own = page.getByLabel("Свой текст для проверки");
    if (check("Сценарий: поле «Свой текст для проверки»", await seen(own))) {
      await own.fill(shields);
      await page.getByRole("button", { name: "Проверить", exact: true }).click();
      const report = page.getByTestId("lint-report");
      const shown = await seen(report);
      const text = shown ? await report.innerText() : "";
      check("Сценарий: отчёт проверки на странице", shown && /Описательное вступление/.test(text) && /Оговорок/.test(text), text.slice(0, 400));
      await report.scrollIntoViewIfNeeded().catch(() => {});
      await shot("script-lint");
    }
    await go("/studio/voice");
    check("Озвучка: подсказка «Нужен ключ Lumean»", await seen(page.getByText("Нужен ключ Lumean")));
    await shot("voice");
    await go("/help");
    check("Справка: раздел «Студия»", await seen(page.getByText("Идеи для канала (Радар)")));
    check("Нет ошибок JavaScript в разделах Студии", errors.length === 0, errors.join("\n"));
  } finally {
    await browser.close();
    await stopViaCmd("остановка после Студии");
    check("Остановлена", await waitFor(() => !pidAlive(pid), 30_000));
  }
});

await phase("N. Визуал: G-Labs на этом компьютере (имитация Webhook, квота не тратится)", async () => {
  const gl = await fakeGlabs();
  const r = await launch("запуск для Визуала");
  if (!check("N: программа запущена", r.code === 0 && r.link, r.out + r.err)) { await gl.close(); return; }
  const pid = status()?.running?.pid;
  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright-core");
  const chrome = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(exists);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(r.link.url);
    if (!check("N: вход по ссылке", await page.getByTestId("exit-button").first().waitFor({ timeout: 30_000 }).then(() => true, () => false))) return;
    const sid = (await ctx.cookies()).find((c) => c.name === "ts_session");
    await visualChecks({ port: r.link.port, cookie: sid ? `ts_session=${sid.value}` : "", page, gl, dataDir, out, errors }, { check, api, waitFor, exists, readJson, samePathCI, treeContains });
    await brainstormChecks({ port: r.link.port, cookie: sid ? `ts_session=${sid.value}` : "", page, out, errors }, { check, api });
  } finally {
    await browser.close();
    await stopViaCmd("остановка после Визуала");
    check("N: остановлена", await waitFor(() => !pidAlive(pid), 30_000));
    await gl.close();
  }
});

await phase("M. Как у пользователя: старая версия в «Версия_33\\TubeStudio-main», архив распакован через «Извлечь всё»", async () => {
  const top = path.join(path.dirname(path.dirname(base)), "Проверка M");
  fs.rmSync(top, { recursive: true, force: true });
  const home2 = path.join(top, "Программы", "TubeStudio");
  const old2 = path.join(home2, "Версия_33", "TubeStudio-main"), oldData2 = path.join(old2, "apps", "server", "data");
  fs.mkdirSync(path.join(old2, "apps", "server"), { recursive: true });
  fs.writeFileSync(path.join(old2, "package.json"), JSON.stringify({ name: "tubestudio", private: true, version: "0.12.148-preview.1" }, null, 2));
  fs.writeFileSync(path.join(old2, ".env"), `DATA_DIR=./data\r\nYOUTUBE_API_KEY=${FAKE.YOUTUBE_API_KEY}\r\nANYMODEL_API_KEY=${FAKE.ANYMODEL_API_KEY}\r\n`);
  copyTree(legacyData, oldData2); // the real data of the old version from phase A
  // Left by the power-off: the lock and the service file, their number now used by another program.
  const lock2 = path.join(oldData2, ".tubestudio-server.lock");
  fs.mkdirSync(lock2, { recursive: true });
  fs.writeFileSync(path.join(lock2, "owner.json"), JSON.stringify({ schema: 1, id: crypto.randomUUID(), pid: foreign?.pid ?? 4, startedAt: new Date(Date.now() - 86_400_000).toISOString(), version: "0.12.148-preview.1" }) + "\n");
  const stale2 = staleDescriptor(path.join(old2, ".tubestudio-control"), foreign?.pid ?? 4, await closedPort());
  // "Extract all" keeps the archive name as an extra folder.
  const wrapper = path.join(home2, path.basename(zip).replace(/\.zip$/i, ""));
  const prog2 = path.join(wrapper, versionName);
  copyTree(prog, prog2);
  const env2 = { ...ciEnv, TUBESTUDIO_NO_SHORTCUT: "1" };
  const data2 = path.join(home2, "TubeStudioData");
  const start2 = async (label) => {
    const r = await run("cmd.exe", ["/d", "/c", startCmd(prog2)], { env: env2, cwd: prog2 });
    transcript.push(`----- M: ${label} (код ${r.code})\n${r.out}\n${r.err}`);
    return { ...r, link: findLink(r.out) };
  };
  const stop2 = async (label) => {
    const r = await run("cmd.exe", ["/d", "/c", stopCmd(prog2)], { env: env2, cwd: prog2 });
    transcript.push(`----- M: ${label} (код ${r.code})\n${r.out}\n${r.err}`);
    return r;
  };
  const projectsOf = async (link) => { const s = await session(link.port, link.token); return { s, p: await api(link.port, "GET", "/api/projects", { cookie: s.cookie }) }; };

  const r = await start2("первый запуск");
  check("M: запуск успешен, несмотря на блокировку и служебный файл после выключения", r.code === 0 && r.link, r.out + r.err);
  check("M: данные в общей папке TubeStudio, а не внутри папки архива", exists(path.join(data2, "migration.json")) && !exists(path.join(wrapper, "TubeStudioData")), data2);
  const m = readJson(path.join(data2, "migration.json"));
  check("M: перенесено из «Версия_33\\TubeStudio-main\\apps\\server\\data»", m && samePathCI(m.from, oldData2), m?.from);
  check("M: ключи из .env старой версии импортированы", m?.envImported === true && m.importedNames?.includes("YOUTUBE_API_KEY"), JSON.stringify(m));
  if (r.link) { const { p } = await projectsOf(r.link); check("M: проект старой версии виден", JSON.stringify(p.json?.data ?? "").includes(TITLE), p.text.slice(0, 300)); }
  check("M: блокировка и служебный файл старой версии не тронуты", exists(path.join(lock2, "owner.json")) && exists(stale2));
  check("M: посторонняя программа не тронута", foreign && pidAlive(foreign.pid));
  const s1 = await stop2("остановка");
  check("M: остановлена", s1.code === 0 && /остановлена/.test(s1.out), s1.out + s1.err);

  // An earlier 1.x unpacked into its own archive-named folder: its newer data are taken (old ones stay).
  const earlier = path.join(home2, "TubeStudio-1.1.0-windows", "TubeStudioData");
  copyTree(data2, earlier);
  fs.rmSync(data2, { recursive: true, force: true });
  const now = new Date();
  fs.utimesSync(path.join(earlier, "settings.json"), now, now);
  const r2 = await start2("запуск рядом с данными прежней 1.x");
  check("M2: запуск успешен", r2.code === 0 && r2.link, r2.out + r2.err);
  const m2 = readJson(path.join(data2, "migration.json"));
  check("M2: взяты более свежие данные 1.x из соседней папки", m2 && samePathCI(m2.from, earlier), m2?.from);
  if (r2.link) {
    const { s, p } = await projectsOf(r2.link);
    check("M2: проекты на месте", JSON.stringify(p.json?.data ?? "").includes(TITLE), p.text.slice(0, 300));
    const health = await api(r2.link.port, "GET", "/api/health", { cookie: s.cookie });
    const conf = (health.json?.data?.keys ?? []).filter((k) => k.configured).map((k) => k.provider);
    check("M2: ключи на месте (защита Windows)", conf.includes("youtube") && conf.includes("anymodel"), JSON.stringify(conf));
  }
  check("M2: данные прежней 1.x не тронуты", exists(path.join(earlier, "settings.json")));
  const s2 = await stop2("остановка M2");
  check("M2: остановлена", s2.code === 0, s2.out + s2.err);
  for (const d of descriptorsIn(path.join(data2, ".tubestudio-control"))) if (pidAlive(d.pid)) spawnSync("taskkill.exe", ["/F", "/PID", String(d.pid)]);
  try { fs.rmSync(top, { recursive: true, force: true }); } catch { /* a file may still be locked */ }
});

// ---------- cleanup and report ----------
if (foreign && pidAlive(foreign.pid)) spawnSync("taskkill.exe", ["/F", "/PID", String(foreign.pid)]);
for (const d of descriptorsIn(path.join(dataDir, ".tubestudio-control"))) if (pidAlive(d.pid)) spawnSync("taskkill.exe", ["/F", "/PID", String(d.pid)]);
if (pidAlive(legacyPid)) spawnSync("taskkill.exe", ["/F", "/PID", String(legacyPid)]);
for (const f of ["launcher.log", "server-console.log", "app.log"]) { try { fs.copyFileSync(path.join(dataDir, "logs", f), path.join(out, f)); } catch { /* absent */ } }
fs.writeFileSync(path.join(out, "launcher-transcript.txt"), transcript.join("\n\n"));
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(out, "acceptance.json"), JSON.stringify({ zip: path.basename(zip), base, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
fs.writeFileSync(path.join(out, "acceptance.txt"), [`Пройдено: ${results.length - failed.length} из ${results.length}`, ...results.map((r) => `${r.ok ? "OK  " : "FAIL"} ${r.name}${r.ok ? "" : " — " + r.detail.slice(0, 800)}`), "", ...lines].join("\r\n"));
note(`ИТОГ: ${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
