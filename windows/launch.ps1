$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$mutex = $null
$locked = $false
try {
    # One launcher at a time, including simultaneous double-clicks.
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant()))).Replace('-', '')
    $sha.Dispose()
    $mutex = New-Object System.Threading.Mutex($false, ('Local\TubeStudioLauncher_' + $hash))
    try { $locked = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { exit 0 }
    $port = 8787
    $envFile = Join-Path $root '.env'
    if (Test-Path $envFile) {
        foreach ($line in [IO.File]::ReadAllLines($envFile)) {
            if ($line -match '^\s*PORT\s*=\s*["'']?(\d+)["'']?\s*(?:#.*)?$') { $port = [int]$Matches[1] }
        }
    }
    if ($port -lt 1 -or $port -gt 65535) { throw 'Неверный PORT в .env.' }
    $url = 'http://127.0.0.1:' + $port
    function Test-Ready {
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
            if ($response.Content -notmatch '<title>TubeStudio</title>') { throw 'PORT_BUSY' }
            return $true
        } catch {
            if ($_.Exception.Message -eq 'PORT_BUSY') { throw 'Порт занят другим приложением. Закройте его или измените PORT в .env.' }
            return $false
        }
    }
    if (Test-Ready) { Start-Process $url; exit 0 }
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { throw 'Node.js не найден. Установите Node.js LTS с https://nodejs.org, затем повторите запуск.' }
    $serverDir = Join-Path $root 'apps\server'
    $entry = Join-Path $serverDir 'dist\index.js'
    if (-not (Test-Path $entry) -or -not (Test-Path (Join-Path $root 'apps\web\dist\index.html')) -or -not (Test-Path (Join-Path $root 'node_modules'))) {
        # Initial installation is visible so npm progress and errors are not lost.
        Start-Process -FilePath (Join-Path $root 'start-windows.bat') -WorkingDirectory $root
        exit 0
    }
    $logs = Join-Path $root 'launcher-logs'
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $outLog = Join-Path $logs ($stamp + '.out.log')
    $errLog = Join-Path $logs ($stamp + '.err.log')
    $nodeArgs = '--env-file-if-exists=../../.env "' + $entry + '"'
    $proc = Start-Process -FilePath $node.Source -ArgumentList $nodeArgs -WorkingDirectory $serverDir -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
    for ($i = 0; $i -lt 60; $i++) {
        if (Test-Ready) { Start-Process $url; exit 0 }
        $proc.Refresh()
        if ($proc.HasExited) { throw ('Сервер не запустился. Подробности в файле: ' + $errLog) }
        Start-Sleep -Seconds 1
    }
    throw ('Сервер не ответил вовремя. Проверьте журнал: ' + $errLog)
} catch {
    $shell = New-Object -ComObject WScript.Shell
    $shell.Popup($_.Exception.Message, 0, 'TubeStudio — ошибка запуска', 16) | Out-Null
    exit 1
} finally {
    if ($locked -and $mutex) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}
