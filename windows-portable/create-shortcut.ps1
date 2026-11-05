$ErrorActionPreference = 'Stop'
# Creates or updates the desktop shortcut for the portable TubeStudio.
# Input: environment variable TS_PROGRAM_DIR (the unpacked program folder).
$program = $env:TS_PROGRAM_DIR
if (-not $program -or -not (Test-Path -LiteralPath $program -PathType Container)) { throw 'TS_PROGRAM_DIR is not a folder' }
$shell = New-Object -ComObject WScript.Shell
$candidates = @([Environment]::GetFolderPath('DesktopDirectory'))
try { $candidates += [string]$shell.SpecialFolders.Item('Desktop') } catch { }
$desktop = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -First 1
if (-not $desktop) { throw 'Desktop folder not found' }
$ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$script = Join-Path $program 'app\windows\start-hidden.ps1'
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw 'start-hidden.ps1 not found' }
$lnk = Join-Path $desktop 'TubeStudio.lnk'
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = $ps
$s.Arguments = '-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $script + '"'
$s.WorkingDirectory = $program
$s.Description = 'TubeStudio'
$s.IconLocation = (Join-Path $program 'app\windows\tubestudio.ico') + ',0'
$s.Save()
$check = $shell.CreateShortcut($lnk)
if ($check.Arguments -ne $s.Arguments -or $check.TargetPath -ine $ps) { throw 'Shortcut verification failed' }
Write-Output $lnk
