@echo off
chcp 65001 >nul
title TubeStudio
cd /d "%~dp0"
where node >nul 2>nul || (
  echo [!] Node.js не найден. Установите версию LTS с https://nodejs.org и запустите этот файл снова.
  start "" https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo [1/3] Устанавливаю зависимости (первый запуск, 3-5 минут^)...
  call npm install || goto :err
)
if not exist .env copy .env.example .env >nul
if not exist apps\web\dist\index.html (
  echo [2/3] Собираю программу...
  call npm run build || goto :err
)
if not exist apps\server\dist\index.js (
  call npm run build || goto :err
)
rem Refresh the desktop shortcut only after installation/build succeeded.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\install-shortcut.ps1" -Quiet
if errorlevel 1 echo [!] Ярлык НЕ создан. Запустите create-desktop-shortcut.bat; журнал: launcher-logs\shortcut-install.log.
echo [3/3] Запускаю TubeStudio: http://127.0.0.1:8787  (остановка: stop-windows.bat или Ctrl+C в этом окне)
start "" cmd /c "timeout /t 4 >nul & start http://127.0.0.1:8787"
rem Absolute entry lets stop-windows identify only this installation.
pushd "%~dp0apps\server" || goto :err
node --env-file-if-exists="%~dp0.env" "%~dp0apps\server\dist\index.js"
set "START_RESULT=%ERRORLEVEL%"
popd
if not "%START_RESULT%"=="0" goto :err
goto :eof
:err
echo.
echo [!] Ошибка. Прочитайте сообщение выше или раздел "Проблемы при установке" в документации.
pause
