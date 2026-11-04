@echo off
setlocal
chcp 65001 >nul
title TubeStudio - Isolated Windows Stop Test
cd /d "%~dp0"
set "NODE_OPTIONS="
set "NODE_PATH="
where node >nul 2>nul || goto :missing
if not exist "%~dp0windows\test-stop.mjs" goto :missing
if not exist "%~dp0windows\server-control.mjs" goto :missing
echo.
echo Проверка создаст временные тестовые серверы на свободных портах.
echo Рабочая установка, её данные и ключи не используются и не останавливаются.
echo Проверяется помощник остановки, а не запуск всего приложения или установка обновления.
echo Не запускайте от администратора. Требуются Node.js 22/24 и доступный PowerShell.
"%SystemRoot%\System32\choice.exe" /C YN /N /M "Запустить изолированную проверку? Y - да, N - отмена: "
if errorlevel 3 goto :failed
if errorlevel 2 goto :cancel
if errorlevel 1 goto :run
goto :failed
:run
node "%~dp0windows\test-stop.mjs"
set "TEST_RESULT=%ERRORLEVEL%"
echo.
echo Код 0 - проверки пройдены; код 1 или 2 - прочитайте сообщение и отчёт.
echo Файл отчёта: windows-stop-test-report.json рядом с этим батником.
pause
exit /b %TEST_RESULT%
:cancel
echo Проверка отменена. Ничего не запущено и не остановлено.
pause
exit /b 0
:missing
echo Не найден Node.js или файлы комплекта windows. Распакуйте весь комплект в одну папку.
:failed
pause
exit /b 2
