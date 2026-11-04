@echo off
chcp 65001 >nul
title TubeStudio - Update
cd /d "%~dp0"
where node >nul 2>nul || goto :err
if not exist "%~dp0windows\server-control.mjs" goto :err
rem Pre-stop uses the same verified Node helper as stop-windows.bat; no PS1 execution.
node "%~dp0windows\server-control.mjs"
if errorlevel 1 goto :err
call npm install
if errorlevel 1 goto :err
call npm run build
if errorlevel 1 goto :err
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\install-shortcut.ps1" -Quiet
if errorlevel 1 echo [!] Ярлык НЕ создан. Запустите create-desktop-shortcut.bat; журнал: launcher-logs\shortcut-install.log.
echo.
echo Код программы обновлён. Результат создания ярлыка указан выше.
echo Запуск: ярлык TubeStudio, если он создан, или start-windows.bat.
pause
exit /b 0
:err
echo.
echo Обновление не завершено. Прочитайте сообщение выше.
pause
exit /b 1
