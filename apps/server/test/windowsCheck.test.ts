import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {inspectWindowsFiles,makeShortcutProbe,inspectShortcutResult,summarizeChecks,supportsNodeEnvFile} from '../../../scripts/windows-check.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
async function fixture(fn:(dir:string)=>Promise<void>){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-win-source-'));try{for(const name of ['stop-windows.bat','windows/server-control.mjs','start-windows.bat','update-windows.bat','create-desktop-shortcut.bat','diagnose-windows.bat','windows/install-shortcut.ps1','windows/launch.ps1','windows/prepare-update.ps1','windows/launch.vbs','windows/tubestudio.ico','scripts/windows-check.mjs','package.json']){await fs.mkdir(path.dirname(path.join(dir,name)),{recursive:true});await fs.copyFile(path.join(root,name),path.join(dir,name));}await fn(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}
const good={desktopFound:true,shortcutFound:true,targetMatches:true,directoryMatches:true,argumentsMatch:true,iconMatches:true};
test('Windows files pass portable byte/path checks; not native execution',async()=>{assert.equal(summarizeChecks(await inspectWindowsFiles(root)),0);});
test('Windows manual shortcut BAT has exact literal PowerShell path and no vertical tab',async()=>{const b=await fs.readFile(path.join(root,'create-desktop-shortcut.bat'));assert.equal(b.includes(11),false);assert.ok(b.toString().includes('%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'));});
test('Windows checker detects original vertical-tab regression',async()=>fixture(async dir=>{const p=path.join(dir,'create-desktop-shortcut.bat'),s=await fs.readFile(p,'utf8');await fs.writeFile(p,s.replace('\\v1.0','\x0b1.0'));const c=await inspectWindowsFiles(dir);assert.equal(c.find(x=>x.id==='create-desktop-shortcut.bat')?.status,'FAIL');assert.equal(summarizeChecks(c),1);}));
test('Windows checker rejects other controls, invalid UTF8 and missing required files',async()=>{for(const mode of ['control','utf8','missing'])await fixture(async dir=>{const p=path.join(dir,'windows/launch.ps1');if(mode==='missing')await fs.unlink(p);else await fs.writeFile(p,mode==='control'?Buffer.from('a\x00b'):Buffer.from([0xff,0xfe]));assert.equal(summarizeChecks(await inspectWindowsFiles(dir)),1);});});
test('Windows checker rejects LF BAT and a visually similar wrong PowerShell path',async()=>{for(const mode of ['lf','path'])await fixture(async dir=>{const p=path.join(dir,'create-desktop-shortcut.bat'),s=await fs.readFile(p,'utf8');await fs.writeFile(p,mode==='lf'?s.replaceAll('\r\n','\n'):s.replace('v1.0','vI.0'));assert.equal(summarizeChecks(await inspectWindowsFiles(dir)),1);});});
test('Windows PowerShell Cyrillic source requires BOM for Windows PowerShell 5.1',async()=>fixture(async dir=>{const p=path.join(dir,'windows/launch.ps1'),b=await fs.readFile(p);assert.deepEqual([...b.subarray(0,3)],[239,187,191]);await fs.writeFile(p,b.subarray(3));assert.equal(summarizeChecks(await inspectWindowsFiles(dir)),1);}));
test('Windows shortcut result requires booleans and does not trust malformed COM output',()=>{for(const r of [null,{},'text',{...good,argumentsMatch:'true'}])assert.equal(summarizeChecks(inspectShortcutResult(r)),1);});
test('Windows shortcut result detects missing redirected Desktop or absent link',()=>{assert.equal(summarizeChecks(inspectShortcutResult({...good,desktopFound:false})),1);assert.equal(summarizeChecks(inspectShortcutResult({...good,shortcutFound:false})),1);assert.equal(summarizeChecks(inspectShortcutResult(good)),0);});
test('Windows shortcut from another installation or changed launch command fails; icon only warns',()=>{for(const k of ['targetMatches','directoryMatches','argumentsMatch'])assert.equal(summarizeChecks(inspectShortcutResult({...good,[k]:false})),1);const c=inspectShortcutResult({...good,iconMatches:false});assert.equal(c.find(x=>x.id==='shortcut-icon')?.status,'WARN');assert.equal(summarizeChecks(c),0);});
test('Windows probe encodes Unicode quotes and special characters without executable interpolation',()=>{const folder="C:\\Моя папка & (тест)\\O'Brien 日本語";const s=makeShortcutProbe(folder);assert.ok(!s.includes(folder));assert.ok(s.includes(Buffer.from(folder).toString('base64')));assert.ok(s.includes("'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders'"));});
test('Windows probe reads existing shortcut only, never saves starts processes or calls API',()=>{const s=makeShortcutProbe(root);assert.ok(s.indexOf('Test-Path -LiteralPath $link -PathType Leaf')<s.indexOf('$shell.CreateShortcut($link)'));for(const v of ['.Save(','Start-Process','Stop-Process','Invoke-WebRequest','Invoke-RestMethod','.env','oauth.json','CommandLine'])assert.ok(!s.includes(v),v);assert.ok(s.includes('$r | ConvertTo-Json -Compress'));});
test('Windows diagnostic entry retains code and pauses, has no provider or data commands',async()=>{const s=await fs.readFile(path.join(root,'diagnose-windows.bat'),'utf8');for(const part of ['where node','--diagnose --report','set "CHECK_RESULT=%ERRORLEVEL%"','exit /b %CHECK_RESULT%','pause'])assert.ok(s.includes(part),part);for(const part of ['npm install','npm start','--env-file','APP_PASSWORD','YOUTUBE_API_KEY'])assert.ok(!s.includes(part),part);});

test('Windows diagnostic checks actual Node CLI support rather than NODE_OPTIONS allowlist',async()=>{assert.equal(await supportsNodeEnvFile(),true);});

const cleanEnv=()=>Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]!]));
test('Windows diagnostic CLI on Linux reports incomplete native check and only writes its explicit report',{skip:process.platform==='win32'},async()=>fixture(async dir=>{
 const marker='PRIVATE_SENTINEL_NOT_FOR_DIAGNOSTICS';const secret=path.join(dir,'.env');await fs.writeFile(secret,'API_KEY='+marker);const before=await fs.readFile(secret);
 let result:any;try{await exec(process.execPath,[path.join(dir,'scripts/windows-check.mjs'),'--diagnose','--report'],{cwd:dir,env:{...cleanEnv(),API_KEY:marker}});assert.fail('must not claim native success on Linux');}catch(error){result=error;}
 assert.equal(result.code,2);assert.ok(result.stdout.includes('PASS [node-env-file]'));assert.ok(result.stdout.includes('WARN [native-windows]'));assert.ok(!result.stdout.includes('FAIL ['));assert.ok(!result.stdout.includes(marker));
 const report=await fs.readFile(path.join(dir,'launcher-logs/windows-check.log'),'utf8');assert.ok(result.stdout.startsWith(report));assert.ok(!report.includes(marker));assert.deepEqual(await fs.readFile(secret),before);
 assert.deepEqual((await fs.readdir(path.join(dir,'launcher-logs'))).sort(),['windows-check.log']);assert.ok(!(await fs.readdir(dir)).some(n=>n.endsWith('.lnk')));
}));
test('Windows file checker CLI returns failure without report or app launch on missing file',async()=>fixture(async dir=>{
 await fs.unlink(path.join(dir,'windows/launch.ps1'));let result:any;try{await exec(process.execPath,[path.join(dir,'scripts/windows-check.mjs')],{cwd:dir,env:cleanEnv()});assert.fail('must fail missing file');}catch(error){result=error;}
 assert.equal(result.code,1);assert.ok(result.stdout.includes('FAIL [windows/launch.ps1]'));assert.ok(!(await fs.readdir(dir)).includes('launcher-logs'));
}));
