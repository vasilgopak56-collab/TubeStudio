import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const read=(p:string)=>fs.readFileSync(fileURLToPath(new URL('../../../'+p,import.meta.url)),'utf8');
test('Windows install and update refresh shortcut after successful build',()=>{
 for(const file of ['start-windows.bat','update-windows.bat']){
  const s=read(file);const i=s.indexOf('windows\\install-shortcut.ps1');
  assert.ok(i>s.lastIndexOf('call npm run build'));
  assert.ok(s.slice(i).includes('-Quiet'));
  assert.ok(s.slice(i).includes('if errorlevel 1 echo'));
 }
});
test('shortcut uses stable desktop name and absolute current installation paths',()=>{
 const s=read('windows/install-shortcut.ps1');
 for(const part of ['param([switch]$Quiet)',"GetFolderPath('DesktopDirectory')","'TubeStudio.lnk'",'$shortcut.WorkingDirectory = $root',"Join-Path $PSScriptRoot 'launch.ps1'",'$shortcut.Save()',"'launch.ps1', 'tubestudio.ico'",'if (-not $Quiet)'])assert.ok(s.includes(part),part);
 assert.ok(!s.includes('Read-Host'));
 assert.ok(!s.includes('Remove-Item'));
});

test('shortcut installer records actual desktop path and verifies saved link without VBScript',()=>{
 const s=read('windows/install-shortcut.ps1');
 for(const part of ['shortcut-install.log','SUCCESS:','ERROR:','User Shell Folders','SpecialFolders.Item','Test-Path -LiteralPath $shortcutPath','$saved.TargetPath','$saved.Arguments','powershell.exe'])assert.ok(s.includes(part),part);
 assert.ok(!s.includes("$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\\wscript.exe'"));
 const bat=read('create-desktop-shortcut.bat');
 assert.ok(bat.includes('set "SHORTCUT_RESULT=%ERRORLEVEL%"'));
 assert.ok(bat.includes('pause'));assert.ok(bat.includes('exit /b %SHORTCUT_RESULT%'));
});
