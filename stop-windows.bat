@echo off
chcp 65001 >nul
title TubeStudio - Stop
cd /d "%~dp0"
where node >nul 2>nul || goto :missing
if not exist "%~dp0windows\server-control.mjs" goto :missing
 echo.
echo Сначала дождитесь завершения заданий и сохраните правки.
echo Будет отправлен запрос мягкой остановки только подтверждённому серверу этой папки.
echo При активных задачах остановка будет отклонена; принудительного завершения нет.
echo Google-задания Reporting продолжат работать; эта кнопка останавливает локальную программу.
"%SystemRoot%\System32\choice.exe" /C YN /N /M "Остановить TubeStudio? Y - да, N - отмена: "
if errorlevel 3 goto :failed
if errorlevel 2 goto :cancel
if errorlevel 1 goto :stop
goto :failed
:stop
node "%~dp0windows\server-control.mjs"
set "STOP_RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %STOP_RESULT%
:cancel
echo Остановка отменена.
pause
exit /b 0
:missing
echo Не найден Node.js или windows\server-control.mjs. Распакуйте весь комплект в папку TubeStudio.
:failed
pause
exit /b 1
