@echo off
chcp 65001 >nul
title TubeStudio
cd /d "%~dp0"
if not exist "runtime\node.exe" (
  echo [!] Не найден файл runtime\node.exe. Распакуйте архив TubeStudio полностью и запустите снова.
  if not defined TUBESTUDIO_CI pause
  exit /b 1
)
"runtime\node.exe" "app\launcher\launcher.mjs" --from-cmd
if errorlevel 1 (
  echo.
  echo [!] Запуск не удался. Причина написана выше. Журнал: папка TubeStudioData\logs\launcher.log
  if not defined TUBESTUDIO_CI pause
  exit /b 1
)
echo.
echo Окно закроется само через 10 секунд. TubeStudio продолжит работать в браузере.
if not defined TUBESTUDIO_CI timeout /t 10 >nul
