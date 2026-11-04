param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'launcher-logs'
try { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
catch { $logDir = Join-Path $env:TEMP 'TubeStudio-launcher-logs'; New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$log = Join-Path $logDir 'shortcut-install.log'
function Write-Diagnostic([string]$Message) {
    $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $Message
    try { Add-Content -LiteralPath $log -Value $line -Encoding UTF8 } catch { }
    Write-Host $Message
}
try {
    Write-Diagnostic ('--- TubeStudio shortcut v0.12.2; installation: ' + $root)
    Write-Diagnostic ('Windows user: ' + [Security.Principal.WindowsIdentity]::GetCurrent().Name)
    foreach ($file in @('launch.ps1', 'tubestudio.ico')) {
        if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $file) -PathType Leaf)) {
            throw ('Не найден файл запуска: windows\' + $file + '. Распакуйте архив полностью.')
        }
    }
    $shell = New-Object -ComObject WScript.Shell
    # Resolve the real desktop, including OneDrive / redirected enterprise folders.
    $candidates = @([Environment]::GetFolderPath('DesktopDirectory'))
    try { $candidates += [string]$shell.SpecialFolders.Item('Desktop') } catch { Write-Diagnostic ('Desktop COM: ' + $_.Exception.Message) }
    try {
        $reg = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
        if ($reg.Desktop) { $candidates += [Environment]::ExpandEnvironmentVariables([string]$reg.Desktop) }
    } catch { Write-Diagnostic ('Desktop registry: ' + $_.Exception.Message) }
    $desktop = $null
    foreach ($candidate in ($candidates | Where-Object { $_ } | Select-Object -Unique)) {
        Write-Diagnostic ('Desktop candidate: ' + $candidate)
        if (-not $desktop -and [IO.Path]::IsPathRooted($candidate) -and (Test-Path -LiteralPath $candidate -PathType Container)) { $desktop = $candidate }
    }
    if (-not $desktop) { throw 'Не найдена папка рабочего стола текущего пользователя. Откройте её в Проводнике и проверьте доступ.' }
    $target = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw 'Не найден Windows PowerShell. Используйте start-windows.bat.' }
    # Launch PowerShell directly: VBScript/wscript.exe is no longer required.
    $shortcutPath = Join-Path $desktop 'TubeStudio.lnk'
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $target
    $shortcut.Arguments = '-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'launch.ps1') + '"'
    $shortcut.WorkingDirectory = $root
    $shortcut.Description = 'Запустить TubeStudio и открыть приложение в браузере'
    $shortcut.IconLocation = (Join-Path $PSScriptRoot 'tubestudio.ico') + ',0'
    $shortcut.Save()
    if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) { throw 'Windows не сохранила файл ярлыка.' }
    # Re-open the saved link; do not report success just because Save() returned.
    $saved = $shell.CreateShortcut($shortcutPath)
    if ($saved.TargetPath -ine $target -or $saved.WorkingDirectory -ine $root -or $saved.Arguments -ne $shortcut.Arguments) {
        throw 'Сохранённый ярлык не прошёл проверку пути запуска. Возможно, запись блокирует защита папок.'
    }
    Write-Diagnostic ('SUCCESS: ' + $shortcutPath)
    Write-Diagnostic ('Target: ' + $saved.TargetPath + ' ' + $saved.Arguments)
    Write-Diagnostic ('Журнал: ' + $log)
    if (-not $Quiet) { $shell.Popup('Ярлык TubeStudio сохранён и проверен: ' + $shortcutPath + "`nЕсли значка не видно, нажмите F5 на рабочем столе. Журнал: " + $log, 0, 'TubeStudio', 64) | Out-Null }
    exit 0
} catch {
    Write-Diagnostic ('ERROR: ' + $_.Exception.Message)
    Write-Diagnostic ('Журнал: ' + $log)
    Write-Diagnostic 'Создавайте ярлык от своего обычного пользователя, не от другого администратора. Не отключайте политики безопасности. Запуск без ярлыка: start-windows.bat.'
    exit 1
}
