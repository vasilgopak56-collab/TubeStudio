$ErrorActionPreference = 'Stop'
try {
    $root = Split-Path -Parent $PSScriptRoot
    $helper = Join-Path $PSScriptRoot 'server-control.mjs'
    if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw 'Не найден windows/server-control.mjs. Распакуйте весь комплект обновления.' }
    $node = Get-Command node.exe -ErrorAction Stop
    & $node.Source $helper
    if ($LASTEXITCODE -ne 0) { exit 1 }
} catch {
    Write-Host 'Ошибка: безопасная остановка перед обновлением не выполнена. Проверьте Node.js и комплект файлов. Не завершайте чужие процессы Node.js.'
    exit 1
}
