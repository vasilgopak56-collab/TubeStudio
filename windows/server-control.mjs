// Windows stop helper. Authenticated loopback-only control; never force-kills or removes data locks.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export const HELPER_VERSION='2.1.0';
export function parseWindowsCommandLine(text){
 if(typeof text!=='string'||text.includes('\0'))throw new Error('INVALID_COMMAND');
 const args=[];let i=0;
 while(i<text.length){while(/[ \t]/.test(text[i]||'\0'))i++;if(i>=text.length)break;let arg='',quoted=false;
  while(i<text.length){if(!quoted&&/[ \t]/.test(text[i]))break;let slashes=0;while(text[i]==='\\'){slashes++;i++;}
   if(text[i]==='"'){arg+='\\'.repeat(Math.floor(slashes/2));if(slashes%2){arg+='"';i++;}else if(quoted&&text[i+1]==='"'){arg+='"';i+=2;}else{quoted=!quoted;i++;}}
   else{arg+='\\'.repeat(slashes);if(!quoted&&/[ \t]/.test(text[i]||'\0'))break;if(i<text.length){arg+=text[i];i++;}}
  }
  if(quoted)throw new Error('INVALID_COMMAND');args.push(arg);
 }
 return args;
}
export function configuredPort(envText='',inheritedPort){
 if(typeof envText!=='string'||envText.length>1024*1024)throw new Error('INVALID_ENV');
 let value=inheritedPort===undefined?undefined:String(inheritedPort).trim();
 if(value===undefined){for(const line of envText.replace(/^\uFEFF/,'').split(/\r?\n/)){const m=line.match(/^\s*(?:export\s+)?PORT\s*=\s*(.*?)\s*$/);if(!m)continue;const raw=m[1],quoted=raw.match(/^(["'])(\d*)\1\s*(?:#.*)?$/),bare=raw.match(/^(\d*)\s*(?:#.*)?$/);if(!quoted&&!bare)throw new Error('INVALID_PORT');value=quoted?quoted[2]:bare[1];}}
 if(value===undefined||value==='')return 8787;
 if(!/^\d+$/.test(value)||Number(value)<1||Number(value)>65535)throw new Error('INVALID_PORT');return Number(value);
}
const absolute=p=>typeof p==='string'&&/^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+[\\/])/i.test(p);
const canonical=p=>path.win32.normalize(p.replaceAll('/','\\')).toLowerCase();
export function ownsServer(record,root){
 if(!record||record.name?.toLowerCase()!=='node.exe'||!absolute(root))return false;
 let args;try{args=parseWindowsCommandLine(record.commandLine);}catch{return false;}
 if(!args.length||path.win32.basename(args.shift()).toLowerCase()!=='node.exe')return false;
 while(args.length){const a=args[0];if(a==='--'){args.shift();break;}
  if(a.startsWith('--env-file-if-exists=')||a.startsWith('--env-file=')){if(!a.split('=').slice(1).join('='))return false;args.shift();continue;}
  if(a==='--env-file-if-exists'||a==='--env-file'){if(args.length<2||!args[1]||args[1].startsWith('-'))return false;args.splice(0,2);continue;}
  break;
 }
 return args.length===1&&absolute(args[0])&&canonical(args[0])===canonical(path.win32.join(root,'apps','server','dist','index.js'));
}
export function makeStopPlan(records,root){
 if(!Array.isArray(records)||records.length>256)throw new Error('INVALID_PROBE');const plan=[],seen=new Set();
 for(const r of records){if(!Number.isSafeInteger(r.pid)||r.pid<1||!/^\d{4}-\d\d-\d\dT/.test(r.startedAt||''))throw new Error('INVALID_PROBE');
  if(!ownsServer(r,root))throw new Error('UNVERIFIED_OWNER');
  if(seen.has(r.pid)){const prev=plan.find(p=>p.pid===r.pid);if(prev.commandLine!==r.commandLine||prev.startedAt!==r.startedAt)throw new Error('INVALID_PROBE');continue;}
  seen.add(r.pid);plan.push({pid:r.pid,startedAt:r.startedAt,commandLine:r.commandLine});
 }
 return plan;
}
const encoding="$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false);";
export function probeScript(port){
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('INVALID_PORT');
 return `${encoding}
$ids = @(Get-NetTCPConnection -ErrorAction Stop | Where-Object { $_.State -eq 'Listen' -and $_.LocalPort -eq ${port} } | Select-Object -ExpandProperty OwningProcess -Unique)
$items = @(); foreach ($serverId in $ids) {
 $meta = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$serverId) -ErrorAction Stop
 $live = Get-Process -Id $serverId -ErrorAction Stop
 $items += @{ pid = [int]$serverId; name = [string]$meta.Name; commandLine = [string]$meta.CommandLine; startedAt = $live.StartTime.ToUniversalTime().ToString('o') }
}
@{ listeners = @($items) } | ConvertTo-Json -Depth 4 -Compress`;
}
// Read-only snapshot; never print or persist process command lines. A missing
// command line or malformed snapshot cannot be treated as proof of absence.
export function installationProcessScript(){
 return `${encoding}
$all = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop)
if ($all.Count -gt 1024) { throw 'PROCESS_SCAN_TOO_LARGE' }
$items = @(); foreach ($item in $all) {
 $items += @{ pid = [int]$item.ProcessId; name = [string]$item.Name; commandLine = [string]$item.CommandLine }
}
@{ processes = @($items) } | ConvertTo-Json -Depth 4 -Compress`;
}
export function assertNoPossibleInstallationProcesses(result,root,allowed){
 if(!absolute(root)||!result||!Array.isArray(result.processes)||result.processes.length>1024)throw Error('PROCESS_SCAN_UNAVAILABLE');
 const expected=new Set([canonical(path.win32.join(root,'apps','server','dist','index.js')),canonical(path.win32.join(root,'apps','server','src','index.ts'))]);
 const relative=new Set(['dist\\index.js','apps\\server\\dist\\index.js','src\\index.ts','apps\\server\\src\\index.ts']);
 let found=false;
 for(const r of result.processes){
  if(!r||!Number.isSafeInteger(r.pid)||r.pid<1||typeof r.name!=='string'||r.name.toLowerCase()!=='node.exe'||typeof r.commandLine!=='string'||!r.commandLine||r.commandLine.length>32768)throw Error('PROCESS_SCAN_UNAVAILABLE');
  let args;try{args=parseWindowsCommandLine(r.commandLine);}catch{throw Error('PROCESS_SCAN_UNAVAILABLE');}
  if(!args.length||path.win32.basename(args[0]).toLowerCase()!=='node.exe')throw Error('PROCESS_SCAN_UNAVAILABLE');
  if(allowed&&r.pid===allowed.pid){if(found||r.commandLine!==allowed.commandLine||!ownsServer(r,root))throw Error('PROCESS_CHANGED');found=true;continue;}
  if(ownsServer(r,root))throw Error('OTHER_SERVER_RUNNING');
  for(const arg of args.slice(1)){
   const candidates=[arg];if(arg.startsWith('--')&&arg.includes('='))candidates.push(arg.slice(arg.indexOf('=')+1));
   for(const v of candidates){if(!v)continue;const normalized=path.win32.normalize(v.replaceAll('/','\\')).toLowerCase();
    if(absolute(v)?expected.has(normalized):relative.has(normalized.replace(/^\.\\/,'')))throw Error('POSSIBLE_SERVER_RUNNING');
   }
  }
 }
 if(allowed&&!found)throw Error('PROCESS_CHANGED');
}
export function waitScript(plan,port){
 if(!Array.isArray(plan)||plan.length!==1||!Number.isInteger(port)||port<1||port>65535)throw new Error('INVALID_PLAN');
 const encoded=Buffer.from(JSON.stringify(plan[0]),'utf8').toString('base64');
 return `${encoding}
$expected = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
$live = Get-Process -Id ([int]$expected.pid) -ErrorAction SilentlyContinue
if (-not $live) {
 $remainingProcess = @(Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$expected.pid) -ErrorAction Stop)
 if ($remainingProcess.Count -ne 0) { throw 'PROCESS_NOT_VERIFIED' }
}
if ($live) {
 try {
  $null = $live.Handle
  $meta = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$expected.pid) -ErrorAction Stop
  if ($live.StartTime.ToUniversalTime().ToString('o') -cne $expected.startedAt -or $meta.CommandLine -cne $expected.commandLine -or $meta.Name -ine 'node.exe') { throw 'PROCESS_CHANGED' }
  if (-not $live.WaitForExit(8000)) { throw 'STOP_TIMEOUT' }
 } finally { $live.Dispose() }
}
$remaining = @(Get-NetTCPConnection -ErrorAction Stop | Where-Object { $_.State -eq 'Listen' -and $_.LocalPort -eq ${port} })
if ($remaining.Count -ne 0) { throw 'PORT_STILL_BUSY' }
@{ portFree = $true } | ConvertTo-Json -Compress`;
}
/** No secret is returned to the CLI or written to logs. Reject links and ambiguous files. */
export async function findControl(root,appPort,pid){
 const dir=path.join(root,'.tubestudio-control');let names;
 try {const st=await fs.lstat(dir);if(st.isSymbolicLink()||!st.isDirectory())throw Error('CONTROL_UNSAFE');names=await fs.readdir(dir);} catch(e){if(e.code==='ENOENT')throw Error('CONTROL_UNAVAILABLE');throw e;}
 if(names.length>1000)throw Error('CONTROL_UNSAFE');const matches=[];
 for(const name of names){if(!/^[0-9a-f-]{36}\.json$/i.test(name))throw Error('CONTROL_UNSAFE');const f=path.join(dir,name);const st=await fs.lstat(f);if(st.isSymbolicLink()||!st.isFile()||st.nlink!==1||st.size>4096)throw Error('CONTROL_UNSAFE');
  const h=await fs.open(f,constants.O_RDONLY|(process.platform==='win32'?0:(constants.O_NOFOLLOW||0)));let value;try{const stat=await h.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>4096)throw Error('CONTROL_UNSAFE');value=JSON.parse(await h.readFile('utf8'));}catch{throw Error('CONTROL_UNSAFE');}finally{await h.close();}
  if(!value||Object.keys(value).sort().join(',')!=='appPort,controlPort,instance,pid,schema,token'||value.schema!==1||typeof value.instance!=='string'||name!==value.instance+'.json'||!Number.isSafeInteger(value.pid)||value.pid<1||!Number.isInteger(value.appPort)||value.appPort<1||value.appPort>65535||!Number.isInteger(value.controlPort)||value.controlPort<1||value.controlPort>65535||typeof value.token!=='string'||!/^([0-9a-f]{64})$/.test(value.token))throw Error('CONTROL_UNSAFE');
  if(value.pid===pid&&value.appPort===appPort)matches.push(value);
 }
 if(matches.length!==1)throw Error(matches.length?'CONTROL_AMBIGUOUS':'CONTROL_UNAVAILABLE');return matches[0];
}
export async function sendControl(descriptor){
 return new Promise((resolve,reject)=>{let finished=false,text='';const s=net.createConnection({host:'127.0.0.1',port:descriptor.controlPort});
  const done=(e)=>{if(finished)return;finished=true;s.destroy();e?reject(Error(e)):resolve();};
  s.setTimeout(12000,()=>done('CONTROL_UNCERTAIN'));s.on('error',()=>done('CONTROL_UNCERTAIN'));s.on('close',()=>done('CONTROL_UNCERTAIN'));
  s.on('connect',()=>s.write(`STOP ${descriptor.token}\n`));s.on('data',b=>{text+=b.toString('utf8');if(text.length>80)return done('CONTROL_UNCERTAIN');if(text==='STOPPED\n')return done();if(text==='BUSY\n')return done('BUSY');if(text.includes('\n'))return done('CONTROL_UNCERTAIN');});
 });
}
export async function control(root,{dryRun=false,platform=process.platform,inheritedPort=process.env.PORT,readEnv=()=>fs.readFile(path.join(root,'.env'),'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;}),runPowerShell,find=findControl,send=sendControl}={}){
 if(platform!=='win32')throw new Error('WINDOWS_ONLY');
 const port=configuredPort(await readEnv(),inheritedPort);
 const run=runPowerShell|| (async script=>{const ps=path.win32.join(process.env.SystemRoot||process.env.WINDIR||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const {stdout}=await exec(ps,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:30000,maxBuffer:1024*1024,encoding:'utf8'});return JSON.parse(stdout.replace(/^\uFEFF/,'').trim());});
 const plan=makeStopPlan((await run(probeScript(port))).listeners,root);
 if(!plan.length){assertNoPossibleInstallationProcesses(await run(installationProcessScript()),root);return {status:'already-free',port,pids:[]};}
 if(plan.length!==1)throw Error('MULTIPLE_OWNERS');
 if(dryRun)return {status:'verified',port,pids:plan.map(p=>p.pid)};
 assertNoPossibleInstallationProcesses(await run(installationProcessScript()),root,plan[0]);
 const descriptor=await find(root,port,plan[0].pid);
 const fresh=makeStopPlan((await run(probeScript(port))).listeners,root);if(JSON.stringify(fresh)!==JSON.stringify(plan))throw Error('PROCESS_CHANGED');
 await send(descriptor);
 const result=await run(waitScript(plan,port));if(result?.portFree!==true)throw Error('STOP_NOT_CONFIRMED');
 assertNoPossibleInstallationProcesses(await run(installationProcessScript()),root);
 return {status:'stopped',port,pids:plan.map(p=>p.pid)};
}
export async function main(args=process.argv.slice(2)){
 try{
  if(args.some(x=>x!=='--dry-run')||args.length>1)throw new Error('INVALID_ARGS');
  const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
  const r=await control(root,{dryRun:args.includes('--dry-run')});
  if(r.status==='already-free')console.log(`Порт ${r.port} свободен; распознаваемый процесс этой установки не найден на момент проверки. Это не гарантия отсутствия скрытых или новых запусков.`);
  else if(r.status==='verified')console.log(`Проверка: сервер этой установки подтверждён. PID: ${r.pids.join(', ')}; порт ${r.port}. Ничего не остановлено.`);
  else console.log(`Сервер этой установки завершён. PID: ${r.pids.join(', ')}. Порт ${r.port} свободен. Подтверждена мягкая остановка. Данные и ключи скриптом не изменялись.`);
  return 0;
 }catch(e){
  const messages={OTHER_SERVER_RUNNING:'Возможен работающий сервер этой установки на другом порту. Обновление не продолжено; проверьте работающие окна TubeStudio. Если команда остановки уже отправлялась, выбранный сервер мог остановиться. Не завершайте чужие процессы.',POSSIBLE_SERVER_RUNNING:'Найден неоднозначный процесс с похожим путём сервера — он может относиться и к другой программе. Обновление не продолжено; ничего принудительно не завершено. Если команда уже отправлялась, выбранный сервер мог остановиться. Проверьте процессы вручную.',PROCESS_SCAN_UNAVAILABLE:'Не удалось надёжно проверить процессы Node.js. Обновление не продолжено; не отключайте защиту системы и не завершайте все node.exe.',WINDOWS_ONLY:'Этот помощник выполняется только на Windows.',UNVERIFIED_OWNER:'Порт занят процессом, принадлежность которого этой установке не подтверждена. Никто из найденных процессов не завершён. Для старого запуска через npm start/dist/index.js вернитесь в его окно и нажмите Ctrl+C; затем используйте новый start-windows.bat или ярлык.',INVALID_PORT:'Некорректный PORT. Проверьте PORT в .env и переменных среды; не присылайте остальные строки .env.',INVALID_ARGS:'Допустим только параметр --dry-run.',BUSY:'Сервер занят: дождитесь завершения задач, запросов и фонового обновления, закройте вкладки и повторите. Процесс не завершён.',CONTROL_UNAVAILABLE:'У запущенного сервера нет доступного канала мягкой остановки. Для старой версии остановите её штатным способом и следуйте инструкции к той версии; принудительная остановка автоматически не выполняется.',CONTROL_UNSAFE:'Файлы управления повреждены или небезопасны. Ничего не удалено и принудительная остановка не выполнялась.',CONTROL_AMBIGUOUS:'Найдено несколько записей управления: остановка не выполнена. Проверьте инструкцию.',CONTROL_UNCERTAIN:'Результат остановки неизвестен. Не повторяйте платные действия и не удаляйте блокировку: сначала проверьте состояние сервера и инструкцию.'};
  console.error('Ошибка: '+(messages[e.message]||'Остановка не подтверждена. Проверка процессов недоступна, процесс изменился или порт не освободился. Принудительное завершение не выполнялось. Проверьте состояние и инструкцию; не удаляйте блокировку при сомнениях.'));
  return 1;
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main();
