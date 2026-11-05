$ErrorActionPreference = 'Stop'
# Desktop shortcut target: runs the launcher with the bundled Node.js in a hidden window.
$program = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$node = Join-Path $program 'runtime\node.exe'
$launcher = Join-Path $program 'app\launcher\launcher.mjs'
& $node $launcher
exit $LASTEXITCODE
