// Read-only installation checks. Never load .env, provider credentials or application data.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PS='System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const FILES=['stop-windows.bat','start-windows.bat','update-windows.bat','create-desktop-shortcut.bat','diagnose-windows.bat','windows/install-shortcut.ps1','windows/launch.ps1','windows/prepare-update.ps1','windows/launch.vbs'];
const check=(id,status,message)=>({id,status,message});
export async function inspectWindowsFiles(root){
 const result=[];
 for(const name of FILES){
  let b;try{b=await fs.readFile(path.join(root,name));}catch{result.push(check(name,'FAIL','Не найден обязательный файл запуска'));continue;}
  let s;try{s=new TextDecoder('utf-8',{fatal:true}).decode(b);}catch{result.push(check(name,'FAIL','Некорректная кодировка UTF-8'));continue;}
  if([...b].some(x=>x<32&&![9,10,13].includes(x))){result.push(check(name,'FAIL','Обнаружен недопустимый управляющий символ'));continue;}
  if(name.endsWith('.bat')&&(/(^|[^\r])\n/.test(s)||/\r(?!\n)/.test(s))){result.push(check(name,'FAIL','Для BAT требуется формат строк CRLF'));continue;}
  if(['start-windows.bat','update-windows.bat','create-desktop-shortcut.bat'].includes(name)&&!s.includes('%SystemRoot%\\'+PS)){result.push(check(name,'FAIL','Неверный путь к Windows PowerShell'));continue;}
  if(name.endsWith('.ps1')&&/[^\x00-\x7f]/.test(s)&&!(b[0]===239&&b[1]===187&&b[2]===191)){result.push(check(name,'FAIL','PowerShell 5.1: требуется UTF-8 BOM для русского текста'));continue;}
  result.push(check(name,'PASS','Файл запуска: кодировка, управляющие символы и применимые правила проверены'));
 }
 for(const name of ['windows/server-control.mjs','windows/tubestudio.ico','scripts/windows-check.mjs','package.json']){
  try{const s=await fs.stat(path.join(root,name));result.push(check(name,s.isFile()&&s.size>0?'PASS':'FAIL','Наличие обязательного файла'));}catch{result.push(check(name,'FAIL','Не найден обязательный файл'));}
 }
 return result;
}
export function makeShortcutProbe(root){
 // Encode paths instead of interpolating them into PowerShell syntax. No Save(), Invoke-* or process start.
 const encoded=Buffer.from(root,'utf8').toString('base64');
 return `$ErrorActionPreference = 'Stop'
$root = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
$shell = New-Object -ComObject WScript.Shell
$candidates = @([Environment]::GetFolderPath('DesktopDirectory'))
try { $candidates += [string]$shell.SpecialFolders.Item('Desktop') } catch { }
try { $reg = Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders'; if ($reg.Desktop) { $candidates += [Environment]::ExpandEnvironmentVariables([string]$reg.Desktop) } } catch { }
$desktop = $candidates | Where-Object { $_ -and [IO.Path]::IsPathRooted($_) -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -First 1
$r = @{ desktopFound = [bool]$desktop; shortcutFound = $false; targetMatches = $false; directoryMatches = $false; argumentsMatch = $false; iconMatches = $false }
if ($desktop) {
 $link = Join-Path $desktop 'TubeStudio.lnk'
 if (Test-Path -LiteralPath $link -PathType Leaf) {
  $r.shortcutFound = $true
  $s = $shell.CreateShortcut($link)
  $r.targetMatches = $s.TargetPath -ieq (Join-Path $env:WINDIR 'System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  $r.directoryMatches = $s.WorkingDirectory -ieq $root
  $expected = '-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $root 'windows\\launch.ps1') + '"'
  $r.argumentsMatch = $s.Arguments -ceq $expected
  $r.iconMatches = $s.IconLocation -ieq ((Join-Path $root 'windows\\tubestudio.ico') + ',0')
 }
}
$r | ConvertTo-Json -Compress`;
}
export function inspectShortcutResult(raw){
 const keys=['desktopFound','shortcutFound','targetMatches','directoryMatches','argumentsMatch','iconMatches'];
 if(!raw||typeof raw!=='object'||keys.some(k=>typeof raw[k]!=='boolean'))return [check('shortcut','FAIL','Не удалось проверить структуру ответа Windows')];
 if(!raw.desktopFound)return [check('desktop','FAIL','Windows не вернула доступную папку рабочего стола')];
 if(!raw.shortcutFound)return [check('shortcut','FAIL','Ярлык отсутствует на рабочем столе: запустите create-desktop-shortcut.bat')];
 return [check('shortcut-target',raw.targetMatches?'PASS':'FAIL','Путь PowerShell в существующем ярлыке'),check('shortcut-folder',raw.directoryMatches?'PASS':'FAIL','Ярлык относится к этой папке установки'),check('shortcut-arguments',raw.argumentsMatch?'PASS':'FAIL','Команда ярлыка запускает windows/launch.ps1 из этой установки'),check('shortcut-icon',raw.iconMatches?'PASS':'WARN','Иконка существующего ярлыка')];
}
export function summarizeChecks(checks){return checks.some(c=>c.status==='FAIL')?1:0;}
export async function supportsNodeEnvFile(){
 // allowedNodeEnvironmentFlags lists NODE_OPTIONS flags, not all CLI flags.
 // --help verifies this executable without loading any .env or launching the app.
 const env=Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
 try { const {stdout}=await exec(process.execPath,['--help'],{timeout:10000,maxBuffer:1048576,windowsHide:true,encoding:'utf8',env}); return /(?:^|\s)--env-file-if-exists(?:[=\s]|$)/m.test(stdout); } catch { return false; }
}
async function diagnose(root){
 const checks=[];
 checks.push(check('node-env-file',await supportsNodeEnvFile()?'PASS':'FAIL','Поддержка Node.js флага запуска --env-file-if-exists; при FAIL установите актуальный Node.js LTS'));
 for(const name of ['node_modules','apps/web/dist/index.html','apps/server/dist/index.js','apps/mcp/dist/index.js']){
  let exists=false;try{await fs.access(path.join(root,name));exists=true;}catch{}
  checks.push(check(name,exists?'PASS':'WARN','Наличие зависимостей/сборки; при отсутствии запустите update-windows.bat'));
 }
 if(process.platform!=='win32'){checks.push(check('native-windows','WARN','Проверка рабочего стола и .lnk не выполнена: запустите diagnose-windows.bat на Windows'));return {checks,native:false};}
 try{
  const ps=path.win32.join(process.env.SystemRoot||process.env.WINDIR||'C:\\Windows',PS);
  const {stdout}=await exec(ps,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(makeShortcutProbe(root),'utf16le').toString('base64')],{timeout:20000,maxBuffer:65536,windowsHide:true,encoding:'utf8'});
  checks.push(...inspectShortcutResult(JSON.parse(stdout.replace(/^\uFEFF/,'').trim())));
 }catch{checks.push(check('native-windows','FAIL','Проверка Windows недоступна или заблокирована; не отключайте защитные политики. Используйте start-windows.bat и сообщите текст ошибки ручного создания ярлыка.'));}
 return {checks,native:true};
}
async function main(){
 const diagnostic=process.argv.includes('--diagnose'),checks=await inspectWindowsFiles(ROOT);
 let native=true;
 if(diagnostic){const d=await diagnose(ROOT);checks.push(...d.checks);native=d.native;}
 let version='не прочитана';try{version=JSON.parse(await fs.readFile(path.join(ROOT,'package.json'),'utf8')).version;}catch{}
 const lines=[`TubeStudio: проверка файлов установки ${version}`,'Версия относится к исходникам, а не к запущенному серверу.',...(diagnostic?[`Node.js: ${process.version}`]:[]),...checks.map(c=>`${c.status} [${c.id}] ${c.message}`),'Проверка не запускает сервер, браузер, обновление, npm или API; не проверяет работу приложения целиком.','Не читаются .env, ключи, OAuth, проекты и логи приложения. Ярлык не создаётся и не изменяется.'];
 if(diagnostic)lines.push('Для проверки реального запуска: закройте диагностику и запустите ярлык вручную. Результат PASS не является живой приёмкой.');
 const report=lines.join('\r\n')+'\r\n';console.log(report);
 if(process.argv.includes('--report')){
  let saved=false;
  for(const folder of [path.join(ROOT,'launcher-logs'),path.join(os.tmpdir(),'TubeStudio-launcher-logs')]){
   try{await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'windows-check.log'),report,'utf8');console.log(folder===path.join(ROOT,'launcher-logs')?'Отчёт: launcher-logs\\windows-check.log':'Отчёт: %TEMP%\\TubeStudio-launcher-logs\\windows-check.log');saved=true;break;}catch{}
  }
  if(!saved)console.log('WARN Отчёт не записан. Скопируйте строки PASS/WARN/FAIL из окна.');
 }
 process.exitCode=summarizeChecks(checks)||(diagnostic&&!native?2:0);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('FAIL Проверка установки не завершилась; используйте ручной запуск. Секреты не выводились.');process.exitCode=1;});
