@echo off
chcp 65001 >nul
title TubeStudio - остановка
cd /d "%~dp0"
"runtime\node.exe" "app\launcher\launcher.mjs" --stop --from-cmd
set "RESULT=%ERRORLEVEL%"
if not defined TUBESTUDIO_CI pause
exit /b %RESULT%
