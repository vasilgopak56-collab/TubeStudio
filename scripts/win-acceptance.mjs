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
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

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
function readShortcut() {
  const r = ps("$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:TS_LNK); @{target=$s.TargetPath;args=$s.Arguments;wd=$s.WorkingDirectory;icon=$s.IconLocation} | ConvertTo-Json -Compress", { TS_LNK: lnkPath });
  try { return JSON.parse(r.out); } catch { return null; }
}
const descriptorsIn = (dir) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => readJson(path.join(dir, f))).filter(Boolean); } catch { return []; } };

let legacyPid = 0, legacyEnvBefore = "", legacyProjectFile = "";
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
  check("У ярлыка есть значок", lnk && lnk.icon.includes("tubestudio.ico"), lnk?.icon);
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

await phase("F. Запуск ярлыком и остановка «Остановить TubeStudio.cmd»", async () => {
  const lnk = readShortcut();
  const r = await run(lnk.target, [lnk.args], { env: ciEnv, cwd: lnk.wd, verbatim: true });
  transcript.push(`----- запуск ярлыком (код ${r.code})\n${r.out}\n${r.err}`);
  const link = findLink(r.out);
  check("Ярлык запустил программу", r.code === 0 && link && await portOpen(link.port), r.out + r.err);
  const pid = status()?.running?.pid;
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
  fs.cpSync(prog, next, { recursive: true });
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
});

// ---------- cleanup and report ----------
for (const d of descriptorsIn(path.join(dataDir, ".tubestudio-control"))) if (pidAlive(d.pid)) spawnSync("taskkill.exe", ["/F", "/PID", String(d.pid)]);
if (pidAlive(legacyPid)) spawnSync("taskkill.exe", ["/F", "/PID", String(legacyPid)]);
for (const f of ["launcher.log", "server-console.log", "app.log"]) { try { fs.copyFileSync(path.join(dataDir, "logs", f), path.join(out, f)); } catch { /* absent */ } }
fs.writeFileSync(path.join(out, "launcher-transcript.txt"), transcript.join("\n\n"));
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(out, "acceptance.json"), JSON.stringify({ zip: path.basename(zip), base, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
fs.writeFileSync(path.join(out, "acceptance.txt"), [`Пройдено: ${results.length - failed.length} из ${results.length}`, ...results.map((r) => `${r.ok ? "OK  " : "FAIL"} ${r.name}${r.ok ? "" : " — " + r.detail.slice(0, 800)}`), "", ...lines].join("\r\n"));
note(`ИТОГ: ${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
