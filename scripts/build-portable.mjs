// Сборка портативной версии для Windows: папка TubeStudio-<версия>\ с встроенным Node.js.
//   node scripts/build-portable.mjs --node C:\path\node.exe --out release [--zip]
// Запускать после `npm ci && npm run build` на Windows (нужны Windows-версии модулей, например sharp).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const out = path.resolve(arg("--out", path.join(root, "release")));
const nodeExe = arg("--node", process.platform === "win32" ? process.execPath : "");
const name = `TubeStudio-${version}`;
const dest = path.join(out, name);
const app = path.join(dest, "app");

const need = ["apps/server/dist/index.js", "apps/web/dist/index.html", "apps/mcp/dist/index.js"];
for (const f of need) if (!fs.existsSync(path.join(root, f))) throw new Error(`Нет ${f}: сначала npm run build`);

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(app, { recursive: true });
const copy = (from, to = from) => fs.cpSync(path.join(root, from), path.join(app, to), { recursive: true });
for (const f of ["package.json", "package-lock.json", "apps/server/package.json", "apps/web/package.json", "apps/mcp/package.json"]) copy(f);
for (const d of ["apps/server/dist", "apps/server/prompts", "apps/web/dist", "apps/mcp/dist", "launcher", "extension", "knowledge"]) if (fs.existsSync(path.join(root, d))) copy(d);
fs.mkdirSync(path.join(app, "windows"), { recursive: true });
for (const f of ["create-shortcut.ps1", "start-hidden.ps1"]) copy(`windows-portable/${f}`, `windows/${f}`);
copy("windows/tubestudio.ico");

// Production dependencies of the server and MCP only (the web app ships pre-built), installed for THIS platform.
const npm = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--omit=dev", "--no-audit", "--no-fund", "--workspace", "apps/server", "--workspace", "apps/mcp"], { cwd: app, stdio: "inherit", shell: process.platform === "win32" });
if (npm.status !== 0) throw new Error("npm ci --omit=dev завершился с ошибкой");
// Workspace links (node_modules/@tubestudio/*) point back into app/apps — not needed at runtime.
fs.rmSync(path.join(app, "node_modules", "@tubestudio"), { recursive: true, force: true });

fs.mkdirSync(path.join(dest, "runtime"), { recursive: true });
if (nodeExe) fs.copyFileSync(nodeExe, path.join(dest, "runtime", process.platform === "win32" || nodeExe.endsWith(".exe") ? "node.exe" : "node"));
fs.copyFileSync(path.join(root, "windows-portable", "start.cmd"), path.join(dest, "Запустить TubeStudio.cmd"));
fs.copyFileSync(path.join(root, "windows-portable", "stop.cmd"), path.join(dest, "Остановить TubeStudio.cmd"));
// Notepad-friendly: UTF-8 with BOM and Windows line endings.
fs.writeFileSync(path.join(dest, "ПРОЧТИ-МЕНЯ.txt"), "\ufeff" + fs.readFileSync(path.join(root, "windows-portable", "README-RU.txt"), "utf8").replace(/\r?\n/g, "\r\n"));

const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).stdout?.trim() || "";
const nodeVersion = nodeExe ? spawnSync(nodeExe, ["-v"], { encoding: "utf8" }).stdout?.trim() : "";
fs.writeFileSync(path.join(app, "BUILD-INFO.json"), JSON.stringify({ version, commit, node: nodeVersion, builtAt: new Date().toISOString(), platform: process.platform }, null, 2) + "\n");

if (argv.includes("--zip")) {
  const zip = path.join(out, `${name}-windows.zip`);
  fs.rmSync(zip, { force: true });
  // 7-Zip with -mcu=on stores Cyrillic file names as UTF-8 (read correctly by Windows Explorer).
  const sevenZip = process.platform === "win32" ? spawnSync("7z", ["a", "-tzip", "-mx=7", "-mcu=on", zip, name], { cwd: out, stdio: "inherit", shell: true }) : null;
  if (!sevenZip || sevenZip.status !== 0) {
    const z = spawnSync("zip", ["-qr", "-9", zip, name], { cwd: out, stdio: "inherit" });
    if (z.status !== 0) throw new Error("Не удалось создать zip");
  }
  console.log(`ZIP ${zip} ${(fs.statSync(zip).size / 1048576).toFixed(1)} MB`);
}
console.log(`OK ${dest}`);
